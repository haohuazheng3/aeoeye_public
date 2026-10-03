/* ============================================================
   免费 vs 付费视图(V2-3)

   API 只吐 toPublicView(result, unlocked) 的结果,所以这里是付费内容
   唯一的出口闸门:漏一个字段就等于免费送。规则逐条对应 V2-3 的 ①–⑧,
   任何字段的"锁"都在这里做、不在前端做(前端隐藏 ≠ 没泄露)。

   复审后的两条硬规矩:
   - **白名单重建,不做"展开再删"**:顶层、meta、probe 都逐字段挑。落库的 result 是引擎运行期对象的超集
     (probe.robots 还带着 raw/groups,probe 带着断链全表、大图清单、sitemap 抽样……),展开一次就全漏了;
     以后谁给类型加了字段,默认也是不出站(复审 C3/C24/C42)。
   - **撤销态还原成免费形状**:退款/拒付后 unlocked=false 但 result.plan 仍是 full(撤销刻意不动数据,
     便于争议胜诉后恢复)。此时付费维度的检查整条移除、维度分数与计数清空,而不是只打 locked(复审 C8)。
   - v3:result.ranking(SEO Ranking Score)在免费 / 撤销视图里恒为 null。
   - v4:result.reputation 与 result.gsc(站长授权的 Search Console 数据)同样恒为 null。
   ============================================================ */

import {
  DIMENSIONS,
  FREE_FULL_DETAIL_MAX,
  type DimensionId,
  type DimensionScore,
  type RoadmapBucket,
  type RoadmapItem,
  type SeoAuditResult,
  type SeoCheck,
  type Severity,
  type SiteProbe,
} from "./types";

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const FREE_SAMPLE_MAX = 3;
const LOCKED_SAMPLE_MAX = 1;
/** 与 score.ts 免费轮的付费维度文案一致(免费结果的维度本来就是这个形状,不会被改写) */
const LOCKED_DIMENSION_SUMMARY = "Unlock the full report to see this dimension.";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function isPaidDimension(dimension: string): boolean {
  return DIMENSIONS[dimension as DimensionId]?.paid === true;
}

function candidateRank(c: SeoCheck): number {
  return (c.status === "fail" ? 100 : 0) + SEVERITY_RANK[c.severity] * 10;
}

/**
 * ① 免费可见完整细节的 check id:topIssues ∪ {critical/high 且 fail|warn},截到 8 条。
 * 只认站内维度 —— 付费维度的检查(撤销态的 plan=full 结果里才有)绝不进免费名单。
 */
export function freeFullDetailIds(result: Pick<SeoAuditResult, "checks" | "topIssues">): Set<string> {
  const onsite = result.checks.filter((c) => !isPaidDimension(c.dimension));
  const byId = new Map(onsite.map((c) => [c.id, c]));
  const ordered: string[] = [];
  for (const id of result.topIssues ?? []) if (byId.has(id) && !ordered.includes(id)) ordered.push(id);
  const candidates = onsite
    .filter((c) => (c.severity === "critical" || c.severity === "high") && (c.status === "fail" || c.status === "warn"))
    .sort((a, b) => candidateRank(b) - candidateRank(a) || (b.affectedCount ?? b.affected.length) - (a.affectedCount ?? a.affected.length));
  for (const c of candidates) if (!ordered.includes(c.id)) ordered.push(c.id);
  return new Set(ordered.slice(0, FREE_FULL_DETAIL_MAX));
}

function roadmapCounts(items: RoadmapItem[]): Record<RoadmapBucket, number> {
  const counts: Record<RoadmapBucket, number> = { this_week: 0, this_month: 0, later: 0 };
  for (const it of items) if (it.bucket in counts) counts[it.bucket] += 1;
  return counts;
}

/**
 * meta.cachedFrom 对外只能是时间戳(或 null)。旧版本把**来源报告的 id** 写进了这里 ——
 * 报告凭 id 公开,那是别人的报告链接(复审 C2)。写入端已改存来源的完成时间;
 * 出口再兜一层,覆盖已落库的旧副本行:非时间戳一律换成本份结果的生成时间(副本的 result 就是来源那份)。
 * UI 只做真值判断("Audited N h ago"),换值不影响展示。
 */
