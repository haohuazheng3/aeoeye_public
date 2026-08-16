import type { Metadata } from "next";
import Link from "next/link";
import { AiRobotsGenerator } from "@/components/tools/ai-robots-generator";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, softwareJsonLd } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";

const FAQS = [
  { q: "Should I allow or block AI crawlers?", a: "For most brands that want to be discovered and recommended by AI, allow the major ones (GPTBot, ClaudeBot, PerplexityBot, Google-Extended). Blocking them keeps you out of the very systems your buyers now use. Block only if you have a specific reason — for example, protecting paywalled or proprietary content." },
  { q: "What's the difference between training bots and search bots?", a: "Training bots (GPTBot, ClaudeBot, CCBot, Google-Extended) collect data that may inform future models. Search/answer bots (OAI-SearchBot, PerplexityBot, ChatGPT-User) fetch pages live to answer a user right now. Blocking training bots won't remove you from models already trained; allowing search bots is usually essential for live citations." },
  { q: "Does robots.txt actually stop AI crawlers?", a: "Reputable crawlers honor robots.txt. It's a directive, not a hard wall — it won't stop bad actors — but the major AI companies do respect it. It controls future crawling, not data already collected." },
  { q: "Where does robots.txt go?", a: "At your domain root: https://yourdomain.com/robots.txt, served as plain text. If you already have a robots.txt, merge these user-agent blocks into it." },
];

export const metadata: Metadata = pageMeta({
  title: "AI Robots.txt Generator — Control AI Crawlers",
  description:
    "Free robots.txt generator for AI crawlers. Choose which AI bots — GPTBot, ClaudeBot, PerplexityBot, Google-Extended — can crawl your site. Copy or download instantly.",
  path: "/tools/ai-robots-txt-generator",
});

export default function Page() {
  return (
    <div className="container-tight py-12">
      <nav className="text-sm text-ink/45">
        <Link href="/tools" className="hover:text-ink">Tools</Link> <span className="mx-1">/</span> AI Robots.txt Generator
      </nav>

      <header className="mt-4 max-w-2xl">
        <h1 className="font-display text-4xl font-semibold">AI Robots.txt Generator</h1>
        <p className="mt-3 text-lg text-ink/65">
          Decide exactly which AI bots can crawl your site. Toggle each crawler, add your sitemap, and copy a ready-to-use{" "}
          <code className="rounded bg-paper-soft px-1.5 py-0.5 text-base">robots.txt</code>.
        </p>
      </header>

      <section className="mt-10">
        <AiRobotsGenerator />
      </section>

      <section className="prose mt-16 max-w-3xl">
        <h2>Allow the bots, get the visibility</h2>
        <p>
          There&rsquo;s a reflex to block AI crawlers to &ldquo;protect&rdquo; content. For most brands that&rsquo;s
          exactly backwards. If your buyers are asking ChatGPT and Perplexity for recommendations, blocking those crawlers
          guarantees you won&rsquo;t be one — you&rsquo;re opting out of the channel. Unless you have proprietary or
          paywalled content to protect, the default should be to <strong>allow</strong> the major AI bots and make
          yourself easy to find.
        </p>
        <h2>Know your crawlers</h2>
        <ul>
          <li><strong>GPTBot / OAI-SearchBot / ChatGPT-User</strong> — OpenAI&rsquo;s training, search and live-browsing agents.</li>
          <li><strong>ClaudeBot / Claude-Web</strong> — Anthropic&rsquo;s crawlers for Claude.</li>
          <li><strong>PerplexityBot</strong> — powers Perplexity&rsquo;s indexing and citations.</li>
          <li><strong>Google-Extended</strong> — controls use of your content for Gemini and AI training (separate from Googlebot).</li>
        </ul>
        <p>
          Once you&rsquo;re crawlable, the question becomes whether AI actually recommends you. That&rsquo;s what an{" "}
          <Link href="/#audit">AI visibility audit</Link> answers.
        </p>
      </section>

      <section className="mt-14 panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Crawlable, but recommended?</h2>
        <p className="mt-2 text-sm text-white/65">Allowing bots is step one. See if AI names you with a free audit.</p>
        <div className="mx-auto mt-5 max-w-md">
          <AuditForm source="tool-robots" />
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
          { ...softwareJsonLd(), name: "AI Robots.txt Generator", applicationCategory: "DeveloperApplication", url: absoluteUrl("/tools/ai-robots-txt-generator") },
          breadcrumbJsonLd([{ name: "Tools", path: "/tools" }, { name: "AI Robots.txt Generator", path: "/tools/ai-robots-txt-generator" }]),
          faqJsonLd(FAQS),
        ]}
      />
    </div>
  );
}
