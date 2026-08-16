import type { Metadata } from "next";
import Link from "next/link";
import { SchemaGenerator } from "@/components/tools/schema-generator";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, softwareJsonLd } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";

const FAQS = [
  { q: "Do AI assistants use schema markup?", a: "Indirectly but meaningfully. LLMs don't read JSON-LD the way Google's rich results do, but the search and retrieval layers that feed AI answers rely heavily on structured data to understand entities, products and facts. Clean schema makes your information easier to extract correctly — which makes you easier to cite." },
  { q: "Which schema types matter most for AEO?", a: "Organization (who you are), Product/Service (what you sell, for whom, at what price), and FAQPage (question-and-answer content AI loves to quote). Article and Review markup help too. This tool covers the three highest-impact types." },
  { q: "Where do I put the JSON-LD?", a: "Paste the generated <script type=\"application/ld+json\"> block into the <head> of the relevant page. Use Organization on your homepage, Product on product pages, and FAQPage where you answer real questions." },
  { q: "Will schema guarantee AI recommends me?", a: "No single signal does. Structured data lowers the cost for machines to extract correct facts about you — necessary, not sufficient. Pair it with substantive content and third-party mentions, and measure the result with an AI visibility audit." },
];

export const metadata: Metadata = pageMeta({
  title: "Free AI Schema Generator (JSON-LD) for AEO",
  description:
    "Generate valid JSON-LD structured data — Organization, Product, FAQPage — so AI assistants can extract and recommend your brand. Free schema markup generator, no signup.",
  path: "/tools/schema-generator",
});

export default function Page() {
  return (
    <div className="container-tight py-12">
      <nav className="text-sm text-ink/45">
        <Link href="/tools" className="hover:text-ink">Tools</Link> <span className="mx-1">/</span> AI Schema Generator
      </nav>

      <header className="mt-4 max-w-2xl">
        <h1 className="font-display text-4xl font-semibold">AI Schema Generator</h1>
        <p className="mt-3 text-lg text-ink/65">
          Generate valid JSON-LD structured data that helps AI assistants understand exactly who you are and what you
          offer. Pick a type, fill the fields, copy the markup.
        </p>
      </header>

      <section className="mt-10">
        <SchemaGenerator />
      </section>

      <section className="prose mt-16 max-w-3xl">
        <h2>Why structured data matters for AI</h2>
        <p>
          AI assistants answer questions by piecing together facts from across the web. The cleaner and more explicit
          those facts are, the more confidently an engine can extract and repeat them. Schema.org markup encodes your
          identity, products and answers in a form machines parse reliably — so an AI describing you is far less likely to
          get it wrong, and far more likely to name you when it&rsquo;s relevant.
        </p>
        <h2>The three types that move the needle</h2>
        <ul>
          <li><strong>Organization</strong> — establishes who you are, your logo and your authoritative profiles.</li>
          <li><strong>Product</strong> — what you sell, for whom, at what price, and whether it&rsquo;s available.</li>
          <li><strong>FAQPage</strong> — question-and-answer content mirrors exactly how AI answers, making you easy to quote.</li>
        </ul>
        <p>
          Mark up the facts, then verify the result: an <Link href="/#audit">AI visibility audit</Link> shows whether the
          facts AI repeats about you actually match the ones you encoded.
        </p>
      </section>

      <section className="mt-14 panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Is your markup translating into recommendations?</h2>
        <p className="mt-2 text-sm text-white/65">Run a free audit to see how AI actually describes you.</p>
        <div className="mx-auto mt-5 max-w-md">
          <AuditForm source="tool-schema" />
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
          { ...softwareJsonLd(), name: "AI Schema Generator", applicationCategory: "DeveloperApplication", url: absoluteUrl("/tools/schema-generator") },
          breadcrumbJsonLd([{ name: "Tools", path: "/tools" }, { name: "AI Schema Generator", path: "/tools/schema-generator" }]),
          faqJsonLd(FAQS),
        ]}
      />
    </div>
  );
}
