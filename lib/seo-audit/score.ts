/* ============================================================
   评分模型(V2-1)

   - check 权重 = 严重度(critical 4 · high 3 · medium 2 · low 1);
     pass 满分、warn 一半、fail 0;info / na 不进分母(没测 ≠ 没过)。
   - 维度可用检查 <3 条 → score null + "Insufficient data",不计入总分:
     两三条检查算出来的 100 分或 0 分都没有统计意义。
   - 致命项封顶:gate 且 fail → 所属维度 ≤30、总分 ≤40 且 F。
     否则一个 noindex 首页的站也可能因为其它几十项都过而拿 B,
     这会误导站长"还行",而实际上 Google 根本不收录它。
   - 总分只用站内维度,按 DIMENSIONS.weight 加权,剔除 null 维度后重新归一,
     并在 scoreNote 写明 "Based on N of 7 dimensions"。
   ============================================================ */

import {
  DIMENSIONS,
  SEO_GRADE_SCALE,
  type CrawledPage,
  type DimensionId,
  type DimensionScore,
  type RoadmapBucket,
  type RoadmapItem,
  type SeoCheck,
  type Severity,
} from "./types";
import { checkTitle } from "./checks/titles";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
/** gate fail 时的封顶 */
export const GATE_DIMENSION_CAP = 30;
export const GATE_OVERALL_CAP = 40;
/** 维度至少要有这么多条可评的检查才出分 */
export const MIN_APPLICABLE_CHECKS = 3;
export const INSUFFICIENT_DATA = "Insufficient data";

type Grade = "A" | "B" | "C" | "D" | "F";

/*
 * overallScore(dims) 按规格只收 dims,但封顶需要知道哪些 gate 项 fail 了。
 * DimensionScore 里没有这个字段(types.ts 不归本模块改),所以 scoreDimensions
 * 把每个维度的 blockers 记在 WeakMap 里;overallScore 若没拿到 checks 就从这里读。
 * 同一次运行里 dims 是同一批对象,足够;跨进程(序列化后)请显式传 checks。
 */
const blockerRegistry = new WeakMap<DimensionScore, string[]>();

export function gradeFor(score: number): Grade {
  for (const step of SEO_GRADE_SCALE) if (score >= step.min) return step.grade;
  return "F";
}

export function isGateFail(c: SeoCheck): boolean {
  return c.gate === true && c.status === "fail";
}

function weightOf(c: SeoCheck): number {
  return Number.isFinite(c.weight) && c.weight > 0 ? c.weight : SEVERITY_RANK[c.severity];
}

function creditOf(c: SeoCheck): number {
  return c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0;
}

function isApplicable(c: SeoCheck): boolean {
  return c.status === "pass" || c.status === "warn" || c.status === "fail";
}

/** 封顶说明里给人看的是问题句("Homepage is blocked from Google"),不是 check id(复审契约第 7 条) */
function blockerText(ids: string[]): string {
  return ids.map((id) => checkTitle(id, "fail")).join("; ");
}

function summarize(id: DimensionId, score: number, counts: { pass: number; warn: number; fail: number }, blockers: string[]): string {
  const total = counts.pass + counts.warn + counts.fail;
  if (blockers.length) return `Capped at ${GATE_DIMENSION_CAP} — fix this first: ${blockerText(blockers)}. Nothing else in ${DIMENSIONS[id].short.toLowerCase()} matters until then.`;
  if (counts.fail === 0 && counts.warn === 0) return `All ${total} measured checks pass.`;
  const parts: string[] = [];
  if (counts.fail) parts.push(`${counts.fail} failing`);
  if (counts.warn) parts.push(`${counts.warn} to improve`);
  return `${parts.join(", ")} of ${total} measured checks${score >= 85 ? " — solid overall" : score < 55 ? " — needs work" : ""}.`;
}

/**
 * 每个维度(7 站内 + 3 站外)一行。站外维度未解锁 → score null + locked。
 */
export function scoreDimensions(checks: SeoCheck[], opts: { unlocked: boolean }): DimensionScore[] {
  return (Object.keys(DIMENSIONS) as DimensionId[]).map((id) => {
    const meta = DIMENSIONS[id];
    const mine = checks.filter((c) => c.dimension === id);
    const counts = {
      pass: mine.filter((c) => c.status === "pass").length,
      warn: mine.filter((c) => c.status === "warn").length,
      fail: mine.filter((c) => c.status === "fail").length,
      // info 与 na 都是"不计分",报告里合并显示为 n/a
      na: mine.filter((c) => c.status === "na" || c.status === "info").length,
    };
    const base = { id, label: meta.label, weight: meta.weight, ...counts };

    if (meta.paid && !opts.unlocked) {
      const ds: DimensionScore = { ...base, score: null, locked: true, summary: "Unlock the full report to see this dimension." };
      blockerRegistry.set(ds, []);
      return ds;
    }

    const applicable = mine.filter(isApplicable);
    const blockers = mine.filter(isGateFail).map((c) => c.id);
    if (applicable.length < MIN_APPLICABLE_CHECKS) {
      const ds: DimensionScore = { ...base, score: null, locked: false, summary: INSUFFICIENT_DATA };
      blockerRegistry.set(ds, blockers);
      return ds;
    }

    const den = applicable.reduce((n, c) => n + weightOf(c), 0);
    const num = applicable.reduce((n, c) => n + weightOf(c) * creditOf(c), 0);
    let score = den > 0 ? Math.round((num / den) * 100) : 0;
    if (blockers.length) score = Math.min(score, GATE_DIMENSION_CAP);

    const ds: DimensionScore = { ...base, score, locked: false, summary: summarize(id, score, counts, blockers) };
    blockerRegistry.set(ds, blockers);
    return ds;
  });
}

