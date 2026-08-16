import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies, headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { shortId } from "@/lib/utils";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// 第一方事件 sink(E24)。服务端补齐 userId / 市级属地 / 自测标记。
const Body = z.object({
  type: z.string().max(40),
  path: z.string().max(300).optional(),
  referrer: z.string().max(500).optional(),
  source: z.string().max(200).optional(),
  sessionId: z.string().min(1).max(64),
  visitorId: z.string().max(64).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`ev:${ip}`, { limit: 150, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let userId: string | undefined;
  try {
    userId = (await auth()).userId ?? undefined;
  } catch {
    /* 未登录 */
  }

  const h = headers();
  const cityRaw = h.get("x-vercel-ip-city");
  const ipCity = cityRaw ? decodeURIComponent(cityRaw) : undefined;
  // 自测过滤:访问过 /admin-dashboard 的设备会种下 aeo_no_track cookie(第8轮)
  const isSelf = cookies().get("aeo_no_track")?.value === "1";

  try {
    await db.insert(events).values({
      id: shortId(16),
      sessionId: body.sessionId,
      visitorId: body.visitorId,
      userId,
      type: body.type,
      path: body.path,
      referrer: body.referrer,
      source: body.source,
      meta: body.meta,
      ipCity,
      isSelf,
    });
  } catch {
    /* 埋点失败不影响用户 */
  }

  return NextResponse.json({ ok: true });
}
