/* ============================================================
   SEO Audit · URL 规范化 + SSRF 防线

   这是整个抓取引擎的第一道门:用户给的任何字符串都先经过这里,
   变成一个"我们敢去抓"的 http(s) URL。

   为什么 SSRF 要在这一层就挡:审计引擎跑在 Vercel 的服务端,
   拿着用户输入去发请求。如果放过 `http://169.254.169.254/` 或
   `http://10.0.0.5:5432`,等于把内网探针免费送给任何人。所以:
     · 只认 http/https、只认默认端口、拒绝 URL 里带账号密码;
     · 主机名先过黑名单(localhost/*.local/*.internal/*.localhost);
     · 再做 DNS 解析,**所有**返回地址(v4 + v6,含 IPv4-mapped v6)
       只要有一个落在私网/环回/链路本地/元数据/CGNAT 段就拒绝。
   fetch.ts 会在每一跳 redirect 上重新调用 assertPublicHost,
   所以"先跳到公网再 302 回内网"这条路也走不通。

   已知盲区(如实写下,别当成全量防护):DNS rebinding —— 我们查
   一次 DNS、fetch 再查一次,两次之间攻击者可以换解析结果。要彻底
   堵需要把解析到的 IP 钉死到连接层(自定义 dispatcher),本期不做。
   ============================================================ */

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export type SeoAuditErrorCode = "invalid" | "blocked" | "unreachable" | "timeout" | "unconfigured";

const DEFAULT_MESSAGES: Record<SeoAuditErrorCode, string> = {
  invalid: "Enter a valid website address, e.g. example.com or https://example.com/page.",
  blocked: "That host is not a public website, so it cannot be audited.",
  unreachable: "We could not reach that host.",
  timeout: "The site took too long to respond.",
  unconfigured: "This feature is not configured on the server.",
};

export class SeoAuditError extends Error {
  code: SeoAuditErrorCode;
  constructor(code: SeoAuditErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "SeoAuditError";
    this.code = code;
  }
}

/* ---------- 输入规范化 ---------- */

/** 单个 DNS 标签:字母数字与连字符,不能以连字符开头/结尾,≤63 */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** 去掉 IPv6 字面量的方括号、尾点、zone id,统一小写 */
function cleanHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .split("%")[0];
}

/**
 * 语法层面的主机名校验。策略(私网、localhost)不在这里判,
 * 交给 assertPublicHost —— 这样 "localhost" 会被报成 blocked 而不是 invalid,
 * 用户看到的错误信息才对得上。
 */
function isSyntacticallyValidHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (isIP(host)) return true;
  const labels = host.split(".");
  if (!labels.every((l) => HOST_LABEL.test(l))) return false;
  // 没有点的裸主机名(intranet 风格)永远不可能是公网站点 —— localhost 例外,
  // 它要走到 assertPublicHost 才能给出"blocked"这个更准确的答案。
  return labels.length >= 2 || host === "localhost";
}

/**
 * 把用户输入变成可抓取的入口 URL。
 * 接受 "example.com"、"www.example.com/blog"、"https://Example.COM/x?y#z";
 * 补 https、主机小写、去 #fragment、保留路径与查询串。
 * 抛 SeoAuditError("invalid")。
 */
export function normalizeInput(input: string): { entryUrl: string; origin: string; host: string; domain: string } {
  const raw = (input ?? "").trim();
  if (raw.length < 3 || raw.length > 200) {
    throw new SeoAuditError("invalid", "Enter a domain or URL between 3 and 200 characters.");
  }

  // 只有真正带 "scheme://" 的才当作已有协议;"example.com:8080" 这种冒号不算协议
  let candidate = raw;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    throw new SeoAuditError("invalid");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SeoAuditError("invalid", "Only http and https URLs can be audited.");
  }
  if (u.username || u.password) {
    throw new SeoAuditError("invalid", "URLs with embedded credentials are not supported.");
  }
  // new URL 已经把默认端口(80/443)吞掉了,剩下的一律是非默认端口
  if (u.port) {
    throw new SeoAuditError("invalid", "Only the default ports (80 for http, 443 for https) are supported.");
  }

  const host = cleanHost(u.hostname);
  if (!isSyntacticallyValidHost(host)) {
    throw new SeoAuditError("invalid");
  }

  // IPv6 字面量在 URL 里必须带方括号
  const hostForUrl = isIP(host) === 6 ? `[${host}]` : host;
  const origin = `${u.protocol}//${hostForUrl}`;
  const entryUrl = `${origin}${u.pathname}${u.search}`;

  return { entryUrl, origin, host, domain: registrableDomain(host) };
}

/** 去掉 www.(以及尾点、大小写)—— 报告里的"域名"就是这个 */
export function registrableDomain(host: string): string {
  return cleanHost(host).replace(/^www\./, "");
}

/** 同站判定:同一 host,或 www./裸域互认 */
export function isSameSite(url: string, host: string): boolean {
  try {
    const h = new URL(url).hostname;
    return registrableDomain(h) === registrableDomain(host);
  } catch {
    return false;
  }
}

/* ---------- 私网地址判定(纯函数,可单测) ---------- */

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

