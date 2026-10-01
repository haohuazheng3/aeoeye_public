import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { captureError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { startSeoAudit, runSeoAuditInBackground, findRecentFreeSeoAudit, findOwnCachedCopy, createCachedCopy, SEO_AUDIT_REUSE_MS } from "@/lib/seo-audit/repo";
import {
  consumeRunQuotas,
  consumeCopyQuota,
  ipHash,
  ipBucketKey,
  quotaSubject,
  retryInWords,
  QuotaUnavailableError,
  type RunQuotaDenial,
} from "@/lib/seo-audit/quota";
import { normalizeInput, assertPublicHost, SeoAuditError } from "@/lib/seo-audit/url";

export const runtime = "nodejs";
// 请求本身 <1s 返回;真正的运行挂在 waitUntil 后台,共享 deadline 250s。
// 函数只按实际用时计费,300s 是让后台跑完 + 落库的余量,不是预期时长。
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  url: z.string().min(3, "Enter a website URL.").max(200, "That URL is too long."),
  source: z.string().max(60).optional(),
  /** true → 跳过 6 小时内同入口 URL 免费报告的复制,强制重跑(免费层同域每小时 1 次,登录与匿名一样) */
  fresh: z.boolean().optional(),
});

/** 进程内限流(第一道便宜的闸):每 IP(IPv6 按 /64 归桶)10 分钟 5 次。跨实例的硬闸在 quota.ts */
const RL_LIMIT = 5;
const RL_WINDOW_MS = 10 * 60 * 1000;

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** 本地 dev 没有 Vercel 请求上下文时 waitUntil 是空操作 —— promise 已经在跑,直接放手即可 */
function inBackground(p: Promise<unknown>): void {
  try {
    waitUntil(p);
  } catch {
    /* 已经启动,无需处理 */
  }
}

const minutes = retryInWords;

/**
 * 配额计数本身故障(数据库)时放行 —— 限流是防滥用,不是功能依赖。**只认 QuotaUnavailableError**:
 * 其余异常(例如桶名非法)是确定性的代码问题,原样抛给外层走 500,绝不静默放行(复审 C9)。
 */
async function failOpenOnQuotaOutage(e: unknown, what: string): Promise<void> {
  if (!(e instanceof QuotaUnavailableError)) throw e;
  await captureError({ name: "seo_audit_quota", message: `${what}: ${e.message}`, route: "/api/seo-audit", source: "server", level: "warn" });
}

function denial(d: RunQuotaDenial): NextResponse {
  const headers = { ...NO_STORE, "Retry-After": String(d.retryAfterSec) };
  switch (d.kind) {
    case "anonymous_day":
      return NextResponse.json(
        { error: "You've used today's 3 free audits from this network. Sign in to run up to 20 a day.", requiresAuth: true, retryAfter: d.retryAfterSec },
        { status: 401, headers }
      );
    case "user_day":
      return NextResponse.json({ error: `You've reached today's limit of 20 audits. Try again in ${minutes(d.retryAfterSec)}.`, retryAfter: d.retryAfterSec }, { status: 429, headers });
    case "domain_hour":
      return NextResponse.json({ error: `This site was audited several times in the last hour. Try again in ${minutes(d.retryAfterSec)}.`, retryAfter: d.retryAfterSec }, { status: 429, headers });
    case "global_hour":
      return NextResponse.json({ error: `We're at capacity right now. Please try again in ${minutes(d.retryAfterSec)}.`, retryAfter: d.retryAfterSec }, { status: 429, headers });
    case "fresh_hour":
      return NextResponse.json({ error: `One forced re-run per hour on the free tier — try again in ${minutes(d.retryAfterSec)}.`, retryAfter: d.retryAfterSec }, { status: 429, headers });
    case "ip_hour":
    default:
      return NextResponse.json({ error: `Too many SEO audits from this network. Try again in ${minutes(d.retryAfterSec)}.`, retryAfter: d.retryAfterSec }, { status: 429, headers });
  }
}

