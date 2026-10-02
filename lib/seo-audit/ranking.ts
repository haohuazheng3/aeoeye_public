/* ============================================================
   SEO Ranking Score(v3)—— 付费完整版的新总分

   为什么是纯函数:规格 §0 要求"同一站点多次运行结果一致、每一分都能追溯到证据",
   所以这里不做任何 I/O、不调大模型,也不读 Date.now()(调用方没给 input.now 时才退回当前时间)。
   输入全是已经拿到的数据:抓取页的内容信号(parse.ts → page.content)、PSI、站内检查与
   7 维分数、DataForSEO 外链 / 排名、相关性分析(relevance.ts)。

   结构:
   - buildRankingContext:把"可读页、内容页、品牌"这些多个小维度共用的口径一次算好,
     各小维度不各算一遍,口径才不会悄悄打架;
   - 25 个小维度各有一个导出的纯函数(可单测),公式逐字对应规格 §4;
   - computeRanking 只做加权、null 重新归一、技术门槛封顶与拼装。

   文案约定(付费客户读的是创始人 / 市场负责人,不是 SEO):
   summary ≥70 写达标句、<70 写白话问题句、null 写 "Not measured: <原因>";
   evidence 1–4 条带真实数字与示例路径;fixes 1–3 条具体可做的事,≥90 分不给修法。
   规格:docs/design/seo-ranking-score-spec.md §4
   ============================================================ */

import {
  RANKING_PILLARS,
  RANKING_SUBS,
  type AuthorityResult,
  type CrawledPage,
  type DimensionId,
  type DimensionScore,
  type PageContentSignals,
  type PageFormat,
  type PillarId,
  type PillarScore,
  type PsiResult,
  type RankingFramework,
  type RelevanceAnalysis,
  type RelevancePair,
  type SearchIntent,
  type SeoCheck,
  type SiteProbe,
  type SubScore,
  type VisibilityResult,
} from "./types";
import { GATE_OVERALL_CAP, SEVERITY_RANK, gradeFor } from "./score";
import { checkTitle } from "./checks/titles";
import { clusters, isHtml200, isToolPath, listPaths, minhashSimilarity, pageTypeOf, parseDate, pathOf, urlKey } from "./checks/helpers";

/** 规格 §1 的输入契约(逐字) */
export interface RankingInput {
  domain: string;
  pages: CrawledPage[];
  probe: SiteProbe;
  psi: { mobile: PsiResult | null; desktop: PsiResult | null };
  checks: SeoCheck[];
  dimensions: DimensionScore[];
  technical: { score: number; grade: "A" | "B" | "C" | "D" | "F"; blockers: string[] };
  authority: AuthorityResult | null;
  visibility: VisibilityResult | null;
  relevance: RelevanceAnalysis | null;
  now?: Date;
}

type Grade = "A" | "B" | "C" | "D" | "F";

/* ============================================================
   常量
   ============================================================ */

/** 内容页的最低主体词数(规格 §4) */
export const CONTENT_MIN_WORDS = 300;
/** 内容页的页面类型:首页、定价、法律、联系页都不算(它们的任务不是回答问题) */
const CONTENT_TYPES = new Set<string>(["article", "product", "other", "listing"]);
/** 与站内 onpage.near-duplicate 同一个阈值,两处对"近重复"的判断不能打架 */
const NEAR_DUP_SIM = 0.8;
const PILLAR_ORDER: PillarId[] = ["relevance", "quality", "authority", "behavior", "technical"];
const SUB_META = new Map(RANKING_SUBS.map((s) => [s.id, s]));
const SUB_ORDER = new Map(RANKING_SUBS.map((s, i) => [s.id, i]));
const DAY_MS = 86_400_000;

/** 技术支柱的 7 个小维度 ↔ 现有 7 个站内维度(规格 §4 技术基础) */
export const TECHNICAL_SUB_DIMENSIONS: Readonly<Record<string, DimensionId>> = {
  "technical.crawl": "crawlability",
  "technical.onpage": "onpage",
  "technical.cwv": "performance",
  "technical.mobile": "mobile",
  "technical.https": "security",
  "technical.structure": "architecture",
  "technical.schema": "structured",
};

/* ============================================================
   小工具
   ============================================================ */

/** 0–100 取整;顺手把 -0 归成 0(deepStrictEqual 会区分 -0 与 0) */
function clampScore(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const r = Math.round(Math.min(100, Math.max(0, x)));
  return r === 0 ? 0 : r;
}

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function ratio(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

/** 0-1 → 整数百分比 */
function pct01(x: number): number {
  return Math.round(x * 100);
}

function pctOf(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/** 千分位整数(不用 toLocaleString:避免依赖运行环境的 ICU,保证确定性) */
function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmt1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** 证据里引用别处的长句时截断,保持一行能读完 */
function clip(s: string, max = 220): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * 按句子截断:站内检查的修法常是"做法。Verify: …"两三句,硬截会断在半个词上。
 * 超长时退到 max 之前最后一个句号 / 分号处;前面没有合适的断点(不到 max 的 40%)才硬截。
 */
function clipSentence(s: string, max = 240): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  return cut >= max * 0.4 ? head.slice(0, cut) : clip(t, max);
}

/** 本模块的句子不带句末句号(与 UI 列表风格一致);复用别处的句子时去掉一个句末句号 */
function trimDot(s: string): string {
  return (s ?? "").trim().replace(/\.$/, "");
}

function quoteQuery(q: string): string {
  return `"${clip(q, 70)}"`;
}

function paths(urls: string[], n = 3): string {
  return listPaths(urls, n);
}

function contentOf(p: CrawledPage): PageContentSignals {
  return p.content as PageContentSignals;
}

/* ============================================================
   品牌与主题分词
   ============================================================ */

/** 公司后缀不算品牌的一部分("Acme Inc" 与 "Acme" 是同一个品牌) */
const LEGAL_SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pty)\b\.?/g;
/** 二级公共后缀(co.uk / com.au …)下品牌标签在倒数第三段(与 dataforseo.ts 的口径一致) */
const SECOND_LEVEL_SUFFIX = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

/** 注册域的品牌标签:aeoeye.com → aeoeye;example.co.uk → example */
export function domainLabel(domain: string): string {
  const host = (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 3 && SECOND_LEVEL_SUFFIX.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? "");
}

/** 品牌名归一:小写、去公司后缀、去空格与符号("AEO eye, Inc." → "aeoeye") */
export function brandKey(name: string): string {
  return (name ?? "").toLowerCase().replace(LEGAL_SUFFIX, " ").replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 相同,或一方包含另一方("acme" ⊂ "acmeanalytics");短于 3 个字符只认完全相同,防误配 */
function keysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
}

/**
 * 主题词停用表:功能词 + 标题里高频但不代表主题的词(best / guide / tips / tools …)。
 * 主题簇和"标题承诺"都靠共享主题词判断,这些词留着会把毫不相干的页归到一起。
 */
const TOPIC_STOP = new Set([
  "the", "and", "for", "with", "your", "you", "our", "are", "can", "how", "what", "why", "when", "where", "who", "which",
  "best", "top", "guide", "ultimate", "complete", "tip", "way", "step", "list", "free", "online", "new", "versus",
  "review", "example", "thing", "need", "know", "everything", "about", "into", "from", "this", "that", "these", "those",
  "doe", "does", "should", "will", "get", "use", "using", "used", "make", "more", "most", "really", "simple", "easy",
  "quick", "beginner", "introduction", "intro", "overview", "explained", "update", "updated", "year", "month", "not",
  "all", "any", "its", "than", "then", "there", "their", "them", "they", "was", "were", "has", "have", "had", "been",
  "also", "just", "only", "very", "much", "many", "some", "such", "each", "other", "over", "under", "after", "before",
  "between", "without", "within", "out", "per", "via", "here", "now", "today", "part", "page", "home", "blog", "post",
  "article", "learn", "read", "checklist", "template", "tool", "software", "app", "platform", "solution", "service",
  "company", "inc", "llc", "ltd", "official", "welcome", "start", "started", "getting", "work", "works", "vs", "faq",
]);

/** 极简词干:复数归单数(audits → audit,strategies → strategy);ss / us / is 结尾不动 */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** 主题词集合:小写、按非字母数字切分、去停用词 / 纯数字 / 品牌词、简单词干化 */
export function topicTokens(text: string, brandWords: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || TOPIC_STOP.has(raw) || brandWords.has(raw)) continue;
    const s = stem(raw);
    if (s.length < 3 || TOPIC_STOP.has(s) || brandWords.has(s)) continue;
    out.add(s);
  }
  return out;
}

/** 去掉标题里的品牌后缀("How to fix X — Acme" → "How to fix X"),品牌词不算主题 */
export function titleCore(p: CrawledPage): string {
  const t = (p.title ?? "").trim();
  const tb = p.content?.titleBrand?.trim();
  if (tb) {
    const idx = t.lastIndexOf(tb);
    if (idx > 0) {
      const head = t.slice(0, idx).replace(/[\s|\-—–·:]+$/u, "").trim();
      if (head) return head;
    }
  }
  return t;
}

export interface BrandInfo {
  /** 注册域标签(aeoeye.com → aeoeye) */
  label: string;
  /** 页面上最常见的品牌名(Organization / og:site_name / 标题后缀);没有为 null */
  name: string | null;
  /** 归一化品牌键 */
  key: string | null;
  /** 品牌名与域名主体相符 */
  matchesDomain: boolean;
  /** 带有与主品牌一致的品牌信号的页 / 没有的页(只看有内容信号的可读页) */
  consistentPages: string[];
  inconsistentPages: string[];
  /** 主题分析里要剔除的品牌词 */
  words: Set<string>;
  /** 判定"品牌关键词"用的紧凑串(关键词去空格后包含它即品牌词) */
  keywordTokens: string[];
}

function brandInfoOf(domain: string, pages: CrawledPage[]): BrandInfo {
  const label = domainLabel(domain);
  const counts = new Map<string, { n: number; raw: string }>();
  const perPage: string[][] = [];
  for (const p of pages) {
    const c = contentOf(p);
    const keys: string[] = [];
    for (const raw of [c.orgName, c.siteName, c.titleBrand]) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const k = brandKey(raw);
      if (k.length < 2 || keys.includes(k)) continue;
      keys.push(k);
      const cur = counts.get(k);
      if (cur) cur.n += 1;
      else counts.set(k, { n: 1, raw: raw.trim() });
    }
    perPage.push(keys);
  }
  // 主品牌 = 出现页数最多的品牌键;并列时优先与域名相符的,再按字母序(确定性)
  let best: string | null = null;
  for (const [k, v] of Array.from(counts.entries())) {
    if (best === null) {
      best = k;
      continue;
    }
    const b = counts.get(best)!;
    const kd = keysMatch(k, label);
    const bd = keysMatch(best, label);
    if (v.n > b.n || (v.n === b.n && kd && !bd) || (v.n === b.n && kd === bd && k < best)) best = k;
  }
  const consistentPages: string[] = [];
  const inconsistentPages: string[] = [];
  pages.forEach((p, i) => {
    if (best !== null && perPage[i].some((k) => keysMatch(k, best as string))) consistentPages.push(p.url);
    else inconsistentPages.push(p.url);
  });
  const matchesDomain = best !== null && keysMatch(best, label);
  const name = best !== null ? counts.get(best)!.raw : null;
  // 只剔除"就是品牌本身"的词:品牌 "AEO Eye" 里的 "aeo" 是主题词,剔掉会毁掉 AEO 话题簇
  const words = new Set<string>();
  if (label.length >= 2) words.add(label);
  if (best) words.add(best);
  for (const w of (name ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w && (w === label || w === best)) words.add(w);
  const keywordTokens = uniq([label.length >= 3 ? label : "", best && best.length >= 4 && matchesDomain ? best : ""].filter(Boolean));
  return { label, name, key: best, matchesDomain, consistentPages, inconsistentPages, words, keywordTokens };
}

