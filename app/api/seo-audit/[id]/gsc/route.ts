import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { captureError } from "@/lib/errors";
import { GscError, gscConfigured, serviceAccountEmail } from "@/lib/google/search-console";
import { getSeoAudit, upgradeDone, upgradeRunning } from "@/lib/seo-audit/repo";
import { consumeQuota, HOUR_MS, QuotaUnavailableError, retryInWords } from "@/lib/seo-audit/quota";
import { claimStateFor, gscStatusView } from "@/lib/seo-audit/gsc";
import {
  claimReportOwnership,
  disconnectGsc,
  getGscStatus,
  startGscIntent,
  verifyGscClaim,
  type GscActionResult,
} from "@/lib/seo-audit/gsc-repo";

export const runtime = "nodejs";
// verify = sites.list ∥ 站点证明(首页 ≤2 次 × 8s、DNS 5s)→ 5 次 searchAnalytics.query(并发)→ 重算分数 → 写库
export const maxDuration = 90;
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const ROUTE = "/api/seo-audit/[id]/gsc";
/**
 * 每个登录用户每小时最多 20 次 intent / verify:所有客户共用同一个服务账号,它在 Search Console API 的
 * 每用户配额被刷爆时,所有已接入的报告都会拉不到数据;verify 还会去抓对方首页、查 DNS。
 */
const ATTEMPTS_PER_HOUR = 20;

const Body = z.object({ action: z.enum(["intent", "verify", "disconnect"]) });

