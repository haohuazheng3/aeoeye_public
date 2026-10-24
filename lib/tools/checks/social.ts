/* ============================================================
   社交预览类检查:Open Graph、OG 图片、X 卡片、Facebook 视角、多平台预览、favicon。
   规则出处:ogp.me、developers.facebook.com/docs/sharing/webmasters、
   developer.x.com cards、LinkedIn Post Inspector 帮助页、Google 的 favicon 指南。
   ============================================================ */

import { parseTarget, fetchAs, isHtml, fetchFailure, pool } from "../net";
import { parseDoc, metaTags, metaValue, titleOf, linkRels, absUrl, type MetaTag } from "../html";
import { probeImage, kb, type ImageProbe } from "../image";
import { BOTS } from "../bots";
import { type ToolResult, type CheckItem, type SocialPreview, worst, errorResult } from "../types";

const now = () => new Date().toISOString();

async function load(input: string, botId = "browser") {
  const t = parseTarget(input);
  const r = await fetchAs(t.url, botId, { maxBytes: 1024 * 1024 });
  if (r.status === 0) return { error: fetchFailure(r) ?? "Unreachable" } as const;
  if (!isHtml(r)) return { error: `That URL returned ${r.contentType || "a non-HTML response"}, not a page.` } as const;
  const doc = parseDoc(r.body);
  return { t, r, doc, tags: metaTags(doc) } as const;
}

function preview(url: string, tags: MetaTag[], title: string | null, rels: { rel: string; href: string }[]): SocialPreview {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  const v = (k: string) => metaValue(tags, k);
  const image = absUrl(v("og:image") || v("og:image:url") || v("og:image:secure_url"), url);
  return {
    url, host,
    title: v("og:title") || title,
    description: v("og:description") || v("description"),
    image,
    siteName: v("og:site_name"),
    twitterCard: v("twitter:card"),
    twitterTitle: v("twitter:title"),
    twitterDescription: v("twitter:description"),
    twitterImage: absUrl(v("twitter:image") || v("twitter:image:src"), url),
    favicon: rels.find((l) => l.rel.split(/\s+/).includes("icon"))?.href ?? null,
  };
}

function imageItems(p: ImageProbe | null, label: string, minW: number, minH: number, maxBytes: number): CheckItem[] {
  if (!p) return [{ label, status: "fail", value: "not set" }];
  const items: CheckItem[] = [];
  if (!p.ok) return [{ label, status: "fail", value: `HTTP ${p.status || "no response"} · ${p.url}`, detail: "The image URL doesn't load, so platforms show no picture." }];
  const dims = p.width && p.height ? `${p.width}×${p.height}` : "unknown size";
  const ratio = p.width && p.height ? p.width / p.height : null;
  items.push({ label, status: "pass", value: `${dims} · ${p.format ?? p.contentType} · ${kb(p.bytes)}`, detail: p.url });
  if (p.width && p.height && (p.width < minW || p.height < minH)) items.push({ label: "Image size", status: "warn", value: dims, detail: `Below the recommended ${minW}×${minH}; platforms may show a small thumbnail instead of a large card.` });
  else if (p.width && p.height) items.push({ label: "Image size", status: "pass", value: dims, detail: ratio && Math.abs(ratio - 1.91) > 0.25 ? `Aspect ratio ${ratio.toFixed(2)}:1 — expect cropping to roughly 1.91:1.` : "Meets the 1200×630 recommendation." });
  if (p.bytes && p.bytes > maxBytes) items.push({ label: "File size", status: "warn", value: kb(p.bytes), detail: `Over ${kb(maxBytes)}; some platforms skip or time out on heavy images.` });
  if (p.format === "svg") items.push({ label: "Format", status: "fail", value: "SVG", detail: "Facebook, LinkedIn and X don't render SVG preview images. Use PNG, JPEG or WebP." });
  if (p.format === "avif") items.push({ label: "Format", status: "warn", value: "AVIF", detail: "Not every platform renders AVIF previews yet; PNG or JPEG is the safe choice." });
  return items;
}

/* ---------------- Open Graph ---------------- */