/** 品牌关键词:去掉空格与符号后包含品牌串("aeo eye pricing" 也算) */
function isBrandKeyword(keyword: string, tokens: string[]): boolean {
  const compact = (keyword ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return tokens.some((t) => compact.includes(t));
}

/* ============================================================
   上下文:多个小维度共用的口径一次算好
   ============================================================ */

export interface RankingContext {
  input: RankingInput;
  now: Date;
  /** 读得出内容的页(HTML 且 200) */
  readable: CrawledPage[];
  /** 可读且有内容信号的页 */
  signalPages: CrawledPage[];
  /** 内容类型页(article / product / other / listing),剔除 JS 空壳与工具路径;薄内容占比的分母 */
  typedPages: CrawledPage[];
  /** 内容页 = typedPages 中主体词数 ≥ 300 */
  contentPages: CrawledPage[];
  /** 内容页里的文章页(FAQ 占比的分母) */
  articlePages: CrawledPage[];
  pairs: RelevancePair[];
  brand: BrandInfo;
}

/** 内容页判定(规格 §4):类型 ∈ {article, product, other, listing} 且主体 ≥ 300 词;JS 空壳与登录 / 购物车之类工具页不算 */
export function isContentPage(p: CrawledPage): boolean {
  return isHtml200(p) && !!p.content && CONTENT_TYPES.has(pageTypeOf(p)) && p.jsShell !== true && !isToolPath(p.url) && num(p.content.mainWords) >= CONTENT_MIN_WORDS;
}

export function buildRankingContext(input: RankingInput): RankingContext {
  const now = input.now ?? new Date();
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const readable = pages.filter(isHtml200);
  const signalPages = readable.filter((p) => !!p.content);
  const typedPages = signalPages.filter((p) => CONTENT_TYPES.has(pageTypeOf(p)) && p.jsShell !== true && !isToolPath(p.url));
  const contentPages = typedPages.filter((p) => num(contentOf(p).mainWords) >= CONTENT_MIN_WORDS);
  const articlePages = contentPages.filter((p) => pageTypeOf(p) === "article");
  const pairs = Array.isArray(input.relevance?.pairs) ? (input.relevance as RelevanceAnalysis).pairs : [];
  return { input, now, readable, signalPages, typedPages, contentPages, articlePages, pairs, brand: brandInfoOf(input.domain, signalPages) };
}

/* ============================================================
   SubScore 组装:分数决定 summary 用哪一句,并保证条数约束
   ============================================================ */

interface SubDraft {
  /** 原始分(未取整);null = 没测 */
  score: number;
  /** score ≥ 70 时的达标句 */
  good: string;
  /** score < 70 时的问题句 */
  bad: string;
  evidence: string[];
  fixes: string[];
}

/** 每个小维度的兜底修法:分数 <90 却没写出具体修法时用它,保证"<90 至少一条" */
const DEFAULT_FIX: Record<string, string> = {
  "relevance.intent": "Give each target query the page format that already ranks for it — a list, a comparison, a how-to or a product page",
  "relevance.coverage": "Compare your page with the top 5 results for its main query and add the subtopics most of them cover",
  "relevance.gain": "Add something the top results don't have: your own test results, real numbers, a worked example or your own screenshots",
  "relevance.alignment": "Use the exact words people search in the title and H1, and answer the question in the first two sentences",
  "quality.experience": "Add what you actually did: the setup you tested, the numbers you saw, a screenshot from your own account",
  "quality.data": "Back key claims with your own numbers or a link to the primary source (official docs, the study, the government page)",
  "quality.authorship": "Show who wrote each article (a byline that links to an author page) and who runs the company (About and Contact pages)",
  "quality.freshness": "Review your most important pages, refresh facts and screenshots, then update dateModified",
  "quality.scaled": "Merge or rewrite pages that repeat each other, and give every page something only you can add",
  "authority.editorial": "Earn links inside articles: offer data, quotes or a useful tool to writers who cover your topic",
  "authority.breadth": "Publish one asset worth linking to — original data, a free tool or a template — and pitch it to sites your buyers read",
  "authority.clusters": "Give each main topic a hub page that links to 3+ related articles, and have those articles link back",
  "authority.internal": "Link your homepage, pricing and best-ranking pages from the main navigation or footer",
  "authority.entity": "Use one brand name everywhere (title suffix, og:site_name, Organization schema) and link your official profiles with sameAs",
  "behavior.realuser": "Fix the slowest Core Web Vital first — see the Performance section for the exact elements",
  "behavior.task": "Answer the main question in the first two sentences and end every page with a clear next step",
  "behavior.readability": "Use shorter sentences and paragraphs, a subheading every 200–300 words, and lists for steps and options",
  "behavior.promise": "Make every title describe exactly what the page delivers — the topic, the number and the tone",
};

function measured(id: string, d: SubDraft): SubScore {
  const meta = SUB_META.get(id)!;
  const score = clampScore(d.score);
  const evidence = uniq(d.evidence.map((e) => trimDot(e)).filter(Boolean)).slice(0, 4);
  if (!evidence.length) evidence.push(`Score ${score}/100 from the pages we analysed`);
  let fixes = uniq(d.fixes.map((f) => trimDot(f)).filter(Boolean)).slice(0, 3);
  if (score >= 90) fixes = [];
  else if (!fixes.length) fixes = [DEFAULT_FIX[id] ?? "Review the evidence above and fix the weakest page first"];
  return {
    id,
    pillar: meta.pillar,
    label: meta.label,
    score,
    weight: meta.weight,
    confidence: meta.confidence,
    summary: trimDot(score >= 70 ? d.good : d.bad),
    evidence,
    fixes,
  };
}

/** 没测 ≠ 0 分:score 为 null,不进加权;summary 明说原因,evidence 至少一条 */
function notMeasured(id: string, reason: string, opts: { evidence?: string[]; fixes?: string[] } = {}): SubScore {
  const meta = SUB_META.get(id)!;
  const why = trimDot(reason);
  const evidence = uniq((opts.evidence ?? []).map((e) => trimDot(e)).filter(Boolean)).slice(0, 4);
  if (!evidence.length) evidence.push(why.charAt(0).toUpperCase() + why.slice(1));
  return {
    id,
    pillar: meta.pillar,
    label: meta.label,
    score: null,
    weight: meta.weight,
    confidence: meta.confidence,
    summary: `Not measured: ${why}`,
    evidence,
    fixes: uniq((opts.fixes ?? []).map((f) => trimDot(f)).filter(Boolean)).slice(0, 3),
  };
}

/* ---------- 共用的"没测"原因 ---------- */

function relevanceGap(ctx: RankingContext): { reason: string; evidence: string[] } | null {
  const r = ctx.input.relevance;
  if (!r) return { reason: "the search-query comparison did not run for this report", evidence: [] };
  if (!ctx.pairs.length) {
    const notes = (r.notes ?? []).filter((n) => typeof n === "string" && n.trim()).slice(0, 2);
    return { reason: "no search queries could be matched to your pages", evidence: notes.map((n) => clip(n)) };
  }
  return null;
}

function contentGap(ctx: RankingContext): string {
  if (!ctx.readable.length) return "we could not read any pages on the site";
  if (!ctx.signalPages.length) return "page content signals were not collected for this report — re-run it to compute them";
  return `none of the ${plural(ctx.readable.length, "page")} we read has ${CONTENT_MIN_WORDS}+ words of main text (homepage, pricing, legal and contact pages don't count)`;
}

const CONTENT_GAP_FIX = `Publish in-depth pages (${CONTENT_MIN_WORDS}+ words) that answer the questions your buyers search for`;

function authorityGap(a: AuthorityResult | null): string | null {
  if (!a) return "backlink data was not available for this report";
  if (a.noData) return "DataForSEO has no backlink data for this domain yet";
  return null;
}

/* ============================================================
   相关性 / 搜索意图(30)
   ============================================================ */

const FORMAT_NAME: Record<PageFormat, string> = {
  definition: "a definition page",
  "how-to": "a how-to guide",
  comparison: "a comparison",
  listicle: "a list of options",
  product: "a product page",
  pricing: "a pricing page",
  local: "a local business page",
  homepage: "the homepage",
  article: "an article",
  other: "a general page",
};

const FORMAT_PLURAL: Record<PageFormat, string> = {
  definition: "definition pages",
  "how-to": "how-to guides",
  comparison: "comparisons",
  listicle: "lists of options",
  product: "product pages",
  pricing: "pricing pages",
  local: "local business pages",
  homepage: "homepages",
  article: "articles",
  other: "general pages",
};

const FORMAT_ADVICE: Record<PageFormat, string> = {
  comparison: "a side-by-side comparison (a table of the options, who each one fits, and a clear verdict)",
  listicle: "a ranked list of options with a one-line verdict for each",
  "how-to": "numbered, step-by-step instructions",
  definition: "a one-sentence definition up top, followed by examples",
  product: "a product page with the price, key features and a clear sign-up or buy button",
  pricing: "a pricing page that shows plans, prices and what each plan includes",
  local: "a location page with address, phone number, opening hours and a map",
  homepage: "your homepage",
  article: "an in-depth article",
  other: "a page built around that exact question",
};

/** 规格 §3.8 的可接受形态(修法里取第一个作为建议形态) */
const INTENT_FORMATS: Record<SearchIntent, PageFormat[]> = {
  informational: ["definition", "how-to", "listicle", "article"],
  commercial: ["comparison", "listicle", "product", "pricing", "article"],
  transactional: ["product", "pricing", "homepage"],
  navigational: ["homepage", "product", "pricing"],
  local: ["local", "homepage"],
};

const INTENT_WANTS: Record<SearchIntent, string> = {
  informational: "want an answer or an explanation",
  commercial: "are comparing options before they buy",
  transactional: "are ready to buy or sign up",
  navigational: "are looking for your site",
  local: "want a business near them",
};

function formatName(f: PageFormat | null | undefined): string {
  return f && FORMAT_NAME[f] ? FORMAT_NAME[f] : FORMAT_NAME.other;
}

/** relevance.intent(30)= 100 × 匹配对数 / 有判定的对数;无对 → null */
export function scoreRelevanceIntent(ctx: RankingContext): SubScore {
  const id = "relevance.intent";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const judged = ctx.pairs.filter((p) => typeof p.intentMatch === "boolean");
  if (!judged.length) return notMeasured(id, "we could not tell which page format fits the queries we checked");
  const matched = judged.filter((p) => p.intentMatch === true);
  const missed = judged.filter((p) => p.intentMatch === false);
  const line = (p: RelevancePair) =>
    `${quoteQuery(p.query)} (${p.intent} intent) → ${pathOf(p.url)} is ${formatName(p.pageFormat)}${p.serpFormat ? `; the top results are mostly ${FORMAT_PLURAL[p.serpFormat] ?? "general pages"}` : ""} — ${p.intentMatch ? "match" : "mismatch"}`;
  const fixes = missed.map((p) => {
    const target: PageFormat = p.serpFormat ?? (INTENT_FORMATS[p.intent] ?? ["article"])[0];
    if (target === "homepage") return `Make your homepage the page for ${quoteQuery(p.query)}: say it in the homepage title and H1, and link to the homepage with those words`;
    return `Turn ${pathOf(p.url)} into ${FORMAT_ADVICE[target] ?? FORMAT_ADVICE.other} — people searching ${quoteQuery(p.query)} ${INTENT_WANTS[p.intent] ?? "want something specific"}${p.serpFormat ? ", and that is the format Google ranks for it" : ""}`;
  });
  return measured(id, {
    score: (100 * matched.length) / judged.length,
    good:
      judged.length === 1
        ? "The query we checked lands on the kind of page Google ranks for it"
        : matched.length === judged.length
          ? `All ${judged.length} queries we checked land on the kind of page Google ranks for them`
          : `${matched.length} of ${judged.length} queries land on the kind of page Google ranks for them`,
    bad: `${missed.length} of ${judged.length} ${judged.length === 1 ? "query lands" : "queries land"} on the wrong kind of page for what searchers want`,
    evidence: [...missed, ...matched].map(line),
    fixes,
  });
}

/** relevance.coverage(30)= min(100, 平均 coverage / 0.7 × 100);无 coverage → null */
export function scoreRelevanceCoverage(ctx: RankingContext): SubScore {
  const id = "relevance.coverage";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const withCov = ctx.pairs.filter((p) => typeof p.coverage === "number" && Number.isFinite(p.coverage));
  if (!withCov.length) {
    return notMeasured(id, "we could not compare your pages with enough top-ranking pages — we need at least 3 subtopics shared by 2 or more of them");
  }
  const avg = mean(withCov.map((p) => Math.min(1, Math.max(0, p.coverage as number))));
  const sorted = [...withCov].sort((a, b) => (a.coverage as number) - (b.coverage as number));
  return measured(id, {
    score: Math.min(100, (avg / 0.7) * 100),
    good: `Your pages cover ${pct01(avg)}% of the subtopics the top-ranking pages have in common`,
    bad: `Your pages cover only ${pct01(avg)}% of the subtopics the top-ranking pages have in common`,
    evidence: sorted.map((p) => {
      const missing = (p.missingTopics ?? []).slice(0, 3);
      return `${quoteQuery(p.query)} → ${pathOf(p.url)} covers ${pct01(p.coverage as number)}% of the shared subtopics${missing.length ? `; missing: ${missing.join(", ")}` : ""}`;
    }),
    fixes: sorted
      .filter((p) => (p.missingTopics ?? []).length > 0)
      .map((p) => `Add sections on ${(p.missingTopics ?? []).slice(0, 3).join(", ")} to ${pathOf(p.url)} — most of the top results for ${quoteQuery(p.query)} cover them`),
  });
}

type GainInputs = { uniqueTopics: number; extraNumbers: number; extraTables: number; ownImages: number; experienceMarkers: number };

/** 规格 §4 relevance.gain 的每对公式;withTopics=false 时去掉"独有子话题"项(没有竞品就无所谓独有),上限自然是 60 */
export function gainPoints(g: GainInputs, withTopics = true): number {
  const topics = withTopics ? Math.min(Math.max(0, num(g.uniqueTopics)), 5) * 8 : 0;
  const numbers = num(g.extraNumbers) >= 5 ? 20 : num(g.extraNumbers) >= 1 ? 10 : 0;
  const tables = num(g.extraTables) >= 1 ? 15 : 0;
  const images = num(g.ownImages) >= 2 ? 15 : num(g.ownImages) >= 1 ? 8 : 0;
  const exp = num(g.experienceMarkers) >= 2 ? 10 : 0;
  return Math.min(100, topics + numbers + tables + images + exp);
}

function findPage(pages: CrawledPage[], url: string): CrawledPage | null {
  const k = urlKey(url);
  return pages.find((p) => urlKey(p.url) === k || (!!p.finalUrl && urlKey(p.finalUrl) === k)) ?? null;
}

/**
 * relevance.gain(20):有竞品时每对按公式取平均;一个竞品都没抓到时只用本页信号估计(上限 60),
 * summary 写明"未与排名页对比"。只有部分对有竞品时只平均有竞品的对 —— 两种口径混着平均,
 * 会让"没做对比"的对把真实对比的结果往 60 拉。
 */
export function scoreRelevanceGain(ctx: RankingContext): SubScore {
  const id = "relevance.gain";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const compared = ctx.pairs.filter((p) => (p.competitors ?? []).some((c) => c.fetched));
  if (compared.length) {
    const rows = compared.map((p) => {
      const g = p.gainSignals ?? { uniqueTopics: 0, extraNumbers: 0, extraTables: 0, ownImages: 0, experienceMarkers: 0 };
      const u = num(g.uniqueTopics) || (p.uniqueTopics ?? []).length;
      return { p, g: { ...g, uniqueTopics: u }, pts: gainPoints({ ...g, uniqueTopics: u }) };
    });
    const avgU = mean(rows.map((r) => r.g.uniqueTopics));
    const weakest = [...rows].sort((a, b) => a.pts - b.pts)[0];
    const fixes: string[] = [];
    if (avgU < 2) fixes.push(`Add a section none of the top results have — your own test results, a real customer example, or a mistake you see buyers make (start with ${pathOf(weakest.p.url)})`);
    if (rows.some((r) => num(r.g.extraNumbers) < 5)) fixes.push("Add concrete numbers the others don't give: prices, timings, sample sizes, results you measured yourself");
    if (rows.some((r) => num(r.g.extraTables) < 1)) fixes.push("Add a summary or comparison table so readers can check the key facts at a glance");
    if (rows.some((r) => num(r.g.ownImages) < 2)) fixes.push("Replace stock photos with your own screenshots, charts or photos");
    if (rows.some((r) => num(r.g.experienceMarkers) < 2)) fixes.push("Say what you did yourself: what you tested, for how long, and what happened");
    return measured(id, {
      score: mean(rows.map((r) => r.pts)),
      good: "Your pages add things the top results don't have: unique subtopics, extra data or your own images",
      bad: "Your pages mostly repeat what already ranks — they add little the top results don't have",
      evidence: rows.map(({ p, g }) => {
        const n = (p.competitors ?? []).filter((c) => c.fetched).length;
        const topics = (p.uniqueTopics ?? []).slice(0, 2);
        const uniqueText = g.uniqueTopics > 0 ? `${plural(g.uniqueTopics, "subtopic")} none of them cover${topics.length ? ` (${topics.join(", ")})` : ""}` : "no subtopic the others lack";
        return `${pathOf(p.url)} vs the top ${n} for ${quoteQuery(p.query)}: ${uniqueText}, ${num(g.extraNumbers) >= 1 ? `+${plural(num(g.extraNumbers), "data point")}` : "no extra data points"}, ${num(g.extraTables) >= 1 ? `+${plural(num(g.extraTables), "table")}` : "no extra tables"}, ${plural(num(g.ownImages), "own image")}`;
      }),
      fixes,
    });
  }
  // 没有可比的竞品:只用本页信号估计(数据点 / 表格 / 自有图片 / 一手经验),"独有子话题"项不计 → 上限 60
  const rows = ctx.pairs.map((p) => {
    const page = findPage(ctx.input.pages ?? [], p.url);
    const c = page?.content;
    const g: GainInputs = c
      ? { uniqueTopics: 0, extraNumbers: num(c.numberCount), extraTables: num(c.tableCount), ownImages: num(c.imagesSelfHosted), experienceMarkers: num(c.experienceMarkers) }
      : {
          uniqueTopics: 0,
          extraNumbers: num(p.gainSignals?.extraNumbers),
          extraTables: num(p.gainSignals?.extraTables),
          ownImages: num(p.gainSignals?.ownImages),
          experienceMarkers: num(p.gainSignals?.experienceMarkers),
        };
    const signs = (g.extraNumbers >= 1 ? 1 : 0) + (g.extraTables >= 1 ? 1 : 0) + (g.ownImages >= 1 ? 1 : 0) + (g.experienceMarkers >= 2 ? 1 : 0);
    return { p, g, signs, pts: gainPoints(g, false) };
  });
  const avgSigns = Math.round(mean(rows.map((r) => r.signs)));
  const fixes: string[] = [];
  if (rows.some((r) => r.g.extraNumbers < 5)) fixes.push("Add concrete numbers: prices, timings, sample sizes, results you measured yourself");
  if (rows.some((r) => r.g.extraTables < 1)) fixes.push("Add a summary or comparison table so readers can check the key facts at a glance");
  if (rows.some((r) => r.g.ownImages < 2)) fixes.push("Replace stock photos with your own screenshots, charts or photos");
  if (rows.some((r) => r.g.experienceMarkers < 2)) fixes.push("Say what you did yourself: what you tested, for how long, and what happened");
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: `Your pages show ${avgSigns} of 4 signs of original value (estimated — not compared with ranking pages)`,
    bad: `Your pages show ${avgSigns} of 4 signs of original value — estimated from your pages alone, not compared with ranking pages, so capped at 60`,
    evidence: [
      "Not compared with ranking pages: no competitor page could be fetched, so unique subtopics could not be counted",
      ...rows.map(
        ({ p, g }) =>
          `${pathOf(p.url)} (for ${quoteQuery(p.query)}): ${plural(g.extraNumbers, "data point")}, ${plural(g.extraTables, "table")}, ${plural(g.ownImages, "own image")}, ${plural(g.experienceMarkers, "first-hand mention")}`,
      ),
    ],
    fixes,
  });
}

