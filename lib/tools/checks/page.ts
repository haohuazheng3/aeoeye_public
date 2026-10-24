/* ============================================================
   单页类检查:meta 标签清单、标题/描述预取、on-page 25 项、关键词密度、
   正文字数、链接提取、W3C HTML 校验。
   ============================================================ */

import { safeFetch } from "@/lib/seo-audit/fetch";
import { fetchRobots } from "@/lib/seo-audit/crawl";
import { isPathAllowedFor } from "@/lib/seo-audit/robots";
import { parseTarget, fetchAs, header, isHtml, fetchFailure, type FetchResult } from "../net";
import { parseDoc, metaTags, metaValue, titleOf, linkRels, headings, anchors, images, mainText, fullText, words, htmlLang, type ParsedDoc } from "../html";
import { type ToolResult, type CheckItem, type Status, worst, errorResult } from "../types";

const now = () => new Date().toISOString();

async function loadPage(input: string, botId = "browser"): Promise<{ t: ReturnType<typeof parseTarget>; r: FetchResult; doc: ParsedDoc } | { error: string }> {
  const t = parseTarget(input);
  const r = await fetchAs(t.url, botId);
  if (r.status === 0) return { error: fetchFailure(r) ?? "Unreachable" };
  if (!isHtml(r)) return { error: `That URL returned ${r.contentType || "a non-HTML response"} (HTTP ${r.status}), not an HTML page.` };
  return { t, r, doc: parseDoc(r.body) };
}

/** Google 在 SERP 里用约 600px 宽的标题区;没有字体度量时按平均字宽估算(前端用 canvas 精确量) */
export function estimatePixels(s: string, size = 20): number {
  let px = 0;
  for (const ch of s) {
    if ("ilI.,;:'|!jft ".includes(ch)) px += size * 0.28;
    else if ("mwMW".includes(ch)) px += size * 0.85;
    else if (/[A-Z0-9]/.test(ch)) px += size * 0.62;
    else px += size * 0.5;
  }
  return Math.round(px);
}

/* ---------------- meta 标签清单 ---------------- */

