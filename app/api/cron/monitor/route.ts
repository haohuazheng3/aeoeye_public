import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitors } from "@/lib/db/schema";
import { runAudit } from "@/lib/engine/run";
import { saveAuditResult, createAudit } from "@/lib/engine/repo";
import { saveLead } from "@/lib/leads";
import { env, features } from "@/lib/env";
import { sweepStaleSeoAudits, SEO_STALE_RUN_MS } from "@/lib/seo-audit/repo";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  // Vercel Cron 在配置了 CRON_SECRET 时会带上该 Bearer
  if (!env.CRON_SECRET) return true;
  return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

/**
 * SEO 审计卡死清扫:pending/running 超过 6 分钟的行标 failed("Timed out";有旧报告的重跑则恢复 complete),
 * running 超过 6 分钟的升级标 failed。运行自己有 250s 的 deadline,这里是最后一道兜底 ——
 * waitUntil 后台被平台掐断时,报告页才不会永远转圈。放在 LLM 门之前:它不依赖任何引擎。
 */
async function sweepSeoAudits(): Promise<{ restored: number; timedOut: number; upgradesFailed: number } | { error: string }> {
  try {
    const r = await sweepStaleSeoAudits(SEO_STALE_RUN_MS);
    if (r.timedOut || r.restored || r.upgradesFailed) {
      await captureError({
        name: "seo_audit_stale_sweep",
        message: `stale SEO audit runs: ${r.timedOut} timed out, ${r.restored} re-runs restored, ${r.upgradesFailed} upgrades failed`,
        route: "/api/cron/monitor",
        source: "server",
        level: "warn",
        meta: r,
      });
    }
    return r;
  } catch (e) {
    await captureError({ name: "seo_audit_stale_sweep", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/cron/monitor", source: "server" });
    return { error: String((e as Error)?.message ?? e) };
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const seoAudits = await sweepSeoAudits();
  if (!features.llm) return NextResponse.json({ ran: 0, note: "engine not configured", seoAudits });

  const now = new Date();
  const due = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.active, true), or(isNull(monitors.nextRunAt), lte(monitors.nextRunAt, now))))
    .limit(10); // 每次最多处理 10 个,避免超时

  let ran = 0;
  for (const m of due) {
    try {
      const id = await createAudit({ input: m.url || m.brand, source: "monitor", userId: m.userId });
      const result = await runAudit(m.url || m.brand, { plan: "full" });
      await saveAuditResult(id, result);

      const prev = m.lastScore;
      const next = result.overallScore;
      const cadenceDays = m.cadence === "monthly" ? 30 : 7;
      const nextRun = new Date(now.getTime() + cadenceDays * 86400 * 1000);
      await db
        .update(monitors)
        .set({ lastAuditId: id, lastScore: next, nextRunAt: nextRun })
        .where(eq(monitors.id, m.id));

      // 可见度明显下降则记录告警(落库到 Neon leads,type=monitor;不再发邮件)
      if (prev !== null && prev - next >= 8) {
        try {
          await saveLead({
            email: env.EMAIL_REPLY_TO,
            type: "monitor",
            brand: m.brand,
            auditId: id,
            message: `AI visibility dropped: ${prev} → ${next}`,
            meta: { prev, next, auditId: id, url: m.url, userId: m.userId },
          });
        } catch (e) {
          console.error("monitor alert save failed", m.id, e);
          await captureError({ name: "monitor-alert", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/cron/monitor", source: "server" });
        }
      }
      ran++;
    } catch (e) {
      console.error("monitor run failed", m.id, e);
      await captureError({ name: "monitor-run", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/cron/monitor", source: "server" });
    }
  }

  return NextResponse.json({ ran, due: due.length, seoAudits });
}
