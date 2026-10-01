import { env } from "@/lib/env";
import { recordDataForSeoCost } from "@/lib/cost";
import { SeoAuditError } from "./url";
import { checkName, checkTitle } from "./checks/titles";
import type {
  AuthorityResult,
  CompetitorRow,
  CompetitorsResult,
  RankedKeyword,
  SeoCheck,
  Severity,
  VisibilityResult,
} from "./types";

/* ============================================================
   SEO Audit —— DataForSEO 付费模块(Authority / Visibility / Competitors)

   只在 $10 付费升级时被 run.ts 调用;免费层永远不会 import 到这里的网络函数。
   每个 task 的 `cost` 逐笔记进成本账本(stage "seo-audit"),这是账本里唯一的实测数字。

   三条硬规则(站长):
   1. 开发/验证一律走沙盒(DATAFORSEO_SANDBOX=1 → sandbox.dataforseo.com,免费、回静态假数据)
      或 fixture;不得为测试调用正式付费端点。
   2. "没有数据" ≠ "0 分":DataForSEO 对新站/小站常常什么都没有,这时模块返回
      noData=true,检查项全部 na,UI 显示"Not enough ranking data yet",绝不显示 0 分。
   3. 任一 task status_code ≠ 20000 或网络错误 → 抛 SeoAuditError("unreachable"),
      由 run.ts 把该模块置 null + meta.notes 说明;重试只补缺的模块。
      单次请求的瞬时故障(网络错误、HTTP 5xx、DataForSEO 5xxxx)先原地重试 1 次(退避约 2s),
      4xx / 40xxx 这类"请求本身有问题"的错误绝不重试(复审 C41)。
   4. 生产环境(VERCEL_ENV=production)忽略 DATAFORSEO_SANDBOX:沙盒回的是静态假数据,
      生产误配了它就等于把假数据卖给付费用户(复审 D2)。
   ============================================================ */

const PROD_BASE = "https://api.dataforseo.com/v3";
const SANDBOX_BASE = "https://sandbox.dataforseo.com/v3";
const COST_STAGE = "seo-audit";
/** Google US / English —— 与 AI 可见度审计的 SERP 口径一致 */
const LOCATION_CODE = 2840;
const LANGUAGE_CODE = "en";
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * 余额预检挡在解锁按钮渲染之前,30s 的挂起会拖垮整个报告页;
 * 预检失败只是显示 "temporarily unavailable",宁可快失败。
 */
const PRECHECK_TIMEOUT_MS = 10_000;
/** V2-0:跑付费模块前余额必须 ≥ $1(一次升级约 $0.06–0.10,留出余量) */
const MIN_BALANCE_USD = 1;
const READY_OK_TTL_MS = 10 * 60_000;
/** 失败也要缓存,否则供应商宕机时每次渲染都会再挂 10s;但 60s 后要能自动恢复 */
const READY_FAIL_TTL_MS = 60_000;
/** ranked_keywords 抽样条数:按搜索量降序取前 50,品牌占比 / AI Overview 占比都基于这个样本估算 */
const RANKED_KEYWORDS_LIMIT = 50;
const COMPETITORS_LIMIT = 5;

let sandboxIgnoredWarned = false;

/**
 * 沙盒开关。生产环境一律走正式端点:沙盒数据是静态假数据(cost 记 0、余额预检恒为 ok),
 * Vercel 上误把 DATAFORSEO_SANDBOX 勾进 Production 时,宁可照常花几美分拿真数据,
 * 也不能静默地卖假报告(复审 D2)。只警告一次,免得每个请求刷屏。
 * 用 VERCEL_ENV 而不是 NODE_ENV:本地 next start 的 NODE_ENV 也是 production。
 */
function isSandbox(): boolean {
  if (env.DATAFORSEO_SANDBOX !== "1") return false;
  if (process.env.VERCEL_ENV === "production") {
    if (!sandboxIgnoredWarned) {
      sandboxIgnoredWarned = true;
      console.warn("[seo-audit] DATAFORSEO_SANDBOX=1 is ignored in production (VERCEL_ENV=production): paid modules use the live DataForSEO API. Remove the variable from the Production environment.");
    }
    return false;
  }
  return true;
}

/** 当前生效的 DataForSEO 模式(给健康检查 / 运维脚本看"实际生效值",而不是变量有没有设) */
export function dfsMode(): "live" | "sandbox" {
  return isSandbox() ? "sandbox" : "live";
}

function baseUrl(): string {
  return isSandbox() ? SANDBOX_BASE : PROD_BASE;
}

/** 认证头与 lib/engine/dataforseo.ts 完全一致(同一份 Basic 凭据) */
function authHeader(): Record<string, string> {
  return { Authorization: `Basic ${env.DATAFORSEO_B64}`, "Content-Type": "application/json" };
}

export function dfsEnabled(): boolean {
  return !!env.DATAFORSEO_B64;
}

/* ---------- DataForSEO 响应外壳 ---------- */

interface DfsTask {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: unknown[] | null;
}

interface DfsEnvelope {
  status_code?: number;
  status_message?: string;
  tasks?: DfsTask[];
}

let readyCache: { at: number; ttl: number; value: { ok: boolean; balance: number | null; reason?: string } } | null = null;

/**
 * 解锁按钮渲染前的预检:凭据在、能连通、余额 ≥ $1。进程内缓存 10 分钟(成功)/ 60 秒(失败)。
 * 沙盒模式下余额无意义(沙盒免费、回的是假账户数据),只要连通就算 ready。
 * `force` 只给测试与运维脚本用:绕过缓存重新探测。
 */
export async function dfsReady(opts?: { force?: boolean }): Promise<{ ok: boolean; balance: number | null; reason?: string }> {
  if (!dfsEnabled()) return { ok: false, balance: null, reason: "unconfigured" };
  const now = Date.now();
  if (!opts?.force && readyCache && now - readyCache.at < readyCache.ttl) return readyCache.value;

  let value: { ok: boolean; balance: number | null; reason?: string };
  try {
    const res = await fetch(`${baseUrl()}/appendix/user_data`, {
      headers: authHeader(),
      signal: AbortSignal.timeout(PRECHECK_TIMEOUT_MS),
    });
    const json = (await res.json()) as DfsEnvelope;
    const task = json?.tasks?.[0];
    const money = (task?.result?.[0] as { money?: { balance?: unknown } } | undefined)?.money;
    const balance = typeof money?.balance === "number" && Number.isFinite(money.balance) ? money.balance : null;
    if (json?.status_code !== 20000 || task?.status_code !== 20000) value = { ok: false, balance, reason: "unreachable" };
    else if (isSandbox()) value = { ok: true, balance, reason: "sandbox" };
    else if (balance === null) value = { ok: false, balance: null, reason: "unreachable" };
    else if (balance < MIN_BALANCE_USD) value = { ok: false, balance, reason: "low_balance" };
    else value = { ok: true, balance };
  } catch {
    value = { ok: false, balance: null, reason: "unreachable" };
  }
  readyCache = { at: now, ttl: value.ok ? READY_OK_TTL_MS : READY_FAIL_TTL_MS, value };
  return value;
}

/** 单次请求最多尝试几次(首发 + 1 次重试) */
const DFS_MAX_ATTEMPTS = 2;

