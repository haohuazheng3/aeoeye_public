import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, apiRequests } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { shortId } from "@/lib/utils";
import { summarizeCost, type CostEntry } from "@/lib/cost";

/* ============================================================
   公开 API 的钥匙串

   设计取自成熟 API 产品的通行做法:
   · 明文只在创建那一刻返回一次,库里只存 sha256 —— 库被读走也无法冒用;
   · 前缀单独存,列表里用来认领是哪一把("aeo_live_7f3a…");
   · 撤销是软删除(revokedAt),历史账单还要引用这把 key。
   ============================================================ */

const PREFIX = "aeo_live_";

/** 只有站长本人能用这个 API(站长 2026-08-10 指定)。留成 env 便于以后放开。 */
export function isApiOwner(email: string | undefined | null): boolean {
  const owner = (env.API_OWNER_EMAIL || "").trim().toLowerCase();
  return !!email && !!owner && email.trim().toLowerCase() === owner;
}

function hashKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** 生成一把新 key。返回的 plaintext **不会**再有第二次机会拿到。 */
export async function createApiKey(args: {
  userId: string;
  email: string;
  name: string;
}): Promise<{ id: string; plaintext: string; prefix: string }> {
  // 32 字节 base64url ≈ 43 字符的熵,足够抗暴力;前缀让它在日志里一眼可辨
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `${PREFIX}${secret}`;
  const id = shortId(12);
  const prefix = `${PREFIX}${secret.slice(0, 6)}`;

  await db.insert(apiKeys).values({
    id,
    userId: args.userId,
    email: args.email,
    name: args.name.trim().slice(0, 60) || "Untitled key",
    prefix,
    keyHash: hashKey(plaintext),
  });

  return { id, plaintext, prefix };
}

export async function listApiKeys(userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

export type AuthedKey = { keyId: string; userId: string; email: string };

/**
 * 校验 Authorization: Bearer <key>。
 * 返回 null 表示不认 —— 调用方一律回 401,**不要**区分"key 不存在"和"key 已撤销",
 * 那种区别会把 key 是否存在泄漏给探测者。
 */
export async function authenticateApiKey(header: string | null): Promise<AuthedKey | null> {
  const m = (header || "").match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const plain = m[1];
  if (!plain.startsWith(PREFIX)) return null;

  const rows = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, email: apiKeys.email, keyHash: apiKeys.keyHash, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashKey(plain)))
    .limit(1);

  const row = rows[0];
  if (!row || row.revokedAt) return null;

  // 哈希查表已经等值匹配过,这里再做一次定长比较,避免以后有人把查询改成模糊匹配
  const a = Buffer.from(row.keyHash);
  const b = Buffer.from(hashKey(plain));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // 只有站长的邮箱能用。key 发出去之后权限被收回也立刻失效。
  if (!isApiOwner(row.email)) return null;

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { keyId: row.id, userId: row.userId, email: row.email };
}

/* ---------- 账单 ---------- */

const MICRO = 1_000_000;
const toMicro = (usd: number) => Math.round(usd * MICRO);

/** 把一次调用的花费落库。失败的调用同样记 —— 它照样烧了钱。 */
export async function recordApiRequest(args: {
  keyId: string;
  userId: string;
  endpoint: string;
  input?: string;
  auditId?: string;
  status: "succeeded" | "failed";
  httpStatus: number;
  error?: string;
  durationMs: number;
  entries: CostEntry[];
}): Promise<void> {
  const s = summarizeCost(args.entries);
  await db.insert(apiRequests).values({
    id: shortId(14),
    keyId: args.keyId,
    userId: args.userId,
    endpoint: args.endpoint,
    input: args.input?.slice(0, 200),
    auditId: args.auditId,
    status: args.status,
    httpStatus: args.httpStatus,
    error: args.error?.slice(0, 500),
    durationMs: args.durationMs,
    costMicroUsd: toMicro(s.totalUsd),
    measuredMicroUsd: toMicro(s.measuredUsd),
    estimatedMicroUsd: toMicro(s.estimatedUsd),
    inputTokens: s.totalInputTokens,
    outputTokens: s.totalOutputTokens,
    costBreakdown: s.entries,
  });
}

