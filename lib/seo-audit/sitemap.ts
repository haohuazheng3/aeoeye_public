/* ============================================================
   SEO Audit · sitemap 发现与解析

   不引 XML 解析库:sitemap 协议只用到 <urlset>/<sitemapindex>/<url>/
   <sitemap>/<loc>/<lastmod> 这几个标签,正则足够,还省一个依赖。

   V2 上限(把最坏情况的时间和内存钉死 —— 大站的 sitemap index 可能
   挂着 500 个子文件):
     · 候选 ≤6(robots 声明 + /sitemap.xml + /sitemap_index.xml);
     · 只递归**第一个**索引文件,取它的前 5 个子文件;
     · 每个文件最多读 5 MB(fetch 层截断),.xml.gz 解压也封顶 5 MB;
     · 每个文件只保留前 2000 条 <loc>(urlCount / lastmodShare 仍按
       文件里**全部**条目统计,只是不把 URL 都留在内存里)。

   模块级缓存:discoverSitemaps 把每个 urlset 的 loc 列表存进 Map,
   sampleSitemapUrls / cachedSitemapLocs 从里面取给"孤页信号"抽样和
   分层抓取用 —— 同一次 serverless 调用内一定命中;跨实例不保证,
   但抽样本来就是尽力而为。

   复审 C7:"开标签 + 惰性 [\s\S]*? + 闭标签"的正则在没有闭标签的输入上,
   每个起点都要扫到文件尾才失败 —— 整体平方级,5 MB 的恶意 sitemap 能同步卡住
   函数几百秒(共享 deadline 的定时器在此期间根本触发不了)。所以 <url> / <sitemap> /
   <loc> / <lastmod> 全部改用线性扫描器 blocks():找不到闭标签就**整体停止**,
   不再从下一个起点重扫。
   ============================================================ */

import { gunzipSync } from "node:zlib";
import { safeFetch, type FetchResult } from "./fetch";
import { isSameSite, normalizeUrl } from "./url";
import type { SitemapInfo } from "./types";

export const MAX_SITEMAP_LOCS = 2000;
export const MAX_SITEMAP_CANDIDATES = 6;
export const MAX_SITEMAP_CHILDREN = 5;
export const MAX_SITEMAP_INDEXES = 1;
export const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
/** 索引文件里子 sitemap URL 保留多少条进 SitemapInfo.children(只是展示,别把 JSON 撑爆) */
const MAX_CHILDREN_LISTED = 100;
const CACHE_MAX = 64;
export const SITEMAP_ACCEPT = "application/xml,text/xml;q=0.9,*/*;q=0.8";

const locCache = new Map<string, string[]>();

export type SitemapFetcher = (url: string) => Promise<FetchResult>;

const defaultFetcher: SitemapFetcher = (url) => safeFetch(url, { accept: SITEMAP_ACCEPT, raw: true, maxBytes: MAX_SITEMAP_BYTES, timeoutMs: 15_000 });

/* ---------- 纯解析(可单测) ---------- */

export interface ParsedSitemap {
  valid: boolean;
  isIndex: boolean;
  /** urlset 的页面 URL,或 index 的子 sitemap URL(都已截到 MAX_SITEMAP_LOCS) */
  locs: string[];
  /** 文件里的全部条目数(可能大于 locs.length) */
  urlCount: number;
  lastmodShare: number;
  newestLastmod: string | null;
  error?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** 合法的 Unicode 码点才解;&#x110000; 这类非法值原样保留(String.fromCodePoint 会抛 RangeError,
 *  一个手误的实体不能让 parseSitemapXml —— 进而整个探针 —— 失败) */
function codePoint(n: number, m: string): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,8}|#\d{1,10}|[a-z]{1,10});/gi, (m, ent: string) => {
    const e = ent.toLowerCase();
    if (e.startsWith("#x")) return codePoint(parseInt(e.slice(2), 16), m);
    if (e.startsWith("#")) return codePoint(parseInt(e.slice(1), 10), m);
    return ENTITIES[e] ?? m;
  });
}

