/* ============================================================
   SEO Audit · safeFetch —— 引擎里唯一允许对外发请求的地方

   V2(hardening)之后的结构:一条共享的"跳转循环"+ 两套传输层。
     · 跳转循环负责:协议/端口/凭据校验、每跳的主机名预检、Location
       按 RFC 相对规则解析、https→http 降级不跟随、≤maxRedirects、hops[]。
     · 传输层 A(生产):node:http / node:https 的 request(),带**自定义
       lookup** —— DNS 解析出的每一个地址在连接建立前都过 isPrivateIp,
       任何一个落在私网/环回/元数据段就断掉。这才是真正堵住 DNS
       rebinding 的位置:校验发生在"要连的那一刻",不是几十毫秒之前。
       解压(gzip/deflate/br)是流式的,maxBytes 按**解压后**的字节计,
       超过就 destroy 掉 socket —— 对方回一个 4KB 的 gzip 炸弹也撑不爆我们。
     · 传输层 B(测试):opts.fetchImpl 注入时走 fetch(redirect: manual),
       让纯函数测试不用起服务器。两条路共用同一个循环,所以降级/跳数/
       主机校验的行为在测试里验过的就是生产里跑的。

   为什么网络错误不抛而是 status 0 + error:抓 20–40 页时单页失败是
   常态,抛异常会让并发 worker 的控制流很难写;把失败当数据返回,
   上层(crawl / checks)自己决定怎么记账。
   ============================================================ */

import { request as httpRequest, Agent as HttpAgent, type IncomingMessage, type IncomingHttpHeaders, type ClientRequest } from "node:http";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { promises as dns } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import type { TLSSocket, PeerCertificate } from "node:tls";
import { createGunzip, createInflate, createInflateRaw, createBrotliDecompress } from "node:zlib";
import type { Readable } from "node:stream";
import { assertPublicHost, isBlockedHostname, isPrivateIp, SeoAuditError, type LookupFn } from "./url";
import { SEO_BOT_UA } from "./types";

/** 爬虫 UA —— 与 types.ts 的 SEO_BOT_UA 一致(必须真的有 /bot 说明页) */
export const USER_AGENT = SEO_BOT_UA;
export const DEFAULT_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;
/**
 * 跳转响应的正文最多排空这么多字节 / 这么久,超过就销毁 socket(复审 C10)。
 * 正常跳转的正文只有几百字节,1 秒内读完,连接照常回到 keep-alive 池;
 * 恶意站点回一个永不结束(或只发 1 字节就停住)的跳转正文时,不能让那条 socket 在
 * 我们返回之后继续全速收数据、或永远挂着 —— 收到响应头时 socket 的空闲超时已经关掉了。
 */
export const DISCARD_DRAIN_BYTES = 64 * 1024;
export const DISCARD_DRAIN_MS = 1_000;

/** 一跳的记录:请求的 URL、它返回的状态、它给的 Location(已解析成绝对地址) */
export interface FetchHop {
  url: string;
  status: number;
  location: string | null;
}

