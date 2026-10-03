import { Check, Lock } from "lucide-react";
import type { SeoAuditResult } from "@/lib/seo-audit/types";
import { FULL_CRAWL_PAGES, PILLAR_IDS, RANKING_SUBS } from "@/lib/seo-audit/types";
import { UnlockButton } from "@/components/report/unlock";
import { UNLOCK_UNAVAILABLE, isIssue } from "./check-ui";
import { roadmapCounts } from "./locked-meta";
import { UnlockWithKeywords } from "./target-keywords";

/* ============================================================
   解锁卡 —— 免费报告最重要的钩子,文案结果导向(V2-5):
   "Get the fix list for all {pages} pages — $10",下面 "One-time. No account needed."
   每条卖点都带一个**从这份报告数出来**的数字,付费后逐条可核对 —— 吹不了。
   v4:按钮下方可选填目标关键词(≤3);付款前先保存(UnlockWithKeywords 的点击守卫),
   完整版生成时就会先拿这几个词去对比。
   DataForSEO 不可用(dfsReady=false)时不摆按钮:卖一份此刻交付不了的东西是事故。
   文案与锁定模块、灯箱预告共用 UNLOCK_UNAVAILABLE,全页只有一种说法(复审 C28)。
   ============================================================ */

export function UnlockCard({ result, id, dfsReady = true }: { result: SeoAuditResult; id: string; dfsReady?: boolean }) {
  const pages = result.meta.pagesCrawled;
  const issues = result.checks.filter(isIssue);
  const lockedIssues = issues.filter((c) => c.locked && c.evidence.length === 0).length;
  const roadmap = roadmapCounts(result.meta.lockedSections);
  const roadmapTotal = roadmap ? roadmap.this_week + roadmap.this_month + roadmap.later : 0;
  const pagesLabel = pages > 0 ? `all ${pages} pages` : "every page";

  const perks = [
    // 完整版的头条 —— 支柱数与小维度数取自类型层常量,与锁定预告、方法论页同源
    `SEO Ranking Score: ${PILLAR_IDS.length} pillars and ${RANKING_SUBS.length} sub-scores, from search intent and E-E-A-T to winnability and AI Overviews — your pages compared with the ones on page one`,
    lockedIssues > 0
      ? `Evidence, affected URLs and a step-by-step fix for the ${lockedIssues} issue${lockedIssues === 1 ? "" : "s"} still locked (${issues.length} found in total)`
      : `Evidence, affected URLs and a step-by-step fix for every one of the ${issues.length} issues found`,
    `Page-by-page table for ${pagesLabel}: title, description, H1, word count, canonical, noindex, internal links, problems`,
    roadmapTotal > 0
      ? `Prioritised roadmap — ${roadmapTotal} fixes bucketed into this week, this month and later`
      : "Prioritised roadmap — every fix bucketed into this week, this month and later",
    "Authority & backlinks, ranked keywords and quick wins, top-5 competitors and your brand's reputation on Google (DataForSEO)",
    `Re-crawl of up to ${FULL_CRAWL_PAGES} pages, desktop PageSpeed and the full Lighthouse audit list`,
    "Your own target keywords, optional Search Console data (read-only), JSON export and 30 days of re-runs",
  ];

  return (
    <section className="card p-7 sm:p-9" aria-labelledby="unlock-title">
      <div className="relative z-10 grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-center">
        <div className="min-w-0">
          <p className="eyebrow">Full report</p>
          <h2 id="unlock-title" className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Get the fix list for {pagesLabel} — $10
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink/55">
            You&rsquo;ve seen the score and the three worst problems. The full report is the working document: every
            check with its evidence, every page with its problems, in the order you should fix them.
          </p>
          <ul className="mt-5 space-y-2">
            {perks.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm text-ink/65">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-iris" /> {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          {dfsReady ? (
            <UnlockWithKeywords auditId={id}>
              <UnlockButton auditId={id} product="seo_report" className="btn-primary w-full justify-center py-4 text-base">
                Get the fix list — $10
              </UnlockButton>
            </UnlockWithKeywords>
          ) : (
            <div className="surface flex items-start gap-3 p-4">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
              <div className="text-sm leading-relaxed text-ink/60">
                <p className="font-medium text-ink">{UNLOCK_UNAVAILABLE}</p>
                <p className="mt-1">Our ranking-data provider is offline right now. Your free report stays here.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
