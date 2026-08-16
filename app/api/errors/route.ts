import { NextResponse } from "next/server";
import { z } from "zod";
import { captureError } from "@/lib/errors";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// 客户端错误上报 sink(window.onerror / unhandledrejection / error boundary)
const Body = z.object({
  name: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  stack: z.string().max(6000).optional(),
  route: z.string().max(300).optional(),
  level: z.enum(["error", "warn"]).optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`err:${ip}`, { limit: 30, windowMs: 5 * 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  await captureError({ ...body, source: "client" });
  return NextResponse.json({ ok: true });
}