const OPEN_TAG_RE = new Map<string, RegExp>();
const CLOSE_TAG_RE = new Map<string, RegExp>();

function tagRegexes(tag: string): [RegExp, RegExp] {
  let open = OPEN_TAG_RE.get(tag);
  let close = CLOSE_TAG_RE.get(tag);
  if (!open || !close) {
    // (?=[\s>/]):<url 不能误配 <urlset>;两条正则都没有无界的惰性量词,不会回溯
    open = new RegExp(`<${tag}(?=[\\s>/])`, "gi");
    close = new RegExp(`<\\/${tag}\\s*>`, "gi");
    OPEN_TAG_RE.set(tag, open);
    CLOSE_TAG_RE.set(tag, close);
  }
  return [open, close];
}

/**
 * 线性扫描 <tag …>内容</tag> 块,逐个产出"内容"。每个字符最多被开标签正则、'>' 的 indexOf、
 * 闭标签正则各看一遍 —— 整体 O(n)。开标签没有 '>'、或找不到闭标签,就**整体停止**:
 * 剩下的文本里不可能再有完整的块,逐个起点重扫正是旧实现平方级的来源。
 */
export function* xmlBlocks(text: string, tag: string, max: number = Infinity): Generator<string> {
  const [open, close] = tagRegexes(tag);
  let pos = 0;
  let yielded = 0;
  while (yielded < max) {
    // 共享的全局正则:每次 exec 前都重设 lastIndex,所以多个扫描器交替使用也互不干扰
    open.lastIndex = pos;
    const o = open.exec(text);
    if (!o) return;
    const gt = text.indexOf(">", o.index + o[0].length);
    if (gt === -1) return;
    // <tag … /> 自闭合:没有内容,跳过(与旧正则一致,不算一个条目)
    if (text.charCodeAt(gt - 1) === 47 /* / */) {
      pos = gt + 1;
      continue;
    }
    close.lastIndex = gt + 1;
    const c = close.exec(text);
    if (!c) return;
    yielded++;
    yield text.slice(gt + 1, c.index);
    pos = c.index + c[0].length;
  }
}

function firstBlock(text: string, tag: string): string | null {
  const it = xmlBlocks(text, tag, 1).next();
  return it.done ? null : it.value;
}

/** 取块内容:剥 CDATA、解实体、去首尾空白 */
function cleanValue(raw: string): string {
  const v = raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
  return decodeXmlEntities(v);
}

function inner(block: string, tag: "loc" | "lastmod"): string | null {
  const raw = firstBlock(block, tag);
  return raw === null ? null : cleanValue(raw);
}

function invalid(error: string): ParsedSitemap {
  return { valid: false, isIndex: false, locs: [], urlCount: 0, lastmodShare: 0, newestLastmod: null, error };
}

/**
 * 解析一份 sitemap 文本(urlset / sitemapindex / 纯文本 URL 列表)。
 * 不联网,不抛。
 */
