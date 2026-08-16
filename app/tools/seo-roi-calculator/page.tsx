import type { Metadata } from "next";
import Link from "next/link";
import { SeoRoiCalculator } from "@/components/tools/seo-roi-calculator";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, softwareJsonLd } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";

const FAQS = [
  {
    q: "How do I calculate SEO ROI?",
    a: "SEO ROI = (extra revenue from organic traffic − SEO cost) ÷ SEO cost. To estimate it, multiply the extra visits you expect from SEO by your conversion rate and average value per conversion, then subtract what you spend on SEO each month. This calculator does exactly that — and adds a zero-click discount for the AI Overviews era.",
  },
  {
    q: "What is a good ROI for SEO?",
    a: "There's no universal benchmark — it depends on your margins, deal size, and how competitive your keywords are. A useful frame: SEO compounds, so a channel that merely breaks even in month six often outperforms paid channels by month eighteen, because the content keeps earning traffic without new spend.",
  },
  {
    q: "Why does this calculator include a zero-click discount?",
    a: "Because a growing share of searches end without a click — Google's AI Overviews and other AI answers resolve many informational queries on the results page. Applying a 15–30% discount to projected new traffic keeps your ROI math honest instead of assuming every ranking gain converts to visits like it did in 2019.",
  },
  {
    q: "Does AI search make SEO ROI worse?",
    a: "It changes the mix rather than simply shrinking it. Informational clicks decline, but commercial-intent clicks and AI citations both carry value — and being recommended inside AI answers is a channel of its own. That part doesn't show up in classic ROI math, which is why it's worth auditing your AI visibility separately.",
  },
];

export const metadata: Metadata = pageMeta({
  title: "Free SEO ROI Calculator — With an AI-Era Zero-Click Discount",
  description:
    "Free SEO ROI calculator. Estimate extra visits, conversions, revenue and monthly ROI from your SEO investment — with an honest zero-click discount for AI Overviews. No signup.",
  path: "/tools/seo-roi-calculator",
});

export default function Page() {
  return (
    <div className="container-tight py-12">
      <nav className="text-sm text-ink/45">
        <Link href="/tools" className="hover:text-ink">Tools</Link> <span className="mx-1">/</span> SEO ROI Calculator
      </nav>

      <header className="mt-4 max-w-2xl">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">SEO ROI Calculator</h1>
        <p className="mt-3 text-ink/60">
          Estimate what an SEO investment actually returns: extra visits, conversions, revenue, and monthly ROI — with a
          built-in zero-click discount so the math survives the AI Overviews era. Free, instant, no signup.
        </p>
      </header>

      <div className="mt-10">
        <SeoRoiCalculator />
      </div>

      <section className="prose mx-auto mt-14 max-w-3xl">
        <h2>How this SEO ROI calculator works</h2>
        <p>
          The formula is deliberately simple: <strong>extra visits × conversion rate × value per conversion − monthly SEO
          cost</strong>. You control every assumption. The one twist is the <em>zero-click discount</em> — a percentage of
          projected new impressions that never become visits because an AI answer resolved the query on the results page.
          If you skip that discount, your projection quietly assumes it&rsquo;s still 2019.
        </p>
        <h2>How to pick honest inputs</h2>
        <ul>
          <li><strong>Traffic growth:</strong> use a 6–12 month target based on the keywords you can realistically win, not a hockey stick.</li>
          <li><strong>Conversion rate:</strong> pull your real organic conversion rate from analytics — it&rsquo;s usually lower than the site-wide average.</li>
          <li><strong>Value per conversion:</strong> for SaaS, use LTV or first-year value; for ecommerce, average order value.</li>
          <li><strong>Zero-click discount:</strong> heavier for informational topics (AI Overviews answer those), lighter for commercial and comparison queries where people still click through.</li>
        </ul>
        <h2>What ROI math misses in the AI era</h2>
        <p>
          Classic ROI counts clicks. But a growing share of your search presence now happens inside AI answers — ChatGPT,
          Perplexity, Gemini, and Google&rsquo;s AI Overviews naming (or skipping) your brand with no click involved. That
          visibility drives branded search and direct visits later, and it never shows up in this calculator. Measuring it
          is a separate job — see <Link href="/blog/measuring-ai-visibility">how to measure AI visibility</Link> and{" "}
          <Link href="/blog/ai-overviews-and-your-traffic">what AI Overviews do to your traffic</Link>, or check{" "}
          <Link href="/blog/ai-seo-services">what AI SEO services cost</Link> if you&rsquo;re budgeting the investment side.
        </p>
      </section>

      <section className="mt-14 panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">The half of ROI this calculator can&rsquo;t see</h2>
        <p className="mt-2 text-sm text-white/65">Find out if ChatGPT, Perplexity and Google AI actually recommend you — free.</p>
        <div className="mx-auto mt-5 max-w-md">
          <AuditForm source="tool-seo-roi-calculator" />
        </div>
      </section>

      <section className="mx-auto mt-14 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold">FAQ</h2>
        <div className="mt-5 divide-y divide-paper-dim">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span className="text-iris transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm text-ink/65">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <JsonLd
        data={[
          { ...softwareJsonLd(), name: "SEO ROI Calculator", applicationCategory: "BusinessApplication", url: absoluteUrl("/tools/seo-roi-calculator") },
          breadcrumbJsonLd([{ name: "Tools", path: "/tools" }, { name: "SEO ROI Calculator", path: "/tools/seo-roi-calculator" }]),
          faqJsonLd(FAQS),
        ]}
      />
    </div>
  );
}