/**
 * 重试退避。做成可替换的对象只为测试:测试里换成"只记录不等待"的 sleep,
 * 既能断言确实退避了约 2s,又不让测试真等。
 */
export const dfsRetryTiming = {
  backoffMs: 2_000,
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

type Attempt<T> = { ok: true; value: T | null } | { ok: false; retryable: boolean; error: SeoAuditError };

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

/** DataForSEO 自己的 5xxxx(如 50000 Internal Error)与 HTTP 5xx 同类:服务端瞬时故障 */
function isServerSideCode(code: unknown): boolean {
  return typeof code === "number" && code >= 50000 && code < 60000;
}

/**
 * 一次 POST。哪些失败值得重试:
 *  - 网络错误(连不上、连接被重置)→ 重试;
 *  - 超时 → 不重试:live 任务可能已在供应商那边跑完并计费,重发会重复扣钱,
 *    而且 30s + 2s + 30s 早已超出 run.ts 给单个模块的 60s 预算;
 *  - HTTP 5xx、DataForSEO 5xxxx → 重试;
 *  - HTTP 4xx、DataForSEO 40xxx(参数错、未授权、余额不足、限流)→ 绝不重试,再发一次结果一样。
 * 只要拿到了响应信封就先记账(每次尝试都记,供应商对失败也计费时账本不能漏)。
 */
async function dfsAttempt<T>(endpoint: string, payload: Record<string, unknown>): Promise<Attempt<T>> {
  const fail = (retryable: boolean, why: string): Attempt<T> => ({ ok: false, retryable, error: new SeoAuditError("unreachable", `DataForSEO ${endpoint}: ${why}`.trim()) });
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/${endpoint}`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify([payload]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    return fail(!isTimeout(e), e instanceof Error ? e.message : "network error");
  }
  const httpStatus = typeof res.status === "number" ? res.status : 200;
  let json: DfsEnvelope | null = null;
  let bodyError: unknown = null;
  try {
    json = (await res.json()) as DfsEnvelope;
  } catch (e) {
    bodyError = e;
  }
  const task = json?.tasks?.[0];
  recordDataForSeoCost({ endpoint, stage: COST_STAGE, usd: typeof task?.cost === "number" ? task.cost : 0 });
  if (httpStatus >= 500) return fail(true, `HTTP ${httpStatus}`);
  if (!json) {
    // 读正文时断线算网络错误(可重试);超时、或返回的根本不是 JSON(多半是代理错误页)不重试
    const e = bodyError;
    const retryable = !isTimeout(e) && !(e instanceof SyntaxError);
    return fail(retryable, e instanceof Error ? e.message : `HTTP ${httpStatus} with an unreadable body`);
  }
  if (json.status_code !== 20000 || !task || task.status_code !== 20000) {
    const code = task?.status_code ?? json.status_code ?? (httpStatus !== 200 ? `HTTP ${httpStatus}` : "no response");
    const msg = task?.status_message ?? json.status_message ?? "";
    return fail(isServerSideCode(json.status_code) || isServerSideCode(task?.status_code), `${code} ${msg}`);
  }
  const first = Array.isArray(task.result) ? task.result[0] : null;
  return { ok: true, value: (first ?? null) as T | null };
}

/**
 * 单个 live 任务:POST → 记账 → 校验 → 返回 result[0](没有就 null,由调用方判 noData)。
 * 瞬时故障原地重试 1 次(见 dfsAttempt),仍失败才抛 —— 一次网络抖动就让买家的模块永久变 null,
 * 是复审 C41 里最常见的触发路径。错误信息只带端点与状态码,绝不带请求头。
 */
async function dfsPost<T>(endpoint: string, payload: Record<string, unknown>): Promise<T | null> {
  for (let attempt = 1; ; attempt += 1) {
    const r = await dfsAttempt<T>(endpoint, payload);
    if (r.ok) return r.value;
    if (!r.retryable || attempt >= DFS_MAX_ATTEMPTS) throw r.error;
    await dfsRetryTiming.sleep(dfsRetryTiming.backoffMs);
  }
}

/* ---------- 小工具 ---------- */

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function pct(share: number): number {
  return Math.round(share * 100);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** DataForSEO 的日期形如 "2019-01-15 23:54:14 +00:00" —— 报告只需要日期部分 */
function dateOnly(v: unknown): string | null {
  const s = str(v);
  return s ? s.slice(0, 10) : null;
}

/** DataForSEO 的 target 要裸域:去协议 / 路径 / 端口 / www. */
function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/** 二级公共后缀(co.uk / com.au …)下品牌标签在倒数第三段 */
const SECOND_LEVEL_SUFFIX = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

/** 注册域的品牌标签:aeoeye.com → aeoeye;example.co.uk → example */
function brandLabel(domain: string): string {
  const parts = cleanDomain(domain).split(".").filter(Boolean);
  if (parts.length >= 3 && SECOND_LEVEL_SUFFIX.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? "";
}

/** Organization 名里的公司后缀与虚词,当品牌 token 会把所有关键词都判成品牌词 */
const BRAND_STOP = new Set(["the", "and", "inc", "llc", "ltd", "corp", "company", "app", "www", "com", "net", "org"]);

function brandTokens(domain: string, extra: string[] | undefined): string[] {
  const out = new Set<string>();
  const label = brandLabel(domain);
  if (label.length >= 3) out.add(label);
  for (const raw of extra ?? []) {
    for (const t of raw.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 3 && !BRAND_STOP.has(t)) out.add(t);
    }
  }
  return [...out];
}

/** "aeo eye pricing" 也算品牌词:比较时把空格与符号去掉再包含匹配 */
function isBrandKeyword(keyword: string, tokens: string[]): boolean {
  const k = keyword.toLowerCase();
  const compact = k.replace(/[^a-z0-9]/g, "");
  return tokens.some((t) => k.includes(t) || compact.includes(t.replace(/[^a-z0-9]/g, "")));
}

/* ============================================================
   Authority —— backlinks/summary + anchors + timeseries_new_lost_summary
   ============================================================ */

interface BacklinksSummary {
  rank?: number;
  backlinks?: number;
  backlinks_spam_score?: number;
  broken_backlinks?: number;
  broken_pages?: number;
  referring_domains?: number;
  referring_domains_nofollow?: number;
  referring_main_domains?: number;
  referring_ips?: number;
  referring_pages?: number;
  referring_pages_nofollow?: number;
  first_seen?: string | null;
  referring_links_tld?: Record<string, number> | null;
  referring_links_types?: Record<string, number> | null;
}

interface AnchorsResponse {
  items?: { anchor?: string | null; backlinks?: number; referring_domains?: number }[] | null;
}

interface NewLostResponse {
  items?: { date?: string; new_referring_domains?: number; lost_referring_domains?: number }[] | null;
}

function emptyAuthority(): AuthorityResult {
  return {
    rank: null,
    backlinks: 0,
    referringDomains: 0,
    referringMainDomains: 0,
    referringIps: 0,
    nofollowShare: 0,
    spamScore: null,
    brokenBacklinks: 0,
    brokenPages: 0,
    firstSeen: null,
    tld: {},
    linkTypes: {},
    anchors: [],
    score: 0,
    timeseries: [],
    noData: true,
  };
}

/**
 * Authority 分(0-100)= 0.6 × rank 分 + 0.4 × 引荐域分 − 垃圾分惩罚。
 *
 * rank 分:DataForSEO Domain Rank 是 0-1000 刻度,分段线性映射 ——
 *   ≥300 → 90 + 10×min(1,(rank−300)/700)    (300 分以上的站已经是"强站",只在 90-100 间微调)
 *   100–299 → 70 + 20×(rank−100)/200
 *   30–99  → 50 + 20×(rank−30)/70
 *   <30    → 50×rank/30                      (几乎没人链接)
 * 引荐域分:对数刻度,log10(1+rd)/log10(1+10000)×100 —— 1 个域 ≈ 8,100 个 ≈ 50,1 万个 = 100。
 *   取对数是因为链接增长是指数型的:从 10 到 100 个域的难度与从 100 到 1000 相当。
 * 垃圾分惩罚:≤10 不罚;10–30 线性罚到 15 分;>30 再线性罚到 40 分(spam 100 时)。
 */
function authorityScore(rank: number | null, referringDomains: number, spamScore: number | null): number {
  const r = rank ?? 0;
  let rankScore: number;
  if (r >= 300) rankScore = 90 + 10 * Math.min(1, (r - 300) / 700);
  else if (r >= 100) rankScore = 70 + (20 * (r - 100)) / 200;
  else if (r >= 30) rankScore = 50 + (20 * (r - 30)) / 70;
  else rankScore = (50 * r) / 30;

  const rdScore = Math.min(100, (Math.log10(1 + Math.max(0, referringDomains)) / Math.log10(1 + 10_000)) * 100);

  const spam = spamScore ?? 0;
  let penalty = 0;
  if (spam > 30) penalty = 15 + (25 * Math.min(70, spam - 30)) / 70;
  else if (spam > 10) penalty = (15 * (spam - 10)) / 20;

  return clamp(Math.round(0.6 * rankScore + 0.4 * rdScore - penalty), 0, 100);
}

/** 沙盒/真实数据都可能按天回(即使要了 month):这里按 YYYY-MM 自己归并,避免依赖供应商的分组 */
function monthlyNewLost(items: NewLostResponse["items"]): NonNullable<AuthorityResult["timeseries"]> {
  const byMonth = new Map<string, { newReferringDomains: number; lostReferringDomains: number }>();
  for (const it of items ?? []) {
    const month = str(it.date)?.slice(0, 7);
    if (!month) continue;
    const cur = byMonth.get(month) ?? { newReferringDomains: 0, lostReferringDomains: 0 };
    cur.newReferringDomains += num(it.new_referring_domains);
    cur.lostReferringDomains += num(it.lost_referring_domains);
    byMonth.set(month, cur);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
}

function topN(dict: Record<string, number> | null | undefined, n: number): Record<string, number> {
  const entries = Object.entries(dict ?? {})
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  return Object.fromEntries(entries);
}

/**
 * backlinks/summary/live(总览)→ 有链接才继续 anchors(前 20)与 90 天新增/丢失引荐域。
 * 新增/丢失用 timeseries_new_lost_summary:timeseries_summary 只回累计值,拆不出 new/lost。
 * summary 为空或 backlinks=referring_domains=0 → noData,不再花后两笔钱。
 */
export async function fetchAuthority(domain: string): Promise<AuthorityResult> {
  const target = cleanDomain(domain);
  const summary = await dfsPost<BacklinksSummary>("backlinks/summary/live", {
    target,
    include_subdomains: true,
    backlinks_status_type: "live",
    internal_list_limit: 10,
  });
  const backlinks = num(summary?.backlinks);
  const referringDomains = num(summary?.referring_domains);
  if (!summary || (backlinks === 0 && referringDomains === 0)) return emptyAuthority();

  const now = Date.now();
  const [anchorsRes, newLostRes] = await Promise.all([
    dfsPost<AnchorsResponse>("backlinks/anchors/live", { target, limit: 20, order_by: ["backlinks,desc"] }),
    dfsPost<NewLostResponse>("backlinks/timeseries_new_lost_summary/live", {
      target,
      date_from: isoDate(now - 90 * 86_400_000),
      date_to: isoDate(now),
      group_range: "month",
    }),
  ]);

  const referringPages = num(summary.referring_pages);
  // nofollow 占比按"引荐页"算(≈ 反链数口径);没有页级数据时退到域级
  const nofollowShare =
    referringPages > 0
      ? num(summary.referring_pages_nofollow) / referringPages
      : referringDomains > 0
        ? num(summary.referring_domains_nofollow) / referringDomains
        : 0;
  const rank = numOrNull(summary.rank);
  const spamScore = numOrNull(summary.backlinks_spam_score);

  const anchors = (anchorsRes?.items ?? [])
    .map((it) => ({
      anchor: typeof it.anchor === "string" ? it.anchor : "",
      backlinks: num(it.backlinks),
      referringDomains: num(it.referring_domains),
    }))
    .filter((a) => a.backlinks > 0)
    .slice(0, 20);

  return {
    rank,
    backlinks,
    referringDomains,
    referringMainDomains: num(summary.referring_main_domains),
    referringIps: num(summary.referring_ips),
    nofollowShare: clamp(nofollowShare, 0, 1),
    spamScore,
    brokenBacklinks: num(summary.broken_backlinks),
    brokenPages: num(summary.broken_pages),
    firstSeen: dateOnly(summary.first_seen),
    tld: topN(summary.referring_links_tld, 10),
    linkTypes: topN(summary.referring_links_types, 10),
    anchors,
    score: authorityScore(rank, referringDomains, spamScore),
    timeseries: monthlyNewLost(newLostRes?.items),
    noData: false,
  };
}

/* ============================================================
   Visibility —— domain_rank_overview + ranked_keywords + site: SERP
   ============================================================ */

interface OrganicMetrics {
  pos_1?: number;
  pos_2_3?: number;
  pos_4_10?: number;
  pos_11_20?: number;
  pos_21_30?: number;
  pos_31_40?: number;
  pos_41_50?: number;
  pos_51_60?: number;
  pos_61_70?: number;
  pos_71_80?: number;
  pos_81_90?: number;
  pos_91_100?: number;
  etv?: number;
  count?: number;
  is_new?: number;
  is_up?: number;
  is_down?: number;
  is_lost?: number;
}

interface RankOverviewResponse {
  items?: { metrics?: { organic?: OrganicMetrics | null } | null }[] | null;
}

interface RankedKeywordItem {
  keyword_data?: {
    keyword?: string;
    keyword_info?: { search_volume?: number | null; cpc?: number | null } | null;
    search_intent_info?: { main_intent?: string | null } | null;
    serp_info?: { serp_item_types?: string[] | null } | null;
  } | null;
  ranked_serp_element?: {
    serp_item?: { rank_group?: number; rank_absolute?: number; url?: string | null; etv?: number | null } | null;
    serp_item_types?: string[] | null;
  } | null;
}

interface RankedKeywordsResponse {
  items?: RankedKeywordItem[] | null;
}

interface SerpRegularResponse {
  se_results_count?: number | null;
  items_count?: number | null;
}

function emptyVisibility(sitemapUrls: number | null): VisibilityResult {
  return {
    organicKeywords: 0,
    etv: 0,
    positions: { pos1: 0, pos2_3: 0, pos4_10: 0, pos11_20: 0, pos21_50: 0, pos51_100: 0 },
    movement: { isNew: 0, isUp: 0, isDown: 0, isLost: 0 },
    topKeywords: [],
    quickWins: [],
    score: 0,
    brandKeywords: 0,
    nonBrandKeywords: 0,
    aiOverviewShare: null,
    indexEstimate: { googleResults: null, sitemapUrls, ratio: null },
    noData: true,
  };
}

function mapKeyword(it: RankedKeywordItem): RankedKeyword | null {
  const kd = it.keyword_data;
  const si = it.ranked_serp_element?.serp_item;
  const keyword = str(kd?.keyword);
  if (!keyword) return null;
  // rank_group = 在自然结果里的名次;rank_absolute 把广告/PAA 等 SERP 模块也算进去,只作兜底
  const position = num(si?.rank_group) || num(si?.rank_absolute);
  if (!position) return null;
  return {
    keyword,
    position,
    volume: numOrNull(kd?.keyword_info?.search_volume),
    etv: numOrNull(si?.etv),
    url: str(si?.url),
    intent: str(kd?.search_intent_info?.main_intent),
    cpc: numOrNull(kd?.keyword_info?.cpc),
  };
}

function hasAiOverview(it: RankedKeywordItem): boolean {
  const a = it.ranked_serp_element?.serp_item_types ?? [];
  const b = it.keyword_data?.serp_info?.serp_item_types ?? [];
  return a.includes("ai_overview") || b.includes("ai_overview");
}

/**
 * Visibility 分(0-100)= 0.45 × 非品牌词分 + 0.35 × 前十分 + 0.20 × 收录比分。
 *
 * 非品牌词分:log10(1+n)/log10(5001)×100 —— 50 个词 ≈ 46,500 个 ≈ 73,5000 个 = 100。
 *   只算非品牌词,因为品牌词排名是"别人搜你名字",不代表搜索可见度。
 * 前十分:log10(1+top10)/log10(501)×100 —— 3 个 ≈ 22,20 个 ≈ 49,100 个 ≈ 74,500 个 = 100。
 * 收录比分:site: 估算收录数 / sitemap 条数,≥0.8 满分,否则线性;没有 sitemap 或 Google
 *   不给估算时这一项拿掉、其余两项按 0.45:0.35 重新归一(不惩罚"没数据")。
 */
function visibilityScore(nonBrandKeywords: number, top10: number, indexRatio: number | null): number {
  const kwScore = Math.min(100, (Math.log10(1 + Math.max(0, nonBrandKeywords)) / Math.log10(5001)) * 100);
  const top10Score = Math.min(100, (Math.log10(1 + Math.max(0, top10)) / Math.log10(501)) * 100);
  if (indexRatio === null) {
    return clamp(Math.round((0.45 * kwScore + 0.35 * top10Score) / 0.8), 0, 100);
  }
  const indexScore = Math.min(100, (Math.max(0, indexRatio) / 0.8) * 100);
  return clamp(Math.round(0.45 * kwScore + 0.35 * top10Score + 0.2 * indexScore), 0, 100);
}

/**
 * domain_rank_overview(位次桶 / etv / 变动)→ organic.count=0 即 noData,后两笔不花。
 * 否则并行:ranked_keywords(按搜索量降序前 50)+ `site:<domain>` SERP(se_results_count = Google 的收录估算)。
 * 品牌词 = 关键词含注册域标签或 Organization 名 token;品牌/非品牌计数是"样本占比 × 总词数"的估算,
 * 样本按搜索量取头部,品牌词往往搜索量最高,所以估算偏保守(非品牌数只会低估)。
 */
export async function fetchVisibility(
  domain: string,
  opts?: { sitemapUrls?: number | null; brandTokens?: string[] }
): Promise<VisibilityResult> {
  const target = cleanDomain(domain);
  const sitemapUrls = typeof opts?.sitemapUrls === "number" && opts.sitemapUrls > 0 ? Math.round(opts.sitemapUrls) : null;

  const overview = await dfsPost<RankOverviewResponse>("dataforseo_labs/google/domain_rank_overview/live", {
    target,
    location_code: LOCATION_CODE,
    language_code: LANGUAGE_CODE,
  });
  const organic = overview?.items?.[0]?.metrics?.organic ?? null;
  const organicKeywords = num(organic?.count);
  if (!organic || organicKeywords === 0) return emptyVisibility(sitemapUrls);

  const [ranked, serp] = await Promise.all([
    dfsPost<RankedKeywordsResponse>("dataforseo_labs/google/ranked_keywords/live", {
      target,
      location_code: LOCATION_CODE,
      language_code: LANGUAGE_CODE,
      limit: RANKED_KEYWORDS_LIMIT,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
      item_types: ["organic"],
    }),
    dfsPost<SerpRegularResponse>("serp/google/organic/live/regular", {
      keyword: `site:${target}`,
      location_code: LOCATION_CODE,
      language_code: LANGUAGE_CODE,
      depth: 10,
    }),
  ]);

  const rawItems = ranked?.items ?? [];
  const tokens = brandTokens(target, opts?.brandTokens);
  const topKeywords: RankedKeyword[] = [];
  let brandInSample = 0;
  let aiOverviewInSample = 0;
  for (const it of rawItems) {
    const kw = mapKeyword(it);
    if (!kw) continue;
    topKeywords.push(kw);
    if (isBrandKeyword(kw.keyword, tokens)) brandInSample += 1;
    if (hasAiOverview(it)) aiOverviewInSample += 1;
  }
  const sampleSize = topKeywords.length;
  const brandKeywords = sampleSize ? Math.round((organicKeywords * brandInSample) / sampleSize) : 0;
  const nonBrandKeywords = Math.max(0, organicKeywords - brandKeywords);
  const aiOverviewShare = sampleSize ? aiOverviewInSample / sampleSize : null;

  // 快赢词:已在 4–20 位、有真实搜索量(≥100)的词 —— 一次改稿就可能进前三
  const quickWins = topKeywords
    .filter((k) => k.position >= 4 && k.position <= 20 && (k.volume ?? 0) >= 100)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  const googleResults = numOrNull(serp?.se_results_count);
  const ratio = googleResults !== null && sitemapUrls ? googleResults / sitemapUrls : null;

  const positions = {
    pos1: num(organic.pos_1),
    pos2_3: num(organic.pos_2_3),
    pos4_10: num(organic.pos_4_10),
    pos11_20: num(organic.pos_11_20),
    pos21_50: num(organic.pos_21_30) + num(organic.pos_31_40) + num(organic.pos_41_50),
    pos51_100:
      num(organic.pos_51_60) + num(organic.pos_61_70) + num(organic.pos_71_80) + num(organic.pos_81_90) + num(organic.pos_91_100),
  };
  const top10 = positions.pos1 + positions.pos2_3 + positions.pos4_10;

  return {
    organicKeywords,
    etv: Math.round(num(organic.etv)),
    positions,
    movement: { isNew: num(organic.is_new), isUp: num(organic.is_up), isDown: num(organic.is_down), isLost: num(organic.is_lost) },
    topKeywords,
    quickWins,
    score: visibilityScore(nonBrandKeywords, top10, ratio),
    brandKeywords,
    nonBrandKeywords,
    aiOverviewShare,
    indexEstimate: { googleResults, sitemapUrls, ratio },
    noData: false,
  };
}

/* ============================================================
   Competitors —— dataforseo_labs/google/competitors_domain
   ============================================================ */

interface CompetitorItem {
  domain?: string;
  avg_position?: number | null;
  intersections?: number;
  /** 本站在交集关键词上的指标 */
  metrics?: { organic?: { etv?: number | null; count?: number | null } | null } | null;
  /** 该竞品在同一批交集关键词上的指标 —— 与 metrics 同口径,才能公平比 */
  competitor_metrics?: { organic?: { etv?: number | null; count?: number | null } | null } | null;
  /** 该竞品全域指标 */
  full_domain_metrics?: { organic?: { etv?: number | null; count?: number | null } | null } | null;
}

interface CompetitorsResponse {
  items?: CompetitorItem[] | null;
}

/**
 * Competitors 分 = 100 − 差距惩罚。
 * 差距 = 最强竞品在"你们共同排名的那批词"上的 etv ÷ 你在同一批词上的 etv(同口径,苹果比苹果;
 * 全域 etv 会被对方站点规模带偏)。惩罚 = 15 × log2(差距),差距 ≤1 不罚:
 *   2× → 15 分,4× → 30 分,10× → 50 分,32× → 75 分,100× 封顶 100。
 * 取对数是因为 2× 到 4× 的追赶难度与 10× 到 20× 相当。缺 competitor_metrics 的行不参与比较。
 */
function competitorsScore(items: CompetitorItem[]): number {
  let worst = 1;
  for (const it of items) {
    const own = numOrNull(it.metrics?.organic?.etv);
    const theirs = numOrNull(it.competitor_metrics?.organic?.etv);
    if (own === null || theirs === null) continue;
    worst = Math.max(worst, theirs / Math.max(own, 1));
  }
  const penalty = worst > 1 ? Math.min(100, Math.round(15 * Math.log2(worst))) : 0;
  return clamp(100 - penalty, 0, 100);
}

/**
 * 交集最多的前 5 个竞品。`exclude_top_domains` 去掉全球前 1000 大站(YouTube/Wikipedia/Amazon):
 * 它们在几乎所有词上都"赢",列出来既不可追赶也不是同类,只会把差距惩罚打到底。
 * DataForSEO 会把目标域自己也放进结果,所以多要 1 条、过滤掉自己再截到 5。
 */
export async function fetchCompetitors(domain: string): Promise<CompetitorsResult> {
  const target = cleanDomain(domain);
  const res = await dfsPost<CompetitorsResponse>("dataforseo_labs/google/competitors_domain/live", {
    target,
    location_code: LOCATION_CODE,
    language_code: LANGUAGE_CODE,
    limit: COMPETITORS_LIMIT + 1,
    exclude_top_domains: true,
    order_by: ["intersections,desc"],
  });
  const raw = (res?.items ?? []).filter((it) => {
    const d = str(it.domain);
    return !!d && cleanDomain(d) !== target;
  });
  if (raw.length === 0) return { items: [], score: 0, noData: true };

  const kept = raw.slice(0, COMPETITORS_LIMIT);
  const items: CompetitorRow[] = kept.map((it) => ({
    domain: cleanDomain(it.domain ?? ""),
    intersections: num(it.intersections),
    avgPosition: it.avg_position === null || it.avg_position === undefined ? null : round1(num(it.avg_position)),
    etv: numOrNull(it.full_domain_metrics?.organic?.etv),
    organicKeywords: numOrNull(it.full_domain_metrics?.organic?.count),
  }));
  return { items, score: competitorsScore(kept), noData: false };
}

/* ============================================================
   付费维度的检查项(附录 B + V2-2 追加)
   ============================================================ */

const NO_DATA_EVIDENCE = "No index/backlink data for this domain yet";

const DOCS = {
  links: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide#promote-your-website",
  spam: "https://developers.google.com/search/docs/essentials/spam-policies#link-spam",
  nofollow: "https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links",
  redirects: "https://developers.google.com/search/docs/crawling-indexing/301-redirects",
  anchors: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide#use-links-wisely",
  searchConsole: "https://developers.google.com/search/docs/monitor-debug/search-console-start",
  indexing: "https://support.google.com/webmasters/answer/7440203",
  aiFeatures: "https://developers.google.com/search/docs/appearance/ai-features",
  helpfulContent: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
};

/** 标题不在这里写:与站内检查一样由 checks/titles.ts 按 id + 状态生成(复审契约第 7 条) */
type CheckSeed = Pick<SeoCheck, "id" | "dimension" | "status" | "severity" | "weight" | "evidence" | "fix"> &
  Partial<Pick<SeoCheck, "affected" | "effort" | "docs">>;

function mk(seed: CheckSeed): SeoCheck {
  return {
    id: seed.id,
    dimension: seed.dimension,
    title: checkTitle(seed.id, seed.status),
    name: checkName(seed.id),
    status: seed.status,
    severity: seed.severity,
    weight: seed.weight,
    evidence: seed.evidence,
    affected: seed.affected ?? [],
    fix: seed.fix,
    effort: seed.effort ?? "medium",
    docs: seed.docs,
    scope: "site",
  };
}

/** 模块为 null(供应商没回)或 noData(供应商没数据)→ 该维度全部 na,证据说明原因、修法说先做什么 */
function naChecks(
  dimension: SeoCheck["dimension"],
  defs: { id: string; severity: Severity; weight: number; docs?: string }[],
  why: string,
  fix: string
): SeoCheck[] {
  return defs.map((d) =>
    mk({
      id: d.id,
      dimension,
      status: "na",
      severity: d.severity,
      weight: d.weight,
      evidence: [NO_DATA_EVIDENCE, why],
      fix,
      docs: d.docs,
    })
  );
}

function naWhy(module: AuthorityResult | VisibilityResult | CompetitorsResult | null, domain: string, what: string): string {
  return module === null
    ? `The data provider did not return ${what} for ${domain} in this run — retry the upgrade to fill this section in.`
    : `DataForSEO has no ${what} recorded for ${domain}; new or very small sites usually show up 4–8 weeks after their first links and rankings.`;
}

const AUTHORITY_DEFS = [
  { id: "auth.referring-domains", severity: "high" as Severity, weight: 5, docs: DOCS.links },
  { id: "auth.rank", severity: "medium" as Severity, weight: 3, docs: DOCS.links },
  { id: "auth.spam-score", severity: "medium" as Severity, weight: 3, docs: DOCS.spam },
  { id: "auth.nofollow-share", severity: "low" as Severity, weight: 1, docs: DOCS.nofollow },
  { id: "auth.broken", severity: "low" as Severity, weight: 2, docs: DOCS.redirects },
  { id: "auth.anchors", severity: "low" as Severity, weight: 2, docs: DOCS.anchors },
  { id: "auth.trend", severity: "low" as Severity, weight: 1, docs: DOCS.links },
];

const AUTHORITY_NA_FIX =
  "Earn the first links before worrying about link metrics: publish one page worth citing (an original dataset, a free tool, a definitive guide), then get it referenced from 3–5 relevant sites — partners, directories in your niche, communities you are active in. Check Google Search Console → Links once they land, and re-run this report in 4–6 weeks.";

function authorityChecks(a: AuthorityResult | null, domain: string): SeoCheck[] {
  if (!a || a.noData) return naChecks("authority", AUTHORITY_DEFS, naWhy(a, domain, "backlink data"), AUTHORITY_NA_FIX);
  const out: SeoCheck[] = [];
  const d = (id: string) => AUTHORITY_DEFS.find((x) => x.id === id)!;

  // auth.referring-domains:≥100 pass;≥20 warn;否则 fail
  {
    const def = d("auth.referring-domains");
    const rd = a.referringDomains;
    const status = rd >= 100 ? "pass" : rd >= 20 ? "warn" : "fail";
    out.push(
      mk({
        ...def,
        dimension: "authority",
        status,
        evidence: [
          `${fmtInt(rd)} referring domains (${fmtInt(a.referringMainDomains)} main domains, ${fmtInt(a.referringIps)} IPs) link to ${domain}, ${fmtInt(a.backlinks)} backlinks in total.`,
          a.firstSeen ? `First backlink seen ${a.firstSeen}.` : "No first-seen date reported.",
        ],
        fix:
          status === "pass"
            ? "Keep the link graph growing from new domains, not more links from the same ones: publish citable assets (original data, tools, benchmarks) and pitch them to the sites already linking to your competitors."
            : `Only ${fmtInt(rd)} domains link here; Google treats each new linking domain as a fresh vote. Aim for 100+: list the site in the 5–10 directories your buyers actually use, get partners and customers to link from their sites, and publish one asset per quarter that journalists and bloggers cite. Verify progress in Search Console → Links → Top linking sites.`,
        effort: "high",
      })
    );
  }

  // auth.rank:DataForSEO rank ≥30 pass;≥10 warn;否则 fail
  {
    const def = d("auth.rank");
    const rank = a.rank;
    const status = rank === null ? "na" : rank >= 30 ? "pass" : rank >= 10 ? "warn" : "fail";
    out.push(
      mk({
        ...def,
        dimension: "authority",
        status,
        evidence: [
          rank === null
            ? "DataForSEO did not report a domain rank."
            : `Domain rank ${rank}/1000 (DataForSEO backlink rank: 300+ is a strong site, 100+ established, under 30 barely linked).`,
        ],
        fix:
          status === "pass"
            ? "Rank grows with links from pages that themselves have authority. Prioritise one link from a high-rank site over ten from new blogs."
            : "Rank is driven by the authority of the pages linking to you, not the count. Get one or two links from established sites in your field (industry publications, universities, well-known tools) — a guest article, a data contribution or a listing on a respected resource page.",
        effort: "high",
      })
    );
  }

  // auth.spam-score:≤10 pass;≤30 warn;否则 fail
  {
    const def = d("auth.spam-score");
    const spam = a.spamScore;
    const status = spam === null ? "na" : spam <= 10 ? "pass" : spam <= 30 ? "warn" : "fail";
    out.push(
      mk({
        ...def,
        dimension: "authority",
        status,
        evidence: [spam === null ? "No spam score reported." : `Backlink spam score ${spam}/100 (share of linking pages that look like link farms, hacked pages or auto-generated directories).`],
        fix:
          status === "pass"
            ? "Nothing to do. Keep declining paid link offers and bulk directory submissions — that is what pushes this score up."
            : "Export your backlinks (Search Console → Links, or any backlink tool), sort by the spammiest sources, and ask webmasters of the worst ones to remove the link. Use Google's Disavow tool only for links you did not acquire and cannot remove; Google ignores most spam on its own.",
        effort: "medium",
      })
    );
  }

  // auth.nofollow-share:≤60% pass;否则 warn
  {
    const def = d("auth.nofollow-share");
    const share = a.nofollowShare;
    const status = share <= 0.6 ? "pass" : "warn";
    out.push(
      mk({
        ...def,
        dimension: "authority",
        status,
        evidence: [`${pct(share)}% of referring pages link with rel="nofollow".`],
        fix:
          status === "pass"
            ? "A healthy mix. Nofollow links from forums, comments and social profiles are normal; they just do not pass ranking signals."
            : "Most of your links are nofollow (comments, forums, profiles, sponsored placements), which Google treats as hints rather than votes. Earn editorial links: contribute expert quotes, publish original research, and get mentioned in round-ups and resource pages where the link is a plain, followed link.",
        effort: "high",
      })
    );
  }

  // auth.broken:broken backlinks / backlinks ≤5% pass;否则 warn
  {
    const def = d("auth.broken");
    const share = a.backlinks > 0 ? a.brokenBacklinks / a.backlinks : 0;
    const status = share <= 0.05 ? "pass" : "warn";
    out.push(
      mk({
        ...def,
        dimension: "authority",
        status,
        evidence: [
          `${fmtInt(a.brokenBacklinks)} of ${fmtInt(a.backlinks)} backlinks (${pct(share)}%) point at URLs that no longer resolve; ${fmtInt(a.brokenPages)} target pages return errors.`,
        ],
        fix:
          status === "pass"
            ? "Nothing to do now. When you rename or delete a page, 301-redirect the old URL so existing links keep working."
            : "Reclaim these links: list the target URLs that return 404/410 (Search Console → Pages → Not found, or a backlink export filtered to broken targets), then 301-redirect each one to the closest live page. Re-check after Google recrawls (2–4 weeks).",
        effort: "low",
      })
    );
  }

  // auth.anchors:最大单一锚文本(排除空锚与品牌锚)占比 ≤40% pass;否则 warn(过度优化信号)
  {
    const def = d("auth.anchors");
    const tokens = brandTokens(domain, undefined);
    const nonBrand = a.anchors.filter((x) => x.anchor.trim() && !isBrandKeyword(x.anchor, tokens));
    const top = nonBrand[0] ?? null;
    const share = top && a.backlinks > 0 ? top.backlinks / a.backlinks : 0;
    const status = share <= 0.4 ? "pass" : "warn";
    const topList = a.anchors.slice(0, 5).map((x) => `"${x.anchor || "(empty / image link)"}" — ${fmtInt(x.backlinks)} backlinks from ${fmtInt(x.referringDomains)} domains`);
    out.push(
      mk({
        ...def,
        dimension: "authority",
        status,
        evidence: [
          top
            ? `Largest non-brand anchor "${top.anchor}" carries ${pct(share)}% of all backlinks (${fmtInt(top.backlinks)} of ${fmtInt(a.backlinks)}).`
            : "All anchors are brand names, URLs or empty (image links) — no keyword anchor dominates.",
          ...(topList.length ? [`Top anchors: ${topList.join("; ")}.`] : []),
        ],
        fix:
          status === "pass"
            ? "A natural profile. Brand and URL anchors should stay the majority; do not ask for exact-match keyword anchors."
            : `"${top?.anchor}" appears in an unnaturally large share of links, which is the classic footprint of paid or exchanged links. Stop requesting that anchor, diversify future links toward brand, URL and natural-phrase anchors, and consider removing or disavowing the lowest-quality sources using it.`,
        effort: "medium",
      })
    );
  }

  // auth.trend(V2):近 90 天 lost > new → warn
  {
    const def = d("auth.trend");
    const ts = a.timeseries ?? [];
    const gained = ts.reduce((s, m) => s + m.newReferringDomains, 0);
    const lost = ts.reduce((s, m) => s + m.lostReferringDomains, 0);
    const status = ts.length === 0 ? "na" : lost > gained ? "warn" : "pass";
    out.push(
      mk({
        ...def,
        dimension: "authority",
        status,
        evidence:
          ts.length === 0
            ? ["No month-by-month link history was returned for this domain."]
            : [
                `Last 90 days: +${fmtInt(gained)} new / −${fmtInt(lost)} lost referring domains (${ts.map((m) => `${m.month}: +${m.newReferringDomains}/−${m.lostReferringDomains}`).join(", ")}).`,
              ],
        fix:
          status === "warn"
            ? "You are losing linking domains faster than you gain them. Check whether the lost links pointed at pages you removed or moved (redirect them), then reach out to the sites that dropped you — often the page was redesigned and the link can be restored."
            : "Links are growing. Keep a steady cadence: one new citable asset per quarter beats a one-off outreach burst.",
        effort: "medium",
      })
    );
  }

  return out;
}

const VISIBILITY_DEFS = [
  { id: "vis.keywords", severity: "high" as Severity, weight: 4, docs: DOCS.searchConsole },
  { id: "vis.top10", severity: "medium" as Severity, weight: 3, docs: DOCS.helpfulContent },
  { id: "vis.etv", severity: "medium" as Severity, weight: 2, docs: DOCS.searchConsole },
  { id: "vis.quick-wins", severity: "low" as Severity, weight: 2, docs: DOCS.helpfulContent },
  { id: "vis.movement", severity: "low" as Severity, weight: 1, docs: DOCS.searchConsole },
  { id: "vis.index-ratio", severity: "high" as Severity, weight: 3, docs: DOCS.indexing },
  { id: "vis.brand-share", severity: "low" as Severity, weight: 1, docs: DOCS.searchConsole },
  { id: "vis.ai-overview-share", severity: "low" as Severity, weight: 1, docs: DOCS.aiFeatures },
];

const VISIBILITY_NA_FIX =
  "Get indexed before chasing rankings: submit your sitemap in Google Search Console, make sure the pages that matter return 200 without noindex, and publish pages that each answer one specific search query (a question people actually type, not a category name). Google usually starts reporting rankings 4–6 weeks after that; re-run this report then.";

function visibilityChecks(v: VisibilityResult | null, domain: string): SeoCheck[] {
  if (!v || v.noData) return naChecks("visibility", VISIBILITY_DEFS, naWhy(v, domain, "ranking data"), VISIBILITY_NA_FIX);
  const out: SeoCheck[] = [];
  const d = (id: string) => VISIBILITY_DEFS.find((x) => x.id === id)!;
  const top10 = v.positions.pos1 + v.positions.pos2_3 + v.positions.pos4_10;

  // vis.keywords:organic count ≥500 pass;≥50 warn;否则 fail
  {
    const def = d("vis.keywords");
    const n = v.organicKeywords;
    const status = n >= 500 ? "pass" : n >= 50 ? "warn" : "fail";
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status,
        evidence: [`${domain} ranks in Google's top 100 (US, English) for ${fmtInt(n)} keywords (DataForSEO Labs).`],
        fix:
          status === "pass"
            ? "Broad footprint. Now shift effort from more keywords to better positions: see the quick-win list below."
            : `Only ${fmtInt(n)} keywords rank at all, so most searches your buyers make never show your site. Build one page per specific query (compare X vs Y, how to do Z, best tools for W) with the question in the title and the answer in the first paragraph. Ten well-targeted pages typically add 100+ ranking keywords within two months.`,
        effort: "high",
      })
    );
  }

  // vis.top10:≥20 pass;≥3 warn;否则 fail
  {
    const def = d("vis.top10");
    const status = top10 >= 20 ? "pass" : top10 >= 3 ? "warn" : "fail";
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status,
        evidence: [
          `${fmtInt(top10)} keywords in the top 10 (#1: ${fmtInt(v.positions.pos1)}, #2–3: ${fmtInt(v.positions.pos2_3)}, #4–10: ${fmtInt(v.positions.pos4_10)}); ${fmtInt(v.positions.pos11_20)} sit on page 2.`,
        ],
        fix:
          status === "pass"
            ? "Protect these: refresh the top-10 pages every 6 months and keep their internal links prominent."
            : "Page-2 rankings are the cheapest wins in SEO. Take the keywords at positions 11–20, add the missing sub-topics competitors cover, link to those pages from your strongest pages, and update the title to match the query wording. Expect movement within 2–6 weeks.",
        effort: "medium",
      })
    );
  }

  // vis.etv:≥1000 pass;≥100 warn;否则 fail
  {
    const def = d("vis.etv");
    const status = v.etv >= 1000 ? "pass" : v.etv >= 100 ? "warn" : "fail";
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status,
        evidence: [`About ${fmtInt(v.etv)} estimated organic visits per month (positions × search volume × expected click-through; a model, not analytics).`],
        fix:
          status === "pass"
            ? "Traffic is meaningful. Make sure it converts: put a clear next step above the fold on the top-traffic pages."
            : "Traffic follows top-10 rankings on keywords with volume. Prioritise the quick wins below over new content, and pick topics with real search volume (100+/month) rather than internal jargon.",
        effort: "medium",
      })
    );
  }

  // vis.quick-wins:有则 info 列出(≤10),没有 na
  {
    const def = d("vis.quick-wins");
    const wins = v.quickWins.slice(0, 10);
    const status = wins.length > 0 ? "info" : "na";
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status,
        evidence:
          wins.length > 0
            ? [
                `${fmtInt(v.quickWins.length)} keywords already rank at positions 4–20 with 100+ monthly searches:`,
                ...wins.map((k) => `"${k.keyword}" — position ${k.position}, ${fmtInt(k.volume ?? 0)} searches/month${k.url ? ` (${k.url})` : ""}`),
              ]
            : ["None of the top 50 keywords by volume sit at positions 4–20 with 100+ monthly searches."],
        affected: [...new Set(wins.map((k) => k.url).filter((u): u is string => !!u))],
        fix:
          wins.length > 0
            ? "For each page listed: match the title to the exact query, answer it in the first 2 sentences, add the sections competitors in the top 3 have that you lack, and add 3–5 internal links to it from related pages. One afternoon per page; re-check positions in 3 weeks."
            : "Once keywords appear at positions 4–20, they become the fastest lever; re-run the report after publishing new pages.",
        effort: "low",
      })
    );
  }

  // vis.movement:is_lost ≤ is_new pass;否则 warn
  {
    const def = d("vis.movement");
    const m = v.movement;
    const status = m.isLost <= m.isNew ? "pass" : "warn";
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status,
        evidence: [`Versus the previous month: ${fmtInt(m.isNew)} new keywords, ${fmtInt(m.isLost)} lost, ${fmtInt(m.isUp)} moved up, ${fmtInt(m.isDown)} moved down.`],
        fix:
          status === "pass"
            ? "Momentum is positive. Keep publishing and refreshing on a schedule."
            : "You are losing more keywords than you gain. Check Search Console → Performance for the pages whose clicks dropped, compare them with what now ranks above them, and refresh the content (facts, dates, missing sections) rather than writing new pages.",
        effort: "medium",
      })
    );
  }

  // vis.index-ratio(V2):site: 估算收录数 / sitemap 条数 <30% fail;<60% warn;否则 pass;缺数据 na
  {
    const def = d("vis.index-ratio");
    const ie = v.indexEstimate;
    const ratio = ie?.ratio ?? null;
    const status = ratio === null ? "na" : ratio < 0.3 ? "fail" : ratio < 0.6 ? "warn" : "pass";
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status,
        evidence:
          ratio === null
            ? [
                ie?.googleResults === null || ie?.googleResults === undefined
                  ? `Google did not show a result count for site:${domain}.`
                  : `Google shows about ${fmtInt(ie.googleResults)} results for site:${domain}, but no sitemap URL count was available to compare against.`,
              ]
            : [
                `Google shows about ${fmtInt(ie!.googleResults!)} results for site:${domain} versus ${fmtInt(ie!.sitemapUrls!)} URLs in your sitemap (${pct(Math.min(ratio, 9.99))}%). This is Google's rough estimate, not an exact index count.`,
              ],
        fix:
          status === "pass" || status === "na"
            ? "Use Search Console → Pages for the exact indexed count; the site: estimate is only a sanity check."
            : "A large share of sitemap URLs are not showing in Google. Open Search Console → Pages → Not indexed, and fix the top reasons in order: 'Crawled – currently not indexed' usually means thin or near-duplicate pages (improve or remove them), 'Discovered – not indexed' means crawl budget (link to the pages internally), 'Excluded by noindex' or 'Alternate page with canonical' means the sitemap lists URLs you told Google to ignore (remove them from the sitemap).",
        effort: "medium",
      })
    );
  }

  // vis.brand-share(V2, info):品牌词 / 非品牌词拆分
  {
    const def = d("vis.brand-share");
    const total = (v.brandKeywords ?? 0) + (v.nonBrandKeywords ?? 0);
    const share = total > 0 ? (v.brandKeywords ?? 0) / total : 0;
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status: "info",
        evidence: [
          `An estimated ${fmtInt(v.brandKeywords ?? 0)} brand vs ${fmtInt(v.nonBrandKeywords ?? 0)} non-brand keywords (${pct(share)}% brand), extrapolated from the top ${fmtInt(v.topKeywords.length)} keywords by search volume.`,
        ],
        fix:
          share > 0.5
            ? "Most of your rankings are people searching your name. That is loyalty, not discovery — grow non-brand rankings with pages that answer the questions buyers ask before they know you exist."
            : "Non-brand keywords dominate, which means search is bringing new people in. Keep the brand pages (pricing, reviews, alternatives) strong so those visitors can find you again.",
        effort: "medium",
      })
    );
  }

  // vis.ai-overview-share(V2, info):排名词 SERP 含 AI Overview 的占比,fix 放 AI 可见度审计入口
  {
    const def = d("vis.ai-overview-share");
    const share = v.aiOverviewShare ?? null;
    const sample = v.topKeywords.length;
    out.push(
      mk({
        ...def,
        dimension: "visibility",
        status: share === null ? "na" : "info",
        evidence: [
          share === null
            ? "No SERP feature data was returned for your ranking keywords."
            : `${pct(share)}% of your top ${fmtInt(sample)} ranking keywords show a Google AI Overview above the organic results (${fmtInt(Math.round(share * sample))} of ${fmtInt(sample)}).`,
        ],
        fix: "AI Overviews push organic results down the page, so ranking alone no longer guarantees the click. Check whether AI answers actually cite or recommend you: run a free AI visibility audit at https://aeoeye.com/ — it tests ChatGPT, Claude, Gemini, Google AI and Perplexity with real buyer questions.",
        effort: "low",
      })
    );
  }

  return out;
}

