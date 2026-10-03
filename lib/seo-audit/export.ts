import type {
  AuthorityResult,
  CompetitorPageSignals,
  CompetitorsResult,
  RankingFramework,
  RelevanceAnalysis,
  RelevancePair,
  ReputationAnalysis,
  SearchIntent,
  SeoAuditResult,
  VisibilityResult,
} from "./types";
import { publicCachedFrom } from "./view";

/* ============================================================
   JSON 导出视图(V2-0):只含**派生指标** —— 分数、检查结果、聚合数、我们自己抓取的页面级数据。
   DataForSEO 的原始行(逐条关键词 / 锚文本 / 竞品行)不进导出:那是供应商的数据,
   我们买的是"给用户看",不是"给用户转售"。聚合数(引荐域数、关键词总数、位置分桶…)保留。
   也不含 cost(我们的内部成本账,不是报告内容);meta.cachedFrom 只留时间戳,不留来源报告的 id(复审 C2)。
   ============================================================ */

export const EXPORT_NOTE =
  "Derived metrics only. Raw keyword, backlink/anchor and competitor rows from DataForSEO are omitted; aggregates and scores are included.";

type ExportAuthority = Omit<AuthorityResult, "anchors"> & { anchorsCount: number; topAnchorShare: number | null };
type ExportVisibility = Omit<VisibilityResult, "topKeywords" | "quickWins"> & { topKeywordsCount: number; quickWinsCount: number };
type ExportCompetitors = Omit<CompetitorsResult, "items"> & { itemsCount: number; domains: string[] };
type ExportCompetitorPage = Pick<CompetitorPageSignals, "domain" | "format" | "wordCount" | "fetched" | "weakSpots">;
type ExportRelevancePair = Omit<RelevancePair, "volume" | "position" | "competitors" | "paa" | "aiOverview" | "featuredSnippet" | "avgTopDomainRank" | "kd" | "serpItemTypes"> & {
  competitors: ExportCompetitorPage[];
  aiOverview: { present: boolean; cited: boolean; citedDomains: string[] } | null;
  featuredSnippet: { domain: string; own: boolean } | null;
};
type ExportReputation = Omit<ReputationAnalysis, "reviewPlatforms"> & { reviewPlatforms: { domain: string; rating: { value: number; votes: number | null } | null }[] };
type ExportRanking = Omit<RankingFramework, "basis" | "relevance"> & {
  basis: Omit<RankingFramework["basis"], "queries"> & { queries: { query: string; url: string; intent: SearchIntent }[] };
  relevance: (Omit<RelevanceAnalysis, "pairs"> & { pairs: ExportRelevancePair[] }) | null;
};

export type SeoAuditExport = Omit<SeoAuditResult, "authority" | "visibility" | "competitors" | "cost" | "ranking" | "reputation"> & {
  exportNote: string;
  authority: ExportAuthority | null;
  visibility: ExportVisibility | null;
  competitors: ExportCompetitors | null;
  ranking: ExportRanking | null;
  reputation: ExportReputation | null;
};

function stripAuthority(a: AuthorityResult | null): ExportAuthority | null {
  if (!a) return null;
  const { anchors, ...rest } = a;
  const list = Array.isArray(anchors) ? anchors : [];
  const totalBacklinks = list.reduce((n, x) => n + (Number(x.backlinks) || 0), 0);
  const top = list.reduce((m, x) => Math.max(m, Number(x.backlinks) || 0), 0);
  return { ...rest, anchorsCount: list.length, topAnchorShare: totalBacklinks > 0 ? Math.round((top / totalBacklinks) * 1000) / 1000 : null };
}

function stripVisibility(v: VisibilityResult | null): ExportVisibility | null {
  if (!v) return null;
  const { topKeywords, quickWins, ...rest } = v;
  return { ...rest, topKeywordsCount: Array.isArray(topKeywords) ? topKeywords.length : 0, quickWinsCount: Array.isArray(quickWins) ? quickWins.length : 0 };
}

function stripCompetitors(c: CompetitorsResult | null): ExportCompetitors | null {
  if (!c) return null;
  const { items, ...rest } = c;
  const list = Array.isArray(items) ? items : [];
  // 竞品域名本身是"谁在跟你抢词"的结论,保留;逐行的交集数 / ETV / 平均位置是供应商行,去掉
  return { ...rest, itemsCount: list.length, domains: list.map((x) => x.domain).filter(Boolean).slice(0, 5) };
}

/**
 * v3 Ranking Score:分数、证据、修法、子话题覆盖都是我们自己的分析,原样导出;
 * 来自 DataForSEO 的行(排名词的搜索量与名次、SERP 结果的 URL / 标题 / 名次)剥掉,竞品只留域名与页面形态。
 */
function stripRanking(r: RankingFramework | null | undefined): ExportRanking | null {
  if (!r) return null;
  const { basis, relevance, ...rest } = r;
  const queries = (basis?.queries ?? []).map((q) => ({ query: q.query, url: q.url, intent: q.intent }));
  const pairs: ExportRelevancePair[] = (relevance?.pairs ?? []).map((pair) => {
    const keep: Partial<RelevancePair> = { ...pair };
    // 供应商的原始行:搜索量、名次、难度、SERP 元素、PAA 原文、AI 摘要引用 URL、竞品域名权威 —— 不进导出
    delete keep.volume;
    delete keep.position;
    delete keep.kd;
    delete keep.serpItemTypes;
    delete keep.paa;
    delete keep.avgTopDomainRank;
    delete keep.aiOverview;
    delete keep.featuredSnippet;
    const aio = pair.aiOverview ?? null;
    return {
      ...(keep as Omit<ExportRelevancePair, "competitors" | "aiOverview" | "featuredSnippet">),
      aiOverview: aio ? { present: aio.present, cited: aio.cited, citedDomains: Array.from(new Set((aio.references ?? []).map((r) => r.domain))).slice(0, 10) } : null,
      featuredSnippet: pair.featuredSnippet ? { domain: pair.featuredSnippet.domain, own: pair.featuredSnippet.own } : null,
      competitors: (pair.competitors ?? []).map((c) => ({ domain: c.domain, format: c.format, wordCount: c.wordCount, fetched: c.fetched, weakSpots: c.weakSpots ?? [] })),
    };
  });
  return {
    ...rest,
    basis: { ...basis, queries },
    relevance: relevance ? { ...relevance, pairs } : null,
  };
}

/** v4:声誉里的 SERP 标题是供应商原始行,只留评价平台域名与评分 */
function stripReputation(r: ReputationAnalysis | null | undefined): ExportReputation | null {
  if (!r) return null;
  return { ...r, reviewPlatforms: (r.reviewPlatforms ?? []).map((x) => ({ domain: x.domain, rating: x.rating ?? null })) };
}

/** 完整报告 → 可导出的 JSON(付费权益;调用方已校验 unlocked && plan === "full")。Search Console 是买家自己的数据,原样导出 */
export function toExportView(result: SeoAuditResult): SeoAuditExport {
  const { authority, visibility, competitors, ranking, reputation, ...withCost } = result;
  // cost 不进买家可下载的文件:那是我们的内部成本账,不是报告内容
  const rest: Omit<typeof withCost, "cost"> & { cost?: unknown } = { ...withCost };
  delete rest.cost;
  return {
    ...rest,
    meta: { ...rest.meta, cachedFrom: publicCachedFrom(result) },
    exportNote: EXPORT_NOTE,
    authority: stripAuthority(authority),
    visibility: stripVisibility(visibility),
    competitors: stripCompetitors(competitors),
    ranking: stripRanking(ranking),
    reputation: stripReputation(reputation),
  };
}
