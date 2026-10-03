import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import {
  GscError,
  searchAnalyticsQuery,
  type FetchLike,
  type GscSite,
  type SearchAnalyticsBody,
  type SearchAnalyticsRow,
} from "@/lib/google/search-console";
import { safeFetch, type FetchResult } from "./fetch";
import { registrableDomain } from "./url";
import type { GscData, GscPageRow, GscQueryRow } from "./types";

/* ============================================================
   Search Console 数据 → GscData(规格 v2 §3.6)+ 站点控制权证明 + 绑定协议的纯决策函数 + GET 视图

   本文件**不碰数据库**(数据库读写在 gsc-repo.ts):pullGscData 只发 Google 的只读请求,
   站点证明只读首页与 DNS,其余全是纯函数,离线可测;运维脚本可以在不连库的情况下拉一份真实数据核对。
   只能在服务端用(node:crypto / node:dns / 凭据);前端组件只许 `import type`。

   取数口径:
   - 时间窗 = 截止"3 天前"的 28 天(GSC 数据有 2–3 天延迟,含最近几天会让本期系统性偏低、动量偏负),
     对比期 = 紧挨着的前 28 天。日期按太平洋时间算 —— Search Console 的日历就是 PT。
   - Google 返回的行**按点击数降序**,点击相同的行顺序任意。所以"按曝光取前 100"不能只要 200 行:
     对点击很少的站,前 200 行在零点击行里是随机的。这里多取(query / page 各 1000 行,query+page 5000 行),
     本地再按曝光排序截断。请求次数不变(仍是 5 次),只是响应大一些。
   - 自蚕食(cannibalized):同一 query 下 ≥2 个页面各占该 query 曝光 ≥10%,且 query 曝光 ≥20。
     **品牌词不算**:品牌词下首页 + 定价页 + 博客同时出现是 sitelinks,不是"一个意图两页"。
   - URL 里的 #片段 合并到同一页(跳转链接 / 精选摘要的 #:~:text= 是同一个页面)。
   ============================================================ */

const DAY_MS = 86_400_000;
export const GSC_LAG_DAYS = 3;
export const GSC_RANGE_DAYS = 28;
export const GSC_MAX_QUERIES = 100;
export const GSC_MAX_PAGES = 100;
export const GSC_MAX_CANNIBALIZED = 30;
/** 自蚕食组里每个 query 最多列几页(证据够用即可,报告是公开链接) */
const MAX_PAGES_PER_GROUP = 5;
export const GSC_CANNIBAL_MIN_IMPRESSIONS = 20;
/** 每页至少占该 query 曝光的 1/10(用整数比较 impressions × 10 ≥ total,避免浮点边界) */
const CANNIBAL_SHARE_DENOMINATOR = 10;
export const GSC_QUERY_ROW_LIMIT = 1000;
export const GSC_PAGE_ROW_LIMIT = 1000;
export const GSC_QUERY_PAGE_ROW_LIMIT = 5000;

/* ============================================================
   属性匹配
   ============================================================ */

/**
 * 某个属性对 domain 的优先级(数字越小越优先;不匹配 = null):
 *   0 sc-domain:domain(域名属性覆盖全部子域与协议,数据最全)
 *   1 sc-domain:www.domain(少见的写法)
 *   10+ URL 前缀属性,主机必须是 domain 或 www.domain:http +4、子目录 +2、不是首选主机 +1。
 * 父域的域名属性(审计 blog.x.com、属性 sc-domain:x.com)**不匹配**:那会把整个 x.com 的数据
 * 绑到一个子域的报告上,而绑定协议是按报告的 domain 记的。
 */
