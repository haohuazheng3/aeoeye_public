import { Gauge, Info } from "lucide-react";
import type { PsiAudit, PsiResult, SeoAuditResult } from "@/lib/seo-audit/types";
import { PageTable } from "./page-table";

/* ============================================================
   Performance 面板 —— CrUX 优先。

   头条四格是**真实用户 p75(移动端)**:LCP / INP / CLS / TTFB,阈值与 Google 官方一致。
   Lighthouse 分只是一个小信息胶囊 —— 它是单次实验室跑分,波动大,不能当结论。
   没有 CrUX 数据(小站常见)时退回实验室值,但明确标 "lab · single run",不上色。
   解锁后加桌面端四格与完整审计表(移动 + 桌面并排)。
   ============================================================ */

type Rating = "good" | "ni" | "poor" | null;

const METRICS: {
  key: "lcpMs" | "inpMs" | "cls" | "ttfbMs";
  label: string;
  unit: "ms" | "s" | "";
  good: number;
  ni: number;
  lab?: (r: PsiResult) => number | null;
}[] = [
  { key: "lcpMs", label: "LCP", unit: "s", good: 2500, ni: 4000, lab: (r) => r.lab.lcpMs },
  { key: "inpMs", label: "INP", unit: "ms", good: 200, ni: 500 },
  { key: "cls", label: "CLS", unit: "", good: 0.1, ni: 0.25, lab: (r) => r.lab.cls },
  { key: "ttfbMs", label: "TTFB", unit: "ms", good: 800, ni: 1800, lab: (r) => r.lab.serverResponseMs },
];

function rate(v: number | null, good: number, ni: number): Rating {
  if (v === null || !Number.isFinite(v)) return null;
  if (v <= good) return "good";
  if (v <= ni) return "ni";
  return "poor";
}

function fmt(v: number | null, unit: "ms" | "s" | ""): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (unit === "s") return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s`;
  if (unit === "ms") return `${Math.round(v)} ms`;
  return v.toFixed(2);
}

const RATING_UI: Record<Exclude<Rating, null>, { label: string; cls: string; dot: string }> = {
  good: { label: "Good", cls: "text-mint-deep", dot: "bg-mint" },
  ni: { label: "Needs improvement", cls: "text-amber-700", dot: "bg-amber-500" },
  poor: { label: "Poor", cls: "text-coral-deep", dot: "bg-coral" },
};

function Tiles({ psi, strategy }: { psi: PsiResult; strategy: "mobile" | "desktop" }) {
  const field = psi.fieldMetrics ?? null;
  const hasField = !!field && (field.lcpMs !== null || field.inpMs !== null || field.cls !== null || field.ttfbMs !== null);
  const caption = hasField
    ? `real users · p75 · ${strategy}${field?.source === "origin" ? " · whole origin" : ""}`
    : `lab · single run · ${strategy}`;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">{caption}</p>
      <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {METRICS.map((m) => {
          const fieldVal = hasField ? (field?.[m.key] ?? null) : null;
          const labVal = !hasField && m.lab ? m.lab(psi) : null;
          const v = hasField ? fieldVal : labVal;
          const r = hasField ? rate(v, m.good, m.ni) : null;
          const ui = r ? RATING_UI[r] : null;
          return (
            <div key={m.key} className="surface p-3.5 sm:p-4">
              <p className="text-[11px] font-semibold text-ink/50">{m.label}</p>
              <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${ui?.cls ?? "text-ink"}`}>{fmt(v, m.unit)}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/45">
                {ui ? (
                  <>
                    <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} /> {ui.label}
                  </>
                ) : v === null ? (
                  "No data"
                ) : (
                  "Lab estimate"
                )}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scoreChip(label: string, n: number | null) {
  if (n === null) return null;
  return (
    <span key={label} className="chip px-3 py-1.5 text-xs">
      <Gauge className="h-3.5 w-3.5 text-iris" /> {label} {Math.round(n)}
    </span>
  );
}

