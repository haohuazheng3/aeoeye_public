import type { Metadata } from "next";
import Link from "next/link";
import { LlmsTxtGenerator } from "@/components/tools/llms-txt-generator";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, softwareJsonLd } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";

const FAQS = [
  { q: "What is an llms.txt file?", a: "llms.txt is a plain-Markdown file at the root of your domain (yourdomain.com/llms.txt) that gives AI systems a curated map of your most important, authoritative pages — like a sitemap written for language models. It helps AI find and cite the right pages instead of guessing." },
  { q: "Does llms.txt actually work yet?", a: "Adoption is early and not every AI crawler reads it today. But it's a low-cost, forward-looking signal: it costs you nothing to add, it can't hurt, and it positions you well as more AI systems adopt the convention. Treat it as a complement to strong content and structured data, not a magic switch." },
  { q: "Where do I put the llms.txt file?", a: "At the root of your domain, served as plain text: https://yourdomain.com/llms.txt. Many teams also add an llms-full.txt with the full text of key pages." },
  { q: "What should go in llms.txt?", a: "A title (your brand), a one-line summary, an optional short description, and curated links to your most important pages grouped into sections (Docs, Products, Guides). Link only to pages you want AI to treat as authoritative." },
];

export const metadata: Metadata = pageMeta({
  title: "Free llms.txt Generator — Build Your llms.txt File",
  description:
    "Free llms.txt generator. Create a valid llms.txt file in seconds to tell ChatGPT, Perplexity and Claude which pages matter most. Copy or download — no signup.",
  path: "/tools/llms-txt-generator",
});

export default function Page() {
  return (
    <div className="container-tight py-12">
      <nav className="text-sm text-ink/45">
        <Link href="/tools" className="hover:text-ink">Tools</Link> <span className="mx-1">/</span> llms.txt Generator
      </nav>

      <header className="mt-4 max-w-2xl">
        <h1 className="font-display text-4xl font-semibold">Free llms.txt Generator</h1>
        <p className="mt-3 text-lg text-ink/65">
          Build a clean, valid <code className="rounded bg-paper-soft px-1.5 py-0.5 text-base">llms.txt</code> file that
          tells AI crawlers which of your pages to trust and cite. Fill in the fields — copy or download instantly.
        </p>
      </header>

      <section className="mt-10">
        <LlmsTxtGenerator />
      </section>

      <section className="prose mt-16 max-w-3xl">
        <h2>What is llms.txt?</h2>
        <p>
          <strong>llms.txt</strong> is a Markdown file you place at your domain root — <code>yourdomain.com/llms.txt</code> —
          that points AI systems to your most important, authoritative pages in a clean, easy-to-parse form. Think of it
          as a sitemap written for large language models instead of search crawlers. Where a regular sitemap lists every
          URL, llms.txt is curated: it says &ldquo;here is what matters, and here is what each page is for.&rdquo;
        </p>
        <h2>How to use this generator</h2>
        <ul>
          <li>Enter your <strong>brand name</strong> and a one-line summary an AI could use to describe you.</li>
          <li>Add a short description with the facts you want AI to repeat — what you do, for whom, what&rsquo;s different.</li>
          <li>Group your key pages into <strong>sections</strong> (Docs, Products, Guides) with a short note on each.</li>
          <li>Copy or download the file and upload it to your site root.</li>
        </ul>
        <h2>Does it actually help?</h2>
        <p>
          Honestly: it&rsquo;s early. Not every crawler reads llms.txt today, so don&rsquo;t expect it to single-handedly
          change how AI talks about you. But it&rsquo;s free, it can&rsquo;t hurt, and it&rsquo;s a clean signal that
          you&rsquo;re thinking about AI discovery. The bigger wins come from substantive content, structured data, and
          third-party mentions — which is exactly what an{" "}
          <Link href="/#audit">AI visibility audit</Link> measures.
        </p>
      </section>

      <section className="mt-14 panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Now check if AI actually recommends you</h2>
        <p className="mt-2 text-sm text-white/65">An llms.txt is one signal. Run a free audit to see the whole picture.</p>
        <div className="mx-auto mt-5 max-w-md">
          <AuditForm source="tool-llms-txt" />
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
          { ...softwareJsonLd(), name: "llms.txt Generator", applicationCategory: "DeveloperApplication", url: absoluteUrl("/tools/llms-txt-generator") },
          breadcrumbJsonLd([{ name: "Tools", path: "/tools" }, { name: "llms.txt Generator", path: "/tools/llms-txt-generator" }]),
          faqJsonLd(FAQS),
        ]}
      />
    </div>
  );
}
