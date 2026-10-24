/* ============================================================
   工具页用的 HTML 读取:先过审计引擎的线性预扫描 prepareMarkup(防 DOM 炸弹、
   切出 script/style 原文),再交给 node-html-parser。所有提取函数都容错:
   缺什么返回空,不抛。
   ============================================================ */

import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import { prepareMarkup } from "@/lib/seo-audit/parse";

export interface ParsedDoc {
  root: HTMLElement;
  /** <script type="application/ld+json"> 的原文 */
  jsonLd: string[];
  /** 所有 <script> 的总字节(估 JS 依赖) */
  scriptBytes: number;
  truncated: boolean;
}

export function parseDoc(html: string): ParsedDoc {
  const prepared = prepareMarkup(html || "");
  const root = parseHtml(prepared.html, {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: {},
    parseNoneClosedTags: true,
  } as Parameters<typeof parseHtml>[1]);
  const jsonLd: string[] = [];
  let scriptBytes = 0;
  for (const b of prepared.blocks) {
    if (b.tag !== "script") continue;
    scriptBytes += b.outerLength;
    if (/type\s*=\s*["']?application\/ld\+json/i.test(b.openTag)) jsonLd.push(b.content);
  }
  return { root, jsonLd, scriptBytes, truncated: prepared.truncated };
}

const text = (el: HTMLElement | null | undefined) => (el ? el.text.replace(/\s+/g, " ").trim() : "");

export function absUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export interface MetaTag {
  attr: "name" | "property" | "http-equiv" | "charset" | "itemprop";
  key: string;
  content: string;
}

export function metaTags(doc: ParsedDoc): MetaTag[] {
  const out: MetaTag[] = [];
  for (const m of doc.root.querySelectorAll("meta")) {
    const content = m.getAttribute("content") ?? "";
    const charset = m.getAttribute("charset");
    if (charset) { out.push({ attr: "charset", key: "charset", content: charset }); continue; }
    for (const attr of ["name", "property", "http-equiv", "itemprop"] as const) {
      const k = m.getAttribute(attr);
      if (k) { out.push({ attr, key: k.trim().toLowerCase(), content: content.trim() }); break; }
    }
  }
  return out;
}

export function metaValue(tags: MetaTag[], key: string): string | null {
  const t = tags.find((m) => m.key === key.toLowerCase());
  return t ? t.content : null;
}

export function titleOf(doc: ParsedDoc): string | null {
  const t = doc.root.querySelector("title");
  return t ? text(t) : null;
}

export function linkRels(doc: ParsedDoc, base: string): { rel: string; href: string; attrs: Record<string, string> }[] {
  const out: { rel: string; href: string; attrs: Record<string, string> }[] = [];
  for (const l of doc.root.querySelectorAll("link")) {
    const rel = (l.getAttribute("rel") || "").toLowerCase().trim();
    const href = absUrl(l.getAttribute("href"), base);
    if (!rel || !href) continue;
    out.push({ rel, href, attrs: l.attributes as Record<string, string> });
  }
  return out;
}

export interface Heading { level: number; text: string }

export function headings(doc: ParsedDoc): Heading[] {
  const out: Heading[] = [];
  for (const h of doc.root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    out.push({ level: Number(h.tagName.slice(1)), text: text(h).slice(0, 300) });
  }
  return out;
}

export interface Anchor { href: string; text: string; rel: string; internal: boolean; inNav: boolean }

function inChrome(el: HTMLElement): boolean {
  let p: HTMLElement | null = el.parentNode as HTMLElement | null;
  while (p && p.tagName) {
    const t = p.tagName.toLowerCase();
    if (t === "nav" || t === "header" || t === "footer" || p.getAttribute?.("role") === "navigation") return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

export function anchors(doc: ParsedDoc, base: string, host: string): Anchor[] {
  const out: Anchor[] = [];
  for (const a of doc.root.querySelectorAll("a")) {
    const href = absUrl(a.getAttribute("href"), base);
    if (!href) continue;
    let internal = false;
    try {
      const h = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
      internal = h === host.replace(/^www\./, "");
    } catch { /* noop */ }
    const imgAlt = a.querySelector("img")?.getAttribute("alt") ?? "";
    out.push({
      href,
      text: (text(a) || (imgAlt ? `[img] ${imgAlt}` : "")).slice(0, 200),
      rel: (a.getAttribute("rel") || "").toLowerCase(),
      internal,
      inNav: inChrome(a),
    });
  }
  return out;
}

export function images(doc: ParsedDoc, base: string): { src: string; alt: string | null; width: string | null; height: string | null; loading: string | null }[] {
  return doc.root.querySelectorAll("img").map((i) => ({
    src: absUrl(i.getAttribute("src") || i.getAttribute("data-src"), base) || "",
    alt: i.hasAttribute("alt") ? i.getAttribute("alt") ?? "" : null,
    width: i.getAttribute("width") ?? null,
    height: i.getAttribute("height") ?? null,
    loading: i.getAttribute("loading") ?? null,
  }));
}

/** 正文文本:去掉 nav/header/footer/aside/form/script/style,优先 <main>/<article> */
export function mainText(doc: ParsedDoc): { text: string; scope: "main" | "article" | "body" } {
  const clone = parseHtml(doc.root.toString(), { lowerCaseTagName: false, comment: false, blockTextElements: {}, parseNoneClosedTags: true } as Parameters<typeof parseHtml>[1]);
  for (const sel of ["nav", "header", "footer", "aside", "form", "noscript", "svg", "[role=navigation]"]) {
    for (const el of clone.querySelectorAll(sel)) el.remove();
  }
  const main = clone.querySelector("main");
  if (main && text(main).length > 200) return { text: text(main), scope: "main" };
  const article = clone.querySelector("article");
  if (article && text(article).length > 200) return { text: text(article), scope: "article" };
  return { text: text(clone.querySelector("body") ?? clone), scope: "body" };
}

export function fullText(doc: ParsedDoc): string {
  return text(doc.root.querySelector("body") ?? doc.root);
}

export function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9À-ɏ]+(?:['’-][a-z0-9À-ɏ]+)*/g) ?? []);
}

export function htmlLang(doc: ParsedDoc): string | null {
  return doc.root.querySelector("html")?.getAttribute("lang") ?? null;
}
