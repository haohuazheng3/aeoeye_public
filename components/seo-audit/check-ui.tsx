import Link from "next/link";
import { CheckCircle2, XCircle, AlertTriangle, Info, Minus, ExternalLink, Lock } from "lucide-react";
import type { CheckStatus, SeoCheck, Severity } from "@/lib/seo-audit/types";
import { UnlockButton } from "@/components/report/unlock";

/* ============================================================
   检查项的公共视觉语言 —— 维度灯箱与 Top issues 卡共用,保证同一条检查
   在两处长得一样(状态图标、严重度徽章、证据/修法块的排版)。
   ============================================================ */

export const STATUS_UI: Record<CheckStatus, { label: string; Icon: typeof CheckCircle2; cls: string; rank: number }> = {
  fail: { label: "Fail", Icon: XCircle, cls: "text-coral", rank: 0 },
  warn: { label: "Warning", Icon: AlertTriangle, cls: "text-amber-600", rank: 1 },
  info: { label: "Info", Icon: Info, cls: "text-iris", rank: 2 },
  pass: { label: "Pass", Icon: CheckCircle2, cls: "text-mint", rank: 3 },
  na: { label: "Not measured", Icon: Minus, cls: "text-ink/30", rank: 4 },
};

export const SEVERITY_UI: Record<Severity, { label: string; chip: string; rank: number }> = {
  critical: { label: "Critical", chip: "bg-coral/10 text-coral-deep", rank: 0 },
  high: { label: "High", chip: "bg-amber-500/10 text-amber-700", rank: 1 },
  medium: { label: "Medium", chip: "bg-iris/10 text-iris", rank: 2 },
  low: { label: "Low", chip: "bg-ink/[0.05] text-ink/55", rank: 3 },
};

/** 排序:fail → warn → info → pass → na;同状态按严重度;再按受影响页数降序 */
export function sortChecks(checks: SeoCheck[]): SeoCheck[] {
  return [...checks].sort((a, b) => {
    const s = STATUS_UI[a.status].rank - STATUS_UI[b.status].rank;
    if (s !== 0) return s;
    const v = SEVERITY_UI[a.severity].rank - SEVERITY_UI[b.severity].rank;
    if (v !== 0) return v;
    return (b.affectedCount ?? b.affected.length) - (a.affectedCount ?? a.affected.length);
  });
}

/** 受影响页数:页面级检查优先用 affectedCount(免费视图里 affected 会被截短) */
export function affectedPages(c: SeoCheck): number {
  return c.affectedCount ?? c.affected.length;
}

/** 是否属于"需要处理"的问题(fail / warn);pass、info、na 都不是 */
export function isIssue(c: SeoCheck): boolean {
  return c.status === "fail" || c.status === "warn";
}

export function StatusIcon({ status, className = "h-4 w-4" }: { status: CheckStatus; className?: string }) {
  const ui = STATUS_UI[status];
  return <ui.Icon className={`${className} shrink-0 ${ui.cls}`} aria-label={ui.label} />;
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const ui = SEVERITY_UI[severity];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ui.chip}`}>
      {ui.label}
    </span>
  );
}

/** 精简 URL 显示:去协议与末尾斜杠,超长中间省略 */
export function shortUrl(u: string, max = 64): string {
  const s = (u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.floor(max * 0.6))}…${s.slice(-Math.floor(max * 0.3))}`;
}

/**
 * 证据 + 修法 + 受影响页 + 文档链接 —— "完整细节"块。
 * 免费视图里只有 critical/high(≤8 条)与 top issues 带这些字段;其余检查走 LockedTeaser。
 */
export function CheckDetail({ check, compact = false }: { check: SeoCheck; compact?: boolean }) {
  const pages = affectedPages(check);
  const list = check.affected.length ? check.affected : check.sample ?? [];
  const hiddenMore = Math.max(0, pages - list.length);
  return (
    <div className={compact ? "mt-2 space-y-2.5" : "mt-3 space-y-3"}>
      {check.evidence.length > 0 && (
        <ul className="space-y-1 text-sm leading-relaxed text-ink/65">
          {check.evidence.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink/30" />
              <span className="min-w-0 break-words">{e}</span>
            </li>
          ))}
        </ul>
      )}
      {check.fix && (
        <div className="rounded-2xl bg-iris/[0.06] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-iris">How to fix</p>
          <p className="mt-1 text-sm leading-relaxed text-ink/75">{check.fix}</p>
        </div>
      )}
      {list.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40">
            {pages > 0 ? `Affects ${pages} page${pages === 1 ? "" : "s"}` : "Affected URLs"}
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[12px] text-ink/60">
            {list.map((u) => (
              <li key={u} className="truncate">
                <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-ink">
                  {shortUrl(u, 80)}
                </a>
              </li>
            ))}
            {hiddenMore > 0 && <li className="font-sans text-ink/40">+ {hiddenMore} more in the full report</li>}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/45">
        <span>Effort: {check.effort}</span>
        {check.docs && (
          <Link href={check.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-iris hover:underline">
            Official docs <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** 数据供应商不可用时,所有解锁入口统一换成这句(复审 C28:卖一份此刻交付不了的报告是事故) */
export const UNLOCK_UNAVAILABLE = "Full report temporarily unavailable — try again shortly";

/**
 * 锁定检查的一行预告:"affects N pages · 1 sample URL",视觉模糊 + 锁图标 + 解锁。
 * 数字是真的(affectedCount 与 sample[0] 由服务端 toPublicView 留下),
 * 模糊的只是证据与修法 —— 这里绝不渲染任何被服务端清空的字段。
 * available=false(DataForSEO 不可用)时不摆解锁按钮,换成一句不可用说明。
 */
export function LockedTeaser({ check, auditId, available = true }: { check: SeoCheck; auditId: string; available?: boolean }) {
  const pages = affectedPages(check);
  const sample = check.sample?.[0];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink/55">
      <span className="inline-flex items-center gap-1.5">
        <Lock className="h-3 w-3 text-ink/40" />
        {pages > 0 ? `Affects ${pages} page${pages === 1 ? "" : "s"}` : "Details locked"}
        {sample ? (
          <>
            {" · "}
            <span className="font-mono">{shortUrl(sample, 40)}</span>
          </>
        ) : null}
      </span>
      <span className="select-none blur-[3px]" aria-hidden="true">
        Evidence and step-by-step fix
      </span>
      {available ? (
        <UnlockButton
          auditId={auditId}
          product="seo_report"
          className="inline-flex items-center gap-1 text-xs font-semibold text-iris hover:underline disabled:opacity-60"
        >
          Unlock
        </UnlockButton>
      ) : (
        <span className="text-ink/45">{UNLOCK_UNAVAILABLE}</span>
      )}
    </div>
  );
}