export async function openGraphChecker(input: string): Promise<ToolResult> {
  const p = await load(input);
  if ("error" in p) return errorResult("og", input, p.error ?? "Unreachable");
  const { r, doc, tags } = p;
  const rels = linkRels(doc, r.finalUrl);
  const og = tags.filter((m) => m.key.startsWith("og:"));
  const v = (k: string) => metaValue(tags, k);
  const items: CheckItem[] = [];
  const req: [string, string][] = [["og:title", "The headline of the card."], ["og:type", "Usually website or article."], ["og:image", "The picture; without it most platforms show a bare link."], ["og:url", "The canonical URL that likes and shares are counted against."]];
  for (const [k, why] of req) {
    const val = v(k);
    items.push(val ? { label: k, status: "pass", value: val.slice(0, 200) } : { label: k, status: k === "og:type" ? "warn" : "fail", value: "missing", detail: why });
  }
  const d = v("og:description");
  items.push(d ? { label: "og:description", status: d.length > 200 ? "warn" : "pass", value: `${d.slice(0, 200)} (${d.length} chars)`, detail: d.length > 200 ? "Most platforms cut descriptions around 200 characters; Facebook often shows far less." : undefined } : { label: "og:description", status: "warn", value: "missing", detail: "Platforms fall back to the meta description or page text." });
  items.push({ label: "og:site_name", status: v("og:site_name") ? "pass" : "info", value: v("og:site_name") ?? "not set" });
  const canonical = rels.find((l) => l.rel === "canonical")?.href;
  const ogUrl = v("og:url");
  if (ogUrl && canonical && ogUrl.replace(/\/$/, "") !== canonical.replace(/\/$/, "")) items.push({ label: "og:url vs canonical", status: "warn", value: `${ogUrl} ≠ ${canonical}`, detail: "Share counts and previews split across URLs when these disagree." });
  const dup = ["og:title", "og:description", "og:url"].filter((k) => tags.filter((m) => m.key === k).length > 1);
  if (dup.length) items.push({ label: "Duplicate tags", status: "warn", value: dup.join(", "), detail: "Platforms take the first one — often the wrong one from a plugin." });
  const badAttr = tags.filter((m) => m.attr === "name" && m.key.startsWith("og:")).length;
  if (badAttr) items.push({ label: "Attribute", status: "warn", value: `${badAttr} og: tag(s) use name=`, detail: "The Open Graph protocol uses property=\"og:…\". Facebook tolerates name=, others may not." });
  const imgUrl = absUrl(v("og:image"), r.finalUrl);
  const probe = imgUrl ? await probeImage(imgUrl) : null;
  items.push(...imageItems(probe, "og:image loads", 1200, 630, 8 * 1024 * 1024));
  return {
    ok: true, tool: "og", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: `${og.length} Open Graph tag(s); ${items.filter((i) => i.status === "fail").length ? `${items.filter((i) => i.status === "fail").length} required piece(s) missing or broken` : "the four required tags are present"}.`,
    sections: [
      { title: "Open Graph check", kind: "checks", items },
      { title: "Preview", kind: "previews", previews: { platforms: ["facebook", "linkedin"], data: { ...preview(r.finalUrl, tags, titleOf(doc), rels), imageWidth: probe?.width ?? null, imageHeight: probe?.height ?? null } } },
      { title: `All og: tags (${og.length})`, kind: "table", table: { columns: ["Property", "Content"], rows: og.map((m) => [m.key, m.content.slice(0, 300)]) } },
    ],
  };
}

/* ---------------- OG 图片 ---------------- */

