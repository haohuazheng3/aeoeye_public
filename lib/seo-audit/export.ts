import type { AuthorityResult, CompetitorsResult, SeoAuditResult, VisibilityResult } from "./types";
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

export type SeoAuditExport = Omit<SeoAuditResult, "authority" | "visibility" | "competitors" | "cost"> & {
  exportNote: string;
  authority: ExportAuthority | null;
  visibility: ExportVisibility | null;
  competitors: ExportCompetitors | null;
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

/** 完整报告 → 可导出的 JSON(付费权益;调用方已校验 unlocked && plan === "full") */
export function toExportView(result: SeoAuditResult): SeoAuditExport {
  const { authority, visibility, competitors, ...withCost } = result;
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
  };
}