export async function metaTagChecker(input: string): Promise<ToolResult> {
  const p = await loadPage(input);
  if ("error" in p) return errorResult("meta", input, p.error);
  const { r, doc } = p;
  const tags = metaTags(doc);
  const rels = linkRels(doc, r.finalUrl);
  const title = titleOf(doc);
  const desc = metaValue(tags, "description");
  const robots = [metaValue(tags, "robots"), header(r, "x-robots-tag")].filter(Boolean).join(" | ");
  const canonical = rels.find((l) => l.rel === "canonical")?.href ?? null;
  const viewport = metaValue(tags, "viewport");
  const charset = tags.find((m) => m.attr === "charset")?.content ?? (/charset=([\w-]+)/i.exec(r.contentType)?.[1] ?? null);
  const lang = htmlLang(doc);
  const og = (k: string) => metaValue(tags, `og:${k}`);
  const tw = (k: string) => metaValue(tags, `twitter:${k}`);
  const hreflang = rels.filter((l) => l.rel === "alternate" && l.attrs.hreflang);
  const titles = doc.root.querySelectorAll("title").length;
  const descs = tags.filter((m) => m.key === "description").length;

  const items: CheckItem[] = [];
  const tl = title?.length ?? 0;
  items.push(!title ? { label: "Title", status: "fail", value: "missing", detail: "Every page needs a unique <title>; it's the main headline Google shows." } : { label: "Title", status: tl < 15 ? "warn" : estimatePixels(title) > 600 ? "warn" : "pass", value: `${title} (${tl} chars, ~${estimatePixels(title)}px)`, detail: estimatePixels(title) > 600 ? "Likely truncated on desktop (Google cuts around 600px)." : tl < 15 ? "Very short; add the topic and a reason to click." : undefined });
  if (titles > 1) items.push({ label: "Multiple <title> tags", status: "warn", value: `${titles}`, detail: "Browsers and Google use the first; remove the extras." });
  items.push(!desc ? { label: "Meta description", status: "warn", value: "missing", detail: "Google will write its own snippet from page text. Add one that states what the page delivers." } : { label: "Meta description", status: desc.length > 160 ? "warn" : desc.length < 70 ? "warn" : "pass", value: `${desc} (${desc.length} chars)`, detail: desc.length > 160 ? "Likely cut off (Google shows roughly 150–160 characters on desktop)." : desc.length < 70 ? "Short — you're leaving snippet space unused." : undefined });
  if (descs > 1) items.push({ label: "Multiple meta descriptions", status: "warn", value: `${descs}` });
  items.push({ label: "Robots directives", status: /noindex|none/i.test(robots) ? "fail" : "pass", value: robots || "none (index, follow by default)" });
  items.push(!canonical ? { label: "Canonical", status: "warn", value: "missing", detail: "Add a self-referencing rel=\"canonical\" to consolidate duplicate URLs (parameters, trailing slashes)." } : { label: "Canonical", status: canonical.replace(/\/$/, "") === r.finalUrl.replace(/\/$/, "") ? "pass" : "warn", value: canonical, detail: canonical.replace(/\/$/, "") === r.finalUrl.replace(/\/$/, "") ? "Self-referencing." : "Points to a different URL — Google may index that one instead." });
  items.push(!viewport ? { label: "Viewport", status: "fail", value: "missing", detail: "Without <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> the page renders zoomed-out on phones." } : { label: "Viewport", status: /width=device-width/.test(viewport) ? "pass" : "warn", value: viewport });
  items.push({ label: "Charset", status: charset ? "pass" : "warn", value: charset ?? "not declared" });
  items.push({ label: "Language (html lang)", status: lang ? "pass" : "warn", value: lang ?? "missing", detail: lang ? undefined : "Add lang=\"en\" (or your language) to the <html> tag." });
  const ogMissing = ["title", "description", "image", "url"].filter((k) => !og(k));
  items.push({ label: "Open Graph", status: ogMissing.length === 0 ? "pass" : ogMissing.length === 4 ? "fail" : "warn", value: ogMissing.length ? `missing og:${ogMissing.join(", og:")}` : "og:title, og:description, og:image, og:url present", detail: "Controls the preview on Facebook, LinkedIn, Slack and most chat apps." });
  items.push({ label: "X (Twitter) card", status: tw("card") ? "pass" : "info", value: tw("card") ? `twitter:card=${tw("card")}` : "no twitter:card (X falls back to Open Graph)" });
  items.push({ label: "hreflang", status: "info", value: hreflang.length ? `${hreflang.length} alternates: ${hreflang.slice(0, 6).map((h) => h.attrs.hreflang).join(", ")}` : "none" });
  const favicon = rels.find((l) => l.rel.split(/\s+/).includes("icon"));
  items.push({ label: "Favicon", status: favicon ? "pass" : "warn", value: favicon?.href ?? "no <link rel=\"icon\">" });

  const all = tags.map((m) => [m.attr, m.key, m.content.slice(0, 300)]);
  for (const l of rels) if (["canonical", "alternate", "icon", "shortcut icon", "apple-touch-icon", "manifest", "amphtml", "prev", "next"].includes(l.rel)) all.push(["link", l.rel + (l.attrs.hreflang ? ` (${l.attrs.hreflang})` : ""), l.href]);
  return {
    ok: true, tool: "meta", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: `${items.filter((i) => i.status === "pass").length} of ${items.length} meta checks pass on ${r.finalUrl}.`,
    sections: [{ title: "Graded tags", kind: "checks", items }, { title: `Every meta and link tag (${all.length})`, kind: "table", table: { columns: ["Type", "Name / rel", "Content"], rows: all } }],
  };
}

/** 标题/描述预览器:只取 title 与 description,像素宽度由前端 canvas 计算 */
export async function titleDescFetch(input: string): Promise<ToolResult> {
  const p = await loadPage(input);
  if ("error" in p) return errorResult("title", input, p.error);
  const tags = metaTags(p.doc);
  const title = titleOf(p.doc) ?? "";
  const desc = metaValue(tags, "description") ?? "";
  return {
    ok: true, tool: "title", input, url: p.r.finalUrl, fetchedAt: now(), verdict: "info",
    headline: `Loaded the live title (${title.length} chars) and meta description (${desc.length} chars).`,
    sections: [{ title: "SERP preview", kind: "serp", serp: { title, description: desc, url: p.r.finalUrl } }],
  };
}

/* ---------------- on-page 25 项 ---------------- */

