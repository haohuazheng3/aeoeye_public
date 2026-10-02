import Link from "next/link";
import { Info, AlertCircle } from "lucide-react";
import type { SeoAuditResult } from "@/lib/seo-audit/types";
import { ScoreHero } from "./score-hero";
import { BlockersBanner } from "./blockers-banner";
import { OutcomeNotice } from "./outcome-notice";
import { TopIssues } from "./top-issues";
import { DimensionGrid } from "./dimension-grid";
import { PerformancePanel } from "./performance-panel";
import { UnlockCard } from "./unlock-card";
import { PaidSections } from "./paid-sections";
import { CrossSell } from "./cross-sell";
import { RankingSection, RankingUnavailable } from "./ranking-section";
import { RankingLocked } from "./ranking-locked";
import { usableRanking } from "./ranking-meta";

/* ============================================================
   SEO 报告页的组装层。顺序固定(V2-5,v3 加入排名分):
   头部(域名 · 分数环 · 等级 · N critical · N high · Audited 20 pages · 2 min ago · Re-run)
   → 前置门说明(blocked / limited)
   → 已解锁:SEO Ranking Score(算出 → 五支柱板块;缺失 → 小提示 + 重跑)→ Technical foundation 分隔标题(免费技术分 = 第 5 支柱)
   → Fix this first 横幅 → Top issues → (免费:排名分锁定预告 —— 放在免费的最严重问题之后,先给答案再谈升级)
   → 7 维度栅格 → Performance → 解锁卡(未解锁)→ 付费模块区 → 交叉销售 → 备注与免责。
   被 WAF 拦截时只有头部 + 说明 + 免责:没有分数、没有锁定卡、也没有排名分。
   透明容器露出全站蒸汽背景,一切内容装进悬浮玻璃模块,模块间大留白。
   ============================================================ */

/**
 * 重跑失败的原因 → 一句能接在 "didn't finish:" 后面的话。
 * 后端写的是 "Re-run failed: …" / "Re-run timed out" / "Re-run blocked: …",原样拼会变成
 * "didn't finish: Re-run failed: …";认不出的格式原样显示,不猜。
 */
function rerunReason(error: string): string {
  const raw = error.trim().replace(/\.+$/, "");
  const m = /^re-?run\s+(failed|timed out|blocked)\s*:?\s*(.*)$/i.exec(raw);
  if (!m) return raw;
  const kind = m[1].toLowerCase();
  const rest = m[2].trim();
  if (kind === "timed out") return rest ? `it timed out (${rest})` : "it timed out";
  if (kind === "blocked") return rest ? `our crawler was blocked (${rest})` : "our crawler was blocked";
  return rest || "it failed";
}

export function SeoReportView({
  result,
  id,
  unlocked,
  dfsReady = true,
  completedAt,
  rerunError = null,
}: {
  result: SeoAuditResult;
  id: string;
  unlocked: boolean;
  /** DataForSEO 是否就绪;false 时**所有**解锁入口(解锁卡、锁定模块、灯箱里的锁定检查)都不摆按钮 */
  dfsReady?: boolean;
  completedAt?: Date | string | null;
  /** complete 行上的 error = 上一次重跑没跑完;下面展示的仍是之前那份成功的报告 */
  rerunError?: string | null;
}) {
  const blocked = result.meta.outcome === "blocked";
  const notes = [...new Set(result.meta.notes)];
  // 与 ScoreHero 用同一个判据:头部顶着排名分时,正文一定有排名分板块,反之亦然
  const ranking = unlocked ? usableRanking(result.ranking) : null;

  return (
    <div className="container-tight min-w-0 space-y-8 py-10 sm:space-y-10 sm:py-16">
      {rerunError && (
        <div className="surface flex items-start gap-3 p-4 sm:p-5" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
          <p className="min-w-0 break-words text-sm leading-relaxed text-ink/65">
            Your last re-run didn&rsquo;t finish: {rerunReason(rerunError)}. The report below is from the previous
            successful run.
          </p>
        </div>
      )}

      <ScoreHero result={result} id={id} unlocked={unlocked} completedAt={completedAt} />

      <OutcomeNotice result={result} id={id} unlocked={unlocked} />

      {!blocked && (
        <>
          {unlocked && (
            <>
              {ranking ? <RankingSection ranking={ranking} /> : <RankingUnavailable id={id} url={result.entryUrl} />}

              {/* 免费技术分在排名框架里是第 5 支柱("门槛")—— 下面的技术区整体归到这个标题下 */}
              <div id="technical-foundation" className="min-w-0 scroll-mt-28 pt-2">
                <div className="flex items-center gap-4">
                  <h2 className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-iris">Technical foundation</h2>
                  <span className="h-px min-w-0 flex-1 bg-ink/[0.08]" aria-hidden="true" />
                </div>
                <p className="mt-2 text-sm text-ink/45">
                  The free Technical SEO score, in detail — the threshold every other pillar stands on.
                </p>
              </div>
            </>
          )}

          <BlockersBanner result={result} />
          <TopIssues result={result} />
          {/* 免费视图:先给免费的最严重问题(用户来了马上拿到答案),再放排名分预告;
              预告里"技术支柱免费"那条链接指向下面的维度栅格 */}
          {!unlocked && <RankingLocked id={id} dfsReady={dfsReady} />}
          <div id={unlocked ? undefined : "technical-foundation"} className="min-w-0 scroll-mt-28">
            <DimensionGrid result={result} id={id} unlocked={unlocked} dfsReady={dfsReady} />
          </div>
          <PerformancePanel result={result} unlocked={unlocked} />
          {!unlocked && <UnlockCard result={result} id={id} dfsReady={dfsReady} />}
          <PaidSections result={result} id={id} unlocked={unlocked} dfsReady={dfsReady} />
          <CrossSell domain={result.domain} />
        </>
      )}

      {notes.length > 0 && (
        <div className="surface p-4 sm:p-5">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">
            <Info className="h-3.5 w-3.5" /> Notes from this run
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink/55">
            {notes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="px-2 text-center text-[11px] leading-relaxed text-ink/40">
        Automated audit of publicly reachable pages at a single point in time ({new Date(result.generatedAt).toUTCString().replace(" GMT", " UTC")}).
        Sampled {result.meta.pagesCrawled} of the site&rsquo;s pages; PageSpeed data is a single run; off-site figures are third-party estimates.
        {ranking && !blocked
          ? " The SEO Ranking Score is a published, rule-based model of ranking factors, not a prediction of positions."
          : ""}{" "}
        AEOeye is not affiliated with the audited site. <Link href="/seo-audit/how-we-score" className="text-iris hover:underline">How we score</Link> ·{" "}
        <Link href="/bot" className="text-iris hover:underline">About our crawler</Link>
      </p>
    </div>
  );
}