/** [网段起点, 前缀长度] —— 全部是 IANA 标记为非全球可路由的段 */
const V4_BLOCKED: [number, number][] = (
  [
    ["0.0.0.0", 8], // "this network"
    ["10.0.0.0", 8], // 私网
    ["100.64.0.0", 10], // CGNAT 共享地址
    ["127.0.0.0", 8], // 环回
    ["169.254.0.0", 16], // 链路本地 + 云元数据(169.254.169.254)
    ["172.16.0.0", 12], // 私网
    ["192.0.0.0", 24], // IETF 协议分配
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.168.0.0", 16], // 私网
    ["198.18.0.0", 15], // 基准测试
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // 组播
    ["240.0.0.0", 4], // 保留 + 广播
  ] as [string, number][]
).map(([ip, prefix]) => [v4ToInt(ip) as number, prefix]);

function inV4Block(n: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((n & mask) >>> 0) === ((base & mask) >>> 0);
}

function isPrivateV4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return true; // 解析不了的一律当不安全
  return V4_BLOCKED.some(([base, prefix]) => inV4Block(n, base, prefix));
}

/** 把 IPv6 展开成 8 个 16 位数;支持 "::" 压缩与尾部内嵌 IPv4(::ffff:1.2.3.4) */
function expandV6(ip: string): number[] | null {
  let s = ip;
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = v4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;
  const groups = [...head, ...(halves.length === 2 ? new Array<string>(missing).fill("0") : []), ...tail].map((g) =>
    /^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN
  );
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const leadingZeros = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (leadingZeros(8)) return true; // :: 未指定
  if (leadingZeros(7) && g[7] === 1) return true; // ::1 环回
  // ::ffff:a.b.c.d(IPv4-mapped)与 ::a.b.c.d(IPv4-compatible):按内嵌的 v4 判
  if (leadingZeros(5) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(v4FromGroups(g[6], g[7]));
  // 64:ff9b::/96 NAT64 —— 同样按内嵌 v4 判
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateV4(v4FromGroups(g[6], g[7]));
  }
  if (g[0] === 0x2002) return isPrivateV4(v4FromGroups(g[1], g[2])); // 6to4 2002::/16
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32,目标不可控,保守拒绝
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 文档用
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 黑洞
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 站点本地(已废弃但仍要挡)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 组播
  return false;
}

/** 任一 IPv4/IPv6 字面量是否属于不可抓取的段。解析失败也算 true(宁可错杀)。 */
export function isPrivateIp(ip: string): boolean {
  const v = cleanHost(ip);
  const family = isIP(v);
  if (family === 4) return isPrivateV4(v);
  if (family === 6) return isPrivateV6(v);
  return true;
}

/** 名字层面就该拒绝的主机 —— 不用查 DNS */
export function isBlockedHostname(host: string): boolean {
  const h = cleanHost(host);
  if (!h || h === "localhost") return true;
  return [".localhost", ".local", ".internal", ".home.arpa"].some((suffix) => h.endsWith(suffix));
}

export type LookupFn = (host: string, opts: { all: true }) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (host, opts) => dns.lookup(host, opts);

/**
 * 主机必须解析到公网地址才放行。
 * 名字黑名单 → IP 字面量直判 → DNS 全部地址逐个判。
 * 抛 SeoAuditError("blocked")(私网)或 ("unreachable")(解析失败)。
 * 第二个参数只给测试注入用,生产代码不要传。
 */
export async function assertPublicHost(host: string, lookup: LookupFn = defaultLookup): Promise<void> {
  const h = cleanHost(host);
  if (isBlockedHostname(h)) {
    throw new SeoAuditError("blocked", `"${h}" is not a public website.`);
  }
  if (isIP(h)) {
    if (isPrivateIp(h)) throw new SeoAuditError("blocked", `"${h}" is not a public IP address.`);
    return;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(h, { all: true });
  } catch {
    throw new SeoAuditError("unreachable", `DNS lookup failed for "${h}".`);
  }
  if (!addresses.length) {
    throw new SeoAuditError("unreachable", `"${h}" does not resolve to any address.`);
  }
  for (const a of addresses) {
    if (isPrivateIp(a.address)) {
      throw new SeoAuditError("blocked", `"${h}" resolves to a non-public address.`);
    }
  }
}

/* ---------- 抓取用的 URL 归一(供 crawl / parse) ---------- */

const TRACKING_PARAMS = new Set([
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "_ga",
  "_gl",
  "srsltid",
]);

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("utm_") || TRACKING_PARAMS.has(n);
}

/**
 * 链接归一:解析(可带 base)、只留 http(s)、去 #fragment、去追踪参数、主机小写。
 * 不动路径大小写与尾斜杠 —— 那是站点自己的 URL 设计,改了会把"链到 301"的信号抹掉。
 * 返回 null 表示这不是一个可抓取的链接(mailto:、javascript:、带凭据等)。
 */
export function normalizeUrl(url: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  const drop: string[] = [];
  u.searchParams.forEach((_v, k) => {
    if (isTrackingParam(k)) drop.push(k);
  });
  for (const k of drop) u.searchParams.delete(k);
  // searchParams 为空时 URL 仍可能序列化出孤零零的 "?",清掉
  if (!u.searchParams.toString()) u.search = "";
  return u.href;
}

/**
 * 去重键:协议无关、www 无关、尾斜杠无关。
 * 同一个页面被写成 http://example.com/about/ 和 https://www.example.com/about,
 * 抓一次就够 —— 但抓的是先看到的那种写法,redirect 信号照常保留。
 */
export function dedupeKey(url: string): string {
  const n = normalizeUrl(url);
  if (!n) return url;
  const u = new URL(n);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${registrableDomain(u.hostname)}${path}${u.search}`;
}
