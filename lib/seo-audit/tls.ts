/* ============================================================
   SEO Audit · TLS 证书检查

   safeFetch 只在"能连上"时顺手带回证书;这里单独做一次握手,是为了
   在证书**有问题**(过期 / 主机名不符 / 自签)时也能给出细节:
     1. rejectUnauthorized: true 先握一次 —— 失败即拿到明确的错误码;
     2. 失败后再用 rejectUnauthorized: false 握一次,只为读出 validTo /
        issuer / SAN,报告里才能写"过期 12 天"而不是一句"握手失败"。
   第二次握手不发任何 HTTP 请求,读完证书立刻断开。

   主机名照样过 SSRF 校验(名字黑名单 + 连接时逐地址判私网)。

   复审 C21:另一主机(www.<host> 或裸域)在 DNS 里根本不存在时 coversWww = null ——
   blog.example.com 没有 www.blog.example.com,"证书不覆盖 www"这句话无从谈起,
   一个解析不到的主机也不可能"弹浏览器证书警告"。只有连上了但证书校验失败才记 false。
   ============================================================ */

import { connect as tlsConnect, type ConnectionOptions, type TLSSocket, type PeerCertificate } from "node:tls";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { isBlockedHostname, isPrivateIp, registrableDomain, type LookupFn } from "./url";

export interface TlsCheck {
  validTo: string | null;
  daysLeft: number | null;
  issuer: string | null;
  /**
   * https://www 与 https://裸域 是否都能安全访问(host 是 www 就看裸域,反之看 www)。
   * 先看本证书的 SAN;不覆盖时再对另一主机做一次验证握手 —— Vercel / Cloudflare
   * 给 apex 与 www 各签一张证书,只看 SAN 会把它们全判成"不覆盖"。SAN 为空且握手也失败 → null;
   * 另一主机 DNS 查不到(ENOTFOUND / EAI_AGAIN / ENODATA)→ null(不适用,不是"不覆盖")。
   */
  coversWww: boolean | null;
  error: string | null;
}

export const TLS_TIMEOUT_MS = 8_000;

export type TlsConnectFn = (options: ConnectionOptions) => TLSSocket;

export interface CheckTlsOptions {
  timeoutMs?: number;
  /** 测试注入用:替代 tls.connect */
  connect?: TlsConnectFn;
  /** 测试注入用:替代 dns.lookup */
  lookup?: LookupFn;
  /** 测试注入用:当前时间(算 daysLeft) */
  now?: () => number;
}

interface Handshake {
  cert: PeerCertificate | null;
  authorized: boolean;
  error: { code?: string; message: string } | null;
}

const defaultLookup: LookupFn = (host, opts) => dns.lookup(host, opts);

/** 把 node 的证书错误码翻成报告里能直接用的一句话 */
export function describeTlsError(code: string | undefined, message: string): string {
  switch (code) {
    case "CERT_HAS_EXPIRED":
      return "expired: the certificate has expired";
    case "CERT_NOT_YET_VALID":
      return "not yet valid: the certificate's start date is in the future";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `hostname mismatch: ${message}`;
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "self-signed: the certificate is not issued by a trusted authority";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
    case "UNABLE_TO_GET_ISSUER_CERT":
      return "incomplete chain: the server does not send its intermediate certificate";
    case "CERT_REVOKED":
      return "revoked: the certificate has been revoked";
    case "ECONNREFUSED":
      return "connection refused on port 443 (no HTTPS service)";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `DNS lookup failed: ${message}`;
    case "ETIMEDOUT":
      return "handshake timed out";
    case "ECONNRESET":
      return "connection reset during the handshake (often a TLS version or SNI problem)";
    default:
      return code ? `${code}: ${message}` : message;
  }
}