/** 第一跳 https 的证书摘要(来自 socket.getPeerCertificate()) */
export interface FetchTls {
  validTo: string | null;
  issuer: string | null;
  subjectAltNames: string[];
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  /** 最终响应的状态;网络层失败为 0 */
  status: number;
  headers: Headers;
  body: string;
  bytes: number;
  ms: number;
  /** redirect 目标按顺序排列(不含起始 url),所以 chain.length = 跳转次数 */
  chain: string[];
  /** 最终响应的 content-type,小写、含参数(如 "text/html; charset=utf-8") */
  contentType: string;
  error?: string;
  /** 每一跳的状态与 Location —— 变体探针要看"第一跳是 301 还是 302" */
  hops?: FetchHop[];
  /** 正文超过 maxBytes 被截断(按解压后的字节计) */
  truncated?: boolean;
  /** opts.raw = true 时保留原始字节(sitemap .gz 需要) */
  raw?: Uint8Array<ArrayBufferLike>;
  /** 最终那一跳从发出请求到收到响应头的毫秒数(首字节时间) */
  ttfbMs?: number;
  /** 第一跳 https 的证书(node 传输层才有) */
  tls?: FetchTls;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  /** 建连(含 TLS 握手)到收到响应头的上限;默认 min(5s, timeoutMs) */
  connectTimeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  method?: "GET" | "HEAD";
  accept?: string;
  /** 覆盖 UA —— 只用于移动一致性探针的 SEO_BOT_MOBILE_UA(复审 C39:不冒充浏览器或 Googlebot,被拦也不换 UA 重试) */
  userAgent?: string;
  /** 额外请求头(小写键) */
  headers?: Record<string, string>;
  /** 同时返回原始字节 */
  raw?: boolean;
  /** 测试注入用:替代全局 fetch(走传输层 B) */
  fetchImpl?: typeof fetch;
  /**
   * 测试注入用:替代主机校验。生产代码不要传。
   * 传了之后它既用于每跳的主机名预检,也用于连接时对每个解析地址的校验。
   */
  hostCheck?: (host: string) => Promise<void>;
  /** 测试注入用:替代 dns.lookup(node 传输层的连接时解析) */
  lookup?: LookupFn;
  /** 测试注入用:允许非默认端口(本地测试服务器只能绑随机端口)。生产代码不要传。 */
  allowNonDefaultPort?: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/* ---------- 共享工具 ---------- */

function sniffCharset(contentType: string, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  // 没有 header charset 时看前 2KB 的 <meta charset> —— 老站常见
  const probe = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  const fromMeta =
    /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(probe)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w.:-]+)/i.exec(probe)?.[1];
  return fromMeta || "utf-8";
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  if (!bytes.byteLength) return "";
  const charset = sniffCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function describeError(err: unknown): string {
  if (err instanceof SeoAuditError) return `${err.code}: ${err.message}`;
  const e = err as { cause?: { code?: string; message?: string }; code?: string; message?: string; name?: string };
  const cause = e?.cause;
  if (cause?.code) return `${cause.code}${cause.message ? `: ${cause.message}` : ""}`;
  if (cause?.message) return cause.message;
  if (e?.code) return `${e.code}${e.message ? `: ${e.message}` : ""}`;
  return e?.message || String(err);
}

/** 传输层返回的一跳响应:头部已到,正文按需读取 */
interface HopResponse {
  status: number;
  headers: Headers;
  ttfbMs: number;
  tls?: FetchTls;
  /** 读正文,最多 maxBytes(解压后);超过则截断并停止接收 */
  read(maxBytes: number): Promise<{ data: Uint8Array; truncated: boolean } | { error: string; timedOut?: boolean }>;
  /** 不要正文(redirect / HEAD):释放连接 —— 有界排空,超限就销毁 socket */
  discard(): void;
}

interface HopRequest {
  method: "GET" | "HEAD";
  headers: Record<string, string>;
  /** 本跳可用的总时间 */
  timeoutMs: number;
  connectTimeoutMs: number;
}

type HopOutcome = { ok: true; res: HopResponse } | { ok: false; error: string; timedOut?: boolean };

/* ---------- 传输层 B:fetch(测试注入) ---------- */

function fetchTransport(fetchImpl: typeof fetch): (target: URL, req: HopRequest) => Promise<HopOutcome> {
  return async (target, req) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), req.timeoutMs);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetchImpl(target.href, { method: req.method, redirect: "manual", signal: ac.signal, headers: req.headers });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = ac.signal.aborted || (e as { name?: string })?.name === "AbortError";
      return timedOut ? { ok: false, error: `Timed out after ${req.timeoutMs}ms`, timedOut: true } : { ok: false, error: describeError(e) };
    }
    const ttfbMs = Date.now() - t0;
    return {
      ok: true,
      res: {
        status: res.status,
        headers: res.headers,
        ttfbMs,
        discard: () => {
          clearTimeout(timer);
          res.body?.cancel().catch(() => undefined);
        },
        read: async (maxBytes) => {
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          let truncated = false;
          if (!res.body) {
            clearTimeout(timer);
            return { data: new Uint8Array(0), truncated: false };
          }
          const reader = res.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value) continue;
              const room = maxBytes - bytes;
              if (value.byteLength > room) {
                if (room > 0) chunks.push(value.subarray(0, room));
                bytes += Math.max(room, 0);
                truncated = true;
                await reader.cancel().catch(() => undefined);
                break;
              }
              chunks.push(value);
              bytes += value.byteLength;
            }
          } catch (e) {
            clearTimeout(timer);
            const timedOut = ac.signal.aborted || (e as { name?: string })?.name === "AbortError";
            return timedOut ? { error: `Timed out after ${req.timeoutMs}ms`, timedOut: true } : { error: describeError(e) };
          }
          clearTimeout(timer);
          return { data: concat(chunks, bytes), truncated };
        },
      },
    };
  };
}

