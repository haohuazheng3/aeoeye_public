import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { sweepStaleSeoAudits, purgeFailedSeoAudits, SEO_STALE_RUN_MS } from "@/lib/seo-audit/repo";
import { purgeExpiredQuota } from "@/lib/seo-audit/quota";

/**
 * 卡死清扫 + 保留期清理(每 10 分钟,全部是零成本的数据库语句):
 * 1. running/pending 超过 6 分钟仍没结果的 SEO 审计标为失败,让用户看到"超时,请重试"而不是永远转圈;
 * 2. seo_quota 里窗口早于 2 天的桶(ip 桶的哈希按天轮换,旧行永远不会再被命中,只增不减);
 * 3. 超过 30 天、没有结果、没解锁的 failed 行(复审 C43)。已解锁 / 有结果 / 有归属的行一律不动。
 *
 * 为什么单独一条路由:/api/cron/monitor 每周一还会跑付费的 AI 监测审计,
 * 把它调到 10 分钟一次会真的花钱;这条只做零成本的数据库清扫。
 * 每一步各自 try/catch 并进错误收件箱:cron 的 500 没人看,一步失败也不该拖住后面的清理。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return true;
  return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    await captureError({
      name: `seo_sweep_${name}`,
      message: String((e as Error)?.message ?? e),
      stack: (e as Error)?.stack,
      route: "/api/cron/seo-sweep",
      source: "server",
    });
    return null;
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const swept = await step("stale", () => sweepStaleSeoAudits(SEO_STALE_RUN_MS));
  const quotaPurged = await step("quota_purge", () => purgeExpiredQuota());
  const failedPurged = await step("failed_purge", () => purgeFailedSeoAudits());
  const ok = swept !== null && quotaPurged !== null && failedPurged !== null;
  return NextResponse.json(
    { ok, swept, purged: { quotaBuckets: quotaPurged, failedAudits: failedPurged } },
    { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } }
  );
}
