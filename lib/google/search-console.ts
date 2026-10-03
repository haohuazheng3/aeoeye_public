import { createPrivateKey, sign as cryptoSign, type KeyObject } from "node:crypto";
import { env } from "@/lib/env";

/* ============================================================
   Google Search Console API —— 服务账号只读客户端(SEO Ranking Score v2,2026-10-02)

   为什么自己签 JWT 而不引 googleapis:只用到 3 个端点(换 token / sites.list / searchAnalytics.query),
   为它拉一个几十 MB 的 SDK 不值;node:crypto 原生支持 RS256。

   三条硬规则:
   1. scope **只申请 webmasters.readonly**。服务账号对属性的访问是站长授予的,我们永远只读 ——
      即使站长误给了 Full 权限,这把 token 也改不了他的任何设置。
   2. 错误信息里绝不出现私钥、JWT assertion 或 access token:报错文案只拼 HTTP 状态码与 Google 返回的
      error / message 字段,并再过一遍 scrub() 兜底(这些文案会进错误收件箱与日志)。
   3. 每次请求 15s 超时;4xx(含 429)不重试 —— 请求本身有问题或配额已满,重试只会更糟;
      网络错误 / 5xx 原地重试 1 次(退避 0.8s);超时不重试(已经等了 15s,再等一轮用户就走了)。

   token 进程内缓存到过期前 1 分钟;并发调用共用同一个在途请求(pullGscData 一次并发 5 个查询)。

   凭据:优先用专给客户接入的 GSC_SERVICE_ACCOUNT_B64,没设才退回 GOOGLE_SERVICE_ACCOUNT_B64(运维脚本那把)。
   专用账号设了但解析失败时**不**退回运维账号:那会把运维账号的邮箱静默地发给客户去授权。
   ============================================================ */

/** 唯一申请的 scope —— 测试断言 JWT 里就是这一个 */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const QUERY_URL = (property: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 800;
/** Google 允许的最长 assertion 有效期 */
const ASSERTION_LIFETIME_S = 3600;
/** 过期前 1 分钟就换新:防止"拿到时还有效、发出去时刚好过期" */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GscSite {
  siteUrl: string;
  /** siteOwner | siteFullUser | siteRestrictedUser | siteUnverifiedUser */
  permissionLevel: string;
}

export type SearchAnalyticsDimension = "query" | "page" | "country" | "device" | "date" | "searchAppearance";

export interface SearchAnalyticsBody {
  startDate: string;
  endDate: string;
  dimensions?: SearchAnalyticsDimension[];
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  rowLimit?: number;
  startRow?: number;
  aggregationType?: "auto" | "byPage" | "byProperty";
  dataState?: "final" | "all";
  dimensionFilterGroups?: {
    groupType?: "and";
    filters: { dimension: SearchAnalyticsDimension; operator?: string; expression: string }[];
  }[];
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  /** 0-1 的小数(不是百分比) */
  ctr: number;
  position: number;
}

export type GscErrorCode =
  | "unconfigured"
  | "bad_key"
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "bad_request"
  | "upstream"
  | "timeout"
  | "network";

export class GscError extends Error {
  code: GscErrorCode;
  /** HTTP 状态码;网络错误 / 超时 / 配置问题为 null */
  status: number | null;
  constructor(code: GscErrorCode, message: string, status: number | null = null) {
    super(scrub(message));
    this.name = "GscError";
    this.code = code;
    this.status = status;
  }
}

/* ---------- 凭据 ---------- */

interface ServiceAccount {
  clientEmail: string;
  privateKey: KeyObject;
  tokenUri: string;
  keyId: string | null;
}

type KeyState = { ok: true; value: ServiceAccount } | { ok: false; error: GscError };
let keyCache: { raw: string; state: KeyState } | null = null;

/**
 * token_uri 只认 https 的 *.googleapis.com:它会成为 JWT 的 aud 与我们 POST assertion 的目标,
 * 凭据文件被篡改时不能把签好名的 assertion 送到别处。
 */
function safeTokenUri(v: unknown): string {
  if (typeof v !== "string") return DEFAULT_TOKEN_URI;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.endsWith(".googleapis.com") ? u.href : DEFAULT_TOKEN_URI;
  } catch {
    return DEFAULT_TOKEN_URI;
  }
}