/** 规格 §4 relevance.alignment 的每对公式:40 × 标题对齐 + 30 × H1 对齐 + 30 × 答案前置 */
export function alignmentPoints(p: Pick<RelevancePair, "titleAlignment" | "h1Alignment" | "answerEarly">): number {
  const t = Math.min(1, Math.max(0, num(p.titleAlignment)));
  const h = Math.min(1, Math.max(0, num(p.h1Alignment)));
  return 40 * t + 30 * h + (p.answerEarly ? 30 : 0);
}

/** relevance.alignment(20):每对 40 × titleAlignment + 30 × h1Alignment + 30 × answerEarly,取平均 */
export function scoreRelevanceAlignment(ctx: RankingContext): SubScore {
  const id = "relevance.alignment";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const rows = ctx.pairs.map((p) => ({ p, pts: alignmentPoints(p) })).sort((a, b) => a.pts - b.pts);
  const fixes: string[] = [];
  for (const { p } of rows) {
    if (num(p.titleAlignment) < 1 || num(p.h1Alignment) < 1) fixes.push(`Use the words ${quoteQuery(p.query)} in the title and H1 of ${pathOf(p.url)}`);
    if (!p.answerEarly) fixes.push(`Answer ${quoteQuery(p.query)} in the first two sentences of ${pathOf(p.url)}, before any background`);
  }
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: "Titles and H1s use the words people search for, and pages answer early",
    bad: "Titles, H1s or opening lines don't use the words people search for",
    evidence: rows.map(
      ({ p }) =>
        `${quoteQuery(p.query)} → ${pathOf(p.url)}: title covers ${pct01(Math.min(1, num(p.titleAlignment)))}% of the query's key words, H1 ${pct01(Math.min(1, num(p.h1Alignment)))}%, answered in the first 150 words: ${p.answerEarly ? "yes" : "no"}`,
    ),
    fixes,
  });
}

/* ============================================================
   内容质量 E-E-A-T(25)
   ============================================================ */

/** 规格 §4 quality.experience 的每页公式:min(经验词, 3)/3 × 70 + (自有图片 ≥1 ? 30 : 0) */
export function experiencePoints(c: PageContentSignals): number {
  return (Math.min(num(c.experienceMarkers), 3) / 3) * 70 + (num(c.imagesSelfHosted) >= 1 ? 30 : 0);
}

/** quality.experience(25):内容页平均;无内容页 → null */
export function scoreQualityExperience(ctx: RankingContext): SubScore {
  const id = "quality.experience";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const withExp = pages.filter((p) => num(contentOf(p).experienceMarkers) >= 1);
  const withOwn = pages.filter((p) => num(contentOf(p).imagesSelfHosted) >= 1);
  const stockOnly = pages.filter((p) => num(contentOf(p).imagesSelfHosted) === 0 && num(contentOf(p).imagesStock) > 0);
  const empty = pages.filter((p) => experiencePoints(contentOf(p)) === 0);
  const ranked = [...pages].sort((a, b) => experiencePoints(contentOf(a)) - experiencePoints(contentOf(b)));
  const evidence = [
    `First-person testing language found on ${withExp.length} of ${n} content pages${withExp.length ? ` (${paths(withExp.map((p) => p.url))})` : ""}`,
    `Your own images (screenshots or photos hosted on your site) on ${withOwn.length} of ${n} content pages${stockOnly.length ? `; ${stockOnly.length} use only stock photos (${paths(stockOnly.map((p) => p.url), 2)})` : ""}`,
  ];
  if (empty.length) evidence.push(`No first-hand language and no own images: ${paths(empty.map((p) => p.url))}`);
  const fixes = [`Add what you actually did: the setup you tested, the numbers you saw, a screenshot from your own account — start with ${paths(ranked.map((p) => p.url), 2)}`];
  if (stockOnly.length) fixes.push(`Replace stock photos with your own screenshots or photos on ${paths(stockOnly.map((p) => p.url), 2)}`);
  fixes.push('Add a short "How we tested" note to reviews and guides: what you tried, for how long, and what changed');
  return measured(id, {
    score: mean(pages.map((p) => experiencePoints(contentOf(p)))),
    good: withExp.length === n ? `All ${n} content pages show first-hand experience` : `${withExp.length} of ${n} content pages show first-hand experience`,
    bad: withExp.length === 0 ? `None of your ${n} content pages show first-hand experience` : `Only ${withExp.length} of ${n} content pages show first-hand experience`,
    evidence,
    fixes,
  });
}

function authoritativePer1k(c: PageContentSignals): number {
  return num(c.mainWords) > 0 ? (num(c.authoritativeOutlinks) / num(c.mainWords)) * 1000 : 0;
}

/** 规格 §4 quality.data 的每页公式:原始数据 40 + 表格 20 + 每千词权威外链(≥2→40,≥1→25,>0→10) */
export function dataPoints(c: PageContentSignals): number {
  const per1k = authoritativePer1k(c);
  const sources = per1k >= 2 ? 40 : per1k >= 1 ? 25 : per1k > 0 ? 10 : 0;
  return (Math.min(num(c.originalDataMarkers), 2) / 2) * 40 + (num(c.tableCount) >= 1 ? 20 : 0) + sources;
}

/** quality.data(20):内容页平均 */
export function scoreQualityData(ctx: RankingContext): SubScore {
  const id = "quality.data";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const withData = pages.filter((p) => num(contentOf(p).originalDataMarkers) >= 1);
  const withTable = pages.filter((p) => num(contentOf(p).tableCount) >= 1);
  const noSources = pages.filter((p) => num(contentOf(p).authoritativeOutlinks) === 0);
  const avgPer1k = mean(pages.map((p) => authoritativePer1k(contentOf(p))));
  const fixes: string[] = [];
  if (noSources.length) fixes.push(`Link the primary source for each key claim — official docs, the study, the government page; ${noSources.length} of ${n} pages have no such link (${paths(noSources.map((p) => p.url), 2)})`);
  if (withData.length < n / 2) fixes.push("Publish one piece of original data — a small survey, a benchmark, numbers from your own product — and cite it across related pages");
  if (withTable.length < n / 2) fixes.push("Put key numbers and comparisons in a table so readers can check them at a glance");
  return measured(id, {
    score: mean(pages.map((p) => dataPoints(contentOf(p)))),
    good: "Your content pages back their claims with original data and sources readers can check",
    bad:
      withData.length === 0 && noSources.length === n
        ? "Your content pages make claims without original data or sources readers can check"
        : "Few of your content pages back their claims with original data or sources readers can check",
    evidence: [
      `Original-data language ("our survey", "we analyzed 1,200 …", "methodology") on ${withData.length} of ${n} content pages${withData.length ? ` (${paths(withData.map((p) => p.url))})` : ""}`,
      `Tables on ${withTable.length} of ${n} content pages`,
      `Links to authoritative sources (.gov, .edu, official docs, research, major news): ${fmt1(avgPer1k)} per 1,000 words on average; ${noSources.length ? `${noSources.length} of ${n} pages have none (${paths(noSources.map((p) => p.url))})` : "every content page cites at least one"}`,
    ],
    fixes,
  });
}

