import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { z } from "zod";
import { saveLead } from "@/lib/leads";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  subject: z.string().max(160).optional(),
  message: z.string().min(5).max(4000),
  // 蜜罐(机器人会填)
  company: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`contact:${ip}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many messages. Try again later." }, { status: 429 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Please fill in all fields correctly." }, { status: 400 });
  }
  if (body.company) return NextResponse.json({ ok: true }); // 蜜罐命中,静默成功

  // 联系消息落库到 Neon(leads 表,type=contact);站点维护者可从数据库查看。不再发邮件。
  try {
    await saveLead({
      email: body.email,
      type: "contact",
      name: body.name,
      message: body.message,
      meta: { subject: body.subject },
    });
  } catch (e) {
    console.error("lead save failed", e);
    await captureError({ name: "contact", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/contact", source: "server" });
    return NextResponse.json({ error: "Couldn’t send your message. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
