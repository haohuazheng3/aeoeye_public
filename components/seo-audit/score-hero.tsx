import Link from "next/link";
import { Download, Lock } from "lucide-react";
import type { SeoAuditResult } from "@/lib/seo-audit/types";
import { ScoreRing } from "./score-ring";
import { RerunLink } from "./rerun-link";
import { gradeChip, timeAgo } from "./dimension-meta";
import { scoreValue, usableRanking } from "./ranking-meta";

/* ============================================================
   报告首屏 —— 固定顺序(V2-5):域名 + 分数环 + 等级 + "N critical · N high"
   + "Audited 20 pages · 2 min ago · Re-run"。被 WAF 拦截(outcome=blocked)时不出分,
   环与等级都不渲染,由 OutcomeNotice 解释原因。

   v3:付费完整版且排名分可用时,大环换成 SEO Ranking Score(报告的结论),
   免费技术分退为环下一行 "Technical foundation N · Grade X"(它就是第 5 支柱,同一个数)。
   头部和下面的排名板块各放一个大环会让买家分不清哪个才是结论(集成方 2026-10-01)。
   免费 / 被拦 / 已解锁但排名分缺失:头部保持原样,大环 = Technical SEO score。
   ============================================================ */

export function ScoreHero({
  result,
  id,
  unlocked,
  completedAt,
}: {
  result: SeoAuditResult;
  id: string;
  unlocked: boolean;
  completedAt?: Date | string | null;
}) {
  const blocked = result.meta.outcome === "blocked";
  const fails = result.checks.filter((c) => c.status === "fail");
  const critical = fails.filter((c) => c.severity === "critical").length;
  const high = fails.filter((c) => c.severity === "high").length;
  const warnings = result.checks.filter((c) => c.status === "warn").length;
  const when = timeAgo(completedAt ?? result.generatedAt);
  const cached = !!result.meta.cachedFrom;
  const pages = result.meta.pagesCrawled;
  // 判据与 report-view 共用 usableRanking:头部换了大环,正文就一定有排名板块
  const ranking = unlocked && !blocked ? usableRanking(result.ranking) : null;
  // usableRanking 已保证总分是有限数;scoreValue 再取整夹到 0-100,环里不会出现小数
  const ringScore = ranking ? (scoreValue(ranking.overall.score) ?? 0) : result.overall.score;
  const ringGrade = ranking ? ranking.overall.grade : result.overall.grade;
  const ringName = ranking ? "SEO Ranking Score" : "Technical SEO score";

  return (
    <div className="card p-7 sm:p-9">
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <p className="eyebrow shrink-0">{ranking ? "SEO report" : "Technical SEO report"}</p>
          <div className="flex items-center gap-2">
            {unlocked ? (
              <a
                href={`/api/seo-audit/${id}/export`}
                className="btn-ghost px-3 py-2 text-sm sm:px-4"
                download
                aria-label="Export this report as JSON"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">JSON</span>
              </a>
            ) : (
              <span className="chip px-3 py-1.5 text-xs text-ink/50" title="JSON export is part of the full report">
                <Lock className="h-3.5 w-3.5" /> JSON export
              </span>
            )}
          </div>
        </div>

        {/* 桌面:左栏域名 + 结论,右栏跨行的分数环;移动端塌成 域名 → 分数 → 结论 */}
        <div className="mt-6 grid items-center gap-x-8 gap-y-6 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0 sm:col-start-1 sm:row-start-1">
            <h1 className="break-words font-display text-3xl font-semibold tracking-tight sm:text-4xl">{result.domain}</h1>
            <p className="mt-1.5 truncate text-sm text-ink/45">{result.entryUrl}</p>
          </div>

          {!blocked && (
            <div className="mx-auto flex flex-col items-center sm:col-start-2 sm:row-span-2 sm:row-start-1">
              <ScoreRing score={ringScore} size={128} label={`${ringName} ${ringScore} out of 100`} />
              <div className="mt-2 flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${gradeChip(ringGrade)}`}>
                  Grade {ringGrade}
                </span>
                <span className="text-[11px] text-ink/40">{ringName}</span>
              </div>
              {ranking && (
                <>
                  <a href="#technical-foundation" className="mt-1.5 text-[11px] text-ink/45 hover:text-ink">
                    Technical foundation <span className="font-semibold tabular-nums text-ink/60">{result.overall.score}</span> · Grade{" "}
                    {result.overall.grade}
                  </a>
                  {ranking.overall.capped && (
                    <p className="mt-1.5 max-w-[16rem] text-center text-xs text-ink/45">
                      {ranking.overall.note || "Capped until the technical blockers below are fixed."}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="min-w-0 sm:col-start-1 sm:row-start-2">
            {!blocked && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink/75">
                <span className={critical > 0 ? "text-coral-deep" : ""}>
                  {critical} critical
                </span>
                <span className="text-ink/25">·</span>
                <span className={high > 0 ? "text-amber-700" : ""}>{high} high</span>
                <span className="text-ink/25">·</span>
                <span>{warnings} warning{warnings === 1 ? "" : "s"}</span>
              </p>
            )}
            {result.meta.scoreNote && !blocked && (
              <p className="mt-1.5 text-xs text-ink/45">
                {/* 大环换成排名分后,这句口径说明说的仍是技术分 —— 标明归属,免得被读成排名分的口径 */}
                {ranking ? `Technical foundation: ${result.meta.scoreNote}` : result.meta.scoreNote}
              </p>
            )}
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink/45">
              <span>
                Audited {pages} page{pages === 1 ? "" : "s"}
              </span>
              {when && (
                <>
                  <span className="text-ink/25">·</span>
                  <span>
                    {cached ? "Cached result from " : ""}
                    {when}
                  </span>
                </>
              )}
              <span className="text-ink/25">·</span>
              <RerunLink id={id} url={result.entryUrl} unlocked={unlocked} />
              <span className="text-ink/25">·</span>
              <Link href="/seo-audit/how-we-score" className="hover:text-ink">
                How we score
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
