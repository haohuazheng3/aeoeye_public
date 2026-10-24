"use client";

import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { ToolRunner } from "../runner/tool-runner";

/* 8 个可直接复制的 sitemap 样例(均按 sitemaps.org 0.9 与 Google 扩展命名空间写成、可通过校验),
   外加"看任意网站真实 sitemap"的在线查询 —— 样例看格式,真实站看别人怎么组织。 */

export const SITEMAP_EXAMPLES: { id: string; name: string; when: string; file: string; xml: string }[] = [
  {
    id: "basic",
    name: "Basic website",
    when: "A small business or brochure site with a handful of pages.",
    file: "sitemap.xml",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/</loc>
    <lastmod>2026-10-20</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/services/</loc>
    <lastmod>2026-09-14</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/about/</loc>
    <lastmod>2026-06-02</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/contact/</loc>
    <lastmod>2026-06-02</lastmod>
  </url>
</urlset>`,
  },
  {
    id: "index",
    name: "Sitemap index",
    when: "Over 50,000 URLs or 50 MB, or you want one file per section.",
    file: "sitemap_index.xml",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://www.example.com/sitemaps/pages.xml</loc>
    <lastmod>2026-10-20</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.example.com/sitemaps/blog.xml</loc>
    <lastmod>2026-10-23</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.example.com/sitemaps/products-1.xml</loc>
    <lastmod>2026-10-24</lastmod>
  </sitemap>
</sitemapindex>`,
  },
  {
    id: "blog",
    name: "Blog",
    when: "Articles where lastmod reflects real edits, not every deploy.",
    file: "blog.xml",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/blog/</loc>
    <lastmod>2026-10-23</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/blog/how-to-fix-redirect-chains</loc>
    <lastmod>2026-10-23</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/blog/core-web-vitals-checklist</loc>
    <lastmod>2026-08-11</lastmod>
  </url>
</urlset>`,
  },
  {
    id: "ecommerce",
    name: "E-commerce with images",
    when: "Product pages where you want product photos discovered.",
    file: "products-1.xml",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://www.example.com/products/trail-running-shoe</loc>
    <lastmod>2026-10-24</lastmod>
    <image:image>
      <image:loc>https://cdn.example.com/img/trail-running-shoe-side.jpg</image:loc>
    </image:image>
    <image:image>
      <image:loc>https://cdn.example.com/img/trail-running-shoe-sole.jpg</image:loc>
    </image:image>
  </url>
</urlset>`,
  },
  {
    id: "video",
    name: "Video",
    when: "Pages built around a video you want in video results.",
    file: "video.xml",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://www.example.com/videos/setup-guide</loc>
    <video:video>
      <video:thumbnail_loc>https://www.example.com/thumbs/setup-guide.jpg</video:thumbnail_loc>
      <video:title>Setup guide in 4 minutes</video:title>
      <video:description>Unbox, connect and configure the device step by step.</video:description>
      <video:content_loc>https://www.example.com/media/setup-guide.mp4</video:content_loc>
      <video:duration>240</video:duration>
    </video:video>
  </url>
</urlset>`,
  },
  {
    id: "news",
    name: "News",
    when: "Publishers in Google News; only articles from the last 2 days.",
    file: "news.xml",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://www.example.com/news/city-council-approves-budget</loc>
    <news:news>
      <news:publication>
        <news:name>Example Times</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-10-24T08:30:00+00:00</news:publication_date>
      <news:title>City council approves 2027 budget</news:title>
    </news:news>
  </url>
</urlset>`,
  },
  {
    id: "hreflang",
    name: "Multilingual (hreflang)",
    when: "The same page in several languages or regions.",
    file: "sitemap-i18n.xml",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/en/pricing</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/en/pricing"/>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/preise"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.example.com/en/pricing"/>
  </url>
  <url>
    <loc>https://www.example.com/de/preise</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/en/pricing"/>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/preise"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.example.com/en/pricing"/>
  </url>
</urlset>`,
  },
  {
    id: "text",
    name: "Plain-text sitemap",
    when: "No CMS support for XML: one absolute URL per line, UTF-8.",
    file: "sitemap.txt",
    xml: `https://www.example.com/
https://www.example.com/services/
https://www.example.com/about/
https://www.example.com/contact/`,
  },
];

export function SitemapExamples() {
  const [active, setActive] = useState(SITEMAP_EXAMPLES[0].id);
  const [copied, setCopied] = useState(false);
  const ex = SITEMAP_EXAMPLES.find((e) => e.id === active)!;
  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-white p-4 shadow-float sm:p-5">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {SITEMAP_EXAMPLES.map((e) => (
            <button key={e.id} type="button" onClick={() => setActive(e.id)} aria-pressed={active === e.id} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${active === e.id ? "bg-ink text-white" : "bg-paper-soft text-ink/60 hover:text-ink"}`}>
              {e.name}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink/65"><strong className="text-ink">Use when:</strong> {ex.when}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => navigator.clipboard.writeText(ex.xml).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1.5 text-xs"><Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}</button>
            <a href={`data:${ex.file.endsWith(".txt") ? "text/plain" : "application/xml"};charset=utf-8,${encodeURIComponent(ex.xml)}`} download={ex.file} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1.5 text-xs"><Download className="h-3.5 w-3.5" /> {ex.file}</a>
          </div>
        </div>
        <pre className="mt-3 max-h-96 overflow-auto rounded-2xl bg-ink p-4 text-[12px] leading-relaxed text-white/85"><code>{ex.xml}</code></pre>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">See how a real website does it</p>
        <ToolRunner
          tool="sitemap"
          submitLabel="Find and check sitemap"
          fields={[{ name: "url", label: "Any website", placeholder: "https://www.apple.com", type: "url" }]}
          examples={["apple.com", "nytimes.com", "shopify.com"]}
          footnote="We look in robots.txt and the usual locations, then validate what we find and sample its URLs."
        />
      </div>
    </div>
  );
}