export function parseSitemapXml(text: string): ParsedSitemap {
  const t = (text ?? "").replace(/^﻿/, "").trim();
  if (!t) return invalid("Empty response");

  const head = t.slice(0, 1024).toLowerCase();
  if (/<!doctype\s+html|<html[\s>]/.test(head)) return invalid("Returned an HTML page instead of XML");

  const isIndex = /<sitemapindex[\s>]/i.test(t);
  const isUrlset = /<urlset[\s>]/i.test(t);

  // 纯文本 sitemap:每行一个 URL(协议允许,极少见但要认)
  if (!isIndex && !isUrlset && !t.startsWith("<")) {
    let count = 0;
    const lines: string[] = [];
    for (const raw of t.split(/\r?\n/)) {
      const l = raw.trim();
      if (!/^https?:\/\//i.test(l)) continue;
      count++;
      if (lines.length < MAX_SITEMAP_LOCS) lines.push(l);
    }
    if (!count) return invalid("Not a sitemap (no <urlset>, <sitemapindex> or URL list)");
    return { valid: true, isIndex: false, locs: lines, urlCount: count, lastmodShare: 0, newestLastmod: null };
  }
  if (!isIndex && !isUrlset) return invalid("Not a sitemap (missing <urlset> or <sitemapindex>)");

  const entryTag = isIndex ? "sitemap" : "url";
  const locs: string[] = [];
  let total = 0;
  let withLastmod = 0;
  let newest = -Infinity;

  const addLoc = (loc: string | null, lastmod: string | null) => {
    if (!loc) return;
    total++;
    if (locs.length < MAX_SITEMAP_LOCS) locs.push(loc);
    if (lastmod) {
      withLastmod++;
      const ts = Date.parse(lastmod);
      if (!Number.isNaN(ts) && ts > newest) newest = ts;
    }
  };

  let sawEntry = false;
  for (const block of xmlBlocks(t, entryTag)) {
    sawEntry = true;
    addLoc(inner(block, "loc"), inner(block, "lastmod"));
  }
  // 有 <loc> 却没有 <url> 包裹的畸形文件:退一步直接收 <loc>
  if (!sawEntry) {
    for (const raw of xmlBlocks(t, "loc")) addLoc(cleanValue(raw), null);
  }

  if (!total) return { ...invalid(isIndex ? "Sitemap index lists no sitemaps" : "Sitemap lists no URLs"), isIndex };
  return {
    valid: true,
    isIndex,
    locs,
    urlCount: total,
    lastmodShare: Number((withLastmod / total).toFixed(3)),
    newestLastmod: Number.isFinite(newest) ? new Date(newest).toISOString() : null,
  };
}

/* ---------- 发现 ---------- */

function isGzip(bytes: Uint8Array): boolean {
  return bytes.byteLength > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function remember(url: string, locs: string[]) {
  if (locCache.size >= CACHE_MAX) {
    const oldest = locCache.keys().next().value;
    if (oldest !== undefined) locCache.delete(oldest);
  }
  locCache.set(url, locs);
}

async function fetchOne(url: string, fetcher: SitemapFetcher): Promise<{ info: SitemapInfo; parsed: ParsedSitemap | null }> {
  const res = await fetcher(url);
  const info: SitemapInfo = {
    url,
    status: res.status || null,
    valid: false,
    isIndex: false,
    urlCount: 0,
    lastmodShare: 0,
    newestLastmod: null,
    children: [],
  };
  if (!res.status) {
    info.error = res.error ?? "Network error";
    return { info, parsed: null };
  }
  if (res.status !== 200) {
    info.error = `HTTP ${res.status}`;
    return { info, parsed: null };
  }

  let text = res.body;
  if (res.raw && isGzip(res.raw)) {
    try {
      // maxOutputLength:解压炸弹在这里被拦下(超过就抛 RangeError)
      text = gunzipSync(res.raw, { maxOutputLength: MAX_SITEMAP_BYTES }).toString("utf8");
    } catch (e) {
      const tooBig = res.truncated || (e instanceof RangeError && /maxOutputLength|buffer/i.test(e.message));
      info.error = tooBig ? `Gzipped sitemap larger than the ${Math.round(MAX_SITEMAP_BYTES / 1024 / 1024)} MB limit` : "Could not decompress gzipped sitemap";
      return { info, parsed: null };
    }
  }

  const parsed = parseSitemapXml(text);
  info.valid = parsed.valid;
  info.isIndex = parsed.isIndex;
  info.urlCount = parsed.isIndex ? 0 : parsed.urlCount;
  info.lastmodShare = parsed.isIndex ? 0 : parsed.lastmodShare;
  info.newestLastmod = parsed.isIndex ? null : parsed.newestLastmod;
  info.children = parsed.isIndex ? parsed.locs.slice(0, MAX_CHILDREN_LISTED) : [];
  if (parsed.error) info.error = parsed.error;
  if (parsed.valid && !parsed.isIndex) remember(url, parsed.locs);
  return { info, parsed };
}

/**
 * 找到并解析站点的 sitemap。返回所有候选(包括 404 的,作为证据)+ 第一个索引的子文件。
 * 索引文件自身的 urlCount / lastmodShare / newestLastmod 由已抓取的子文件汇总而来。
 * 第三个参数只给测试注入用。
 */
export async function discoverSitemaps(
  origin: string,
  robotsSitemaps: string[],
  fetcher: SitemapFetcher = defaultFetcher
): Promise<SitemapInfo[]> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (u: string) => {
    const n = normalizeUrl(u, origin);
    if (n && !seen.has(n)) {
      seen.add(n);
      candidates.push(n);
    }
  };
  for (const s of robotsSitemaps ?? []) push(s);
  push(`${origin}/sitemap.xml`);
  push(`${origin}/sitemap_index.xml`);

  const top = candidates.slice(0, MAX_SITEMAP_CANDIDATES);
  const results = await Promise.all(top.map((u) => fetchOne(u, fetcher)));

  const out: SitemapInfo[] = [];
  let indexesExpanded = 0;
  for (const { info, parsed } of results) {
    out.push(info);
    if (!parsed?.isIndex) continue;
    if (indexesExpanded >= MAX_SITEMAP_INDEXES) {
      info.error = info.error ?? `Not expanded: only the first ${MAX_SITEMAP_INDEXES} sitemap index is followed`;
      continue;
    }
    indexesExpanded++;

    const kids: string[] = [];
    for (const loc of parsed.locs) {
      const n = normalizeUrl(loc, origin);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      kids.push(n);
      if (kids.length >= MAX_SITEMAP_CHILDREN) break;
    }
    const childResults = await Promise.all(kids.map((k) => fetchOne(k, fetcher)));

    // 汇总到索引自身,让 "sitemap 可用且 urlCount>0" 这类判定对纯索引站也成立
    let total = 0;
    let weightedLastmod = 0;
    let newest = -Infinity;
    let validKids = 0;
    for (const { info: child } of childResults) {
      out.push(child);
      if (!child.valid) continue;
      validKids++;
      total += child.urlCount;
      weightedLastmod += child.lastmodShare * child.urlCount;
      if (child.newestLastmod) {
        const ts = Date.parse(child.newestLastmod);
        if (!Number.isNaN(ts) && ts > newest) newest = ts;
      }
    }
    info.urlCount = total;
    info.lastmodShare = total ? Number((weightedLastmod / total).toFixed(3)) : 0;
    info.newestLastmod = Number.isFinite(newest) ? new Date(newest).toISOString() : null;
    if (kids.length && !validKids) {
      info.valid = false;
      info.error = "None of the sampled child sitemaps could be parsed";
    }
  }
  return out;
}

/**
 * 已发现 urlset 里缓存的全部页面 URL(去重、保持文件顺序)。
 * 依赖 discoverSitemaps 留下的模块级缓存;没命中就是空数组。
 * 不传 infos 时按 host 在缓存里找(抓取与探针并行时,抓取侧拿不到 infos)。
 */
export function cachedSitemapLocs(infos?: SitemapInfo[], host?: string): string[] {
  const pool: string[] = [];
  const seen = new Set<string>();
  const add = (locs: string[]) => {
    for (const loc of locs) {
      if (seen.has(loc)) continue;
      seen.add(loc);
      pool.push(loc);
    }
  };
  if (infos) {
    for (const info of infos) {
      if (info.isIndex || !info.valid) continue;
      add(locCache.get(info.url) ?? []);
    }
  } else if (host) {
    for (const [url, locs] of locCache) if (isSameSite(url, host)) add(locs);
  }
  return pool;
}

/**
 * 从已发现的 urlset 里均匀抽 n 条页面 URL(去重、确定性)。
 * 依赖 discoverSitemaps 留下的模块级缓存;缓存没命中就返回空数组。
 */
export function sampleSitemapUrls(infos: SitemapInfo[], n: number): string[] {
  const pool = cachedSitemapLocs(infos);
  if (n <= 0) return [];
  if (pool.length <= n) return pool;
  const step = pool.length / n;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.floor(i * step)]);
  return out;
}

/** 测试用:清空 loc 缓存 */
export function clearSitemapCache(): void {
  locCache.clear();
}
