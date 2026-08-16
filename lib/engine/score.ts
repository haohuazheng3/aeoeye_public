import { clamp } from "@/lib/utils";
import { site as siteCfg } from "@/lib/site";
import type {
  AuditResult,
  CompetitorStat,
  EngineId,
  EngineQuestionResult,
  EngineSummary,
  GapQuestion,
  Question,
  SiteAudit,
} from "./types";

const SENTIMENT_MULT: Record<string, number> = { positive: 1, neutral: 0.85, negative: 0.5, absent: 0 };

function engineLabel(id: EngineId): string {
  return siteCfg.engines.find((e) => e.id === id)?.label || id;
}

/** 单题可见度得分(0-1) */
function perQuestionScore(r: EngineQuestionResult): number {
  if (!r.mentioned) return 0;
  const rankFactor = r.rank ? clamp(1 - (r.rank - 1) * 0.12, 0.3, 1) : 0.6;
  return rankFactor * (SENTIMENT_MULT[r.sentiment] ?? 0.85);
}

/** 从 matrix 汇总每个引擎的表现 */
export function summarizeEngines(
  matrix: EngineQuestionResult[],
  activeEngines: EngineId[],
  liveEngines: EngineId[],
  inactiveEngines: EngineId[]
): EngineSummary[] {
  const summaries: EngineSummary[] = [];

  for (const id of activeEngines) {
    const rows = matrix.filter((m) => m.engine === id);
    const asked = rows.length;
    const mentioned = rows.filter((r) => r.mentioned).length;
    const ranks = rows.filter((r) => r.mentioned && r.rank).map((r) => r.rank!) as number[];
    const avgRank = ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null;
    const vis = asked ? Math.round((rows.reduce((a, r) => a + perQuestionScore(r), 0) / asked) * 100) : 0;
    summaries.push({
      engine: id,
      label: engineLabel(id),
      status: "ok",
      live: liveEngines.includes(id),
      mentionRate: asked ? Math.round((mentioned / asked) * 100) : 0,
      avgRank,
      visibilityScore: vis,
      questionsAsked: asked,
      questionsMentioned: mentioned,
    });
  }

  // 未激活引擎(如 DataForSEO 欠费)——明确标注,不伪造数据
  for (const id of inactiveEngines) {
    summaries.push({
      engine: id,
      label: engineLabel(id),
      status: "inactive",
      live: false,
      mentionRate: 0,
      avgRank: null,
      visibilityScore: 0,
      questionsAsked: 0,
      questionsMentioned: 0,
      note: "Included in the full report.",
    });
  }

  // 按 site.engines 顺序排序
  const order = siteCfg.engines.map((e) => e.id);
  summaries.sort((a, b) => order.indexOf(a.engine) - order.indexOf(b.engine));
  return summaries;
}

/**
 * 通用 AI 助手 / 基础模型 —— 对绝大多数品类都不是可竞争对手。
 * 判定层 prompt 拦不干净(实测 Claude/Copilot Pro/Perplexity Pro 混进 PDF 工具榜),
 * 这里做确定性兜底。目标品牌自己就是 AI 助手时不过滤。
 */
const GENERIC_AI = new Set([
  "chatgpt", "openai", "claude", "anthropic", "gemini", "googlegemini", "bard",
  "copilot", "microsoftcopilot", "githubcopilot", "perplexity", "llama", "ollama",
  "mistral", "deepseek", "grok", "gpt4", "gpt4o", "gpt5", "llm",
]);
function isGenericAI(name: string): boolean {
  const k = canonKey(name);
  if (GENERIC_AI.has(k)) return true;
  // 版本/套餐后缀:"Copilot Pro" / "Perplexity Pro" / "Claude AI"
  const stripped = k.replace(/(pro|plus|premium|advanced|ai|app)$/, "");
  return stripped.length >= 3 && GENERIC_AI.has(stripped);
}