export type UsageRow = {
  id: string;
  endpoint: string;
  input: string | null;
  auditId: string | null;
  status: string;
  httpStatus: number | null;
  error: string | null;
  durationMs: number | null;
  costMicroUsd: number;
  measuredMicroUsd: number;
  estimatedMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  costBreakdown: unknown[] | null;
  createdAt: Date;
};

export type UsageOverview = {
  rows: UsageRow[];
  totals: {
    calls: number;
    succeeded: number;
    failed: number;
    costUsd: number;
    measuredUsd: number;
    estimatedUsd: number;
    inputTokens: number;
    outputTokens: number;
    avgCostUsd: number;
    avgDurationMs: number;
  };
  /** 近 30 天按日聚合 —— 界面画柱状图用 */
  daily: { day: string; calls: number; costUsd: number }[];
  /** 全部调用按供应商 / 环节汇总 */
  byProvider: { provider: string; usd: number; calls: number }[];
  byStage: { stage: string; usd: number; calls: number }[];
};

export async function getUsage(userId: string, limit = 100): Promise<UsageOverview> {
  const rows = (await db
    .select()
    .from(apiRequests)
    .where(eq(apiRequests.userId, userId))
    .orderBy(desc(apiRequests.createdAt))
    .limit(limit)) as unknown as UsageRow[];

  // 总计走 SQL,不受 limit 影响 —— 界面上的"总花费"必须是全部调用的总和,
  // 只加最近 100 条会随着调用变多而越来越不准。
  const agg = await db
    .select({
      calls: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${apiRequests.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${apiRequests.status} = 'failed')::int`,
      cost: sql<number>`coalesce(sum(${apiRequests.costMicroUsd}), 0)::bigint`,
      measured: sql<number>`coalesce(sum(${apiRequests.measuredMicroUsd}), 0)::bigint`,
      estimated: sql<number>`coalesce(sum(${apiRequests.estimatedMicroUsd}), 0)::bigint`,
      inTok: sql<number>`coalesce(sum(${apiRequests.inputTokens}), 0)::bigint`,
      outTok: sql<number>`coalesce(sum(${apiRequests.outputTokens}), 0)::bigint`,
      dur: sql<number>`coalesce(avg(${apiRequests.durationMs}), 0)::int`,
    })
    .from(apiRequests)
    .where(eq(apiRequests.userId, userId));

  const a = agg[0];
  const calls = Number(a?.calls ?? 0);
  const costMicro = Number(a?.cost ?? 0);

  const dailyRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${apiRequests.createdAt}), 'YYYY-MM-DD')`,
      calls: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${apiRequests.costMicroUsd}), 0)::bigint`,
    })
    .from(apiRequests)
    .where(and(eq(apiRequests.userId, userId), sql`${apiRequests.createdAt} > now() - interval '30 days'`))
    .groupBy(sql`date_trunc('day', ${apiRequests.createdAt})`)
    .orderBy(sql`date_trunc('day', ${apiRequests.createdAt})`);

  // 供应商/环节汇总从明细里现算 —— 明细是逐笔存下来的事实,不另存一份聚合免得两边对不上
  const allBreakdowns = (await db
    .select({ b: apiRequests.costBreakdown })
    .from(apiRequests)
    .where(eq(apiRequests.userId, userId))) as { b: CostEntry[] | null }[];
  const flat = allBreakdowns.flatMap((r) => r.b ?? []);
  const s = summarizeCost(flat);

  return {
    rows,
    totals: {
      calls,
      succeeded: Number(a?.succeeded ?? 0),
      failed: Number(a?.failed ?? 0),
      costUsd: costMicro / MICRO,
      measuredUsd: Number(a?.measured ?? 0) / MICRO,
      estimatedUsd: Number(a?.estimated ?? 0) / MICRO,
      inputTokens: Number(a?.inTok ?? 0),
      outputTokens: Number(a?.outTok ?? 0),
      avgCostUsd: calls ? costMicro / MICRO / calls : 0,
      avgDurationMs: Number(a?.dur ?? 0),
    },
    daily: dailyRows.map((d) => ({ day: d.day, calls: Number(d.calls), cost: Number(d.cost) })).map((d) => ({
      day: d.day,
      calls: d.calls,
      costUsd: d.cost / MICRO,
    })),
    byProvider: s.byProvider.map((p) => ({ provider: p.provider, usd: p.usd, calls: p.calls })),
    byStage: s.byStage,
  };
}
