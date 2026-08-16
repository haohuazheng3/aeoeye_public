import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing-plans";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, faqJsonLd } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Pricing",
  description: `Start free. Pay once for the full multi-engine report — no subscription. Simple, transparent pricing from ${site.name}.`,
  path: "/pricing",
});

const FAQS = [
  { q: "Is the free audit really free?", a: "Yes — run an AI visibility audit with no signup and no card. You get your score, the live Claude analysis and every buyer question with the real answer. Only the full multi-engine report is paid." },
  { q: "Is there a subscription?", a: "No. There is one paid product: the $29 full report. You pay once for that brand and keep it — no recurring charge, nothing to cancel." },
  { q: "What do I get for $29?", a: "The same buyer questions asked live to ChatGPT, Perplexity, Gemini and Google AI as well as Claude, an engine-by-engine breakdown, the complete prioritized fix roadmap, copy-paste llms.txt and schema fixes, and the full report as a PDF emailed to you." },
  { q: "Do I need an account to buy?", a: "No. Checkout works without signing up — the report unlocks straight away and the PDF goes to the email you enter at checkout. Sign in with that same email later and the report appears in your dashboard." },
  { q: "Do you offer refunds?", a: "If a paid report fails to generate, contact us and we’ll re-run it or refund you." },
];

export default function PricingPage() {
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Pricing</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Start free. Pay once, if ever.</h1>
        <p className="mt-4 text-ink/65">
          Find out where you stand for nothing. One flat $29 unlocks every engine for that brand — no subscription,
          no seats, nothing to cancel.
        </p>
      </div>

      <div className="mt-12">
        <PricingPlans />
      </div>

      {/* FAQ */}
      <div className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-center font-display text-2xl font-semibold">Pricing questions</h2>
        <div className="mt-8 divide-y divide-paper-dim">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold">
                {f.q}
                <span className="text-iris transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{f.a}</p>
            </details>
          ))}
        </div>
      </div>

      <JsonLd data={faqJsonLd(FAQS)} />
    </div>
  );
}
