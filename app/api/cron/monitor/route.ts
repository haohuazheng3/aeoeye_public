import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitors } from "@/lib/db/schema";
import { runAudit } from "@/lib/engine/run";
import { saveAuditResult, createAudit } from "@/lib/engine/repo";
import { saveLead } from "@/lib/leads";
import { env, features } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  // Vercel Cron 在配置了 CRON_SECRET 时会带上该 Bearer
  if (!env.CRON_SECRET) return true;
  return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!features.llm) return NextResponse.json({ ran: 0, note: "engine not configured" });

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

  return NextResponse.json({ ran, due: due.length });
}
