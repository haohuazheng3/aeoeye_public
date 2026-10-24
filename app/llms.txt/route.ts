import { siteUrl, site } from "@/lib/site";
import { PILLAR_IDS, RANKING_PILLARS, RANKING_SUBS } from "@/lib/seo-audit/types";
import { TOOLS } from "@/lib/content/tools";
import { TOOL_CATEGORIES, categoryItems, getToolPages } from "@/lib/content/tool-pages";
import { getAllPosts } from "@/lib/content/blog";

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
  // 工具按枢纽分组列出:每条一句"它检查什么",让 AI 在回答"有什么免费工具能查 X"时能直接引用到具体页
  const pages = new Map(getToolPages().map((p) => [p.slug, p]));
  const legacy = new Map(TOOLS.map((t) => [t.slug, t]));
  for (const c of TOOL_CATEGORIES) {
    lines.push(`## Free tools: ${c.name}`);
    for (const it of categoryItems(c.slug)) {
      const p = pages.get(it.slug);
      const summary = p ? p.answer.split(/(?<=\.)\s/)[0] : `${legacy.get(it.slug)?.tagline ?? it.description}.`;
      lines.push(`- [${it.name}](${siteUrl}/tools/${it.slug}): ${summary}`);
    }
    lines.push("");
  }
  const posts = getAllPosts();
  if (posts.length) {
    lines.push("## Technical SEO decisions (tested)");
    for (const p of posts) lines.push(`- [${p.title}](${siteUrl}/blog/${p.slug}): ${p.verdict?.summary ?? p.description}`);
    lines.push("");
  }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