/* ---------- 传输层 A:node:http(s) + 连接时地址校验 ---------- */

/** 复用连接:同站抓 20–40 页,TLS 握手只做一次 */
const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 16, timeout: 30_000 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 16, timeout: 30_000 });

const defaultLookup: LookupFn = (host, opts) => dns.lookup(host, opts);

type NodeLookupCallback = (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;
type NodeLookupOptions = number | { family?: number | string; all?: boolean; hints?: number } | undefined;

/**
 * 交给 net.connect 的 lookup:解析后**逐个地址**校验,任何一个私网就整个拒绝。
 * 注意 Node 对 IP 字面量不会调用 lookup,所以字面量必须在预检(nameCheck)里判掉。
 */
function makeSafeLookup(lookup: LookupFn, addressCheck: (address: string) => Promise<void>) {
  return (hostname: string, options: NodeLookupOptions, callback: NodeLookupCallback): void => {
    const opts = typeof options === "number" ? { family: options } : options ?? {};
    (async () => {
      if (isBlockedHostname(hostname)) throw new SeoAuditError("blocked", `"${hostname}" is not a public website.`);
      let addresses: { address: string; family: number }[];
      const literal = isIP(hostname);
      if (literal) addresses = [{ address: hostname, family: literal }];
      else addresses = await lookup(hostname, { all: true });
      if (!addresses.length) {
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
      }
      for (const a of addresses) await addressCheck(a.address);
      const wanted = opts.family === 4 || opts.family === 6 || opts.family === "IPv4" || opts.family === "IPv6" ? Number(String(opts.family).replace(/\D/g, "")) : 0;
      const filtered = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
      const use = filtered.length ? filtered : addresses;
      if (opts.all) callback(null, use);
      else callback(null, use[0].address, use[0].family);
    })().catch((e: unknown) => {
      const err = e instanceof Error ? (e as NodeJS.ErrnoException) : Object.assign(new Error(String(e)), { code: "ELOOKUP" });
      callback(err);
    });
  };
}

function toHeaders(h: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const x of values) {
      try {
        out.append(k, x);
      } catch {
        /* 非法头值(控制字符等)—— 丢掉这一个,不影响其他头 */
      }
    }
  }
  return out;
}

function certToTls(cert: PeerCertificate | undefined | null): FetchTls | undefined {
  if (!cert || !Object.keys(cert).length) return undefined;
  const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
  const issuer = (cert.issuer as Record<string, string> | undefined) ?? undefined;
  const sans = (cert.subjectaltname ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^dns:/i.test(s))
    .map((s) => s.slice(4).toLowerCase());
  return {
    validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null,
    issuer: issuer?.O ?? issuer?.CN ?? null,
    subjectAltNames: sans,
  };
}

/** zlib 头检测:deflate 有的服务器发裸 deflate(RFC 1951),有的发 zlib 包装(RFC 1950) */
function looksLikeZlib(first: Uint8Array): boolean {
  if (first.byteLength < 2) return false;
  const cmf = first[0];
  const flg = first[1];
  return (cmf & 0x0f) === 8 && ((cmf << 8) | flg) % 31 === 0;
}

/**
 * 把响应流按 content-encoding 解码成一个可读流。deflate 需要看第一个字节才能
 * 决定用 inflate 还是 inflateRaw,所以先攒第一块再接管道。
 */
