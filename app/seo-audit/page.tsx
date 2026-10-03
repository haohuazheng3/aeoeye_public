import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Lock, Minus } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";
import { DIMENSION_ICON } from "@/components/seo-audit/dimension-meta";
import { PILLAR_ICON, PILLAR_ORDER, PROFILES_HREF, PillarName, pillarGridItemClass, subsOf } from "@/components/seo-audit/ranking-meta";
import { DEFAULT_COMPETITORS, DEFAULT_MAX_SERP } from "@/lib/seo-audit/relevance";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, softwareJsonLd } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";
import {
  DIMENSIONS,
  ONSITE_DIMENSIONS,
  PAID_DIMENSIONS,
  FREE_CRAWL_PAGES,
  FULL_CRAWL_PAGES,
  SEO_GRADE_SCALE,
  RANKING_PILLARS,
  RANKING_SUBS,
  SITE_PROFILE_WEIGHTS,
} from "@/lib/seo-audit/types";

/** 排名分的支柱与权重一句话("Relevance & search intent 25%; …; and Technical foundation 5%");
 *  FAQ 正文与 FAQPage JSON-LD 共用,权重只在 types.ts 改一处。
 *  用分号分隔:支柱名 "Authority, links & reputation" 自带逗号,逗号列表会读串 */
const PILLAR_WEIGHTS = (() => {
  const parts = PILLAR_ORDER.map((p) => `${RANKING_PILLARS[p].label} ${RANKING_PILLARS[p].weight}%`);
  return `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
})();

/** 其余三种站点类型的名称("online stores, local businesses and health, finance or legal sites") */
const OTHER_PROFILES = "online stores, local businesses and health, finance or legal sites";
/** 对比规模:查询数 × 每个查询的前几名 —— 直接取 relevance.ts 的默认值,那边一改这页跟着变 */
const SERP_QUERIES = DEFAULT_MAX_SERP;
const SERP_RESULTS = DEFAULT_COMPETITORS;
/** 默认类型(SaaS / 企业 / 内容站)的显示名,来自类型层;只把首字母变小写("SaaS" 不能被压成 "saas") */
const DEFAULT_PROFILE_LABEL = (() => {
  const l = SITE_PROFILE_WEIGHTS.default.label;
  return l.charAt(0).toLowerCase() + l.slice(1);
})();

/* ============================================================
   /seo-audit 落地页 —— 第二个产品面的入口。
   静态渲染(不读数据库):所有数字都来自 lib/seo-audit/types.ts 的常量,
   权重表改一处,这页和报告页一起变。文案守本站写作基因:答案前置、少字、不吹。
   ============================================================ */

export const metadata: Metadata = pageMeta({
  title: "Free SEO Audit — Technical SEO Score & Fixes",
  description:
    "Enter a URL and get a technical SEO score out of 100 in about a minute: crawlability, on-page, Core Web Vitals, mobile, structured data, HTTPS and internal links, with the three worst issues and how to fix them. Free, no account.",
  path: "/seo-audit",
});

const FAQS = [
  {
    q: "Is this the same as the AI visibility audit?",
    a: "No. This one checks whether search engines can crawl, index and trust your site — robots, sitemaps, canonicals, speed, mobile, schema, HTTPS and internal links. The AI visibility audit on the homepage checks whether ChatGPT, Claude, Gemini, Google AI and Perplexity actually recommend you when buyers ask. A healthy site is the foundation; it does not by itself get you recommended.",
  },
  {
    q: "What do I need to run it?",
    a: "Just the URL. No account, no card, no tag to install — we fetch your site the way a search crawler would, from the outside. Google Search Console is optional and only for the full report: connect it (read-only) if you want your real clicks scored.",
  },
  {
    q: "Why is my score different from Lighthouse, Semrush or Ahrefs?",
    a: "Different sample, different weights. Lighthouse scores one page in a lab; we score up to 20 pages plus your robots, sitemap and URL variants, and we use real-user Core Web Vitals (CrUX) when Google has them. Tool suites weight things differently and crawl more pages. Treat every score as a consistent yardstick for the same tool over time, not as a universal number.",
  },
  {
    q: "How many pages do you crawl?",
    a: `${FREE_CRAWL_PAGES} on the free report (${12} by following navigation links, ${8} sampled from your sitemap so different templates are covered) and ${FULL_CRAWL_PAGES} on the full report. Page-level checks say exactly how many of the crawled pages are affected — the score is a sample, and we say so on the report.`,
  },
  {
    q: "What is the SEO Ranking Score?",
    a: `A 0–100 score for whether your pages can win rankings, not just get crawled. It weights ${PILLAR_ORDER.length} pillars — ${PILLAR_WEIGHTS} for a ${DEFAULT_PROFILE_LABEL}, re-weighted for ${OTHER_PROFILES} — built from ${RANKING_SUBS.length} sub-scores. Each one is traced to evidence: your pages, your backlinks, what Google shows for your brand, and the top ${SERP_RESULTS} Google results (AI Overviews included) for up to ${SERP_QUERIES} queries, starting with up to 3 target keywords you choose. Connect Google Search Console (read-only, optional) and click-through, momentum and keyword cannibalization are scored from your real clicks instead of estimated. No AI model grades anything: every rule is published, so the same site gets the same score twice. It comes with the full report; the free technical score is its technical-foundation pillar.`,
  },
  {
    q: "What does the $10 full report include, and is there a subscription?",
    a: `One-time, per report, no subscription and no account needed. It adds the SEO Ranking Score — ${PILLAR_ORDER.length} pillars and ${RANKING_SUBS.length} sub-scores, with your pages compared against the pages that rank above them — and unlocks the evidence and fix for every check, a page-by-page table, the prioritised roadmap, authority and backlinks, ranked keywords with quick wins, top-5 competitors and your brand's reputation (all via DataForSEO), desktop PageSpeed, JSON export and 30 days of re-runs. You can add up to 3 target keywords before or after paying; connecting Search Console needs a free sign-in so the data stays tied to your account.`,
  },
];

