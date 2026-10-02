import type {
  AuthorityResult,
  CompetitorPageSignals,
  CompetitorsResult,
  RankingFramework,
  RelevanceAnalysis,
  RelevancePair,
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
type ExportCompetitorPage = Pick<CompetitorPageSignals, "domain" | "format" | "wordCount" | "fetched">;
type ExportRelevancePair = Omit<RelevancePair, "volume" | "position" | "competitors"> & { competitors: ExportCompetitorPage[] };
type ExportRanking = Omit<RankingFramework, "basis" | "relevance"> & {
  basis: Omit<RankingFramework["basis"], "queries"> & { queries: { query: string; url: string; intent: SearchIntent }[] };
  relevance: (Omit<RelevanceAnalysis, "pairs"> & { pairs: ExportRelevancePair[] }) | null;
};

export type SeoAuditExport = Omit<SeoAuditResult, "authority" | "visibility" | "competitors" | "cost" | "ranking"> & {
  exportNote: string;
  authority: ExportAuthority | null;
  visibility: ExportVisibility | null;
  competitors: ExportCompetitors | null;
  ranking: ExportRanking | null;
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
    delete keep.volume;
    delete keep.position;
    return {
      ...(keep as Omit<RelevancePair, "volume" | "position" | "competitors">),
      competitors: (pair.competitors ?? []).map((c) => ({ domain: c.domain, format: c.format, wordCount: c.wordCount, fetched: c.fetched })),
    };
  });
  return {
    ...rest,
    basis: { ...basis, queries },
    relevance: relevance ? { ...relevance, pairs } : null,
  };
}

/** 完整报告 → 可导出的 JSON(付费权益;调用方已校验 unlocked && plan === "full") */
export function toExportView(result: SeoAuditResult): SeoAuditExport {
  const { authority, visibility, competitors, ranking, ...withCost } = result;
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
  };
}
