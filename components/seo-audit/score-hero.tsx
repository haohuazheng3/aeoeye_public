import Link from "next/link";
import { Download, Lock } from "lucide-react";
import type { SeoAuditResult } from "@/lib/seo-audit/types";
import { ScoreRing } from "./score-ring";
import { RerunLink } from "./rerun-link";
import { gradeChip, timeAgo } from "./dimension-meta";

/* ============================================================
   报告首屏 —— 固定顺序(V2-5):域名 + 分数环 + 等级 + "N critical · N high"
   + "Audited 20 pages · 2 min ago · Re-run"。被 WAF 拦截(outcome=blocked)时不出分,
   环与等级都不渲染,由 OutcomeNotice 解释原因。
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

  return (
    <div className="card p-7 sm:p-9">
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <p className="eyebrow shrink-0">Technical SEO report</p>
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
              <ScoreRing score={result.overall.score} size={128} label={`Technical SEO score ${result.overall.score} out of 100`} />
              <div className="mt-2 flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${gradeChip(result.overall.grade)}`}>
                  Grade {result.overall.grade}
                </span>
                <span className="text-[11px] text-ink/40">Technical SEO score</span>
              </div>
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
              <p className="mt-1.5 text-xs text-ink/45">{result.meta.scoreNote}</p>
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
