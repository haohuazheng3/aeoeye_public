import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { runAndStore } from "@/lib/engine/repo";
import { AuditError } from "@/lib/engine/run";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { features } from "@/lib/env";

export const runtime = "nodejs";
// 免费审计一轮要串起:出题(1 次推理)→ 3 题 × ChatGPT 联网作答 → 判卷 → 汇总。
// 主引擎换成 OpenAI 直连后实测约 90s,120s 没有余量 —— 首页转化全靠这条路径,
// 它超时就等于首页直接挂,宁可多留一倍预算(函数只按实际用时计费)。
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  input: z.string().min(2, "Enter a brand name or website.").max(120),
  source: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  // 限流:每 IP 每 10 分钟最多 8 次免费审计
  const ip = clientIp(req.headers);
  const rl = rateLimit(`audit:${ip}`, { limit: 8, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many audits from this network. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid request.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!features.llm) {
    return NextResponse.json(
      { error: "The audit engine is being configured. Please check back shortly." },
      { status: 503 }
    );
  }

  const session = await getSessionUser();
  const userId = session?.userId;

  try {
    const { id } = await runAndStore(body.input.trim(), { plan: "free", source: body.source, userId });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof AuditError) {
      const status = e.code === "invalid" ? 400 : e.code === "unconfigured" ? 503 : 500;
      return NextResponse.json({ error: e.message }, { status });
    }
    // Anthropic 过载/限流(429/529/5xx)——SDK 重试已耗尽仍失败。给用户明确的"稍后重试"
    // 而非把瞬时繁忙误报成永久失败;以 warn 级入库便于监控过载频次(不污染 error)。
    const httpStatus = (e as { status?: number })?.status;
    const errMsg = String((e as Error)?.message ?? e);
    if (httpStatus === 529 || httpStatus === 429 || httpStatus === 503 || /overloaded/i.test(errMsg)) {
      await captureError({ name: "audit_overloaded", message: errMsg, route: "/api/audit", source: "server", level: "warn" });
      return NextResponse.json(
        { error: "Our AI engines are handling unusually high demand right now. Please try again in a moment." },
        { status: 503 }
      );
    }
    // 额度耗尽 / 密钥失效 —— Anthropic 明确回 x-should-retry:false。让用户"再试一次"
    // 只会让他白等一整轮审计再失败一次,必须与瞬时故障区分开。对外不暴露计费细节,
    // 对内用独立错误名入库,便于在错误收件箱和 /api/health 里一眼看到。
    if (
      httpStatus === 401 ||
      httpStatus === 403 ||
      /credit balance is too low|insufficient[_ ]quota|billing|exceeded your current quota|invalid[_ ]api[_ ]key|authentication[_ ]error/i.test(
        errMsg
      )
    ) {
      console.error("audit blocked: provider credits/auth", e);
      await captureError({
        name: "audit_provider_credits",
        message: errMsg,
        stack: (e as Error)?.stack,
        route: "/api/audit",
        source: "server",
      });
      return NextResponse.json(
        { error: "Audits are temporarily unavailable while we restore engine capacity. We're on it — please check back shortly." },
        { status: 503 }
      );
    }

    console.error("audit error", e);
    await captureError({ name: "audit", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/audit", source: "server" });
    return NextResponse.json({ error: "We couldn't finish this audit. Please try again." }, { status: 500 });
  }
}