export interface OverallScore {
  score: number;
  grade: Grade;
  /** 触发封顶的 gate check id */
  blockers: string[];
  /** 分数口径说明,例如 "Based on 6 of 7 dimensions" */
  scoreNote: string;
}

/**
 * 站内维度加权总分。`checks` 可选:传了就直接从里面找 gate fail,
 * 没传则回退到 scoreDimensions 登记的 blockers。
 */
export function overallScore(dims: DimensionScore[], checks: SeoCheck[] = []): OverallScore {
  const onsite = dims.filter((d) => !DIMENSIONS[d.id]?.paid);
  const scored = onsite.filter((d) => typeof d.score === "number");
  const blockers = Array.from(
    new Set([...checks.filter(isGateFail).map((c) => c.id), ...onsite.flatMap((d) => blockerRegistry.get(d) ?? [])]),
  );
  const notes: string[] = [];

  if (!scored.length) {
    notes.push("Not enough measured checks to compute a score.");
    if (blockers.length) notes.push(`Blocked by: ${blockerText(blockers)}.`);
    return { score: 0, grade: "F", blockers, scoreNote: notes.join(" ") };
  }

  const totalWeight = scored.reduce((n, d) => n + d.weight, 0);
  let score = totalWeight > 0 ? Math.round(scored.reduce((n, d) => n + (d.score as number) * d.weight, 0) / totalWeight) : 0;
  let grade = gradeFor(score);

  if (scored.length < onsite.length) {
    const missing = onsite.filter((d) => typeof d.score !== "number").map((d) => DIMENSIONS[d.id].label);
    notes.push(`Based on ${scored.length} of ${onsite.length} dimensions (${missing.join(", ")} not measured).`);
  }
  if (blockers.length) {
    score = Math.min(score, GATE_OVERALL_CAP);
    grade = "F";
    notes.push(`Capped at ${GATE_OVERALL_CAP} (grade F) until fixed: ${blockerText(blockers)}.`);
  }
  return { score, grade, blockers, scoreNote: notes.join(" ") };
}

/** 排序键:gate fail → critical fail → high fail → … → warn(同样按严重度) */
function issueRank(c: SeoCheck): number {
  if (c.status !== "fail" && c.status !== "warn") return -1;
  const gate = isGateFail(c) ? 1000 : 0;
  const status = c.status === "fail" ? 100 : 0;
  return gate + status + SEVERITY_RANK[c.severity] * 10;
}

function affectedOf(c: SeoCheck): number {
  return typeof c.affectedCount === "number" ? c.affectedCount : c.affected?.length ?? 0;
}

/** 免费视图展示的 N 条最严重问题(只取站内维度) */
export function pickTopIssues(checks: SeoCheck[], n = 3): string[] {
  return checks
    .filter((c) => !DIMENSIONS[c.dimension]?.paid && issueRank(c) >= 0)
    .sort((a, b) => issueRank(b) - issueRank(a) || affectedOf(b) - affectedOf(a))
    .slice(0, n)
    .map((c) => c.id);
}

/**
 * 路线图:impact = severityRank × (1 + log2(1 + pagesAffected))。
 * 站点级检查影响的是整站,所以 pagesAffected 取抓到的页数(至少 1);
 * gate 项无条件进 this_week —— 它们封顶了总分,不修别的都没意义。
 */
export function buildRoadmap(checks: SeoCheck[], pages: CrawledPage[]): RoadmapItem[] {
  const siteWide = Math.max(1, pages.length);
  const items: RoadmapItem[] = checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .map((c) => {
      const pagesAffected = c.scope === "page" ? affectedOf(c) : siteWide;
      const impact = Math.round(SEVERITY_RANK[c.severity] * (1 + Math.log2(1 + pagesAffected)) * 10) / 10;
      let bucket: RoadmapBucket = impact >= 6 && c.effort === "low" ? "this_week" : impact >= 4 ? "this_month" : "later";
      if (isGateFail(c)) bucket = "this_week";
      return { checkId: c.id, title: c.title, bucket, impact, effort: c.effort, pagesAffected, fix: c.fix };
    });
  const order: Record<RoadmapBucket, number> = { this_week: 0, this_month: 1, later: 2 };
  return items.sort((a, b) => order[a.bucket] - order[b.bucket] || b.impact - a.impact);
}
