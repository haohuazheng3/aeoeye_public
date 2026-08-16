import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { LLM_MODEL_FULL, LLM_MODEL_ENGINE, LLM_MODEL_ENGINE_GPT, LLM_MODEL_FREE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 自诊断端点(E19)。每次部署后先打它。
 * 只报告"变量是否存在",绝不回显任何密钥值(0.7)。
 * DB 不通、必需 env 缺失、或未解决的严重错误 > 0 → 返回非 200。
 */

// 应用运行所必需的环境变量(缺任一即不健康)
// OPENAI_API 现在是**主引擎 + 全部分析**的唯一通道 —— 它缺席,连免费审计
// 都跑不起来,所以是必需项。ANTHROPIC_API_KEY 反过来降为可选:Claude 只是
// 五个受测引擎之一,直连缺席时走 DataForSEO 的 claude 通道,报告照常完整。
const REQUIRED_ENV = [
  "DATABASE_URL",
  "OPENAI_API",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];
// 可选(缺失只降级、不判不健康)
// RESEND_API_KEY 决定付款后能否把报告 PDF 寄给买家 —— 必须可观察,
// 否则"邮件没发出去"只能等用户投诉才发现。
const OPTIONAL_ENV = [
  "DATAFORSEO_B64",
  "FIRECRAWL_API_KEY",
  "RESEND_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "GOOGLE_SERVICE_ACCOUNT_B64",
  "CRON_SECRET",
  "ANTHROPIC_API_KEY",
  "PSI_API",
];

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

async function dbOk(): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.execute(sql`select 1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db error" };
  }
}

/**
 * 未解决的"严重"错误数 —— 只计**服务端/边缘**的 error 级(source in server/edge)。
 * 客户端错误(ChunkLoadError、扩展/网络抖动等)仍入收件箱供查看,但**不置红、不报警**,
 * 避免单个瞬时客户端错误每 30 分钟误报打扰站长。
 */
async function seriousErrorCount(): Promise<{ configured: boolean; unresolvedSerious: number }> {
  try {
    // 错误收件箱表存在才查询;不存在则视为未配置(不判不健康)
    const rows = await db.execute(
      sql`select count(*)::int as n from error_events where resolved = false and level = 'error' and source in ('server','edge')`
    );
    // drizzle neon-http: rows.rows[0].n
    const n = Number((rows as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
    return { configured: true, unresolvedSerious: n };
  } catch {
    return { configured: false, unresolvedSerious: 0 };
  }
}

function stripeMode(): "live" | "test" | "unset" {
  const k = process.env.STRIPE_SECRET_KEY || "";
  if (k.startsWith("sk_live_") || k.startsWith("rk_live_")) return "live";
  if (k.startsWith("sk_test_") || k.startsWith("rk_test_")) return "test";
  return "unset";
}

export async function GET() {
  const [database, errors] = await Promise.all([dbOk(), seriousErrorCount()]);

  const envPresence: Record<string, boolean> = {};
  for (const n of [...REQUIRED_ENV, ...OPTIONAL_ENV]) envPresence[n] = present(n);
  const missingRequired = REQUIRED_ENV.filter((n) => !present(n));

  const healthy = database.ok && missingRequired.length === 0 && errors.unresolvedSerious === 0;

  const body = {
    status: healthy ? "ok" : "degraded",
    time: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    database,
    envPresence, // 只有 true/false,永不含值
    missingRequired,
    // 模型分工是本产品最容易悄悄跑偏的配置(改个环境变量就变,报告照出、
    // 谁在分析却变了)。把生效值直接摊出来,不用跑一次审计才能确认。
    models: {
      freeAnalysis: LLM_MODEL_FREE, // 免费报告(3 题):出题 / 判卷 / 汇总
      paidAnalysis: LLM_MODEL_FULL, // 付费报告(10 题):新增 4 引擎 + 地基层 + 汇总
      // 受测引擎 —— 必须等于各家**免费用户**默认那一档,调强就是伪造用户体验
      testedEngines: {
        chatgpt: LLM_MODEL_ENGINE_GPT, // 主引擎,免费报告唯一实测的一家
        claude: LLM_MODEL_ENGINE,
      },
    },
    // 五个引擎这一刻能不能真跑 —— 报告里标 inactive 的原因直接在这里看得见
    engineChannels: {
      chatgpt: present("OPENAI_API"),
      claude: present("ANTHROPIC_API_KEY") || present("DATAFORSEO_B64"),
      gemini: present("DATAFORSEO_B64"),
      google_ai: present("DATAFORSEO_B64"),
      perplexity: present("DATAFORSEO_B64"),
    },
    stripe: { mode: stripeMode() },
    errorInbox: errors,
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