/**
 * YMYL 页(健康 / 金融 / 法律):规格只给了词表,没给"页"的门槛。偶尔提一句 tax / invest 的 SaaS 文章
 * 不该被当成理财内容,所以要求 ≥3 次命中且密度 ≥ 2 次 / 千词 —— 真正讲这类话题的页远超这个数。
 */
export function isYmylPage(c: PageContentSignals): boolean {
  const hits = num(c.ymylHits);
  return hits >= 3 && num(c.mainWords) > 0 && (hits / num(c.mainWords)) * 1000 >= 2;
}

/** 只认"路径以它结尾"的页:/company/careers、/support/how-to-x 这类深层页不是 About / Contact 页 */
const ABOUT_PATH = /\/(about|about-us|company|our-story|who-we-are|team|our-team)\/?$/i;
const CONTACT_PATH = /\/(contact|contact-us|get-in-touch|reach-us)\/?$/i;
const SUPPORT_PATH = /\/(support|help)\/?$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const PHONE_RE = /\+?\(?\d[\d\s().-]{7,18}\d/g;
const ADDRESS_RE = /\b\d{1,5}\s+(?:[A-Za-z][A-Za-z.'-]*\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|square|sq|suite|floor)\b|\b[A-Z]{2}\s\d{5}(?:-\d{4})?\b/i;

/** 文本里像电话的串:9–15 位数字,且不是 2024-10-01 这类日期 */
function hasPhone(text: string): boolean {
  for (const m of Array.from(text.matchAll(PHONE_RE))) {
    const s = m[0];
    if (/^\d{4}-\d{2}-\d{2}/.test(s.trim())) continue;
    const digits = s.replace(/\D/g, "").length;
    if (digits >= 9 && digits <= 15) return true;
  }
  return false;
}

/** About 页:抓到的页或站内链接里有 /about 一类路径(与 sec.trust-pages 同口径:链接到了也算) */
function aboutPage(ctx: RankingContext): { url: string; crawled: boolean } | null {
  const crawled = ctx.readable.find((p) => ABOUT_PATH.test(pathOf(p.url).split("?")[0]));
  if (crawled) return { url: crawled.url, crawled: true };
  for (const p of ctx.readable) for (const l of p.links ?? []) if (ABOUT_PATH.test(pathOf(l).split("?")[0])) return { url: l, crawled: false };
  return null;
}

/**
 * Contact 页上的邮箱 / 电话 / 地址。首选 content.contactDetails(解析时对整页判好,含页脚的 mailto: / tel: /
 * PostalAddress);旧数据没有它时退回读片段:textSample(正文前 400 字符)、首段、正文前 150 词、
 * meta description,外加 JSON-LD 里的 ContactPoint / PostalAddress 类型。页面上只有表单、没有任何联系方式时判为缺失。
 */
function contactInfo(ctx: RankingContext): { page: string | null; linkedOnly: boolean; found: string[] } {
  const bare = (u: string) => pathOf(u).split("?")[0];
  // 先找真正的 Contact 页,没有再退到 /support、/help 首页(很多 SaaS 把联系方式放在那里)
  const page = ctx.readable.find((p) => CONTACT_PATH.test(bare(p.url))) ?? ctx.readable.find((p) => SUPPORT_PATH.test(bare(p.url))) ?? null;
  if (!page) {
    let linked: string | null = null;
    for (const p of ctx.readable) {
      linked = (p.links ?? []).find((l) => CONTACT_PATH.test(bare(l))) ?? null;
      if (linked) break;
    }
    return { page: linked, linkedOnly: !!linked, found: [] };
  }
  const text = [page.textSample, page.content?.firstParagraph, page.content?.leadText, page.description].filter(Boolean).join(" \n ");
  const types = (page.jsonLdTypes ?? []).map((t) => t.toLowerCase());
  // 解析时整页(含页脚的 mailto: / tel: / PostalAddress)判好的联系方式优先;旧数据没有这个字段,退回读片段
  const details = page.content?.contactDetails;
  const found: string[] = [];
  if (details?.email || EMAIL_RE.test(text)) found.push("email");
  if (details?.phone || hasPhone(text)) found.push("phone");
  if (details?.address || ADDRESS_RE.test(text) || types.includes("postaladdress")) found.push("address");
  if (!found.length && types.includes("contactpoint")) found.push("contact details in structured data");
  return { page: page.url, linkedOnly: false, found };
}

/** quality.authorship(20)站点级:40 署名 + 15 作者 schema + 15 About + 15 带联系方式的 Contact + 15 sameAs≥2;YMYL ≥20% 且署名 <80% 再扣 15 */
export function scoreQualityAuthorship(ctx: RankingContext): SubScore {
  const id = "quality.authorship";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const byline = pages.filter((p) => contentOf(p).byline === true);
  const noByline = pages.filter((p) => contentOf(p).byline !== true);
  const schema = pages.filter((p) => contentOf(p).authorInSchema === true);
  const bylineShare = byline.length / n;
  const schemaShare = schema.length / n;
  const about = aboutPage(ctx);
  const contact = contactInfo(ctx);
  const contactOk = !!contact.page && !contact.linkedOnly && contact.found.length > 0;
  const maxSameAs = Math.max(0, ...ctx.signalPages.map((p) => num(contentOf(p).sameAsCount)));
  const sameAsOk = maxSameAs >= 2;
  const ymyl = pages.filter((p) => isYmylPage(contentOf(p)));
  const ymylShare = ymyl.length / n;
  const ymylPenalty = ymylShare >= 0.2 && bylineShare < 0.8;
  const raw = 40 * bylineShare + 15 * schemaShare + (about ? 15 : 0) + (contactOk ? 15 : 0) + (sameAsOk ? 15 : 0) - (ymylPenalty ? 15 : 0);
  const ymylClause = ymylPenalty ? " — and health, finance and legal topics are held to a stricter standard, so missing bylines cost extra" : "";
  const contactText = contactOk
    ? `found (${pathOf(contact.page as string)}, with ${contact.found.join(", ")})`
    : contact.page
      ? contact.linkedOnly
        ? `linked (${pathOf(contact.page)}) but not crawled, so its contact details could not be checked`
        : `found (${pathOf(contact.page)}) but no email, phone or address detected`
      : "not found";
  const evidence = [
    `Author byline on ${byline.length} of ${n} content pages; author named in structured data on ${schema.length} of ${n}`,
    `About page: ${about ? `${about.crawled ? "found" : "linked"} (${pathOf(about.url)})` : "not found"}; contact page with email, phone or address: ${contactText}`,
    `Organization schema lists ${plural(maxSameAs, "official profile link")} (sameAs) — 2 or more lets Google confirm who you are`,
  ];
  if (ymylShare >= 0.2) evidence.push(`${ymyl.length} of ${n} content pages (${pct01(ymylShare)}%) cover health, money or legal topics (e.g. ${paths(ymyl.map((p) => p.url), 2)}) — Google expects named, qualified authors there`);
  const fixes: string[] = [];
  if (noByline.length) fixes.push(`Add a visible author byline that links to an author page on every article — missing on ${paths(noByline.map((p) => p.url))}`);
  if (!about) fixes.push("Publish an About page that says who runs the company and why you're qualified, and link it in the footer");
  if (!contactOk) fixes.push(contact.page && !contact.linkedOnly ? `Show an email address, phone number or postal address on ${pathOf(contact.page)}, not just a form` : "Publish a Contact page with an email address, phone number or postal address, and link it in the footer");
  if (!sameAsOk) fixes.push("Add sameAs links to your official profiles (LinkedIn, X, Crunchbase, GitHub) in your Organization schema");
  if (schemaShare < 1) fixes.push("Add the author (name and profile URL) to each article's Article schema");
  return measured(id, {
    score: raw,
    good: `Readers can see who writes your content and who runs the site${ymylClause}`,
    bad: `Readers can't easily see who writes your content or who runs the site${ymylClause}`,
    evidence,
    fixes,
  });
}

function datesOf(c: PageContentSignals): Date[] {
  return [parseDate(c.dateModified), parseDate(c.datePublished)].filter((d): d is Date => d !== null);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** quality.freshness(15):60 × 近 365 天有日期的占比 + 20 × 有任何日期的占比 + 20 × (1 − 标题年份过期占比) */
export function scoreQualityFreshness(ctx: RankingContext): SubScore {
  const id = "quality.freshness";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const nowMs = ctx.now.getTime();
  // 未来日期允许 2 天时钟误差;更远的未来日期是坏数据,不算"最近更新"
  const isRecent = (d: Date) => d.getTime() <= nowMs + 2 * DAY_MS && nowMs - d.getTime() <= 365 * DAY_MS;
  const recent = pages.filter((p) => datesOf(contentOf(p)).some(isRecent));
  const dated = pages.filter((p) => datesOf(contentOf(p)).length > 0);
  const undated = pages.filter((p) => datesOf(contentOf(p)).length === 0);
  const year = ctx.now.getUTCFullYear();
  const staleTitle = pages.filter((p) => {
    const y = contentOf(p).titleYear;
    return typeof y === "number" && y < year - 1;
  });
  const oldest = dated
    .filter((p) => !recent.includes(p))
    .map((p) => ({ p, d: datesOf(contentOf(p)).reduce((a, b) => (a.getTime() >= b.getTime() ? a : b)) }))
    .sort((a, b) => a.d.getTime() - b.d.getTime() || a.p.url.localeCompare(b.p.url));
  const evidence = [
    `Published or updated in the last 365 days: ${recent.length} of ${n} content pages`,
    undated.length
      ? `No machine-readable date (datePublished / dateModified): ${undated.length} of ${n} pages (${paths(undated.map((p) => p.url))})`
      : "Every content page has a machine-readable publish or update date",
  ];
  if (staleTitle.length) evidence.push(`Outdated year in the title: ${staleTitle.slice(0, 3).map((p) => `${pathOf(p.url)} (${contentOf(p).titleYear})`).join(", ")}${staleTitle.length > 3 ? ` (+${staleTitle.length - 3} more)` : ""}`);
  if (oldest.length) evidence.push(`Oldest last update: ${pathOf(oldest[0].p.url)} (${isoDay(oldest[0].d)})`);
  const fixes: string[] = [];
  if (recent.length < n) fixes.push(`Review and update your most important pages first — refresh facts, prices and screenshots, then update dateModified${oldest.length ? ` (oldest: ${paths(oldest.map((o) => o.p.url), 2)})` : ""}`);
  if (undated.length) fixes.push(`Add datePublished and dateModified to every article (Article schema or article:modified_time) — ${undated.length} of ${n} pages have neither`);
  if (staleTitle.length) fixes.push(`Refresh ${paths(staleTitle.map((p) => p.url), 2)} and only then update the year in the title — an old year tells searchers the page is stale`);
  return measured(id, {
    score: 60 * ratio(recent.length, n) + 20 * ratio(dated.length, n) + 20 * (1 - ratio(staleTitle.length, n)),
    good: `${recent.length} of ${n} content pages were published or updated in the last 12 months`,
    bad:
      recent.length === 0
        ? dated.length === 0
          ? `None of your ${n} content pages show a publish or update date`
          : `None of your ${n} content pages show an update in the last 12 months`
        : `Only ${recent.length} of ${n} content pages show an update in the last 12 months`,
    evidence,
    fixes,
  });
}

/** 内容页之间的近重复(minhash ≥ 0.8):返回涉及的页与簇 */
function nearDuplicates(pages: CrawledPage[]): { urls: string[]; groups: string[][] } {
  const hashed = pages.filter((p) => Array.isArray(p.minhash) && p.minhash.length > 0);
  const pairs: [number, number][] = [];
  for (let i = 0; i < hashed.length; i += 1) {
    for (let j = i + 1; j < hashed.length; j += 1) {
      const s = minhashSimilarity(hashed[i].minhash, hashed[j].minhash);
      if (s !== null && s >= NEAR_DUP_SIM) pairs.push([i, j]);
    }
  }
  const groups = clusters(hashed.length, pairs).map((g) => g.map((i) => hashed[i].url));
  return { urls: groups.flat(), groups };
}

/** 同一天发布最多的那一天(并列取较早的日期,保证确定性) */
function publishBurst(pages: CrawledPage[]): { day: string; count: number } | null {
  const days = new Map<string, number>();
  for (const p of pages) {
    const d = parseDate(contentOf(p).datePublished);
    if (d) days.set(isoDay(d), (days.get(isoDay(d)) ?? 0) + 1);
  }
  let best: { day: string; count: number } | null = null;
  for (const day of Array.from(days.keys()).sort()) {
    const count = days.get(day) ?? 0;
    if (!best || count > best.count) best = { day, count };
  }
  return best;
}

/**
 * quality.scaled(20,分高 = 风险低):从 100 扣 —— 近重复占比 × 40;AI 套话每千词 ≥3 → −25、≥1.5 → −12;
 * ≥10 个内容页且 ≥40% 同一天发布 → −20;薄内容占比 × 20;≥80% 内容页零一手经验 → −10;下限 0。
 * 薄内容的分母是"内容类型页"(内容页本身按定义都 ≥300 词,拿它做分母永远是 0)。
 */
export function scoreQualityScaled(ctx: RankingContext): SubScore {
  const id = "quality.scaled";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const dup = nearDuplicates(pages);
  const dupShare = dup.urls.length / n;
  const aiHits = pages.reduce((s, p) => s + num(contentOf(p).aiPhraseHits), 0);
  const words = pages.reduce((s, p) => s + num(contentOf(p).mainWords), 0);
  const aiRate = words > 0 ? (aiHits / words) * 1000 : 0;
  const aiPenalty = aiRate >= 3 ? 25 : aiRate >= 1.5 ? 12 : 0;
  const burst = publishBurst(pages);
  const burstHit = n >= 10 && !!burst && burst.count / n >= 0.4;
  const thin = ctx.typedPages.filter((p) => num(contentOf(p).mainWords) < CONTENT_MIN_WORDS);
  const thinShare = ratio(thin.length, ctx.typedPages.length);
  const zeroExp = pages.filter((p) => num(contentOf(p).experienceMarkers) === 0);
  const zeroExpHit = zeroExp.length / n >= 0.8;
  const score = 100 - dupShare * 40 - aiPenalty - (burstHit ? 20 : 0) - thinShare * 20 - (zeroExpHit ? 10 : 0);
  const aiTop = [...pages]
    .filter((p) => num(contentOf(p).aiPhraseHits) > 0)
    .sort((a, b) => num(contentOf(b).aiPhraseHits) - num(contentOf(a).aiPhraseHits) || a.url.localeCompare(b.url));

  // 证据按扣分多少排序:读者先看到最要紧的那条
  const lines: { cost: number; text: string }[] = [
    {
      cost: dupShare * 40 + 0.01,
      text: `Near-duplicate content pages (text over 80% identical): ${dup.urls.length} of ${n}${dup.groups.length ? ` — e.g. ${paths(dup.groups[0], 3)}` : ""}`,
    },
    {
      cost: aiPenalty + 0.005,
      text: `Stock AI phrases ("delve", "in today's fast-paced world", "unlock the power"): ${fmt1(aiRate)} per 1,000 words${aiTop.length ? ` — most on ${paths(aiTop.map((p) => p.url), 2)}` : ""}`,
    },
  ];
  // 两三页同一天发布很正常,只有触发扣分或已经成片(≥3 页且 ≥25%)时才值得读者看
  if (burst && (burstHit || (burst.count >= 3 && burst.count / n >= 0.25))) {
    lines.push({ cost: burstHit ? 20 : 0, text: `${burst.count} of ${n} content pages (${pctOf(burst.count, n)}%) share the same publish date (${burst.day})` });
  }
  if (thin.length) lines.push({ cost: thinShare * 20, text: `Thin pages (under ${CONTENT_MIN_WORDS} words of main text): ${thin.length} of ${ctx.typedPages.length} (${paths(thin.map((p) => p.url))})` });
  if (zeroExp.length) lines.push({ cost: zeroExpHit ? 10 : 0, text: `No first-hand experience on ${zeroExp.length} of ${n} content pages (${pctOf(zeroExp.length, n)}%)` });
  lines.sort((a, b) => b.cost - a.cost);

  const fixes: string[] = [];
  if (dup.urls.length) fixes.push(`Merge near-duplicate pages into one stronger page and 301-redirect the rest (${paths(dup.groups[0] ?? dup.urls, 2)})`);
  if (aiPenalty) fixes.push("Edit out stock AI phrases and replace them with specifics only you know: numbers, examples, opinions");
  if (burstHit) fixes.push("Stop publishing in batches of look-alike pages; give each new page something only you can add before it goes live");
  if (thin.length) fixes.push(`Expand or merge thin pages — ${paths(thin.map((p) => p.url), 2)} have under ${CONTENT_MIN_WORDS} words`);
  if (zeroExpHit) fixes.push("Add first-hand detail (what you tried, what happened) so pages don't read like generic rewrites");
  return measured(id, {
    score,
    good: "Low risk of looking mass-produced: few duplicates, little AI boilerplate, no thin page batches",
    bad: "Parts of your content look mass-produced — the pattern Google's scaled-content spam policy targets",
    evidence: lines.map((l) => l.text),
    fixes,
  });
}

/* ============================================================
   权威与外链(25)
   ============================================================ */

const BODY_LOCATIONS = ["article", "main", "section"];
const CHROME_LOCATIONS = ["header", "footer", "aside", "nav"];
const GOOD_PLATFORMS = ["blogs", "news", "cms"];

function sumKeys(rec: Record<string, number> | undefined, keys: string[]): number {
  return keys.reduce((s, k) => s + num(rec?.[k]), 0);
}

function sumKnown(rec: Record<string, number> | undefined, unknown: string[]): number {
  return Object.keys(rec ?? {})
    .filter((k) => !unknown.includes(k))
    .reduce((s, k) => s + num(rec?.[k]), 0);
}

/**
 * authority.editorial(30):min(60, 正文位置占比 / 0.6 × 60) + min(40, 优质平台占比 / 0.6 × 40)。
 * 没有外链 → 0;authority 为 null / noData → null。DataForSEO 只回了其中一项分布时,
 * 用那一项按满分重新归一(与规格"缺项重新归一"同一原则),并在证据里写明。
 */
export function scoreAuthorityEditorial(ctx: RankingContext): SubScore {
  const id = "authority.editorial";
  const a = ctx.input.authority;
  const gap = authorityGap(a);
  if (gap || !a) return notMeasured(id, gap ?? "backlink data was not available for this report");
  if (num(a.backlinks) === 0 && num(a.referringDomains) === 0) {
    return measured(id, {
      score: 0,
      good: "",
      bad: "No backlinks found yet, so no editorial links either",
      evidence: ["0 backlinks and 0 referring domains in DataForSEO's index"],
      fixes: ["Earn your first editorial links: offer data, quotes or a free tool to writers who cover your topic", "Get listed on partner, integration and customer pages that link to you from their content"],
    });
  }
  const locs = a.semanticLocations;
  const plats = a.platformTypes;
  const knownLoc = sumKnown(locs, ["", "unknown"]);
  const bodyLoc = sumKeys(locs, BODY_LOCATIONS);
  const chromeLoc = sumKeys(locs, CHROME_LOCATIONS);
  const knownPlat = sumKnown(plats, ["", "unknown"]);
  const goodPlat = sumKeys(plats, GOOD_PLATFORMS);
  const locShare = knownLoc > 0 ? bodyLoc / knownLoc : null;
  const platShare = knownPlat > 0 ? goodPlat / knownPlat : null;
  if (locShare === null && platShare === null) return notMeasured(id, "DataForSEO did not report where your links sit on the page or what kind of sites they come from");
  const locPts = locShare === null ? 0 : Math.min(60, (locShare / 0.6) * 60);
  const platPts = platShare === null ? 0 : Math.min(40, (platShare / 0.6) * 40);
  const score = locShare !== null && platShare !== null ? locPts + platPts : locShare !== null ? (locPts / 60) * 100 : (platPts / 40) * 100;
  const topPlats = Object.entries(plats ?? {})
    .filter(([k, v]) => k && k !== "unknown" && num(v) > 0)
    .sort((x, y) => num(y[1]) - num(x[1]) || x[0].localeCompare(y[0]))
    .slice(0, 3)
    .map(([k, v]) => `${k} ${pctOf(num(v), knownPlat)}%`);
  const evidence = [
    locShare !== null
      ? `Link placement: ${pct01(locShare)}% inside article or main content, ${pctOf(chromeLoc, knownLoc)}% in headers, footers, sidebars or menus (${fmtInt(knownLoc)} links with a known position)`
      : "Link placement not reported by DataForSEO — scored on the type of linking sites only",
    platShare !== null
      ? `Linking sites: ${pct01(platShare)}% are blogs, news or publishing platforms${topPlats.length ? ` (top types: ${topPlats.join(", ")})` : ""}`
      : "Type of linking sites not reported by DataForSEO — scored on link placement only",
    `${fmtInt(num(a.referringDomains))} referring domains and ${fmtInt(num(a.backlinks))} backlinks in total`,
  ];
  const locWeak = locShare !== null && locShare < 0.6;
  const platWeak = platShare !== null && platShare < 0.6;
  const fixes: string[] = [];
  if (locWeak) fixes.push("Earn links inside articles: offer data, quotes or a useful tool to writers covering your topic — in-text links count far more than footer or directory links");
  if (platWeak) fixes.push("Pitch blogs, newsletters and trade publications your buyers read; skip directories and link exchanges");
  fixes.push("Turn unlinked mentions of your brand into links by asking the author to add one");
  return measured(id, {
    score,
    good: `${locShare !== null ? `${pct01(locShare)}% of your links sit inside page content` : `${pct01(platShare as number)}% of your links come from blogs, news or publishing sites`} — the kind of links Google weighs most`,
    // <70 时必有一项偏弱:位置偏弱优先说位置(它占 60 分),否则就是平台类型偏弱
    bad: locWeak
      ? "Most of your backlinks sit in footers, sidebars or directories rather than inside articles"
      : "Few of your backlinks come from blogs, news sites or publications — the kind Google weighs most",
    evidence,
    fixes,
  });
}

/** authority.breadth(25)= authority.score(与外链模块同一个数);null / noData → null */
export function scoreAuthorityBreadth(ctx: RankingContext): SubScore {
  const id = "authority.breadth";
  const a = ctx.input.authority;
  const gap = authorityGap(a);
  if (gap || !a) return notMeasured(id, gap ?? "backlink data was not available for this report");
  const rd = num(a.referringDomains);
  const rank = typeof a.rank === "number" && Number.isFinite(a.rank) ? a.rank : null;
  const evidence = [
    `${fmtInt(rd)} referring domains and ${fmtInt(num(a.backlinks))} backlinks (${pct01(Math.min(1, num(a.nofollowShare)))}% nofollow)`,
  ];
  if (rank !== null) evidence.push(`DataForSEO Domain Rank ${fmtInt(rank)} on a 0–1,000 scale`);
  if (typeof a.spamScore === "number") evidence.push(`Spam score ${fmtInt(a.spamScore)}/100${a.spamScore > 30 ? " — high, which lowers this score" : ""}`);
  const ts = a.timeseries ?? [];
  if (ts.length) {
    const gained = ts.reduce((s, t) => s + num(t.newReferringDomains), 0);
    const lost = ts.reduce((s, t) => s + num(t.lostReferringDomains), 0);
    evidence.push(`Last 90 days: ${fmtInt(gained)} new vs ${fmtInt(lost)} lost referring domains`);
  }
  if (num(a.brokenBacklinks) > 0) evidence.push(`${fmtInt(num(a.brokenBacklinks))} backlinks point to pages on your site that no longer exist`);
  const fixes: string[] = [];
  if (num(a.brokenBacklinks) > 0) fixes.push(`Recover ${fmtInt(num(a.brokenBacklinks))} broken backlinks by 301-redirecting the dead URLs they point to`);
  fixes.push("Publish one asset worth linking to — original data, a free tool or a template — and pitch it to sites your buyers read");
  fixes.push("Get listed where buyers compare options: \"best X\" roundups, partner pages, podcasts and integration directories");
  if (typeof a.spamScore === "number" && a.spamScore > 30) fixes.push("Review the spammiest linking domains and disavow the ones you didn't ask for");
  return measured(id, {
    score: num(a.score),
    good: `${num(a.score) >= 85 ? "Strong" : "Solid"} link profile: ${fmtInt(rd)} referring domains${rank !== null ? ` and a Domain Rank of ${fmtInt(rank)}` : ""}`,
    bad: rd < 10 ? `Very few sites link to you: ${plural(rd, "referring domain")}` : `Your link authority trails stronger sites: ${fmtInt(rd)} referring domains${rank !== null ? `, Domain Rank ${fmtInt(rank)}` : ""}`,
    evidence,
    fixes,
  });
}

function linkKeySets(pages: CrawledPage[]): Set<string>[] {
  return pages.map((p) => new Set((p.links ?? []).map((l) => urlKey(l))));
}

/**
 * 主题簇:≥3 个内容页共享同一个主题词(标题去品牌后缀 + H1,去停用词与品牌词),
 * 且在这些页之间沿站内链接(任一方向)连通。按词分组再找连通块 —— 这样一个簇里的页
 * 一定讨论同一个主题,不会因为 A-B 共享"seo"、B-C 共享"audit"就被串成一串。
 */
export function findTopicClusters(pages: CrawledPage[], brandWords: ReadonlySet<string> = new Set()): { token: string; urls: string[] }[] {
  const keyIndex = new Map<string, number>();
  pages.forEach((p, i) => {
    keyIndex.set(urlKey(p.url), i);
    if (p.finalUrl) keyIndex.set(urlKey(p.finalUrl), i);
  });
  const adj: Set<number>[] = pages.map(() => new Set<number>());
  pages.forEach((p, i) => {
    for (const l of p.links ?? []) {
      const j = keyIndex.get(urlKey(l));
      if (j !== undefined && j !== i) {
        adj[i].add(j);
        adj[j].add(i);
      }
    }
  });
  const byToken = new Map<string, number[]>();
  pages.forEach((p, i) => {
    const toks = topicTokens(`${titleCore(p)} ${(p.h1s ?? []).join(" ")}`, brandWords);
    for (const t of Array.from(toks)) byToken.set(t, [...(byToken.get(t) ?? []), i]);
  });
  const out: { token: string; urls: string[] }[] = [];
  for (const token of Array.from(byToken.keys()).sort()) {
    const members = byToken.get(token) ?? [];
    if (members.length < 3) continue;
    const inGroup = new Set(members);
    const seen = new Set<number>();
    for (const start of members) {
      if (seen.has(start)) continue;
      const comp: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const x = stack.pop() as number;
        comp.push(x);
        for (const y of Array.from(adj[x])) {
          if (inGroup.has(y) && !seen.has(y)) {
            seen.add(y);
            stack.push(y);
          }
        }
      }
      if (comp.length >= 3) out.push({ token, urls: comp.sort((a, b) => a - b).map((i) => pages[i].url) });
    }
  }
  return out;
}

/** authority.clusters(15)= min(100, 落在簇里的内容页占比 / 0.6 × 100);内容页 <5 → null */
export function scoreAuthorityClusters(ctx: RankingContext): SubScore {
  const id = "authority.clusters";
  const pages = ctx.contentPages;
  if (pages.length < 5) {
    return notMeasured(
      id,
      pages.length ? `fewer than 5 content pages (found ${pages.length}), too few to form topic clusters` : contentGap(ctx),
      { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] },
    );
  }
  const n = pages.length;
  const found = findTopicClusters(pages, ctx.brand.words);
  const clustered = new Set(found.flatMap((c) => c.urls));
  const standalone = pages.filter((p) => !clustered.has(p.url));
  const s = clustered.size / n;
  // 证据里同一组页只列一次(它们可能同时共享好几个主题词),大簇优先
  const shown: { token: string; urls: string[] }[] = [];
  for (const c of [...found].sort((a, b) => b.urls.length - a.urls.length || a.token.localeCompare(b.token))) {
    const sig = c.urls.join("|");
    if (shown.some((x) => x.urls.join("|") === sig)) continue;
    shown.push(c);
    if (shown.length === 3) break;
  }
  const evidence = shown.map((c) => `Cluster "${c.token}": ${c.urls.length} linked pages (${paths(c.urls)})`);
  evidence.push(`Standalone content pages (no linked pages on the same topic): ${standalone.length} of ${n}${standalone.length ? ` (${paths(standalone.map((p) => p.url))})` : ""}`);
  return measured(id, {
    score: Math.min(100, (s / 0.6) * 100),
    good: `${pct01(s)}% of your content pages sit in topic clusters that link to each other`,
    bad: clustered.size === 0 ? "None of your content pages form a topic cluster — each one stands alone" : `Only ${pct01(s)}% of your content pages belong to a topic cluster — most stand alone`,
    evidence,
    fixes: [
      `Give each main topic a hub page that links to 3+ related articles, and have those articles link back — start with ${paths(standalone.map((p) => p.url), 2)}`,
      'Add a "Related reading" block at the end of each article linking to 2–3 pages on the same topic',
      "Use the topic's main word in the title of every page in the cluster so the grouping is obvious to readers and Google",
    ],
  });
}

interface CorePage {
  page: CrawledPage;
  role: string;
}

/** 核心页 = 首页 + pricing / product 页 + 排名词对应 URL(在抓取集合里的) */
function corePages(ctx: RankingContext): CorePage[] {
  const out = new Map<string, CorePage>();
  const add = (page: CrawledPage, role: string) => {
    const k = urlKey(page.url);
    if (!out.has(k)) out.set(k, { page, role });
  };
  const entry = ctx.input.probe?.entryUrl ? findPage(ctx.readable, ctx.input.probe.entryUrl) : null;
  const home = entry ?? ctx.readable.find((p) => pageTypeOf(p) === "home") ?? null;
  if (home) add(home, "homepage");
  for (const p of ctx.readable) {
    const t = pageTypeOf(p);
    if (t === "pricing") add(p, "pricing page");
    else if (t === "product") add(p, "product page");
  }
  const vis = ctx.input.visibility;
  if (vis && !vis.noData) {
    for (const kw of vis.topKeywords ?? []) {
      if (!kw?.url) continue;
      const p = findPage(ctx.readable, kw.url);
      if (p) add(p, `ranks for ${quoteQuery(kw.keyword)}`);
    }
  }
  return Array.from(out.values());
}

/** 规格 §4 authority.internal 的分档:链到它的已抓页占比 ≥50% → 100,≥20% → 70,≥5% → 40,其余 10 */
export function inboundPoints(share: number): number {
  return share >= 0.5 ? 100 : share >= 0.2 ? 70 : share >= 0.05 ? 40 : 10;
}

/** authority.internal(15):每个核心页按入链页占比给分,取平均 */
export function scoreAuthorityInternal(ctx: RankingContext): SubScore {
  const id = "authority.internal";
  if (ctx.readable.length < 2) return notMeasured(id, `we need at least 2 crawled pages to measure internal links (found ${ctx.readable.length})`);
  const core = corePages(ctx);
  if (!core.length) return notMeasured(id, "we could not identify your homepage, pricing, product or ranking pages among the crawled pages");
  const sets = linkKeySets(ctx.readable);
  const others = ctx.readable.length - 1;
  const rows = core
    .map(({ page, role }) => {
      const keys = uniq([urlKey(page.url), page.finalUrl ? urlKey(page.finalUrl) : ""].filter(Boolean));
      let inbound = 0;
      ctx.readable.forEach((p, i) => {
        if (p === page) return;
        if (keys.some((k) => sets[i].has(k))) inbound += 1;
      });
      const s = inbound / others;
      return { page, role, inbound, s, pts: inboundPoints(s) };
    })
    .sort((a, b) => a.s - b.s || a.page.url.localeCompare(b.page.url));
  const weak = rows.filter((r) => r.s < 0.2);
  const fixes = weak.map((r) =>
    r.role === "homepage" || r.role === "pricing page"
      ? `Link ${pathOf(r.page.url)} (${r.role}) from your main navigation or footer so every page passes authority to it`
      : r.role.startsWith("ranks for")
        ? `Link ${pathOf(r.page.url)} from 3–5 related pages, using the words people search (it ${r.role})`
        : `Link ${pathOf(r.page.url)} (${r.role}) from related articles and your main navigation`,
  );
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: `Your key pages (homepage, pricing, product and ranking pages) are linked from most of the site`,
    bad: `Some key pages get few internal links: ${paths(weak.map((r) => r.page.url), 3) || paths(rows.map((r) => r.page.url), 2)}`,
    evidence: rows.map((r) => `${pathOf(r.page.url)} (${r.role}) is linked from ${r.inbound} of ${others} other crawled pages (${pct01(r.s)}%)`),
    fixes,
  });
}