function decodedStream(res: IncomingMessage, encoding: string, onReady: (s: Readable) => void): void {
  if (encoding === "gzip" || encoding === "x-gzip") return onReady(res.pipe(createGunzip()));
  if (encoding === "br") return onReady(res.pipe(createBrotliDecompress()));
  if (encoding === "deflate") {
    const first = (chunk: Buffer) => {
      res.pause();
      const inflate = looksLikeZlib(chunk) ? createInflate() : createInflateRaw();
      inflate.write(chunk);
      res.pipe(inflate);
      onReady(inflate);
      res.resume();
    };
    res.once("data", first);
    res.once("end", () => {
      // 空正文:从未触发 data
      res.removeListener("data", first);
      onReady(res);
    });
    return;
  }
  onReady(res);
}

function nodeTransport(lookup: LookupFn, addressCheck: (address: string) => Promise<void>): (target: URL, req: HopRequest) => Promise<HopOutcome> {
  return (target, req) =>
    new Promise<HopOutcome>((resolve) => {
      const isHttps = target.protocol === "https:";
      const t0 = Date.now();
      let settled = false;
      let responded = false;
      const done = (o: HopOutcome) => {
        if (settled) return;
        settled = true;
        resolve(o);
      };

      let clientReq: ClientRequest;
      try {
        clientReq = (isHttps ? httpsRequest : httpRequest)({
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (isHttps ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          method: req.method,
          headers: req.headers,
          agent: isHttps ? httpsAgent : httpAgent,
          lookup: makeSafeLookup(lookup, addressCheck) as unknown as LookupFunction,
          // 对方证书必须能验证 —— 证书错误当作抓取失败记录(sec.tls.* 会单独说明)
          rejectUnauthorized: true,
        });
      } catch (e) {
        return done({ ok: false, error: describeError(e) });
      }

      // 总时限:头到了以后正文也要在这个时间内读完
      const totalTimer = setTimeout(() => {
        clientReq.destroy(Object.assign(new Error(`Timed out after ${req.timeoutMs}ms`), { code: "ETIMEDOUT_TOTAL" }));
      }, req.timeoutMs);
      // 建连 + 首字节时限(socket 空闲计时;拿到响应头就解除)
      clientReq.setTimeout(Math.min(req.connectTimeoutMs, req.timeoutMs), () => {
        if (!responded) clientReq.destroy(Object.assign(new Error(`No response within ${req.connectTimeoutMs}ms (connect / first byte)`), { code: "ETIMEDOUT_CONNECT" }));
      });

      clientReq.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(totalTimer);
        if (e.code === "ETIMEDOUT_TOTAL") return done({ ok: false, error: `Timed out after ${req.timeoutMs}ms`, timedOut: true });
        if (e.code === "ETIMEDOUT_CONNECT") return done({ ok: false, error: e.message });
        done({ ok: false, error: describeError(e) });
      });

      clientReq.on("response", (res: IncomingMessage) => {
        responded = true;
        clientReq.setTimeout(0);
        const ttfbMs = Date.now() - t0;
        const status = res.statusCode ?? 0;
        const headers = toHeaders(res.headers);
        let tls: FetchTls | undefined;
        if (isHttps) {
          const sock = res.socket as TLSSocket | null;
          if (sock && typeof sock.getPeerCertificate === "function") {
            try {
              tls = certToTls(sock.getPeerCertificate());
            } catch {
              tls = undefined;
            }
          }
        }
        const noBody = req.method === "HEAD" || status === 204 || status === 304 || (status >= 100 && status < 200);

        done({
          ok: true,
          res: {
            status,
            headers,
            ttfbMs,
            tls,
            discard: () => {
              clearTimeout(totalTimer);
              // HEAD / 204 / 304 没有正文:resume 让 'end' 立刻到来,连接回池
              if (noBody || res.complete) {
                res.resume();
                return;
              }
              // 有界排空:64 KB 或 1 秒先到者为限,超了直接 destroy(连 socket 一起关掉)
              let drained = 0;
              const kill = setTimeout(() => res.destroy(), Math.max(1, Math.min(DISCARD_DRAIN_MS, req.timeoutMs)));
              const stop = () => clearTimeout(kill);
              res.on("data", (chunk: Buffer) => {
                drained += chunk.byteLength;
                if (drained > DISCARD_DRAIN_BYTES) {
                  stop();
                  res.destroy();
                }
              });
              res.once("end", stop);
              res.once("close", stop);
              // destroy 之后的 aborted / error 不能变成未捕获异常
              res.on("error", () => undefined);
              res.resume();
            },
            read: (maxBytes) =>
              new Promise((resolveRead) => {
                if (noBody) {
                  clearTimeout(totalTimer);
                  res.resume();
                  return resolveRead({ data: new Uint8Array(0), truncated: false });
                }
                const chunks: Uint8Array[] = [];
                let bytes = 0;
                let truncated = false;
                let finished = false;
                const finish = (v: { data: Uint8Array; truncated: boolean } | { error: string; timedOut?: boolean }) => {
                  if (finished) return;
                  finished = true;
                  clearTimeout(totalTimer);
                  resolveRead(v);
                };
                const encoding = (res.headers["content-encoding"] ?? "").toString().trim().toLowerCase();
                res.on("aborted", () => {
                  if (!truncated) finish({ error: "Connection closed before the response body was complete" });
                });
                res.on("error", (e: NodeJS.ErrnoException) => {
                  if (truncated) return;
                  if (e.code === "ETIMEDOUT_TOTAL") return finish({ error: e.message, timedOut: true });
                  finish({ error: describeError(e) });
                });
                decodedStream(res, encoding, (stream) => {
                  stream.on("data", (chunk: Buffer) => {
                    if (truncated) return;
                    const room = maxBytes - bytes;
                    if (chunk.byteLength > room) {
                      if (room > 0) chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, room));
                      bytes += Math.max(room, 0);
                      truncated = true;
                      // 到顶就断:对方还在发也不收了(解压炸弹在这里被掐断)
                      stream.removeAllListeners("data");
                      res.destroy();
                      finish({ data: concat(chunks, bytes), truncated: true });
                      return;
                    }
                    chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
                    bytes += chunk.byteLength;
                  });
                  stream.on("end", () => finish({ data: concat(chunks, bytes), truncated }));
                  stream.on("error", (e: Error) => {
                    if (truncated) return;
                    finish({ error: `Could not decode ${encoding || "response"} body: ${describeError(e)}` });
                  });
                });
              }),
          },
        });
      });

      clientReq.end();
    });
}

