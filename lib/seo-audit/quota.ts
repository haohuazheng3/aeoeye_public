import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/* ============================================================
   SEO 审计 · 跨实例配额(数据库固定窗口计数)

   为什么不只用进程内令牌桶:Vercel 上每个实例各算各的,刷一次冷启动就绕过去了。
   这里每个桶一行,一条 `INSERT … ON CONFLICT DO UPDATE … RETURNING` 原子完成
   "窗口过期 → 重置为 1;否则 +1" —— neon-http 没有交互式事务,单语句原子性是唯一可靠的闸。

   只在**真正触发抓取**的运行开始时扣;缓存复用不扣运行配额(只过它自己的 copy 桶,见 copyHour)。
   PSI 日配额例外:超限不拒绝运行,只是这次不跑 PSI 并写 note(免费的 Lighthouse 不该拦住整份报告)。

   故障语义(复审 C9):只有**数据库故障**抛 QuotaUnavailableError,路由可以对它"放行"(限流是防滥用,
   不是功能依赖);桶名非法之类的确定性错误抛普通 Error —— 那是代码 bug,必须失败关闭,
   否则攻击者用一个超长主机名就能让后面的全站 / 目标域闸整段被跳过。
   ============================================================ */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** 各桶上限(V2-0)。改这里即改产品策略,不要在路由里散落数字 */
export const QUOTA = {
  /** 每 IP 每小时的真实运行 */
  ipHour: { limit: 5, windowMs: HOUR_MS },
  /** 匿名每 IP 每日 —— 用尽后要求登录(401 requiresAuth) */
  ipDayAnonymous: { limit: 3, windowMs: DAY_MS },
  /** 登录用户每日 */
  userDay: { limit: 20, windowMs: DAY_MS },
  /** 每目标域每小时(防止用我们的爬虫去打别人的站) */
  domainHour: { limit: 6, windowMs: HOUR_MS },
  /** 全站每小时 */
  globalHour: { limit: 120, windowMs: HOUR_MS },
  /** 免费用户同域强制重跑(fresh: true)每小时 1 次 */
  freshHour: { limit: 1, windowMs: HOUR_MS },
  /** PageSpeed Insights 每日(Google 免费配额 25k/日,留足余量) */
  psiDay: { limit: 1500, windowMs: DAY_MS },
  /** 缓存副本:每个请求者每小时 20 份。副本不扣运行配额(设计契约),但每份都是一整行 result 的写入,
   *  没有跨实例上限就能被刷满存储(复审 C5/C43) */
  copyHour: { limit: 20, windowMs: HOUR_MS },
  /** 付费重跑:每份报告每小时 6 次、每日 30 次。30 天内不限**总**次数,只限频率 ——
   *  每次重跑都是 40 页抓取 + 2 次 PSI,不限频率就能绕过目标域闸并耗尽全站 PSI 日配额(复审 C4/C38) */
  rerunHour: { limit: 6, windowMs: HOUR_MS },
  rerunDay: { limit: 30, windowMs: DAY_MS },
} as const;

/**
 * 配额存储(数据库)本身故障:连不上、超时、没返回行。**只有这一类**允许调用方放行(fail open);
 * 其余异常一律当 bug 处理(失败关闭)。
 */
export class QuotaUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "QuotaUnavailableError";
  }
}

export interface QuotaResult {
  ok: boolean;
  /** 本窗口内含本次的计数 */
  n: number;
  /** 超限时距窗口重置的秒数(≥1);未超限为 0 */
  retryAfterSec: number;
}

/* ---------- IP 归桶与哈希 ---------- */

/**
 * IPv6 按 /64 归桶(一个用户通常拿到整个 /64,逐地址计数等于没限);IPv4 原样。
 * 不合法的输入原样返回 —— 它照样会被哈希成一个桶,不会因为格式怪就绕过限流。
 */
export function ipBucketKey(ip: string): string {
  const s = (ip || "").trim().toLowerCase();
  if (!s) return "unknown";
  // IPv4 或 IPv4-mapped IPv6(::ffff:1.2.3.4)
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  if (!s.includes(":")) return s;
  const zoneless = s.split("%")[0];
  const groups = expandIpv6(zoneless);
  if (!groups) return zoneless;
  return `${groups.slice(0, 4).join(":")}::/64`;
}