export async function ogImageChecker(input: string): Promise<ToolResult> {
  const p = await load(input);
  if ("error" in p) return errorResult("og-image", input, p.error ?? "Unreachable");
  const { r, doc, tags } = p;
  const urls = Array.from(new Set(tags.filter((m) => ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(m.key)).map((m) => absUrl(m.content, r.finalUrl)).filter(Boolean) as string[])).slice(0, 4);
  if (!urls.length) {
    return { ok: true, tool: "og-image", input, url: r.finalUrl, fetchedAt: now(), verdict: "fail", headline: "This page has no og:image, so shares show no picture (or whatever image the platform guesses).", sections: [{ title: "OG image", kind: "checks", items: [{ label: "og:image", status: "fail", value: "missing", detail: "Add <meta property=\"og:image\" content=\"https://…/card.png\"> with a 1200×630 PNG or JPEG." }] }] };
  }
  const probes = await pool(urls, 3, (u) => probeImage(u));
  const main = probes[0];
  const items = imageItems(main, "Primary og:image", 1200, 630, 5 * 1024 * 1024);
  const declaredW = metaValue(tags, "og:image:width"), declaredH = metaValue(tags, "og:image:height");
  if (declaredW && declaredH && main.width && main.height && (Number(declaredW) !== main.width || Number(declaredH) !== main.height)) items.push({ label: "Declared size", status: "warn", value: `tags say ${declaredW}×${declaredH}, file is ${main.width}×${main.height}`, detail: "Wrong og:image:width/height can make Facebook render the first share without an image." });
  else items.push({ label: "og:image:width / height", status: declaredW && declaredH ? "pass" : "info", value: declaredW && declaredH ? `${declaredW}×${declaredH}` : "not declared", detail: declaredW ? undefined : "Optional, but declaring them lets Facebook render the image on the very first share." });
  items.push({ label: "og:image:alt", status: metaValue(tags, "og:image:alt") ? "pass" : "info", value: metaValue(tags, "og:image:alt") ?? "not set" });
  const rows = probes.map((q) => [q.url, q.width && q.height ? `${q.width}×${q.height}` : "—", q.format ?? q.contentType, kb(q.bytes), q.ok ? "loads" : `HTTP ${q.status}`]);
  return {
    ok: true, tool: "og-image", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: main.ok ? `Your og:image is ${main.width ?? "?"}×${main.height ?? "?"} px (${main.format ?? "unknown format"}, ${kb(main.bytes)}). Recommended: 1200×630.` : "Your og:image doesn't load.",
    sections: [
      { title: "OG image check", kind: "checks", items },
      { title: "How it crops on each platform", kind: "previews", previews: { platforms: ["facebook", "linkedin", "x", "slack"], data: { ...preview(r.finalUrl, tags, titleOf(doc), linkRels(doc, r.finalUrl)), image: main.url, imageWidth: main.width, imageHeight: main.height } } },
      { title: "Every image tag on the page", kind: "table", table: { columns: ["URL", "Pixels", "Format", "Size", "Status"], rows } },
    ],
  };
}

/* ---------------- X / Twitter 卡片 ---------------- */

export async function twitterCardValidator(input: string): Promise<ToolResult> {
  const p = await load(input, "twitterbot");
  if ("error" in p) return errorResult("twitter", input, p.error ?? "Unreachable");
  const { r, doc, tags } = p;
  const v = (k: string) => metaValue(tags, k);
  const card = v("twitter:card");
  const title = v("twitter:title") || v("og:title");
  const desc = v("twitter:description") || v("og:description");
  const img = absUrl(v("twitter:image") || v("twitter:image:src") || v("og:image"), r.finalUrl);
  const items: CheckItem[] = [];
  items.push(card ? { label: "twitter:card", status: ["summary", "summary_large_image", "app", "player"].includes(card) ? "pass" : "fail", value: card, detail: ["summary", "summary_large_image", "app", "player"].includes(card) ? undefined : "Valid values are summary, summary_large_image, app and player." } : { label: "twitter:card", status: "warn", value: "missing", detail: "Without it X shows a small summary card at best. Add twitter:card=summary_large_image for the big image layout." });
  items.push({ label: "Title", status: title ? "pass" : "fail", value: title ? `${title.slice(0, 120)}${v("twitter:title") ? "" : "  (from og:title)"}` : "missing" });
  items.push({ label: "Description", status: desc ? "pass" : "info", value: desc ? `${desc.slice(0, 160)}${v("twitter:description") ? "" : "  (from og:description)"}` : "missing (X no longer shows descriptions on most cards)" });
  const probe = img ? await probeImage(img, "twitterbot") : null;
  items.push(...imageItems(probe, `Image${v("twitter:image") ? "" : " (from og:image)"}`, card === "summary" ? 144 : 600, card === "summary" ? 144 : 314, 5 * 1024 * 1024));
  items.push({ label: "twitter:site", status: v("twitter:site") ? "pass" : "info", value: v("twitter:site") ?? "not set", detail: "The @handle of the site, shown as attribution." });
  items.push({ label: "Fetched as Twitterbot", status: r.status === 200 ? "pass" : "fail", value: `HTTP ${r.status}`, detail: r.status === 200 ? "X's crawler can read the page." : "If X's crawler can't fetch the page, no card appears." });
  return {
    ok: true, tool: "twitter", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: `${card ? `twitter:card=${card}` : "No twitter:card tag"}${img ? "; image found" : "; no image"} — here is how the card renders.`,
    sections: [
      { title: "X card check", kind: "checks", items },
      { title: "Twitter card preview", kind: "previews", previews: { platforms: ["x"], data: { ...preview(r.finalUrl, tags, titleOf(doc), linkRels(doc, r.finalUrl)), imageWidth: probe?.width ?? null, imageHeight: probe?.height ?? null } } },
    ],
  };
}

/* ---------------- Facebook 视角 ---------------- */

