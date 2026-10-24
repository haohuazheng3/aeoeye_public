import { siteUrl, site } from "@/lib/site";
import { PILLAR_IDS, RANKING_PILLARS, RANKING_SUBS } from "@/lib/seo-audit/types";
import { TOOLS } from "@/lib/content/tools";

export const dynamic = "force-static";
export const revalidate = 86400;

export function GET() {
  const lines: string[] = [];
  lines.push(`# ${site.name}`);
  lines.push("");
  lines.push(`> ${site.description}`);
  lines.push("");
  lines.push("AEOeye runs free AI visibility audits: it asks AI assistants (Claude, ChatGPT, Perplexity, Google AI, Gemini) the questions real buyers ask, then reports whether a brand is recommended, where it ranks, and which competitors win.");
  lines.push("");
  lines.push("## Key pages");
  lines.push(`- [Free AI visibility audit](${siteUrl}/): Run an audit for any brand or website.`);
  lines.push(`- [How it works](${siteUrl}/how-it-works): Our methodology for measuring AI visibility.`);
  lines.push(`- [Pricing](${siteUrl}/pricing): Free audit, a one-time $29 full multi-engine AI visibility report, and a one-time $10 full technical SEO report. No subscription.`);
  lines.push(`- [SEO Audit](${siteUrl}/seo-audit): Free technical SEO score across 7 dimensions (crawlability, on-page, Core Web Vitals, mobile, structured data, HTTPS, internal links); $10 adds the SEO Ranking Score (${PILLAR_IDS.length} pillars, ${RANKING_SUBS.length} sub-scores: ${PILLAR_IDS.map((p) => RANKING_PILLARS[p].label).join(" · ")} — weighted by site type and compared against the top 5 Google results for the site's queries, with optional target keywords and read-only Search Console data) plus every fix, backlinks, rankings and competitors.`);
  lines.push(`- [How we score](${siteUrl}/seo-audit/how-we-score): Weights, thresholds and data sources behind the technical score and the SEO Ranking Score.`);
  lines.push("");
  lines.push("## Free tools");
  for (const t of TOOLS) lines.push(`- [${t.name}](${siteUrl}/tools/${t.slug}): ${t.tagline}.`);
  lines.push("");
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