/** 竞品统计(谁在你的赛道里被 AI 反复推荐) */
export function computeCompetitors(matrix: EngineQuestionResult[], selfBrand?: string): CompetitorStat[] {
  // 审计对象本身是通用 AI 助手时,同行就是真竞品,不能滤掉
  const selfIsAI = selfBrand ? isGenericAI(selfBrand) : false;
  const map = new Map<
    string,
    { variants: Map<string, number>; mentions: number; questions: Set<string>; winsVsYou: number }
  >();
  // 先按问题分组,判断该问你是否缺席
  const byQuestion = new Map<string, EngineQuestionResult[]>();
  for (const m of matrix) {
    if (!byQuestion.has(m.questionId)) byQuestion.set(m.questionId, []);
    byQuestion.get(m.questionId)!.push(m);
  }
  const youAbsentInQuestion = new Map<string, boolean>();
  for (const [qid, rows] of byQuestion) {
    youAbsentInQuestion.set(qid, !rows.some((r) => r.mentioned));
  }

  for (const m of matrix) {
    for (const raw of m.competitorsMentioned) {
      const name = normalizeName(raw);
      if (!name) continue;
      if (!selfIsAI && isGenericAI(name)) continue;
      // 按归一化 key 聚合(大小写/空格/标点无关),避免 "Photofeeler" 与 "PhotoFeeler" 被算成两个品牌
      const key = canonKey(name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { variants: new Map(), mentions: 0, questions: new Set(), winsVsYou: 0 });
      const e = map.get(key)!;
      e.variants.set(name, (e.variants.get(name) ?? 0) + 1);
      e.mentions += 1;
      e.questions.add(m.questionId);
      if (youAbsentInQuestion.get(m.questionId)) e.winsVsYou += 1;
    }
  }

  mergePrefixVariants(map);

  return [...map.entries()]
    .map(([key, e]) => ({
      name: pickDisplayName(key, e.variants),
      mentions: e.mentions,
      appearsInQuestions: e.questions.size,
      winsVsYou: Math.min(e.winsVsYou, e.questions.size),
    }))
    .sort((a, b) => b.winsVsYou - a.winsVsYou || b.mentions - a.mentions)
    .slice(0, 12);
}

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
}

type CompEntry = { variants: Map<string, number>; mentions: number; questions: Set<string>; winsVsYou: number };

/**
 * 组内展示名:优先归一化后正好等于组 key 的写法 —— 否则前缀合并后
 * "Benihana Denver" 可能凭出现次数抢走整组的标题。同频次取更短的。
 */
function pickDisplayName(key: string, variants: Map<string, number>): string {
  const all = [...variants.entries()];
  const canonical = all.filter(([n]) => canonKey(n) === key);
  const pool = canonical.length ? canonical : all;
  return pool.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
}

/**
 * 第二轮合并:"Benihana" 吸收 "Benihana Denver"(同一竞争对手的门店/线路变体)。
 * 通用词剥离处理不了地名等无穷后缀,所以按前缀归并 —— 但必须在**原名**上验证
 * 前缀后是词边界,否则 "Grain" 会吞掉 "Grainger";前缀本身也要够长(≥5),
 * 避免 "Cal" 类短名滥合并。
 */
function mergePrefixVariants(map: Map<string, CompEntry>) {
  const keys = [...map.keys()].sort((a, b) => a.length - b.length); // 短的在前,当吸收方
  for (const shortKey of keys) {
    if (shortKey.length < 5 || !map.has(shortKey)) continue;
    for (const longKey of [...map.keys()]) {
      if (longKey === shortKey || longKey.length <= shortKey.length) continue;
      if (!longKey.startsWith(shortKey)) continue;
      const target = map.get(shortKey)!;
      const src = map.get(longKey)!;
      // 在原名上验证词边界:"Benihana Denver" ✓ / "Grainger" ✗
      const boundaryOk = [...src.variants.keys()].some((raw) => {
        const flat = raw.toLowerCase();
        const i = flat.replace(/[^a-z0-9]/g, "").indexOf(shortKey);
        if (i !== 0) return false;
        // 还原到原名里 shortKey 结束的位置,检查其后是否为分隔符
        let seen = 0;
        for (let p = 0; p < raw.length; p++) {
          if (/[a-z0-9]/i.test(raw[p])) seen++;
          if (seen === shortKey.length) return p + 1 >= raw.length || /[\s&,.·-]/.test(raw[p + 1]);
        }
        return false;
      });
      if (!boundaryOk) continue;
      for (const [n, c] of src.variants) target.variants.set(n, (target.variants.get(n) ?? 0) + c);
      target.mentions += src.mentions;
      for (const q of src.questions) target.questions.add(q);
      target.winsVsYou += src.winsVsYou;
      map.delete(longKey);
    }
  }
}