/** 规格 §4 authority.entity 的品牌需求分档:≥1000 → 40,≥100 → 25,>0 → 10,0 → 0 */
export function brandDemandPoints(volume: number): number {
  return volume >= 1000 ? 40 : volume >= 100 ? 25 : volume > 0 ? 10 : 0;
}

/** authority.entity(15):实体一致 40 + sameAs≥2 20 + 品牌需求 40;visibility 无数据时品牌需求不计,按 60 满额重新归一 */
export function scoreAuthorityEntity(ctx: RankingContext): SubScore {
  const id = "authority.entity";
  const pages = ctx.signalPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx));
  const b = ctx.brand;
  const n = pages.length;
  const consistentShare = b.consistentPages.length / n;
  const entityOk = consistentShare >= 0.8 && b.matchesDomain;
  const maxSameAs = Math.max(0, ...pages.map((p) => num(contentOf(p).sameAsCount)));
  const sameAsOk = maxSameAs >= 2;
  const vis = ctx.input.visibility;
  const visOk = !!vis && !vis.noData;
  const brandKws = visOk ? (vis.topKeywords ?? []).filter((k) => !!k && isBrandKeyword(k.keyword, b.keywordTokens)) : [];
  const volume = brandKws.reduce((s, k) => s + num(k.volume), 0);
  const demandPts = visOk ? brandDemandPoints(volume) : 0;
  const base = (entityOk ? 40 : 0) + (sameAsOk ? 20 : 0);
  const score = visOk ? base + demandPts : (base / 60) * 100;
  const name = b.name ?? b.label;
  const evidence = [
    b.name
      ? `Brand name "${b.name}" appears on ${b.consistentPages.length} of ${n} pages (Organization schema, og:site_name or title suffix)${b.matchesDomain ? "" : ` — it doesn't match the domain ${ctx.input.domain}`}`
      : `No brand name found in Organization schema, og:site_name or title suffixes on any of the ${n} pages`,
    `Organization schema lists ${plural(maxSameAs, "official profile link")} (sameAs)`,
    visOk
      ? `Brand searches: about ${fmtInt(volume)} a month across ${plural(brandKws.length, "brand keyword")}${brandKws.length ? ` (e.g. ${quoteQuery([...brandKws].sort((x, y) => num(y.volume) - num(x.volume) || x.keyword.localeCompare(y.keyword))[0].keyword)})` : ""}`
      : "Brand search demand not measured (no ranking data) — scored on the other two signals",
  ];
  // 问题句挑丢分最多的那一项来说;"实体不一致"要分清是"页面之间不一致"还是"与域名对不上"
  const consistent = consistentShare >= 0.8;
  const entityText = !b.name
    ? "Your pages don't state a brand name Google can tie them to"
    : consistent
      ? `Your brand name "${b.name}" doesn't match your domain ${ctx.input.domain}, so Google may not connect the two`
      : `Your brand name isn't used consistently enough for Google to tie every page to "${b.name}"`;
  const losses: { pts: number; text: string }[] = [
    { pts: entityOk ? 0 : 40, text: entityText },
    { pts: visOk ? 40 - demandPts : 0, text: `Few people search for "${name}" by name yet` },
    { pts: sameAsOk ? 0 : 20, text: "Google can't confirm your brand: no official profiles are linked from your Organization schema" },
  ].sort((x, y) => y.pts - x.pts);
  const fixes: string[] = [];
  if (!entityOk && (!b.name || !consistent)) fixes.push(`Use the same brand name in the title suffix, og:site_name and Organization schema on every page${b.inconsistentPages.length ? ` — it is missing or different on ${paths(b.inconsistentPages, 2)}` : ""}`);
  if (!entityOk && b.name && consistent) fixes.push(`Tie the name to the domain: put "${b.name}" and ${ctx.input.domain} together in your Organization schema (name, alternateName, url) and on your About page`);
  if (!sameAsOk) fixes.push("Add sameAs links to your LinkedIn, X, Crunchbase or GitHub profiles in your Organization schema");
  if (visOk && demandPts < 40) fixes.push("Build brand demand: show up where buyers already are (communities, podcasts, partner newsletters) so they search for you by name");
  return measured(id, {
    score,
    good: `Google can tie your pages to one clear brand: "${name}"`,
    bad: losses[0].text,
    evidence,
    fixes,
  });
}

