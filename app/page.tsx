import Link from "next/link";
import type { Metadata } from "next";
import { Gauge, Target, ListChecks, Bot, ArrowRight, Check } from "lucide-react";
import { AuditForm } from "@/components/audit-form";
import { JsonLd } from "@/components/json-ld";
import { faqJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  description:
    "Run a free AI visibility audit. See whether ChatGPT, Claude, Gemini, Google AI and Perplexity recommend your brand — or your competitors — when buyers ask. Get a score and a fix plan in under a minute.",
};

const ENGINES = ["ChatGPT", "Claude", "Gemini", "Google AI", "Perplexity"];

/* 样例报告条(演示视觉,带 Sample 标注) */
const PREVIEW = [
  { name: "ChatGPT", w: "82%" },
  { name: "Claude", w: "74%" },
  { name: "Gemini", w: "63%" },
  { name: "Google AI", w: "55%" },
  { name: "Perplexity", w: "47%" },
];

const FAQS = [
  {
    q: "What is an AI visibility audit?",
    a: "It measures whether AI assistants like ChatGPT, Perplexity and Google AI recommend your brand when people ask buying questions in your category. AEOeye asks the AIs the questions your real buyers ask, then checks if you show up, where you rank, and who gets recommended instead.",
  },
  {
    q: "Why does this matter?",
    a: "More and more people skip Google and ask AI directly: ‘what’s the best tool for X?’ The AI’s answer increasingly decides the purchase. If it never names your brand, you lose the sale before the buyer ever visits your site — and you have no way of knowing without checking.",
  },
  {
    q: "Which AI engines do you check?",
    a: "The free audit asks ChatGPT live — 3 real buyer questions, with the answers shown in full. The full report adds Claude, Gemini, Google AI Overview and Perplexity, and widens it to 10 questions, so you see exactly how each assistant talks about you.",
  },
  {
    q: "Which model do you test?",
    a: "Whatever a free user of that assistant actually gets — the default model on ChatGPT, Claude, Gemini and Perplexity. Testing a $20/month tier would flatter you with an answer most of your buyers will never see. Analysis is separate: the free report is judged by a strong model, and the full report is re-analysed by our most capable one.",
  },
  {
    q: "Is the audit really free?",
    a: "Yes. Enter a brand or website and get your AI visibility score, the questions you’re missing, and the competitors winning them — free, no signup. The full report is paid.",
  },
  {
    q: "What is AEO (answer engine optimization)?",
    a: "AEO is the practice of getting your brand recommended by AI answer engines, the way SEO got you ranked in Google. AEOeye shows you where you stand and what to fix.",
  },
];

const RING_C = 2 * Math.PI * 52;

