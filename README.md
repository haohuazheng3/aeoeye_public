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

## About this repository

This is the public face of AEOeye. The application source is kept in a private repository —
this repo carries the project's public identity and documentation.

Questions: [contact@aeoeye.com](mailto:contact@aeoeye.com)
