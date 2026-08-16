import { features } from "@/lib/env";
import { site as siteCfg } from "@/lib/site";
import { LLM_MODEL_FULL, LLM_MODEL_ENGINE_GPT, LLM_MODEL_FREE } from "@/lib/anthropic";
import { looksLikeUrl, normalizeUrl, domainOf, brandFromDomain, gradeFor } from "@/lib/utils";
import { scrapePage } from "./crawl";
import { buildSiteAudit, contentSnippet, metaDescriptionOf } from "./extract";
import { buildSeoEvidence, fetchSiteFiles, countEvidenceIssues } from "./seo-evidence";
import { fetchFieldData } from "./psi";
import { fetchBacklinks } from "./backlinks";
import { buildFoundationModules, countIssues } from "./seo-analysis";
import { prepare, extraQuestions } from "./prepare";
import { gptSearchAnswer } from "./gpt-engine";
import { computeVisibility, brandHit } from "./probe";
import { dfsEnginesActive, dfsAskEngine, dfsEngineModel } from "./dataforseo";
import { judgeAnswers, type AnswerItem } from "./analyze";
import { summarizeEngines, computeCompetitors, computeGaps, computeOverall } from "./score";
import { synthesize } from "./synthesize";
import type {
  AuditResult,
  SearchProbeResult,
  EngineBreakdown,
  EngineId,
  EngineQuestionResult,
  GapQuestion,
  Question,
  SeoEvidence,
  SiteAudit,
  VisibilityProbe,
} from "./types";

export class AuditError extends Error {
  constructor(
    message: string,
    public code: "invalid" | "unconfigured" | "internal" = "internal"
  ) {
    super(message);
  }
}

export type RunOptions = {
  plan?: "free" | "full";
  source?: string;
  /** 同域名上次审计的品类 —— 钉住它,题目才不会因品类措辞漂移而整批变样 */
  categoryHint?: string;
};

/**
 * 免费报告只测 ChatGPT(主引擎),付费报告在它之上再加这四家。
 * 顺序即报告展示顺序,与 lib/site.ts 的 engines 一致。
 */
const PAID_ENGINES: EngineId[] = ["claude", "gemini", "google_ai", "perplexity"];

/** 免费 3 题 / 付费 10 题(站长 2026-08-09 拍板) */
const FREE_QUESTIONS = 3;
const FULL_QUESTIONS = 10;

/**
 * 各引擎的问答通道 —— 只有两条:
 *   · chatgpt 直连 OpenAI,能看到**工具层面的客观证据**(搜没搜、引用了谁),
 *     阶梯的记忆层与可检索性全靠它;
 *   · 其余四家走 DataForSEO,只回正文。
 *
 * Claude 曾经也走 Anthropic 直连(站长 2026-08-10 决定统一收掉):那条分支
 * 需要 ANTHROPIC_API_KEY,而它余额早已耗尽、实际一直在走 DataForSEO 兜底 ——
 * 等于维护一条平时不生效的路径。代价是 Claude 那一栏测不到记忆层,
 * 但主引擎 ChatGPT 仍然测得到,而且这本来就是现状。
 */
async function askEngine(engine: EngineId, question: string): Promise<SearchProbeResult> {
  if (engine === "chatgpt") return gptSearchAnswer(question, { model: LLM_MODEL_ENGINE_GPT });
  const text = (await dfsAskEngine(engine, question)) || "";
  // DataForSEO 强制开启联网,每题都搜过 ⇒ usedSearch 恒真、无记忆层样本,如实标注
  return { ok: false, text, results: [], usedSearch: true, resultScope: "cited" };
}

/**
 * 「搜索结果里到底有没有你」—— 只在**确证**时下结论,拿不准一律 null。
 *
 * 拿到完整结果集(Anthropic 通道)时,里面没有你 = 真的搜不到你。
 * 但 OpenAI 只回**被引用**的来源:没有你只说明没被引用,完全可能
 * 搜到了却没引用。把后者当成"搜不到"会直接把品牌钉到阶梯第 1 层 ——
 * 那是全报告最重的一句话,宁可留空也不能靠推断。
 */
