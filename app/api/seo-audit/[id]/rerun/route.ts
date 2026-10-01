import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { captureError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { getSeoAudit, startRerun, runRerunInBackground, rerunAllowed, upgradeRunning, SEO_PAID_REFRESH_MAX } from "@/lib/seo-audit/repo";
import { consumeRerunQuotas, retryInWords, QuotaUnavailableError, type RerunQuotaOutcome } from "@/lib/seo-audit/quota";
import { SeoAuditError } from "@/lib/seo-audit/url";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

const Body = z.object({
  /** true → 同时刷新 DataForSEO 三模块(每份报告最多 2 次);默认只重跑免费模块(上一份缺模块时顺带补缺) */
  refreshPaid: z.boolean().optional(),
});

function inBackground(p: Promise<unknown>): void {
  try {
    waitUntil(p);
  } catch {
    /* 本地 dev 无 Vercel 上下文:promise 已在跑 */
  }
}

function quotaDenied(q: Exclude<RerunQuotaOutcome, { ok: true }>): NextResponse {
  const headers = { ...NO_STORE, "Retry-After": String(q.retryAfterSec) };
  const wait = retryInWords(q.retryAfterSec);
  const error =
    q.kind === "rerun_hour"
      ? `This report was re-run several times in the last hour. Try again in ${wait}.`
      : q.kind === "rerun_day"
        ? `This report has reached today's re-run limit. Try again in ${wait}.`
        : `We're at capacity right now. Please try again in ${wait}.`;
  return NextResponse.json({ error, retryAfter: q.retryAfterSec }, { status: 429, headers });
}

/**
 * 解锁后 30 天内的重跑。免费模块(探针 / 40 页抓取 / PSI 移动端 + 桌面端)总次数不限、频率受限
 * (每份报告 1h ≤6、24h ≤30,并计入全站每小时总闸 —— 复审 C4/C38:每次重跑都是一次真实抓取 + 2 次 PSI);
 * DataForSEO 模块只在 refreshPaid(或上一份缺模块需要补缺)且还有额度(paid_refresh_count < 2)时调用。
 * 404 不存在 · 403 未解锁或已过 30 天 / 不是本人 · 409 已有运行在进行 · 429 频率超限 · 202 { ok, started }。
 * 上一次的分数写进 meta.notes("Previous score: N (date)"),UI 据此并列显示前后分。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const row = await getSeoAudit(id);
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });

  if (!rerunAllowed(row)) {
    return NextResponse.json(
      {
        error: row.unlocked
          ? "Re-runs are included for 30 days after unlocking; that window has closed for this report."
          : "Unlock the full report to re-run it. Free reports can be re-run from the audit page (one forced re-run per hour).",
      },
      { status: 403, headers: NO_STORE }
    );
  }
  // 绑定了账户的报告只许本人重跑(重跑会动用这份报告仅有的 2 次付费刷新额度)。
  // 匿名购买的行 user_id 为空(lib/orders.ts 在首次解锁时把匿名付款的行归为匿名),凭链接即可重跑,
  // 由下面的每报告频率桶兜底。
  if (row.userId) {
    const session = await getSessionUser();
    if (row.userId !== session?.userId) {
      return NextResponse.json({ error: "Sign in with the account that owns this report to re-run it.", requiresAuth: true }, { status: 403, headers: NO_STORE });
    }
  }

  let body: z.infer<typeof Body> = {};
  try {
    const text = await req.text();
    if (text.trim()) body = Body.parse(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  }

  if (row.status === "pending" || row.status === "running" || upgradeRunning(row)) {
    return NextResponse.json({ error: "A run is already in progress for this report.", running: true }, { status: 409, headers: NO_STORE });
  }

  // 频率闸放在 409 预检之后:运行期间的轮询 / 重复点击不该白白烧掉配额。
  // 只有数据库故障(QuotaUnavailableError)才放行;其他异常是代码问题,走 500。
  try {
    const q = await consumeRerunQuotas(id);
    if (!q.ok) return quotaDenied(q);
  } catch (e) {
    if (!(e instanceof QuotaUnavailableError)) {
      console.error("seo audit rerun quota error", e);
      await captureError({ name: "seo_audit_rerun_quota", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/seo-audit/[id]/rerun", source: "server", meta: { id } });
      return NextResponse.json({ error: "Couldn't start a re-run. Please try again." }, { status: 500, headers: NO_STORE });
    }
    await captureError({ name: "seo_audit_quota", message: `rerun quotas: ${e.message}`, route: "/api/seo-audit/[id]/rerun", source: "server", level: "warn", meta: { id } });
  }

  try {
    const plan = await startRerun(id, { refreshPaid: body.refreshPaid === true });
    inBackground(runRerunInBackground(id, plan));
    const used = (row.paidRefreshCount ?? 0) + (plan.refreshPaid || plan.fillMissing ? 1 : 0);
    return NextResponse.json(
      {
        ok: true,
        started: true,
        refreshPaid: plan.refreshPaid,
        fillMissing: plan.fillMissing,
        paidRefreshesLeft: Math.max(0, SEO_PAID_REFRESH_MAX - used),
        ...(body.refreshPaid && !plan.refreshPaid ? { note: "Paid data refreshes are used up for this report; free modules were re-run." } : {}),
      },
      { status: 202, headers: NO_STORE }
    );
  } catch (e) {
    if (e instanceof SeoAuditError && e.code === "timeout") {
      return NextResponse.json({ error: e.message, running: true }, { status: 409, headers: NO_STORE });
    }
    if (e instanceof SeoAuditError) {
      return NextResponse.json({ error: e.message }, { status: 400, headers: NO_STORE });
    }
    console.error("seo audit rerun error", e);
    await captureError({ name: "seo_audit_rerun_start", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/seo-audit/[id]/rerun", source: "server", meta: { id } });
    return NextResponse.json({ error: "Couldn't start a re-run. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