/* ============================================================
   用户满意信号(10)
   ============================================================ */

type Band = "good" | "ni" | "poor";
const CWV_LIMITS = {
  lcp: { good: 2500, ni: 4000 },
  inp: { good: 200, ni: 500 },
  cls: { good: 0.1, ni: 0.25 },
} as const;
const BAND_TEXT: Record<Band, string> = { good: "good", ni: "needs improvement", poor: "poor" };

function bandOf(v: number, t: { good: number; ni: number }): Band {
  return v <= t.good ? "good" : v <= t.ni ? "ni" : "poor";
}

function bandOfCategory(c: string | null | undefined): Band | null {
  const s = (c ?? "").toUpperCase();
  if (s === "FAST" || s === "GOOD") return "good";
  if (s === "AVERAGE" || s === "NEEDS_IMPROVEMENT") return "ni";
  if (s === "SLOW" || s === "POOR") return "poor";
  return null;
}

interface CwvRow {
  key: "lcp" | "inp" | "cls";
  name: string;
  value: string | null;
  band: Band;
}

/** 真实用户数据:移动端优先(Google 按移动端索引),没有再看桌面端;fieldMetrics 缺失时退回旧版 field 分档 */
function realUserRows(psi: RankingInput["psi"]): { rows: CwvRow[]; source: string } | null {
  const candidates: [PsiResult | null, string][] = [
    [psi?.mobile ?? null, "mobile"],
    [psi?.desktop ?? null, "desktop"],
  ];
  for (const [r, strategy] of candidates) {
    if (!r || r.error) continue;
    const rows: CwvRow[] = [];
    const fm = r.fieldMetrics;
    const add = (key: CwvRow["key"], name: string, v: number | null | undefined, fmt: (x: number) => string, cat: string | null | undefined) => {
      if (typeof v === "number" && Number.isFinite(v)) rows.push({ key, name, value: fmt(v), band: bandOf(v, CWV_LIMITS[key]) });
      else {
        const b = bandOfCategory(cat);
        if (b) rows.push({ key, name, value: null, band: b });
      }
    };
    add("lcp", "Largest Contentful Paint (loading)", fm?.lcpMs, (x) => `${fmt1(x / 1000)} s`, r.field?.lcp);
    add("inp", "Interaction to Next Paint (responsiveness)", fm?.inpMs, (x) => `${Math.round(x)} ms`, r.field?.inp);
    add("cls", "Cumulative Layout Shift (visual stability)", fm?.cls, (x) => `${Math.round(x * 100) / 100}`, r.field?.cls);
    if (rows.length) return { rows, source: `${fm?.source ? `${fm.source}-level ` : ""}Chrome UX Report data (real users, ${strategy})` };
  }
  return null;
}

