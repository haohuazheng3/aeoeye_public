import { siteUrl, site } from "@/lib/site";
import { getAllPosts } from "@/lib/content/blog";
import { GLOSSARY } from "@/lib/content/glossary";
import { TOOLS } from "@/lib/content/tools";
import { getPages } from "@/lib/content/pages";

export const dynamic = "force-static";
export const revalidate = 86400;

export function GET() {
  const posts = getAllPosts();
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
  lines.push(`- [Pricing](${siteUrl}/pricing): Free audit, and a one-time $29 full multi-engine report. No subscription.`);
  lines.push("");
  lines.push("## Free tools");
  for (const t of TOOLS) lines.push(`- [${t.name}](${siteUrl}/tools/${t.slug}): ${t.tagline}.`);
  lines.push("");
  lines.push("## Guides (how-to)");
  for (const p of getPages("guides")) lines.push(`- [${p.title}](${siteUrl}/guides/${p.slug})`);
  lines.push("");
  lines.push("## Articles");
  for (const p of posts) lines.push(`- [${p.title}](${siteUrl}/blog/${p.slug}): ${p.description}`);
  lines.push("");
  lines.push("## Answers");
  for (const p of getPages("answers")) lines.push(`- [${p.title}](${siteUrl}/answers/${p.slug})`);
  lines.push("");
  lines.push("## Comparisons");
  for (const p of getPages("compare")) lines.push(`- [${p.title}](${siteUrl}/compare/${p.slug})`);
  lines.push("");
  lines.push("## By industry");
  for (const p of getPages("for")) lines.push(`- [${p.title}](${siteUrl}/for/${p.slug})`);
  lines.push("");
  lines.push("## Comparisons & alternatives");
  for (const p of getPages("vs")) lines.push(`- [${p.title}](${siteUrl}/vs/${p.slug})`);
  for (const p of getPages("alternatives")) lines.push(`- [${p.title}](${siteUrl}/alternatives/${p.slug})`);
  lines.push("");
  lines.push("## Glossary");
  for (const t of GLOSSARY) lines.push(`- [${t.term}](${siteUrl}/glossary/${t.slug}): ${t.short}`);
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
