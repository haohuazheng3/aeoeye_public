import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd } from "@/lib/seo";
import { DIMENSIONS, ONSITE_DIMENSIONS, FREE_CRAWL_PAGES, FULL_CRAWL_PAGES, FREE_NAV_PAGES, FULL_NAV_PAGES, SEO_GRADE_SCALE } from "@/lib/seo-audit/types";

/* ============================================================
   /seo-audit/how-we-score —— 评分模型全文公开。
   一个分数只有在阈值可查、来源可查时才值得信;这页就是那张"可查"的表。
   所有数字与 lib/seo-audit/types.ts 及 V2-1 评分规则保持一致;改规则先改这里的说明。
   ============================================================ */

export const metadata: Metadata = pageMeta({
  title: "How We Score — SEO Audit Methodology",
  description:
    "Every weight and threshold behind the AEOeye technical SEO score: dimension weights, severity weights, gate rules, page-share thresholds, Core Web Vitals thresholds, grade scale, data sources and limits.",
  path: "/seo-audit/how-we-score",
});

const CRUX = [
  { metric: "LCP (Largest Contentful Paint)", good: "≤ 2.5 s", ni: "≤ 4.0 s", poor: "> 4.0 s" },
  { metric: "INP (Interaction to Next Paint)", good: "≤ 200 ms", ni: "≤ 500 ms", poor: "> 500 ms" },
  { metric: "CLS (Cumulative Layout Shift)", good: "≤ 0.1", ni: "≤ 0.25", poor: "> 0.25" },
  { metric: "TTFB (Time to First Byte)", good: "≤ 800 ms", ni: "≤ 1800 ms", poor: "> 1800 ms" },
];

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`py-2 pr-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

export default function HowWeScorePage() {
  const onsite = ONSITE_DIMENSIONS.map((d) => DIMENSIONS[d]);
  return (
    <div className="container-tight py-12 sm:py-16">
      <nav className="text-sm text-ink/45">
        <Link href="/seo-audit" className="hover:text-ink">
          SEO Audit
        </Link>{" "}
        <span className="mx-1">/</span> How we score
      </nav>

      <header className="mt-4 max-w-2xl">
        <p className="eyebrow">Methodology</p>
        <h1 className="mt-3 font-display text-4xl font-semibold">How we score</h1>
        <p className="mt-3 text-lg text-ink/65">
          The technical SEO score is a weighted roll-up of pass / warn / fail checks across seven dimensions. Here is
          every number that goes into it.
        </p>
      </header>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {/* Dimension weights */}
        <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="weights">
          <div className="relative z-10 min-w-0">
            <h2 id="weights" className="font-display text-xl font-semibold tracking-tight">
              Dimension weights
            </h2>
            <p className="mt-1.5 text-sm text-ink/55">
              Total = Σ(dimension score × weight) ÷ Σ(weights of scored dimensions). A dimension that couldn&rsquo;t be
              measured is dropped and the rest are re-normalised; the report then says &ldquo;Based on N of 7
              dimensions&rdquo;.
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-ink/[0.06]">
                  <Th>Dimension</Th>
                  <Th right>Weight</Th>
                </tr>
              </thead>
              <tbody>
                {onsite.map((d) => (
                  <tr key={d.id} className="border-b border-ink/[0.05] last:border-0">
                    <td className="py-2 pr-3 text-ink/75">{d.label}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{d.weight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-ink/45">
              Authority, Search Visibility and Competitors (full report) are scored 0–100 on their own and never enter
              the total.
            </p>
          </div>
        </section>

        {/* Severity weights + credit */}
        <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="severity">
          <div className="relative z-10 min-w-0">
            <h2 id="severity" className="font-display text-xl font-semibold tracking-tight">
              Check weights and credit
            </h2>
            <p className="mt-1.5 text-sm text-ink/55">
              Dimension score = Σ(credit × weight) ÷ Σ(weight) × 100, rounded. Weight comes from severity; credit from
              status.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Severity → weight</p>
                <ul className="mt-2 space-y-1 text-sm text-ink/75">
                  <li>Critical · 4</li>
                  <li>High · 3</li>
                  <li>Medium · 2</li>
                  <li>Low · 1</li>
                </ul>
              </div>
              <div className="surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Status → credit</p>
                <ul className="mt-2 space-y-1 text-sm text-ink/75">
                  <li>Pass · 100%</li>
                  <li>Warn · 50%</li>
                  <li>Fail · 0%</li>
                  <li>Info / not measured · excluded</li>
                </ul>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink/45">
              Fewer than 3 measured checks in a dimension → no score for it (&ldquo;Insufficient data&rdquo;), and it is
              excluded from the total. Fewer than 5 pages crawled → Architecture is marked low-confidence and excluded.
            </p>
          </div>
        </section>

        {/* Gates */}
        <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="gates">
          <div className="relative z-10">
            <h2 id="gates" className="font-display text-xl font-semibold tracking-tight">
              Gate rules
            </h2>
            <p className="mt-1.5 text-sm text-ink/55">
              These five failures make the rest of the report moot, so they cap it. Any one failing → its dimension is
              capped at 30, the total at 40, the grade at F, and the report opens with a &ldquo;Fix this first&rdquo;
              banner.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-ink/75">
              <li>
                <code className="rounded bg-paper-soft px-1.5 py-0.5 text-xs">crawl.entry.status</code> — the entry URL
                does not end on a 200
              </li>
              <li>
                <code className="rounded bg-paper-soft px-1.5 py-0.5 text-xs">crawl.entry.indexable</code> — the entry
                page is noindex (meta or X-Robots-Tag)
              </li>
              <li>
                <code className="rounded bg-paper-soft px-1.5 py-0.5 text-xs">crawl.robots.blocks-site</code> —
                robots.txt disallows / for * or Googlebot
              </li>
              <li>
                <code className="rounded bg-paper-soft px-1.5 py-0.5 text-xs">sec.https</code> — HTTPS is not available
              </li>
              <li>
                <code className="rounded bg-paper-soft px-1.5 py-0.5 text-xs">sec.tls.expired</code> — the certificate
                has expired or the handshake fails
              </li>
            </ul>
            <p className="mt-3 text-xs text-ink/45">
              Two conditions come before any scoring: if a firewall or challenge page blocks our crawler we publish no
              score at all; if the entry page is an empty JavaScript shell we score what raw HTML allows and mark content
              checks as not measured.
            </p>
          </div>
        </section>

        {/* Page-level thresholds */}
        <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="page-share">
          <div className="relative z-10">
            <h2 id="page-share" className="font-display text-xl font-semibold tracking-tight">
              Page-level checks
            </h2>
            <p className="mt-1.5 text-sm text-ink/55">
              Checks like &ldquo;missing title&rdquo; or &ldquo;broken internal link&rdquo; are judged by the share of
              crawled pages affected, not by a single page.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-ink/75">
              <li>0% of pages affected → pass</li>
              <li>≤ 20% affected → warn</li>
              <li>&gt; 20% affected → fail</li>
            </ul>
            <p className="mt-3 text-xs text-ink/45">
              A few checks use their own bands where Google&rsquo;s guidance differs (for example image alt text: ≤ 10%
              missing pass, ≤ 30% warn). Every page-level evidence line opens with the sample size — &ldquo;Across 20
              crawled pages…&rdquo;.
            </p>
          </div>
        </section>

        {/* CrUX */}
        <section className="card min-w-0 p-6 sm:p-7 lg:col-span-2" aria-labelledby="crux">
          <div className="relative z-10 min-w-0">
            <h2 id="crux" className="font-display text-xl font-semibold tracking-tight">
              Core Web Vitals thresholds
            </h2>
            <p className="mt-1.5 text-sm text-ink/55">
              Real-user p75 values from the Chrome UX Report (CrUX) via PageSpeed Insights, mobile. Good → pass, needs
              improvement → warn, poor → fail. No field data → the lab value is used, capped at warn and labelled &ldquo;lab,
              single run&rdquo;. PageSpeed unavailable → not measured.
            </p>
            <div className="mt-4 min-w-0 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-ink/[0.06]">
                    <Th>Metric</Th>
                    <Th>Good</Th>
                    <Th>Needs improvement</Th>
                    <Th>Poor</Th>
                  </tr>
                </thead>
                <tbody>
                  {CRUX.map((r) => (
                    <tr key={r.metric} className="border-b border-ink/[0.05] last:border-0">
                      <td className="py-2 pr-3 text-ink/75">{r.metric}</td>
                      <td className="py-2 pr-3 font-medium tabular-nums text-mint-deep">{r.good}</td>
                      <td className="py-2 pr-3 font-medium tabular-nums text-amber-700">{r.ni}</td>
                      <td className="py-2 pr-3 font-medium tabular-nums text-coral-deep">{r.poor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Grades */}
        <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="grades">
          <div className="relative z-10">
            <h2 id="grades" className="font-display text-xl font-semibold tracking-tight">
              Grade scale
            </h2>
            <ul className="mt-4 grid grid-cols-5 gap-2 text-center">
              {SEO_GRADE_SCALE.map((g) => (
                <li key={g.grade} className="surface p-3">
                  <p className="font-display text-2xl font-semibold">{g.grade}</p>
                  <p className="mt-0.5 text-[11px] text-ink/50">{g.grade === "F" ? "< 40" : `≥ ${g.min}`}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink/45">Same scale as the AI visibility report, so the two never disagree about what an &ldquo;A&rdquo; means.</p>
          </div>
        </section>

        {/* Data sources and limits */}
        <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="sources">
          <div className="relative z-10">
            <h2 id="sources" className="font-display text-xl font-semibold tracking-tight">
              Data sources and limits
            </h2>
            <ul className="mt-4 space-y-2 text-sm leading-relaxed text-ink/75">
              <li>
                <span className="font-medium text-ink">Our crawler</span> (
                <Link href="/bot" className="text-iris hover:underline">
                  AEOeyeBot
                </Link>
                ): robots.txt, up to 6 sitemap files, 4 protocol/host variants, a random-path 404 probe, and{" "}
                {FREE_CRAWL_PAGES} HTML pages on the free report ({FREE_NAV_PAGES} by navigation, {FREE_CRAWL_PAGES - FREE_NAV_PAGES} sampled from
                the sitemap by path) or {FULL_CRAWL_PAGES} on the full report ({FULL_NAV_PAGES} + {FULL_CRAWL_PAGES - FULL_NAV_PAGES}). Raw HTML only — no
                JavaScript rendering.
              </li>
              <li>
                <span className="font-medium text-ink">Google PageSpeed Insights</span>: one mobile run per report (plus
                desktop on the full report). CrUX is aggregated over 28 days; Lighthouse is a single lab run and varies.
              </li>
              <li>
                <span className="font-medium text-ink">DataForSEO</span> (full report): backlink summary and anchors,
                ranked keywords (Google US, English), competitor domains. Traffic and index figures are estimates.
              </li>
            </ul>
          </div>
        </section>
      </div>

      <section className="mx-auto mt-10 max-w-3xl">
        <div className="surface p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight">Disclaimer</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/65">
            Reports are automated, reflect a single point in time, and sample a subset of a site&rsquo;s pages. They are
            not a guarantee of rankings and are not affiliated with or endorsed by the audited site, Google or
            DataForSEO. Thresholds follow Google Search Central and web.dev guidance and may change as that guidance does;
            this page is updated when they do.
          </p>
        </div>
      </section>

      <JsonLd data={breadcrumbJsonLd([{ name: "SEO Audit", path: "/seo-audit" }, { name: "How we score", path: "/seo-audit/how-we-score" }])} />
    </div>
  );
}