const BAND_RANK: Record<Band, number> = { poor: 0, ni: 1, good: 2 };

const CWV_GOAL: Record<CwvRow["key"], string> = { lcp: "good ≤ 2.5 s", inp: "good ≤ 200 ms", cls: "good ≤ 0.1" };
const CWV_FIX: Record<CwvRow["key"], string> = {
  lcp: "Speed up the main image or headline: serve it from your own domain in a modern format, don't lazy-load it, and cut render-blocking CSS (target ≤ 2.5 s)",
  inp: "Make taps and clicks respond faster: break up long JavaScript tasks and defer third-party scripts (target ≤ 200 ms)",
  cls: "Stop the layout from jumping: give images, ads and embeds fixed dimensions and reserve space for banners (target ≤ 0.1)",
};

/** behavior.realuser(30):LCP / INP / CLS 各 good → 33.3、needs improvement → 16.7、poor → 0;没有真实用户数据 → null */
export function scoreBehaviorRealUser(ctx: RankingContext): SubScore {
  const id = "behavior.realuser";
  const ru = realUserRows(ctx.input.psi);
  if (!ru) {
    return notMeasured(id, "Google has no real-user data (Chrome UX Report) for this site yet — it needs more Chrome traffic", {
      evidence: ["No page-level or origin-level Chrome UX Report data in PageSpeed Insights; lab scores are in the Performance section instead"],
    });
  }
  const pts: number[] = ru.rows.map((r) => (r.band === "good" ? 1 : r.band === "ni" ? 0.5 : 0));
  // 稳定排序:同档时保持 LCP → INP → CLS 的顺序
  const worst = [...ru.rows].sort((a, b) => BAND_RANK[a.band] - BAND_RANK[b.band])[0];
  const detail = ru.rows.map((r) => `${r.key.toUpperCase()} ${r.value ?? BAND_TEXT[r.band]}`).join(", ");
  return measured(id, {
    score: (100 * pts.reduce((a, b) => a + b, 0)) / ru.rows.length,
    // 70–89 分时有一项不在 good 档:说"大多",不把"需改进"说成"很好"
    good: `Real Chrome users ${ru.rows.every((r) => r.band === "good") ? "get" : "mostly get"} a fast, stable experience (${detail})`,
    bad: `Real Chrome users see ${worst.key === "lcp" ? "slow loading" : worst.key === "inp" ? "slow responses to taps and clicks" : "a jumpy layout"}: ${worst.name.replace(/\s*\(.*\)$/, "")} is ${worst.value ? `${worst.value} (${BAND_TEXT[worst.band]})` : BAND_TEXT[worst.band]}`,
    evidence: [
      ...ru.rows.map((r) => `${r.name}: ${r.value ? `${r.value} at the 75th percentile — ` : ""}${BAND_TEXT[r.band]} (${CWV_GOAL[r.key]})`),
      `Source: ${ru.source}`,
    ],
    fixes: ru.rows.filter((r) => r.band !== "good").map((r) => CWV_FIX[r.key]),
  });
}

/**
 * behavior.task(25):40 × 答案前置占比(相关性分析的对)+ 30 × 内容页有下一步链接的占比
 * + 15 × 文章页有 FAQ 的占比 + 15 × 无弹窗遮罩。
 * 某项没有分母(没有查询对 / 没有文章页)时按其余项重新归一,不把"没测"当 0。
 * 弹窗一项按"无弹窗线索的内容页占比"计:全站弹窗时与规格的 0/1 一致,只有个别页有零星线索时不至于一票否决。
 */
export function scoreBehaviorTask(ctx: RankingContext): SubScore {
  const id = "behavior.task";
  const pages = ctx.contentPages;
  const popupBase = pages.length ? pages : ctx.signalPages;
  const answered = ctx.pairs.filter((p) => p.answerEarly);
  const nextStep = pages.filter((p) => num(contentOf(p).nextStepLinks) > 0);
  const noNext = pages.filter((p) => num(contentOf(p).nextStepLinks) === 0);
  const faq = ctx.articlePages.filter((p) => contentOf(p).hasFaq === true);
  const popups = popupBase.filter((p) => num(contentOf(p).interstitialHints) > 0);
  const terms: { w: number; v: number | null; loss: string }[] = [
    { w: 40, v: ctx.pairs.length ? answered.length / ctx.pairs.length : null, loss: "Pages make visitors dig for the answer before they get it" },
    { w: 30, v: pages.length ? nextStep.length / pages.length : null, loss: "Most pages end in a dead end — no next step after the main text" },
    { w: 15, v: ctx.articlePages.length ? faq.length / ctx.articlePages.length : null, loss: "Articles leave follow-up questions unanswered — no FAQ sections" },
    { w: 15, v: popupBase.length ? 1 - popups.length / popupBase.length : null, loss: "Pop-ups or overlays get in the way of the content" },
  ];
  const avail = terms.filter((t) => t.v !== null);
  if (!avail.length) return notMeasured(id, ctx.input.relevance ? contentGap(ctx) : "neither search-query pairs nor content pages were available to check");
  const wsum = avail.reduce((s, t) => s + t.w, 0);
  const score = (100 * avail.reduce((s, t) => s + t.w * (t.v as number), 0)) / wsum;
  const worst = [...avail].sort((a, b) => b.w * (1 - (b.v as number)) - a.w * (1 - (a.v as number)))[0];
  const evidence: string[] = [];
  evidence.push(ctx.pairs.length ? `The main query is answered in the first 150 words on ${answered.length} of ${ctx.pairs.length} pages we checked against search queries` : "Answer-first not measured (no search queries were matched to pages) — scored on the other signals");
  if (pages.length) evidence.push(`A next-step link (related page, product or call to action) after the main text on ${nextStep.length} of ${pages.length} content pages${noNext.length ? ` — missing on ${paths(noNext.map((p) => p.url))}` : ""}`);
  if (ctx.articlePages.length) evidence.push(`FAQ section on ${faq.length} of ${ctx.articlePages.length} articles`);
  if (popupBase.length) evidence.push(`Pop-up or overlay elements found on ${popups.length} of ${popupBase.length} pages${popups.length ? ` (${paths(popups.map((p) => p.url), 2)})` : ""}`);
  const fixes: string[] = [];
  const unanswered = ctx.pairs.filter((p) => !p.answerEarly);
  if (unanswered.length) fixes.push(`Answer the main question in the first two sentences — ${unanswered.slice(0, 2).map((p) => `${pathOf(p.url)} for ${quoteQuery(p.query)}`).join(", ")}`);
  if (noNext.length) fixes.push(`End every content page with a next step — a related guide, a product page or a clear call to action (missing on ${paths(noNext.map((p) => p.url), 2)})`);
  if (ctx.articlePages.length && faq.length < ctx.articlePages.length) fixes.push("Add a short FAQ to articles that answers the follow-up questions people ask next");
  if (popups.length) fixes.push(`Remove or delay pop-ups that cover the content on load (${paths(popups.map((p) => p.url), 2)})`);
  return measured(id, {
    score,
    good: "Pages get to the point and give readers a clear next step",
    bad: worst.loss,
    evidence,
    fixes,
  });
}

/** Flesch 分档:≥60 → 50,≥40 → 35,≥30 → 20,其余 10 */
export function fleschPoints(avg: number | null): number {
  if (avg === null) return 35;
  return avg >= 60 ? 50 : avg >= 40 ? 35 : avg >= 30 ? 20 : 10;
}

/** behavior.readability(25):Flesch 50 + 段落长度 20 + 每个小标题对应词数 15 + 有列表 / 表格的占比 15 */
export function scoreBehaviorReadability(ctx: RankingContext): SubScore {
  const id = "behavior.readability";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const fl = pages.map((p) => contentOf(p).fleschReadingEase).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const avgFlesch = fl.length ? mean(fl) : null;
  const paras = pages.map((p) => num(contentOf(p).avgParagraphWords)).filter((x) => x > 0);
  const avgPara = paras.length ? mean(paras) : null;
  const wph = mean(pages.map((p) => num(contentOf(p).mainWords) / Math.max(1, num(contentOf(p).h2Count) + num(contentOf(p).h3Count))));
  const scannable = pages.filter((p) => num(contentOf(p).listCount) > 0 || num(contentOf(p).tableCount) > 0);
  const noLists = pages.filter((p) => !scannable.includes(p));
  const fPts = fleschPoints(avgFlesch);
  // 段落长度没数据时按中档 10 计(与 Flesch 缺失按 35 计同一原则:没测不罚也不奖)
  const pPts = avgPara === null ? 10 : avgPara <= 80 ? 20 : avgPara <= 120 ? 10 : 0;
  const hPts = wph <= 300 ? 15 : 0;
  const lPts = 15 * (scannable.length / n);
  const hardest = pages
    .filter((p) => typeof contentOf(p).fleschReadingEase === "number")
    .sort((a, b) => num(contentOf(a).fleschReadingEase) - num(contentOf(b).fleschReadingEase) || a.url.localeCompare(b.url));
  const losses = [
    { lost: 50 - fPts, text: "Your content is hard to read: long sentences and complex words" },
    { lost: 20 - pPts, text: "Long paragraphs make your pages hard to scan" },
    { lost: 15 - hPts, text: "Long stretches without subheadings make your pages hard to scan" },
    { lost: 15 - lPts, text: "Few lists or tables, so readers can't skim your pages" },
  ].sort((a, b) => b.lost - a.lost);
  const fixes: string[] = [];
  if (avgFlesch !== null && avgFlesch < 60) fixes.push(`Shorten sentences (under 20 words) and swap jargon for plain words — hardest to read: ${paths(hardest.map((p) => p.url), 2)}`);
  if (avgPara !== null && avgPara > 80) fixes.push("Break paragraphs into 2–4 sentences each");
  if (wph > 300) fixes.push("Add a descriptive subheading every 200–300 words");
  if (noLists.length) fixes.push(`Turn steps, options and specs into bullet lists or a table on ${paths(noLists.map((p) => p.url), 2)}`);
  return measured(id, {
    score: fPts + pPts + hPts + lPts,
    good: "Your content is easy to read and easy to scan",
    bad: losses[0].text,
    evidence: [
      avgFlesch !== null
        ? `Average reading ease (Flesch score) ${Math.round(avgFlesch)} across ${fl.length} pages — 60+ reads as plain English, under 30 is very hard`
        : "Reading ease not measured (pages aren't in English) — counted as average",
      avgPara !== null ? `Average paragraph: ${Math.round(avgPara)} words (aim for 80 or fewer)` : "Paragraph length not measured — counted as average",
      `Average ${fmtInt(wph)} words per subheading (aim for 300 or fewer)`,
      `Bullet lists or tables on ${scannable.length} of ${n} content pages`,
    ],
    fixes,
  });
}

