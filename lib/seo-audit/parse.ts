/* ============================================================
   SEO Audit · 页面解析 —— 一份 HTML → 一条 CrawledPage

   用 node-html-parser(已在依赖里)。解析选项里把 script/noscript/
   style/template 设成"块文本":它们的内容保留为一段原始文本、不再
   解析成子元素 —— 这样 <noscript> 里的备用 <img>、<template> 里的
   模板链接都不会混进图片/链接统计;算可见字数前再把它们整体移除。

   约定(下游 checks / view 请按此读):
     · og / twitter 的 key 是**完整**属性名:og["og:title"]、twitter["twitter:card"];
     · links 是去重后的站内绝对 URL(已去 #fragment 与追踪参数,不含自身);
     · internalLinks / externalLinks 是 <a> 的**出现次数**(不去重);
     · genericAnchors 只统计站内链接里锚文本为 click here / read more /
       here / learn more / more 的条数;
     · images.missingAlt 只算**没有 alt 属性**的 <img>(alt="" 是合法的装饰图);
     · mixedContent 只在页面是 https 时统计 http:// 的资源引用(<a> 不算);
     · wordCount 含导航/页脚(v1 口径不变);minhash / textSample 用的是
       **去掉 nav/header/footer/aside 之后的主体文本** —— 近重复检测要比的是
       正文,不是每页都一样的菜单。

   复审 C6(DOM 炸弹):node-html-parser 7.1 内部有几处平方级行为 —— 平铺兄弟节点间的
   文本节点插入、未闭合标签的收尾修复、querySelectorAll 的结果拼接、每个 script/style
   都把整份文档 toLowerCase 一次,以及未闭合 <!-- 的逐个回扫。2 MB 的恶意页面能把事件循环
   同步卡住几十秒,deadline 定时器在此期间根本触发不了。所以解析前先做一次**线性预扫描**
   (prepareMarkup):
     · 超过 MAX_DOM_ELEMENTS 个开标签就在那里截断,并记一条页面问题;
     · script/style/noscript/template 的内容由预扫描自己切出来(JSON-LD、脚本体积从这里取),
       交给解析器的只是空壳 —— 解析器不再为它们逐个整篇 toLowerCase;
     · 未闭合的 <!-- 处截断(浏览器也把它之后的内容当注释)。
   解析用 parseNoneClosedTags:未闭合元素保留原位(与浏览器一致),跳过那段平方级的收尾修复。
   嵌套过深压垮递归(RangeError)时只读前 1000 个元素重试一次。
   落库体积同样封顶:links / headings / hreflang / og / twitter / JSON-LD 类型都有条数上限,
   字符串按代理对安全地截断(半个 emoji 会让 jsonb 拒收整份结果)。

   复审 C23:robots 指令按逗号逐项整项匹配 —— max-image-preview:none 不是 noindex,
   X-Robots-Tag 里 "otherbot: noindex" 只对 otherbot 生效。
   ============================================================ */

import { parse as parseHtml, NodeType, TextNode, type HTMLElement, type Node as HtmlNode } from "node-html-parser";
import type { CrawledPage, Heading, PageType } from "./types";
import type { FetchResult } from "./fetch";
import { dedupeKey, isSameSite, normalizeUrl } from "./url";

export interface ParsedPageDetails {
  page: CrawledPage;
  /** 出现在 <nav>/<header>/<footer>/[role=navigation] 里的站内链接(归一后)—— 抓取优先级用 */
  navLinks: string[];
  /** 同站的 script[src] / stylesheet href(≤10,绝对 URL)—— robots 是否封 CSS/JS 用 */
  resourceUrls: string[];
  /** application/ld+json 块数(parity 探针比较用) */
  jsonLdBlocks: number;
  /** 找到了 SPA 挂载点且它几乎是空的 */
  emptyMountPoint: boolean;
}

const GENERIC_ANCHORS = new Set(["click here", "read more", "here", "learn more", "more"]);
const NAV_TAGS = new Set(["nav", "header", "footer"]);
const CHROME_TAGS = new Set(["nav", "header", "footer", "aside"]);
/** 不可见内容:预扫描已把前四种的内容剥掉,svg 里的 <title>/<text> 也不算页面文字 */
const INVISIBLE_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);
const MOUNT_SELECTORS = ["#root", "#app", "#__next", "#__nuxt", "#___gatsby", "#svelte", "#q-app", "#__layout", "[data-reactroot]"];
const MIXED_RESOURCE_SELECTORS = [
  "img[src]",
  "img[srcset]",
  "source[src]",
  "source[srcset]",
  "script[src]",
  "iframe[src]",
  "video[src]",
  "video[poster]",
  "audio[src]",
  "embed[src]",
  "object[data]",
  "track[src]",
  "link[href]",
];
const MIXED_LINK_RELS = new Set(["stylesheet", "icon", "preload", "modulepreload", "prefetch", "manifest"]);

export const MAX_IMAGE_URLS = 20;
export const MAX_OUTBOUND_LINKS = 30;
export const MAX_RESOURCE_URLS = 10;
export const TEXT_SAMPLE_CHARS = 400;
export const MINHASH_SIZE = 64;
export const SHINGLE_WORDS = 5;

/* ---- 复审 C6:解析规模与落库体积上限 ---- */
/**
 * 交给解析器的开标签上限。实测(本机)平铺 1 万个带文本的兄弟元素:parse + 选择器约 0.3–0.5 s;
 * 1.5 万个已到 1.2 s 以上(文本节点插入是平方级)。真实页面极少超过几千个元素
 * (Lighthouse 在 1,400 就报 "excessive DOM"),1 万之后的内容不读不会影响正常站点。
 */
