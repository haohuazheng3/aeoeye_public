"use client";

import { useState } from "react";
import { Download, Copy } from "lucide-react";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";

/* SEO 报告模板:左边是"空白模板"(可下载 Markdown / CSV),右边是同一模板被一次真实审计填满的样子。
   样例数据来自 2026-10-24 用 AEOeye 免费 SEO 审计跑的一个真实 SaaS 营销站(20 页抓取),域名与路径已隐去。 */

const SAMPLE = {
  site: "A SaaS marketing site (domain withheld)",
  date: "October 24, 2026",
  pages: 20,
  score: 85,
  grade: "A",
  dims: [
    { name: "Crawlability & Indexing", weight: 25, score: 95, note: "26 checks, 3 to improve" },
    { name: "On-Page & Content", weight: 20, score: 85, note: "3 failing, 1 to improve" },
    { name: "Performance", weight: 15, score: 66, note: "Real-user LCP and INP both 'needs improvement'" },
    { name: "Mobile Usability", weight: 10, score: 94, note: "Image dimensions missing" },
    { name: "Structured Data & Social", weight: 10, score: 71, note: "No Article markup on article pages" },
    { name: "HTTPS & Trust", weight: 10, score: 95, note: "One trust page missing" },
    { name: "Architecture & Internal Links", weight: 10, score: 85, note: "Orphan sitemap URLs" },
  ],
  issues: [
    { title: "Article pages have no Article markup", severity: "High", evidence: "3 of 3 article pages carry no Article / BlogPosting JSON-LD.", fix: "Add Article JSON-LD with headline, image, datePublished, dateModified and author.", effort: "Low", owner: "Dev" },
    { title: "Main content loads slowly for real users (LCP)", severity: "High", evidence: "Mobile LCP p75 from Chrome users is 3,012 ms (good is ≤ 2,500 ms).", fix: "Serve the hero image from the same origin with fetchpriority=\"high\" and no lazy-loading.", effort: "Medium", owner: "Dev" },
    { title: "Pages respond slowly to taps (INP)", severity: "High", evidence: "Mobile INP p75 is 295 ms (good is ≤ 200 ms).", fix: "Break up long JavaScript tasks and defer third-party scripts.", effort: "Medium", owner: "Dev" },
    { title: "A page that should rank is noindexed", severity: "High", evidence: "1 of 19 crawled pages (5%) carries noindex outside login/cart paths.", fix: "Remove noindex from any page meant to rank; keep it on utility pages only.", effort: "Low", owner: "SEO" },
    { title: "Headings skip levels", severity: "Low", evidence: "20 of 20 pages jump from H1 straight to H3.", fix: "Use H1 → H2 → H3 in order; style with CSS instead of picking smaller tags.", effort: "Low", owner: "Content" },
  ],
  roadmap: { week: 4, month: 10, later: 4 },
};

const BLANK_MD = `# SEO Audit Report — [Site name]

**Date:** [YYYY-MM-DD] · **Pages crawled:** [n] · **Tool:** [audit tool] · **Prepared by:** [team]

## 1. Executive summary
- Overall score: [score]/100 ([grade])
- Biggest risk: [one sentence]
- Quickest win: [one sentence]

## 2. Scores by area
| Area | Weight | Score | Note |
|---|---|---|---|
| Crawlability & Indexing | 25 | | |
| On-Page & Content | 20 | | |
| Performance (Core Web Vitals) | 15 | | |
| Mobile Usability | 10 | | |
| Structured Data & Social | 10 | | |
| HTTPS & Trust | 10 | | |
| Architecture & Internal Links | 10 | | |

## 3. Top issues (worst first)
| # | Issue | Severity | Evidence | Fix | Effort | Owner |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

## 4. Roadmap
- **This week:** [fixes that are high impact and low effort]
- **This month:** [the rest of the high-severity items]
- **Later:** [low-severity polish]

## 5. What we'll measure next
- Indexed pages vs. sitemap URLs (Search Console)
- Core Web Vitals p75 (CrUX)
- Clicks and impressions for target queries
- Re-audit date: [YYYY-MM-DD]
`;

const BLANK_CSV = "issue,area,severity,evidence,fix,effort,owner,status,due\n";

function sampleMarkdown() {
  const s = SAMPLE;
  return `# SEO Audit Report — ${s.site}

**Date:** ${s.date} · **Pages crawled:** ${s.pages} · **Tool:** AEOeye free SEO audit

## 1. Executive summary
- Overall score: ${s.score}/100 (${s.grade})
- Biggest risk: slow real-user loading and interaction on mobile (LCP 3.0 s, INP 295 ms)
- Quickest win: add Article markup to article pages

## 2. Scores by area
| Area | Weight | Score | Note |
|---|---|---|---|
${s.dims.map((d) => `| ${d.name} | ${d.weight} | ${d.score} | ${d.note} |`).join("\n")}

## 3. Top issues (worst first)
| # | Issue | Severity | Evidence | Fix | Effort | Owner |
|---|---|---|---|---|---|---|
${s.issues.map((i, n) => `| ${n + 1} | ${i.title} | ${i.severity} | ${i.evidence} | ${i.fix} | ${i.effort} | ${i.owner} |`).join("\n")}

## 4. Roadmap
- This week: ${s.roadmap.week} fixes · This month: ${s.roadmap.month} · Later: ${s.roadmap.later}
`;
}

