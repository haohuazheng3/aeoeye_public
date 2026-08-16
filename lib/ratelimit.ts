/**
 * 轻量令牌桶限流(进程内,best-effort)。
 * 边缘层的强限流由 Cloudflare 规则承担;这里防止单实例被刷爆。
 */
type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, opts: { limit: number; windowMs: number }): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const refillPerMs = opts.limit / opts.windowMs;
  const b = buckets.get(key) ?? { tokens: opts.limit, updated: now };
  // 补充令牌
  b.tokens = Math.min(opts.limit, b.tokens + (now - b.updated) * refillPerMs);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    const retryAfter = Math.ceil((1 - b.tokens) / refillPerMs / 1000);
    return { ok: false, retryAfter };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  // 偶尔清理过期桶
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.updated > opts.windowMs * 4) buckets.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

export function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anon"
  );
}