export const MAX_DOM_ELEMENTS = 10_000;
/** 嵌套过深压垮递归(RangeError)时的重试上限:一千个元素撑不出能压垮递归的深度 */
export const FALLBACK_DOM_ELEMENTS = 1_000;
/** 落库的站内链接条数(去重后);uniqueInternalLinks / internalLinks 仍按全部链接计 */
export const MAX_LINKS = 500;
export const MAX_HEADINGS = 200;
export const MAX_H1S = 50;
export const MAX_HREFLANG = 100;
/** og / twitter 各自最多保留的键数 */
export const MAX_META_KEYS = 50;
export const MAX_JSONLD_TYPES = 100;
/** 超过这个长度的 URL 不落库(只计数) */
export const MAX_URL_CHARS = 2_048;
const MAX_TEXT_CHARS = 1_000;
const MAX_HEADING_CHARS = 200;
const MAX_META_KEY_CHARS = 100;
const MAX_META_VALUE_CHARS = 2_048;
const MAX_TYPE_CHARS = 100;
/** 泛化锚文本("click here" 之类)都很短:读到这么多字符还没完就一定不是 */
const MAX_ANCHOR_CHARS = 64;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const codePoints = (s: string) => Array.from(s).length;

/**
 * 截断字符串但不劈开 UTF-16 代理对。半个 emoji 序列化成 "\ud83d" 后 Postgres 的 jsonb
 * 会拒收整份结果(审计白跑),所以任何落库字符串的截断都走这里。
 */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = Math.max(0, max);
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return s.slice(0, end);
}

function attr(el: HTMLElement, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v === undefined ? undefined : v;
}

function tagOf(el: HTMLElement): string {
  return (el.rawTagName ?? "").toLowerCase();
}

function roleOf(p: HTMLElement): string {
  return (p.getAttribute("role") ?? "").toLowerCase();
}

function isChrome(el: HTMLElement, tags: Set<string>): boolean {
  const tag = tagOf(el);
  if (tags.has(tag)) return true;
  if (tag === "div" || tag === "ul" || tag === "section" || tag === "aside") {
    const role = roleOf(el);
    if (role === "navigation" || role === "banner" || role === "contentinfo") return true;
  }
  return false;
}

function hasAncestor(el: HTMLElement, tags: Set<string>): boolean {
  let p = el.parentNode as HTMLElement | null;
  while (p) {
    if (isChrome(p, tags)) return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

function isHttpUrl(v: string): boolean {
  return /^http:\/\//i.test(v.trim());
}

function srcsetHasHttp(v: string): boolean {
  return v.split(",").some((part) => isHttpUrl(part.trim().split(/\s+/)[0] ?? ""));
}

/** 递归收集 JSON-LD 里所有 @type(含 @graph、嵌套对象、数组)与最大的 dateModified */
function walkJsonLd(node: unknown, types: Set<string>, dates: number[], depth = 0): void {
  if (depth > 12 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, types, dates, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") types.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") types.add(x);
  const dm = obj.dateModified;
  if (typeof dm === "string") {
    const ts = Date.parse(dm);
    if (!Number.isNaN(ts)) dates.push(ts);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "@type" || k === "@context") continue;
    if (v && typeof v === "object") walkJsonLd(v, types, dates, depth + 1);
  }
}

function cleanJsonLd(raw: string): string {
  return raw
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, "")
    .replace(/\/\/\s*\]\]>\s*$/, "")
    .trim();
}

/**
 * 逐文本节点收集、用空格拼接。直接取 element.text 会把
 * <a>Home</a><a>Pricing</a> 这种没有空白的相邻内联元素粘成 "HomePricing",
 * 导航菜单里这太常见,字数会被系统性低估。
 * skip:遇到这些元素整棵子树不收(主体文本要去掉导航/页脚)。
 * 迭代而不是递归:几千层的嵌套不能把调用栈压爆(复审 C6)。
 */