function dl(name: string, mime: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const sevClass = (s: string) => (s === "High" ? "bg-coral/15 text-coral-deep" : s === "Medium" ? "bg-amber/20 text-amber-deep" : "bg-paper-soft text-ink/60");
const scoreClass = (n: number) => (n >= 90 ? "text-mint-deep" : n >= 70 ? "text-amber-deep" : "text-coral-deep");

export function SeoReportTemplate() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-white p-5 shadow-float">
        <p className="text-sm font-semibold text-ink">Fill this template for your own site — automatically</p>
        <p className="mt-1 text-xs text-ink/55">Run the free SEO audit and you get every section below, filled with your scores, evidence and fixes.</p>
        <div className="mt-3"><SeoAuditForm source="tool-seo-report-template" variant="inline" cta="Fill it for my site" /></div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-paper-dim pt-4">
          <button type="button" onClick={() => dl("seo-audit-report-template.md", "text/markdown", BLANK_MD)} className="inline-flex items-center gap-1.5 rounded-lg border border-paper-dim px-3 py-1.5 text-xs font-medium"><Download className="h-3.5 w-3.5" /> Blank template (.md)</button>
          <button type="button" onClick={() => dl("seo-issue-tracker.csv", "text/csv", BLANK_CSV)} className="inline-flex items-center gap-1.5 rounded-lg border border-paper-dim px-3 py-1.5 text-xs font-medium"><Download className="h-3.5 w-3.5" /> Issue tracker (.csv)</button>
          <button type="button" onClick={() => navigator.clipboard.writeText(sampleMarkdown()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="inline-flex items-center gap-1.5 rounded-lg border border-paper-dim px-3 py-1.5 text-xs font-medium"><Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy the filled example"}</button>
        </div>
      </div>

      <article aria-label="Filled SEO report example" className="rounded-3xl bg-white p-5 shadow-float sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-paper-dim pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">SEO audit report · real example</p>
            <h3 className="mt-1 font-display text-xl font-semibold">{SAMPLE.site}</h3>
            <p className="mt-1 text-xs text-ink/50">{SAMPLE.date} · {SAMPLE.pages} pages crawled · AEOeye free SEO audit</p>
          </div>
          <div className="text-right">
            <p className={`font-display text-4xl font-semibold ${scoreClass(SAMPLE.score)}`}>{SAMPLE.score}</p>
            <p className="text-xs text-ink/50">out of 100 · grade {SAMPLE.grade}</p>
          </div>
        </div>

        <h4 className="mt-5 text-sm font-semibold">1. Executive summary</h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/70">
          <li>Technically healthy (85/A); crawling and HTTPS are nearly clean.</li>
          <li><strong>Biggest risk:</strong> real mobile users wait 3.0 s for the main content and 295 ms for taps to respond.</li>
          <li><strong>Quickest win:</strong> Article markup on the 3 article pages — a template change, under an hour.</li>
        </ul>

        <h4 className="mt-5 text-sm font-semibold">2. Scores by area</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead><tr className="text-xs text-ink/45"><th className="py-1.5 pr-3 font-medium">Area</th><th className="py-1.5 pr-3 font-medium">Weight</th><th className="py-1.5 pr-3 font-medium">Score</th><th className="py-1.5 font-medium">Note</th></tr></thead>
            <tbody className="divide-y divide-paper-dim">
              {SAMPLE.dims.map((d) => (
                <tr key={d.name}><td className="py-2 pr-3">{d.name}</td><td className="py-2 pr-3 text-ink/50">{d.weight}%</td><td className={`py-2 pr-3 font-semibold ${scoreClass(d.score)}`}>{d.score}</td><td className="py-2 text-ink/60">{d.note}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="mt-5 text-sm font-semibold">3. Top issues, worst first</h4>
        <ol className="mt-2 space-y-3">
          {SAMPLE.issues.map((i, n) => (
            <li key={i.title} className="rounded-2xl bg-paper-soft/70 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-ink/40">{n + 1}</span>
                <span className="text-sm font-semibold">{i.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sevClass(i.severity)}`}>{i.severity}</span>
                <span className="ml-auto text-[11px] text-ink/45">Effort {i.effort} · Owner {i.owner}</span>
              </div>
              <p className="mt-1.5 text-xs text-ink/60"><strong className="text-ink/75">Evidence:</strong> {i.evidence}</p>
              <p className="mt-1 text-xs text-ink/60"><strong className="text-ink/75">Fix:</strong> {i.fix}</p>
            </li>
          ))}
        </ol>

        <h4 className="mt-5 text-sm font-semibold">4. Roadmap</h4>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-mint/10 p-3"><p className="font-display text-2xl font-semibold text-mint-deep">{SAMPLE.roadmap.week}</p><p className="text-[11px] text-ink/55">this week</p></div>
          <div className="rounded-2xl bg-amber/10 p-3"><p className="font-display text-2xl font-semibold text-amber-deep">{SAMPLE.roadmap.month}</p><p className="text-[11px] text-ink/55">this month</p></div>
          <div className="rounded-2xl bg-paper-soft p-3"><p className="font-display text-2xl font-semibold text-ink/60">{SAMPLE.roadmap.later}</p><p className="text-[11px] text-ink/55">later</p></div>
        </div>
      </article>
    </div>
  );
}