function propertyRank(siteUrl: string, domain: string, preferHost: string): number | null {
  const lower = siteUrl.trim().toLowerCase();
  if (lower.startsWith("sc-domain:")) {
    const host = lower.slice("sc-domain:".length).replace(/\.$/, "");
    if (host === domain) return 0;
    if (host === `www.${domain}`) return 1;
    return null;
  }
  let u: URL;
  try {
    u = new URL(siteUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== domain && host !== `www.${domain}`) return null;
  let rank = 10;
  if (u.protocol === "http:") rank += 4;
  if (u.pathname !== "/") rank += 2;
  if (host !== preferHost) rank += 1;
  return rank;
}

/**
 * 在服务账号能看到的属性里找与 domain 匹配的那个:sc-domain 优先,其次 URL 前缀(www / 裸域)。
 * siteUnverifiedUser = 列表里有但其实没有访问权(属性所有者已失去验证),一律跳过。
 * preferHost:报告入口 URL 的主机名 —— 同时有 www 与裸域两个 URL 前缀属性时,选站点实际用的那个。
 */
export function matchProperty(domain: string, sites: GscSite[], opts: { preferHost?: string } = {}): string | null {
  const d = registrableDomain(domain || "");
  if (!d) return null;
  const preferHost = (opts.preferHost || d).trim().toLowerCase().replace(/\.$/, "");
  let best: { siteUrl: string; rank: number } | null = null;
  for (const s of sites ?? []) {
    if (!s || typeof s.siteUrl !== "string" || !s.siteUrl) continue;
    if (s.permissionLevel === "siteUnverifiedUser") continue;
    const rank = propertyRank(s.siteUrl, d, preferHost);
    if (rank === null) continue;
    if (!best || rank < best.rank || (rank === best.rank && s.siteUrl < best.siteUrl)) best = { siteUrl: s.siteUrl, rank };
  }
  return best ? best.siteUrl : null;
}

/* ============================================================
   时间窗
   ============================================================ */

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** now 在太平洋时间是哪一天(Search Console 的日期口径);Intl 不可用时退回 UTC */
function pacificDayStartMs(now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const y = get("year");
    const m = get("month");
    const d = get("day");
    if (y && m && d) return Date.UTC(y, m - 1, d);
  } catch {
    /* 退回 UTC */
  }
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** 本期 = 截止 3 天前的 28 天(含首尾);对比期 = 紧挨着的前 28 天 */
export function gscRanges(now: Date): { range: { from: string; to: string }; previousRange: { from: string; to: string } } {
  const today = pacificDayStartMs(now);
  const to = today - GSC_LAG_DAYS * DAY_MS;
  const from = to - (GSC_RANGE_DAYS - 1) * DAY_MS;
  const prevTo = from - DAY_MS;
  const prevFrom = prevTo - (GSC_RANGE_DAYS - 1) * DAY_MS;
  return { range: { from: isoDay(from), to: isoDay(to) }, previousRange: { from: isoDay(prevFrom), to: isoDay(prevTo) } };
}

/* ============================================================
   品牌词
   ============================================================ */

/** 二级公共后缀(co.uk / com.au …)下品牌标签在倒数第三段 —— 与 ranking.ts domainLabel、dataforseo.ts brandLabel 同一口径 */
const SECOND_LEVEL_SUFFIX = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

/** 可注册域去掉后缀后的品牌标签:aeoeye.com → aeoeye;my-brand.co.uk → my-brand */
export function gscBrandLabel(domain: string): string {
  const parts = registrableDomain(domain || "").split(".").filter(Boolean);
  if (parts.length >= 3 && SECOND_LEVEL_SUFFIX.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * query 是不是品牌词:包含品牌标签,或去掉空格 / 符号后包含紧凑形式("aeo eye" → aeoeye,"my brand" → my-brand)。
 * 标签短于 3 个字符(hp.com)时只认整词,否则 "go" 会把 "google" 判成品牌词。
 * 品牌词点击率天然很高,behavior.ctr 必须把它们排除,否则任何有名气的站都"超出预期"。
 */
export function isBrandQuery(query: string, label: string): boolean {
  const l = (label || "").toLowerCase();
  const compactLabel = l.replace(/[^a-z0-9]/g, "");
  if (!l || !compactLabel) return false;
  const q = (query || "").toLowerCase();
  if (compactLabel.length < 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(l)}([^a-z0-9]|$)`).test(q);
  }
  if (q.includes(l)) return true;
  return q.replace(/[^a-z0-9]/g, "").includes(compactLabel);
}

/* ============================================================
   汇总(纯函数)
   ============================================================ */

/** pullGscData 拿到的原始行;null = 那次请求失败(可选数据,写 note 不抛) */
export interface GscRawRows {
  /** 无维度的本期合计(通常 1 行;没数据 = 空数组) */
  totals: SearchAnalyticsRow[];
  /** 无维度的对比期合计;null = 请求失败 */
  previousTotals: SearchAnalyticsRow[] | null;
  /** dimensions: ["query"] */
  queries: SearchAnalyticsRow[];
  /** dimensions: ["page"] */
  pages: SearchAnalyticsRow[];
  /** dimensions: ["query", "page"];null = 请求失败 */
  queryPages: SearchAnalyticsRow[] | null;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((Number.isFinite(n) ? n : 0) * f) / f;
}

/** 同一页的 #片段 变体合并(跳转链接 / #:~:text=) */
function pageKey(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

interface Agg {
  clicks: number;
  impressions: number;
  /** Σ position × impressions(合并变体时按曝光加权平均名次) */
  posWeight: number;
}

function addTo(map: Map<string, Agg>, key: string, r: SearchAnalyticsRow): void {
  const a = map.get(key) ?? { clicks: 0, impressions: 0, posWeight: 0 };
  a.clicks += r.clicks;
  a.impressions += r.impressions;
  a.posWeight += r.position * r.impressions;
  map.set(key, a);
}

function metrics(a: Agg): { clicks: number; impressions: number; ctr: number; position: number } {
  const impressions = Math.round(a.impressions);
  return {
    clicks: Math.round(a.clicks),
    impressions,
    ctr: impressions > 0 ? round(a.clicks / a.impressions, 4) : 0,
    position: impressions > 0 ? round(a.posWeight / a.impressions, 1) : 0,
  };
}

function totalsOf(rows: SearchAnalyticsRow[]): GscData["totals"] {
  if (!rows.length) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  if (rows.length === 1) {
    const r = rows[0];
    return { clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: round(r.ctr, 4), position: round(r.position, 1) };
  }
  const agg: Agg = { clicks: 0, impressions: 0, posWeight: 0 };
  for (const r of rows) {
    agg.clicks += r.clicks;
    agg.impressions += r.impressions;
    agg.posWeight += r.position * r.impressions;
  }
  return metrics(agg);
}

/** query → (页面 → 汇总);跳过 0 曝光行 */
function groupQueryPages(rows: SearchAnalyticsRow[]): Map<string, Map<string, Agg>> {
  const out = new Map<string, Map<string, Agg>>();
  for (const r of rows) {
    const query = r.keys[0];
    const page = r.keys[1];
    if (!query || !page || !(r.impressions > 0)) continue;
    let pages = out.get(query);
    if (!pages) out.set(query, (pages = new Map()));
    addTo(pages, pageKey(page), r);
  }
  return out;
}

/** 自蚕食组(纯函数,单独导出给测试):阈值见文件头 */
export function findCannibalized(queryPages: SearchAnalyticsRow[], brandLabel: string): GscData["cannibalized"] {
  const groups: GscData["cannibalized"] = [];
  for (const [query, pages] of groupQueryPages(queryPages)) {
    if (isBrandQuery(query, brandLabel)) continue;
    let total = 0;
    for (const a of pages.values()) total += a.impressions;
    if (total < GSC_CANNIBAL_MIN_IMPRESSIONS) continue;
    const strong = [...pages.entries()]
      .filter(([, a]) => a.impressions * CANNIBAL_SHARE_DENOMINATOR >= total)
      .sort((x, y) => y[1].impressions - x[1].impressions || y[1].clicks - x[1].clicks || (x[0] < y[0] ? -1 : 1));
    if (strong.length < 2) continue;
    groups.push({
      query,
      impressions: Math.round(total),
      pages: strong.slice(0, MAX_PAGES_PER_GROUP).map(([page, a]) => ({ page, clicks: Math.round(a.clicks), impressions: Math.round(a.impressions) })),
    });
  }
  groups.sort((a, b) => b.impressions - a.impressions || (a.query < b.query ? -1 : 1));
  return groups.slice(0, GSC_MAX_CANNIBALIZED);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * 原始行 → GscData。纯函数:给定 now 与原始行,输出完全确定(排序带稳定的次级键)。
 * queries / pages 按曝光降序各 ≤100;zeroClickPages 用全部已取回的页面行算(不只前 100)。
 */
export function summarizeGsc(args: { property: string; domain: string; now: Date; raw: GscRawRows; notes?: string[] }): GscData {
  const { property, domain, now, raw } = args;
  const { range, previousRange } = gscRanges(now);
  const label = gscBrandLabel(domain);
  const notes = [...(args.notes ?? [])];

  const totals = totalsOf(raw.totals);
  const previous = raw.previousTotals && raw.previousTotals.length ? totalsOf(raw.previousTotals) : null;

  const qp = raw.queryPages ? groupQueryPages(raw.queryPages) : null;

  const queries: GscQueryRow[] = raw.queries
    .filter((r) => r.keys[0] && r.impressions > 0)
    .map((r) => {
      const query = r.keys[0];
      const pageCount = qp?.get(query)?.size ?? 0;
      return {
        query,
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        ctr: round(r.ctr, 4),
        position: round(r.position, 1),
        // 有曝光就至少有一页;query+page 明细缺失或被截断时按 1 记
        pages: Math.max(1, pageCount),
        brand: isBrandQuery(query, label),
      };
    })
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || (a.query < b.query ? -1 : 1))
    .slice(0, GSC_MAX_QUERIES);

  const pageMap = new Map<string, Agg>();
  for (const r of raw.pages) {
    if (!r.keys[0] || !(r.impressions > 0)) continue;
    addTo(pageMap, pageKey(r.keys[0]), r);
  }
  const allPages: GscPageRow[] = [...pageMap.entries()].map(([page, a]) => ({ page, ...metrics(a) }));
  const zeroClickPages = { count: allPages.filter((p) => p.clicks === 0).length, total: allPages.length };
  const pages = allPages
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || (a.page < b.page ? -1 : 1))
    .slice(0, GSC_MAX_PAGES);

  const cannibalized = raw.queryPages ? findCannibalized(raw.queryPages, label) : [];

  /* ---- notes(UI 直接显示,英文) ---- */
  if (totals.impressions === 0) {
    notes.push(`Search Console recorded no Google Search impressions for ${property} between ${range.from} and ${range.to}.`);
  }
  if (!previous && raw.previousTotals) {
    notes.push(`No Search Console data for ${previousRange.from} – ${previousRange.to}, so there is no earlier period to compare against yet.`);
  }
  if (!raw.queryPages) {
    notes.push("The query-by-page breakdown could not be loaded, so page cannibalisation was not measured from Search Console.");
  }
  if (raw.queries.length >= GSC_QUERY_ROW_LIMIT) {
    notes.push(`This site has more than ${GSC_QUERY_ROW_LIMIT.toLocaleString("en-US")} search queries; the query table shows the top ${GSC_MAX_QUERIES} by impressions among the ${GSC_QUERY_ROW_LIMIT.toLocaleString("en-US")} with the most clicks.`);
  } else if (totals.clicks >= 20) {
    // Google 出于隐私隐藏低频 query:列出的 query 加起来通常不到总点击。差得多时要说清楚,否则读者会以为表是全量
    const listed = raw.queries.reduce((s, r) => s + r.clicks, 0);
    const share = listed / totals.clicks;
    if (share < 0.8) notes.push(`Google hides rare searches for privacy: the queries listed here account for ${pct(share)} of your clicks.`);
  }

  return {
    property,
    fetchedAt: now.toISOString(),
    range,
    previousRange,
    totals,
    previous,
    queries,
    pages,
    cannibalized,
    zeroClickPages,
    notes,
  };
}

/* ============================================================
   拉取(只读;5 次 searchAnalytics.query 并发,免费)
   ============================================================ */

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 拉一份 GscData。本期合计 / 按 query / 按 page 是核心数据,任一失败就抛(GscError,调用方决定文案);
 * 对比期合计与 query+page 明细是可选数据,失败只写 note(动量 / 自蚕食退回无 GSC 的算法)。
 */
export async function pullGscData(
  property: string,
  domain: string,
  opts: { now?: Date; fetchImpl?: FetchLike } = {}
): Promise<GscData> {
  const now = opts.now ?? new Date();
  const { range, previousRange } = gscRanges(now);
  const current = { startDate: range.from, endDate: range.to };
  const call = (body: SearchAnalyticsBody) => searchAnalyticsQuery(property, { type: "web", ...body }, { fetchImpl: opts.fetchImpl });

  const [totals, queries, pages, queryPages, previousTotals] = await Promise.allSettled([
    call({ ...current }),
    call({ ...current, dimensions: ["query"], rowLimit: GSC_QUERY_ROW_LIMIT }),
    call({ ...current, dimensions: ["page"], rowLimit: GSC_PAGE_ROW_LIMIT }),
    call({ ...current, dimensions: ["query", "page"], rowLimit: GSC_QUERY_PAGE_ROW_LIMIT }),
    call({ startDate: previousRange.from, endDate: previousRange.to }),
  ]);
  if (totals.status === "rejected") throw totals.reason;
  if (queries.status === "rejected") throw queries.reason;
  if (pages.status === "rejected") throw pages.reason;

  const notes: string[] = [];
  if (previousTotals.status === "rejected") {
    notes.push(`Totals for ${previousRange.from} – ${previousRange.to} could not be loaded (${reason(previousTotals.reason)}), so momentum falls back to keyword movement.`);
  }
  if (queryPages.status === "rejected") {
    console.warn(`[gsc] query+page breakdown failed for ${property}: ${reason(queryPages.reason)}`);
  }

  return summarizeGsc({
    property,
    domain,
    now,
    notes,
    raw: {
      totals: totals.value,
      previousTotals: previousTotals.status === "fulfilled" ? previousTotals.value : null,
      queries: queries.value,
      pages: pages.value,
      queryPages: queryPages.status === "fulfilled" ? queryPages.value : null,
    },
  });
}


/**
 * run.ts / 路由用:这次拉取失败是不是"服务账号已经没有这个属性的权限"(站长在 GSC 里移除了我们 / 属性没了)。
 * 是 → 不该再沿用旧数据(授权已撤回);其余(超时、5xx、配额)是临时故障,可以沿用上一份。
 */
export function gscAccessLost(e: unknown): boolean {
  return e instanceof GscError && (e.code === "forbidden" || e.code === "not_found");
}

/* ============================================================
   站点控制权证明(集成方 2026-10-02 安全修订)

   为什么需要:服务账号对属性的访问权是**全局**的 —— 站长把它加进自己的 Search Console 之后,
   任何买了同域名报告的人都能"看到属性"。所以光有访问权不够,还要证明"我能改这个站":
   每次接入申请生成一个独有 token,放进首页 <head> 的 <meta name="aeoeye-site-verification">,
   或者放进可注册域的 DNS TXT 记录 —— 与 Google 自己的站点所有权验证同一个思路。
   两样都满足才算验证通过;谁证明了谁就通过(站长 + 代理商可以各自接入),与先后顺序无关。

   为什么只看首页(不看报告的入口 URL):入口 URL 是买报告的人自己填的,可以带路径和查询串 ——
   站点上任何一个开放跳转(/redirect?to=…)都能把检查引到他自己控制的页面。首页由站长决定,
   而且跳转结束后主机必须仍在被认领的域名(或其子域)上。
   只认 <head> 里真正的 <meta> 元素:注释、<script>/<style>/<title> 等原始文本里的字样,以及 <body>
   里任何内容(评论区、用户资料页能写进去的东西)一律不算。
   ============================================================ */

export const SITE_TOKEN_META_NAME = "aeoeye-site-verification";
/** "aeo-" + 12 字节随机数的 base64url(16 个字符) */
const SITE_TOKEN_RE = /^aeo-[A-Za-z0-9_-]{16}$/;
export const SITE_HOME_TIMEOUT_MS = 8_000;
export const SITE_HOME_MAX_BYTES = 2 * 1024 * 1024;
export const SITE_DNS_TIMEOUT_MS = 5_000;

/** 每次接入申请独有的 token(96 位随机) */
export function newSiteToken(): string {
  return `aeo-${randomBytes(12).toString("base64url")}`;
}

export function isSiteToken(v: unknown): v is string {
  return typeof v === "string" && SITE_TOKEN_RE.test(v);
}

/** 要粘进首页 <head> 的那一行(UI 原样展示、一键复制) */
export function siteTokenMetaTag(token: string): string {
  return `<meta name="${SITE_TOKEN_META_NAME}" content="${token}">`;
}

/** DNS 方案:可注册域上的 TXT 记录值 */
export function siteTokenDnsTxt(token: string): string {
  return `${SITE_TOKEN_META_NAME}=${token}`;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** 一个标签里的属性:名字小写;值支持双引号 / 单引号 / 不带引号;重复属性以第一个为准(HTML 规范) */
function parseAttributes(s: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of s.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return out;
}

/**
 * 首页 HTML 的 <head> 里有没有 <meta name="aeoeye-site-verification" content="TOKEN">。
 * name 不分大小写、属性顺序与引号形式不限;token 必须完全一致(区分大小写)。
 * 先去掉注释与原始文本元素(script / style / title / noscript / template / textarea …),再截到 </head> 或 <body 为止。
 */
export function htmlHasSiteToken(html: string, token: string): boolean {
  if (!html || !isSiteToken(token)) return false;
  const cleaned = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(script|style|title|noscript|template|textarea|xmp|iframe|noembed|noframes)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const ends = [cleaned.search(/<\/head\s*>/i), cleaned.search(/<body[\s>/]/i)].filter((i) => i >= 0);
  const head = ends.length ? cleaned.slice(0, Math.min(...ends)) : cleaned;
  for (const m of head.matchAll(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = parseAttributes(m[1]);
    if ((attrs.get("name") ?? "").trim().toLowerCase() !== SITE_TOKEN_META_NAME) continue;
    if ((attrs.get("content") ?? "").trim() === token) return true;
  }
  return false;
}

/**
 * resolveTxt 的结果里有没有 aeoeye-site-verification=TOKEN。
 * 一条 TXT 记录可能被拆成多段(每段 ≤255 字符),先拼回整条;前缀不分大小写,token 区分大小写。
 */
export function txtRecordsHaveToken(records: string[][], token: string): boolean {
  if (!isSiteToken(token)) return false;
  for (const chunks of records ?? []) {
    const value = (Array.isArray(chunks) ? chunks.join("") : String(chunks)).trim().replace(/^"|"$/g, "");
    const eq = value.indexOf("=");
    if (eq < 0) continue;
    if (value.slice(0, eq).trim().toLowerCase() !== SITE_TOKEN_META_NAME) continue;
    if (value.slice(eq + 1).trim() === token) return true;
  }
  return false;
}

export type ResolveTxt = (host: string) => Promise<string[][]>;

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${what} timed out`), { code: "ETIMEOUT" })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function defaultResolveTxt(timeoutMs: number): ResolveTxt {
  // 每次一个 Resolver:超时与重试只作用于这一次查询;外层 timeout() 再兜一层总时长
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  return (host) => resolver.resolveTxt(host);
}

/** 可注册域的 TXT 记录里有没有本次 token。永不抛 */
export async function dnsHasSiteToken(
  domain: string,
  token: string,
  opts: { resolveTxt?: ResolveTxt; timeoutMs?: number } = {}
): Promise<{ found: boolean; detail: string }> {
  const host = registrableDomain(domain || "");
  if (!host) return { found: false, detail: "no domain to look up" };
  const timeoutMs = opts.timeoutMs ?? SITE_DNS_TIMEOUT_MS;
  const resolve = opts.resolveTxt ?? defaultResolveTxt(timeoutMs);
  try {
    const records = await timeout(resolve(host), timeoutMs, "DNS lookup");
    return txtRecordsHaveToken(records, token)
      ? { found: true, detail: `TXT record found on ${host}` }
      : { found: false, detail: `no matching TXT record on ${host}` };
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    if (code === "ENODATA" || code === "ENOTFOUND") return { found: false, detail: `no TXT records on ${host}` };
    if (code === "ETIMEOUT") return { found: false, detail: `DNS lookup for ${host} timed out` };
    return { found: false, detail: `DNS lookup for ${host} failed${typeof code === "string" ? ` (${code})` : ""}` };
  }
}

/** 首页抓取的最小接口(生产 = safeFetch;测试注入) */
export type FetchPage = (url: string) => Promise<Pick<FetchResult, "status" | "finalUrl" | "body" | "error">>;

function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** 主机是被认领的域名本身或它的子域(www、地区子域…) */
function onClaimedSite(url: string, domain: string): boolean {
  const host = hostOfUrl(url);
  return !!host && (host === domain || host.endsWith(`.${domain}`));
}

/**
 * 要检查的首页:报告入口的协议 + 主机的根路径,再加 www / 裸域的另一种写法(最多 2 个)。
 * 刻意只取根路径,不取入口 URL 的路径与查询串(见本节开头:开放跳转)。
 */
export function homepageCandidates(entryUrl: string, domain: string): string[] {
  const d = registrableDomain(domain || "");
  if (!d) return [];
  let protocol = "https:";
  let host = d;
  try {
    const u = new URL(entryUrl);
    const h = u.hostname.toLowerCase().replace(/\.$/, "");
    if ((u.protocol === "https:" || u.protocol === "http:") && (h === d || h === `www.${d}`)) {
      protocol = u.protocol;
      host = h;
    }
  } catch {
    /* 入口 URL 坏了就从裸域开始 */
  }
  const alt = host === d ? `www.${d}` : d;
  return [...new Set([`${protocol}//${host}/`, `${protocol}//${alt}/`])];
}

/** 首页 <head> 里有没有本次 token。永不抛 */
export async function homepageHasSiteToken(
  args: { domain: string; entryUrl: string; token: string },
  opts: { fetchPage?: FetchPage } = {}
): Promise<{ found: boolean; url: string | null; detail: string }> {
  const d = registrableDomain(args.domain || "");
  const fetchPage: FetchPage =
    opts.fetchPage ?? ((url) => safeFetch(url, { timeoutMs: SITE_HOME_TIMEOUT_MS, maxBytes: SITE_HOME_MAX_BYTES }));
  let detail = "the homepage could not be checked";
  for (const url of homepageCandidates(args.entryUrl, d)) {
    let res: Awaited<ReturnType<FetchPage>>;
    try {
      res = await fetchPage(url);
    } catch (e) {
      detail = `${url} could not be fetched (${e instanceof Error ? e.message : String(e)})`;
      continue;
    }
    if (!res.status || res.error) {
      detail = `${url} could not be fetched${res.error ? ` (${res.error})` : ""}`;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      detail = `${url} returned HTTP ${res.status}`;
      continue;
    }
    if (!onClaimedSite(res.finalUrl || url, d)) {
      detail = `${url} redirects away from ${d} (to ${hostOfUrl(res.finalUrl) ?? "another site"})`;
      continue;
    }
    if (htmlHasSiteToken(res.body, args.token)) return { found: true, url: res.finalUrl || url, detail: `meta tag found on ${res.finalUrl || url}` };
    detail = `the meta tag is not in the <head> of ${res.finalUrl || url}`;
  }
  return { found: false, url: null, detail };
}

export interface SiteControlProof {
  found: boolean;
  via: "meta" | "dns" | null;
  /** 没找到时说清楚看了哪里(只含 URL / 状态码 / 主机名,可以给用户看) */
  detail: string;
}

/** 站点控制权:首页 meta 或 DNS TXT 任一命中即可(两者并行查)。永不抛 */
export async function checkSiteControl(
  args: { domain: string; entryUrl: string; token: string },
  deps: { fetchPage?: FetchPage; resolveTxt?: ResolveTxt } = {}
): Promise<SiteControlProof> {
  if (!isSiteToken(args.token)) return { found: false, via: null, detail: "this connection request has no valid verification token" };
  const [meta, dns] = await Promise.all([
    homepageHasSiteToken(args, { fetchPage: deps.fetchPage }),
    dnsHasSiteToken(args.domain, args.token, { resolveTxt: deps.resolveTxt }),
  ]);
  if (meta.found) return { found: true, via: "meta", detail: meta.detail };
  if (dns.found) return { found: true, via: "dns", detail: dns.detail };
  return { found: false, via: null, detail: `${meta.detail}; ${dns.detail}` };
}

/* ============================================================
   绑定协议 —— 纯决策函数(gsc-repo.ts 负责读写 seo_gsc_claims)

   claim 状态:pending(已发 token,7 天内有效)→ verified(token 在站上 + 服务账号能访问匹配属性)→
   revoked(本人断开 / 取消,或刷新时发现属性已不可访问)。没有冲突状态:谁证明了站点控制权谁就通过,
   同一 domain 可以有多个 verified(站长 + 代理商)。
   verified 之后只看"属性是否仍可访问"(每次刷新都查),**不再**查 token —— 站长验证完删掉 meta 标签是常态
   (Google 的站点验证也一样)。
   ============================================================ */

export const GSC_INTENT_TTL_MS = 7 * DAY_MS;

/** UI 状态:revoked = 曾经接通、后来被断开 / 失去权限;从没接通过的取消或过期 = none */
export type GscClaimState = "none" | "pending" | "verified" | "revoked";

/** 决策只需要的 claim 字段(与 seo_gsc_claims 行同名) */
export interface ClaimFacts {
  id: string;
  userId: string;
  auditId: string;
  /** pending | verified | revoked(旧数据里可能有 conflict,视同失效) */
  status: string;
  createdAt: Date;
  verifiedAt?: Date | null;
  token?: string | null;
}

function newestFirst(a: ClaimFacts, b: ClaimFacts): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
}

function oldestFirst(a: ClaimFacts, b: ClaimFacts): number {
  return -newestFirst(a, b);
}

/** 有效的 pending:有合法 token、7 天内 */
export function isLivePending(c: ClaimFacts, now: Date): boolean {
  return c.status === "pending" && isSiteToken(c.token) && now.getTime() - c.createdAt.getTime() <= GSC_INTENT_TTL_MS;
}

/**
 * 本用户在这份报告上"当前那条" claim 与它对应的 UI 状态。
 * 有效的 pending 取**最早**那条:连点两次 Connect 并发建了两行时,两次响应、GET 与 Verify 看到的都是同一个 token。
 */
export function activeClaim(ownClaims: ClaimFacts[], auditId: string, now: Date): { claim: ClaimFacts | null; state: GscClaimState } {
  const here = ownClaims.filter((c) => c.auditId === auditId);
  const verified = here.filter((c) => c.status === "verified").sort(newestFirst)[0];
  if (verified) return { claim: verified, state: "verified" };
  const pending = here.filter((c) => isLivePending(c, now)).sort(oldestFirst)[0];
  if (pending) return { claim: pending, state: "pending" };
  const latest = [...here].sort(newestFirst)[0];
  if (latest && latest.status === "revoked" && latest.verifiedAt) return { claim: latest, state: "revoked" };
  return { claim: null, state: "none" };
}

export function claimStateFor(ownClaims: ClaimFacts[], auditId: string, now: Date): GscClaimState {
  return activeClaim(ownClaims, auditId, now).state;
}

export type IntentDecision = { action: "reuse"; claimId: string; state: "pending" | "verified" } | { action: "create" };

/** 发起接入:这份报告上已有自己的 verified / 有效 pending → 原样返回(幂等);否则新建(新 token)。没有拒绝分支 */
export function decideIntent(args: { auditId: string; ownClaims: ClaimFacts[]; now: Date }): IntentDecision {
  const { claim, state } = activeClaim(args.ownClaims, args.auditId, args.now);
  if (claim && (state === "verified" || state === "pending")) return { action: "reuse", claimId: claim.id, state };
  return { action: "create" };
}

export type VerificationTarget =
  | { kind: "refuse"; code: "no_intent" | "expired" }
  /** pending:要 token 证明 + 属性访问权 */
  | { kind: "prove"; claimId: string }
  /** 已 verified 再点 = 重新同步:只看属性访问权,不再查 token */
  | { kind: "resync"; claimId: string };

export function verificationTarget(args: { auditId: string; ownClaims: ClaimFacts[]; now: Date }): VerificationTarget {
  const { claim, state } = activeClaim(args.ownClaims, args.auditId, args.now);
  if (claim && state === "verified") return { kind: "resync", claimId: claim.id };
  if (claim && state === "pending") return { kind: "prove", claimId: claim.id };
  const latest = args.ownClaims.filter((c) => c.auditId === args.auditId).sort(newestFirst)[0];
  if (latest && latest.status === "pending" && isSiteToken(latest.token)) return { kind: "refuse", code: "expired" };
  return { kind: "refuse", code: "no_intent" };
}

export type VerifyDecision =
  | { action: "verify" }
  | { action: "refuse"; code: "token_not_found" | "no_property_access" }
  /** 重新同步时属性已不可访问:verified → revoked,报告里的数据撤掉 */
  | { action: "revoke" };

/**
 * prove:token 证明与属性访问权**都**要有(先报 token —— 它是 UI 的第一步);
 * resync:只看访问权,没有就撤销。
 */
export function decideVerification(args: { kind: "prove" | "resync"; siteProof: boolean; hasAccess: boolean }): VerifyDecision {
  if (args.kind === "resync") return args.hasAccess ? { action: "verify" } : { action: "revoke" };
  if (!args.siteProof) return { action: "refuse", code: "token_not_found" };
  if (!args.hasAccess) return { action: "refuse", code: "no_property_access" };
  return { action: "verify" };
}

/* ============================================================
   GET 视图(纯函数)—— 服务账号邮箱、token、meta 标签与 DNS 记录**只**在本人的 claim 是 pending / verified 时下发:
   先拿到 token 才看得到要授权的邮箱,站长就不会"先授权、后申请",顺序问题从界面上就堵住了。
   ============================================================ */

export interface GscInstructions {
  serviceAccountEmail: string;
  token: string;
  metaTag: string;
  dnsTxt: string;
  /** pending 的过期时间;verified 为 null */
  expiresAt: string | null;
}

export function gscInstructions(email: string | null, claim: ClaimFacts | null, state: GscClaimState): GscInstructions | null {
  if (!email || !claim || !isSiteToken(claim.token) || (state !== "pending" && state !== "verified")) return null;
  return {
    serviceAccountEmail: email,
    token: claim.token,
    metaTag: siteTokenMetaTag(claim.token),
    dnsTxt: siteTokenDnsTxt(claim.token),
    expiresAt: state === "pending" ? new Date(claim.createdAt.getTime() + GSC_INTENT_TTL_MS).toISOString() : null,
  };
}

export interface GscStatusView {
  /** 这份报告已并入 Search Console 数据(只在已解锁时为真) */
  connected: boolean;
  property: string | null;
  state: GscClaimState;
  signedIn: boolean;
  canConnect: boolean;
  serviceAccountEmail: string | null;
  token: string | null;
  metaTag: string | null;
  dnsTxt: string | null;
  expiresAt: string | null;
  /** canConnect 为假时的一句原因(英文 UI 文案) */
  reason?: string;
}

export function gscStatusView(input: {
  auditId: string;
  unlocked: boolean;
  /** seo_audits.user_id;匿名购买为 null */
  ownerUserId: string | null;
  viewerUserId: string | null;
  configured: boolean;
  serviceAccountEmail: string | null;
  gscProperty: string | null;
  /** 当前用户在这份报告上的 claim(未登录传空数组) */
  ownClaims: ClaimFacts[];
  now: Date;
}): GscStatusView {
  const signedIn = !!input.viewerUserId;
  const ownerOk = signedIn && (!input.ownerUserId || input.ownerUserId === input.viewerUserId);
  const canConnect = signedIn && input.unlocked && ownerOk && input.configured;
  const { claim, state } = ownerOk ? activeClaim(input.ownClaims, input.auditId, input.now) : { claim: null, state: "none" as const };
  const reveal = canConnect ? gscInstructions(input.serviceAccountEmail, claim, state) : null;
  const reason = !input.configured
    ? "Search Console connection isn't available right now."
    : !input.unlocked
      ? "Unlock the full report to connect Search Console."
      : !signedIn
        ? "Sign in to connect Search Console."
        : !ownerOk
          ? "Only the account that owns this report can connect Search Console."
          : undefined;
  return {
    connected: input.unlocked && !!input.gscProperty,
    property: input.unlocked ? input.gscProperty : null,
    state,
    signedIn,
    canConnect,
    serviceAccountEmail: reveal?.serviceAccountEmail ?? null,
    token: reveal?.token ?? null,
    metaTag: reveal?.metaTag ?? null,
    dnsTxt: reveal?.dnsTxt ?? null,
    expiresAt: reveal?.expiresAt ?? null,
    ...(reason ? { reason } : {}),
  };
}
