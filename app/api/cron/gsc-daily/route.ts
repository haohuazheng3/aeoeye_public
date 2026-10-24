import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { gscDaily } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { searchAnalyticsQuery } from "@/lib/google/search-console";

/**
 * Search Console 每日拉取(SEO 底座 v2):每天回拉最近 5 个可用日期(GSC 有 2–3 天延迟且会补数),
 * 写入 gsc_daily —— 当天全站合计 + date × page × query 明细。只读 scope、零成本。
 * 用来在发布 4–6 周后逐页复盘:Google 采用了哪个标题词条、哪些查询带来曝光与点击。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROPERTY = "sc-domain:aeoeye.com";
const DAYS_BACK = [2, 3, 4, 5, 6];

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return true;
  return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

const rowId = (date: string, page: string, query: string) => crypto.createHash("sha1").update(`${date}|${page}|${query}`).digest("hex");

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const summary: Record<string, number> = {};
  for (const back of DAYS_BACK) {
    const date = new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
    try {
      const [totals, detail] = await Promise.all([
        searchAnalyticsQuery(PROPERTY, { startDate: date, endDate: date, dimensions: ["date"], rowLimit: 1 }),
        searchAnalyticsQuery(PROPERTY, { startDate: date, endDate: date, dimensions: ["date", "page", "query"], rowLimit: 5000 }),
      ]);
      const rows = [
        ...totals.map((r) => ({ page: "", query: "", r })),
        ...detail.map((r) => ({ page: r.keys[1] ?? "", query: r.keys[2] ?? "", r })),
      ].map(({ page, query, r }) => ({ id: rowId(date, page, query), date, page, query, clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position }));
      for (let i = 0; i < rows.length; i += 500) {
        await db
          .insert(gscDaily)
          .values(rows.slice(i, i + 500))
          .onConflictDoUpdate({
            target: gscDaily.id,
            set: { clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, ctr: sql`excluded.ctr`, position: sql`excluded.position`, pulledAt: sql`now()` },
          });
      }
      summary[date] = rows.length;
    } catch (e) {
      await captureError({ name: "gsc_daily", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/cron/gsc-daily", source: "server", level: "warn", meta: { date } });
      summary[date] = -1;
    }
  }
  return NextResponse.json({ ok: true, property: PROPERTY, rows: summary });
}