export default function HomePage() {
  return (
    <>
      {/* HERO —— 极简文字 + 审计模块 */}
      <section className="container-tight pb-6 pt-16 text-center sm:pt-24">
        <h1 className="mx-auto max-w-3xl text-[2.6rem] font-semibold leading-[1.06] tracking-tight sm:text-6xl">
          Is AI recommending{" "}
          <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">
            your brand
          </span>
          ?
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-ink/55 sm:text-lg">
          One free audit across ChatGPT, Claude, Gemini, Google AI &amp; Perplexity.
        </p>

        <div id="audit" className="mx-auto mt-9 max-w-xl scroll-mt-28">
          <AuditForm source="home" />
        </div>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-2.5">
          {ENGINES.map((e) => (
            <span key={e} className="chip">
              <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" />
              {e}
            </span>
          ))}
        </div>
      </section>

      {/* 样例报告模块 —— 纯视觉 */}
      <section className="container-tight py-12">
        <div className="mb-8 text-center">
          <p className="eyebrow">The report</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your AI visibility, scored</h2>
        </div>
        <div className="card card-hover mx-auto max-w-3xl p-7 sm:p-9">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">
              AI Visibility Score
            </p>
            <span className="rounded-full bg-ink/[0.05] px-3 py-1 text-[11px] font-medium text-ink/45">
              Sample
            </span>
          </div>
          <div className="mt-6 grid items-center gap-8 sm:grid-cols-[auto_1fr]">
            <div className="relative mx-auto h-36 w-36">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <defs>
                  <linearGradient id="ring-g" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6366F1" />
                    <stop offset="1" stopColor="#8B5CF6" />
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="52" stroke="rgba(12,14,22,0.07)" strokeWidth="10" fill="none" />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  stroke="url(#ring-g)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - 0.72)}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-semibold">72</span>
                <span className="text-[11px] text-ink/40">/ 100</span>
              </div>
            </div>
            <div className="space-y-3.5">
              {PREVIEW.map((r) => (
                <div key={r.name} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-left text-[13px] font-medium text-ink/60">{r.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500"
                      style={{ width: r.w }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 你会得到什么 —— 4 个小模块 */}
      <section className="container-tight py-12">
        <div className="mb-8 text-center">
          <p className="eyebrow">What you get</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything in your free report
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Gauge, t: "Score", d: "One number, 0–100." },
            { icon: Bot, t: "Engines", d: "How each AI answers." },
            { icon: Target, t: "Gaps", d: "Where rivals win." },
            { icon: ListChecks, t: "Fix plan", d: "Prioritized actions." },
          ].map((f) => (
            <div key={f.t} className="card card-hover p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 text-iris">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold">{f.t}</h3>
              <p className="mt-1 text-[13px] text-ink/50">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 三步 —— 3 个模块 */}
      <section className="container-tight py-12">
        <div className="mb-8 text-center">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Three steps, one minute</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { n: "01", t: "Enter your brand", d: "A name or a URL." },
            { n: "02", t: "We ask the AIs", d: "Real buyer questions, asked blind." },
            { n: "03", t: "Get your fixes", d: "Score, gaps, playbook." },
          ].map((s) => (
            <div key={s.n} className="card card-hover p-6">
              <p className="bg-gradient-to-br from-indigo-400 to-violet-500 bg-clip-text text-3xl font-semibold text-transparent">
                {s.n}
              </p>
              <h3 className="mt-3 text-[15px] font-semibold">{s.t}</h3>
              <p className="mt-1 text-[13px] text-ink/50">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 定价 —— 2 个模块 */}
      <section className="container-tight py-12">
        <div className="mb-8 text-center">
          <p className="eyebrow">Pricing</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Start free, upgrade to track</h2>
        </div>
        <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2">
          <div className="card card-hover p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Free</p>
            <p className="mt-2 text-3xl font-semibold">$0</p>
            <ul className="mt-5 space-y-2.5 text-[13px] text-ink/60">
              {["Visibility score", "Live ChatGPT analysis", "Top competitors & gaps"].map((i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <Check className="h-4 w-4 text-iris" /> {i}
                </li>
              ))}
            </ul>
            <Link href="#audit" className="btn-ghost mt-6 w-full">
              Run free audit
            </Link>
          </div>
          <div className="card card-hover p-7 ring-1 ring-iris/25">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-iris">Full report · $29</p>
            <p className="mt-2 text-3xl font-semibold">Every engine</p>
            <ul className="mt-5 space-y-2.5 text-[13px] text-ink/60">
              {["All 5 engines live", "Every answer, engine by engine", "Full fix roadmap + PDF"].map((i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <Check className="h-4 w-4 text-iris" /> {i}
                </li>
              ))}
            </ul>
            <Link href="/pricing" className="btn-primary mt-6 w-full">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ —— 折叠模块(内容保留给 SEO,视觉极简) */}
      <section className="container-tight py-12">
        <div className="mb-8 text-center">
          <p className="eyebrow">FAQ</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Questions, answered</h2>
        </div>
        <div className="mx-auto max-w-2xl space-y-3.5">
          {FAQS.map((f) => (
            <details key={f.q} className="card group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold">
                {f.q}
                <span className="text-iris transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink/55">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 终版 CTA —— 单个模块 */}
      <section className="container-tight pb-16 pt-6">
        <div className="card mx-auto max-w-3xl p-9 text-center sm:p-12">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">See what AI says about you.</h2>
          <Link href="#audit" className="btn-primary mt-6 px-7">
            Run free audit <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <JsonLd data={faqJsonLd(FAQS.map((f) => ({ q: f.q, a: f.a })))} />
    </>
  );
}
