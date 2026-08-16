<div align="center">

# AEOeye

**See your brand the way AI does.**

[aeoeye.com](https://aeoeye.com) · [Run a free audit](https://aeoeye.com/#audit) · [How it works](https://aeoeye.com/how-it-works)

</div>

---

Buyers increasingly skip Google and ask an AI assistant instead: *"what's the best tool for X?"*
The answer they get names three or four brands. If yours isn't one of them, you lost the sale
before anyone visited your site — and no rank tracker will ever show you that blind spot.

**AEOeye measures whether AI assistants recommend your brand**, and tells you what to fix if they don't.

## What it does

- Asks **real buyer questions** — the ones your prospects actually type — across **ChatGPT, Claude, Gemini, Google AI Overview and Perplexity**
- Every engine is queried at the tier a **free** user of that assistant actually gets. Testing a $20/month tier would flatter you with an answer most of your buyers will never see.
- Reports where you placed, who got recommended instead, and on which questions you were absent entirely
- Audits your site across five technical layers — whether AI crawlers can reach it, whether an answer can be lifted out of it, whether anything corroborates it
- Ships a prioritised fix roadmap, not just a diagnosis

## The visibility ladder

Being "findable" and being "recommended" are different things. AEOeye separates them:

| Level | Meaning |
|:-----:|---------|
| 5 | **In AI's memory** — named without the AI searching the web at all |
| 4 | **Top pick** — recommended first, after it looks you up |
| 3 | **Mentioned** — named, but behind others and not every time |
| 2 | **Found, not picked** — reachable, yet it names competitors instead |
| 1 | **Invisible** — absent from AI's search results entirely |

Level 1 is the heaviest sentence a report can pass, so it is only ever stated on direct
evidence — never inferred from an absence.

## Free tools

Open, no signup:

- [llms.txt generator](https://aeoeye.com/tools/llms-txt-generator)
- [AI robots.txt generator](https://aeoeye.com/tools/ai-robots-txt-generator)
- [Schema generator](https://aeoeye.com/tools/schema-generator)
- [SEO ROI calculator](https://aeoeye.com/tools/seo-roi-calculator)

## API

One call returns a complete report as JSON — every engine, every question, every answer,
plus the full site audit. Currently in private testing.

```bash
curl -X POST https://aeoeye.com/api/v1/reports \
  -H "Authorization: Bearer $AEOEYE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": "yourbrand.com"}'
```

## Run it yourself

This is the full application — Next.js 14 (App Router), React 18, TypeScript,
Postgres via Drizzle.

```bash
git clone https://github.com/haohuazheng3/aeoeye.com.git
cd aeoeye.com
npm install
cp .env.example .env.local     # then fill it in
npm run db:migrate
npm run dev
```

### What you need to fill in

Only one thing is strictly required to boot: `DATABASE_URL` (any Postgres; Neon works well).
Beyond that, each capability switches on when its key is present and degrades honestly when
it isn't — a missing key never fakes a result, it marks that engine as unavailable.

| Key | Unlocks |
|-----|---------|
| `OPENAI_API` | Question generation, answer judging, synthesis — **and** the ChatGPT engine. Without it, no audit runs. |
| `DATAFORSEO_B64` | The other four engines: Claude, Gemini, Google AI Overview, Perplexity |
| `FIRECRAWL_API_KEY` | Crawling the audited site (feeds the 5-layer site audit) |
| `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Accounts |
| `STRIPE_SECRET_KEY` | Payments |
| `PSI_API` | Real-user performance data (Chrome UX Report) |
| `RESEND_API_KEY` | Emailing the report PDF |

`.env.example` documents every variable; `lib/env.ts` is the authority (zod-validated).

### Deploying

Built for Vercel. The repo ships a GitHub Actions-free setup — bring your own pipeline,
or connect the repo to Vercel and let it build.

## How it's put together

```
app/           Routes: marketing pages, the report view, API endpoints
components/    UI — report modules, the four free tools, the API console
lib/engine/    The audit itself: question prep, engines, judging, scoring, synthesis
lib/           Cost ledger, auth, DB, PDF rendering, SEO helpers
content/       Blog, comparisons, guides — the site's written surface
drizzle/       Schema migrations
```

A few decisions worth knowing before you read the code:

- **Engines are queried at the free tier a real user gets.** Testing a $20/month tier would
  flatter you with an answer most of your buyers never see.
- **A failed engine is never scored as "it didn't recommend you."** No answer means no answer;
  the report says so and excludes it.
- **Level 1 of the ladder is only ever stated on direct evidence.** Some providers return only
  the sources they cited, not the full result set — absence there is not proof of absence.

## Not included

The private repo keeps the operating record: SEO ledgers, audit rounds, internal notes and
account material. None of it is needed to run the application.

Questions: [contact@aeoeye.com](mailto:contact@aeoeye.com)
