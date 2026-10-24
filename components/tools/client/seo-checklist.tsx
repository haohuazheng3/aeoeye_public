"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download } from "lucide-react";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";

/* SEO 审计清单:40 条,每条都对应免费 SEO 审计里一个真实检查项(auditId 与 lib/seo-audit/checks/titles.ts 一致),
   所以"自动检测"是真的 —— 免费审计逐条给出 pass / warn / fail。勾选状态只存在本机浏览器。 */

type Item = { id: string; label: string; why: string; tool?: string };
type Group = { area: string; items: Item[] };

export const CHECKLIST: Group[] = [
  {
    area: "Crawling & indexing",
    items: [
      { id: "crawl.robots.exists", label: "robots.txt exists at /robots.txt and parses cleanly", why: "A 5xx on robots.txt makes Google pause crawling the whole site.", tool: "robots-txt-tester" },
      { id: "crawl.robots.blocks-site", label: "robots.txt doesn't block Googlebot from important paths", why: "One stray Disallow: / removes a site from search.", tool: "robots-txt-tester" },
      { id: "crawl.robots.resources", label: "CSS and JavaScript files are crawlable", why: "Google renders pages; blocked assets mean it sees a broken layout.", tool: "robots-txt-tester" },
      { id: "crawl.sitemap.found", label: "An XML sitemap exists and is discoverable", why: "Sitemaps are how new and deep URLs get found quickly.", tool: "sitemap-checker" },
      { id: "crawl.sitemap.valid", label: "The sitemap is valid XML with absolute, same-host URLs", why: "Invalid sitemaps are ignored, silently.", tool: "sitemap-checker" },
      { id: "crawl.robots.sitemap-directive", label: "robots.txt points to the sitemap with a Sitemap: line", why: "Lets every crawler, not just Google, find it.", tool: "robots-txt-tester" },
      { id: "crawl.pages.noindex", label: "No page you want ranked carries noindex", why: "Leftover staging noindex is a classic traffic killer.", tool: "meta-robots-checker" },
      { id: "crawl.canonical.pages", label: "Canonical tags point to the page itself or the true original", why: "A wrong canonical hands your ranking to another URL.", tool: "meta-tag-checker" },
      { id: "crawl.redirect.chains", label: "Redirects go straight to the final URL (no chains)", why: "Each extra hop costs crawl budget and time.", tool: "redirect-checker" },
      { id: "crawl.https.redirect", label: "HTTP redirects to HTTPS with a single 301", why: "Two live versions split signals.", tool: "redirect-checker" },
      { id: "crawl.host.canonical", label: "www and non-www resolve to one version", why: "Same problem as HTTP/HTTPS: duplicate hosts.", tool: "redirect-checker" },
      { id: "crawl.soft404", label: "Missing pages return a real 404, not a 200", why: "Soft 404s waste crawl budget and can get indexed.", tool: "http-status-checker" },
      { id: "crawl.links.broken", label: "No broken internal links", why: "Dead ends stop crawlers and visitors.", tool: "link-extractor" },
      { id: "crawl.js-dependent", label: "Main content is in the HTML, not only after JavaScript", why: "Most AI crawlers don't run JavaScript at all.", tool: "googlebot-simulator" },
      { id: "crawl.robots.ai-crawlers", label: "AI search crawlers (OAI-SearchBot, PerplexityBot…) are allowed", why: "Blocked AI crawlers can't cite you.", tool: "ai-crawlers" },
    ],
  },
  {
    area: "On-page",
    items: [
      { id: "onpage.title.present", label: "Every page has a unique, descriptive <title>", why: "The title is still the strongest on-page relevance hint.", tool: "title-tag-checker" },
      { id: "onpage.title.length", label: "Titles fit in roughly 600px so they don't truncate", why: "Truncated titles lose the words that earn the click.", tool: "title-tag-checker" },
      { id: "onpage.description.present", label: "Pages have a meta description written for the click", why: "Google uses it as the snippet when it matches the query.", tool: "meta-tag-checker" },
      { id: "onpage.description.length", label: "Descriptions are about 120–160 characters", why: "Long ones get cut; very short ones get replaced.", tool: "title-tag-checker" },
      { id: "onpage.h1.missing", label: "Each page has one clear H1", why: "The H1 tells readers and parsers what the page is about.", tool: "on-page-seo-checker" },
      { id: "onpage.headings.order", label: "Headings follow a logical H2 → H3 order", why: "Clean structure is what answer engines extract.", tool: "on-page-seo-checker" },
      { id: "onpage.images.alt", label: "Meaningful images have alt text", why: "Image search, accessibility and context for crawlers.", tool: "on-page-seo-checker" },
      { id: "onpage.thin", label: "No thin pages with almost no unique text", why: "Thin pages drag down how Google rates the whole site.", tool: "website-word-counter" },
      { id: "onpage.url.hygiene", label: "URLs are short, lowercase and hyphenated", why: "Readable URLs get clicked and shared more.", tool: "slug-generator" },
      { id: "onpage.lang", label: "The <html lang> attribute is set", why: "Helps search engines serve the right language.", tool: "html-checker" },
    ],
  },
  {
    area: "Speed & mobile",
    items: [
      { id: "perf.cwv.lcp", label: "LCP is 2.5 s or faster for most real users", why: "Core Web Vitals are part of Google's page experience signals.", tool: "core-web-vitals-test" },
      { id: "perf.cwv.inp", label: "INP is 200 ms or faster", why: "Slow interactions feel broken on mobile.", tool: "core-web-vitals-test" },
      { id: "perf.cwv.cls", label: "CLS is 0.1 or lower", why: "Layout jumps cause mis-taps and bounces.", tool: "core-web-vitals-test" },
      { id: "perf.compression", label: "HTML, CSS and JS are served compressed (gzip/brotli)", why: "Often a 70%+ cut in transfer size for free.", tool: "http-header-checker" },
      { id: "mobile.viewport", label: "A mobile viewport meta tag is set", why: "Without it, phones render a shrunken desktop page.", tool: "mobile-friendly-test" },
      { id: "mobile.font-size", label: "Text is readable on mobile without zooming", why: "Google indexes the mobile version first.", tool: "mobile-friendly-test" },
    ],
  },
  {
    area: "Structured data & social",
    items: [
      { id: "schema.jsonld.valid", label: "JSON-LD parses without errors", why: "One syntax error voids the whole block.", tool: "schema-validator" },
      { id: "schema.organization", label: "Organization markup names your brand, logo and profiles", why: "Feeds the knowledge panel and AI entity understanding.", tool: "schema-validator" },
      { id: "schema.og", label: "Open Graph tags (og:title, og:image…) are present", why: "Controls how links look when shared.", tool: "open-graph-checker" },
      { id: "schema.favicon", label: "A favicon Google can show (48px multiple or SVG)", why: "The icon appears next to your result on mobile.", tool: "favicon-checker" },
    ],
  },
  {
    area: "HTTPS & trust",
    items: [
      { id: "sec.https", label: "The whole site is on HTTPS with a valid certificate", why: "HTTPS is a ranking signal and browsers warn without it.", tool: "security-headers-checker" },
      { id: "sec.hsts", label: "HSTS is set with a long max-age", why: "Stops downgrade attacks and the first-visit HTTP hop.", tool: "hsts-checker" },
      { id: "sec.headers", label: "Key security headers are set (CSP, X-Content-Type-Options…)", why: "Basic hygiene that also signals a maintained site.", tool: "security-headers-checker" },
    ],
  },
  {
    area: "Site architecture",
    items: [
      { id: "arch.depth", label: "Important pages are within 3 clicks of the homepage", why: "Deep pages get crawled less often.", tool: "link-extractor" },
      { id: "arch.orphans", label: "Every page you care about has internal links pointing to it", why: "Orphan pages are rarely crawled or ranked.", tool: "link-extractor" },
    ],
  },
];