export async function facebookDebugger(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const r = await fetchAs(t.url, "facebook", { maxBytes: 1024 * 1024 });
  if (r.status === 0) return errorResult("facebook", input, fetchFailure(r) ?? "Unreachable");
  const items: CheckItem[] = [];
  items.push({ label: "Response to facebookexternalhit", status: r.status === 200 ? "pass" : "fail", value: `HTTP ${r.status}${r.chain.length ? ` after ${r.chain.length} redirect(s)` : ""}`, detail: r.status === 200 ? undefined : "Facebook can't build a preview if its crawler is blocked or gets an error. Check firewall rules for this user-agent." });
  if (!isHtml(r)) return { ok: true, tool: "facebook", input, url: r.finalUrl, fetchedAt: now(), verdict: "fail", headline: "Facebook's crawler didn't get an HTML page.", sections: [{ title: "Facebook crawl", kind: "checks", items }] };
  const doc = parseDoc(r.body);
  const tags = metaTags(doc);
  const v = (k: string) => metaValue(tags, k);
  const firstMeta = r.body.toLowerCase().indexOf('property="og:');
  if (firstMeta > 1_000_000) items.push({ label: "Tag position", status: "warn", value: "og: tags appear late", detail: "Facebook reads only the start of the page; keep Open Graph tags in the <head>." });
  for (const k of ["og:url", "og:title", "og:description", "og:image", "og:type"]) items.push(v(k) ? { label: k, status: "pass", value: (v(k) as string).slice(0, 200) } : { label: k, status: k === "og:image" || k === "og:title" ? "fail" : "warn", value: "missing", detail: k === "og:url" ? "Facebook falls back to the URL you shared." : "Facebook will guess from page content." });
  items.push({ label: "fb:app_id", status: "info", value: v("fb:app_id") ?? "not set", detail: "Only needed for Facebook Insights; its absence is a warning in Meta's tool, not an error." });
  const img = absUrl(v("og:image"), r.finalUrl);
  const probe = img ? await probeImage(img, "facebook") : null;
  items.push(...imageItems(probe, "Image Facebook will use", 600, 315, 8 * 1024 * 1024));
  return {
    ok: true, tool: "facebook", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: r.status === 200 ? `Facebook's crawler gets HTTP 200 and ${v("og:image") ? "an og:image" : "no og:image"}. If Facebook shows an old preview, re-scrape it in Meta's Sharing Debugger.` : `Facebook's crawler gets HTTP ${r.status}.`,
    sections: [
      { title: "What facebookexternalhit sees", kind: "checks", items },
      { title: "Facebook preview", kind: "previews", previews: { platforms: ["facebook"], data: { ...preview(r.finalUrl, tags, titleOf(doc), linkRels(doc, r.finalUrl)), imageWidth: probe?.width ?? null, imageHeight: probe?.height ?? null } } },
      { title: "Request details", kind: "kv", kv: [{ key: "User-agent sent", value: BOTS.facebook.ua }, { key: "Final URL", value: r.finalUrl }] },
    ],
  };
}

/* ---------------- 多平台链接预览 ---------------- */

export async function linkPreview(input: string): Promise<ToolResult> {
  const p = await load(input);
  if ("error" in p) return errorResult("link-preview", input, p.error ?? "Unreachable");
  const { r, doc, tags } = p;
  const data = preview(r.finalUrl, tags, titleOf(doc), linkRels(doc, r.finalUrl));
  const probe = data.image ? await probeImage(data.image) : null;
  const items: CheckItem[] = [
    { label: "Title", status: data.title ? "pass" : "fail", value: data.title ?? "missing", detail: metaValue(tags, "og:title") ? "From og:title." : data.title ? "From <title> — add og:title for control." : undefined },
    { label: "Description", status: data.description ? "pass" : "warn", value: data.description?.slice(0, 200) ?? "missing" },
    ...imageItems(probe, "Image", 1200, 630, 5 * 1024 * 1024),
    { label: "Site name", status: data.siteName ? "pass" : "info", value: data.siteName ?? `not set (platforms show ${data.host})` },
  ];
  return {
    ok: true, tool: "link-preview", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: `Previews built from ${metaValue(tags, "og:title") ? "your Open Graph tags" : "fallback page data (no og:title)"} — this is roughly how each app will show the link.`,
    sections: [
      { title: "Link previews", kind: "previews", previews: { platforms: ["facebook", "linkedin", "x", "slack", "discord", "imessage"], data: { ...data, imageWidth: probe?.width ?? null, imageHeight: probe?.height ?? null } } },
      { title: "What the previews are built from", kind: "checks", items },
    ],
  };
}