const COMPETITOR_DEFS = [
  { id: "comp.gap", severity: "medium" as Severity, weight: 3, docs: DOCS.helpfulContent },
  { id: "comp.list", severity: "low" as Severity, weight: 1, docs: DOCS.helpfulContent },
];

const COMPETITORS_NA_FIX =
  "Competitor analysis needs ranking data to work from. Once the site ranks for keywords (see Search Visibility), this section shows who else ranks for them, how far ahead they are, and which shared keywords are closest to flipping.";

function competitorChecks(c: CompetitorsResult | null, v: VisibilityResult | null, domain: string): SeoCheck[] {
  if (!c || c.noData || c.items.length === 0) return naChecks("competitors", COMPETITOR_DEFS, naWhy(c, domain, "competitor data"), COMPETITORS_NA_FIX);
  const out: SeoCheck[] = [];
  const d = (id: string) => COMPETITOR_DEFS.find((x) => x.id === id)!;
  const strongest = [...c.items].sort((a, b) => (b.etv ?? 0) - (a.etv ?? 0))[0];

  // comp.gap:最强竞品全域 etv / 本站 etv ≤3 pass;≤10 warn;否则 fail;本站 etv 未知 → na
  {
    const def = d("comp.gap");
    const ownEtv = v && !v.noData ? v.etv : null;
    const theirs = strongest?.etv ?? null;
    const ratio = ownEtv === null || theirs === null ? null : theirs / Math.max(ownEtv, 1);
    const status = ratio === null ? "na" : ratio <= 3 ? "pass" : ratio <= 10 ? "warn" : "fail";
    out.push(
      mk({
        ...def,
        dimension: "competitors",
        status,
        evidence:
          ratio === null
            ? ["Your own traffic estimate was unavailable, so the gap could not be measured."]
            : [
                `${strongest.domain} gets about ${fmtInt(theirs!)} organic visits/month versus your ${fmtInt(ownEtv!)} (${round1(ratio)}×), sharing ${fmtInt(strongest.intersections)} keywords with you.`,
              ],
        fix:
          status === "pass" || status === "na"
            ? "You are in the same league as your strongest competitor. Compete page by page: for each shared keyword where they outrank you, make your page the more complete answer."
            : `${strongest?.domain ?? "The leader"} is far ahead. Do not try to out-publish them; pick the 10 shared keywords where you already rank 4–20 and they rank top 3, and beat them on those pages specifically (more complete answer, fresher data, faster page, more internal links). Win a niche first, then widen.`,
        effort: "high",
      })
    );
  }

  // comp.list(info):列出前 5
  {
    const def = d("comp.list");
    out.push(
      mk({
        ...def,
        dimension: "competitors",
        status: "info",
        evidence: c.items.map(
          (it) =>
            `${it.domain} — ${fmtInt(it.intersections)} shared keywords, average position ${it.avgPosition ?? "n/a"}, ~${fmtInt(it.etv ?? 0)} visits/month, ${fmtInt(it.organicKeywords ?? 0)} ranking keywords.`
        ),
        fix: "These are the domains Google shows for the same searches as you (the world's top 1000 sites are excluded). Study their top pages for the keywords you share: what sections, data and formats do they have that you lack?",
        effort: "medium",
      })
    );
  }

  return out;
}

/** authority / visibility / competitors 三个付费维度的检查项;模块 null 或 noData 时对应维度全部 na */
export function paidChecks(
  a: AuthorityResult | null,
  v: VisibilityResult | null,
  c: CompetitorsResult | null,
  domain: string
): SeoCheck[] {
  const d = cleanDomain(domain);
  return [...authorityChecks(a, d), ...visibilityChecks(v, d), ...competitorChecks(c, v, d)];
}