/**
 * GOOGLE_SERVICE_ACCOUNT_B64 = base64(服务账号 JSON)。也容忍直接贴 JSON(以 { 开头)。
 * 任何解析失败都只报"格式不对",绝不把内容带进错误信息。
 */
function parseServiceAccount(raw: string): ServiceAccount {
  const trimmed = raw.trim();
  let obj: Record<string, unknown>;
  try {
    const text = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new GscError("bad_key", "GOOGLE_SERVICE_ACCOUNT_B64 is not base64-encoded service-account JSON.");
  }
  const clientEmail = typeof obj.client_email === "string" ? obj.client_email.trim() : "";
  const pem = typeof obj.private_key === "string" ? obj.private_key : "";
  if (!clientEmail.includes("@") || !pem.includes("PRIVATE KEY")) {
    throw new GscError("bad_key", "The service-account JSON is missing client_email or private_key.");
  }
  let privateKey: KeyObject;
  try {
    // 有的平台把换行存成字面量 "\n",这里还原
    privateKey = createPrivateKey(pem.replace(/\\n/g, "\n"));
  } catch {
    throw new GscError("bad_key", "The service-account private_key could not be loaded.");
  }
  return {
    clientEmail,
    privateKey,
    tokenUri: safeTokenUri(obj.token_uri),
    keyId: typeof obj.private_key_id === "string" && obj.private_key_id ? obj.private_key_id : null,
  };
}

export type GscCredentialSource = "GSC_SERVICE_ACCOUNT_B64" | "GOOGLE_SERVICE_ACCOUNT_B64";

/**
 * 当前生效的凭据来源(健康检查 / 运维看"实际生效值",而不是变量有没有设)。
 * 专用变量直接读 process.env:它不一定在 lib/env.ts 的 schema 里,而且运行时读到的才是生效值。
 */
export function gscCredentialSource(): GscCredentialSource | null {
  if ((process.env.GSC_SERVICE_ACCOUNT_B64 ?? "").trim()) return "GSC_SERVICE_ACCOUNT_B64";
  if ((env.GOOGLE_SERVICE_ACCOUNT_B64 ?? "").trim()) return "GOOGLE_SERVICE_ACCOUNT_B64";
  return null;
}

function rawCredential(): string {
  const source = gscCredentialSource();
  if (source === "GSC_SERVICE_ACCOUNT_B64") return process.env.GSC_SERVICE_ACCOUNT_B64 ?? "";
  if (source === "GOOGLE_SERVICE_ACCOUNT_B64") return env.GOOGLE_SERVICE_ACCOUNT_B64;
  return "";
}

function keyState(): KeyState {
  const raw = rawCredential();
  if (keyCache && keyCache.raw === raw) return keyCache.state;
  let state: KeyState;
  if (!raw.trim()) {
    state = { ok: false, error: new GscError("unconfigured", "Neither GSC_SERVICE_ACCOUNT_B64 nor GOOGLE_SERVICE_ACCOUNT_B64 is set.") };
  } else {
    try {
      state = { ok: true, value: parseServiceAccount(raw) };
    } catch (e) {
      state = { ok: false, error: e instanceof GscError ? e : new GscError("bad_key", "The service-account key could not be parsed.") };
    }
  }
  keyCache = { raw, state };
  return state;
}

function serviceAccount(): ServiceAccount {
  const s = keyState();
  if (!s.ok) throw s.error;
  return s.value;
}

/** 站长要在 Search Console 里添加的邮箱;未配置 / 凭据损坏 → null(永不抛) */
export function serviceAccountEmail(): string | null {
  const s = keyState();
  return s.ok ? s.value.clientEmail : null;
}

/** Search Console 接入能不能用(凭据在且能解析) */
export function gscConfigured(): boolean {
  return keyState().ok;
}

/* ---------- JWT(RS256)与 token ---------- */

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * 服务账号 JWT assertion(RFC 7523)。纯函数(给定 iat),单测直接解码校验 scope 与签名。
 */