async function sessionOrNull(): Promise<{ userId: string; email: string } | null> {
  try {
    return await getSessionUser();
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

/**
 * 接入状态(gsc.ts 的 gscStatusView,纯函数、有单测):
 * { connected, property, state: none|pending|verified|revoked, signedIn, canConnect,
 *   serviceAccountEmail, token, metaTag, dnsTxt, expiresAt, reason? }
 * - connected / property 只在已解锁时给(撤销态与免费视图一致,恒为空)。
 * - 服务账号邮箱、token、meta 标签、DNS 记录**只**在本人的 claim 是 pending / verified 时下发:
 *   先拿到 token 才看得到要授权的邮箱,站长就不会"先授权、后申请"。
 * - state 只反映当前用户自己的 claim;绝不透露其他用户的任何信息。不调用 Google,可随意刷新。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = await getSeoAudit(params.id);
    if (!row) return json({ error: "Not found." }, 404);
    const session = await sessionOrNull();
    const { property, ownClaims } = await getGscStatus(row.id, session?.userId ?? null);
    return json(
      gscStatusView({
        auditId: row.id,
        unlocked: row.unlocked,
        ownerUserId: row.userId,
        viewerUserId: session?.userId ?? null,
        configured: gscConfigured(),
        serviceAccountEmail: serviceAccountEmail(),
        gscProperty: property,
        ownClaims,
        now: new Date(),
      })
    );
  } catch (e) {
    await captureError({ name: "seo_gsc_status", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: ROUTE, source: "server", meta: { id: params.id } });
    return json({ error: "Couldn't load the Search Console status." }, 500);
  }
}

/**
 * POST { action: "intent" | "verify" | "disconnect" }
 * 200 { ok: true, state, property, message, serviceAccountEmail?, token?, metaTag?, dnsTxt?, expiresAt?, scoresUpdated? }
 * 409 { ok: false, state, code: token_not_found | no_property_access | expired | no_intent | report_busy, error, checks? }
 * 401 { requiresAuth } 未登录 · 404 · 403 未解锁 / 不是报告主人 · 429 尝试过于频繁 · 503 Google 不可达 / 未配置 · 400
 * 匿名购买的报告(user_id 为空):第一个发起接入的登录用户认领这份报告(写 user_id)。
 * 验证 / 断开后分数当场重算(recomputeRankingFromResult),不重跑、不花钱。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: z.infer<typeof Body>;
  try {
    const text = await req.text();
    body = Body.parse(JSON.parse(text || "{}"));
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  const session = await sessionOrNull();
  if (!session) return json({ ok: false, error: "Sign in to connect Search Console.", requiresAuth: true }, 401);

  const row = await getSeoAudit(params.id);
  if (!row) return json({ ok: false, error: "Not found." }, 404);
  if (!row.unlocked) return json({ ok: false, error: "Unlock the full report to connect Search Console." }, 403);
  if (row.userId && row.userId !== session.userId) {
    return json({ ok: false, error: "Only the account that owns this report can connect Search Console. Sign in with that account." }, 403);
  }
  if (!gscConfigured()) return json({ ok: false, error: "Search Console connection isn't available right now. Please try again later." }, 503);

  // 断开不限频(撤回授权永远要能做);intent / verify 会打 Google 与对方站点,按用户限频
  if (body.action !== "disconnect") {
    try {
      const q = await consumeQuota(`gsc:${session.userId}:1h`, HOUR_MS, ATTEMPTS_PER_HOUR);
      if (!q.ok) {
        return json(
          { ok: false, error: `Too many Search Console attempts. Try again in ${retryInWords(q.retryAfterSec)}.`, retryAfter: q.retryAfterSec },
          429,
          { "Retry-After": String(q.retryAfterSec) }
        );
      }
    } catch (e) {
      // 只有配额库故障放行(限流是防滥用,不是功能依赖);其余异常是代码问题
      if (!(e instanceof QuotaUnavailableError)) {
        await captureError({ name: "seo_gsc_quota", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: ROUTE, source: "server", meta: { id: row.id } });
        return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
      }
    }
  }

  try {
    if (!row.userId) {
      if (body.action === "disconnect") {
        // 没有归属的报告不可能已接入(接入第一步就会认领报告),什么都不动
        return json({ ok: true, state: "none", property: null, message: "Search Console isn't connected to this report." });
      }
      const claimed = await claimReportOwnership(row.id, session.userId);
      if (!claimed) {
        const again = await getSeoAudit(row.id);
        if (again?.userId !== session.userId) {
          return json({ ok: false, error: "Only the account that owns this report can connect Search Console. Sign in with that account." }, 403);
        }
      }
    }

    let result: GscActionResult;
    if (body.action === "intent") {
      result = await startGscIntent({ auditId: row.id, userId: session.userId, domain: row.domain });
    } else if (body.action === "verify") {
      // 数据要并进一份已生成完的完整报告:生成 / 重跑途中并进去会被那次运行的落库整份覆盖
      if (!upgradeDone(row) || row.status !== "complete" || upgradeRunning(row)) {
        const { ownClaims } = await getGscStatus(row.id, session.userId);
        const error = !upgradeDone(row)
          ? "Your full report is still being generated. Connect Search Console once it's ready."
          : "A run is in progress for this report. Click Verify again when it finishes.";
        return json({ ok: false, state: claimStateFor(ownClaims, row.id, new Date()), code: "report_busy", error }, 409);
      }
      result = await verifyGscClaim({ auditId: row.id, userId: session.userId, domain: row.domain, entryUrl: row.url });
    } else {
      result = await disconnectGsc({ auditId: row.id, userId: session.userId });
    }
    return json(result, result.ok ? 200 : 409);
  } catch (e) {
    if (e instanceof GscError) {
      const transient = e.code === "timeout" || e.code === "network" || e.code === "upstream" || e.code === "rate_limited";
      await captureError({
        name: `seo_gsc_${e.code}`,
        message: e.message,
        route: ROUTE,
        source: "server",
        // 凭据 / 权限类问题是配置故障,必须让站长看到;Google 临时抖动只记 warn
        level: transient ? "warn" : "error",
        meta: { id: row.id, action: body.action, status: e.status },
      });
      return json({ ok: false, error: "We couldn't reach Google Search Console. Please try again in a minute." }, 503);
    }
    console.error("seo audit gsc error", e);
    await captureError({ name: "seo_gsc_action", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: ROUTE, source: "server", meta: { id: row.id, action: body.action } });
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