export async function onPageChecker(input: string, opts: { keyword?: string } = {}): Promise<ToolResult> {
  const t = parseTarget(input);
  const [r, rules] = await Promise.all([fetchAs(t.url, "browser"), fetchRobots(t.origin)]);
  if (r.status === 0) return errorResult("onpage", input, fetchFailure(r) ?? "Unreachable");
  if (!isHtml(r)) return errorResult("onpage", input, `Not an HTML page (${r.contentType}).`);
  const doc = parseDoc(r.body);
  const tags = metaTags(doc);
  const rels = linkRels(doc, r.finalUrl);
  const host = t.host.replace(/^www\./, "");
  const title = titleOf(doc) ?? "";
  const desc = metaValue(tags, "description") ?? "";
  const hs = headings(doc);
  const h1s = hs.filter((h) => h.level === 1);
  const main = mainText(doc);
  const wc = words(main.text).length;
  const links = anchors(doc, r.finalUrl, host);
  const internal = links.filter((l) => l.internal && !l.inNav);
  const external = links.filter((l) => !l.internal);
  const imgs = images(doc, r.finalUrl);
  const noAlt = imgs.filter((i) => i.alt === null);
  const noDims = imgs.filter((i) => !i.width || !i.height);
  const robots = [metaValue(tags, "robots"), header(r, "x-robots-tag")].filter(Boolean).join(",");
  const canonical = rels.find((l) => l.rel === "canonical")?.href ?? null;
  const path = new URL(r.finalUrl).pathname;
  const kw = (opts.keyword || "").trim().toLowerCase();
  const first100 = words(main.text).slice(0, 100).join(" ");
  const types: string[] = [];
  for (const raw of doc.jsonLd) { try { const j = JSON.parse(raw); const walk = (o: unknown) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { const ty = (o as Record<string, unknown>)["@type"]; if (ty) types.push(...([] as string[]).concat(ty as string)); const g = (o as Record<string, unknown>)["@graph"]; if (g) walk(g); } }; walk(j); } catch { /* ignore */ } }

  type C = { group: string; label: string; status: Status; value: string; detail?: string; weight: number };
  const c: C[] = [];
  const add = (group: string, label: string, ok: boolean | "warn", value: string, detail: string | undefined, weight = 4) => c.push({ group, label, status: ok === true ? "pass" : ok === "warn" ? "warn" : "fail", value, detail, weight });
  add("Indexing", "HTTP status 200", r.status === 200, `HTTP ${r.status}`, r.status !== 200 ? "Only 200 pages are indexed normally." : undefined, 8);
  add("Indexing", "Not noindexed", !/noindex|none/i.test(robots), robots || "no directives", /noindex/i.test(robots) ? "This page asks not to be indexed." : undefined, 10);
  add("Indexing", "Crawlable (robots.txt)", isPathAllowedFor(rules, path, "Googlebot"), isPathAllowedFor(rules, path, "Googlebot") ? "allowed" : "blocked", undefined, 10);
  add("Indexing", "Self-referencing canonical", canonical ? (canonical.replace(/\/$/, "") === r.finalUrl.replace(/\/$/, "") ? true : "warn") : "warn", canonical ?? "missing", canonical && canonical.replace(/\/$/, "") !== r.finalUrl.replace(/\/$/, "") ? "Canonical points elsewhere; that URL will be indexed instead." : !canonical ? "Add a self-referencing canonical." : undefined, 4);
  add("Indexing", "HTTPS", r.finalUrl.startsWith("https://"), r.finalUrl.startsWith("https://") ? "yes" : "no", undefined, 4);
  add("Title & meta", "Title present", !!title, title || "missing", undefined, 6);
  add("Title & meta", "Title length", title ? (title.length >= 20 && estimatePixels(title) <= 600 ? true : "warn") : false, `${title.length} chars · ~${estimatePixels(title)}px`, estimatePixels(title) > 600 ? "Likely truncated in Google." : title.length < 20 ? "Short titles waste the most valuable space in the result." : undefined, 3);
  add("Title & meta", "Meta description", desc ? (desc.length >= 70 && desc.length <= 160 ? true : "warn") : "warn", desc ? `${desc.length} chars` : "missing", !desc ? "Google will generate one from page text." : undefined, 3);
  if (kw) add("Title & meta", `Keyword "${kw}" in title`, title.toLowerCase().includes(kw), title.toLowerCase().includes(kw) ? "yes" : "no", undefined, 4);
  add("Headings", "Exactly one H1", h1s.length === 1 ? true : h1s.length === 0 ? false : "warn", h1s.length ? h1s.map((h) => h.text).join(" | ").slice(0, 160) : "no H1", h1s.length > 1 ? "Multiple H1s aren't an error for Google, but one clear H1 states the topic." : undefined, 4);
  add("Headings", "Subheadings (H2)", hs.some((h) => h.level === 2), `${hs.filter((h) => h.level === 2).length} H2`, undefined, 2);
  const skipped = hs.some((h, i) => i > 0 && h.level > hs[i - 1].level + 1);
  add("Headings", "No skipped heading levels", !skipped, skipped ? "skips a level (e.g. H2 → H4)" : "ordered", undefined, 1);
  if (kw) add("Headings", `Keyword in H1`, h1s.some((h) => h.text.toLowerCase().includes(kw)), h1s.some((h) => h.text.toLowerCase().includes(kw)) ? "yes" : "no", undefined, 3);
  add("Content", "Main content length", wc >= 300 ? true : wc >= 150 ? "warn" : false, `${wc} words (${main.scope})`, wc < 300 ? "Thin pages rarely rank for competitive queries; make sure the page fully answers its query." : undefined, 6);
  add("Content", "Text in raw HTML", wc >= 100, wc >= 100 ? "present without JavaScript" : "almost no server-rendered text", wc < 100 ? "Most AI crawlers don't run JavaScript; server-render your main content." : undefined, 5);
  if (kw) add("Content", "Keyword in first 100 words", first100.includes(kw), first100.includes(kw) ? "yes" : "no", undefined, 3);
  add("Images", "Alt attributes", noAlt.length === 0 ? true : "warn", `${imgs.length - noAlt.length}/${imgs.length} have alt`, noAlt.length ? `${noAlt.length} image(s) have no alt attribute.` : undefined, 3);
  add("Images", "Width & height set", noDims.length <= 1 ? true : "warn", `${imgs.length - noDims.length}/${imgs.length}`, noDims.length > 1 ? "Images without dimensions cause layout shift (CLS)." : undefined, 2);
  add("Links", "Internal links in content", internal.length >= 3 ? true : internal.length ? "warn" : false, `${internal.length}`, internal.length < 3 ? "Link to 3+ related pages from the body to spread authority and help crawlers." : undefined, 4);
  add("Links", "External references", external.length > 0 ? true : "warn", `${external.length}`, undefined, 1);
  add("Structured data", "JSON-LD present", types.length > 0 ? true : "warn", types.length ? Array.from(new Set(types)).slice(0, 6).join(", ") : "none", types.length ? undefined : "Add Organization / Article / Product markup as relevant.", 3);
  add("Social", "Open Graph image", !!metaValue(tags, "og:image"), metaValue(tags, "og:image") ?? "missing", undefined, 2);
  const viewport = metaValue(tags, "viewport");
  add("Mobile", "Viewport meta", viewport ? /width=device-width/.test(viewport) : false, viewport ?? "missing", undefined, 4);
  add("Mobile", "html lang", !!htmlLang(doc), htmlLang(doc) ?? "missing", undefined, 1);
  add("Speed", "HTML size", r.bytes < 500 * 1024 ? true : "warn", `${Math.round(r.bytes / 1024)} KB`, r.bytes >= 500 * 1024 ? "Large HTML slows parsing on phones." : undefined, 2);
  add("Speed", "Compression", /br|gzip|zstd/.test(header(r, "content-encoding") || "") ? true : "warn", header(r, "content-encoding") || "none", undefined, 2);
  const total = c.reduce((s, x) => s + x.weight, 0);
  const got = c.reduce((s, x) => s + (x.status === "pass" ? x.weight : x.status === "warn" ? x.weight / 2 : 0), 0);
  const score = Math.round((got / total) * 100);
  const groups = Array.from(new Set(c.map((x) => x.group)));
  return {
    ok: true, tool: "onpage", input, url: r.finalUrl, fetchedAt: now(), score,
    verdict: score >= 85 ? "pass" : score >= 60 ? "warn" : "fail",
    headline: `On-page score ${score}/100 — ${c.filter((x) => x.status === "pass").length} of ${c.length} checks pass.`,
    sections: groups.map((g) => ({ title: g, kind: "checks" as const, items: c.filter((x) => x.group === g).map(({ label, status, value, detail }) => ({ label, status, value, detail })) })),
  };
}

