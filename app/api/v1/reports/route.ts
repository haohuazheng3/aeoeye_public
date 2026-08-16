import { NextResponse } from "next/server";
import { z } from "zod";
import { captureError } from "@/lib/errors";
import { authenticateApiKey, recordApiRequest } from "@/lib/api-keys";
import { withCostLedger } from "@/lib/cost";
import { runAudit, AuditError } from "@/lib/engine/run";
import { saveApiReport } from "@/lib/engine/repo";
import { shortId } from "@/lib/utils";

export const runtime = "nodejs";
// 完整报告 = 10 题 × 5 引擎 + 地基层五模块 + 汇总。这是全站最长的一条链路。
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  input: z.string().min(2, "Provide a brand name or website.").max(120),
});

/**
 * POST /api/v1/reports —— 一次调用产出**完整付费报告**的 JSON。
 *
 * 刻意不做"只取报告某一块"的参数:报告里的分数、阶梯、缺口、竞品是同一批回答
 * 推导出来的,拆开取会让调用方拿到互相矛盾的片段。要什么自己从完整 JSON 里挑。
 *
 * 认证:Authorization: Bearer aeo_live_… (目前只认站长本人的 key,不限额)。
 * 每次调用 —— 成功或失败 —— 都会落一条账单,usage 界面据此展开到每一笔供应商花费。
 */
export async function POST(req: Request) {
  const started = Date.now();
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) {
    return err(401, "unauthorized", "Missing or invalid API key. Pass it as: Authorization: Bearer aeo_live_…");
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body.";
    return err(400, "invalid_request", msg || "Invalid request body.");
  }

  const requestId = `req_${shortId(16)}`;

  // 账本包住整条链路 —— 引擎里每一次 OpenAI / Anthropic / DataForSEO 调用
  // 都会把自己的花费记进来(lib/cost.ts),包括失败和重试的那些。
  const { result: outcome, entries } = await withCostLedger(async () => {
    try {
      const audit = await runAudit(body.input, { plan: "full", source: "api" });
      const id = await saveApiReport({ input: body.input, result: audit, userId: auth.userId });
      return { ok: true as const, id, audit };
    } catch (e) {
      return { ok: false as const, e };
    }
  });

  const durationMs = Date.now() - started;

  if (!outcome.ok) {
    const e = outcome.e;
    const isUserError = e instanceof AuditError && e.code === "invalid";
    const status = isUserError ? 400 : e instanceof AuditError && e.code === "unconfigured" ? 503 : 500;
    const message =
      e instanceof AuditError
        ? e.message
        : "The report could not be generated. Nothing was charged beyond the usage already recorded.";

    await recordApiRequest({
      keyId: auth.keyId,
      userId: auth.userId,
      endpoint: "POST /api/v1/reports",
      input: body.input,
      status: "failed",
      httpStatus: status,
      error: String((e as Error)?.message ?? e).slice(0, 500),
      durationMs,
      entries,
    });
    if (!isUserError) {
      await captureError({
        name: "api_report_failed",
        message: String((e as Error)?.message ?? e),
        stack: (e as Error)?.stack,
        route: "/api/v1/reports",
        source: "server",
      });
    }
    return err(status, isUserError ? "invalid_request" : "report_failed", message, requestId);
  }

  await recordApiRequest({
    keyId: auth.keyId,
    userId: auth.userId,
    endpoint: "POST /api/v1/reports",
    input: body.input,
    auditId: outcome.id,
    status: "succeeded",
    httpStatus: 200,
    durationMs,
    entries,
  });

  return NextResponse.json(
    {
      object: "report",
      id: outcome.id,
      request_id: requestId,
      created_at: new Date().toISOString(),
      duration_ms: durationMs,
      report_url: `https://aeoeye.com/audit/${outcome.id}`,
      report: outcome.audit,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

/** 统一错误体 —— 形状固定,调用方可以稳定地 switch code */
function err(status: number, code: string, message: string, requestId?: string) {
  return NextResponse.json(
    { object: "error", error: { code, message }, ...(requestId ? { request_id: requestId } : {}) },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  return err(
    405,
    "method_not_allowed",
    "Use POST with a JSON body: { \"input\": \"yourbrand.com\" }. See https://aeoeye.com/account/api"
  );
}
