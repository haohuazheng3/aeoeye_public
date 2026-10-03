import type { SeoAuditStage } from "@/lib/seo-audit/types";
import { ONSITE_DIMENSIONS, PILLAR_IDS, RANKING_SUBS } from "@/lib/seo-audit/types";

/* ============================================================
   进度页的阶段逻辑(纯函数,SeoProgress 用;单独成文件好在 node 里直接验)。

   阶段顺序与 run.ts 的 emit 严格一致(分工契约第 3 条):
     queued → probing → crawling → pagespeed → verifying → authority → visibility → competitors → scoring → done
   复审 C17/C33 的两个教训:
   - 前端必须单调:只接受排在"已见过的最大阶段"之后的帧,未知阶段直接忽略 ——
     否则后端回发一个更靠前 / 没登记的阶段,对勾会被撤掉、状态行跳回 "Queued",像任务被重置;
   - 每个已知阶段都要有自己的状态文案,状态行只有 stage === "queued" 时才显示 "Queued"。
   ============================================================ */

export const STAGE_ORDER: readonly SeoAuditStage[] = [
  "queued",
  "probing",
  "crawling",
  "pagespeed",
  "verifying",
  "authority",
  "visibility",
  "competitors",
  "scoring",
  "done",
];

export function stageRank(s: SeoAuditStage | string | null | undefined): number {
  return s ? STAGE_ORDER.indexOf(s as SeoAuditStage) : -1;
}

/** 单调推进:只接受排在 prev 之后的已知阶段;更靠前的、未知的(rank = -1)一律保持 prev */
export function advanceStage(prev: SeoAuditStage, next: SeoAuditStage | string | null | undefined): SeoAuditStage {
  const r = stageRank(next);
  return r > stageRank(prev) ? (next as SeoAuditStage) : prev;
}

/** 付费段(只有完整版运行会走到):桌面 PSI ∥ DataForSEO 三模块 */
export function isPaidStage(s: SeoAuditStage | string | null | undefined): boolean {
  const r = stageRank(s);
  return r >= stageRank("authority") && r <= stageRank("competitors");
}

/** 状态行:每个阶段一句,永不回落到 "Queued"(crawling 另外拼已抓页数;scoring 按版本区分) */
const STATUS: Record<SeoAuditStage, string> = {
  queued: "Queued",
  probing: "Probing robots.txt, sitemaps and URL variants",
  crawling: "Crawling pages",
  pagespeed: "Running Google PageSpeed Insights (mobile)",
  verifying: "Checking sitemap samples, links and images",
  authority: "Desktop PageSpeed, authority and backlinks",
  visibility: "Search visibility and ranked keywords",
  competitors: "Competitors, page-one comparison and brand reputation",
  scoring: "Scoring and picking top issues",
  done: "Finishing up",
};

function scoringLabel(paid: boolean): string {
  // 完整版的头条是 SEO Ranking Score(支柱数 / 小维度数取自类型层常量,v2 = 7 / 40);
  // 已连接 Search Console 的报告在这一步把真实点击并进计分。免费版仍是 7 个站内维度的技术分
  return paid
    ? `Computing your SEO Ranking Score (${PILLAR_IDS.length} pillars, ${RANKING_SUBS.length} sub-scores, with Search Console data if connected) and fix roadmap`
    : `Scoring ${ONSITE_DIMENSIONS.length} dimensions and picking top issues`;
}

export function stageStatus(stage: SeoAuditStage, paid: boolean): string {
  return stage === "scoring" ? scoringLabel(paid) : STATUS[stage];
}

/**
 * 列表行:from..to 是该行覆盖的阶段区间(按 STAGE_ORDER 比较)。付费三阶段合并成一行 ——
 * 三个模块在后端是并行的,后端发不发 visibility / competitors 两帧、以什么顺序发都不影响显示,
 * 不会出现"还在跑却先打了勾"的行。付费行只对完整版运行出现。
 */
export interface StageRow {
  id: string;
  from: SeoAuditStage;
  to: SeoAuditStage;
  label: string;
}

export function stageRows(paid: boolean): StageRow[] {
  const rows: StageRow[] = (["probing", "crawling", "pagespeed", "verifying"] as const).map((st) => ({
    id: st,
    from: st,
    to: st,
    label: STATUS[st],
  }));
  if (paid)
    rows.push({
      id: "paid",
      from: "authority",
      to: "competitors",
      label: "Desktop PageSpeed, authority, rankings, competitors, page-one comparison and brand reputation",
    });
  rows.push({ id: "scoring", from: "scoring", to: "scoring", label: scoringLabel(paid) });
  return rows;
}

export function rowState(row: StageRow, stage: SeoAuditStage): "done" | "active" | "pending" {
  const idx = stageRank(stage);
  if (stageRank(row.to) < idx) return "done";
  if (stageRank(row.from) <= idx && idx <= stageRank(row.to)) return "active";
  return "pending";
}