function retrievableFrom(
  asked: { a: SearchProbeResult }[],
  brand: string,
  domain: string
): boolean | null {
  if (asked.some(({ a }) => a.results.some((r) => brandHit(brand, domain, r)))) return true;
  const sawFullResultSet = asked.some(({ a }) => a.resultScope === "full" && a.results.length > 0);
  return sawFullResultSet ? false : null;
}

/** 这个引擎这一轮能不能跑(跑不了就如实标 inactive,绝不用别家顶替) */
function engineAvailable(engine: EngineId, dfsActive: boolean): boolean {
  if (engine === "chatgpt") return features.openai;
  return dfsActive;
}

/**
 * 该引擎实际被测的模型标识 —— 报告要能自证"测的是免费用户拿到的那一档"。
 * 填的必须是**受测**模型,不是分析模型:用户看的是"这个 AI 怎么回答我"。
 */
function engineModelName(engine: EngineId): string | undefined {
  if (engine === "chatgpt") return LLM_MODEL_ENGINE_GPT;
  return dfsEngineModel(engine) ?? undefined;
}

/** 引擎的展示名,用于面向用户的文案(单一事实源:lib/site.ts) */
function engineLabels(ids: EngineId[]): string {
  const labels = ids.map((id) => siteCfg.engines.find((e) => e.id === id)?.label ?? id);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** 限并发执行 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runAudit(rawInput: string, opts: RunOptions = {}): Promise<AuditResult> {
  const plan = opts.plan ?? "free";
  // 受测引擎恒为免费 ChatGPT 用户默认那一档(Luna)。调强 = 伪造用户体验:
  // 买家在免费 ChatGPT 里问同样的问题,拿到的就是这一档回答。
  //
  // 分析模型按 plan 分家:免费轮 Luna,付费轮 Sol(最强档)。付费升级
  // **不重判**免费轮的 ChatGPT 行 —— 用户读过的判定不换尺度,同一批回答
  // 也不花第二遍分析钱;Sol 只判付费新增的四个引擎与新增题目。
  const count = plan === "full" ? FULL_QUESTIONS : FREE_QUESTIONS;
  const model = plan === "full" ? LLM_MODEL_FULL : LLM_MODEL_FREE;

  if (!features.llm) {
    throw new AuditError("The audit engine isn't configured yet (missing OPENAI_API).", "unconfigured");
  }

  const input = (rawInput || "").trim();
  if (!input) throw new AuditError("Enter a brand name or website.", "invalid");

  // 1) 解析 URL/域名,抓站(若是网址)
  const isUrl = looksLikeUrl(input);
  const url = isUrl ? normalizeUrl(input) : null;
  const domain = url ? domainOf(url) : domainOf(input);

  let site: SiteAudit | undefined;
  let evidence: SeoEvidence | undefined;
  let homeTitle: string | undefined;
  let homeDescription: string | undefined;
  let homeSnippet: string | undefined;

  if (url && features.firecrawl) {
    const home = await scrapePage(url);
    if (home.ok) {
      const origin = new URL(url).origin;
      const { robots, sitemap, llms } = await fetchSiteFiles(origin);
      site = buildSiteAudit({ home, robots, sitemap, llms });
      // 地基事实包:免费轮也建。零 API 成本,而且免费报告的钩子数字
      // 必须是**真实**问题数,不能是编的 —— 编的数字等于用假数据卖付费报告。
      evidence = await buildSeoEvidence({ url, home, robots, sitemap, llms });
      homeTitle = home.title;
      homeDescription = home.metadata?.description as string | undefined || metaDescriptionOf(home.rawHtml);
      homeSnippet = contentSnippet(home.markdown, 2000);
    }
  }

  // 2) 准备:品牌画像 + 问题
  const prep = await prepare({
    rawInput: input,
    domain: url ? domain : undefined,
    homeTitle,
    homeDescription,
    homeSnippet,
    count,
    model,
    categoryHint: opts.categoryHint,
  });
  const brand = prep.brand || brandFromDomain(domain);

  // 3) 决定引擎:免费只跑 ChatGPT(主引擎,直连 OpenAI —— 快、可控、拿得到工具级证据);
  //    另外四家仅在【付费完整报告】时才跑,免费审计不触发昂贵的多引擎实时调用。
  const dfsActive = plan === "full" ? await dfsEnginesActive() : false;
  const liveEngines: EngineId[] = ["chatgpt"];
  const inactiveEngines: EngineId[] = [];
  for (const e of PAID_ENGINES) {
    (plan === "full" && engineAvailable(e, dfsActive) ? liveEngines : inactiveEngines).push(e);
  }

  // 4) ChatGPT 引擎:每个买家问题都开着 web_search,搜不搜由模型自己决定 ——
  //    像真实用户的 ChatGPT 那样。单一事实源:分数、问答矩阵、缺口、竞品、阶梯
  //    全部从这一批回答推导,同一问题绝不会出现两种答案。
  //     全部引擎**一起**跑。曾经是"先 ChatGPT、再其余四家"两段串行,
  //     10 题的付费轮那样要 120s + 90s,加上出题与汇总就顶到 maxDuration 上;
  //     它们之间本来也没有依赖,并行等于白捡一半时间。
  //
  const baseFoundation = evidence
    ? { evidence, modules: [], issueCount: countEvidenceIssues(evidence) }
    : undefined;
  //     地基层与问答一起并行:它只吃抓站阶段就拿到的 evidence,跟任何引擎的回答
  //     都没有依赖。原来排在问答之后串行,白白多花 ~80s —— 付费轮正好卡在
  //     maxDuration 边缘上。(依赖只有一条:synthesize 必须等它,见下。)
  const foundationWork: Promise<AuditResult["foundation"]> =
    plan === "full"
      ? buildFoundation({ url, domain, evidence }).then((f) => f ?? baseFoundation)
      : Promise.resolve(baseFoundation);

  const matrix: EngineQuestionResult[] = [];
  const perEnginePromise = Promise.all(
    liveEngines.map(async (engine) => {
      const asked = await mapLimit(prep.questions, 6, async (q) => ({
        q,
        a: await askEngine(engine, q.text), // 受测引擎,不是分析模型
      }));
      const items: AnswerItem[] = asked.map(({ q, a }) => ({
        questionId: q.id,
        question: q.text,
        answer: a.text,
        usedSearch: a.usedSearch, // 逐题存下来:付费轮老题不重问,阶梯重算全靠它
      }));
      const judged = await judgeAnswers({
        brand,
        domain,
        engine,
        items,
        model,
        category: prep.category,
        competitorsSeed: prep.competitorsSeed,
        excerptChars: plan === "full" ? 420 : 240,
        verifyDomain: isUrl,
      });
      return { engine, asked, judged };
    })
  );
  const [perEngine, foundation] = await Promise.all([perEnginePromise, foundationWork]);
  for (const p of perEngine) matrix.push(...p.judged);

  // 4.5) 阶梯层级:与矩阵同源、纯推导、零额外调用。跟着主引擎走 ——
  //      可检索性是站点属性,用拿得到工具级证据的那条通道来判最准。
  const mainRun = perEngine.find((p) => p.engine === "chatgpt") ?? perEngine[0];
  const visibility: VisibilityProbe | undefined = mainRun
    ? computeVisibility({
        rows: mainRun.judged,
        retrievable: retrievableFrom(mainRun.asked, brand, domain),
        // 记忆层只认 AI 压根没搜就作答的那些题(第 5 层的唯一依据)
        searchedQuestionIds: new Set(mainRun.asked.filter(({ a }) => a.usedSearch).map(({ q }) => q.id)),
      })
    : undefined;

  // 5) 汇总
  const activeEngines = liveEngines;
  const engines = summarizeEngines(matrix, activeEngines, liveEngines, inactiveEngines);
  const competitors = computeCompetitors(matrix, brand);
  const gapsRaw = computeGaps(matrix, prep.questions, brand);
  const overallScore = computeOverall(engines, site);

  // 5.5) 付费轮的逐引擎拆解。它和地基层曾经**只有** expandToAllEngines 才产出,
  //      于是直接 plan:"full" 跑出来的报告(公开 API 走的正是这条路)缺了整整两大块 ——
  //      同一个字段有时有、有时没有。
  const breakdown = plan === "full"
    ? buildBreakdown({
        liveEngines,
        matrix,
        engines,
        questions: prep.questions,
        brand,
        retrievable: visibility?.retrievable ?? null,
      })
    : undefined;

  // 6) 综合:裁决 + 缺口原因 + 建议
  const syn = await synthesize({
    brand,
    category: prep.category,
    positioning: prep.positioning,
    overallScore,
    engines,
    competitors,
    gaps: gapsRaw,
    site,
    visibility,
    foundationModules: foundation?.modules,
    model,
  });

  // 逐引擎缺口也要有原因文案 —— 复用全局 synthesize 产出的解释,按问题文本对齐
  if (breakdown) {
    const whyByQuestion = new Map(syn.gaps.map((g) => [g.question, g.why]));
    for (const b of breakdown) {
      b.gaps = b.gaps.map((g: GapQuestion) => ({ ...g, why: g.why || whyByQuestion.get(g.question) || "" }));
    }
  }

  const result: AuditResult = {
    brand,
    input,
    url,
    domain,
    category: prep.category,
    summary: syn.summary,
    overallScore,
    grade: gradeFor(overallScore),
    engines,
    matrix,
    questions: prep.questions,
    competitors,
    gaps: syn.gaps,
    recommendations: syn.recommendations,
    site,
    visibility,
    breakdown,
    // 免费轮:只带事实包和真实问题数当钩子,五个模块留空。
    // 数字是代码数出来的客观事实,付费后每一条都会被展开 —— 钩子必须能兑现。
    foundation,
    meta: {
      enginesLive: liveEngines,
      enginesInactive: inactiveEngines,
      generatedAt: new Date().toISOString(),
      questionCount: prep.questions.length,
      plan,
      // 必须从 inactiveEngines 现算,不能写死引擎名:曾经硬编码成
      // "ChatGPT, Perplexity, Gemini and Google AI are ready to activate",
      // 主引擎换成 ChatGPT 后,报告顶部一边说 ChatGPT 待激活、一边在下面
      // 挂着它 LIVE 的实测数据 —— 用户第一眼就看到自相矛盾。
      engineNote: inactiveEngines.length
        ? `${engineLabels(inactiveEngines)} are ready — unlock the full report to see them.`
        : undefined,
    },
  };

  return result;
}

/**
 * 地基层(付费专属):五个 SEO 模块。
 *
 * 事实包在免费轮就建好了 —— 这里直接复用,不重抓。两个真实数据源
 * (PSI 真实用户数据、Backlinks)才是付费才调的部分。
 *
 * 整段包在 try 里:地基是付费报告的**增量**,它挂了不该连累已经跑完的
 * AI 可见度部分。宁可少一半模块,也不能让用户付了钱看不到报告。
 */
async function buildFoundation(args: { url: string | null; domain: string; evidence?: SeoEvidence }) {
  const { evidence, url, domain } = args;
  if (!evidence || !url) return undefined;

  try {
    const [psi, backlinks] = await Promise.all([fetchFieldData(url), fetchBacklinks(domain)]);
    const modules = await buildFoundationModules({
      url,
      domain,
      evidence,
      psi,
      backlinks,
    });
    return {
      evidence,
      psi,
      backlinks,
      modules,
      // 钩子承诺的是事实包数出来的条数,付费展开只会更多不会更少 ——
      // 两个数取大的,免费页承诺过的数字不能在付费页缩水。
      issueCount: Math.max(countEvidenceIssues(evidence), countIssues(modules)),
    };
  } catch {
    // 地基层挂了不该连累已经跑完的可见度部分 —— 退回"只有事实包"的形态,
    // 免费页承诺过的问题数照样兑现,只是模块内容这轮没生成出来。
    return { evidence, modules: [], issueCount: countEvidenceIssues(evidence) };
  }
}

/**
 * 逐引擎拆解 —— 每个引擎自己的阶梯、竞品、缺口、受测模型。
 * runAudit(full) 与 expandToAllEngines 共用:两条路径产出的报告结构必须一致,
 * 否则同一个 API 字段在不同来源的报告里时有时无。
 */
function buildBreakdown(args: {
  liveEngines: EngineId[];
  matrix: EngineQuestionResult[];
  engines: { engine: EngineId; label: string }[];
  questions: Question[];
  brand: string;
  /** 站点可检索性是**站点**属性、与哪个 AI 在搜无关 —— 全引擎复用主引擎那次客观观测 */
  retrievable: boolean | null;
}): EngineBreakdown[] {
  return args.liveEngines.map((engine) => {
    const rows = args.matrix.filter((m) => m.engine === engine);
    return {
      engine,
      label: args.engines.find((e) => e.engine === engine)?.label ?? engine,
      // 记忆层样本 = 逐题存下来的 usedSearch:缺这一位的行(旧报告 /
      // DataForSEO 强制联网)一律算作"搜过" —— 宁可测不到记忆层,
      // 也不能把没证据的题当成"AI 不联网也记得你"。
      visibility: computeVisibility({
        rows,
        retrievable: args.retrievable,
        searchedQuestionIds: new Set(rows.filter((r) => r.usedSearch !== false).map((r) => r.questionId)),
      }),
      competitors: computeCompetitors(rows, args.brand),
      gaps: computeGaps(rows, args.questions, args.brand),
      // 报告要能自证测的是哪一档模型 —— 填的必须是**受测**模型,不是分析模型。
      modelName: engineModelName(engine),
    };
  });
}

/**
 * 付费解锁:把 3 题单引擎的免费预览扩展成 10 题五引擎的完整报告。
 *
 * 两条铁律:
 *   1. 免费那 3 题**留在原位**,只往后追加新题 —— 用户刚读过的题目不会在
 *      付款后整批变样,而且五个引擎问的是同一批题,才能横向对比谁推荐你。
 *   2. 免费轮的 ChatGPT 行**原样保留、不重判** —— 用户读过的判定不换尺度,
 *      同一批回答也不付第二遍分析钱。最强档只判新增的题和新增的引擎。
 * 品类校准锚直接用免费轮的实测竞品 —— 比 prepare 当初的猜测更准。
 */
export async function expandToAllEngines(prev: AuditResult): Promise<AuditResult> {
  if (!features.llm) {
    throw new AuditError("The audit engine isn't configured yet (missing OPENAI_API).", "unconfigured");
  }
  const dfsActive = await dfsEnginesActive();
  const targets = PAID_ENGINES.filter((e) => engineAvailable(e, dfsActive));
  if (!targets.length) {
    throw new AuditError(
      "Live multi-engine querying is temporarily unavailable. Your report is safe — we'll finish it shortly.",
      "unconfigured"
    );
  }
  // 通道缺席的引擎(如 DataForSEO 欠费)如实标 inactive —— 绝不用别家顶替
  const unavailable = PAID_ENGINES.filter((e) => !targets.includes(e));

  const { brand, domain } = prev;
  const isUrl = !!prev.url;
  const model = LLM_MODEL_FULL;
  const seed = prev.competitors.slice(0, 8).map((c) => c.name);

  // 1) 题目 = 免费那批 + 补到 10 题。补题失败只是题少几道,仍是真实测量;
  //    硬凑题会把编出来的问题混进付费报告,比少几题严重得多。
  const kept = prev.questions;
  const added = await extraQuestions({
    brand,
    domain: isUrl ? domain : undefined,
    category: prev.category,
    need: Math.max(0, FULL_QUESTIONS - kept.length),
    existing: kept.map((q) => q.text),
    model,
  });
  const questions = [...kept, ...added];

  const matrix: EngineQuestionResult[] = [];

  // 2) ChatGPT 行:免费轮已经问过且有内容的题**原样保留、不重判**(铁律 2),
  //    其余的才现问现判。
  const prevGptById = new Map(
    prev.matrix.filter((m) => m.engine === "chatgpt").map((m) => [m.questionId, m])
  );
  // 要现问的题 = 手上没有可用 ChatGPT 行的那些。这一条覆盖三种情况:
  //   · 新补的 7 道题(免费轮压根没问过);
  //   · 免费轮该题回答为空(引擎抽风 —— 空答案不是数据,是故障,必须重来);
  //   · **主引擎还是 Claude 时生成的老报告**(2026-08-09 之前):它们一行 chatgpt
  //     都没有。只补新题的话,付费页会出现"10 题里只有 7 题有 ChatGPT 数据",
  //     另外 3 格凭空空着 —— 用户花了钱,不该看到缺口。
  const gptTodo = questions.filter((q) => {
    const row = prevGptById.get(q.id);
    return !row || !(row.answerFull || row.answerExcerpt || "").trim();
  });
  let freshGpt = new Map<string, EngineQuestionResult>();
  if (gptTodo.length) {
    try {
      const items: AnswerItem[] = await mapLimit(gptTodo, 8, async (q) => {
        const a = await askEngine("chatgpt", q.text);
        return { questionId: q.id, question: q.text, answer: a.text || "", usedSearch: a.usedSearch };
      });
      const judged = await judgeAnswers({
        brand,
        domain,
        engine: "chatgpt",
        items,
        model,
        category: prev.category,
        competitorsSeed: seed,
        excerptChars: 1000,
        verifyDomain: isUrl,
      });
      freshGpt = new Map(judged.map((j) => [j.questionId, j]));
    } catch {
      freshGpt = new Map(); // 失败就少几行,不编内容
    }
  }
  // 顺序必须跟着 questions 走:前端是 matrix.filter(engine) 后直接顺排渲染,
  // 把新行追加到末尾会让问题串位(Q1 Q2 Q4 Q5 Q3),用户一眼就看出乱了。
  for (const q of questions) {
    const row = freshGpt.get(q.id) ?? prevGptById.get(q.id);
    if (row) matrix.push(row);
  }

  // 地基层此刻就可以开跑 —— 它只吃免费轮抓站时拿到的 evidence,不依赖任何回答。
  // 排在问答之后串行会白花 ~80s,而付费升级本来就贴着 maxDuration 上限。
  const foundationWork = buildFoundation({
    url: prev.url,
    domain: prev.domain,
    evidence: prev.foundation?.evidence,
  }).then((f) => f ?? prev.foundation);

  // 3) 其余四个引擎:全部 10 题,**每次都全量重问**。曾经写成"只补跑缺的引擎",
  //    结果对已完整的报告重跑升级时 todo 为空、旧行又没人保留 —— 引擎直接从
  //    报告里蒸发。重跑升级的语义就是"要一份新鲜的完整报告"。
  //    引擎完全没返回内容 ⇒ 不能算"它没推荐你",要如实标成不可用。
  const failedEngines: EngineId[] = [];
  const perEngine = await Promise.all(
    targets.map(async (engine) => {
      const answers = await mapLimit(questions, 6, async (q) => {
        const a = await askEngine(engine, q.text);
        return { questionId: q.id, question: q.text, answer: a.text, usedSearch: a.usedSearch } as AnswerItem;
      });
      if (!answers.some((a) => a.answer.trim())) {
        failedEngines.push(engine);
        return [];
      }
      return judgeAnswers({
        brand,
        domain,
        engine,
        items: answers,
        model,
        category: prev.category,
        competitorsSeed: seed,
        excerptChars: 1000,
        verifyDomain: isUrl,
      });
    })
  );
  for (const judged of perEngine) matrix.push(...judged);

  const liveEngines: EngineId[] = [...new Set(matrix.map((m) => m.engine))];
  const engines = summarizeEngines(matrix, liveEngines, liveEngines, [
    ...failedEngines,
    ...unavailable,
  ]).map((e) =>
    failedEngines.includes(e.engine)
      ? { ...e, status: "error" as const, note: "This engine didn't return an answer — not counted in your score." }
      : e
  );
  const competitors = computeCompetitors(matrix, brand);
  const gapsRaw = computeGaps(matrix, questions, brand);
  const overallScore = computeOverall(engines, prev.site);

  // 逐引擎拆出同构的模块数据。
  // 站点可检索性是**站点**属性、与哪个 AI 在搜无关 —— 复用免费轮那次客观观测,
  // 这样只回正文的引擎也能区分"搜不到你"(第1层)与"搜得到但不推你"(第2层)。
  const retrievable = prev.visibility?.retrievable ?? null;
  // 全部在 10 题上重算(免费轮那份只覆盖 3 题,直接沿用会让付费页的阶梯
  // 与它下面的问答表对不上数)
  const breakdown = buildBreakdown({ liveEngines, matrix, engines, questions, brand, retrievable });

  // 地基层必须先于 synthesize 完成:Fix roadmap 是全报告的最终汇总,要把五个
  // SEO 模块的发现一起吸收进去。曾经为省时间与 synthesize **并行**,代价是
  // roadmap 只看得见可见度侧、地基层的问题全部漏排。所以这里只等它,不跳过它 ——
  // 它早在上面就和引擎问答一起跑了,这一 await 通常立刻返回。
  const foundation = await foundationWork;

  const syn = await synthesize({
    brand,
    category: prev.category,
    positioning: prev.summary,
    overallScore,
    engines,
    competitors,
    gaps: gapsRaw,
    site: prev.site,
    visibility: prev.visibility,
    foundationModules: foundation?.modules,
    model,
  });

  // 逐引擎缺口也要有原因文案 —— 复用全局 synthesize 产出的解释,按问题文本对齐
  const whyByQuestion = new Map(syn.gaps.map((g) => [g.question, g.why]));
  for (const b of breakdown) {
    b.gaps = b.gaps.map((g: GapQuestion) => ({ ...g, why: g.why || whyByQuestion.get(g.question) || "" }));
  }

  return {
    ...prev,
    summary: syn.summary,
    overallScore,
    grade: gradeFor(overallScore),
    engines,
    matrix,
    questions,
    competitors,
    gaps: syn.gaps,
    recommendations: syn.recommendations,
    breakdown,
    // 顶层阶梯跟着主引擎走,且必须是 10 题重算的那一份 —— 沿用免费轮 3 题版
    // 会让页面上的阶梯和它正下方的问答表对不上数(3 题的结论配 10 题的表格)。
    visibility: breakdown.find((b) => b.engine === "chatgpt")?.visibility ?? prev.visibility,
    foundation: foundation ?? prev.foundation,
    meta: {
      ...prev.meta,
      enginesLive: liveEngines,
      // 通道缺席的引擎如实留在这里,不假装全跑了
      enginesInactive: unavailable,
      questionCount: questions.length,
      plan: "full",
      generatedAt: new Date().toISOString(),
      engineNote: unavailable.length
        ? `${engineLabels(unavailable)} isn't connected yet — not counted in your score.`
        : undefined,
    },
  };
}
