"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * 调用指南。写给**人**读的文档,不是给模型的提示词 ——
 * 但整段可以直接复制粘贴给 AI,让它照着写调用代码。
 * 所以正文用纯 Markdown、不含任何 "You are an assistant…" 之类的角色设定。
 */

const GUIDE = `# AEOeye Report API

Generate a complete AI-visibility report for any brand or website and get it back as JSON.
One call returns the entire paid report — 10 buyer questions asked live across 5 AI engines,
plus the 5-layer SEO foundation audit. There is no partial mode: the score, ladder, gaps and
competitors are all derived from the same batch of answers, so returning pieces separately
would let you hold contradictory fragments.

Base URL: https://aeoeye.com

## Authentication

Send your key as a bearer token. Keys start with \`aeo_live_\`.

    Authorization: Bearer aeo_live_xxxxxxxxxxxxxxxx

## Generate a report

    POST /api/v1/reports
    Content-Type: application/json

Body:

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| input | string | yes      | A brand name ("Notion") or a website ("notion.so"). Passing a URL is better — it lets us crawl the site and run the SEO foundation layer. |

### curl

    curl -X POST https://aeoeye.com/api/v1/reports \\
      -H "Authorization: Bearer $AEOEYE_API_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"input": "notion.so"}'

### JavaScript

    const res = await fetch("https://aeoeye.com/api/v1/reports", {
      method: "POST",
      headers: {
        Authorization: \`Bearer \${process.env.AEOEYE_API_KEY}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "notion.so" }),
    });
    const { report } = await res.json();
    console.log(report.overallScore, report.grade);

### Python

    import os, requests

    res = requests.post(
        "https://aeoeye.com/api/v1/reports",
        headers={"Authorization": f"Bearer {os.environ['AEOEYE_API_KEY']}"},
        json={"input": "notion.so"},
        timeout=300,
    )
    report = res.json()["report"]
    print(report["overallScore"], report["grade"])

## Timing

A full report queries 5 engines with 10 questions each and runs the foundation audit alongside
them, so expect **2–4 minutes**. Set your client timeout to at least 300 seconds. The connection
stays open until the report is done; there is no polling step.

If a run ever exceeds the 300-second server limit you'll get a gateway timeout instead of JSON.
That means the report didn't finish — retry it. Anything the run already spent still shows up
on the usage page, so a timeout is never silent.

## Response

    {
      "object": "report",
      "id": "a1b2c3d4e5f",
      "request_id": "req_...",
      "created_at": "2026-08-10T04:12:33.000Z",
      "duration_ms": 184213,
      "report_url": "https://aeoeye.com/audit/a1b2c3d4e5f",
      "report": { ... }
    }

### What's inside \`report\`

**The JSON is a superset of the web report.** Anything the browser hides behind a
click — full answer text, per-finding evidence quotes, per-engine breakdowns — is a
plain field here. You never have to scrape the page to get it.

| Field | Description |
|-------|-------------|
| brand, domain, category | Resolved identity of what was audited |
| overallScore, grade | 0–100 visibility score and its letter grade |
| summary | One-to-two sentence verdict |
| engines[] | Per-engine performance: mentionRate, avgRank, visibilityScore, questionsAsked/Mentioned, status |
| matrix[] | Every engine × question row (5 × 10 = 50 rows) |
| matrix[].answerFull | **The complete answer text**, up to 6000 chars — this is what the site shows in the lightbox |
| matrix[].answerExcerpt | The short excerpt shown on the card, centred on your brand when mentioned |
| matrix[].usedSearch | Whether that engine actually went to the web for this question |
| matrix[].rank, sentiment, competitorsMentioned, note | How you placed, how you were framed, who else was named |
| questions[] | The 10 buyer questions that were asked, with intent and persona |
| visibility | The 5-level ladder: level, retrievable, mention rates, memory-layer sample |
| competitors[] | Brands AI named, how often, and how many questions they took from you |
| gaps[] | Questions where you were absent, who won them, and why |
| recommendations[] | Prioritized fix roadmap with impact/effort/category |
| breakdown[] | Per-engine deep dive: that engine's own ladder, competitors, gaps, tested model |
| foundation.modules[] | The 5 audit layers: verdict, score, sources |
| foundation.modules[].findings[] | Every finding — title, detail, severity, provenance, and \`quote\` (the source text the model cited) |
| foundation.evidence | The raw crawl facts: AI-crawler verdicts, schema, headings, JS-dependency, brand consistency |
| foundation.psi / .backlinks | Chrome UX field data and the live backlink profile |
| site | Crawl-level signals for the homepage |
| meta | Which engines ran live, which didn't, question count, plan, generation timestamp |

A full response is typically **300–800 KB** — the answer texts dominate. Read it as a
stream or bump your client's max body size if it has a low default.

Engine ids are: \`chatgpt\`, \`claude\`, \`gemini\`, \`google_ai\`, \`perplexity\`.

Each engine is queried at the tier a **free** user of that assistant actually gets — not a
$20/month tier. That's deliberate: testing the paid tier would flatter you with an answer
most of your buyers will never see.

## Errors

Errors always come back in the same shape:

    { "object": "error", "error": { "code": "invalid_request", "message": "..." } }

| HTTP | code | Meaning |
|------|------|---------|
| 400 | invalid_request | Body was malformed, or the input wasn't a usable brand/URL |
| 401 | unauthorized | Missing, malformed, revoked or unrecognized key |
| 405 | method_not_allowed | Use POST, not GET |
| 500 | report_failed | Generation broke partway. Nothing beyond the usage already recorded was charged |
| 503 | report_failed | An upstream engine provider is unavailable — retry later |

## Notes

- Every call is recorded on the usage page, including failed ones — a failed run still burns
  provider calls.
- Reports generated through the API are also readable in the browser at \`report_url\`.
- Rate limit: none on your account.
`;

export function GuidePanel() {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(GUIDE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时下面的正文仍可手动选中 */
    }
  }

  return (
    <section className="card p-7 sm:p-8">
      <div className="relative z-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Reference</p>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">How to call it</h2>
            <p className="mt-1.5 text-sm text-ink/50">
              Plain documentation. Copy the whole thing into an AI assistant and it can write the integration for you.
            </p>
          </div>
          <button onClick={copyAll} className="btn-primary shrink-0">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy guide"}
          </button>
        </div>

        {/* 原样呈现 Markdown:它就是复制出去的那份文本,渲染成花哨排版反而
            会让"我复制到的是不是这个"变得可疑 */}
        <pre className="mt-6 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-[1.5rem] border border-white/70 bg-white/55 p-5 font-mono text-[12.5px] leading-relaxed text-ink/75">
          {GUIDE}
        </pre>
      </div>
    </section>
  );
}