/**
 * 品牌名归一化 key:大小写/空格/标点无关,并剥离尾部通用业务词
 * (Benihana ↔ "Benihana Catering" 是同一家,不该占两行)。
 */
/** 尾部通用业务词 —— 必须带词边界,否则 Costco/Cisco 会被 "co" 削掉 */
const GENERIC_TAIL = /[\s&,.·-]+(catering|restaurants?|steakhouse|company|group|services?|solutions?|official|inc|llc|ltd|co)\.?$/;
/** 品牌被写成域名时的后缀:Fireflies.ai 与 Fireflies.io 是同一家,不该占两行 */
const TLD_TAIL = /\.(ai|io|com|co|app|dev|net|org|so|xyz|tech)$/;
const flatten = (s: string) => s.replace(/[^a-z0-9]/g, "");
function canonKey(s: string): string {
  let t = s.toLowerCase().trim().replace(TLD_TAIL, "");
  let prev = "";
  // 反复剥离,兼容 "X Catering Services" 这类叠加后缀;保留至少 4 字符避免过度合并
  while (t !== prev) {
    prev = t;
    const next = t.replace(GENERIC_TAIL, "").trim();
    if (flatten(next).length >= 4) t = next;
  }
  return flatten(t) || flatten(s.toLowerCase());
}

/** 你缺席而竞品出现的关键问题 */
export function computeGaps(
  matrix: EngineQuestionResult[],
  questions: Question[],
  selfBrand?: string
): GapQuestion[] {
  const selfIsAI = selfBrand ? isGenericAI(selfBrand) : false;
  const qmap = new Map(questions.map((q) => [q.id, q]));
  const byQuestion = new Map<string, EngineQuestionResult[]>();
  for (const m of matrix) {
    if (!byQuestion.has(m.questionId)) byQuestion.set(m.questionId, []);
    byQuestion.get(m.questionId)!.push(m);
  }
  const gaps: GapQuestion[] = [];
  for (const [qid, rows] of byQuestion) {
    const q = qmap.get(qid);
    if (!q) continue;
    const absentEngines = rows.filter((r) => !r.mentioned).map((r) => r.engine);
    const mentionedAny = rows.some((r) => r.mentioned);
    // 与竞品榜同一套过滤 —— 否则 gap 卡片仍会显示 "AI picked: Claude"
    const competitors = [
      ...new Set(
        rows
          .flatMap((r) => r.competitorsMentioned.map(normalizeName))
          .filter((n) => n && (selfIsAI || !isGenericAI(n)))
      ),
    ];
    // 只有"你缺席且有竞品被推荐"才算缺口
    if (!mentionedAny && competitors.length) {
      gaps.push({
        question: q.text,
        intent: q.intent,
        enginesAbsent: absentEngines,
        competitorsPresent: competitors.slice(0, 6),
        why: "",
      });
    }
  }
  // 高意图优先
  gaps.sort((a, b) => (a.intent === b.intent ? 0 : a.intent === "high" ? -1 : 1));
  return gaps;
}

/** 站点 AEO 信号得分(0-100) */
export function siteSignalScore(siteAudit?: SiteAudit): number | null {
  if (!siteAudit || !siteAudit.reachable || !siteAudit.signals.length) return null;
  const v: number[] = siteAudit.signals.map((s) => (s.status === "pass" ? 1 : s.status === "warn" ? 0.5 : 0));
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100);
}

/** 综合总分 */
export function computeOverall(engines: EngineSummary[], siteAudit?: SiteAudit): number {
  const live = engines.filter((e) => e.status === "ok");
  const engineComponent = live.length
    ? Math.round(live.reduce((a, e) => a + e.visibilityScore, 0) / live.length)
    : null;
  const siteComponent = siteSignalScore(siteAudit);

  if (engineComponent === null && siteComponent === null) return 0;
  if (engineComponent === null) return siteComponent!;
  if (siteComponent === null) return engineComponent;
  return clamp(Math.round(0.75 * engineComponent + 0.25 * siteComponent), 0, 100);
}

export type Aggregates = Pick<AuditResult, "engines" | "competitors" | "gaps" | "overallScore">;