const FREE_VS_FULL: { label: string; free: string | boolean; full: string | boolean }[] = [
  { label: "Technical SEO score, grade and 7 dimension scores", free: true, full: true },
  { label: `SEO Ranking Score: ${PILLAR_ORDER.length} pillars, ${RANKING_SUBS.length} sub-scores, each with evidence and fixes`, free: false, full: true },
  {
    label: `Your pages vs the top ${SERP_RESULTS} Google results for up to ${SERP_QUERIES} queries — AI Overviews, featured snippets and People also ask`,
    free: false,
    full: true,
  },
  { label: "Up to 3 target keywords you choose, compared first", free: false, full: true },
  { label: "Brand reputation: your brand's Google results, review sites and mentions", free: false, full: true },
  { label: "Search Console (optional, read-only): real clicks, CTR vs expected, momentum", free: false, full: true },
  { label: "Every check listed with pass / warn / fail", free: true, full: true },
  { label: "Top 3 issues with full evidence and fix", free: true, full: true },
  { label: "Evidence + fix for all critical and high checks", free: "up to 8", full: "all" },
  { label: "Evidence + fix + affected URLs for every check", free: false, full: true },
  { label: "Core Web Vitals (real users, p75, mobile) + Lighthouse score", free: true, full: true },
  { label: "Desktop PageSpeed + full Lighthouse audit list", free: false, full: true },
  { label: "Pages crawled", free: `${FREE_CRAWL_PAGES}`, full: `${FULL_CRAWL_PAGES}` },
  { label: "Page-by-page table (title, description, H1, words, canonical, noindex, links, issues)", free: false, full: true },
  { label: "Prioritised roadmap: this week / this month / later", free: "counts + first item", full: true },
  { label: "Authority & backlinks, ranked keywords & quick wins, top-5 competitors", free: false, full: true },
  { label: "JSON export · re-runs for 30 days", free: false, full: true },
  { label: "Price", free: "Free", full: "$10 one-time" },
];

function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <Check className="mx-auto h-4 w-4 text-mint" aria-label="Included" />;
  if (v === false) return <Minus className="mx-auto h-4 w-4 text-ink/25" aria-label="Not included" />;
  return <span className="text-sm font-medium text-ink/75">{v}</span>;
}

