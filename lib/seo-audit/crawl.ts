/* ============================================================
   SEO Audit · 站点探针 + 站内抓取 + 抓后补全

   三个阶段,对应 run.ts 的编排:
     probeSite   —— 不依赖抓取集合的"站点级"事实:入口页(AEOeyeBot 桌面 UA;
                    移动/桌面一致性用 AEOeyeBot 的移动 UA 再取一次)、WAF 拦截
                    与 JS 壳两道门、入口错误分类(TLS / DNS / 超时…)、TLS 证书、
                    8 个 URL 变体、www/裸域另一主机是否存在、robots(含 Googlebot
                    组对 CSS/JS 的封锁)、sitemap、软 404 探针、og:image 可达性、入口响应头。
     crawlSite   —— 分层抓取:导航 BFS(免费 12 / 付费 25 页)+ 从 sitemap
                    按路径首段去重抽样(覆盖不同模板),sitemap 没东西就
                    继续 BFS 补满。同主机请求间隔 ≥250ms(令牌桶,探针、抓取、
                    补全共用),Crawl-delay ≤2s 照做、更大则减半页数,遇到
                    403/429/挑战页立即停。
     enrichProbe —— 需要"抓取集合"才能做的探针:sitemap 抽样可收录性、
                    canonical 目标、失效内链/外链、大图、抓取 TTFB、覆盖统计。
   probeAndCrawl 把三者串起来(探针 ∥ 抓取 → 补全)。

   礼貌与安全:并发 4、全局时间预算、只跟 HTML、尊重 robots(入口页
   除外)、每个请求都过 safeFetch 的 SSRF 检查(名字 + 连接时地址)。

   复审 C39:全程只用 AEOeyeBot 自己的 UA(SEO_BOT_UA / SEO_BOT_MOBILE_UA)。
   不冒充浏览器或 Googlebot,也不在被拦后换 UA 重试 —— 站长按 UA 屏蔽我们必须立即生效,
   /bot 页对外承诺的就是"遇到 403/429/挑战页立即停"。被拦就是 blocked(入口)或停爬(抓取中)。
   ============================================================ */

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { safeFetch, USER_AGENT, type FetchResult, type SafeFetchOptions } from "./fetch";
import { parsePageDetailed, type ParsedPageDetails } from "./parse";
import {
  DEFAULT_UA,
  GOOGLEBOT_UA,
  crawlDelayFor,
  emptyRobots,
  isPathAllowed,
  isPathAllowedFor,
  looksLikeHtml,
  parseRobots,
  type RobotsRules,
} from "./robots";
import { cachedSitemapLocs, discoverSitemaps, MAX_SITEMAP_BYTES, SITEMAP_ACCEPT } from "./sitemap";
import { checkTls, type TlsCheck } from "./tls";
import { assertPublicHost, dedupeKey, isSameSite, normalizeInput, normalizeUrl, registrableDomain } from "./url";
import {
  FREE_CRAWL_PAGES,
  FREE_NAV_PAGES,
  FULL_NAV_PAGES,
  SEO_BOT_MOBILE_UA,
  type CrawledPage,
  type SiteProbe,
  type SitemapInfo,
  type UrlVariant,
  type VariantKind,
} from "./types";

export type Fetcher = (url: string, opts?: SafeFetchOptions) => Promise<FetchResult>;

/** 同主机请求最小间隔 */
export const MIN_HOST_INTERVAL_MS = 250;
/** Crawl-delay 照做的上限;更大就按上限等待并把页数减半 */
export const MAX_CRAWL_DELAY_MS = 2_000;
export const SITEMAP_SAMPLE_SIZE = 20;
export const CANONICAL_TARGETS_MAX = 10;
export const BROKEN_INTERNAL_MAX = 30;
export const BROKEN_OUTBOUND_MAX = 30;
export const LARGE_IMAGES_MAX = 20;
export const LARGE_IMAGE_BYTES = 200 * 1024;
export const OUTBOUND_TIMEOUT_MS = 5_000;
export const ENRICH_BUDGET_MS = 25_000;
/** 补全阶段的默认并发 —— 与 /bot 页 "At most 4 requests in flight" 一致 */
export const ENRICH_CONCURRENCY = 4;

const SMALL_BODY = 64 * 1024;
/** 只为读 <head>(canonical / meta robots / refresh)的 GET 上限 */
const HEAD_ONLY_BODY = 128 * 1024;

/** probeSite 的返回:SiteProbe 的超集 —— robots 里带 groups,可直接喂给 crawlSite */
export type ProbeResult = Omit<SiteProbe, "robots"> & {
  robots: SiteProbe["robots"] & RobotsRules;
  /** 入口页 GET 的结果摘要,run.ts 用来判断"根本打不开"这种情况;userAgent 永远是 AEOeyeBot */
  entry: { status: number; finalUrl: string; ms: number; error?: string; userAgent?: string };
};

export interface ProbeOptions {
  /** 测试注入用 */
  fetcher?: Fetcher;
  /** 测试注入用:替代 assertPublicHost */
  hostCheck?: (host: string) => Promise<void>;
  /** 测试注入用:替代 checkTls */
  tlsCheck?: (host: string) => Promise<TlsCheck>;
  /** 已经取过的 robots(run / probeAndCrawl 传入,省一次请求,Crawl-delay 也从第一个请求起生效) */
  robots?: RobotsRules & { url: string };
  /** 同主机请求间隔下限(默认 250ms;测试可设 0)。robots 有 Crawl-delay 时取两者较大值 */
  minIntervalMs?: number;
  /** 测试注入用:替代 parsePageDetailed(数解析次数) */
  parse?: typeof parsePageDetailed;
}

export interface CrawlOptions {
  maxPages: number;
  robots: RobotsRules;
  timeBudgetMs: number;
  onProgress?: (n: number) => void;
  /** 测试注入用 */
  fetcher?: Fetcher;
  /** 默认 4,上限 8 */
  concurrency?: number;
  /** 导航 BFS 的页数上限(默认:maxPages ≤ 20 → 12,否则 25) */
  navPages?: number;
  /** 同主机请求间隔(默认 250ms;测试可设 0) */
  minIntervalMs?: number;
  /** 已发现的 sitemap(分层抽样从它们的缓存里取);不传则按主机在缓存里找 */
  sitemaps?: SitemapInfo[];
}

export interface CrawlCoverage {
  navPages: number;
  sitemapPages: number;
  skippedByRobots: number;
  stoppedEarly: string | null;
}

export type BlockKind = NonNullable<SiteProbe["blocked"]>["kind"];

export interface CrawlResult {
  pages: CrawledPage[];
  coverage: CrawlCoverage;
  /** 抓取用的 UA —— 永远是 AEOeyeBot(复审 C39:不再换浏览器 UA 重试) */
  userAgent: string;
  /** 实际使用的同主机请求间隔(含 Crawl-delay)—— 补全阶段必须沿用,不能退回 250ms(复审 C40) */
  intervalMs: number;
  /** 入口页对我们的 UA 回了 403/429/挑战页:拦截页不入库,run 据此判 blocked(复审 C19) */
  entryBlock: { kind: BlockKind; evidence: string } | null;
}

