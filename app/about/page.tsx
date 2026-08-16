import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { pageMeta, breadcrumbJsonLd, faqJsonLd, organizationJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { site, siteUrl } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "About AEOeye",
  description:
    "AEOeye is an AI visibility audit: we test whether ChatGPT, Claude, Gemini, Google AI and Perplexity recommend your brand — and show you what to fix if they don't.",
  path: "/about",
});

const FAQ = [
  {
    q: "Is AEOeye free?",
    a: "Yes. The first audit — one AI engine, your brand or URL — is free, no signup required. The full multi-engine report with the complete fix roadmap is a one-time $29. There is no subscription.",
  },
  {
    q: "Which AI engines does AEOeye check?",
    a: "AEOeye checks ChatGPT, Claude, Gemini, Google AI and Perplexity. The free preview covers one engine instantly; the full report covers all of them in a single run.",
  },
  {
    q: "How is AEO different from SEO?",
    a: "SEO gets you ranked in a list of links; AEO gets you named as the answer. A brand can rank well on Google and still never get mentioned when someone asks an AI for a recommendation — AEOeye finds and helps fix exactly that gap.",
  },
];

export default function AboutPage() {
  const aboutSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About AEOeye",
    url: `${siteUrl}/about`,
    about: { "@type": "Organization", name: site.name, url: siteUrl },
    isPartOf: { "@type": "WebSite", name: site.name, url: siteUrl },
  };

  return (
    <article className="container-tight max-w-3xl py-16">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "About", path: "/about" },
          ]),
          faqJsonLd(FAQ),
          organizationJsonLd(),
          aboutSchema,
        ]}
      />

      <p className="eyebrow">About</p>
      <h1 className="mt-3 font-display text-4xl font-semibold">About AEOeye</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink">
        AEOeye is an AI visibility audit: tell us your brand or URL, and we test whether ChatGPT, Claude, Gemini,
        Google AI and Perplexity actually recommend you when a buyer asks for the best option in your category. You get
        a score, a breakdown by engine, the competitors beating you, and a list of what to fix.
      </p>

      <div className="prose mt-10">
        <h2>What AEOeye is</h2>
        <p>
          AEOeye checks whether AI assistants recommend your brand — and shows you exactly what to do if they don&apos;t.
          Enter your brand name or website, and AEOeye runs the buyer questions people actually type into AI tools
          (&ldquo;what&apos;s the best CRM for small teams,&rdquo; &ldquo;top project management tools,&rdquo; whatever
          applies to your category) across multiple engines at once.
        </p>
        <p>The output is concrete, not a vague trend report:</p>
        <ul>
          <li>An overall visibility score, 0–100</li>
          <li>How each AI engine treats you individually</li>
          <li>Which competitors outrank you, and on what questions</li>
          <li>The high-intent questions where you don&apos;t show up at all</li>
          <li>A fix roadmap: specific next steps, not just a diagnosis</li>
        </ul>

        <h2>Why we built it</h2>
        <p>
          Search is splitting into two channels, and most brands are only watching one. People still click blue links —
          but a growing share of buying questions now get answered directly by an AI, with no click and no visit to your
          site at all. When ChatGPT names three competitors and skips you, that&apos;s not a ranking dip. That&apos;s a
          conversation that already ended without you in the room.
        </p>
        <p>
          Ranking #1 on Google says nothing about whether an AI assistant will say your name out loud. Traditional SEO
          was never built to answer that question, so AEOeye was. We hold ourselves to it too: every page on aeoeye.com
          is written the way we tell you to write yours. If this site can&apos;t earn a mention from the engines it
          audits, the audit isn&apos;t worth much either.
        </p>

        <h2>How it works</h2>
        <ol>
          <li>
            <strong>Tell us who you are.</strong> Enter your brand name or URL — no signup needed for a first look.
          </li>
          <li>
            <strong>We blind-test the engines.</strong> AEOeye asks ChatGPT, Claude, Gemini, Google AI and Perplexity
            the buyer questions relevant to your category, the same way a real prospect would ask them.
          </li>
          <li>
            <strong>You get a score and a plan.</strong> See where you rank, where competitors beat you, where
            you&apos;re absent, and what to fix first.
          </li>
        </ol>
        <p>
          The free preview asks ChatGPT 3 questions instantly. The $29 full report widens that to 10 questions across
          all five engines, re-analysed by our most capable model, with the complete fix roadmap and a PDF in your inbox. Re-run an audit whenever you want to see
          whether your fixes moved the answer — AI answers shift as models update and competitors publish new content.
        </p>

        <h2>Who it&apos;s for</h2>
        <p>AEOeye is for anyone who needs to be recommended, not just found:</p>
        <ul>
          <li>
            <strong>SaaS and software teams</strong> competing in &ldquo;best tool for X&rdquo; answers
          </li>
          <li>
            <strong>DTC and e-commerce brands</strong> competing in &ldquo;best product for X&rdquo; recommendations
          </li>
          <li>
            <strong>Local and service businesses</strong> competing in &ldquo;best [service] near me&rdquo; answers
          </li>
          <li>
            <strong>Marketing and SEO teams</strong> who need evidence on AI visibility instead of guesses
          </li>
        </ul>
        <p>
          If your buyers research before they buy, and any part of that research happens inside an AI chat, this is for
          you.
        </p>

        <h2>What makes AEOeye different</h2>
        <p>
          Most of what gets sold as &ldquo;AEO&rdquo; today is a slide deck or a sales call. AEOeye is a tool you run
          yourself, in minutes:
        </p>
        <ul>
          <li>
            <strong>Free to start</strong> — the first audit costs nothing, no account required
          </li>
          <li>
            <strong>Instant</strong> — results now, not a consultant&apos;s report next week
          </li>
          <li>
            <strong>Multi-engine</strong> — ChatGPT, Claude, Gemini, Google AI and Perplexity in one pass
          </li>
          <li>
            <strong>No sales call</strong> — you run it, you read it, you decide
          </li>
        </ul>

        <h2>Our take on AEO</h2>
        <p>
          AEO is not SEO with a new label. SEO optimizes for a ranked list of links a human then clicks through. AEO
          optimizes for being the answer itself — the name an AI says out loud when nobody clicks anything at all. A
          brand can sit at #1 on Google and still be completely absent from every AI answer in its category, and no rank
          tracker will ever show you that blind spot.
        </p>
        <p>
          We&apos;re also skeptical of anyone selling certainty here. No one fully controls what a language model decides
          to say, and we treat any pitch that claims otherwise with suspicion. What we can do is measure it honestly and
          specifically enough that you know exactly what to work on next. That&apos;s the whole point of AEOeye.
        </p>

        <h2>We&apos;re new, and built lean on purpose</h2>
        <p>
          AEOeye is new. We kept it narrow on purpose: one job, done directly, instead of a bloated platform bolted onto
          a category that&apos;s still being defined. We&apos;d rather ship something small that actually works than sell
          a suite we haven&apos;t earned. As AI search keeps changing, so will this tool — in the open, based on what
          real audits actually show.
        </p>

        <h2>Frequently asked questions</h2>
        {FAQ.map((f) => (
          <div key={f.q}>
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="panel-dark mt-12 flex flex-col items-start gap-4 p-8 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">See how AI describes your brand</h2>
          <p className="mt-1 text-sm text-white/70">Run a free audit — one engine, no signup, results in under a minute.</p>
        </div>
        <Link href="/#audit" className="btn-primary shrink-0 bg-iris">
          Run a free audit <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