export default function SeoAuditLanding() {
  const onsite = ONSITE_DIMENSIONS.map((d) => DIMENSIONS[d]);
  const paid = PAID_DIMENSIONS.map((d) => DIMENSIONS[d]);

  return (
    <div className="container-tight py-12 sm:py-16">
      {/* Hero */}
      <section className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">SEO Audit</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">How healthy is your site&rsquo;s SEO?</h1>
        <p className="mt-4 text-ink/65">
          A technical SEO score out of 100 in about a minute — with the three problems to fix first.
        </p>
        <div id="seo-audit" className="mx-auto mt-9 max-w-xl scroll-mt-28 text-left">
          <SeoAuditForm source="seo-audit-landing" />
        </div>
      </section>

      {/* What we check */}
      <section className="mt-20" aria-labelledby="what-we-check">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="what-we-check" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            What we check
          </h2>
          <p className="mt-2 text-sm text-ink/55">
            Seven on-site dimensions from our own crawl and Google PageSpeed Insights, weighted into the technical score —
            plus, in the full report, the SEO Ranking Score.
          </p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {onsite.map((d) => {
            const Icon = DIMENSION_ICON[d.id];
            return (
              <div key={d.id} className="card card-hover p-5 sm:p-6">
                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-iris" />
                      <span className="eyebrow">{d.short}</span>
                    </p>
                    <span className="rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink/55">
                      {d.weight}%
                    </span>
                  </div>
                  <p className="mt-2 font-display text-base font-semibold leading-snug text-ink">{d.label}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink/55">{d.blurb}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {paid.map((d) => {
            const Icon = DIMENSION_ICON[d.id];
            return (
              <div key={d.id} className="surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-iris" />
                    <span className="eyebrow">{d.short}</span>
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-iris/10 px-2.5 py-0.5 text-[11px] font-semibold text-iris">
                    <Lock className="h-3 w-3" /> Full report
                  </span>
                </div>
                <p className="mt-2 font-display text-base font-semibold leading-snug text-ink">{d.label}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink/55">{d.blurb}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-xs text-ink/45">
          Off-site dimensions are scored separately and never change your technical score.
        </p>

        {/* SEO Ranking Score(完整版):七个支柱 + 默认权重 + 作用;技术分就是技术支柱,一句话交代两个分数的关系。
            权重随站点类型变 —— 卡片下方一句话 + 链到方法论页的权重表 */}
        <div className="card mt-10 min-w-0 p-6 sm:p-8">
          <div className="relative z-10 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow">SEO Ranking Score</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-iris/10 px-2.5 py-0.5 text-[11px] font-semibold text-iris">
                <Lock className="h-3 w-3" /> Full report
              </span>
            </div>
            <h3 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Can your pages win the ranking? {PILLAR_ORDER.length} pillars, {RANKING_SUBS.length} sub-scores.
            </h3>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink/55">
              Your pages compared with the top {SERP_RESULTS} Google results for up to {SERP_QUERIES} queries — your own
              target keywords first — plus AI Overviews, your brand&rsquo;s reputation and, if you connect it, your Search
              Console data. Scored by published rules — no AI grading, so the same site gets the same score twice. The
              technical score above is its technical-foundation pillar.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
              {PILLAR_ORDER.map((p, i) => {
                const meta = RANKING_PILLARS[p];
                const Icon = PILLAR_ICON[p];
                return (
                  <div key={p} className={`surface p-4 ${pillarGridItemClass(i, PILLAR_ORDER.length)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-iris" />
                      <span className="rounded-full bg-ink/[0.05] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink/55">
                        {meta.weight}%
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-snug text-ink">
                      <PillarName label={meta.label} />
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink/50">{meta.role}</p>
                    <p className="mt-2 text-[11px] text-ink/40">{subsOf(p).length} sub-scores</p>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink/45">
              Weights shown are for a {DEFAULT_PROFILE_LABEL}. {OTHER_PROFILES.charAt(0).toUpperCase() + OTHER_PROFILES.slice(1)}{" "}
              are scored with their own weights —{" "}
              <Link href={PROFILES_HREF} className="font-medium text-iris hover:underline">
                see the table
              </Link>
              .
            </p>
            <Link
              href="/seo-audit/how-we-score#ranking-score"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-iris hover:underline"
            >
              Every pillar and sub-score, explained <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* How the score works */}
      <section className="mt-20" aria-labelledby="how-score">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="how-score" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            How the score works
          </h2>
          <p className="mt-2 text-sm text-ink/55">
            Every check is pass, warn or fail. Pass earns its full weight, warn half, fail nothing. Dimensions roll up by the
            weights below.
          </p>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="card min-w-0 p-6 sm:p-7">
            <div className="relative z-10 min-w-0">
              <p className="eyebrow">Weights</p>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/[0.06] text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
                    <th className="py-2 pr-3 font-semibold">Dimension</th>
                    <th className="py-2 text-right font-semibold">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {onsite.map((d) => (
                    <tr key={d.id} className="border-b border-ink/[0.05] last:border-0">
                      <td className="py-2 pr-3 text-ink/75">{d.label}</td>
                      <td className="py-2 text-right font-medium tabular-nums text-ink">{d.weight}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs leading-relaxed text-ink/45">
                Grades: {SEO_GRADE_SCALE.filter((g) => g.grade !== "F").map((g) => `${g.grade} ≥ ${g.min}`).join(" · ")} · F below 40.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="card p-6 sm:p-7">
              <div className="relative z-10">
                <p className="eyebrow">Check weights</p>
                <p className="mt-2 text-sm leading-relaxed text-ink/65">
                  Inside a dimension each check is weighted by severity — critical 4, high 3, medium 2, low 1. Informational
                  and not-measured checks never count against you.
                </p>
              </div>
            </div>
            <div className="card p-6 sm:p-7">
              <div className="relative z-10">
                <p className="eyebrow">Gates</p>
                <p className="mt-2 text-sm leading-relaxed text-ink/65">
                  Five failures make everything else moot: homepage not returning 200, homepage set to noindex, robots.txt
                  blocking the whole site, no HTTPS, expired certificate. Any one of them caps the score at 40 (grade F) and
                  shows a &ldquo;Fix this first&rdquo; banner.
                </p>
              </div>
            </div>
            <div className="card p-6 sm:p-7">
              <div className="relative z-10">
                <p className="eyebrow">Data sources</p>
                <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink/65">
                  <li>
                    <span className="font-medium text-ink">Our crawler</span> — robots.txt, sitemaps, URL variants, a 404 probe
                    and up to {FREE_CRAWL_PAGES} HTML pages (
                    <Link href="/bot" className="text-iris hover:underline">
                      AEOeyeBot
                    </Link>
                    ). The full report also reads the top-ranking pages for up to {SERP_QUERIES} of your queries.
                  </li>
                  <li>
                    <span className="font-medium text-ink">Google PageSpeed Insights</span> — real-user Core Web Vitals (CrUX
                    p75) plus a single Lighthouse run.
                  </li>
                  <li>
                    <span className="font-medium text-ink">DataForSEO</span> — backlinks, ranked keywords, competitors, the
                    Google results for those queries (AI Overviews included) and two searches for your brand, full report
                    only.
                  </li>
                  <li>
                    <span className="font-medium text-ink">Google Search Console</span> — optional, full report only: read-only
                    clicks, impressions and positions once you connect it.
                  </li>
                </ul>
                <Link href="/seo-audit/how-we-score" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-iris hover:underline">
                  Every threshold, published <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Free vs Full */}
      <section className="mt-20" aria-labelledby="free-vs-full">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="free-vs-full" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Free vs full report
          </h2>
          <p className="mt-2 text-sm text-ink/55">$10, one-time, per report. No subscription. No account needed.</p>
        </div>
        <div className="card mt-8 min-w-0 p-3 sm:p-6">
          <div className="relative z-10 min-w-0 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-ink/[0.06] text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
                  <th className="px-3 py-2.5 font-semibold">What you get</th>
                  <th className="w-28 px-3 py-2.5 text-center font-semibold">Free</th>
                  <th className="w-32 px-3 py-2.5 text-center font-semibold text-iris">Full · $10</th>
                </tr>
              </thead>
              <tbody>
                {FREE_VS_FULL.map((r) => (
                  <tr key={r.label} className="border-b border-ink/[0.05] last:border-0">
                    <td className="px-3 py-2.5 text-ink/75">{r.label}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Cell v={r.free} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Cell v={r.full} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-ink/55">
          You always start free — the unlock button is on your report.{" "}
          <a href="#seo-audit" className="font-medium text-iris hover:underline">
            Run the audit
          </a>
        </p>
      </section>

      {/* What this does NOT do */}
      <section className="mx-auto mt-20 max-w-3xl" aria-labelledby="not-do">
        <div className="surface p-6 sm:p-7">
          <h2 id="not-do" className="font-display text-lg font-semibold tracking-tight sm:text-xl">
            What this audit does not do
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/65">
            It is not an AI-visibility audit. It tells you whether search engines can crawl, index and trust your site — not
            whether ChatGPT, Claude, Gemini, Google AI or Perplexity recommend you when a buyer asks. Those are different
            questions with different answers, and plenty of technically perfect sites are invisible to AI. For that one,{" "}
            <Link href="/" className="font-medium text-iris hover:underline">
              run the free AI visibility audit
            </Link>
            . It also does not render JavaScript or crawl your whole site: it samples {FREE_CRAWL_PAGES} pages and says so
            on every page-level check. It reads your Search Console only if you connect it to a full report, and only
            with read-only access.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto mt-20 max-w-3xl" aria-labelledby="faq">
        <h2 id="faq" className="font-display text-2xl font-semibold tracking-tight">
          Questions
        </h2>
        <div className="mt-5 divide-y divide-paper-dim">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span className="text-iris transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-ink/65">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <JsonLd
        data={[
          {
            ...softwareJsonLd(),
            name: "AEOeye SEO Audit",
            applicationCategory: "BusinessApplication",
            url: absoluteUrl("/seo-audit"),
            description: metadata.description,
            offers: [
              { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free technical SEO report" },
              { "@type": "Offer", price: "10", priceCurrency: "USD", name: "Full SEO report (one-time)" },
            ],
          },
          breadcrumbJsonLd([{ name: "SEO Audit", path: "/seo-audit" }]),
          faqJsonLd(FAQS),
        ]}
      />
    </div>
  );
}
