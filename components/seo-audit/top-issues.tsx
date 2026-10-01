import { CheckCircle2 } from "lucide-react";
import type { SeoAuditResult } from "@/lib/seo-audit/types";
import { DIMENSIONS } from "@/lib/seo-audit/types";
import { CheckDetail, SeverityChip, StatusIcon } from "./check-ui";

/* ============================================================
   Top issues —— 3 条最严重问题的完整卡(证据 + 修法 + 受影响页),免费就全开。
   这是免费报告最有用的一屏:用户不付钱也能带走三件真能做的事。
   ============================================================ */

export function TopIssues({ result }: { result: SeoAuditResult }) {
  const checks = result.topIssues
    .map((id) => result.checks.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Top issues</h2>
        <p className="mt-1 text-sm text-ink/45">
          {checks.length > 0
            ? "The three problems costing you the most, with evidence and a fix for each — free."
            : "Nothing failing at critical or high severity."}
        </p>
      </div>
      {checks.length === 0 ? (
        <div className="surface flex items-center gap-3 p-5">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-mint" />
          <p className="text-sm text-ink/65">No critical or high-severity failures on the pages we crawled. Check the dimension cards for warnings.</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          {checks.map((c, i) => (
            <article key={c.id} className="card min-w-0 p-5 sm:p-6">
              <div className="relative z-10">
                <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40">
                    #{i + 1} · {DIMENSIONS[c.dimension]?.short ?? c.dimension}
                  </p>
                  <SeverityChip severity={c.severity} />
                </div>
                <p className="mt-2 flex items-start gap-2 font-display text-[15px] font-semibold leading-snug text-ink sm:text-base">
                  <StatusIcon status={c.status} className="mt-1 h-4 w-4" />
                  <span className="min-w-0 break-words">{c.title}</span>
                </p>
                <CheckDetail check={c} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