/* ---------- 预检 ---------- */

/** node 传输层的主机名预检:名字黑名单 + IP 字面量直判;域名的地址校验交给连接时的 lookup */
async function nameCheck(host: string): Promise<void> {
  if (isBlockedHostname(host)) throw new SeoAuditError("blocked", `"${host}" is not a public website.`);
  if (isIP(host) && isPrivateIp(host)) throw new SeoAuditError("blocked", `"${host}" is not a public IP address.`);
}

async function defaultAddressCheck(address: string): Promise<void> {
  if (isPrivateIp(address)) throw new SeoAuditError("blocked", `"${address}" is not a public address.`);
}

/* ---------- 主函数 ---------- */

/**
 * 受控的 HTTP 请求。永远不抛:任何失败都体现为 status 0 + error。
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const connectTimeoutMs = opts.connectTimeoutMs ?? Math.min(DEFAULT_CONNECT_TIMEOUT_MS, timeoutMs);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const method = opts.method ?? "GET";
  const accept = opts.accept ?? DEFAULT_ACCEPT;

  const usingFetch = !!opts.fetchImpl;
  // 预检:fetch 路径沿用 assertPublicHost(含 DNS);node 路径只做名字/字面量,DNS 校验下沉到连接时
  const hostCheck = opts.hostCheck ?? (usingFetch ? assertPublicHost : nameCheck);
  const addressCheck = opts.hostCheck ?? defaultAddressCheck;
  const transport = usingFetch ? fetchTransport(opts.fetchImpl as typeof fetch) : nodeTransport(opts.lookup ?? defaultLookup, addressCheck);

  const requestHeaders: Record<string, string> = {
    "user-agent": opts.userAgent ?? USER_AGENT,
    accept,
    "accept-language": "en-US,en;q=0.9",
    ...(usingFetch ? {} : { "accept-encoding": "gzip, deflate, br" }),
    ...(opts.headers ?? {}),
  };

  const start = Date.now();
  const deadline = start + timeoutMs;
  const chain: string[] = [];
  const hops: FetchHop[] = [];
  let current = url;
  let firstTls: FetchTls | undefined;

  const fail = (error: string, status = 0, headers?: Headers, contentType = ""): FetchResult => {
    const r: FetchResult = {
      url,
      finalUrl: current,
      status,
      headers: headers ?? new Headers(),
      body: "",
      bytes: 0,
      ms: Date.now() - start,
      chain,
      contentType,
      error,
      hops,
    };
    if (firstTls) r.tls = firstTls;
    return r;
  };

  for (let hop = 0; ; hop++) {
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      return fail(`Invalid URL: ${current}`);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return fail(`Unsupported protocol: ${target.protocol}`);
    }
    if (target.port && !opts.allowNonDefaultPort) return fail(`Non-default port ${target.port} is not allowed`);
    if (target.username || target.password) return fail("Credentials in URL are not allowed");

    // 每一跳都重新验主机 —— 这是 SSRF 防线的第二道锁(第三道在连接时的 lookup 里)
    try {
      await hostCheck(target.hostname);
    } catch (e) {
      const msg = e instanceof SeoAuditError ? `${e.code}: ${e.message}` : `blocked: ${String(e)}`;
      return fail(msg);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail(`Timed out after ${timeoutMs}ms`);

    const outcome = await transport(target, { method, headers: requestHeaders, timeoutMs: remaining, connectTimeoutMs });
    if (!outcome.ok) return fail(outcome.timedOut ? `Timed out after ${timeoutMs}ms` : outcome.error);
    const res = outcome.res;
    if (target.protocol === "https:" && !firstTls && res.tls) firstTls = res.tls;

    const contentType = (res.headers.get("content-type") ?? "").trim().toLowerCase();
    const rawLocation = res.headers.get("location");
    let location: string | null = null;
    if (rawLocation) {
      try {
        const loc = new URL(rawLocation, target.href);
        loc.hash = ""; // 与 chain 保持一致:fragment 不参与请求
        location = loc.href;
      } catch {
        location = null;
      }
    }
    hops.push({ url: target.href, status: res.status, location });

    if (REDIRECT_STATUSES.has(res.status) && rawLocation) {
      res.discard();
      if (!location) return fail(`Invalid redirect Location: ${rawLocation}`, res.status, res.headers, contentType);
      if (hop >= maxRedirects) {
        return fail(`Too many redirects (more than ${maxRedirects})`, res.status, res.headers, contentType);
      }
      const next = new URL(location);
      next.hash = "";
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        return fail(`Unsupported protocol in redirect: ${next.protocol}`, res.status, res.headers, contentType);
      }
      // https → http 降级不跟随:跟了等于把用户的安全页面换成明文页面来评分
      if (target.protocol === "https:" && next.protocol === "http:") {
        return fail(`downgrade: ${target.href} redirects to insecure ${next.href} (not followed)`, res.status, res.headers, contentType);
      }
      chain.push(next.href);
      current = next.href;
      continue;
    }

    // 最终响应:读正文(HEAD 不读),到 maxBytes 就截断
    let data: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let truncated = false;
    if (method === "HEAD") {
      res.discard();
    } else {
      const body = await res.read(maxBytes);
      if ("error" in body) return fail(body.timedOut ? `Timed out after ${timeoutMs}ms` : body.error, 0, res.headers, contentType);
      data = body.data;
      truncated = body.truncated;
    }

    const result: FetchResult = {
      url,
      finalUrl: target.href,
      status: res.status,
      headers: res.headers,
      body: decodeBody(data, contentType),
      bytes: data.byteLength,
      ms: Date.now() - start,
      chain,
      contentType,
      hops,
      ttfbMs: res.ttfbMs,
    };
    if (truncated) result.truncated = true;
    if (opts.raw) result.raw = data;
    if (firstTls) result.tls = firstTls;
    return result;
  }
}
