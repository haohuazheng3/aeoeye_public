import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd } from "@/lib/seo";
import {
  DIMENSIONS,
  ONSITE_DIMENSIONS,
  FREE_CRAWL_PAGES,
  FULL_CRAWL_PAGES,
  FREE_NAV_PAGES,
  FULL_NAV_PAGES,
  SEO_GRADE_SCALE,
  RANKING_PILLARS,
  RANKING_SUBS,
  SITE_PROFILE_WEIGHTS,
  type PillarId,
  type SignalConfidence,
  type SiteProfileId,
} from "@/lib/seo-audit/types";
import {
  CONFIDENCE_ORDER,
  ConfidenceBadge,
  CTR_SOURCE,
  EXPECTED_CTR,
  GSC_PRIVACY_LINE,
  PILLAR_ICON,
  PILLAR_ORDER,
  PROFILE_ORDER,
  PROFILE_RULE,
  PillarName,
  pillarWeightRange,
  subMeasures,
  subsOf,
  subWeightOverrides,
} from "@/components/seo-audit/ranking-meta";
import { DEFAULT_COMPETITORS, DEFAULT_MAX_SERP } from "@/lib/seo-audit/relevance";

/* ============================================================
   /seo-audit/how-we-score —— 评分模型全文公开。
   一个分数只有在阈值可查、来源可查时才值得信;这页就是那张"可查"的表。
   所有数字与 lib/seo-audit/types.ts 及 V2-1 评分规则保持一致;改规则先改这里的说明。
   v3:新增 #ranking-score 一节 —— SEO Ranking Score 的支柱、权重、每个小维度测什么、
   可信度标签、技术门槛与诚实的局限(规格 docs/design/seo-ranking-score-spec.md §4)。
   v4(规格 v2):七个支柱 / 40 个小维度;#ranking-profiles 站点类型权重表(直接由 SITE_PROFILE_WEIGHTS 渲染);
   #ctr-curve 预期点击率曲线与来源;#search-console 读什么、怎么绑定、隐私。
   报告里的 "How we score"、"Scored as"、Search Console 卡都链到这些锚点,id 不能改。
   ============================================================ */

export const metadata: Metadata = pageMeta({
  title: "How We Score — SEO Audit Methodology",
  description:
    "Every weight and threshold behind the AEOeye technical SEO score and the SEO Ranking Score: dimension and pillar weights by site type, every sub-score, the expected click-through curve, Search Console access, severity weights, gate rules, Core Web Vitals thresholds, grade scale, data sources and limits.",
  path: "/seo-audit/how-we-score",
});

/** 可信度标签的完整说明(报告里的徽章只放短提示,这里给全句) */
const CONFIDENCE_DETAIL: Record<SignalConfidence, string> = {
  measured: "Read directly from data — your crawled pages, the Chrome UX Report or DataForSEO.",
  estimated:
    "A rule-based estimate from page text — word lists, heading comparisons and counts. Good at patterns, blind to meaning.",
  proxy: "Page traits standing in for user-behaviour data that Google doesn't share with anyone.",
};

/** 对比规模直接取自 relevance.ts 的默认值(那边一改,这页跟着变) */
const SERP_QUERIES = DEFAULT_MAX_SERP;
const SERP_RESULTS = DEFAULT_COMPETITORS;

/** 判型的先后顺序(多个命中时靠前者胜,规格 v2 §1:ymyl > local > ecommerce > default) */
const PROFILE_PRECEDENCE: SiteProfileId[] = ["ymyl", "local", "ecommerce", "default"];

/** 每种站点类型的权重合计 —— 表格末行照实算出来,不手写 100 */
function profileTotal(id: SiteProfileId): number {
  return PILLAR_ORDER.reduce((n, p) => n + SITE_PROFILE_WEIGHTS[id].weights[p], 0);
}

/** 小维度权重覆盖(本地商家的站外声誉 25%):从 SITE_PROFILE_SUB_WEIGHTS 推出来,不手写 */
const SUB_OVERRIDES = RANKING_SUBS.flatMap((sub) =>
  subWeightOverrides(sub.id).map((o) => ({
    subId: sub.id,
    subLabel: sub.label,
    pillarLabel: RANKING_PILLARS[sub.pillar].label,
    defaultWeight: sub.weight,
    profile: o.profile,
    profileLabel: o.label,
    weight: o.weight,
  }))
);

