import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { captureError } from "@/lib/errors";
import { getSeoAudit, claimUpgrade, setUpgradeState, runUpgradeInBackground, upgradeDone, upgradeRunning } from "@/lib/seo-audit/repo";
import { dfsReady } from "@/lib/seo-audit/dataforseo";

export const runtime = "nodejs";
// 付费升级:40 页抓取 ∥ 桌面 PSI ∥ DataForSEO 三模块,各自 60s、共享 deadline 250s;
// 响应本身 202 立即返回,运行挂在 waitUntil 后台。
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function inBackground(p: Promise<unknown>): void {
  try {
    waitUntil(p);
  } catch {
    /* 本地 dev 无 Vercel 上下文:promise 已在跑 */
  }
}

/**
 * 只读状态查询:{ done, unlocked, state, running }。前端据此轮询;POST 被网关掐断时也能发现
 * "其实已经生成好了"。绝不触发生成。done 的唯一判据是 result.plan === "full"
 * (与 $29 报告同一条纪律,事故 43t2y64rvky:不要发明第二种判据)。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const row = await getSeoAudit(params.id);
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    { done: upgradeDone(row), unlocked: row.unlocked, state: row.upgradeState ?? "idle", running: upgradeRunning(row) },
    { headers: NO_STORE }
  );
}

/**
 * 付款解锁后,真正生成完整报告。
 * 402 未解锁 · 200 { done: true } 已完成 · 409 { running } 另一请求在跑(DB CAS 输家)
 * 503 { pendingProvider } DataForSEO 不可用/余额不足 · 202 { started } 已在后台开跑。
 * **付款(unlocked)是唯一前置条件,不按 userId 拦**(复审 C16/C25):匿名付款人与报告创建者常常不是
 * 同一个会话(换设备、登出后付款、同事拿着链接付款),按 userId 拦就是"收了钱、永远生成不出来"。
 * 放开不增加任何暴露:报告本来就凭 id 公开;生成一次性且有 claimUpgrade 的 DB CAS,不会多花一分钱。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const row = await getSeoAudit(id);
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });

  // 付款是唯一前置条件
  if (!row.unlocked) {
    return NextResponse.json({ error: "This report hasn't been unlocked yet." }, { status: 402, headers: NO_STORE });
  }

  // 幂等:完整报告已生成则直接返回
  if (upgradeDone(row)) {
    return NextResponse.json({ ok: true, done: true }, { headers: NO_STORE });
  }
  if (upgradeRunning(row)) {
    return NextResponse.json({ ok: true, done: false, running: true }, { status: 409, headers: NO_STORE });
  }

  // DB CAS:跨实例只有一个赢家;输家交给轮询
  const claimed = await claimUpgrade(id);
  if (!claimed) {
    return NextResponse.json({ ok: true, done: false, running: true }, { status: 409, headers: NO_STORE });
  }

  // 跑前预检供应商(余额 ≥ $1 / 可连通)。不可用 → pending_provider + 错误收件箱,
  // 允许用户稍后再 POST(CAS 允许从 pending_provider 重新抢)。
  const ready = await dfsReady();
  if (!ready.ok) {
    await setUpgradeState(id, "pending_provider");
    await captureError({
      name: "seo_audit_provider",
      message: `DataForSEO not ready (${ready.reason ?? "unknown"}; balance ${ready.balance ?? "n/a"}) — upgrade for ${id} parked as pending_provider`,
      route: "/api/seo-audit/[id]/upgrade",
      source: "server",
      level: "error",
      meta: { id, reason: ready.reason ?? null, balance: ready.balance },
    });
    return NextResponse.json(
      // 如实说:没有后台自动重试,是用户(或页面)稍后再 POST 时才会生成
      { error: "Our data provider is temporarily unavailable. Your payment is safe — try again in a few minutes and we'll build the full report.", pendingProvider: true },
      { status: 503, headers: NO_STORE }
    );
  }

  inBackground(runUpgradeInBackground(id));
  return NextResponse.json({ ok: true, started: true, done: false }, { status: 202, headers: NO_STORE });
}