/* ---------------- favicon ---------------- */

export async function faviconChecker(input: string): Promise<ToolResult> {
  const p = await load(input);
  if ("error" in p) return errorResult("favicon", input, p.error ?? "Unreachable");
  const { t, r, doc } = p;
  const rels = linkRels(doc, r.finalUrl).filter((l) => /(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)(\s|$)/.test(l.rel));
  const candidates = Array.from(new Set([...rels.map((l) => l.href), `${t.origin}/favicon.ico`])).slice(0, 8);
  const probes = await pool(candidates, 4, (u) => probeImage(u, "googlebot"));
  const rows = probes.map((q, i) => {
    const decl = rels.find((l) => l.href === candidates[i]);
    return [candidates[i], decl ? decl.rel + (decl.attrs.sizes ? ` (${decl.attrs.sizes})` : "") : "default /favicon.ico", q.ok ? `HTTP ${q.status}` : `HTTP ${q.status || "—"}`, q.format ?? "—", q.icoSizes?.join(", ") || (q.width ? `${q.width}×${q.height}` : "—")];
  });
  const declared = rels.filter((l) => l.rel.split(/\s+/).includes("icon"));
  const okIcons = probes.filter((q) => q.ok && q.format);
  // Google 现行规则(favicon-in-search,2026-10 核对):必须正方形且至少 8×8px;建议大于 48×48px;SVG 无尺寸要求
  const maxSide = (q: (typeof okIcons)[number]) => Math.max(...(q.icoSizes?.map((x) => Number(x.split("×")[0])) ?? []), q.width ?? 0);
  const isSquare = (q: (typeof okIcons)[number]) => q.format === "svg" || q.format === "ico" || !q.width || !q.height || q.width === q.height;
  const meetsMin = okIcons.find((q) => q.format === "svg" || (isSquare(q) && maxSide(q) >= 8));
  const google = okIcons.find((q) => q.format === "svg" || (isSquare(q) && maxSide(q) >= 48));
  const square = okIcons.every(isSquare);
  const items: CheckItem[] = [
    { label: "Declared in HTML", status: declared.length ? "pass" : "warn", value: declared.length ? `${declared.length} <link rel="icon">` : "none", detail: declared.length ? undefined : "Google prefers an explicit <link rel=\"icon\"> in the homepage <head>; /favicon.ico alone may not be picked up." },
    { label: "At least one icon loads", status: okIcons.length ? "pass" : "fail", value: `${okIcons.length} of ${probes.length}` },
    { label: "Google minimum (square, at least 8×8px)", status: meetsMin ? "pass" : "fail", value: meetsMin ? `${meetsMin.format} ${maxSide(meetsMin) || "vector"}${meetsMin.format === "svg" ? "" : "px"}` : "none found", detail: "Google Search only shows a favicon that is square (1:1) and at least 8×8px. SVG has no size requirement." },
    { label: "Recommended size (48×48px or larger, or SVG)", status: google ? "pass" : "warn", value: google ? `${google.format} ${google.format === "svg" ? "vector" : `${maxSide(google)}px`}` : "only small icons found", detail: "Google recommends a favicon larger than 48×48px so it stays sharp on high-density screens and across surfaces." },
    { label: "Square", status: square ? "pass" : "warn", value: square ? "yes" : "non-square icon found" },
    { label: "Apple touch icon", status: rels.some((l) => l.rel.includes("apple-touch-icon")) ? "pass" : "info", value: rels.some((l) => l.rel.includes("apple-touch-icon")) ? "present" : "not set (180×180 PNG recommended for iOS home screens)" },
    { label: "Same host", status: declared.every((l) => { try { return new URL(l.href).hostname.endsWith(t.host.replace(/^www\./, "")); } catch { return true; } }) ? "pass" : "info", value: "icon URLs", detail: "Google crawls the favicon with Googlebot-Image; the URL must be crawlable and stable." },
  ];
  return {
    ok: true, tool: "favicon", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: google ? "Your favicon meets Google's search-result requirements, including the recommended size." : meetsMin ? "Your favicon qualifies for Google Search, but it's below the recommended 48×48px and may look blurry." : okIcons.length ? "A favicon loads, but it isn't square or is smaller than 8×8px, so Google may not show it." : "No working favicon found.",
    sections: [{ title: "Favicon check", kind: "checks", items }, { title: "Every icon we found", kind: "table", table: { columns: ["URL", "Declared as", "Status", "Format", "Pixels"], rows } }],
  };
}
