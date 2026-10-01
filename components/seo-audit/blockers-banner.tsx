import { AlertTriangle } from "lucide-react";
import type { SeoAuditResult } from "@/lib/seo-audit/types";
import { CheckDetail } from "./check-ui";

/* ============================================================
   "Fix this first" —— 致命项(gate)横幅。
   入口非 200 / 入口 noindex / robots 全禁 / 无 https / 证书过期 任一 fail,
   总分被封顶 ≤40、等级 F。其余几十条检查这时都是噪音,所以单独顶在最上面,
   连修法一起给(gate 项永远是 critical,免费视图里本来就完整可见)。
   ============================================================ */

export function BlockersBanner({ result }: { result: SeoAuditResult }) {
  const ids = result.meta.blockers ?? [];
  if (!ids.length) return null;
  const checks = ids.map((id) => result.checks.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  if (!checks.length) return null;

  return (
    <section className="card border-coral/30 p-6 sm:p-7" aria-labelledby="blockers-title">
      <div className="relative z-10">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-coral-deep">
          <AlertTriangle className="h-3.5 w-3.5" /> Fix this first
        </p>
        <h2 id="blockers-title" className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
          {checks.length === 1 ? "One blocker caps your score at 40" : `${checks.length} blockers cap your score at 40`}
        </h2>
        <p className="mt-1 text-sm text-ink/55">
          Google can&rsquo;t reliably index a site with these problems, so nothing else on this report matters until
          they&rsquo;re fixed. Re-run the audit afterwards to get your real score.
        </p>
        <div className="mt-5 space-y-4">
          {checks.map((c) => (
            <div key={c.id} className="surface p-4 sm:p-5">
              <p className="font-medium text-ink">{c.title}</p>
              <CheckDetail check={c} compact />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