/**
 * 建行并在后台开跑。响应形状(V2-4):201 { id, reused }。
 * 400 无效输入 · 403 私网/被禁主机 · 401 匿名日配额用尽(requiresAuth) · 429 其他配额 · 500 未知。
 * 运行配额只对**真正触发抓取**的运行扣;复制缓存不扣运行配额,只过自己的 copy 桶(每请求者每小时 20 份)。
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  // IPv6 按 /64 归桶:一个用户通常拿到整个 /64,按原始地址计数等于换个源地址就满桶(复审 C5)
  const rl = rateLimit(`seo-audit:${ipBucketKey(ip)}`, { limit: RL_LIMIT, windowMs: RL_WINDOW_MS });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many SEO audits from this network. Try again in a few minutes.", retryAfter: rl.retryAfter },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid request.";
    return NextResponse.json({ error: msg }, { status: 400, headers: NO_STORE });
  }
  const input = body.url.trim();

  // 输入侧的两道门在建行之前:无效 URL → 400;私网 / 本站 / 元数据地址 → 403
  let norm: ReturnType<typeof normalizeInput>;
  try {
    norm = normalizeInput(input);
    await assertPublicHost(norm.host);
  } catch (e) {
    if (e instanceof SeoAuditError) {
      const status = e.code === "invalid" ? 400 : e.code === "blocked" ? 403 : 400;
      return NextResponse.json({ error: e.message }, { status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "Enter a valid website URL." }, { status: 400, headers: NO_STORE });
  }

  const session = await getSessionUser();
  const hash = ipHash(ip);
  const who = { source: body.source, userId: session?.userId, email: session?.email || undefined, ipHash: hash };

  try {
    // 免费层缓存:同入口 URL 6h 内的完成报告 → 复制成本人的一行(不扣运行配额、不共享 id)
    if (!body.fresh) {
      const recent = await findRecentFreeSeoAudit(norm.domain, SEO_AUDIT_REUSE_MS, norm.entryUrl);
      if (recent && !recent.unlocked) {
        // 登录用户对同一来源已有未解锁的副本 → 直接给回那一行,零写入(反复点同一 URL 不再每次插一整行 result)
        if (session?.userId) {
          const own = await findOwnCachedCopy(session.userId, recent.cachedFrom ?? recent.id);
          if (own) return NextResponse.json({ id: own, reused: true }, { status: 201, headers: NO_STORE });
        }
        // 副本不扣运行配额(设计契约),但每份都是一整行 result 的写入 —— 过一个便宜的跨实例桶(复审 C5/C43)
        try {
          const c = await consumeCopyQuota(quotaSubject({ userId: session?.userId, ipHash: hash }));
          if (!c.ok) {
            return NextResponse.json(
              { error: `Too many SEO audits from this network. Try again in ${minutes(c.retryAfterSec)}.`, retryAfter: c.retryAfterSec },
              { status: 429, headers: { ...NO_STORE, "Retry-After": String(c.retryAfterSec) } }
            );
          }
        } catch (e) {
          await failOpenOnQuotaOutage(e, "copy quota");
        }
        const id = await createCachedCopy(recent, { input, ...who });
        return NextResponse.json({ id, reused: true }, { status: 201, headers: NO_STORE });
      }
    }

    // 跨实例配额(只在真的要跑时扣)。数据库故障放行;其他异常落到外层 500
    try {
      const q = await consumeRunQuotas({ ipHash: hash, userId: session?.userId ?? null, domain: norm.domain, fresh: body.fresh === true });
      if (!q.ok) return denial(q);
    } catch (e) {
      await failOpenOnQuotaOutage(e, "run quotas");
    }

    const { id } = await startSeoAudit(input, who);
    inBackground(runSeoAuditInBackground(id));
    return NextResponse.json({ id, reused: false }, { status: 201, headers: NO_STORE });
  } catch (e) {
    if (e instanceof SeoAuditError) {
      const status = e.code === "invalid" ? 400 : e.code === "blocked" ? 403 : e.code === "unconfigured" ? 503 : 500;
      await captureError({
        name: `seo_audit_${e.code}`,
        message: e.message,
        route: "/api/seo-audit",
        source: "server",
        level: e.code === "unconfigured" ? "error" : "warn",
        meta: { input: input.slice(0, 200) },
      });
      return NextResponse.json({ error: e.message }, { status, headers: NO_STORE });
    }
    console.error("seo audit error", e);
    await captureError({ name: "seo_audit", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/seo-audit", source: "server" });
    return NextResponse.json({ error: "We couldn't start this SEO audit. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
