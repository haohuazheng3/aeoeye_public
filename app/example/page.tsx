import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Trophy, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { pageMeta, breadcrumbJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Example AI visibility report (Notion)",
  description:
    "A real AEOeye audit, in full: how AI assistants rank Notion, which competitors beat it on automation questions, and what it would fix. See what your own report looks like.",
  path: "/example",
});

// 真实数据快照:Notion 的真实 AEOeye 审计(2026-07,当时免费预览跑的是 Claude、5 题)。
// 数据取自生产库,一个数字都不许改 —— 免费预览后来换成 ChatGPT/3 题,但**已经发生过的**
// 那次审计不会因此变样。要展示新配置的样例,只能重新跑一次真实审计再换掉整份快照。
const REPORT = {
  brand: "Notion",
  domain: "notion.so",
  category: "AI workspace and productivity platform",
  score: 75,
  grade: "B",
  summary:
    "Notion ranks well overall (75/100) but is notably absent from AI recommendations on automation and AI agents — a core use case where competitors like Zapier, Make, and n8n dominate. Despite strong AI mentions, the brand's weak structured data and missing automation-focused content are costing visibility in high-intent queries.",
  engine: { label: "Claude", visibility: 75, mentioned: 4, asked: 5, avgRank: 1.5 },
  competitors: [
    { name: "Zapier", wins: 1 },
    { name: "Make", wins: 1 },
    { name: "n8n", wins: 1 },
    { name: "Slack Workflow Builder", wins: 1 },
    { name: "Airtable Automations", wins: 1 },
    { name: "Monday.com", wins: 0 },
    { name: "Confluence", wins: 0 },
  ],
  questions: [
    { q: "What's the best AI workspace for organizing team documents and automating workflows?", mentioned: true, rank: 1 },
    { q: "How does Notion AI compare to other knowledge management tools for enterprises?", mentioned: true, rank: 1 },
    { q: "Can I use an AI workspace to search and find answers across all my work apps automatically?", mentioned: true, rank: 3 },
    { q: "How can I use AI agents in my workspace to reduce busywork and automate repetitive tasks?", mentioned: false, rank: null },
  ],
  gap: "How can I use AI agents in my workspace to reduce busywork and automate repetitive tasks?",
  topFix: "Create an “AI Agents in Notion” hub page with concrete workflows and use cases",
};

export default function ExamplePage() {
  return (
    <article className="container-tight max-w-3xl py-16">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Example report", path: "/example" },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Example AI visibility report (Notion)",
            url: `${siteUrl}/example`,
            description:
              "A real AEOeye audit of Notion: AI visibility score, competitors, and the fix roadmap.",
          },
        ]}
      />

      <p className="eyebrow">Example report</p>
      <h1 className="mt-3 font-display text-4xl font-semibold">What an AEOeye report looks like</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink">
        Below is a real AEOeye audit of <strong>Notion</strong> — not a mockup. It shows exactly what you get: an AI
        visibility score, which competitors AI recommends instead of you, the buyer questions where you&apos;re absent,
        and what to fix first.
      </p>
      <p className="mt-3 rounded-lg bg-paper-soft px-4 py-3 text-sm text-ink/60">
        This snapshot is a <strong>free single-engine preview</strong> captured July 2026, when the preview engine was Claude. Today it asks <strong>ChatGPT</strong>. The full $29 report
        runs the same analysis across <strong>all five engines</strong>, over 10 buyer questions.
      </p>

      {/* 总分 */}
      <section className="card mt-8 flex items-center justify-between gap-6 p-6">
        <div>
          <p className="text-sm text-ink/55">
            {REPORT.brand} · <span className="text-ink/40">{REPORT.domain}</span>
          </p>
          <p className="mt-1 text-xs text-ink/45">{REPORT.category}</p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink/75">{REPORT.summary}</p>
        </div>
        <div className="shrink-0 text-center">
          <div className="font-display text-5xl font-semibold text-iris">{REPORT.score}</div>
          <div className="text-xs text-ink/45">/ 100 · Grade {REPORT.grade}</div>
        </div>
      </section>

      <div className="prose mt-12">
        <h2>How AI saw Notion</h2>
        <p>
          In this preview, {REPORT.engine.label} mentioned Notion in <strong>{REPORT.engine.mentioned} of {REPORT.engine.asked}</strong>{" "}
          buyer questions, at an average rank of <strong>#{REPORT.engine.avgRank}</strong> — strong on core knowledge-management
          queries, but missing on automation. Today the free preview asks ChatGPT 3 questions; the full report widens it to 10 across all five engines.
        </p>

        <h2>Who AI recommends instead</h2>
        <p>On the questions where Notion is weak, these are the brands AI names — with automation tools leading:</p>
      </div>

      <div className="card mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-dim text-left text-xs uppercase tracking-wide text-ink/45">
              <th className="px-5 py-3 font-medium">Competitor</th>
              <th className="px-5 py-3 text-center font-medium">Beat Notion</th>
            </tr>
          </thead>
          <tbody>
            {REPORT.competitors.map((c, i) => (
              <tr key={c.name} className="border-b border-paper-dim/60 last:border-0">
                <td className="px-5 py-3 font-medium">
                  <span className="mr-2 text-ink/35">{i + 1}</span>
                  {c.name}
                </td>
                <td className="px-5 py-3 text-center">
                  {c.wins > 0 ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-coral-deep">
                      <Trophy className="h-3.5 w-3.5" /> {c.wins}
                    </span>
                  ) : (
                    <span className="text-ink/35">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="prose mt-12">
        <h2>The questions, and whether Notion showed up</h2>
      </div>
      <div className="mt-4 space-y-3">
        {REPORT.questions.map((m) => (
          <div key={m.q} className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-ink">“{m.q}”</p>
              {m.mentioned ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-mint/10 px-2.5 py-0.5 text-xs font-semibold text-mint-deep">
                  <CheckCircle2 className="h-3.5 w-3.5" /> #{m.rank}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/10 px-2.5 py-0.5 text-xs font-semibold text-coral-deep">
                  <XCircle className="h-3.5 w-3.5" /> Absent
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="prose mt-12">
        <h2>The gap that&apos;s costing Notion</h2>
        <p>
          Notion is absent on the highest-intent automation question: <em>“{REPORT.gap}”</em>. That&apos;s where Zapier,
          Make and n8n win the recommendation instead.
        </p>
        <h2>The top fix</h2>
        <p>
          AEOeye&apos;s first recommendation: <strong>{REPORT.topFix}</strong> — the full report ranks all fixes by impact,
          so you know what to do first.
        </p>
      </div>

      {/* CTA */}
      <div className="panel-dark mt-12 flex flex-col items-start gap-4 p-8 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Now run yours</h2>
          <p className="mt-1 text-sm text-white/70">Free, one engine, no signup — your AI visibility score in under a minute.</p>
        </div>
        <Link href="/#audit" className="btn-primary shrink-0 bg-iris">
          <Sparkles className="h-4 w-4" /> Run a free audit <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