export function buildJwtAssertion(
  sa: { clientEmail: string; privateKey: KeyObject | string; tokenUri?: string; keyId?: string | null },
  iatSec: number
): string {
  const header = { alg: "RS256", typ: "JWT", ...(sa.keyId ? { kid: sa.keyId } : {}) };
  const claims = {
    iss: sa.clientEmail,
    scope: GSC_SCOPE,
    aud: sa.tokenUri || DEFAULT_TOKEN_URI,
    iat: iatSec,
    exp: iatSec + ASSERTION_LIFETIME_S,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = cryptoSign("RSA-SHA256", Buffer.from(unsigned), sa.privateKey);
  return `${unsigned}.${b64url(signature)}`;
}

/** token 记着是哪个服务账号换来的:凭据切换(专用账号上线)后旧 token 立即作废 */
let tokenCache: { email: string; token: string; expiresAt: number } | null = null;
let tokenInflight: { email: string; promise: Promise<{ email: string; token: string; expiresAt: number }> } | null = null;

/** 只给测试 / 运维脚本用:清掉进程内的 token 与凭据缓存 */
export function resetSearchConsoleCache(): void {
  tokenCache = null;
  tokenInflight = null;
  keyCache = null;
}

export interface GscRequestOpts {
  fetchImpl?: FetchLike;
  /** 毫秒时间戳来源(测试注入,用来验证缓存过期) */
  now?: () => number;
}

/**
 * 只读 access token。缓存到过期前 1 分钟;并发调用共用一个在途请求。
 * 失败抛 GscError(信息里没有 assertion / token)。
 */
export async function gscToken(opts: GscRequestOpts = {}): Promise<string> {
  const now = opts.now ?? Date.now;
  const sa = serviceAccount();
  if (tokenCache && tokenCache.email === sa.clientEmail && now() < tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.token;
  }
  let inflight = tokenInflight;
  if (!inflight || inflight.email !== sa.clientEmail) {
    const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
    const promise = (async () => {
      const issuedAt = now();
      const assertion = buildJwtAssertion(sa, Math.floor(issuedAt / 1000));
      const json = await requestJson<{ access_token?: unknown; expires_in?: unknown }>(
        fetchImpl,
        sa.tokenUri,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
        },
        "Google token exchange"
      );
      const token = typeof json.access_token === "string" ? json.access_token : "";
      if (!token) throw new GscError("auth", "Google token exchange returned no access_token.");
      const ttlSec = Number(json.expires_in);
      const expiresAt = issuedAt + (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 3600) * 1000;
      const fresh = { email: sa.clientEmail, token, expiresAt };
      tokenCache = fresh;
      return fresh;
    })();
    const mine = { email: sa.clientEmail, promise };
    inflight = mine;
    tokenInflight = mine;
    // 无论成败都要清掉在途标记,否则一次失败会永久卡住后续调用(只清自己那一个,不误清后来的)
    const clear = () => {
      if (tokenInflight === mine) tokenInflight = null;
    };
    promise.then(clear, clear);
  }
  return (await inflight.promise).token;
}

/* ---------- 请求与错误 ---------- */

/**
 * 兜底脱敏:错误文案只该含状态码与 Google 的 error 字段,但万一上游把 token / JWT / PEM 回显出来,
 * 这里再抹一次 —— 这些文案会进错误收件箱。
 */
function scrub(s: string): string {
  return (s || "")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted key]")
    .replace(/ya29\.[\w.-]+/g, "[redacted token]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted jwt]")
    .slice(0, 400);
}

/**
 * 403 有两种含义:没有该属性的权限(站长没加 / 已移除我们),或者配额用尽(部分 Google API 用 403 报配额)。
 * 后者绝不能当成"站长撤销了授权"—— 那会让重跑把已接入报告的数据清掉。按错误详情区分。
 */
function codeForStatus(status: number, detail = ""): GscErrorCode {
  if (status === 401) return "auth";
  if (status === 403) return /quota|rate.?limit/i.test(detail) ? "rate_limited" : "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream";
  return "bad_request";
}

