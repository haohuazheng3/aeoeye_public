"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { SerpPreview } from "../runner/serp-preview";
import { SocialPreviews } from "../runner/social-previews";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Meta 标签生成器:边写边看像素与预览,一次输出 title / description / canonical / robots / OG / X 卡片 */
export function MetaGenerator() {
  const [f, setF] = useState({ title: "", description: "", url: "", image: "", site: "", twitter: "", robots: "index, follow", type: "website" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => {
    const L: string[] = [];
    if (f.title) L.push(`<title>${esc(f.title)}</title>`);
    if (f.description) L.push(`<meta name="description" content="${esc(f.description)}">`);
    if (f.robots && f.robots !== "index, follow") L.push(`<meta name="robots" content="${esc(f.robots)}">`);
    if (f.url) L.push(`<link rel="canonical" href="${esc(f.url)}">`);
    L.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    L.push("", "<!-- Open Graph -->");
    L.push(`<meta property="og:type" content="${esc(f.type)}">`);
    if (f.title) L.push(`<meta property="og:title" content="${esc(f.title)}">`);
    if (f.description) L.push(`<meta property="og:description" content="${esc(f.description)}">`);
    if (f.url) L.push(`<meta property="og:url" content="${esc(f.url)}">`);
    if (f.image) L.push(`<meta property="og:image" content="${esc(f.image)}">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">');
    if (f.site) L.push(`<meta property="og:site_name" content="${esc(f.site)}">`);
    L.push("", "<!-- X (Twitter) -->");
    L.push(`<meta name="twitter:card" content="${f.image ? "summary_large_image" : "summary"}">`);
    if (f.twitter) L.push(`<meta name="twitter:site" content="${esc(f.twitter.startsWith("@") ? f.twitter : "@" + f.twitter)}">`);
    return L.join("\n");
  }, [f]);
  const host = (() => { try { return new URL(f.url).hostname.replace(/^www\./, ""); } catch { return "example.com"; } })();
  const inp = "w-full rounded-2xl border border-paper-dim px-4 py-2.5 text-sm outline-none focus:border-iris";
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="min-w-0 space-y-3 rounded-3xl bg-white p-5 shadow-float">
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Page title</span><input className={inp} value={f.title} onChange={set("title")} placeholder="Keyword first, promise second — under ~600px" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Meta description</span><textarea className={inp} rows={3} value={f.description} onChange={set("description")} placeholder="What the reader gets, in about 150 characters" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Canonical URL</span><input className={inp} value={f.url} onChange={set("url")} placeholder="https://yoursite.com/page" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Share image URL (1200×630)</span><input className={inp} value={f.image} onChange={set("image")} placeholder="https://yoursite.com/og/page.png" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Site name</span><input className={inp} value={f.site} onChange={set("site")} placeholder="Your Brand" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">X handle</span><input className={inp} value={f.twitter} onChange={set("twitter")} placeholder="@yourbrand" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Robots</span><select className={inp} value={f.robots} onChange={set("robots")}><option>index, follow</option><option>noindex, follow</option><option>noindex, nofollow</option><option>index, follow, max-image-preview:large</option></select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">og:type</span><select className={inp} value={f.type} onChange={set("type")}><option>website</option><option>article</option><option>product</option></select></label>
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <div className="rounded-3xl bg-white p-5 shadow-float">
          <SerpPreview title={f.title} description={f.description} url={f.url || "https://example.com/page"} />
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-float">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Your tags</span>
            <button type="button" onClick={() => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1 text-xs"><Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}</button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-2xl bg-ink p-3 text-[11.5px] leading-relaxed text-white/85"><code>{code}</code></pre>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-float">
          <SocialPreviews platforms={["facebook", "x"]} data={{ url: f.url, host, title: f.title || null, description: f.description || null, image: f.image || null, siteName: f.site || null, twitterCard: f.image ? "summary_large_image" : "summary" }} />
        </div>
      </div>
    </div>
  );
}
