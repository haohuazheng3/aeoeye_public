/* ============================================================
   工具页的网络层:一律走审计引擎的 safeFetch(SSRF 防护、私网 IP 拦截、
   体积 / 时间上限、跳转逐跳记录)。这里只补"工具页需要的默认值"和输入规范化。
   ============================================================ */

import { safeFetch, type FetchResult, type SafeFetchOptions } from "@/lib/seo-audit/fetch";
import { normalizeInput, SeoAuditError } from "@/lib/seo-audit/url";
import { BOTS } from "./bots";

export type { FetchResult };

export class ToolInputError extends Error {}

/** 接受 "example.com" / "https://example.com/x";返回规范化后的 URL 与 origin。非法输入抛 ToolInputError */
export function parseTarget(input: string): { url: string; origin: string; host: string } {
  try {
    const n = normalizeInput(String(input ?? ""));
    return { url: n.entryUrl, origin: n.origin, host: n.host };
  } catch (e) {
    const msg = e instanceof SeoAuditError ? e.message : "Enter a valid domain or URL.";
    throw new ToolInputError(msg || "Enter a valid domain or URL.");
  }
}

const DEFAULTS: SafeFetchOptions = { timeoutMs: 12_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 8 };

/** 以浏览器身份 GET(默认) */
export function fetchAs(url: string, botId = "browser", opts: SafeFetchOptions = {}): Promise<FetchResult> {
  const b = BOTS[botId];
  const ua = b && b.ua ? b.ua : BOTS.browser.ua;
  return safeFetch(url, { ...DEFAULTS, ...opts, userAgent: ua });
}

/** 不跟随跳转的单跳请求(跳转检查器逐跳展示用) */
export function fetchNoFollow(url: string, botId = "browser", method: "GET" | "HEAD" = "GET"): Promise<FetchResult> {
  return fetchAs(url, botId, { maxRedirects: 0, method, maxBytes: 256 * 1024 });
}

export function header(res: FetchResult, name: string): string | null {
  return res.headers && typeof res.headers.get === "function" ? res.headers.get(name) : null;
}

export function allHeaders(res: FetchResult): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (!res.headers || typeof res.headers.forEach !== "function") return out;
  res.headers.forEach((value, key) => out.push({ key, value }));
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function isHtml(res: FetchResult): boolean {
  return /text\/html|application\/xhtml/i.test(res.contentType || "") || /^\s*<(!doctype|html|head)/i.test(res.body || "");
}

/** 把 fetch 的失败翻成人话 */
export function fetchFailure(res: FetchResult): string | null {
  if (res.status !== 0) return null;
  const e = res.error || "";
  if (/blocked|private|not allowed/i.test(e)) return "That address points to a private or blocked network, so we can't fetch it.";
  if (/timeout|timed out/i.test(e)) return "The site didn't respond within 12 seconds.";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(e)) return "That domain doesn't resolve (DNS lookup failed). Check the spelling.";
  if (/certificate|ssl|tls/i.test(e)) return `The site's HTTPS certificate failed validation (${e}).`;
  return `We couldn't reach the site${e ? ` (${e})` : ""}.`;
}

/** 有限并发 map */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function sameHost(a: string, host: string): boolean {
  try {
    const h = new URL(a).hostname.toLowerCase();
    return h === host || h === `www.${host}` || `www.${h}` === host;
  } catch {
    return false;
  }
}
