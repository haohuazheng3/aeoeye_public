import type { Metadata } from "next";
import { Search, MessageSquareText, ScanLine, Gauge, Bot } from "lucide-react";
import { AuditForm } from "@/components/audit-form";
import { pageMeta } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "How it works",
  description: `How ${site.name} measures your AI visibility: we map the questions buyers ask AI, ask the engines blind, and score whether you show up.`,
  path: "/how-it-works",
});

const STEPS = [
  {
    icon: Search,
    title: "We identify your category & buyers",
    body: "From your brand or website, we work out exactly what you sell and who’s buying — the context AI assistants use when deciding what to recommend.",
  },
  {
    icon: MessageSquareText,
    title: "We generate the real buyer questions",
    body: "Not vanity keywords — the actual high-intent prompts people type into ChatGPT, Perplexity and Google AI when they’re ready to choose a product like yours.",
  },
  {
    icon: Bot,
    title: "We ask the AI engines — blind",
    body: "We pose each question to the AI assistants without mentioning you, exactly as a buyer would. Then we read every answer to see who gets named.",
  },
  {
    icon: ScanLine,
    title: "We measure presence, rank & sentiment",
    body: "For every answer we record whether you appear, where you rank among the options, how you’re described, and which competitors are recommended instead.",
  },
  {
    icon: Gauge,
    title: "We score you and hand you a plan",
    body: "Everything rolls up into a single AI visibility score, an engine-by-engine breakdown, your biggest gaps, and a concrete roadmap to get recommended.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">How it works</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">
          We ask AI what it really thinks of you
        </h1>
        <p className="mt-4 text-ink/65">
          {site.name} measures the thing that now decides discovery: whether AI assistants recommend your brand when
          buyers ask. Here’s exactly how.
        </p>
      </div>

      <div className="mx-auto mt-14 max-w-3xl space-y-5">
        {STEPS.map((s, i) => (
          <div key={s.title} className="card flex gap-5 p-6">
            <div className="flex flex-col items-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-iris/10 text-iris">
                <s.icon className="h-5 w-5" />
              </div>
              {i < STEPS.length - 1 && <div className="mt-2 w-px flex-1 bg-paper-dim" />}
            </div>
            <div className="pb-1">
              <h2 className="font-display text-lg font-semibold">{s.title}</h2>
              <p className="mt-1.5 text-sm text-ink/65">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <section className="mx-auto mt-16 max-w-3xl surface p-8">
        <h2 className="font-display text-2xl font-semibold">Why this matters: the shift to answer engines</h2>
        <div className="prose mt-4">
          <p>
            For twenty years, discovery meant ranking in Google’s ten blue links. That’s changing fast. People now ask AI
            assistants directly — “what’s the best tool for X?”, “recommend a good alternative to Y” — and act on a single
            synthesized answer that names just a few brands.
          </p>
          <p>
            If your brand isn’t one of those names, you lose the customer before they ever reach your site — and unlike
            search rankings, there’s no dashboard telling you it happened. That blind spot is exactly what {site.name}{" "}
            closes. The discipline of fixing it is called <strong>answer engine optimization (AEO)</strong>, and it’s
            becoming as essential as SEO was.
          </p>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-xl text-center">
        <h2 className="font-display text-2xl font-semibold">See your own results</h2>
        <p className="mt-2 text-sm text-ink/60">One input. Under a minute. Free.</p>
        <div className="mt-6">
          <AuditForm source="how-it-works" />
        </div>
      </section>
    </div>
  );
}