/* ---------------- 关键词密度 ---------------- */

const STOP = new Set("a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our she so than that the their them then there these they this to too us was we were what when where which who why will with you your can do does did just also more most about over up out all any been being both each few how only other own same some such very s t now one get".split(" "));

export async function keywordDensity(input: string, opts: { keyword?: string } = {}): Promise<ToolResult> {
  const p = await loadPage(input);
  if ("error" in p) return errorResult("density", input, p.error);
  const { r, doc } = p;
  const main = mainText(doc);
  const w = words(main.text);
  const total = w.length;
  const count = (n: number) => {
    const m = new Map<string, number>();
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.some((x) => x.length < 2 || /^\d+$/.test(x))) continue;
      const k = g.join(" ");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).filter(([, v]) => v >= (n === 1 ? 2 : 2)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, v, `${((v * n) / Math.max(total, 1) * 100).toFixed(2)}%`]);
  };
  const sections: ToolResult["sections"] = [];
  const kw = (opts.keyword || "").trim().toLowerCase();
  if (kw) {
    const kwWords = words(kw);
    let hits = 0;
    for (let i = 0; i + kwWords.length <= w.length; i++) if (w.slice(i, i + kwWords.length).join(" ") === kwWords.join(" ")) hits++;
    const density = (hits * kwWords.length) / Math.max(total, 1) * 100;
    const tags = metaTags(doc);
    const title = (titleOf(doc) ?? "").toLowerCase();
    const h1 = headings(doc).filter((h) => h.level === 1).map((h) => h.text.toLowerCase()).join(" ");
    const desc = (metaValue(tags, "description") ?? "").toLowerCase();
    const path = new URL(r.finalUrl).pathname.toLowerCase().replace(/[-_/]/g, " ");
    const first = w.slice(0, 100).join(" ");
    sections.push({
      title: `Target keyword: "${kw}"`, kind: "checks", items: [
        { label: "Occurrences in main content", status: hits ? "pass" : "fail", value: `${hits}× · ${density.toFixed(2)}% density` , detail: density > 3 ? "Above ~3% the text usually reads as stuffed; Google's spam policies call out keyword stuffing." : hits === 0 ? "The exact phrase never appears in the body." : "Natural range." },
        { label: "In title", status: title.includes(kw) ? "pass" : "warn", value: title.includes(kw) ? "yes" : "no" },
        { label: "In H1", status: h1.includes(kw) ? "pass" : "warn", value: h1.includes(kw) ? "yes" : "no" },
        { label: "In first 100 words", status: first.includes(kw) ? "pass" : "warn", value: first.includes(kw) ? "yes" : "no" },
        { label: "In meta description", status: desc.includes(kw) ? "pass" : "info", value: desc.includes(kw) ? "yes" : "no" },
        { label: "In URL", status: path.includes(kw) ? "pass" : "info", value: path.includes(kw) ? "yes" : "no" },
      ],
    });
  }
  sections.push({ title: "Top single words", kind: "table", table: { columns: ["Word", "Count", "Density"], rows: count(1) } });
  sections.push({ title: "Top 2-word phrases", kind: "table", table: { columns: ["Phrase", "Count", "Density"], rows: count(2) } });
  sections.push({ title: "Top 3-word phrases", kind: "table", table: { columns: ["Phrase", "Count", "Density"], rows: count(3) } });
  return {
    ok: true, tool: "density", input, url: r.finalUrl, fetchedAt: now(), verdict: "info",
    headline: `${total.toLocaleString()} words in the main content (${main.scope}); stop words excluded from the phrase lists.`,
    sections,
  };
}

