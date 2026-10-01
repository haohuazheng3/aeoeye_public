import { NextResponse } from "next/server";
import { getSeoAudit } from "@/lib/seo-audit/repo";
import { toPublicView } from "@/lib/seo-audit/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * 报告的只读状态 + 视图(V2-4):{ id, status, plan, unlocked, error, progress, cached, result }。
 * 免费视图由 toPublicView 在**服务端**裁掉付费内容 —— 付费墙在数据层,锁定区的真实数据不进响应体,
 * 前端模糊只是样式。
 * cached 只是布尔:cached_from 列里是**来源报告的 id**,报告凭 id 公开,发出去就是把别人的报告钥匙
 * 交给副本持有者(复审 C2)。
 * private, no-store:付款后 unlocked 翻转、后台每几秒更新 progress,任何一层缓存都会让人看到旧帧。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const row = await getSeoAudit(params.id);
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    {
      id: row.id,
      domain: row.domain,
      status: row.status,
      unlocked: row.unlocked,
      plan: row.plan,
      error: row.error,
      progress: row.progress ?? null,
      cached: !!row.cachedFrom,
      upgradeState: row.upgradeState ?? null,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      result: row.result ? toPublicView(row.result, row.unlocked) : null,
    },
    { headers: NO_STORE }
  );
}