const ALL = CHECKLIST.flatMap((g) => g.items);
const KEY = "aeoeye-seo-checklist-v1";

export function SeoChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* 隐私模式或禁用存储:清单照常可用,只是不记忆 */
    }
  }, []);
  function toggle(id: string) {
    setDone((d) => {
      const next = { ...d, [id]: !d[id] };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  const count = ALL.filter((i) => done[i.id]).length;
  const markdown = useMemo(
    () => CHECKLIST.map((g) => `## ${g.area}\n` + g.items.map((i) => `- [${done[i.id] ? "x" : " "}] ${i.label}`).join("\n")).join("\n\n"),
    [done]
  );
  const csv = useMemo(() => "area,check,done\n" + CHECKLIST.flatMap((g) => g.items.map((i) => `"${g.area}","${i.label.replace(/"/g, '""')}",${done[i.id] ? "yes" : "no"}`)).join("\n"), [done]);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-5 shadow-float">
        <p className="text-sm font-semibold text-ink">Auto-test all {ALL.length} checks on your site</p>
        <p className="mt-1 text-xs text-ink/55">The free SEO audit crawls your site and returns pass / warn / fail for every item below, plus evidence and fixes for the worst problems.</p>
        <div className="mt-3">
          <SeoAuditForm source="tool-seo-audit-checklist" variant="inline" cta="Auto-test my site" />
        </div>
      </div>
      <div className="rounded-3xl bg-white p-5 shadow-float">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Or tick through it manually</p>
            <p className="text-xs text-ink/50">{count}/{ALL.length} done · saved in this browser only</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => navigator.clipboard.writeText(markdown).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1.5 text-xs"><Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy as Markdown"}</button>
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="seo-audit-checklist.csv" className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1.5 text-xs"><Download className="h-3.5 w-3.5" /> CSV</a>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-dim"><div className="h-full rounded-full bg-mint transition-all" style={{ width: `${(count / ALL.length) * 100}%` }} /></div>
        <div className="mt-5 space-y-6">
          {CHECKLIST.map((g) => (
            <div key={g.area}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">{g.area} · {g.items.length}</p>
              <ul className="mt-2 divide-y divide-paper-dim">
                {g.items.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 py-2.5">
                    <button type="button" aria-pressed={!!done[i.id]} aria-label={`Mark "${i.label}" as done`} onClick={() => toggle(i.id)} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${done[i.id] ? "border-mint bg-mint text-white" : "border-paper-dim bg-white"}`}>
                      {done[i.id] && <Check className="h-3.5 w-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${done[i.id] ? "text-ink/45 line-through" : "text-ink"}`}>{i.label}</p>
                      <p className="text-xs text-ink/50">{i.why}{i.tool && <> · <Link href={`/tools/${i.tool}`} className="text-iris hover:underline">test this</Link></>}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