export interface EnrichOptions {
  fetcher?: Fetcher;
  /** 同主机请求间隔:传抓取实际用的 intervalMs(含 Crawl-delay) */
  minIntervalMs?: number;
  /** 补全阶段的总时间预算(默认 25s);超出后剩余探针跳过,已有结果保留 */
  timeBudgetMs?: number;
  coverage?: CrawlCoverage;
  /** 默认 4,上限 8 */
  concurrency?: number;
}

/** 按扩展名就能判定不是网页的 URL —— 不用浪费一次请求 */
const NON_HTML_EXT =
  /\.(?:pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp4|m4v|webm|mov|avi|mkv|mp3|wav|ogg|m4a|flac|aac|zip|gz|tgz|rar|7z|tar|bz2|xz|dmg|exe|msi|apk|deb|rpm|css|js|mjs|cjs|json|xml|rss|atom|txt|csv|tsv|md|yml|yaml|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|odt|ods|odp|epub|swf|wasm|map|ics|vcf)$/i;

export function hasNonHtmlExtension(url: string): boolean {
  try {
    return NON_HTML_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function isHtmlResponse(res: FetchResult): boolean {
  if (/html/.test(res.contentType)) return true;
  return !res.contentType && /^\s*</.test(res.body);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/";
  }
}

/* ---------- 礼貌:同主机令牌桶(探针、抓取、补全共用) ---------- */

const hostNext = new Map<string, number>();

async function politeWait(host: string, intervalMs: number): Promise<void> {
  if (intervalMs <= 0 || !host) return;
  const now = Date.now();
  if (hostNext.size > 512) for (const [h, t] of hostNext) if (t < now) hostNext.delete(h);
  const slot = Math.max(now, hostNext.get(host) ?? 0);
  hostNext.set(host, slot + intervalMs);
  if (slot > now) await sleep(slot - now);
}

function politeFetcher(fetcher: Fetcher, intervalMs: number): Fetcher {
  if (intervalMs <= 0) return fetcher;
  return async (url, opts) => {
    await politeWait(hostOf(url), intervalMs);
    return fetcher(url, opts);
  };
}

/**
 * 按 robots 的 Crawl-delay 算同主机请求间隔(≤2s 照做;更大则按 2s 并让调用方把页数减半)。
 * 探针、抓取、补全三处共用同一个口径 —— 令牌桶按"上一个预约者的间隔"推进,
 * 任何一方用更短的间隔都会把 Crawl-delay 打穿(复审 C40)。
 */
export function politeIntervalFor(robots: RobotsRules | null | undefined, base: number = MIN_HOST_INTERVAL_MS): { intervalMs: number; halvePages: boolean } {
  const delay = robots && Array.isArray(robots.groups) ? crawlDelayFor(robots, DEFAULT_UA) : null;
  if (delay === null || !(delay > 0)) return { intervalMs: base, halvePages: false };
  if (delay * 1000 <= MAX_CRAWL_DELAY_MS) return { intervalMs: Math.max(base, delay * 1000), halvePages: false };
  return { intervalMs: Math.max(base, MAX_CRAWL_DELAY_MS), halvePages: true };
}

/** 小并发池:按顺序取任务,最多 n 个同时;deadline 到了就不再开新任务 */
async function pool<T, R>(items: T[], n: number, deadline: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const worker = async () => {
    for (;;) {
      if (Date.now() >= deadline) return;
      const idx = i++;
      if (idx >= items.length) return;
      out.push(await fn(items[idx]));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

/* ---------- WAF / 挑战页检测 ---------- */

const STRONG_CHALLENGE = /cf-chl|_vercel\/challenge|challenge-platform|cf_chl_opt|hcaptcha\.com\/1\/api|challenges\.cloudflare\.com/i;
const WEAK_CHALLENGE = /Just a moment|captcha|DDoS protection|Checking your browser|Verify you are human|Enable JavaScript and cookies to continue/i;
/** 拦截页(不是挑战、过不去):Cloudflare 1020 "Access denied"、"Attention Required"、各家 WAF 的 "Request blocked" */
const WEAK_WAF = /Access denied|Attention Required|Request blocked|blocked by .{0,40}firewall|Web Application Firewall/i;
const WAF_SERVER = /cloudflare|akamai|imperva|incapsula|sucuri|awselb|cloudfront|fastly|vercel/i;

/**
 * 一个响应是不是"我们被拦了"。只在 403/503/429 或明确的挑战页签名时判定 —— "captcha"
 * 这种词在正常 200 页面的正文里也会出现,不能单凭正文。
 * 没有拿到 HTTP 响应(status 0:TLS / DNS / 超时 / 拒绝连接)不是"被拦"(复审 C20),
 * 原因由 classifyFetchError 分类。
 */
export function detectBlock(res: FetchResult): { kind: BlockKind; evidence: string } | null {
  if (res.status === 0) return null;
  const h = res.headers && typeof res.headers.get === "function" ? res.headers : null;
  const cfMitigated = h?.get("cf-mitigated") ?? null;
  const server = h?.get("server") ?? "";
  const body = res.body ?? "";
  const strong = STRONG_CHALLENGE.exec(body)?.[0] ?? null;
  const weak = WEAK_CHALLENGE.exec(body)?.[0] ?? null;
  const wafPage = WEAK_WAF.exec(body)?.[0] ?? null;
  const gated = res.status === 403 || res.status === 503 || res.status === 429 || res.status === 401;

  if (cfMitigated === "challenge") return { kind: "challenge", evidence: `HTTP ${res.status} with cf-mitigated: challenge (Cloudflare managed challenge)` };
  if (strong && (gated || res.status === 200)) return { kind: "challenge", evidence: `HTTP ${res.status} with a challenge page (marker "${strong}")` };
  if (gated && weak) return { kind: "challenge", evidence: `HTTP ${res.status} with "${weak}" in the body${server ? ` (server: ${server})` : ""}` };
  if (res.status === 429) return { kind: "rate-limited", evidence: `HTTP 429${h?.get("retry-after") ? ` (Retry-After: ${h.get("retry-after")})` : ""}` };
  if (res.status === 403 || res.status === 401) {
    const waf = !!cfMitigated || WAF_SERVER.test(server) || !!wafPage;
    return { kind: waf ? "waf" : "forbidden", evidence: `HTTP ${res.status}${server ? ` from ${server}` : ""}${cfMitigated ? ` (cf-mitigated: ${cfMitigated})` : ""}${wafPage ? ` ("${wafPage}" page)` : ""}` };
  }
  if (res.status === 503 && (WAF_SERVER.test(server) || wafPage)) return { kind: "waf", evidence: `HTTP 503 from ${server || "the edge"}${wafPage ? ` ("${wafPage}" page)` : ""}` };
  return null;
}

/** "我们被拦了"且必须立刻停手的那几种(普通 401/403 是站点自己的页面状态,不在此列) */
function isHardBlock(kind: BlockKind): boolean {
  return kind === "rate-limited" || kind === "challenge" || kind === "waf";
}

/* ---------- 入口错误分类(复审 C20) ---------- */

export type EntryErrorKind = NonNullable<SiteProbe["entryError"]>["kind"];

/** 证书与握手类错误(node 的错误码 + safeFetch / tls.ts 的描述文字) */
const TLS_FAILURE = /^(?:CERT_|ERR_TLS_|ERR_SSL_|EPROTO|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|HOSTNAME_MISMATCH)|certificate|handshake|secure TLS connection|\bssl\b|\btls\b/i;
/** DNS 解析失败:只有这几种才算"主机不存在"(复审 C21) */
const DNS_FAILURE = /\b(?:ENOTFOUND|EAI_AGAIN|ENODATA)\b|DNS lookup failed|does not resolve/i;
const TIMEOUT_FAILURE = /timed out|timeout|ETIMEDOUT|No response within/i;
const REFUSED_FAILURE = /ECONNREFUSED|connection refused/i;

/** 没拿到 HTTP 响应的原因:tls / dns / timeout / refused / other */
export function classifyFetchError(error: string | null | undefined): EntryErrorKind {
  const e = error ?? "";
  if (TLS_FAILURE.test(e)) return "tls";
  if (DNS_FAILURE.test(e)) return "dns";
  if (TIMEOUT_FAILURE.test(e)) return "timeout";
  if (REFUSED_FAILURE.test(e)) return "refused";
  return "other";
}

/** 这个错误是不是"DNS 里根本没有这个主机" */
export function isDnsFailure(error: string | null | undefined): boolean {
  return DNS_FAILURE.test(error ?? "");
}

/* ---------- robots ---------- */

export async function fetchRobots(origin: string, fetcher: Fetcher = safeFetch): Promise<RobotsRules & { url: string }> {
  const url = `${origin}/robots.txt`;
  const res = await fetcher(url, { accept: "text/plain,*/*;q=0.8", maxBytes: 512 * 1024, timeoutMs: 8_000 });
  const base: RobotsRules & { url: string } = {
    ...emptyRobots(res.status || null, res.error),
    url,
    bytes: res.bytes,
    contentType: res.contentType || null,
  };
  if (res.status !== 200) return base;
  const isHtml = looksLikeHtml(res.body);
  // 有些站对任何路径都回 200 的 HTML —— 那不是 robots.txt
  const looksLikeRobots = !isHtml && (!/html/.test(res.contentType) || /^\s*(user-agent|disallow|allow|sitemap)\s*:/im.test(res.body));
  if (!looksLikeRobots) return { ...base, isHtml, error: "robots.txt returned an HTML page" };
  const parsed = parseRobots(res.body);
  return { ...base, found: true, ...parsed };
}

/* ---------- URL 变体 ---------- */

function needsGetFallback(res: FetchResult): boolean {
  return res.status === 0 || res.status === 405 || res.status === 501 || res.status === 403 || res.status === 400 || res.status >= 500;
}

function redirectHops(res: FetchResult): number[] {
  return (res.hops ?? []).filter((h) => h.status >= 300 && h.status < 400).map((h) => h.status);
}

/** 同一个响应文档:最终地址与正文都相同(解析结果可以直接复用) */
function sameDocument(a: FetchResult, b: FetchResult): boolean {
  return a.status === b.status && a.finalUrl === b.finalUrl && a.body === b.body;
}

/**
 * 探一个变体。host 变体先 HEAD(多半是 301),200 才补一次 GET 读 canonical;
 * 路径变体直接 GET(多半是 200,一次请求拿齐)。reuse:与入口页相同的 URL 直接复用入口响应
 * (连同它已经解析好的结果,不再解析第二遍)。
 */
async function probeVariant(
  url: string,
  kind: VariantKind,
  fetcher: Fetcher,
  host: string,
  opts: { preferGet?: boolean; reuse?: { res: FetchResult; details: ParsedPageDetails }; parse?: typeof parsePageDetailed } = {}
): Promise<UrlVariant> {
  const parse = opts.parse ?? parsePageDetailed;
  let res: FetchResult;
  if (opts.reuse) res = opts.reuse.res;
  else if (opts.preferGet) res = await fetcher(url, { method: "GET", maxBytes: HEAD_ONLY_BODY });
  else {
    res = await fetcher(url, { method: "HEAD" });
    if (needsGetFallback(res)) res = await fetcher(url, { method: "GET", maxBytes: HEAD_ONLY_BODY });
  }
  const first = res.hops?.[0];
  const variant: UrlVariant = {
    url,
    kind,
    // status 是**第一跳**的状态(301/302/200…),chain 是之后的落点;
    // 这样 "http 变体是不是 301 到 https" 这类判定才有依据
    status: first ? first.status : res.status || null,
    location: first?.location ?? null,
    chain: res.chain,
    hops: redirectHops(res),
    finalUrl: res.status ? res.finalUrl : undefined,
  };
  if (res.error) variant.error = res.error;
  else if (res.chain.length && res.status >= 400) variant.error = `Redirect chain ends in HTTP ${res.status}`;

  if (res.status === 200) {
    if (opts.reuse) {
      variant.canonical = opts.reuse.details.page.canonical;
      variant.metaRefresh = opts.reuse.details.page.metaRefresh === true;
      return variant;
    }
    let body = res.body;
    if (!body && !opts.preferGet) {
      const g = await fetcher(url, { method: "GET", maxBytes: HEAD_ONLY_BODY });
      body = g.status === 200 ? g.body : "";
    }
    if (body && isHtmlResponse(res)) {
      const parsed = parse(body, { ...res, body }, 1, host).page;
      variant.canonical = parsed.canonical;
      variant.metaRefresh = parsed.metaRefresh === true;
    } else {
      variant.canonical = null;
      variant.metaRefresh = false;
    }
  }
  return variant;
}

/** 路径变体的基准:入口路径;入口是根路径时用第一个"像页面"的导航链接 */
function pathVariantBase(entryUrl: string, navLinks: string[], host: string): URL | null {
  const u = new URL(entryUrl);
  if (u.pathname !== "/" && !hasNonHtmlExtension(entryUrl)) return u;
  for (const link of navLinks) {
    try {
      const l = new URL(link);
      if (!isSameSite(link, host) || l.pathname === "/" || l.search || hasNonHtmlExtension(link)) continue;
      if (l.pathname.split("/").filter(Boolean).length > 2) continue;
      return l;
    } catch {
      /* skip */
    }
  }
  return null;
}

/* ---------- 探针 ---------- */

/**
 * 站点级探针。抛 SeoAuditError("invalid" | "blocked" | "unreachable")
 * —— 入口主机本身不合法时没有必要继续。
 */
export async function probeSite(entryUrl: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const { entryUrl: entry, origin, host } = normalizeInput(entryUrl);
  await (opts.hostCheck ?? assertPublicHost)(host);
  const baseFetcher = opts.fetcher ?? safeFetch;
  const parse = opts.parse ?? parsePageDetailed;
  const baseInterval = opts.minIntervalMs ?? MIN_HOST_INTERVAL_MS;
  const tlsCheck = opts.tlsCheck ?? ((h: string) => checkTls(h));

  const entryPath = pathOf(entry);
  const apex = registrableDomain(host);
  const www = host.startsWith("www.") ? host : `www.${host}`;
  // www ↔ 裸域的另一个主机;IP 字面量没有这种对应关系
  const ipHost = isIP(host) !== 0;
  const altHostName = ipHost ? null : host.startsWith("www.") ? apex : www;
  const probeUrl = `${origin}/aeoeye-404-probe-${randomBytes(4).toString("hex")}`;

  /* ---- 第一波:入口(AEOeyeBot UA)、robots、TLS(并行)。被拦就停在这里,不再对这个站发别的请求 ---- */
  const firstWave = politeFetcher(baseFetcher, politeIntervalFor(opts.robots, baseInterval).intervalMs);
  const [entryBot, robots, tls] = await Promise.all([
    firstWave(entry, { method: "GET" }),
    opts.robots ? Promise.resolve(opts.robots) : fetchRobots(origin, firstWave),
    origin.startsWith("https:") ? tlsCheck(host) : Promise.resolve(null),
  ]);
  // 第二波按 robots 的 Crawl-delay 走(与抓取同一口径)
  const fetcher = politeFetcher(baseFetcher, politeIntervalFor(robots, baseInterval).intervalMs);

  /* ---- 门 0:WAF / 挑战页 / 403 / 429 —— 我们的 UA 被拦就是 blocked(复审 C39:不换 UA 重试) ---- */
  const botBlock = detectBlock(entryBot);
  const blocked: NonNullable<SiteProbe["blocked"]> = botBlock
    ? { detected: true, kind: botBlock.kind, evidence: botBlock.evidence }
    : { detected: false, kind: null, evidence: "" };

  /* ---- 入口没拿到 HTTP 响应:记下原因。证书 / 握手失败不是"防火墙拦截",由 sec.https / sec.tls 的 gate 处理(复审 C20) ---- */
  const entryError: SiteProbe["entryError"] = entryBot.status === 0 ? { kind: classifyFetchError(entryBot.error), message: entryBot.error ?? "No response" } : null;

  const entryRes = entryBot;
  const entryOk = entryRes.status >= 200 && entryRes.status < 300 && isHtmlResponse(entryRes);
  const entryDetails = parse(entryOk ? entryRes.body : "", entryRes, 0, host);
  const entryPage = entryDetails.page;

  /* ---- 门 1:JS 壳 ---- */
  const jsDependent = blocked.detected ? undefined : entryOk ? entryPage.jsShell === true : undefined;

  let parity: SiteProbe["parity"] = null;
  let soft404: SiteProbe["soft404"] = { probeUrl, status: null, isSoft404: false };
  let sitemaps: SitemapInfo[] = [];
  let variants: UrlVariant[] = [];
  let ogImage: SiteProbe["ogImage"] = null;
  let altHost: SiteProbe["altHost"] = null;
  const canonicalTargets: NonNullable<SiteProbe["canonicalTargets"]> = [];

  /* ---- 第二波(只对没拦我们的站):移动 UA 一致性、软 404、sitemap、变体、og:image、入口 canonical 目标 ---- */
  if (!blocked.detected) {
    const mobileP = fetcher(entry, { method: "GET", userAgent: SEO_BOT_MOBILE_UA });
    const softP = fetcher(probeUrl, { method: "GET", maxBytes: SMALL_BODY });
    const sitemapsP = discoverSitemaps(origin, robots.sitemaps, (u) => fetcher(u, { accept: SITEMAP_ACCEPT, raw: true, maxBytes: MAX_SITEMAP_BYTES, timeoutMs: 15_000 }));

    const entryFinal = entryRes.status === 200 ? entryRes.finalUrl : entry;
    const entryFinalKey = dedupeKey(entryFinal);
    const specs: { kind: VariantKind; url: string; preferGet?: boolean }[] = [{ kind: "https-apex", url: `https://${apex}/` }];
    if (!ipHost) specs.push({ kind: "https-www", url: `https://${www}/` });
    specs.push({ kind: "http-apex", url: `http://${apex}/` });
    if (!ipHost) specs.push({ kind: "http-www", url: `http://${www}/` });
    const baseU = new URL(entryFinal);
    const pathBase = pathVariantBase(entryFinal, entryDetails.navLinks, host);
    if (pathBase) {
      const p = pathBase.pathname;
      const trailing = p.endsWith("/") ? p.slice(0, -1) || "/" : `${p}/`;
      specs.push({ kind: "trailing-slash", url: `${pathBase.origin}${trailing}`, preferGet: true });
      if (/[a-z]/.test(p)) specs.push({ kind: "uppercase", url: `${pathBase.origin}${p.toUpperCase()}`, preferGet: true });
    }
    const dir = baseU.pathname.endsWith("/") ? baseU.pathname : baseU.pathname.replace(/[^/]*$/, "");
    specs.push({ kind: "index-html", url: `${baseU.origin}${dir}index.html`, preferGet: true });
    const utm = new URL(entryFinal);
    utm.searchParams.set("utm_source", "aeoeye");
    utm.searchParams.set("utm_medium", "seo-audit");
    specs.push({ kind: "utm", url: utm.href, preferGet: true });

    const seenUrls = new Set<string>();
    const unique = specs.filter((s) => (seenUrls.has(s.url) ? false : (seenUrls.add(s.url), true)));
    const variantsP = Promise.all(
      unique.map((s) =>
        probeVariant(s.url, s.kind, fetcher, host, {
          preferGet: s.preferGet,
          parse,
          reuse: entryRes.status === 200 && s.url === entryRes.url && dedupeKey(s.url) === entryFinalKey ? { res: entryRes, details: entryDetails } : undefined,
        })
      )
    );

    const ogP = (async (): Promise<SiteProbe["ogImage"]> => {
      const og = entryPage.og["og:image"];
      if (!og) return null;
      const abs = normalizeUrl(og, entryFinal);
      if (!abs) return { url: og, status: null, bytes: null, contentType: null };
      let r = await fetcher(abs, { method: "HEAD", timeoutMs: OUTBOUND_TIMEOUT_MS });
      if (needsGetFallback(r)) r = await fetcher(abs, { method: "GET", maxBytes: 4096, timeoutMs: OUTBOUND_TIMEOUT_MS });
      const len = Number(r.headers.get("content-length"));
      return { url: abs, status: r.status || null, bytes: Number.isFinite(len) && len > 0 ? len : null, contentType: r.contentType || null };
    })();

    const canonicalP = (async () => {
      if (!entryPage.canonical || dedupeKey(entryPage.canonical) === entryFinalKey) return;
      const r = await fetcher(entryPage.canonical, { method: "GET", maxBytes: HEAD_ONLY_BODY });
      const parsed = parse(isHtmlResponse(r) ? r.body : "", r, 1, host).page;
      canonicalTargets.push({ url: entryPage.canonical, status: r.status || null, finalUrl: r.status ? r.finalUrl : null, noindex: parsed.robotsNoindex === true });
    })();

    const [entryMobile, softRes] = await Promise.all([mobileP, softP]);
    soft404 = { probeUrl, status: softRes.status || null, isSoft404: softRes.status >= 200 && softRes.status < 300 };

    /* ---- 移动 / 桌面一致性:桌面侧就是入口那次(AEOeyeBot 桌面 UA);两份正文相同就复用同一个解析结果 ---- */
    const mobileOk = entryMobile.status >= 200 && entryMobile.status < 300 && isHtmlResponse(entryMobile);
    if (entryOk && mobileOk) {
      const m = sameDocument(entryMobile, entryRes) ? entryDetails : parse(entryMobile.body, entryMobile, 0, host);
      const d = entryDetails;
      parity = {
        mobileWords: m.page.wordCount,
        desktopWords: d.page.wordCount,
        mobileH1: m.page.h1s[0] ?? "",
        desktopH1: d.page.h1s[0] ?? "",
        mobileLinks: m.page.uniqueInternalLinks ?? m.page.links.length,
        desktopLinks: d.page.uniqueInternalLinks ?? d.page.links.length,
        mobileJsonLd: m.jsonLdBlocks,
        desktopJsonLd: d.jsonLdBlocks,
      };
    }

    [variants, ogImage, sitemaps] = await Promise.all([variantsP, ogP, sitemapsP, canonicalP]);

    /* ---- www ↔ 裸域的另一主机是否存在:只有 DNS 查不到才算"不存在"(复审 C21) ---- */
    if (altHostName) {
      const altKinds: VariantKind[] = host.startsWith("www.") ? ["https-apex", "http-apex"] : ["https-www", "http-www"];
      const alt = variants.filter((v) => v.kind && altKinds.includes(v.kind));
      if (alt.length) {
        const missing = alt.every((v) => v.status === null && isDnsFailure(v.error));
        altHost = missing ? { host: altHostName, exists: false, error: alt[0].error } : { host: altHostName, exists: true };
      }
    }
  }

  /* ---- robots 扩展:Googlebot 组对入口页 CSS/JS 的封锁 ---- */
  const blocksResources = robots.found ? entryDetails.resourceUrls.filter((u) => !isPathAllowedFor(robots, pathOf(u), GOOGLEBOT_UA)) : [];

  const h = entryRes.status ? entryRes.headers : null;
  const header = (name: string) => h?.get(name) ?? null;

  const entrySummary: ProbeResult["entry"] = { status: entryRes.status, finalUrl: entryRes.finalUrl, ms: entryRes.ms, userAgent: USER_AGENT };
  if (entryRes.error) entrySummary.error = entryRes.error;

  return {
    input: entryUrl,
    entryUrl: entry,
    origin,
    host,
    variants,
    robots: {
      ...robots,
      blocksEntry: robots.found && !isPathAllowedFor(robots, entryPath, GOOGLEBOT_UA),
    },
    sitemaps,
    soft404,
    headers: {
      hsts: header("strict-transport-security"),
      csp: header("content-security-policy"),
      xContentTypeOptions: header("x-content-type-options"),
      xFrameOptions: header("x-frame-options"),
      referrerPolicy: header("referrer-policy"),
      server: header("server"),
      xRobotsTag: header("x-robots-tag"),
    },
    entry: entrySummary,
    blocked,
    entryError,
    altHost,
    jsDependent,
    tls: tls ?? undefined,
    parity,
    robotsMeta: {
      contentType: robots.contentType ?? null,
      isHtml: robots.isHtml === true,
      googlebotDisallowAll: robots.googlebotDisallowAll === true,
      blocksResources,
      crawlDelay: robots.crawlDelay ?? null,
      aiCrawlers: robots.aiCrawlers ?? {},
      hasSitemapDirective: robots.hasSitemapDirective ?? robots.sitemaps.length > 0,
    },
    ogImage,
    canonicalTargets,
  };
}

/* ---------- 抓取 ---------- */

interface QueueItem {
  url: string;
  depth: number;
  nav: boolean;
  segments: number;
  seq: number;
}

function pathSegments(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
}

function firstSegment(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return "";
  }
}

/** 队列里优先级最高的一项:深度小 → 导航链接 → 路径浅 → 先发现 */
function popBest(queue: QueueItem[]): QueueItem | undefined {
  if (!queue.length) return undefined;
  let bestIdx = 0;
  for (let i = 1; i < queue.length; i++) {
    const a = queue[i];
    const b = queue[bestIdx];
    if (
      a.depth < b.depth ||
      (a.depth === b.depth &&
        (Number(!a.nav) < Number(!b.nav) ||
          (a.nav === b.nav && (a.segments < b.segments || (a.segments === b.segments && a.seq < b.seq)))))
    ) {
      bestIdx = i;
    }
  }
  return queue.splice(bestIdx, 1)[0];
}

/** 按路径首段轮转抽样:每个"模板"先各来一条,再第二轮…直到够数 */
export function stratifiedSample(urls: string[], n: number): string[] {
  if (n <= 0 || !urls.length) return [];
  const buckets = new Map<string, string[]>();
  for (const u of urls) {
    const k = firstSegment(u);
    const b = buckets.get(k);
    if (b) b.push(u);
    else buckets.set(k, [u]);
  }
  const lists = Array.from(buckets.values());
  const out: string[] = [];
  for (let round = 0; out.length < n; round++) {
    let any = false;
    for (const list of lists) {
      if (round < list.length) {
        out.push(list[round]);
        any = true;
        if (out.length >= n) break;
      }
    }
    if (!any) break;
  }
  return out;
}

export async function crawlSiteDetailed(entryUrl: string, opts: CrawlOptions): Promise<CrawlResult> {
  const { entryUrl: entry, host } = normalizeInput(entryUrl);
  const baseFetcher = opts.fetcher ?? safeFetch;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  // 传进来的可能是 SiteProbe.robots(没有 groups)—— 当作"无规则"而不是崩掉
  const robots: RobotsRules = opts.robots && Array.isArray(opts.robots.groups) ? opts.robots : emptyRobots();

  let maxPages = Math.max(1, Math.floor(opts.maxPages));
  const polite = politeIntervalFor(robots, opts.minIntervalMs ?? MIN_HOST_INTERVAL_MS);
  const interval = polite.intervalMs;
  if (polite.halvePages) maxPages = Math.max(1, Math.ceil(maxPages / 2));
  const coverage: CrawlCoverage = { navPages: 0, sitemapPages: 0, skippedByRobots: 0, stoppedEarly: null };
  const navBudget = Math.min(maxPages, Math.max(1, opts.navPages ?? (maxPages > FREE_CRAWL_PAGES ? FULL_NAV_PAGES : FREE_NAV_PAGES)));
  const fetcher = politeFetcher(baseFetcher, interval);

  const start = Date.now();
  const deadline = start + Math.max(1000, opts.timeBudgetMs);
  const remaining = () => deadline - Date.now();

  const pages: CrawledPage[] = [];
  const seen = new Set<string>();
  const queue: QueueItem[] = [];
  let seq = 0;
  let fetches = 0;
  let inFlight = 0;
  let forbidden = 0;
  /** 第二个 401/403 触发早停后,这一批 401/403 都不当站点页面记(多半是我们被按 IP/UA 拦了) */
  let excludeForbidden = false;
  const forbiddenPages: { page: CrawledPage; bucket: "navPages" | "sitemapPages" }[] = [];
  let entryBlock: CrawlResult["entryBlock"] = null;
  let stopped = false;
  // 非 HTML 的 2xx 不算页但花了一次请求,给总请求数一个硬顶
  const maxFetches = maxPages * 2 + 5;

  const stop = (reason: string) => {
    if (!stopped) {
      stopped = true;
      coverage.stoppedEarly = reason;
    }
  };

  const allowed = (url: string): boolean => {
    if (!isSameSite(url, host) || hasNonHtmlExtension(url)) return false;
    if (!isPathAllowed(robots, pathOf(url), DEFAULT_UA)) {
      coverage.skippedByRobots++;
      return false;
    }
    return true;
  };

  const enqueueLinks = (details: ParsedPageDetails, depth: number) => {
    const navSet = new Set(details.navLinks.map(dedupeKey));
    for (const link of details.page.links) {
      const key = dedupeKey(link);
      if (seen.has(key)) continue;
      if (!isSameSite(link, host)) continue;
      seen.add(key);
      if (hasNonHtmlExtension(link)) continue;
      if (!isPathAllowed(robots, pathOf(link), DEFAULT_UA)) {
        coverage.skippedByRobots++;
        continue;
      }
      queue.push({ url: link, depth: depth + 1, nav: navSet.has(key), segments: pathSegments(link), seq: seq++ });
    }
  };

  type Fetched = { details: ParsedPageDetails | null; block: ReturnType<typeof detectBlock>; res: FetchResult | null };

  const fetchPage = async (url: string, depth: number): Promise<Fetched> => {
    fetches++;
    const res = await fetcher(url, { method: "GET", timeoutMs: Math.min(8000, Math.max(remaining(), 1000)) });
    // 预算耗尽造成的中断是我们的问题,不是站点的问题 —— 不记成失败页
    if (res.status === 0 && remaining() <= 0) return { details: null, block: null, res: null };
    // 内链跳到了别的站(/discord → discord.com):那不是这个站的页面,不解析、不记页、
    // 也不看它拦不拦我们 —— 别人家的 WAF 与被审计的站无关(复审 C19)
    if (depth > 0 && res.status !== 0 && !isSameSite(res.finalUrl, host)) return { details: null, block: null, res };
    const block = detectBlock(res);
    if (block && depth === 0) return { details: null, block, res };
    if (block && depth > 0) {
      if (isHardBlock(block.kind)) {
        // 被限流 / 挑战 / WAF:立即停,这个响应是"我们被拦了",不是站点的页面(复审 C19)
        stop(`${block.evidence} at ${pathOf(url)} — crawl stopped to stay polite`);
        return { details: null, block, res };
      }
      if (block.kind === "forbidden" && ++forbidden >= 2) {
        stop(`Repeated HTTP ${res.status} (${pathOf(url)}) — crawl stopped to stay polite`);
        excludeForbidden = true;
      }
    }
    const html = isHtmlResponse(res);
    const ok = res.status >= 200 && res.status < 300;
    if (ok && !html && depth > 0) return { details: null, block, res };
    return { details: parsePageDetailed(html ? res.body : "", res, depth, host), block, res };
  };

  /* ---- 入口页:不看 robots,单独先抓;对我们的 UA 被拦就立即停(不换 UA 重试,复审 C39) ---- */
  seen.add(dedupeKey(entry));
  const first = await fetchPage(entry, 0);
  if (first.block) {
    // 拦截页不是站点首页:不入库(否则 crawl.entry.status 会因我们被限流而 gate fail),run 据 entryBlock 判 blocked
    entryBlock = { kind: first.block.kind, evidence: first.block.evidence };
    stop(`Entry page blocked (${first.block.evidence}); no further pages requested`);
  } else {
    if (first.res && first.res.status === 0) stop(`Entry page unreachable (${first.res.error ?? "no response"})`);
    const entryDetails = first.details;
    if (entryDetails) {
      pages.push(entryDetails.page);
      coverage.navPages++;
      opts.onProgress?.(pages.length);
      if (entryDetails.page.status >= 200 && entryDetails.page.status < 300) enqueueLinks(entryDetails, 0);
    }
  }

  /** 通用 worker:next 给出下一项;limit 是本阶段的页数上限 */
  const drain = async (next: () => QueueItem | undefined, limit: number, bucket: "navPages" | "sitemapPages") => {
    const worker = async () => {
      for (;;) {
        if (stopped) return;
        if (remaining() < 300) return;
        if (pages.length + inFlight >= limit) return;
        if (fetches >= maxFetches) return;
        const item = next();
        if (!item) {
          if (inFlight === 0) return;
          await sleep(25);
          continue;
        }
        inFlight++;
        try {
          const { details, block } = await fetchPage(item.url, item.depth);
          const forbiddenPage = block?.kind === "forbidden";
          if (details && pages.length < limit && !(forbiddenPage && excludeForbidden)) {
            pages.push(details.page);
            coverage[bucket]++;
            if (forbiddenPage) forbiddenPages.push({ page: details.page, bucket });
            opts.onProgress?.(pages.length);
            if (details.page.status >= 200 && details.page.status < 300) enqueueLinks(details, item.depth);
          }
        } finally {
          inFlight--;
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  };

  /* ---- 阶段 1:导航 BFS ---- */
  await drain(() => popBest(queue), navBudget, "navPages");

  /* ---- 阶段 2:sitemap 分层抽样(覆盖不同模板) ---- */
  if (!stopped && pages.length < maxPages && remaining() > 300) {
    const sitemapPool = cachedSitemapLocs(opts.sitemaps, opts.sitemaps ? undefined : host).filter((u) => {
      const n = normalizeUrl(u);
      if (!n || seen.has(dedupeKey(n))) return false;
      return allowed(n);
    });
    const picks = stratifiedSample(sitemapPool, maxPages - pages.length);
    const items: QueueItem[] = picks.map((u) => {
      seen.add(dedupeKey(u));
      // sitemap 抽出来的页没有点击深度;记 1(保守)而不是 0
      return { url: u, depth: 1, nav: false, segments: pathSegments(u), seq: seq++ };
    });
    let i = 0;
    await drain(() => items[i++], maxPages, "sitemapPages");
  }

  /* ---- 阶段 3:sitemap 不够就继续 BFS 补满 ---- */
  if (!stopped && pages.length < maxPages && remaining() > 300) {
    await drain(() => popBest(queue), maxPages, "navPages");
  }

  /* ---- 第二个 401/403 触发了早停:这一批 401/403 都撤掉(单个 403 内页仍是真实发现) ---- */
  if (excludeForbidden && forbiddenPages.length) {
    const drop = new Set(forbiddenPages.map((f) => f.page));
    for (const f of forbiddenPages) coverage[f.bucket] = Math.max(0, coverage[f.bucket] - 1);
    for (let i = pages.length - 1; i >= 0; i--) if (drop.has(pages[i])) pages.splice(i, 1);
  }

  return { pages, coverage, userAgent: USER_AGENT, intervalMs: interval, entryBlock };
}

/** 契约签名:只要页面列表 */
export async function crawlSite(entryUrl: string, opts: CrawlOptions): Promise<CrawledPage[]> {
  return (await crawlSiteDetailed(entryUrl, opts)).pages;
}

/* ---------- 抓后补全 ---------- */

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function evenSample(items: string[], n: number): string[] {
  if (n <= 0) return [];
  if (items.length <= n) return items;
  const step = items.length / n;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

async function headOrGet(fetcher: Fetcher, url: string, timeoutMs: number): Promise<FetchResult> {
  let r = await fetcher(url, { method: "HEAD", timeoutMs });
  if (needsGetFallback(r)) r = await fetcher(url, { method: "GET", maxBytes: 4096, timeoutMs });
  return r;
}

/** 401/403/429 是"对方不让我们看",不是死链(内链、外链同一口径) */
function isAccessDenied(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

/**
 * 需要"抓取集合"才能做的探针。就地补全 probe 的 v2 字段并返回同一个对象。
 * 每一类探针都受总预算约束;预算耗尽时保留已得结果。
 * 复审 C40:
 *   · 抓取已被叫停(coverage.stoppedEarly:限流 / 挑战 / WAF / 入口不可达)时,所有**同主机**探针
 *     (sitemap 抽样、canonical 目标、失效内链、大图、og:image)一律不做,字段留 undefined ——
 *     检查层据此判 n/a,而不是"0 个问题 = 通过";外链检查打的是别的主机,照做。
 *   · 同主机请求间隔用抓取实际用的 intervalMs(含 Crawl-delay),并发默认 4。
 *   · 补全阶段自己遇到 429 / 挑战页 / WAF 也立即停手:那一类探针的结果作废(留 undefined),
 *     原因写进 coverage.stoppedEarly。
 */
export async function enrichProbe(probe: ProbeResult, pages: CrawledPage[], opts: EnrichOptions = {}): Promise<ProbeResult> {
  const fetcher = politeFetcher(opts.fetcher ?? safeFetch, opts.minIntervalMs ?? MIN_HOST_INTERVAL_MS);
  const deadline = Date.now() + (opts.timeBudgetMs ?? ENRICH_BUDGET_MS);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? ENRICH_CONCURRENCY, 8));
  const host = probe.host;
  const robots = probe.robots;

  /* ---- 抓取 TTFB ---- */
  const measured = pages.filter((p) => typeof p.ttfbMs === "number").map((p) => ({ url: p.url, ms: p.ttfbMs as number }));
  probe.crawlTtfb = {
    p50: percentile(measured.map((m) => m.ms), 50),
    p90: percentile(measured.map((m) => m.ms), 90),
    slowest: [...measured].sort((a, b) => b.ms - a.ms).slice(0, 3),
  };
  const coverage: CrawlCoverage = opts.coverage ?? { navPages: pages.length, sitemapPages: 0, skippedByRobots: 0, stoppedEarly: null };
  probe.coverage = coverage;

  const crawled = new Set<string>();
  for (const p of pages) {
    crawled.add(dedupeKey(p.url));
    if (p.finalUrl) crawled.add(dedupeKey(p.finalUrl));
  }
  const okPages = pages.filter((p) => p.status >= 200 && p.status < 300);

  if (probe.blocked?.detected) {
    probe.sitemapSample = [];
    probe.canonicalTargets = probe.canonicalTargets ?? [];
    probe.brokenInternal = [];
    probe.brokenOutbound = [];
    // 一条也没查:分母为 0(计分侧按"样本不足"处理),不能让 [] 读成"查了、全部有效"
    probe.outboundChecked = 0;
    probe.largeImages = [];
    return probe;
  }

  /* ---- 同主机守卫:抓取已停 → 一律不发;补全途中被拦 → 记下原因,之后不再发 ---- */
  const crawlStopped = !!coverage.stoppedEarly;
  let halted: string | null = null;
  const sameHostAllowed = () => !crawlStopped && halted === null;
  /** 同主机请求:被拦(429 / 挑战 / WAF)就置停并返回 null —— 调用方把 null 当"这一项作废" */
  const sameHostFetch = async (url: string, o: SafeFetchOptions): Promise<FetchResult | null> => {
    if (!sameHostAllowed()) return null;
    const r = await fetcher(url, o);
    const b = detectBlock(r);
    if (b && isHardBlock(b.kind)) {
      halted ??= `${b.evidence} at ${pathOf(url)}`;
      return null;
    }
    return r;
  };
  const sameHostHeadOrGet = async (url: string, timeoutMs: number): Promise<FetchResult | null> => {
    const r = await sameHostFetch(url, { method: "HEAD", timeoutMs });
    if (r && needsGetFallback(r)) return sameHostFetch(url, { method: "GET", maxBytes: 4096, timeoutMs });
    return r;
  };

  /* ---- sitemap 抽样(不在抓取集合里的 ≤20 条) ---- */
  if (sameHostAllowed()) {
    const sitemapPool = cachedSitemapLocs(probe.sitemaps).filter((u) => {
      const n = normalizeUrl(u);
      return !!n && isSameSite(n, host) && !crawled.has(dedupeKey(n)) && !hasNonHtmlExtension(n) && isPathAllowed(robots, pathOf(n), DEFAULT_UA);
    });
    const sitemapPicks = evenSample(sitemapPool, SITEMAP_SAMPLE_SIZE);
    const sample = await pool(sitemapPicks, concurrency, deadline, async (url) => {
      const r = await sameHostFetch(url, { method: "GET", maxBytes: HEAD_ONLY_BODY });
      if (!r) return null;
      const parsed = parsePageDetailed(r.status === 200 && isHtmlResponse(r) ? r.body : "", r, 1, host).page;
      return {
        url,
        status: r.status || null,
        noindex: parsed.robotsNoindex === true,
        canonical: parsed.canonical,
        sameHost: r.status ? isSameSite(r.finalUrl, host) : true,
      };
    });
    if (halted === null) probe.sitemapSample = sample.filter((s): s is NonNullable<typeof s> => s !== null);
  }

  /* ---- canonical 目标(指向抓取集合之外的,去重 ≤10) ---- */
  if (sameHostAllowed()) {
    const existingTargets = new Set((probe.canonicalTargets ?? []).map((t) => dedupeKey(t.url)));
    const canonicalUrls: string[] = [];
    for (const p of okPages) {
      const c = p.canonical;
      if (!c) continue;
      const key = dedupeKey(c);
      if (crawled.has(key) || existingTargets.has(key)) continue;
      existingTargets.add(key);
      canonicalUrls.push(c);
      if (canonicalUrls.length >= CANONICAL_TARGETS_MAX) break;
    }
    const targets = await pool(canonicalUrls, concurrency, deadline, async (url) => {
      const r = isSameSite(url, host) ? await sameHostFetch(url, { method: "GET", maxBytes: HEAD_ONLY_BODY }) : await fetcher(url, { method: "GET", maxBytes: HEAD_ONLY_BODY });
      if (!r) return null;
      const parsed = parsePageDetailed(r.status === 200 && isHtmlResponse(r) ? r.body : "", r, 1, host).page;
      return { url, status: r.status || null, finalUrl: r.status ? r.finalUrl : null, noindex: parsed.robotsNoindex === true };
    });
    if (halted === null) probe.canonicalTargets = [...(probe.canonicalTargets ?? []), ...targets.filter((t): t is NonNullable<typeof t> => t !== null)];
  }

  /* ---- 失效内链:未抓取的内链目标 ≤30(按被引用次数排序),HEAD;401/403/429 不算死链 ---- */
  if (sameHostAllowed()) {
    const refs = new Map<string, { to: string; from: string[] }>();
    for (const p of okPages) {
      for (const link of p.links ?? []) {
        const key = dedupeKey(link);
        if (crawled.has(key)) continue;
        if (hasNonHtmlExtension(link) || !isSameSite(link, host)) continue;
        if (!isPathAllowed(robots, pathOf(link), DEFAULT_UA)) continue;
        const e = refs.get(key);
        if (e) {
          if (e.from.length < 3 && !e.from.includes(p.url)) e.from.push(p.url);
        } else refs.set(key, { to: link, from: [p.url] });
      }
    }
    const internalTargets = Array.from(refs.values())
      .sort((a, b) => b.from.length - a.from.length)
      .slice(0, BROKEN_INTERNAL_MAX);
    const brokenInternal: NonNullable<SiteProbe["brokenInternal"]> = [];
    await pool(internalTargets, concurrency, deadline, async (t) => {
      const r = await sameHostHeadOrGet(t.to, 8_000);
      if (!r || isAccessDenied(r.status)) return;
      if (r.status === 0 || r.status >= 400) for (const from of t.from) brokenInternal.push({ from, to: t.to, status: r.status || null });
    });
    if (halted === null) probe.brokenInternal = brokenInternal;
  }

  /* ---- 失效外链:≤30 条唯一外链,HEAD 5s;401/403/429 是对方拦爬虫,不是死链,不记(别的主机,抓取停了也照做)。
     v4:outboundChecked = 实际发出请求的外链数,是 brokenOutbound 的分母(quality.sources 按占比计分)——
     预算耗尽没来得及查的不算进去;被对方拦下的(401/403/429)查过了、只是不算死链,算进去。 ---- */
  const outbound = new Map<string, string>();
  for (const p of okPages) {
    for (const link of p.outboundLinks ?? []) {
      if (outbound.size >= BROKEN_OUTBOUND_MAX) break;
      if (!outbound.has(link)) outbound.set(link, p.url);
    }
    if (outbound.size >= BROKEN_OUTBOUND_MAX) break;
  }
  const brokenOutbound: NonNullable<SiteProbe["brokenOutbound"]> = [];
  let outboundChecked = 0;
  await pool(Array.from(outbound.entries()), concurrency, deadline, async ([to, from]) => {
    outboundChecked++;
    const r = await headOrGet(fetcher, to, OUTBOUND_TIMEOUT_MS);
    if (isAccessDenied(r.status)) return;
    if (r.status === 0 || r.status >= 400) brokenOutbound.push({ from, to, status: r.status || null });
  });
  probe.brokenOutbound = brokenOutbound;
  probe.outboundChecked = outboundChecked;

  /* ---- 大图:≤20 张,HEAD 看 Content-Length(抓取停了就整类不做,不拿部分图片下"没有大图"的结论) ---- */
  if (sameHostAllowed()) {
    const images: string[] = [];
    const imageSeen = new Set<string>();
    for (const p of okPages) {
      for (const u of p.imageUrls ?? []) {
        if (images.length >= LARGE_IMAGES_MAX) break;
        if (imageSeen.has(u)) continue;
        imageSeen.add(u);
        images.push(u);
      }
      if (images.length >= LARGE_IMAGES_MAX) break;
    }
    const largeImages: NonNullable<SiteProbe["largeImages"]> = [];
    await pool(images, concurrency, deadline, async (url) => {
      const r = isSameSite(url, host) ? await sameHostFetch(url, { method: "HEAD", timeoutMs: OUTBOUND_TIMEOUT_MS }) : await fetcher(url, { method: "HEAD", timeoutMs: OUTBOUND_TIMEOUT_MS });
      if (!r) return;
      const len = Number(r.headers.get("content-length"));
      if (r.status === 200 && Number.isFinite(len) && len > LARGE_IMAGE_BYTES) largeImages.push({ url, bytes: len });
    });
    if (halted === null) probe.largeImages = largeImages.sort((a, b) => b.bytes - a.bytes);
  }

  /* ---- og:image(探针没做时补) ---- */
  if (probe.ogImage === undefined && sameHostAllowed()) {
    const entry = pages.find((p) => p.depth === 0) ?? null;
    const og = entry?.og?.["og:image"];
    const abs = og ? normalizeUrl(og, entry?.finalUrl) : null;
    if (abs && Date.now() < deadline) {
      const r = isSameSite(abs, host) ? await sameHostHeadOrGet(abs, OUTBOUND_TIMEOUT_MS) : await headOrGet(fetcher, abs, OUTBOUND_TIMEOUT_MS);
      if (r) {
        const len = Number(r.headers.get("content-length"));
        probe.ogImage = { url: abs, status: r.status || null, bytes: Number.isFinite(len) && len > 0 ? len : null, contentType: r.contentType || null };
      }
    } else if (!abs) probe.ogImage = null;
  }

  if (halted !== null && !coverage.stoppedEarly) coverage.stoppedEarly = `${halted} — post-crawl checks stopped to stay polite`;
  return probe;
}

/* ---------- 一条龙 ---------- */

export interface ProbeAndCrawlOptions {
  maxPages: number;
  timeBudgetMs?: number;
  fetcher?: Fetcher;
  hostCheck?: (host: string) => Promise<void>;
  tlsCheck?: (host: string) => Promise<TlsCheck>;
  minIntervalMs?: number;
  concurrency?: number;
  onProgress?: (n: number) => void;
  enrichBudgetMs?: number;
}

/**
 * 探针 ∥ 抓取 → 补全。robots 只取一次,两边共用;sitemap 缓存由探针填、抓取的分层抽样读。
 * 补全沿用抓取实际的请求间隔(含 Crawl-delay)。
 */
export async function probeAndCrawl(entryUrl: string, opts: ProbeAndCrawlOptions): Promise<{ probe: ProbeResult; pages: CrawledPage[]; coverage: CrawlCoverage }> {
  const { origin, host } = normalizeInput(entryUrl);
  await (opts.hostCheck ?? assertPublicHost)(host);
  const base = opts.fetcher ?? safeFetch;
  const interval = opts.minIntervalMs ?? MIN_HOST_INTERVAL_MS;
  const robots = await fetchRobots(origin, politeFetcher(base, interval));
  const [probe, crawl] = await Promise.all([
    probeSite(entryUrl, { fetcher: base, hostCheck: opts.hostCheck, tlsCheck: opts.tlsCheck, robots, minIntervalMs: interval }),
    crawlSiteDetailed(entryUrl, {
      maxPages: opts.maxPages,
      robots,
      timeBudgetMs: opts.timeBudgetMs ?? 45_000,
      fetcher: base,
      concurrency: opts.concurrency,
      minIntervalMs: interval,
      onProgress: opts.onProgress,
    }),
  ]);
  const enriched = await enrichProbe(probe, crawl.pages, { fetcher: base, minIntervalMs: crawl.intervalMs, coverage: crawl.coverage, timeBudgetMs: opts.enrichBudgetMs });
  return { probe: enriched, pages: crawl.pages, coverage: crawl.coverage };
}