function auditVerdict(a: PsiAudit | undefined): string {
  if (!a) return "—";
  if (a.score === null) return a.displayValue || "info";
  const v = a.score >= 0.9 ? "Pass" : a.score >= 0.5 ? "Warn" : "Fail";
  return a.displayValue ? `${v} · ${a.displayValue}` : v;
}

export function PerformancePanel({ result, unlocked }: { result: SeoAuditResult; unlocked: boolean }) {
  const mobile = result.psi.mobile;
  const desktop = unlocked ? result.psi.desktop : null;
  const psiNotes = result.meta.notes.filter((n) => /pagespeed|psi|lighthouse/i.test(n));

  return (
    <section className="card p-6 sm:p-8">
      <div className="relative z-10 min-w-0 space-y-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Performance</h2>
          <p className="mt-1 text-sm text-ink/45">
            Core Web Vitals from real Chrome users where available; Lighthouse is the diagnostic layer, not the verdict.
          </p>
        </div>

        {!mobile || mobile.error ? (
          <div className="surface flex items-start gap-3 p-4 sm:p-5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-iris" />
            <div className="text-sm leading-relaxed text-ink/65">
              <p className="font-medium text-ink">PageSpeed Insights didn&rsquo;t return data on this run.</p>
              <p className="mt-1">
                Performance and mobile PSI checks are marked not measured and the score is based on the remaining
                dimensions. Re-run in a few minutes — PSI is rate-limited and occasionally slow.
              </p>
              {psiNotes.map((n) => (
                <p key={n} className="mt-1 text-xs text-ink/45">
                  {n}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <>
            <Tiles psi={mobile} strategy="mobile" />
            <div className="flex flex-wrap items-center gap-2">
              {scoreChip("Lighthouse performance", mobile.scores.performance)}
              {unlocked && scoreChip("SEO", mobile.scores.seo)}
              {unlocked && scoreChip("Accessibility", mobile.scores.accessibility)}
              {unlocked && scoreChip("Best practices", mobile.scores.bestPractices)}
              <span className="text-[11px] text-ink/40">
                lab, single run{mobile.fetchTime ? ` · ${new Date(mobile.fetchTime).toUTCString().replace(" GMT", " UTC")}` : ""}
              </span>
            </div>
            {desktop && !desktop.error && <Tiles psi={desktop} strategy="desktop" />}
            {unlocked && (
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">Full Lighthouse audits</p>
                <div className="mt-2.5">
                  <PageTable
                    caption="Lighthouse audits, mobile and desktop"
                    minWidth={640}
                    columns={[
                      { key: "audit", label: "Audit" },
                      { key: "mobile", label: "Mobile", className: "whitespace-nowrap" },
                      { key: "desktop", label: "Desktop", className: "whitespace-nowrap" },
                    ]}
                    rows={mergeAudits(mobile, desktop).map((r) => ({
                      audit: r.title,
                      mobile: auditVerdict(r.mobile),
                      desktop: r.desktop ? auditVerdict(r.desktop) : "—",
                    }))}
                    empty="No audit details were returned by PageSpeed Insights."
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function mergeAudits(mobile: PsiResult, desktop: PsiResult | null): { id: string; title: string; mobile?: PsiAudit; desktop?: PsiAudit }[] {
  const byId = new Map<string, { id: string; title: string; mobile?: PsiAudit; desktop?: PsiAudit }>();
  for (const a of mobile.audits ?? []) byId.set(a.id, { id: a.id, title: a.title, mobile: a });
  for (const a of desktop?.audits ?? []) {
    const row = byId.get(a.id) ?? { id: a.id, title: a.title };
    row.desktop = a;
    byId.set(a.id, row);
  }
  // 失败的审计排前面:表格是拿来找问题的,不是拿来欣赏通过项的
  return [...byId.values()].sort((x, y) => (x.mobile?.score ?? 1) - (y.mobile?.score ?? 1));
}