function collectText(node: HtmlNode, out: string[], skip?: (el: HTMLElement) => boolean): void {
  const stack: HtmlNode[] = [];
  for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  while (stack.length) {
    const child = stack.pop() as HtmlNode;
    if (child.nodeType === NodeType.TEXT_NODE) out.push((child as TextNode).text);
    else if (child.nodeType === NodeType.ELEMENT_NODE) {
      if (skip && skip(child as HTMLElement)) continue;
      const kids = child.childNodes;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }
}

/**
 * element.text 的有上限版本(同口径:文本节点直接相连、<br> 记为换行),读够 max 个字符就停。
 * 标题、锚文本、段落只需要前几百个字符;嵌套的 <h1><span><h1>… 若每层都取完整 .text,
 * 底部一段大文本会被复制成"层数 × 文本长"(复审 C6)。返回值最多 max + 1 个字符,
 * 调用方据此判断"原文比上限长"。
 */
function boundedText(el: HtmlNode, max: number): string {
  let out = "";
  const stack: HtmlNode[] = [];
  for (let i = el.childNodes.length - 1; i >= 0; i--) stack.push(el.childNodes[i]);
  while (stack.length && out.length <= max) {
    const node = stack.pop() as HtmlNode;
    if (node.nodeType === NodeType.TEXT_NODE) {
      // 先截原文再解码:TextNode.text 每次都把整段原文 decode 一遍,超长文本节点不能每层都付一次
      const raw = (node as TextNode).rawText;
      const room = max + 1 - out.length + 32;
      out += raw.length > room ? new TextNode(raw.slice(0, room)).text : (node as TextNode).text;
    } else if (node.nodeType === NodeType.ELEMENT_NODE) {
      if (tagOf(node as HTMLElement) === "br") {
        out += "\n";
        continue;
      }
      const kids = node.childNodes;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }
  return out.length > max + 1 ? out.slice(0, max + 1) : out;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

function countWords(text: string): number {
  // CJK 一字一词;其余按字母数字串计
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = text.replace(CJK, " ");
  const tokens = rest.match(/[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return cjk + tokens;
}

function words(text: string): string[] {
  return (text.toLowerCase().replace(CJK, " $& ").match(/[\p{L}\p{N}]+/gu) ?? []) as string[];
}

function isHtmlLike(res: FetchResult, html: string): boolean {
  if (/html/.test(res.contentType)) return true;
  if (!res.contentType && /^\s*</.test(html)) return true;
  return false;
}

/* ---------- 预扫描(复审 C6) ---------- */

/** 解析器会当作原始文本处理的元素:内容由预扫描切出,不交给解析器 */
const RAW_TEXT_CLOSE = new Map<string, RegExp>(["script", "style", "noscript", "template"].map((t) => [t, new RegExp(`</${t}>`, "gi")]));

interface RawBlock {
  tag: string;
  /** 开标签原文(含 < 与 >) */
  openTag: string;
  content: string;
  /** 原文里从开标签到闭标签结尾的长度(没有闭标签就到文末)—— 脚本体积占比用 */
  outerLength: number;
}

export interface PreparedMarkup {
  /** 交给解析器的 HTML:原始文本元素只剩空壳,超限处已截断 */
  html: string;
  blocks: RawBlock[];
  /** 计入的开标签数 */
  elements: number;
  /** 开标签超过上限,在那里截断了 */
  truncated: boolean;
  /** 遇到没有 --> 的 <!--,在那里截断了 */
  unclosedComment: boolean;
}

const isTagStart = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = (c: number) => isTagStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46 || c === 58 || c === 95 || c === 64 || c > 127;
const isSpaceCode = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/**
 * 开标签的结尾 '>' 的下标。属性值以引号开头时跳到配对的引号(引号里的 '>' 不算);
 * 引号没闭合就退回到下一个 '>'。找不到返回 -1。每个字符最多看一次。
 */
function endOfTag(s: string, from: number): number {
  const n = s.length;
  let i = from;
  while (i < n) {
    const ch = s.charCodeAt(i);
    if (ch === 62) return i;
    if (ch === 61) {
      let k = i + 1;
      while (k < n && isSpaceCode(s.charCodeAt(k))) k++;
      const q = s.charCodeAt(k);
      if (q === 34 || q === 39) {
        const close = s.indexOf(q === 34 ? '"' : "'", k + 1);
        if (close < 0) return s.indexOf(">", k + 1);
        i = close + 1;
        continue;
      }
      i = k;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * 线性预扫描:数开标签、切出原始文本元素的内容、在超限处或未闭合注释处截断。
 * 只用 indexOf 与无回溯的小正则,每个字符最多被看常数次 —— 2 MB 也是毫秒级。
 */
export function prepareMarkup(html: string, maxElements: number = MAX_DOM_ELEMENTS): PreparedMarkup {
  const out: string[] = [];
  const blocks: RawBlock[] = [];
  const n = html.length;
  let elements = 0;
  let truncated = false;
  let unclosedComment = false;
  let copyFrom = 0;
  let cut = n;
  let pos = 0;
  while (pos < n) {
    const lt = html.indexOf("<", pos);
    if (lt < 0) break;
    const c = html.charCodeAt(lt + 1);
    // 注释:与解析器同语义,从 <!-- 之后找 -->;找不到 = 后面全是注释(浏览器也这样处理)
    if (c === 33 && html.charCodeAt(lt + 2) === 45 && html.charCodeAt(lt + 3) === 45) {
      const end = html.indexOf("-->", lt + 4);
      if (end < 0) {
        unclosedComment = true;
        cut = lt;
        break;
      }
      pos = end + 3;
      continue;
    }
    if (!isTagStart(c)) {
      pos = lt + 1;
      continue;
    }
    if (elements >= maxElements) {
      truncated = true;
      cut = lt;
      break;
    }
    elements++;
    let j = lt + 2;
    while (j < n && isNameChar(html.charCodeAt(j))) j++;
    const gt = endOfTag(html, j);
    if (gt < 0) break; // 开标签到文末都没写完:剩下的原样交给解析器
    const nameLen = j - lt - 1;
    const close = nameLen >= 5 && nameLen <= 8 ? RAW_TEXT_CLOSE.get(html.slice(lt + 1, j).toLowerCase()) : undefined;
    if (!close) {
      pos = gt + 1;
      continue;
    }
    // 原始文本元素:与解析器一样找第一个 </tag>(大小写不敏感);没有就一直到文末
    close.lastIndex = gt + 1;
    const m = close.exec(html);
    const contentEnd = m ? m.index : n;
    const blockEnd = m ? m.index + m[0].length : n;
    const tag = html.slice(lt + 1, j).toLowerCase();
    blocks.push({ tag, openTag: html.slice(lt, gt + 1), content: html.slice(gt + 1, contentEnd), outerLength: blockEnd - lt });
    out.push(html.slice(copyFrom, gt + 1), `</${tag}>`);
    copyFrom = blockEnd;
    pos = blockEnd;
  }
  if (cut > copyFrom) out.push(html.slice(copyFrom, cut));
  return { html: out.join(""), blocks, elements, truncated, unclosedComment };
}

const TYPE_ATTR = /[\s/]type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** <script> 开标签原文里的 type 属性(原始文本元素的内容不进 DOM,只能从预扫描的原文里读) */
function scriptType(openTag: string): string {
  const m = TYPE_ATTR.exec(openTag);
  if (!m) return "";
  return (m[1] ?? m[2] ?? m[3] ?? "").trim().toLowerCase();
}

/* ---------- robots 指令(复审 C23) ---------- */

/** 带取值的指令:值里的 none / noindex 不是指令本身 */
const VALUED_DIRECTIVE = /^(?:max-snippet|max-image-preview|max-video-preview|unavailable_after)\s*:/;

/**
 * 把一条 robots 指令串拆成生效的 token。按逗号逐项、整项匹配,带取值的指令整项跳过。
 * X-Robots-Tag 允许 "<ua>: 指令, 指令…" 的作用域前缀,作用域一直延续到下一个前缀;
 * 只有无前缀或 googlebot 的指令算数(meta name="robots|googlebot" 的内容没有前缀语法)。
 * 空格分隔的 "noindex nofollow" 也照收(老站常见的写法)。
 */
export function robotsDirectiveTokens(raw: string, isHeader: boolean): string[] {
  const out: string[] = [];
  let applies = true;
  for (let part of (raw ?? "").toLowerCase().split(",")) {
    part = part.trim();
    if (!part || VALUED_DIRECTIVE.test(part)) continue;
    if (isHeader) {
      const m = /^([a-z0-9_-]+)\s*:\s*(.*)$/.exec(part);
      if (m && m[1] !== "unavailable_after") {
        applies = m[1] === "googlebot";
        part = m[2].trim();
        if (!part || VALUED_DIRECTIVE.test(part)) continue;
      }
    }
    if (applies) for (const t of part.split(/\s+/)) if (t) out.push(t);
  }
  return out;
}

/** 一条指令串的 noindex / nofollow("none" = 两者都有,Google 文档) */
export function robotsDirectiveFlags(raw: string, isHeader: boolean): { noindex: boolean; nofollow: boolean } {
  const t = new Set(robotsDirectiveTokens(raw, isHeader));
  return { noindex: t.has("noindex") || t.has("none"), nofollow: t.has("nofollow") || t.has("none") };
}

/* ---------- minhash ---------- */

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64 个确定性的种子(LCG),每个种子对应一个"哈希函数" */
const SEEDS: number[] = (() => {
  const out: number[] = [];
  let x = 0x9e3779b9;
  for (let i = 0; i < MINHASH_SIZE; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out.push(x);
  }
  return out;
})();

function mix(h: number, seed: number): number {
  let x = (h ^ seed) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * 文本的 minhash 签名:k 词 shingle 的集合在 n 个哈希函数下各自的最小值。
 * 两个签名相同槽位的占比 ≈ shingle 集合的 Jaccard。词数不足一个 shingle → undefined。
 */
export function minhashSignature(text: string, k: number = SHINGLE_WORDS, n: number = MINHASH_SIZE): number[] | undefined {
  const w = words(text);
  if (w.length < k) return undefined;
  const sig = new Array<number>(n).fill(0xffffffff);
  const seen = new Set<number>();
  for (let i = 0; i + k <= w.length; i++) {
    const h = fnv1a(w.slice(i, i + k).join(" "));
    if (seen.has(h)) continue;
    seen.add(h);
    for (let j = 0; j < n; j++) {
      const v = mix(h, SEEDS[j]);
      if (v < sig[j]) sig[j] = v;
    }
  }
  return sig;
}

/* ---------- 页面类型 ---------- */

const DATE_TEXT = /\b(?:\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4})\b/i;

/**
 * 页面类型启发式(薄内容只对 article 生效、Product schema 只对 product 生效)。
 * datedParagraphs:含日期的 <p>/<time> 数 —— 没有 /blog/ 路径的文章靠它识别。
 */
export function pageTypeFor(url: string, jsonLdTypes: string[], datedParagraphs = 0): PageType {
  let path = "/";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = "/";
  }
  const segs = path.split("/").filter(Boolean);
  const types = jsonLdTypes.map((t) => t.toLowerCase());
  const has = (re: RegExp) => segs.some((s) => re.test(s));
  const indexOf = (re: RegExp) => segs.findIndex((s) => re.test(s));

  if (!segs.length || path === "/index.html" || path === "/index.php" || path === "/home") return "home";
  if (has(/^(pricing|plans|prices|price)$/)) return "pricing";
  if (has(/^(privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|tos|legal|cookie|cookies|cookie-policy|imprint|impressum|disclaimer|gdpr|refund|refund-policy)$/)) return "legal";
  if (has(/^(contact|contact-us|about|about-us)$/)) return "contact";
  if (types.some((t) => t === "product" || t === "productgroup" || t === "individualproduct" || t === "productmodel")) return "product";
  const prodIdx = indexOf(/^(product|products|shop|store|item|items)$/);
  if (prodIdx >= 0 && segs.length > prodIdx + 1) return "product";
  if (types.some((t) => /^(article|blogposting|newsarticle|techarticle|scholarlyarticle|report|liveblogposting)$/.test(t))) return "article";
  const artIdx = indexOf(/^(blog|news|article|articles|post|posts|guide|guides|docs|documentation|insights|resources|learn|stories|journal|tutorials?)$/);
  if (artIdx >= 0 && segs.length > artIdx + 1 && !/^(page|category|tag|tags|topics|author|authors)$/.test(segs[artIdx + 1])) return "article";
  if (datedParagraphs >= 2) return "article";
  if (has(/^(category|categories|tag|tags|search|listing|listings|archive|archives|topics|collections?)$/) || artIdx >= 0 || prodIdx >= 0 || /^page$/.test(segs[segs.length - 2] ?? "")) return "listing";
  return "other";
}

/* ---------- 主解析 ---------- */

type Directive = { value: string; header: boolean };

/**
 * 解析页面。返回 CrawledPage 与导航链接等细节。
 * html 可以是空串(非 HTML 响应、抓取失败)—— 那时只填状态相关字段与 issues。
 * 永不因页面形状抛错:嵌套深到压垮递归时先只读前 FALLBACK_DOM_ELEMENTS 个元素重试,
 * 再不行就只交状态字段(复审 C6:一个恶意页面不能让整轮抓取失败)。
 */
export function parsePageDetailed(html: string, res: FetchResult, depth: number, host: string): ParsedPageDetails {
  try {
    return parseWithCap(html, res, depth, host, "full");
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
  }
  try {
    return parseWithCap(html, res, depth, host, "shallow");
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
  }
  return parseWithCap(html, res, depth, host, "status-only");
}

/** full:正常解析;shallow:嵌套过深后的重试,只读前 FALLBACK_DOM_ELEMENTS 个元素;status-only:只交状态字段 */
type ParseMode = "full" | "shallow" | "status-only";

function parseWithCap(html: string, res: FetchResult, depth: number, host: string, mode: ParseMode): ParsedPageDetails {
  const base = res.finalUrl || res.url;
  const pageIsHttps = base.startsWith("https://");
  const selfKey = dedupeKey(base);
  const headers = res.headers && typeof res.headers.get === "function" ? res.headers : null;
  const xRobotsTag = headers?.get("x-robots-tag") ?? null;

  const issues: string[] = [];
  const page: CrawledPage = {
    url: res.url,
    finalUrl: base,
    status: res.status,
    redirects: res.chain?.length ?? 0,
    contentType: res.contentType,
    bytes: res.bytes,
    fetchedMs: res.ms,
    depth,
    title: "",
    description: "",
    h1s: [],
    headings: [],
    wordCount: 0,
    textToHtml: 0,
    canonical: null,
    robotsMeta: null,
    xRobotsTag: xRobotsTag === null ? null : clipText(xRobotsTag, MAX_TEXT_CHARS),
    lang: null,
    viewport: null,
    images: { total: 0, missingAlt: 0 },
    internalLinks: 0,
    externalLinks: 0,
    links: [],
    genericAnchors: 0,
    jsonLdTypes: [],
    jsonLdErrors: 0,
    og: {},
    twitter: {},
    hreflang: [],
    mixedContent: 0,
    hasBreadcrumbSchema: false,
    hasFavicon: false,
    issues,
    ttfbMs: typeof res.ttfbMs === "number" ? res.ttfbMs : null,
    lastModified: null,
  };
  const empty: ParsedPageDetails = { page, navLinks: [], resourceUrls: [], jsonLdBlocks: 0, emptyMountPoint: false };

  if (res.error && !res.status) {
    issues.push(`Fetch failed: ${res.error}`);
    return empty;
  }
  if (res.status >= 400) issues.push(`HTTP ${res.status}`);
  else if (res.status >= 300) issues.push(`Redirect chain not resolved (HTTP ${res.status})`);
  if (page.redirects > 0) issues.push(`Reached via ${page.redirects} redirect${page.redirects > 1 ? "s" : ""}`);

  /* ---- Last-Modified 头(JSON-LD dateModified 在后面取最大值) ---- */
  const dates: number[] = [];
  const lm = headers?.get("last-modified");
  if (lm) {
    const ts = Date.parse(lm);
    if (!Number.isNaN(ts)) dates.push(ts);
  }

  /* ---- X-Robots-Tag 指令(用完整原文判定,落库的是截断后的) ---- */
  const directives: Directive[] = [];
  if (xRobotsTag) directives.push({ value: xRobotsTag, header: true });

  const html_ = html ?? "";
  const htmlLike = isHtmlLike(res, html_);
  if (mode === "status-only" && html_.trim()) {
    issues.push("Markup is nested too deeply to analyse");
    finishDirectives(page, directives, dates);
    return empty;
  }
  if (!html_.trim()) {
    if (res.status >= 200 && res.status < 300) issues.push(`Not an HTML page (${res.contentType || "unknown content-type"})`);
    finishDirectives(page, directives, dates);
    return empty;
  }
  if (!htmlLike && res.status >= 200 && res.status < 300) {
    issues.push(`Not an HTML page (${res.contentType || "unknown content-type"})`);
  }

  /* ---- 预扫描:截断超大 DOM、切出原始文本元素(复审 C6) ---- */
  const prepared = prepareMarkup(html_, mode === "shallow" ? FALLBACK_DOM_ELEMENTS : MAX_DOM_ELEMENTS);
  if (mode === "shallow") issues.push(`Markup is nested too deeply to analyse in full; only the first ${FALLBACK_DOM_ELEMENTS.toLocaleString("en-US")} elements were read`);
  else if (prepared.truncated) issues.push(`Unusually large DOM (>${MAX_DOM_ELEMENTS.toLocaleString("en-US")} elements); analysis truncated`);
  if (prepared.unclosedComment) issues.push("Unclosed HTML comment (<!--): browsers treat everything after it as a comment");

  const root = parseHtml(prepared.html, {
    lowerCaseTagName: true,
    comment: false,
    // 原始文本元素的内容已经被预扫描切走,解析器不必再找它们的闭标签
    blockTextElements: {},
    // 未闭合元素保留原位(与浏览器一致),也跳过库里那段平方级的收尾修复
    parseNoneClosedTags: true,
  });

  /* ---- <html lang> ---- */
  const langAttr = collapse(root.querySelector("html")?.getAttribute("lang") ?? "");
  page.lang = langAttr ? clipText(langAttr, 100) : null;

  /* ---- <title> ---- */
  const titleEl =
    root.querySelector("head title") ??
    root.querySelectorAll("title").find((t) => !hasAncestor(t, new Set(["svg"]))) ??
    null;
  page.title = clipText(collapse(titleEl ? boundedText(titleEl, MAX_TEXT_CHARS * 4) : ""), MAX_TEXT_CHARS);

  /* ---- <meta> ---- */
  let metaRefresh = false;
  let ogKeys = 0;
  let twitterKeys = 0;
  let noindexMeta: string | null = null;
  for (const m of root.querySelectorAll("meta")) {
    const name = (attr(m, "name") ?? "").trim().toLowerCase();
    const property = (attr(m, "property") ?? "").trim().toLowerCase();
    const httpEquiv = (attr(m, "http-equiv") ?? "").trim().toLowerCase();
    const rawContent = attr(m, "content") ?? "";
    const content = collapse(rawContent.length > MAX_META_VALUE_CHARS * 4 ? rawContent.slice(0, MAX_META_VALUE_CHARS * 4) : rawContent);
    if (httpEquiv === "refresh" && /url\s*=/i.test(content)) metaRefresh = true;
    const key = clipText(property || name, MAX_META_KEY_CHARS);
    if (!key) continue;
    if (key.startsWith("og:")) {
      if (!(key in page.og) && ogKeys < MAX_META_KEYS) {
        page.og[key] = clipText(content, MAX_META_VALUE_CHARS);
        ogKeys++;
      }
      continue;
    }
    if (key.startsWith("twitter:")) {
      if (!(key in page.twitter) && twitterKeys < MAX_META_KEYS) {
        page.twitter[key] = clipText(content, MAX_META_VALUE_CHARS);
        twitterKeys++;
      }
      continue;
    }
    if (name === "description" && !page.description) page.description = clipText(content, MAX_TEXT_CHARS);
    else if (name === "robots" || name === "googlebot") {
      if (page.robotsMeta === null) page.robotsMeta = clipText(content, MAX_TEXT_CHARS);
      directives.push({ value: content, header: false });
      if (noindexMeta === null && robotsDirectiveFlags(content, false).noindex) noindexMeta = clipText(content, MAX_TEXT_CHARS);
    } else if (name === "viewport" && page.viewport === null) page.viewport = clipText(content, MAX_TEXT_CHARS);
  }
  page.metaRefresh = metaRefresh;

  /* ---- <link> ---- */
  let canonicalCount = 0;
  const resourceUrls: string[] = [];
  const resourceSeen = new Set<string>();
  const addResource = (raw: string | undefined) => {
    if (!raw || resourceUrls.length >= MAX_RESOURCE_URLS) return;
    const abs = normalizeUrl(raw, base);
    if (!abs || abs.length > MAX_URL_CHARS || !isSameSite(abs, host) || resourceSeen.has(abs)) return;
    resourceSeen.add(abs);
    resourceUrls.push(abs);
  };
  for (const l of root.querySelectorAll("link")) {
    const rels = (attr(l, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const href = (attr(l, "href") ?? "").trim();
    if (rels.includes("canonical") && href) {
      canonicalCount++;
      if (page.canonical === null) {
        try {
          const c = new URL(href, base);
          c.hash = "";
          page.canonical = c.href.length > MAX_URL_CHARS ? clipText(c.href, MAX_URL_CHARS) : c.href;
        } catch {
          issues.push(`Canonical href is not a valid URL: ${clipText(href, 200)}`);
        }
      }
    }
    if (rels.includes("stylesheet")) addResource(href);
    if (rels.some((r) => r === "icon" || r === "apple-touch-icon" || r === "apple-touch-icon-precomposed")) page.hasFavicon = true;
    if (rels.includes("alternate") && page.hreflang.length < MAX_HREFLANG) {
      const lang = (attr(l, "hreflang") ?? "").trim();
      if (lang && href && href.length <= MAX_URL_CHARS) {
        let abs = href;
        try {
          abs = new URL(href, base).href;
        } catch {
          abs = href;
        }
        if (abs.length <= MAX_URL_CHARS) page.hreflang.push({ lang: clipText(lang, 35), href: abs });
      }
    }
  }
  if (canonicalCount > 1) issues.push(`${canonicalCount} canonical tags (should be exactly one)`);

  /* ---- headings(跳级与 H1 个数按全部标题算,落库的列表封顶) ---- */
  const headings: Heading[] = [];
  let h1Count = 0;
  let prevLevel = 0;
  let skipped = false;
  for (const h of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const level = Number(tagOf(h).slice(1));
    if (prevLevel && level > prevLevel + 1) skipped = true;
    prevLevel = level;
    if (level === 1) h1Count++;
    const keepHeading = headings.length < MAX_HEADINGS;
    const keepH1 = level === 1 && page.h1s.length < MAX_H1S;
    if (!keepHeading && !keepH1) continue;
    const text = clipText(collapse(boundedText(h, MAX_HEADING_CHARS * 4)), MAX_HEADING_CHARS);
    if (keepHeading) headings.push({ level, text });
    if (keepH1) page.h1s.push(text);
  }
  page.headings = headings;

  /* ---- images ---- */
  let missingDims = 0;
  const imageUrls: string[] = [];
  const imageSeen = new Set<string>();
  for (const img of root.querySelectorAll("img")) {
    page.images.total++;
    if (attr(img, "alt") === undefined) page.images.missingAlt++;
    if (!attr(img, "width") || !attr(img, "height")) missingDims++;
    const src = (attr(img, "src") ?? "").trim();
    if (src && !/^data:/i.test(src) && imageUrls.length < MAX_IMAGE_URLS) {
      const abs = normalizeUrl(src, base);
      if (abs && abs.length <= MAX_URL_CHARS && !imageSeen.has(abs)) {
        imageSeen.add(abs);
        imageUrls.push(abs);
      }
    }
  }
  page.imagesMissingDims = missingDims;
  page.imageUrls = imageUrls;

  /* ---- scripts(资源 URL 读 DOM 空壳的属性;体积与 JSON-LD 读预扫描切出的原文) ---- */
  for (const s of root.querySelectorAll("script")) {
    const src = (attr(s, "src") ?? "").trim();
    if (src) addResource(src);
  }
  let scriptBytes = 0;
  for (const b of prepared.blocks) if (b.tag === "script") scriptBytes += b.outerLength;
  page.scriptShare = html_.length ? Number(Math.min(1, scriptBytes / html_.length).toFixed(3)) : 0;

  /* ---- links ---- */
  const seenLinks = new Set<string>();
  const navLinks: string[] = [];
  const navSeen = new Set<string>();
  const outbound: string[] = [];
  const outboundSeen = new Set<string>();
  let nofollowInternal = 0;
  for (const a of root.querySelectorAll("a[href]")) {
    const href = (attr(a, "href") ?? "").trim();
    if (!href || href.startsWith("#")) continue;
    const abs = normalizeUrl(href, base);
    if (!abs) continue; // mailto:/tel:/javascript: 等
    if (!isSameSite(abs, host)) {
      page.externalLinks++;
      if (outbound.length < MAX_OUTBOUND_LINKS && abs.length <= MAX_URL_CHARS && !outboundSeen.has(abs)) {
        outboundSeen.add(abs);
        outbound.push(abs);
      }
      continue;
    }
    page.internalLinks++;
    const rel = (attr(a, "rel") ?? "").toLowerCase();
    if (/\bnofollow\b/.test(rel)) nofollowInternal++;
    const rawAnchor = boundedText(a, MAX_ANCHOR_CHARS);
    if (rawAnchor.length <= MAX_ANCHOR_CHARS) {
      const anchorText = collapse(rawAnchor)
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (GENERIC_ANCHORS.has(anchorText)) page.genericAnchors++;
    }

    const key = dedupeKey(abs);
    if (key === selfKey) continue;
    if (!seenLinks.has(key)) {
      seenLinks.add(key);
      // 落库只留前 MAX_LINKS 条(抓取队列与内链分析用不到更多);uniqueInternalLinks 仍是全量
      if (page.links.length < MAX_LINKS && abs.length <= MAX_URL_CHARS) page.links.push(abs);
    }
    if (!navSeen.has(key) && hasAncestor(a, NAV_TAGS)) {
      navSeen.add(key);
      if (navLinks.length < MAX_LINKS && abs.length <= MAX_URL_CHARS) navLinks.push(abs);
    }
  }
  page.nofollowInternal = nofollowInternal;
  page.uniqueInternalLinks = seenLinks.size;
  page.navLinks = navSeen.size;
  page.outboundLinks = outbound;

  /* ---- JSON-LD(读预扫描切出的 <script> 原文) ---- */
  const types = new Set<string>();
  let jsonLdBlocks = 0;
  for (const b of prepared.blocks) {
    if (b.tag !== "script") continue;
    if (!scriptType(b.openTag).startsWith("application/ld+json")) continue;
    jsonLdBlocks++;
    const raw = cleanJsonLd(b.content);
    if (!raw) {
      page.jsonLdErrors++;
      continue;
    }
    try {
      walkJsonLd(JSON.parse(raw), types, dates);
    } catch {
      page.jsonLdErrors++;
    }
  }
  page.jsonLdTypes = Array.from(types)
    .slice(0, MAX_JSONLD_TYPES)
    .map((t) => clipText(t, MAX_TYPE_CHARS));
  page.hasBreadcrumbSchema =
    types.has("BreadcrumbList") ||
    root.querySelector('[itemtype*="BreadcrumbList"]') !== null ||
    root.querySelector('[typeof*="BreadcrumbList"]') !== null;

  /* ---- mixed content ---- */
  if (pageIsHttps) {
    for (const sel of MIXED_RESOURCE_SELECTORS) {
      for (const el of root.querySelectorAll(sel)) {
        const tag = tagOf(el);
        if (tag === "link") {
          const rels = (attr(el, "rel") ?? "").toLowerCase().split(/\s+/);
          if (!rels.some((r) => MIXED_LINK_RELS.has(r))) continue;
          if (isHttpUrl(attr(el, "href") ?? "")) page.mixedContent++;
          continue;
        }
        const srcset = attr(el, "srcset");
        if (sel.endsWith("[srcset]")) {
          if (srcset && srcsetHasHttp(srcset)) page.mixedContent++;
          continue;
        }
        const value = attr(el, tag === "object" ? "data" : sel.endsWith("[poster]") ? "poster" : "src") ?? "";
        if (isHttpUrl(value)) page.mixedContent++;
      }
    }
  }

  /* ---- 含日期的段落(文章识别):段落文字只读前 400 字符,超过就肯定不是"短日期行" ---- */
  let datedParagraphs = 0;
  for (const el of root.querySelectorAll("p, time")) {
    const tag = tagOf(el);
    const raw = boundedText(el, 400);
    const text = collapse(raw);
    const long = raw.length > 400;
    if (tag === "time" ? !!attr(el, "datetime") || DATE_TEXT.test(text) : !long && text.length < 200 && DATE_TEXT.test(text)) datedParagraphs++;
    if (datedParagraphs >= 3) break;
  }

  /* ---- visible text(script/style/noscript/template/svg 整棵跳过,不再逐个 remove —— remove 也是平方级) ---- */
  const invisible = (el: HTMLElement) => INVISIBLE_TAGS.has(tagOf(el));
  const textRoot = root.querySelector("body") ?? root;

  // SPA 挂载点:存在且几乎没有文本 → JS 壳信号
  let emptyMountPoint = false;
  for (const sel of MOUNT_SELECTORS) {
    const mount = root.querySelector(sel);
    if (!mount) continue;
    const parts: string[] = [];
    collectText(mount, parts, invisible);
    if (collapse(parts.join(" ")).length < 50) emptyMountPoint = true;
    break;
  }

  const allParts: string[] = [];
  collectText(textRoot, allParts, invisible);
  const visible = collapse(allParts.join(" "));
  page.wordCount = countWords(visible);
  page.textToHtml = html_.length ? Number((visible.length / html_.length).toFixed(3)) : 0;

  const mainParts: string[] = [];
  collectText(textRoot, mainParts, (el) => invisible(el) || isChrome(el, CHROME_TAGS));
  const mainText = collapse(mainParts.join(" "));
  page.textSample = clipText(mainText, TEXT_SAMPLE_CHARS);
  const sig = minhashSignature(mainText);
  if (sig) page.minhash = sig;

  /* ---- JS 壳 / 页面类型 / 指令 ---- */
  const sameSiteLinks = seenLinks.size;
  page.jsShell = (page.wordCount < 100 && sameSiteLinks < 3 && emptyMountPoint) || ((page.scriptShare ?? 0) > 0.6 && page.wordCount < 80);
  page.pageType = pageTypeFor(base, page.jsonLdTypes, datedParagraphs);
  finishDirectives(page, directives, dates);

  /* ---- per-page issues ---- */
  if (htmlLike && res.status >= 200 && res.status < 300) {
    const titleLen = codePoints(page.title);
    if (!page.title) issues.push("Missing <title>");
    else if (titleLen < 30) issues.push(`Title too short (${titleLen} chars)`);
    else if (titleLen > 60) issues.push(`Title too long (${titleLen} chars)`);

    const descLen = codePoints(page.description);
    if (!page.description) issues.push("Missing meta description");
    else if (descLen < 70) issues.push(`Meta description too short (${descLen} chars)`);
    else if (descLen > 160) issues.push(`Meta description too long (${descLen} chars)`);

    if (h1Count === 0) issues.push("No H1");
    else if (h1Count > 1) issues.push(`${h1Count} H1 tags (should be one)`);
    if (skipped) issues.push("Heading levels skipped (e.g. H1 → H3)");

    if (page.images.missingAlt > 0) issues.push(`${page.images.missingAlt} of ${page.images.total} images missing alt`);
    if (page.wordCount < 300) issues.push(`Thin content (${page.wordCount} words)`);
    if (page.canonical === null) issues.push("Missing canonical");
    // 只有真正生效的 noindex 才算(max-image-preview:none、otherbot: noindex 都不是)
    if (noindexMeta !== null) issues.push(`Meta robots: ${noindexMeta}`);
    if (xRobotsTag && robotsDirectiveFlags(xRobotsTag, true).noindex) issues.push(`X-Robots-Tag: ${page.xRobotsTag}`);
    if (depth === 0 && page.viewport === null) issues.push("Missing viewport meta");
    if (depth === 0 && page.lang === null) issues.push("Missing <html lang>");
    if (page.mixedContent > 0) issues.push(`${page.mixedContent} mixed-content resource${page.mixedContent > 1 ? "s" : ""} (http:// on an https page)`);
    if (page.jsonLdErrors > 0) issues.push(`${page.jsonLdErrors} JSON-LD block${page.jsonLdErrors > 1 ? "s" : ""} failed to parse`);
    if (page.internalLinks < 3) issues.push(`Only ${page.internalLinks} internal link${page.internalLinks === 1 ? "" : "s"}`);
    if (metaRefresh) issues.push("Uses <meta http-equiv=\"refresh\"> redirect");
    if (page.jsShell) issues.push("Raw HTML is a JavaScript shell (content rendered client-side)");
  }

  return { page, navLinks, resourceUrls, jsonLdBlocks, emptyMountPoint };
}

/** 汇总 robots 指令(meta robots / googlebot / X-Robots-Tag)与修改日期 —— 逐项整项匹配(复审 C23) */
function finishDirectives(page: CrawledPage, directives: Directive[], dates: number[]): void {
  let noindex = false;
  let nofollow = false;
  for (const d of directives) {
    const f = robotsDirectiveFlags(d.value, d.header);
    noindex ||= f.noindex;
    nofollow ||= f.nofollow;
  }
  page.robotsNoindex = noindex;
  page.robotsNofollow = nofollow;
  // 不用 Math.max(...dates):JSON-LD 里几十万个 dateModified 会把参数展开压爆
  let newest = -Infinity;
  for (const d of dates) if (d > newest) newest = d;
  page.lastModified = Number.isFinite(newest) ? new Date(newest).toISOString() : null;
}

/** 契约签名:只要 CrawledPage */
export function parsePage(html: string, res: FetchResult, depth: number, host: string): CrawledPage {
  return parsePageDetailed(html, res, depth, host).page;
}
