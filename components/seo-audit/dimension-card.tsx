"use client";

import { AlertTriangle } from "lucide-react";
import type { DimensionScore, SeoCheck } from "@/lib/seo-audit/types";
import { Lightbox, MoreAffordance, useLightbox } from "@/components/report/lightbox";
import { ScoreRing } from "./score-ring";
import { DIMENSION_ICON } from "./dimension-meta";
import { CheckDetail, LockedTeaser, SeverityChip, StatusIcon, isIssue, sortChecks } from "./check-ui";

/* ============================================================
   一个维度 = 一张可点开的卡(镜像地基层 ModuleCard)。
   折叠态:分数环 + 图标 + 一句结论 + pass/warn/fail 计数 + "See all N checks";
   灯箱:该维度全部检查 —— 解锁或免费完整细节的检查展开证据/修法/受影响页,
   锁定的检查只给一行模糊预告 + 锁 + 解锁按钮(数据层已由 toPublicView 清空,
   这里的模糊只是视觉,不是安全边界)。
   ============================================================ */

export function DimensionCard({
  dim,
  checks,
  auditId,
  unlocked,
  dfsReady = true,
  lowConfidence = false,
  unmeasured = false,
}: {
  dim: DimensionScore;
  checks: SeoCheck[];
  auditId: string;
  unlocked: boolean;
  /** false = 数据供应商不可用,锁定检查只给预告、不给解锁按钮 */
  dfsReady?: boolean;
  lowConfidence?: boolean;
  unmeasured?: boolean;
}) {
  const [open, show, hide] = useLightbox();
  const sorted = sortChecks(checks);
  const Icon = DIMENSION_ICON[dim.id];
  const issues = sorted.filter(isIssue).length;
  const measured = dim.pass + dim.warn + dim.fail;

  return (
    <>
      <button
        onClick={show}
        aria-haspopup="dialog"
        className="card group min-w-0 w-full p-5 text-left transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-float-lg sm:p-6"
      >
        <div className="relative z-10 flex items-start gap-4">
          <ScoreRing score={dim.score} label={`${dim.label} score ${dim.score ?? "unavailable"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 text-iris" />
              <span className="eyebrow truncate">{dim.label}</span>
            </div>
            <p className="mt-1.5 font-display text-[15px] font-semibold leading-snug text-ink sm:text-base">
              {dim.score === null ? (unmeasured ? "Not measured on this run" : "Insufficient data") : dim.summary}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-medium text-ink/50">
              {dim.fail > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-coral" /> {dim.fail} fail
                </span>
              )}
              {dim.warn > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {dim.warn} warn
                </span>
              )}
              {dim.pass > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-mint" /> {dim.pass} pass
                </span>
              )}
              {dim.na > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink/20" /> {dim.na} n/a
                </span>
              )}
              {measured === 0 && dim.na === 0 && <span>No checks</span>}
            </div>
            {sorted.length > 0 && <MoreAffordance label={`See all ${sorted.length} checks`} />}
          </div>
        </div>
      </button>

      <Lightbox open={open} onClose={hide} eyebrow={dim.label} title={dim.score === null ? "Insufficient data" : dim.summary}>
        <div className="mb-5 flex items-center gap-4 rounded-2xl bg-ink/[0.03] p-4">
          <ScoreRing score={dim.score} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {dim.score === null ? "Not scored" : `${dim.score}/100`} · {dim.weight}% of the total score
            </p>
            <p className="mt-0.5 text-xs text-ink/45">
              {dim.pass} pass · {dim.warn} warn · {dim.fail} fail · {dim.na} not measured
              {issues > 0 ? ` · ${issues} to fix` : ""}
            </p>
          </div>
        </div>
        {(lowConfidence || unmeasured) && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl bg-amber-500/[0.07] p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm leading-relaxed text-ink/60">
              {unmeasured
                ? "This dimension couldn't be measured on this run, so it is excluded from the total score."
                : "Fewer than 5 pages were crawled, so this dimension is low-confidence and excluded from the total score."}
            </p>
          </div>
        )}
        <div>
          {sorted.map((c) => (
            <CheckRow key={c.id} check={c} auditId={auditId} unlocked={unlocked} dfsReady={dfsReady} />
          ))}
          {sorted.length === 0 && <p className="text-sm text-ink/45">No checks ran for this dimension.</p>}
        </div>
      </Lightbox>
    </>
  );
}

function CheckRow({
  check,
  auditId,
  unlocked,
  dfsReady,
}: {
  check: SeoCheck;
  auditId: string;
  unlocked: boolean;
  dfsReady: boolean;
}) {
  const hasDetail = check.evidence.length > 0 || !!check.fix;
  const locked = !unlocked && !!check.locked && !hasDetail && isIssue(check);
  return (
    <div className="border-t border-ink/[0.06] py-4 first:border-0 first:pt-0">
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="flex min-w-0 items-start gap-2 font-medium text-ink">
          <StatusIcon status={check.status} className="mt-0.5 h-4 w-4" />
          <span className="min-w-0 break-words">{check.title}</span>
        </p>
        {check.status !== "pass" && check.status !== "na" && <SeverityChip severity={check.severity} />}
      </div>
      {hasDetail && <CheckDetail check={check} compact />}
      {locked && <LockedTeaser check={check} auditId={auditId} available={dfsReady} />}
    </div>
  );
}
