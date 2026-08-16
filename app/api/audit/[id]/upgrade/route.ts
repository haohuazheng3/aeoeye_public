import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { getAudit, upgradeToFull } from "@/lib/engine/repo";
import { AuditError } from "@/lib/engine/run";
import { deliverReportPdf } from "@/lib/report-delivery";

export const runtime = "nodejs";
// 完整报告要实时查 4 个 DataForSEO 引擎 + Claude,耗时较长
export const maxDuration = 300;

// 同实例内的去重锁,避免同一报告被并发重复生成(浪费 DataForSEO 额度)
const inFlight = new Set<string>();

/**
 * 升级到底完成没有 —— 唯一判据是报告自己的 plan。
 *
 * ⚠️ 绝不能再用"enginesLive 里有没有某个引擎"。旧判据是 `live.includes("chatgpt")`,
 * 那是主引擎还是 Claude 时写的(chatgpt 只有付费轮才出现)。2026-08-09 主引擎换成
 * ChatGPT 后,**免费报告的 enginesLive 里本来就有 chatgpt**,判据恒为 true:
 *   POST 一进来就命中幂等分支 → 升级从不执行 → 返回 done → 前端 reload →
 *   reload 后还是免费版、又触发 → 页面无限刷新,付费用户永远拿不到完整报告。
 * 生产事故(报告 43t2y64rvky)。plan 只有 upgradeToFull 真的写完才会变成 "full"。
 */
function upgradeDone(audit: { result?: { meta?: { plan?: string } } | null }): boolean {
  return audit.result?.meta?.plan === "full";
}

/**
 * 只读状态查询。生成要跑好几分钟,POST 本身可能被网关掐断 ——
 * 前端据此轮询,即使 POST 超时也能发现"其实已经生成好了",
 * 不会把成功的生成误报成失败。绝不触发生成。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const audit = await getAudit(params.id);
  if (!audit) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ done: upgradeDone(audit), unlocked: !!audit.unlocked });
}

/** 付费解锁后,真正生成完整多引擎报告(Claude / Gemini / Google AI / Perplexity + 补题到 10)。 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  const audit = await getAudit(id);
  if (!audit) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // 付款是唯一前置条件 —— 匿名购买(checkout 允许不登录)的报告没有 userId,
  // 此前这里强制要求 session 并比对 userId,导致匿名付款后完整报告 100% 生成不了。
  // 授权凭据:已解锁 + 随机不可枚举的报告 ID;绑定了账户的报告仍必须本人。
  if (!audit.unlocked) {
    return NextResponse.json({ error: "This report hasn't been unlocked yet." }, { status: 403 });
  }
  if (audit.userId) {
    const session = await getSessionUser();
    if (audit.userId !== session?.userId) {
      return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    }
  }

  // 幂等:完整报告已生成则直接返回
  if (upgradeDone(audit)) {
    return NextResponse.json({ done: true });
  }

  // 已有另一请求在生成中
  if (inFlight.has(id)) {
    return NextResponse.json({ done: false, running: true });
  }

  inFlight.add(id);
  try {
    await upgradeToFull(id);
    // 完整报告生成完毕 → 把 PDF 发到买家在 Stripe 填的邮箱。
    // 内部已幂等且不抛错:邮件发不出去不该让"报告已生成"变成失败。
    const fresh = await getAudit(id);
    if (fresh?.result) {
      const d = await deliverReportPdf({ auditId: id, result: fresh.result });
      return NextResponse.json({ done: true, emailed: d.sent });
    }
    return NextResponse.json({ done: true });
  } catch (e) {
    const errMsg = String((e as Error)?.message ?? e);
    const httpStatus = (e as { status?: number })?.status;
    // 额度耗尽 / 密钥失效:这位用户已经付过 $29,让他反复"重试"最伤。
    // 明确告知会自动补上,并单独入库(付费路径受阻优先级最高)。
    if (
      httpStatus === 401 ||
      httpStatus === 403 ||
      /credit balance is too low|insufficient[_ ]quota|billing|exceeded your current quota|invalid[_ ]api[_ ]key|authentication[_ ]error/i.test(
        errMsg
      )
    ) {
      console.error("audit upgrade blocked: provider credits/auth", e);
      await captureError({
        name: "audit_upgrade_provider_credits",
        message: errMsg,
        stack: (e as Error)?.stack,
        route: "/api/audit/[id]/upgrade",
        source: "server",
      });
      return NextResponse.json(
        {
          error:
            "Your report is paid for and safe. We're restoring engine capacity — the full multi-engine analysis will finish automatically, no need to retry.",
        },
        { status: 503 }
      );
    }
    // 引擎侧已给出面向用户的准确说法(如多引擎服务暂不可用)—— 原样透出,别盖成"请重试"
    if (e instanceof AuditError) {
      await captureError({
        name: "audit_upgrade_unavailable",
        message: errMsg,
        route: "/api/audit/[id]/upgrade",
        source: "server",
        level: "warn",
      });
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    console.error("audit upgrade error", e);
    await captureError({ name: "audit-upgrade", message: errMsg, stack: (e as Error)?.stack, route: "/api/audit/[id]/upgrade", source: "server" });
    return NextResponse.json(
      { error: "Your payment is safe. We hit a snag adding the other engines — you can retry now or come back later." },
      { status: 500 }
    );
  } finally {
    inFlight.delete(id);
  }
}