/* ---------------- 正文字数 ---------------- */

export async function wordCounter(input: string): Promise<ToolResult> {
  const p = await loadPage(input);
  if ("error" in p) return errorResult("wordcount", input, p.error);
  const { r, doc } = p;
  const main = mainText(doc);
  const mw = words(main.text).length;
  const fw = words(fullText(doc)).length;
  const hs = headings(doc);
  const paras = doc.root.querySelectorAll("p").filter((x) => words(x.text).length >= 8).length;
  const sentences = (main.text.match(/[.!?]+(\s|$)/g) ?? []).length;
  const minutes = Math.max(1, Math.round(mw / 238));
  return {
    ok: true, tool: "wordcount", input, url: r.finalUrl, fetchedAt: now(), verdict: "info",
    headline: `${mw.toLocaleString()} words in the main content · ${fw.toLocaleString()} on the whole page · ~${minutes} min read.`,
    sections: [{
      title: "Counts", kind: "kv", kv: [
        { key: "Main content words", value: `${mw.toLocaleString()} (measured inside <${main.scope}>, menus/footers removed)` },
        { key: "All visible words (incl. navigation)", value: fw.toLocaleString() },
        { key: "Boilerplate share", value: fw ? `${Math.round((1 - mw / fw) * 100)}%` : "—" },
        { key: "Headings", value: `${hs.length} (H1 ${hs.filter((h) => h.level === 1).length} · H2 ${hs.filter((h) => h.level === 2).length} · H3 ${hs.filter((h) => h.level === 3).length})` },
        { key: "Paragraphs (8+ words)", value: String(paras) },
        { key: "Sentences", value: String(sentences) },
        { key: "Average sentence length", value: sentences ? `${Math.round(mw / sentences)} words` : "—" },
        { key: "Reading time", value: `${minutes} min at 238 wpm` },
      ],
    }],
  };
}