/** 诚实的局限:排名分看不到什么、在哪里会偏 —— 与规格 §0 / §3 / v2 §3 的做法逐条对应 */
const RANKING_LIMITS: { title: string; body: string }[] = [
  {
    title: "Behaviour is partly scored through page traits",
    body: "Google doesn't share dwell time or returns to the results page. The User satisfaction pillar uses real Chrome UX Report data and — once you connect Search Console — your real click-through; the rest scores the traits that drive satisfaction (an early answer, a next step, readable text, titles that keep their promise) and is labelled Proxy.",
  },
  {
    title: "Comparisons are a sample",
    body: `Up to ${SERP_QUERIES} queries × the top ${SERP_RESULTS} organic Google results (US, English), read once at the time of the run. Pages that block AEOeyeBot in robots.txt or don't load are skipped and shown as not fetched.`,
  },
  {
    title: "Your keywords first, then your rankings",
    body: "Up to 3 target keywords you add come first, then keywords you already rank for — non-brand first, highest search volume, one per page. A site with no ranking data is compared on the topics of its homepage and most-linked content pages instead.",
  },
  {
    title: "AI Overviews change from search to search",
    body: "We read one US result page per query. An AI Overview can appear, disappear or cite different sources an hour later, so treat it as a snapshot, not a verdict.",
  },
  {
    title: "Reputation is what Google shows",
    body: "Brand reputation reads page one for your brand and for your brand plus “reviews”. Review sites Google doesn't surface there aren't counted.",
  },
  {
    title: "Subtopics are matched by wording, not meaning",
    body: "Two H2/H3 headings count as one subtopic when at least half their words overlap. A page that covers a topic under unusual wording can be under-credited.",
  },
  {
    title: "Word lists catch phrasing, not truth",
    body: "“We tested” earns first-hand credit whether or not you did. The score rewards signals that usually come with real experience; it can't verify them.",
  },
  {
    title: "A model, not a forecast",
    body: "It measures the factors that decide rankings; it doesn't predict positions. Without Search Console it can't see your real clicks: click-through isn't scored and momentum falls back to ranking changes.",
  },
];

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
          The technical SEO score is a weighted roll-up of pass / warn / fail checks across seven dimensions. The{" "}
          <a href="#ranking-score" className="text-iris hover:underline">
            SEO Ranking Score
          </a>{" "}
          in the full report builds {PILLAR_ORDER.length - 1} more pillars on top of it. Here is every number that goes into
          both.
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
                ranked keywords (Google US, English) with their difficulty and result-page features, competitor domains,
                the top 10 organic results — with AI Overview, featured snippet and People also ask — for up to{" "}
                {SERP_QUERIES} of your queries, the domain rank of the sites that rank, and two searches for your brand.
                Traffic and index figures are estimates.
              </li>
              <li>
                <span className="font-medium text-ink">Top-ranking pages</span> (full report): the top {SERP_RESULTS} results
                for each of those queries, fetched once each by our crawler as raw HTML, robots.txt respected.
              </li>
              <li>
                <span className="font-medium text-ink">Google Search Console</span> (full report, optional): read-only
                search analytics for the property you connect —{" "}
                <a href="#search-console" className="text-iris hover:underline">
                  see below
                </a>
                .
              </li>
            </ul>
          </div>
        </section>
      </div>

      {/* ============ SEO Ranking Score(完整版)============ */}
      <section id="ranking-score" className="mt-16 scroll-mt-28" aria-labelledby="ranking-score-title">
        <div className="max-w-2xl">
          <p className="eyebrow">Full report</p>
          <h2 id="ranking-score-title" className="mt-3 font-display text-3xl font-semibold tracking-tight">
            The SEO Ranking Score
          </h2>
          <p className="mt-3 text-ink/65">
            The technical score asks whether Google can crawl and index you. The Ranking Score asks whether your pages can
            win the ranking: {PILLAR_ORDER.length} pillars and {RANKING_SUBS.length} sub-scores, each 0–100 and traced to
            evidence on your pages, your backlinks, your brand&rsquo;s search results and the pages that rank today. No AI
            model grades anything — every sub-score is a rule published below, so the same site gets the same score twice.
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {/* 站点类型 × 支柱权重(直接由 SITE_PROFILE_WEIGHTS 渲染)+ 判型规则 + 小维度权重覆盖 */}
          <section
            id="ranking-profiles"
            className="card min-w-0 scroll-mt-28 p-6 sm:p-7 lg:col-span-2"
            aria-labelledby="ranking-weights"
          >
            <div className="relative z-10 min-w-0">
              <h3 id="ranking-weights" className="font-display text-xl font-semibold tracking-tight">
                Pillars and weights by type of site
              </h3>
              <p className="mt-1.5 max-w-3xl text-sm text-ink/55">
                Score = Σ(pillar score × weight) ÷ Σ(weights of scored pillars); inside a pillar, sub-scores roll up the
                same way. An online store lives or dies on its technical health, a local business on its reviews, a health
                or money site on trust — so the weights follow the type of site, and the report says which one it used
                (&ldquo;Scored as&rdquo;).
              </p>
              <div className="mt-4 min-w-0 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-ink/[0.06]">
                      <Th>Pillar</Th>
                      {PROFILE_ORDER.map((id) => (
                        <Th key={id} right>
                          {SITE_PROFILE_WEIGHTS[id].label}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PILLAR_ORDER.map((p) => (
                      <tr key={p} className="border-b border-ink/[0.05] last:border-0">
                        <td className="py-2 pr-3">
                          <a href={`#pillar-${p}`} className="text-ink/80 hover:text-iris">
                            <PillarName label={RANKING_PILLARS[p].label} />
                          </a>
                          <span className="mt-0.5 block text-xs leading-relaxed text-ink/45">{RANKING_PILLARS[p].role}</span>
                        </td>
                        {PROFILE_ORDER.map((id) => (
                          <td key={id} className="py-2 pr-3 text-right align-top font-medium tabular-nums">
                            {SITE_PROFILE_WEIGHTS[id].weights[p]}%
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t border-ink/[0.08]">
                      <td className="py-2 pr-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Total</td>
                      {PROFILE_ORDER.map((id) => (
                        <td key={id} className="py-2 pr-3 text-right text-xs font-semibold tabular-nums text-ink/55">
                          {profileTotal(id)}%
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                <div className="min-w-0">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">How we pick the type</h4>
                  <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink/65">
                    {PROFILE_PRECEDENCE.map((id) => (
                      <li key={id}>
                        <span className="font-medium text-ink">{SITE_PROFILE_WEIGHTS[id].label}:</span> {PROFILE_RULE[id]}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs leading-relaxed text-ink/45">
                    Checked in that order from the pages we crawl — the first match wins. Same pages, same type, every run.
                  </p>
                </div>
                <div className="min-w-0">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Sub-score weights</h4>
                  <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink/65">
                    {SUB_OVERRIDES.map((o) => (
                      <li key={`${o.profile}-${o.subId}`}>
                        <span className="font-medium text-ink">{o.profileLabel}:</span> {o.subLabel} counts for {o.weight}% of
                        the {o.pillarLabel} pillar instead of {o.defaultWeight}%; the pillar&rsquo;s other sub-scores shrink in
                        proportion.
                      </li>
                    ))}
                    <li>
                      A sub-score we can&rsquo;t measure shows as &ldquo;Not measured&rdquo; and its weight goes to the rest
                      of its pillar — it is never scored as zero. Grades use the same scale as the technical score.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* 技术门槛 + 可信度标签 */}
          <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="ranking-gate">
            <div className="relative z-10 min-w-0">
              <h3 id="ranking-gate" className="font-display text-xl font-semibold tracking-tight">
                The technical gate
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/65">
                If the technical score has a blocker — any of the{" "}
                <a href="#gates" className="text-iris hover:underline">
                  five gate rules
                </a>{" "}
                — the Ranking Score is capped at 40 and graded F whatever the other pillars score, and the report says to
                fix the blockers first. Content and links can&rsquo;t rank a site Google can&rsquo;t index.
              </p>
              <h3 className="mt-6 font-display text-xl font-semibold tracking-tight">Confidence labels</h3>
              <p className="mt-1.5 text-sm text-ink/55">Every sub-score carries one, so you know how hard the number is.</p>
              <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink/70">
                {CONFIDENCE_ORDER.map((c) => (
                  <li key={c} className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">
                      <ConfidenceBadge confidence={c} />
                    </span>
                    <span className="min-w-0">{CONFIDENCE_DETAIL[c]}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-ink/45">
                A label can change with the data behind it: One page per intent, for example, is Estimated from your pages
                and Measured once Search Console shows which pages share a query.
              </p>
            </div>
          </section>

          {/* 预期点击率曲线(behavior.ctr 的基准)+ 来源 */}
          <section id="ctr-curve" className="card min-w-0 scroll-mt-28 p-6 sm:p-7" aria-labelledby="ctr-curve-title">
            <div className="relative z-10 min-w-0">
              <h3 id="ctr-curve-title" className="font-display text-xl font-semibold tracking-tight">
                Expected click-through by position
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/55">
                The yardstick for <span className="font-medium text-ink/75">Click-through vs. expected</span>: the share of
                searchers who click an organic result at each Google position.
              </p>
              <ul className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {EXPECTED_CTR.map((r) => (
                  <li key={r.position} className="surface p-2.5 text-center">
                    <p className="text-[11px] font-semibold text-ink/45">#{r.position}</p>
                    <p className="mt-0.5 font-display text-sm font-semibold tabular-nums text-ink">{r.ctr.toFixed(1)}%</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm leading-relaxed text-ink/65">
                For non-brand queries with 50+ impressions, expected clicks = impressions × the rate at the query&rsquo;s
                average position, interpolated between positions. Score = 85 × your clicks ÷ expected clicks, capped at
                100 — matching the curve scores 85. Brand queries are left out: people searching your name click you
                anyway.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-ink/45">
                Source:{" "}
                <a href={CTR_SOURCE.url} target="_blank" rel="noopener noreferrer" className="text-iris hover:underline">
                  {CTR_SOURCE.label}
                </a>
                . Real curves shift with the query and the layout of the result page, so read it as a yardstick: matching
                it is good, not perfect.
              </p>
            </div>
          </section>

          {/* Search Console:读什么、怎么绑定、隐私(连接卡与报告里的链接都指向这里) */}
          <section
            id="search-console"
            className="card min-w-0 scroll-mt-28 p-6 sm:p-7 lg:col-span-2"
            aria-labelledby="search-console-title"
          >
            <div className="relative z-10 min-w-0">
              <h3 id="search-console-title" className="font-display text-xl font-semibold tracking-tight">
                Google Search Console (optional)
              </h3>
              <p className="mt-1.5 max-w-3xl text-sm text-ink/55">
                Without it, three sub-scores are estimated or not measured. With it, they&rsquo;re measured from your real
                search data: Click-through vs. expected, Ranking momentum and One page per intent.
              </p>
              <div className="mt-5 grid gap-6 lg:grid-cols-3">
                <div className="min-w-0">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">What we read</h4>
                  <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink/65">
                    <li>
                      Google&rsquo;s Search Console API with one permission:{" "}
                      <code className="rounded bg-paper-soft px-1.5 py-0.5 text-xs">webmasters.readonly</code>. We can&rsquo;t
                      change settings, submit anything or add users.
                    </li>
                    <li>
                      Search analytics for the property that matches the audited domain: clicks, impressions, CTR and average
                      position by query and by page — the 28 days ending 3 days ago, and the 28 days before.
                    </li>
                    <li>
                      Up to 100 queries and 100 pages by impressions, plus query–page pairs to find pages competing for the
                      same search.
                    </li>
                  </ul>
                </div>
                <div className="min-w-0">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">How connecting works</h4>
                  <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink/65 marker:text-ink/35">
                    <li>Sign in (an email code, no password) and open your unlocked report.</li>
                    <li>Press Connect. You get a verification tag that&rsquo;s unique to your request.</li>
                    <li>
                      Add the tag to your homepage&rsquo;s{" "}
                      <code className="rounded bg-paper-soft px-1 py-0.5 text-xs">&lt;head&gt;</code> — or a TXT record to
                      your domain&rsquo;s DNS — and, in Search Console → Settings → Users and permissions, add our service
                      account&rsquo;s email as a Restricted user.
                    </li>
                    <li>
                      Press Verify. We check that the tag is live on the audited site and that a domain property, or a
                      URL-prefix property on the same host, is shared with us. Your scores update straight away.
                    </li>
                  </ol>
                  <p className="mt-2 text-xs leading-relaxed text-ink/45">
                    Why the tag: anyone can share a Search Console property with our service account, but only someone who
                    controls the site can publish a tag made for their request — the same way Google verifies site owners.
                    You can remove the tag after verification.
                  </p>
                </div>
                <div className="min-w-0">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Privacy</h4>
                  <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink/65">
                    <li>
                      <span className="font-medium text-ink">{GSC_PRIVACY_LINE}</span> Report links aren&rsquo;t listed or
                      indexed, but whoever you send one to can open it — Search Console numbers included.
                    </li>
                    <li>
                      The data shows only in unlocked full reports, never in free previews, and it&rsquo;s in your JSON
                      export — it&rsquo;s your data.
                    </li>
                    <li>
                      We never see your Google password: you grant access in your own Search Console. Disconnecting
                      removes the data from the report and re-scores it; to revoke our access completely, also remove the
                      service account under Users and permissions.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {PILLAR_ORDER.map((p) => (
            <PillarMethod key={p} pillar={p} />
          ))}

          {/* 诚实的局限 */}
          <section className="card min-w-0 p-6 sm:p-7" aria-labelledby="ranking-limits">
            <div className="relative z-10 min-w-0">
              <h3 id="ranking-limits" className="font-display text-xl font-semibold tracking-tight">
                What it can&rsquo;t see
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ink/65">
                {RANKING_LIMITS.map((l) => (
                  <li key={l.title}>
                    <span className="font-medium text-ink">{l.title}.</span> {l.body}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </section>

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

/** 一个支柱的方法卡:作用、权重(随站点类型给区间)、每个小维度(权重 + 类型覆盖 + 可信度 + 测什么) */
function PillarMethod({ pillar }: { pillar: PillarId }) {
  const meta = RANKING_PILLARS[pillar];
  const Icon = PILLAR_ICON[pillar];
  return (
    <section id={`pillar-${pillar}`} className="card min-w-0 scroll-mt-28 p-6 sm:p-7" aria-labelledby={`pillar-${pillar}-title`}>
      <div className="relative z-10 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 id={`pillar-${pillar}-title`} className="flex min-w-0 items-center gap-2 font-display text-xl font-semibold tracking-tight">
            <Icon className="h-4 w-4 shrink-0 text-iris" />
            <span className="min-w-0">
              <PillarName label={meta.label} />
            </span>
          </h3>
          <a
            href="#ranking-profiles"
            title="Weight depends on the type of site"
            className="mt-1 shrink-0 rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink/60 hover:text-ink"
          >
            {pillarWeightRange(pillar)}
          </a>
        </div>
        <p className="mt-1.5 text-sm text-ink/55">
          {meta.role}.
          {pillar === "technical" &&
            " The pillar score is the free Technical SEO score itself, gate cap included, so the two never disagree."}
        </p>
        <dl className="mt-4 divide-y divide-ink/[0.05]">
          {subsOf(pillar).map((s) => {
            const overrides = subWeightOverrides(s.id);
            return (
              <div key={s.id} className="py-3 first:pt-0 last:pb-0">
                <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-ink">{s.label}</span>
                  <span className="text-xs tabular-nums text-ink/40">
                    {s.weight}%
                    {overrides.map((o) => ` · ${o.weight}% for a ${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}`).join("")}
                  </span>
                  <ConfidenceBadge confidence={s.confidence} />
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink/60">{subMeasures(s.id)}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