function handshake(host: string, rejectUnauthorized: boolean, opts: Required<Pick<CheckTlsOptions, "timeoutMs" | "connect" | "lookup">>): Promise<Handshake> {
  return new Promise<Handshake>((resolve) => {
    let settled = false;
    const finish = (h: Handshake) => {
      if (settled) return;
      settled = true;
      resolve(h);
    };
    const lookup = (hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void) => {
      const o = (typeof options === "number" ? { family: options } : (options as { family?: number; all?: boolean } | undefined)) ?? {};
      (async () => {
        const literal = isIP(hostname);
        const addresses = literal ? [{ address: hostname, family: literal }] : await opts.lookup(hostname, { all: true });
        if (!addresses.length) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
        for (const a of addresses) {
          if (isPrivateIp(a.address)) throw Object.assign(new Error(`"${hostname}" resolves to a non-public address`), { code: "EBLOCKED" });
        }
        if (o.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      })().catch((e: unknown) => callback(e instanceof Error ? (e as NodeJS.ErrnoException) : Object.assign(new Error(String(e)), { code: "ELOOKUP" })));
    };

    let socket: TLSSocket;
    try {
      socket = opts.connect({
        host,
        port: 443,
        servername: host,
        rejectUnauthorized,
        lookup: lookup as unknown as ConnectionOptions["lookup"],
        // 只做握手,不跑 HTTP;ALPN 不申明,避免 h2 服务器等我们发帧
      });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return finish({ cert: null, authorized: false, error: { code: err.code, message: err.message } });
    }

    const timer = setTimeout(() => {
      socket.destroy();
      finish({ cert: null, authorized: false, error: { code: "ETIMEDOUT", message: `No TLS handshake within ${opts.timeoutMs}ms` } });
    }, opts.timeoutMs);

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      let cert: PeerCertificate | null = null;
      try {
        const c = socket.getPeerCertificate();
        cert = c && Object.keys(c).length ? c : null;
      } catch {
        cert = null;
      }
      const authorized = socket.authorized;
      const authErr = socket.authorizationError as unknown as (Error & { code?: string }) | string | null | undefined;
      socket.destroy();
      finish({
        cert,
        authorized,
        error: authorized || !authErr ? null : typeof authErr === "string" ? { code: authErr, message: authErr } : { code: authErr.code ?? authErr.message, message: authErr.message },
      });
    });
    socket.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      finish({ cert: null, authorized: false, error: { code: e.code, message: e.message } });
    });
  });
}

/** 证书覆盖的主机名:SAN 的 DNS 项;完全没有 SAN 的老证书才退回 subject CN(浏览器同样只在这种情况看 CN) */
function sanList(cert: PeerCertificate | null): string[] {
  if (!cert) return [];
  const names = (cert.subjectaltname ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^dns:/i.test(s))
    .map((s) => s.slice(4).toLowerCase());
  if (names.length) return names;
  const cn = (cert.subject as Record<string, string> | undefined)?.CN?.toLowerCase();
  return cn ? [cn] : [];
}

/** DNS 里没有这个主机:握手前的解析就失败了 */
const DNS_MISSING = new Set(["ENOTFOUND", "EAI_AGAIN", "ENODATA"]);

export function isDnsMissing(error: { code?: string; message: string } | null): boolean {
  if (!error) return false;
  if (error.code && DNS_MISSING.has(error.code)) return true;
  return /\b(?:ENOTFOUND|EAI_AGAIN|ENODATA)\b/.test(error.message ?? "");
}

/** 名字是否被证书覆盖:精确匹配,或通配符覆盖恰好一级 */
export function certCovers(names: string[], hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (names.includes(h)) return true;
  const dot = h.indexOf(".");
  if (dot < 0) return false;
  return names.includes(`*.${h.slice(dot + 1)}`);
}

/**
 * 检查 host 的证书。永不抛;拿不到就把原因写进 error。
 */
export async function checkTls(host: string, options: CheckTlsOptions = {}): Promise<TlsCheck> {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  const out: TlsCheck = { validTo: null, daysLeft: null, issuer: null, coversWww: null, error: null };
  if (isBlockedHostname(h) || (isIP(h) && isPrivateIp(h))) {
    out.error = "blocked: not a public host";
    return out;
  }
  const opts = {
    timeoutMs: options.timeoutMs ?? TLS_TIMEOUT_MS,
    connect: options.connect ?? (tlsConnect as TlsConnectFn),
    lookup: options.lookup ?? defaultLookup,
  };
  const now = options.now ?? Date.now;

  let hs = await handshake(h, true, opts);
  if (hs.error) {
    out.error = describeTlsError(hs.error.code, hs.error.message);
    const certErrors = /^(CERT_|ERR_TLS_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO)/;
    if (hs.error.code && certErrors.test(hs.error.code)) {
      // 验证失败但连得上:再握一次只读证书,报告里才有日期与颁发者
      const second = await handshake(h, false, opts);
      if (second.cert) hs = { ...second, error: hs.error };
    }
  }

  const cert = hs.cert;
  if (cert) {
    const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
    if (validTo && !Number.isNaN(validTo.getTime())) {
      out.validTo = validTo.toISOString();
      out.daysLeft = Math.floor((validTo.getTime() - now()) / 86_400_000);
    }
    const issuer = cert.issuer as Record<string, string> | undefined;
    out.issuer = issuer?.O ?? issuer?.CN ?? null;
    const names = sanList(cert);
    const apex = registrableDomain(h);
    const other = h.startsWith("www.") ? apex : `www.${apex}`;
    if (names.length && certCovers(names, other)) out.coversWww = true;
    else {
      // 另一主机可能有自己的证书:握一次手,验证通过就算覆盖;DNS 里根本没有它 → 不适用(null)
      const alt = await handshake(other, true, opts);
      if (!alt.error) out.coversWww = true;
      else if (isDnsMissing(alt.error)) out.coversWww = null;
      else out.coversWww = names.length ? false : null;
    }
  }
  return out;
}