export function publicCachedFrom(result: Pick<SeoAuditResult, "generatedAt" | "meta">): string | null {
  const v = result.meta?.cachedFrom;
  if (!v) return null;
  if (ISO_TIMESTAMP.test(v) && !Number.isNaN(Date.parse(v))) return v;
  return ISO_TIMESTAMP.test(result.generatedAt ?? "") ? result.generatedAt : "cached";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 免费视图的 probe:白名单重建。免费 UI 只读 probe.blocked(outcome-notice);其余保留的都是
 * 无付费价值的标量。SiteProbe 的必填字段给中性空壳以保持类型 —— variants / sitemaps / soft404 / headers
 * 正是 crawl.* / sec.* 等检查的证据来源,那些检查被锁时这里必须是空的。
 * 不带:tls / parity / robotsMeta / sitemapSample / canonicalTargets / brokenInternal / brokenOutbound /
 * largeImages / ogImage / crawlTtfb / altHost,以及 robots.raw / robots.groups 这类类型之外的运行期字段。
 */
export function publicProbe(p: SiteProbe): SiteProbe {
  const robots = (p.robots ?? {}) as Partial<SiteProbe["robots"]>;
  const out: SiteProbe = {
    input: str(p.input),
    entryUrl: str(p.entryUrl),
    origin: str(p.origin),
    host: str(p.host),
    variants: [],
    robots: {
      url: str(robots.url),
      status: numOrNull(robots.status),
      found: robots.found === true,
      disallowAll: robots.disallowAll === true,
      blocksEntry: robots.blocksEntry === true,
      sitemaps: [],
      bytes: 0,
    },
    sitemaps: [],
    soft404: { probeUrl: "", status: null, isSoft404: false },
    headers: { hsts: null, csp: null, xContentTypeOptions: null, xFrameOptions: null, referrerPolicy: null, server: null, xRobotsTag: null },
  };
  if (p.blocked) {
    out.blocked = { detected: p.blocked.detected === true, kind: p.blocked.kind ?? null, evidence: str(p.blocked.evidence) };
  }
  if (typeof p.jsDependent === "boolean") out.jsDependent = p.jsDependent;
  if (p.coverage) {
    out.coverage = {
      navPages: numOrNull(p.coverage.navPages) ?? 0,
      sitemapPages: numOrNull(p.coverage.sitemapPages) ?? 0,
      skippedByRobots: numOrNull(p.coverage.skippedByRobots) ?? 0,
      stoppedEarly: typeof p.coverage.stoppedEarly === "string" ? p.coverage.stoppedEarly : null,
    };
  }
  if (p.entryError !== undefined) {
    out.entryError = p.entryError ? { kind: p.entryError.kind, message: str(p.entryError.message) } : null;
  }
  return out;
}

/** 付费维度在免费视图里的形状(与 score.ts 免费轮一致:无分数、锁定、计数清零) */
function lockedPaidDimension(d: DimensionScore): DimensionScore {
  return { id: d.id, label: d.label, weight: d.weight, score: null, pass: 0, warn: 0, fail: 0, na: 0, locked: true, summary: LOCKED_DIMENSION_SUMMARY };
}

function isLockedShape(d: DimensionScore): boolean {
  return d.locked === true && d.score === null && !d.pass && !d.warn && !d.fail && !d.na;
}

export function toPublicView(result: SeoAuditResult, unlocked: boolean): SeoAuditResult {
  if (unlocked) {
    // 付费视图原样返回(V2-3);唯一例外是旧副本行里那个来源 id —— 只在确实需要换时才复制对象
    const cachedFrom = publicCachedFrom(result);
    return cachedFrom === (result.meta?.cachedFrom ?? null) ? result : { ...result, meta: { ...result.meta, cachedFrom } };
  }

  // 撤销态(plan=full 但 unlocked=false):付费维度的检查整条移除 —— 只打 locked 仍会带出标题 + 状态 + 样例
  const allChecks = result.checks ?? [];
  const paidIds = new Set(allChecks.filter((c) => isPaidDimension(c.dimension)).map((c) => c.id));
  const onsite = allChecks.filter((c) => !paidIds.has(c.id));
  const topIssues = (result.topIssues ?? []).filter((id) => !paidIds.has(id));
  const fullDetail = freeFullDetailIds({ checks: onsite, topIssues });

  // ② / ③
  const checks: SeoCheck[] = onsite.map((c) => {
    const sampleSource = c.sample ?? c.affected ?? [];
    if (fullDetail.has(c.id)) {
      return {
        ...c,
        evidence: [...c.evidence],
        affected: (c.affected ?? []).slice(0, FREE_SAMPLE_MAX),
        sample: sampleSource.slice(0, FREE_SAMPLE_MAX),
        locked: false,
      };
    }
    return {
      ...c,
      evidence: [],
      fix: "",
      affected: [],
      sample: sampleSource.slice(0, LOCKED_SAMPLE_MAX),
      locked: true,
    };
  });
  const lockedChecks = checks.filter((c) => c.locked).length;

  // 付费维度:免费结果本来就是锁定形状(原样保留);撤销态的真实分数 / 计数 / summary 清掉
  const dimensions = (result.dimensions ?? []).map((d) => (isPaidDimension(d.id) && !isLockedShape(d) ? lockedPaidDimension(d) : d));

  // ⑥ 路线图:先滤掉付费检查(否则第 1 项与三桶计数可能来自付费维度),再只留第 1 项,计数进 lockedSections
  let roadmap: RoadmapItem[] | null = null;
  let roadmapSection = "roadmap";
  if (Array.isArray(result.roadmap)) {
    const onsiteRoadmap = result.roadmap.filter((it) => !paidIds.has(it.checkId));
    const counts = roadmapCounts(onsiteRoadmap);
    roadmap = onsiteRoadmap.slice(0, 1).map((it) => ({ ...it }));
    roadmapSection = `roadmap:this_week=${counts.this_week},this_month=${counts.this_month},later=${counts.later}`;
  }

  // ⑤ PSI:移动端保留头条指标与分数,审计列表清空;桌面端整体锁
  const mobileAudits = result.psi?.mobile?.audits?.length ?? 0;
  const psiMobile = result.psi?.mobile ? { ...result.psi.mobile, audits: [] } : null;

  // ⑧ 锁定清单用真实计数,UI 的锁定卡直接引用
  const pagesCount = result.pages?.length || result.meta?.pagesCrawled || 0;
  const lockedSections = [
    `checks=${lockedChecks}`,
    `pages=${pagesCount}`,
    `psi.audits=${mobileAudits}`,
    "psi.desktop",
    roadmapSection,
    "authority",
    "visibility",
    "competitors",
    "ranking",
    "reputation",
    "gsc",
    "export",
  ];

  // 逐字段构造时对旧行 / 残缺行保持宽容:出口闸门自己不能因为一条怪数据把整页打成 500
  const m = (result.meta ?? {}) as Partial<SeoAuditResult["meta"]>;
  const meta: SeoAuditResult["meta"] = {
    pagesCrawled: m.pagesCrawled ?? 0,
    pagesRequested: m.pagesRequested ?? 0,
    crawlLimited: m.crawlLimited ?? false,
    notes: Array.isArray(m.notes) ? [...m.notes] : [],
    lockedSections,
  };
  if (m.outcome !== undefined) meta.outcome = m.outcome;
  if (m.blockers !== undefined) meta.blockers = m.blockers.filter((id) => !paidIds.has(id));
  if (m.confidence !== undefined) meta.confidence = m.confidence;
  if (m.scoreNote !== undefined) meta.scoreNote = m.scoreNote;
  if (m.psiFetchTime !== undefined) meta.psiFetchTime = m.psiFetchTime;
  if (m.cachedFrom !== undefined) meta.cachedFrom = publicCachedFrom({ generatedAt: result.generatedAt, meta: { ...meta, cachedFrom: m.cachedFrom } });

  // 顶层同样逐字段构造:类型之外的运行期字段一律不出站
  return {
    version: result.version,
    plan: result.plan,
    input: result.input,
    entryUrl: result.entryUrl,
    domain: result.domain,
    generatedAt: result.generatedAt,
    durationMs: result.durationMs,
    overall: { score: result.overall?.score ?? 0, grade: result.overall?.grade ?? "F" },
    dimensions,
    checks,
    pages: [], // ④
    probe: publicProbe(result.probe), // 复审 C3:锁定检查的原始证据就在 probe 里
    psi: { mobile: psiMobile, desktop: null },
    topIssues,
    roadmap,
    authority: null, // ⑦
    visibility: null,
    competitors: null,
    // v3:SEO Ranking Score 整体是付费内容(分数、证据、修法、查询与竞品对比);免费页只画锁定预告,
    // 预告用的支柱 / 小维度名来自 types.ts 的常量,不需要这里下发任何数据
    ranking: null,
    // v4:站外声誉是付费数据;Search Console 是站长自己的搜索数据 —— 报告凭链接公开,锁定 / 撤销态绝不下发
    reputation: null,
    gsc: null,
    // 内部成本账不对外(撤销态的 full 结果里是真实的 DataForSEO 花费)
    cost: { dataforseoUsd: 0, calls: 0 },
    meta,
  };
}