/* ---------------- 链接提取 ---------------- */

export async function linkExtractor(input: string): Promise<ToolResult> {
  const p = await loadPage(input);
  if ("error" in p) return errorResult("links", input, p.error);
  const { t, r, doc } = p;
  const host = t.host.replace(/^www\./, "");
  const links = anchors(doc, r.finalUrl, host);
  const rows = links.map((l) => [l.href, l.text || "(no text)", l.internal ? "internal" : "external", l.rel || "—", l.inNav ? "nav/footer" : "content"]);
  const csv = ["url,anchor,type,rel,location", ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const nofollow = links.filter((l) => /nofollow|sponsored|ugc/.test(l.rel)).length;
  return {
    ok: true, tool: "links", input, url: r.finalUrl, fetchedAt: now(), verdict: "info",
    headline: `${links.length} links: ${links.filter((l) => l.internal).length} internal, ${links.filter((l) => !l.internal).length} external, ${nofollow} with nofollow/sponsored/ugc.`,
    sections: [{ title: "All links", kind: "table", table: { columns: ["URL", "Anchor text", "Type", "rel", "Where"], rows } }],
    download: { filename: "links.csv", mime: "text/csv", content: csv },
  };
}

/* ---------------- W3C HTML 校验 ---------------- */

const SEO_RELEVANT = /head|title|meta|link|stray|duplicate id|unclosed|end tag|nested|not allowed as child|attribute .*not allowed|alt/i;

export async function htmlChecker(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const res = await safeFetch(`https://validator.w3.org/nu/?out=json&doc=${encodeURIComponent(t.url)}`, { timeoutMs: 25_000, maxBytes: 2 * 1024 * 1024, accept: "application/json" });
  if (res.status !== 200) return errorResult("html", input, `The W3C validator didn't respond (HTTP ${res.status || "—"}). Try again in a minute.`);
  let data: { messages?: { type: string; subType?: string; message: string; lastLine?: number; extract?: string }[] };
  try { data = JSON.parse(res.body); } catch { return errorResult("html", input, "The W3C validator returned an unreadable response."); }
  const msgs = data.messages ?? [];
  const errors = msgs.filter((m) => m.type === "error");
  const warnings = msgs.filter((m) => m.type === "info" && m.subType === "warning");
  const fatal = msgs.find((m) => m.type === "non-document-error");
  if (fatal) return errorResult("html", input, `The validator couldn't fetch the page: ${fatal.message}`);
  const seo = errors.filter((m) => SEO_RELEVANT.test(m.message));
  const rows = [...seo, ...errors.filter((m) => !seo.includes(m))].slice(0, 150).map((m) => [m.lastLine ?? "—", SEO_RELEVANT.test(m.message) ? "SEO-relevant" : "other", m.message.slice(0, 220), (m.extract ?? "").replace(/\s+/g, " ").slice(0, 120)]);
  return {
    ok: true, tool: "html", input, url: t.url, fetchedAt: now(),
    verdict: seo.length ? "warn" : errors.length ? "info" : "pass",
    headline: `${errors.length} error(s), ${warnings.length} warning(s) from the W3C Nu validator — ${seo.length} affect how crawlers read the page.`,
    sections: [{ title: "Errors (SEO-relevant first)", kind: "table", table: { columns: ["Line", "Impact", "Message", "Code"], rows } }],
  };
}
