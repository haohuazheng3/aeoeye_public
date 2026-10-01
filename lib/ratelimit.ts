/**
 * 轻量令牌桶限流(进程内,best-effort)。
 * 只是第一道便宜的闸:serverless 多实例各算各的,跨实例的硬闸在数据库
 * (SEO 审计走 lib/seo-audit/quota.ts 的原子计数)。
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

function firstHop(value: string | null): string {
  return value?.split(",")[0]?.trim() || "";
}

/**
 * 客户端 IP。信任顺序:x-real-ip(Vercel 注入,客户端写不了)→ x-vercel-forwarded-for 首项
 * → x-forwarded-for 首项 → "unknown"。
 * **不再看 cf-connecting-ip**:站点没挂 Cloudflare,这个头任何客户端都能随手写,
 * 信它等于把限流钥匙交给被限的人。
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    firstHop(headers.get("x-vercel-forwarded-for")) ||
    firstHop(headers.get("x-forwarded-for")) ||
    "unknown"
  );
}