function expandIpv6(ip: string): string[] | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  if (parts.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const full = [...head, ...Array.from({ length: parts.length === 2 ? missing : 0 }, () => "0"), ...tail];
  if (full.length !== 8 || full.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return full.map((g) => g.padStart(4, "0"));
}

/**
 * 按天派生的 HMAC key:sha256(secret + ":" + UTC 日期)。
 * 同一 IP 每天的哈希都不同 —— 库里存的 ip_hash 只能用来做当天的限流,拼不出长期画像。
 */
export function dailyIpKey(date: Date = new Date(), secret: string = env.CRON_SECRET || "aeoeye"): Buffer {
  const day = date.toISOString().slice(0, 10);
  return createHash("sha256").update(`${secret}:${day}`).digest();
}

/** ipHash = HMAC-SHA256(dailyKey, /64 归桶后的 IP) 的前 32 个 hex 字符 */
export function ipHash(ip: string, date: Date = new Date()): string {
  return createHmac("sha256", dailyIpKey(date)).update(ipBucketKey(ip)).digest("hex").slice(0, 32);
}

/* ---------- 桶名 ---------- */

/**
 * 桶名里要嵌域名时一律用定长摘要(sha256 前 32 位 hex):域名来自用户输入,最长可到 200 字符,
 * 原样拼进桶名会超过 consumeQuota 的 200 字符上限 —— 那会让后面的全站 / 目标域闸整段被跳过(复审 C9)。
 * 先 trim + 小写再哈希,Example.com 与 example.com 落同一个桶。
 */
export function domainKey(domain: string): string {
  return createHash("sha256").update((domain || "").trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * 按"请求者"计数的桶用的主体:登录用户按 userId(换网络、换 IP 都还是同一个人),
 * 匿名按当天的 /64 IP 哈希。user: 前缀保证两者不会撞名(ipHash 恒为 32 位 hex)。
 */
export function quotaSubject(args: { userId?: string | null; ipHash: string }): string {
  return args.userId ? `user:${args.userId}` : args.ipHash;
}

export const bucketFor = {
  ipHour: (hash: string) => `ip:${hash}:1h`,
  ipDay: (hash: string) => `ip:${hash}:24h`,
  userDay: (userId: string) => `user:${userId}:24h`,
  domainHour: (domain: string) => `domain:${domainKey(domain)}:1h`,
  /** subject = quotaSubject(...):登录用户也受"每小时 1 次强制重跑"约束(复审 C11) */
  fresh: (subject: string, domain: string) => `fresh:${subject}:${domainKey(domain)}:1h`,
  globalHour: () => "global:1h",
  psiDay: () => "psi:24h",
  copyHour: (subject: string) => `copy:${subject}:1h`,
  rerunHour: (auditId: string) => `rerun:${auditId}:1h`,
  rerunDay: (auditId: string) => `rerun:${auditId}:24h`,
} as const;

/* ---------- 原子计数 ---------- */

function windowSeconds(windowMs: number): number {
  return Math.max(1, Math.floor(windowMs / 1000));
}

/** 纯函数:由 RETURNING 的 n / window_start 得出判定(便于离线测试) */
export function decideQuota(n: number, windowStart: Date, windowMs: number, limit: number, now: Date = new Date()): QuotaResult {
  const ok = n <= limit;
  if (ok) return { ok: true, n, retryAfterSec: 0 };
  const resetAt = windowStart.getTime() + windowMs;
  return { ok: false, n, retryAfterSec: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)) };
}

/**
 * 扣一次配额。**一条语句**,neon-http 下无需事务:
 *   INSERT … ON CONFLICT (bucket) DO UPDATE
 *     SET n = CASE WHEN window_start < now() - interval THEN 1 ELSE n + 1 END,
 *         window_start = CASE WHEN window_start < now() - interval THEN now() ELSE window_start END
 *   RETURNING n, window_start
 * ok = n ≤ limit。调用方拿到 !ok 时应回 429(或匿名日配额 → 401 requiresAuth)。
 * 数据库故障 → 抛 QuotaUnavailableError(调用方可以放行);桶名非法 → 抛普通 Error(必须失败关闭)。
 */
export async function consumeQuota(bucket: string, windowMs: number, limit: number): Promise<QuotaResult> {
  if (!bucket || bucket.length > 200) throw new Error(`consumeQuota: invalid bucket (${bucket ? bucket.length : 0} chars)`);
  const interval = sql.raw(`interval '${windowSeconds(windowMs)} seconds'`);
  let res: unknown;
  try {
    res = await db.execute(sql`
      insert into seo_quota (bucket, window_start, n)
      values (${bucket}, now(), 1)
      on conflict (bucket) do update set
        n = case when seo_quota.window_start < now() - ${interval} then 1 else seo_quota.n + 1 end,
        window_start = case when seo_quota.window_start < now() - ${interval} then now() else seo_quota.window_start end
      returning n, window_start
    `);
  } catch (e) {
    throw new QuotaUnavailableError(`quota store unavailable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), { cause: e });
  }
  const row = (res as { rows?: Array<{ n: number | string; window_start: string | Date }> }).rows?.[0];
  if (!row) throw new QuotaUnavailableError("consumeQuota: no row returned");
  const n = Number(row.n);
  const windowStart = row.window_start instanceof Date ? row.window_start : new Date(row.window_start);
  return decideQuota(n, windowStart, windowMs, limit);
}

/** 只读:当前窗口内的计数(0 = 没有这个桶或窗口已过期)。给 health / 运维看,不改任何东西 */
export async function peekQuota(bucket: string, windowMs: number): Promise<number> {
  const interval = sql.raw(`interval '${windowSeconds(windowMs)} seconds'`);
  const res = await db.execute(sql`
    select n from seo_quota where bucket = ${bucket} and window_start >= now() - ${interval} limit 1
  `);
  const row = (res as unknown as { rows?: Array<{ n: number | string }> }).rows?.[0];
  return row ? Number(row.n) : 0;
}

/** 删除一个桶(测试清理 / 运维解封)。 */
export async function clearQuotaBucket(bucket: string): Promise<void> {
  await db.execute(sql`delete from seo_quota where bucket = ${bucket}`);
}

/* ---------- 一次真实运行要过的全部闸 ---------- */

export type RunQuotaDenial =
  | { ok: false; kind: "ip_hour" | "domain_hour" | "global_hour" | "user_day" | "fresh_hour"; retryAfterSec: number }
  | { ok: false; kind: "anonymous_day"; retryAfterSec: number; requiresAuth: true };

export type RunQuotaOutcome = { ok: true } | RunQuotaDenial;

/**
 * 按顺序扣:IP/小时 → (匿名 IP/日 | 用户/日) → fresh/小时(仅 fresh) → 目标域/小时 → 全站/小时。
 * fresh 是"按请求者"的闸,必须排在共享桶(目标域 / 全站)之前:被它拒掉的强制重跑一次抓取都没发生,
 * 不该白白吃掉别人对同一个域的配额(复审 C11)。
 * 前面的桶已扣、后面的桶拒绝时,前面那一次会白记 —— 可接受:它只会让滥用者更早撞墙。
 */
export async function consumeRunQuotas(args: {
  ipHash: string;
  userId?: string | null;
  domain: string;
  fresh?: boolean;
}): Promise<RunQuotaOutcome> {
  const ip = await consumeQuota(bucketFor.ipHour(args.ipHash), QUOTA.ipHour.windowMs, QUOTA.ipHour.limit);
  if (!ip.ok) return { ok: false, kind: "ip_hour", retryAfterSec: ip.retryAfterSec };

  if (args.userId) {
    const u = await consumeQuota(bucketFor.userDay(args.userId), QUOTA.userDay.windowMs, QUOTA.userDay.limit);
    if (!u.ok) return { ok: false, kind: "user_day", retryAfterSec: u.retryAfterSec };
  } else {
    const d = await consumeQuota(bucketFor.ipDay(args.ipHash), QUOTA.ipDayAnonymous.windowMs, QUOTA.ipDayAnonymous.limit);
    if (!d.ok) return { ok: false, kind: "anonymous_day", retryAfterSec: d.retryAfterSec, requiresAuth: true };
  }

  // 免费层"同域每小时 1 次强制重跑"对登录用户同样适用:这条路由上的运行全是免费层(付费重跑走 /[id]/rerun)
  if (args.fresh) {
    const who = quotaSubject({ userId: args.userId, ipHash: args.ipHash });
    const f = await consumeQuota(bucketFor.fresh(who, args.domain), QUOTA.freshHour.windowMs, QUOTA.freshHour.limit);
    if (!f.ok) return { ok: false, kind: "fresh_hour", retryAfterSec: f.retryAfterSec };
  }

  const dom = await consumeQuota(bucketFor.domainHour(args.domain), QUOTA.domainHour.windowMs, QUOTA.domainHour.limit);
  if (!dom.ok) return { ok: false, kind: "domain_hour", retryAfterSec: dom.retryAfterSec };

  const g = await consumeQuota(bucketFor.globalHour(), QUOTA.globalHour.windowMs, QUOTA.globalHour.limit);
  if (!g.ok) return { ok: false, kind: "global_hour", retryAfterSec: g.retryAfterSec };

  return { ok: true };
}

/* ---------- 付费重跑 / 缓存副本的专用闸 ---------- */

export type RerunQuotaOutcome = { ok: true } | { ok: false; kind: "rerun_hour" | "rerun_day" | "global_hour"; retryAfterSec: number };

/**
 * 付费重跑的闸(复审 C4/C38):每份报告 1h ≤6、24h ≤30,再计入全站每小时总闸。
 * **刻意不扣**免费层的 ip/小时、匿名 ip/日、用户/日:那会把买家的 30 天重跑权益砍成"一天 3 次后要求登录"。
 * 调用方必须在"已有运行在跑"的 409 预检之后再扣 —— 否则运行期间的重复点击会白白烧掉配额。
 */
export async function consumeRerunQuotas(auditId: string): Promise<RerunQuotaOutcome> {
  const h = await consumeQuota(bucketFor.rerunHour(auditId), QUOTA.rerunHour.windowMs, QUOTA.rerunHour.limit);
  if (!h.ok) return { ok: false, kind: "rerun_hour", retryAfterSec: h.retryAfterSec };
  const d = await consumeQuota(bucketFor.rerunDay(auditId), QUOTA.rerunDay.windowMs, QUOTA.rerunDay.limit);
  if (!d.ok) return { ok: false, kind: "rerun_day", retryAfterSec: d.retryAfterSec };
  const g = await consumeQuota(bucketFor.globalHour(), QUOTA.globalHour.windowMs, QUOTA.globalHour.limit);
  if (!g.ok) return { ok: false, kind: "global_hour", retryAfterSec: g.retryAfterSec };
  return { ok: true };
}

/** 缓存副本的闸:subject = quotaSubject(...)。不碰任何运行配额(设计契约:复制缓存不扣运行配额) */
export async function consumeCopyQuota(subject: string): Promise<QuotaResult> {
  return consumeQuota(bucketFor.copyHour(subject), QUOTA.copyHour.windowMs, QUOTA.copyHour.limit);
}

/** "再等 N 分钟"的人话(429 文案共用) */
export function retryInWords(sec: number): string {
  const m = Math.max(1, Math.ceil(sec / 60));
  return m === 1 ? "a minute" : m >= 60 ? `${Math.ceil(m / 60)} hour${m >= 120 ? "s" : ""}` : `${m} minutes`;
}

/**
 * 过期桶清理(cron,零成本 SQL):最长窗口 24h,window_start 早于 2 天的行永远不会再被
 * ON CONFLICT 命中 —— ip 桶的哈希按天轮换,旧行只增不减(复审 C43)。分批删,单次最多 limit 行。
 */
export async function purgeExpiredQuota(limit = 5000): Promise<number> {
  const res = await db.execute(purgeExpiredQuotaQuery(limit));
  const row = (res as unknown as { rows?: Array<{ n: number | string }> }).rows?.[0];
  return Number(row?.n ?? 0);
}

/** 上面那条语句本身(单独导出:运维 / 校验可以对它 EXPLAIN 而不真的删) */
export function purgeExpiredQuotaQuery(limit = 5000) {
  const n = Math.max(1, Math.min(50_000, Math.floor(limit)));
  return sql`
    with d as (
      delete from seo_quota
      where bucket in (select bucket from seo_quota where window_start < now() - interval '2 days' limit ${n})
      returning 1
    )
    select count(*)::int as n from d
  `;
}

/**
 * PSI 日配额:true = 可以跑。超限或数据库故障都返回 false/true 而不抛 ——
 * 超限时运行照常进行、只是不跑 PSI;故障时宁可多跑一次 PSI 也不让审计失败。
 */
export async function consumePsiQuota(): Promise<boolean> {
  try {
    const r = await consumeQuota(bucketFor.psiDay(), QUOTA.psiDay.windowMs, QUOTA.psiDay.limit);
    return r.ok;
  } catch {
    return true;
  }
}