/** Google 两种错误体:API 的 { error: { message, status } } 与 OAuth 的 { error, error_description } */
async function errorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: unknown; error_description?: unknown };
      if (j.error && typeof j.error === "object") {
        const e = j.error as { message?: unknown; status?: unknown };
        return [e.status, e.message].filter((x) => typeof x === "string" && x).join(": ").slice(0, 200);
      }
      return [j.error, j.error_description].filter((x) => typeof x === "string" && x).join(": ").slice(0, 200);
    } catch {
      return text.replace(/\s+/g, " ").trim().slice(0, 120);
    }
  } catch {
    return "";
  }
}

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit, what: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      // no-store:Next 的 Data Cache 会缓存路由里的 GET fetch(与 db 驱动禁缓存同一个教训,E13)
      res = await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      if (isTimeout(e)) throw new GscError("timeout", `${what} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      const cause = (e as { cause?: { code?: unknown } })?.cause?.code;
      throw new GscError("network", `${what} failed: network error${typeof cause === "string" ? ` (${cause})` : ""}.`);
    }
    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        throw new GscError("upstream", `${what} returned an unreadable response.`, res.status);
      }
    }
    const detail = await errorDetail(res);
    if (res.status >= 500 && attempt === 0) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new GscError(codeForStatus(res.status, detail), `${what} returned HTTP ${res.status}${detail ? ` (${detail})` : ""}.`, res.status);
  }
}

/** 带 token 的 GSC API 请求;401 说明缓存的 token 已失效 —— 清掉缓存,下次调用重新换(本次不重试) */
async function gscApi<T>(url: string, init: RequestInit, what: string, opts: GscRequestOpts): Promise<T> {
  const token = await gscToken(opts);
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  try {
    return await requestJson<T>(fetchImpl, url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }, what);
  } catch (e) {
    if (e instanceof GscError && e.code === "auth") tokenCache = null;
    throw e;
  }
}

/* ---------- 端点 ---------- */

/** 服务账号能看到的全部属性(sites.list)。siteEntry 缺省 = 一个都没有 */
export async function listSites(opts: GscRequestOpts = {}): Promise<GscSite[]> {
  const json = await gscApi<{ siteEntry?: unknown }>(SITES_URL, { method: "GET" }, "Search Console sites.list", opts);
  const entries = Array.isArray(json.siteEntry) ? json.siteEntry : [];
  const out: GscSite[] = [];
  for (const e of entries) {
    const siteUrl = (e as { siteUrl?: unknown })?.siteUrl;
    const permissionLevel = (e as { permissionLevel?: unknown })?.permissionLevel;
    if (typeof siteUrl === "string" && siteUrl) out.push({ siteUrl, permissionLevel: typeof permissionLevel === "string" ? permissionLevel : "" });
  }
  return out;
}

/** 属性写法只有两种:sc-domain:example.com 或完整的 URL 前缀(http/https) */
export function isValidProperty(property: string): boolean {
  return /^sc-domain:[a-z0-9.-]+$/i.test(property) || /^https?:\/\/[^\s/]+\/\S*$/i.test(property);
}

/**
 * searchAnalytics.query。返回行(没有数据 = 空数组;Google 对"无数据"直接省略 rows)。
 * 数字一律转成 number:上游偶尔给字符串,下游计分会被 NaN 污染。
 */
export async function searchAnalyticsQuery(
  property: string,
  body: SearchAnalyticsBody,
  opts: GscRequestOpts = {}
): Promise<SearchAnalyticsRow[]> {
  if (!isValidProperty(property)) throw new GscError("bad_request", `Not a Search Console property: "${property.slice(0, 80)}".`);
  const json = await gscApi<{ rows?: unknown }>(
    QUERY_URL(property),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    "Search Console searchAnalytics.query",
    opts
  );
  const rows = Array.isArray(json.rows) ? json.rows : [];
  return rows.map((r) => {
    const row = r as { keys?: unknown; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown };
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      keys: Array.isArray(row.keys) ? row.keys.map((k) => String(k)) : [],
      clicks: num(row.clicks),
      impressions: num(row.impressions),
      ctr: num(row.ctr),
      position: num(row.position),
    };
  });
}