/** 标题承诺的数量有没有兑现:H2 / H3 / 列表项里任一个达到承诺的数就算兑现(多给不算违约) */
export function deliveredCount(c: PageContentSignals): number {
  return Math.max(num(c.h2Count), num(c.h3Count), num(c.listItemCount));
}

/** 标题主题词在正文前 150 词与小标题里的覆盖率;标题没有主题词时为 null(不判) */
function titleTopicCoverage(p: CrawledPage, brandWords: ReadonlySet<string>): number | null {
  const want = topicTokens(titleCore(p), brandWords);
  if (!want.size) return null;
  const have = topicTokens(`${p.content?.leadText ?? ""} ${(p.headings ?? []).map((h) => h.text).join(" ")} ${(p.h1s ?? []).join(" ")}`, brandWords);
  let hit = 0;
  want.forEach((t) => {
    if (have.has(t)) hit += 1;
  });
  return hit / want.size;
}

/** behavior.promise(20):100 − 标题党页占比 × 50 − 数字不兑现占比 × 30 − 标题主题不在开头与小标题里的占比 × 20 */
export function scoreBehaviorPromise(ctx: RankingContext): SubScore {
  const id = "behavior.promise";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const bait = pages.filter((p) => num(contentOf(p).clickbaitHits) >= 2);
  const numberMiss = pages.filter((p) => {
    const t = contentOf(p).titleNumber;
    return typeof t === "number" && t >= 2 && deliveredCount(contentOf(p)) < t;
  });
  const offTopic = pages.filter((p) => {
    const cov = titleTopicCoverage(p, ctx.brand.words);
    return cov !== null && cov < 0.5;
  });
  const fixes: string[] = [];
  if (bait.length) fixes.push(`Rewrite clickbait titles to say plainly what the page covers: ${paths(bait.map((p) => p.url), 2)}`);
  for (const p of numberMiss.slice(0, 2)) fixes.push(`Make the number in the title match the page: ${pathOf(p.url)} promises ${contentOf(p).titleNumber} but has ${deliveredCount(contentOf(p))} sections or list items`);
  if (offTopic.length) fixes.push(`Open ${paths(offTopic.map((p) => p.url), 2)} with the topic the title promises, and use it in a subheading`);
  return measured(id, {
    score: 100 - (bait.length / n) * 50 - (numberMiss.length / n) * 30 - (offTopic.length / n) * 20,
    good: "Your titles promise what the pages deliver",
    bad: "Some titles promise more than the page delivers",
    evidence: [
      `Clickbait wording (2+ signals like "shocking", "!" or ALL CAPS): ${bait.length} of ${n} titles${bait.length ? ` (${paths(bait.map((p) => p.url), 2)})` : ""}`,
      `Titles promising a number the page doesn't deliver: ${numberMiss.length} of ${n}${numberMiss.length ? ` — ${pathOf(numberMiss[0].url)} promises ${contentOf(numberMiss[0]).titleNumber}, the page has ${deliveredCount(contentOf(numberMiss[0]))} sections or list items` : ""}`,
      `Titles whose topic doesn't show up in the opening or the subheadings: ${offTopic.length} of ${n}${offTopic.length ? ` (${paths(offTopic.map((p) => p.url), 2)})` : ""}`,
    ],
    fixes,
  });
}

/* ============================================================
   技术基础(10):与免费版 Technical SEO 同一套数字
   ============================================================ */

function issueOrder(c: SeoCheck): number {
  return (c.gate && c.status === "fail" ? 1000 : 0) + (c.status === "fail" ? 100 : 0) + (SEVERITY_RANK[c.severity] ?? 0) * 10;
}

/** technical.*:小维度分 = 对应站内维度分;证据与修法取该维度失败 / 待改进的检查 */
export function scoreTechnicalSub(ctx: RankingContext, id: string): SubScore {
  const dimId = TECHNICAL_SUB_DIMENSIONS[id];
  const meta = SUB_META.get(id);
  if (!dimId || !meta) throw new Error(`Unknown technical sub-score: ${id}`);
  const d = (ctx.input.dimensions ?? []).find((x) => x.id === dimId);
  const checks = (ctx.input.checks ?? []).filter((c) => c.dimension === dimId);
  const issues = checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .sort((a, b) => issueOrder(b) - issueOrder(a) || num(b.affectedCount) - num(a.affectedCount) || a.id.localeCompare(b.id));
  if (!d || typeof d.score !== "number") {
    const why = !d ? "this area was not scored in the technical audit" : d.summary && !/^insufficient data$/i.test(d.summary.trim()) ? d.summary : "too few of its checks could run on this site";
    return notMeasured(id, why.charAt(0).toLowerCase() + why.slice(1));
  }
  const fail = checks.filter((c) => c.status === "fail").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const pass = checks.filter((c) => c.status === "pass").length;
  const total = fail + warn + pass;
  const gate = issues.find((c) => c.gate && c.status === "fail");
  const evidence = issues.length
    ? issues.map((c) => clipSentence(`${c.title}${c.evidence?.[0] ? ` — ${trimDot(c.evidence[0])}` : ""}`, 240))
    : [`All ${total} measured checks pass`];
  const problems = [fail ? plural(fail, "failing check") : "", warn ? `${fmtInt(warn)} to improve` : ""].filter(Boolean).join(", ");
  return measured(id, {
    score: d.score,
    good: issues.length ? `${meta.label}: ${pass} of ${total} checks pass` : `${meta.label}: all ${total} checks pass`,
    bad: gate ? `${meta.label} is capped by a critical issue: ${checkTitle(gate.id, "fail")}` : `${meta.label} needs work: ${problems || "several checks are weak"}`,
    evidence,
    fixes: issues.filter((c) => c.fix).map((c) => clipSentence(trimDot(c.fix), 260)),
  });
}

/* ============================================================
   拼装
   ============================================================ */

/** id → 小维度打分函数(测试与集成方都可以按 id 单独调用) */
export const SUB_SCORERS: Readonly<Record<string, (ctx: RankingContext) => SubScore>> = {
  "relevance.intent": scoreRelevanceIntent,
  "relevance.coverage": scoreRelevanceCoverage,
  "relevance.gain": scoreRelevanceGain,
  "relevance.alignment": scoreRelevanceAlignment,
  "quality.experience": scoreQualityExperience,
  "quality.data": scoreQualityData,
  "quality.authorship": scoreQualityAuthorship,
  "quality.freshness": scoreQualityFreshness,
  "quality.scaled": scoreQualityScaled,
  "authority.editorial": scoreAuthorityEditorial,
  "authority.breadth": scoreAuthorityBreadth,
  "authority.clusters": scoreAuthorityClusters,
  "authority.internal": scoreAuthorityInternal,
  "authority.entity": scoreAuthorityEntity,
  "behavior.realuser": scoreBehaviorRealUser,
  "behavior.task": scoreBehaviorTask,
  "behavior.readability": scoreBehaviorReadability,
  "behavior.promise": scoreBehaviorPromise,
  ...Object.fromEntries(Object.keys(TECHNICAL_SUB_DIMENSIONS).map((id) => [id, (ctx: RankingContext) => scoreTechnicalSub(ctx, id)])),
};

/** 支柱分 = 有分小维度按权重加权平均(null 不进分母);全是 null → null */
export function weightedPillarScore(subs: SubScore[]): number | null {
  const scored = subs.filter((s) => typeof s.score === "number");
  const w = scored.reduce((n, s) => n + s.weight, 0);
  if (!scored.length || w <= 0) return null;
  return clampScore(scored.reduce((n, s) => n + s.weight * (s.score as number), 0) / w);
}

function pillarSummary(id: PillarId, score: number | null, subs: SubScore[], ctx: RankingContext): string {
  if (id === "technical") {
    const capped = (ctx.input.technical?.blockers ?? []).length > 0;
    return capped
      ? `Same as your Technical SEO score (${score}/100) — a critical technical issue caps it and the overall score`
      : `Same as your Technical SEO score: ${score}/100 across 7 technical areas`;
  }
  const done = subs.filter((s) => typeof s.score === "number");
  if (score === null || !done.length) return `Not measured: none of its ${subs.length} sub-scores had data for this site`;
  const weakest = [...done].sort((a, b) => (a.score as number) - (b.score as number) || (SUB_ORDER.get(a.id) ?? 0) - (SUB_ORDER.get(b.id) ?? 0))[0];
  const tail = done.length < subs.length ? ` (${done.length} of ${subs.length} sub-scores measured)` : "";
  if ((weakest.score as number) >= 85) return `Strong across the board — every measured sub-score is 85 or higher${tail}`;
  if (score >= 70) return `Solid overall; the weakest spot is ${weakest.label} at ${weakest.score}/100${tail}`;
  return `Held back mainly by ${weakest.label} at ${weakest.score}/100${tail}`;
}

/**
 * 计算 SEO Ranking Score(规格 §4)。纯函数:同一输入永远得到同一输出,不修改输入。
 * 总分 = Σ 支柱权重 × 支柱分 / Σ 有分支柱的权重;免费版有致命项时总分 ≤40、等级 F、capped。
 */
export function computeRanking(input: RankingInput): RankingFramework {
  const ctx = buildRankingContext(input);
  const subs = RANKING_SUBS.map((m) => SUB_SCORERS[m.id](ctx));

  const pillars: PillarScore[] = PILLAR_ORDER.map((id) => {
    const meta = RANKING_PILLARS[id];
    const mine = subs.filter((s) => s.pillar === id);
    // 技术支柱直接取免费技术分(含致命项封顶),两处永远是同一个数字;等级也沿用免费版(封顶时是 F 而不是 40 分对应的 D)
    const score = id === "technical" ? clampScore(num(input.technical?.score)) : weightedPillarScore(mine);
    const grade: Grade | null = id === "technical" ? (input.technical?.grade ?? gradeFor(score as number)) : score === null ? null : gradeFor(score);
    return { id, label: meta.label, role: meta.role, weight: meta.weight, score, grade, summary: trimDot(pillarSummary(id, score, mine, ctx)), subs: mine };
  });

  const scored = pillars.filter((p) => typeof p.score === "number");
  const wsum = scored.reduce((n, p) => n + p.weight, 0);
  let score = wsum > 0 ? clampScore(scored.reduce((n, p) => n + p.weight * (p.score as number), 0) / wsum) : 0;
  let grade: Grade = gradeFor(score);
  const blockers = uniq((input.technical?.blockers ?? []).filter((b) => typeof b === "string" && b));
  const capped = blockers.length > 0;
  if (capped) {
    score = Math.min(score, GATE_OVERALL_CAP);
    grade = "F";
  }

  const nullSubs = subs.filter((s) => s.score === null);
  const blockerText = blockers.map((b) => checkTitle(b, "fail")).join("; ");
  const note = capped
    ? `Capped at ${GATE_OVERALL_CAP} (grade F): fix the technical blockers first — ${blockerText}`
    : nullSubs.length
      ? `Based on ${subs.length - nullSubs.length} of ${subs.length} sub-scores — ${nullSubs.length} could not be measured`
      : `Based on all ${subs.length} sub-scores`;

  const notes: string[] = [];
  if (capped) notes.push(`Overall score capped at ${GATE_OVERALL_CAP} because the technical audit found critical blockers: ${blockerText}. Fix the technical blockers first — nothing else counts while they stand`);
  for (const p of pillars) if (p.score === null) notes.push(`${p.label} is left out of the overall score: none of its sub-scores could be measured`);
  for (const s of nullSubs) notes.push(`${s.label} — ${s.summary}`);
  const gain = subs.find((s) => s.id === "relevance.gain");
  if (gain && gain.score !== null && ctx.pairs.length && !ctx.pairs.some((p) => (p.competitors ?? []).some((c) => c.fetched))) {
    notes.push("Information gain is estimated from your own pages only: no competitor pages could be fetched, so it is capped at 60");
  }

  const fetchedCompetitors = new Set<string>();
  for (const p of ctx.pairs) for (const c of p.competitors ?? []) if (c.fetched && c.url) fetchedCompetitors.add(urlKey(c.url));

  return {
    version: 1,
    overall: { score, grade, capped, note },
    pillars,
    basis: {
      pagesAnalyzed: ctx.readable.length,
      contentPages: ctx.contentPages.length,
      queries: ctx.pairs.map((p) => ({ query: p.query, url: p.url, position: p.position ?? null, volume: p.volume ?? null, intent: p.intent })),
      competitorsCompared: fetchedCompetitors.size,
    },
    relevance: input.relevance ?? null,
    notes,
  };
}
