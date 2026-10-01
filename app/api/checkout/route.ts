import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { captureError } from "@/lib/errors";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { stripe, priceIdFor, isSubscription, type Product } from "@/lib/stripe";
import { createPendingOrder } from "@/lib/orders";
import { features } from "@/lib/env";
import { absoluteUrl } from "@/lib/site";
import { db } from "@/lib/db";
import { seoAudits } from "@/lib/db/schema";
import { SEO_REPORT_PRICE_CENTS } from "@/lib/seo-audit/types";
import { dfsReady } from "@/lib/seo-audit/dataforseo";

export const runtime = "nodejs";

const Body = z.object({
  product: z.enum(["report", "seo_report", "pro_monthly", "pro_yearly"]),
  auditId: z.string().max(40).optional(),
  // 测试用优惠券(如 freezhen);仅接受安全字符
  coupon: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(40).optional(),
});

/**
 * $10 完整 SEO 报告没有预建 Price 时用内联价格。
 * 刻意不走 "缺 price id → 503" 那条路:本站有过 env 在 Vercel 上静默不生效的历史,
 * 一个只靠后台配置才能卖的产品,上线当天就可能悄悄卖不出去。
 */
const SEO_REPORT_PRICE_DATA: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
  currency: "usd",
  unit_amount: SEO_REPORT_PRICE_CENTS,
  product_data: {
    name: "AEOeye Full SEO Report",
    description:
      "One-time purchase. Every check with evidence and fixes, page-level table, backlink authority, rankings, competitors and a prioritized roadmap.",
  },
};

export async function POST(req: Request) {
  if (!features.stripe) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const product = body.product as Product;

  // Pro 订阅已下线 —— 站点只卖一次性报告。前端入口已移除,这里同样拒绝,
  // 否则直接打 API 仍能开出新订阅(既有订阅不受影响,由 Stripe 侧单独处理)。
  if (isSubscription(product)) {
    return NextResponse.json(
      { error: "Subscriptions are no longer offered — the full report is a one-time $29 purchase." },
      { status: 410 }
    );
  }

  const isSeoReport = product === "seo_report";

  // SEO 报告的订单必须挂在一份真实存在、已完成、未解锁、且没被防火墙拦下的 seo_audits 行上:
  // 付款后 markOrderPaid 按这个 id 解锁,id 对不上就是"收了钱、什么都没解锁";
  // 被拦下的报告没有内容可解锁,收这笔钱只会变成退款。$29 报告沿用旧行为(auditId 可空 → 回 dashboard)。
  if (isSeoReport) {
    if (!body.auditId) return NextResponse.json({ error: "Missing report id." }, { status: 400 });
    const rows = await db
      .select({
        id: seoAudits.id,
        status: seoAudits.status,
        unlocked: seoAudits.unlocked,
        outcome: sql<string | null>`${seoAudits.result}->'meta'->>'outcome'`,
      })
      .from(seoAudits)
      .where(eq(seoAudits.id, body.auditId))
      .limit(1);
    const audit = rows[0];
    if (!audit) return NextResponse.json({ error: "That SEO report could not be found." }, { status: 404 });
    if (audit.status !== "complete") {
      return NextResponse.json(
        { error: audit.status === "failed" ? "This audit didn't finish, so there's nothing to unlock yet. Re-run it first." : "This audit is still running. Wait for it to finish, then unlock it." },
        { status: 400 }
      );
    }
    if (audit.unlocked) {
      return NextResponse.json({ error: "This report is already unlocked." }, { status: 400 });
    }
    if (audit.outcome === "blocked") {
      return NextResponse.json(
        { error: "This site's firewall blocked our crawler, so there is no full report to unlock yet. Allow the AEOeyeBot user agent (see aeoeye.com/bot), re-run the audit, then unlock." },
        { status: 400 }
      );
    }
    // 服务端兜底(复审 C28):页面上不止一个 "Unlock · $10" 按钮,旧标签页、直接打 API 也能到这里 ——
    // 供应商此刻交付不了就不收钱。dfsReady 只查 appendix/user_data(免费端点),带进程内缓存。
    const ready = await dfsReady().catch(() => ({ ok: false }));
    if (!ready.ok) {
      return NextResponse.json(
        { error: "The full report is temporarily unavailable — our ranking-data provider is offline. Your free report stays here; please try again shortly." },
        { status: 503 }
      );
    }
  }

  const priceId = priceIdFor(product);
  if (!priceId && !isSeoReport) return NextResponse.json({ error: "This plan isn’t available yet." }, { status: 503 });

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = priceId
    ? { price: priceId, quantity: 1 }
    : { price_data: SEO_REPORT_PRICE_DATA, quantity: 1 };

  const sub = false as const;

  const session = await getSessionUser();
  const userId: string | undefined = session?.userId;
  const email: string | undefined = session?.email;

  // 单次报告购买允许匿名:订单凭 auditId 解锁(markOrderPaid 不依赖 userId),
  // 买家在 Stripe 页填邮箱即可,不再强制注册 —— 降低付费门槛。
  // 订阅仍必须登录:Pro 权益要挂在账户上才能持续生效(dashboard/续订/权益校验)。
  if (!userId && sub) {
    return NextResponse.json({ error: "Please sign in to subscribe.", requiresAuth: true }, { status: 401 });
  }

  // 两个产品各回各的报告页:买 SEO 报告的人落到 /audit/… 会以为买错了东西
  const reportBase = isSeoReport ? "/seo-audit" : "/audit";
  const successPath = sub
    ? "/dashboard?welcome=1"
    : body.auditId
      ? `${reportBase}/${body.auditId}?unlocked=1`
      : "/dashboard";
  const cancelPath = body.auditId ? `${reportBase}/${body.auditId}` : isSeoReport ? "/seo-audit" : "/pricing";

  try {
    // URL 里的 coupon 是用户可读的促销码(例如 haohua),不是 Stripe Coupon ID。
    // 先按 code 查 Promotion Code,同时保留直接传 Coupon ID 的兼容性。
    let couponPart: { discounts: Array<{ promotion_code: string } | { coupon: string }> } | { allow_promotion_codes: true };
    if (body.coupon) {
      const promotions = await stripe.promotionCodes.list({ code: body.coupon, active: true, limit: 1 });
      if (promotions.data[0]) {
        couponPart = { discounts: [{ promotion_code: promotions.data[0].id }] };
      } else {
        try {
          const coupon = await stripe.coupons.retrieve(body.coupon);
          if (!coupon.valid) {
            return NextResponse.json({ error: "That promotion code is no longer valid." }, { status: 400 });
          }
          couponPart = { discounts: [{ coupon: coupon.id }] };
        } catch {
          return NextResponse.json({ error: "That promotion code could not be found." }, { status: 400 });
        }
      }
    } else {
      // 无预填码时保留 Stripe 付款页的手动输入能力。
      couponPart = { allow_promotion_codes: true as const };
    }

    const session = await stripe.checkout.sessions.create({
      mode: sub ? "subscription" : "payment",
      // AEOeye is an English-language product; keep Stripe's hosted checkout
      // aligned with the surrounding copy instead of inheriting the browser locale.
      locale: "en",
      line_items: [lineItem],
      // $10 SEO 报告只收卡:异步付款方式(银行转账等)会让 webhook 多出 async_payment_* 分支,
      // 一份 $10 报告不值得多一条对账路径。$29 报告沿用 Stripe 默认。
      ...(isSeoReport ? { payment_method_types: ["card" as const] } : {}),
      success_url: absoluteUrl(successPath) + (successPath.includes("?") ? "&" : "?") + "session_id={CHECKOUT_SESSION_ID}",
      cancel_url: absoluteUrl(cancelPath),
      customer_email: email,
      client_reference_id: userId,
      ...couponPart,
      metadata: { product, auditId: body.auditId ?? "", userId: userId ?? "" },
      ...(sub ? { subscription_data: { metadata: { userId: userId ?? "", product } } } : {}),
    });

    if (!sub && session.id) {
      await createPendingOrder({
        sessionId: session.id,
        email: email ?? "",
        product,
        // 订单账面金额按标价记;实收(优惠券后)以 Stripe 的 amount_total 为准
        amount: product === "report" ? 2900 : isSeoReport ? SEO_REPORT_PRICE_CENTS : 0,
        auditId: body.auditId,
        userId,
      });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("checkout error", e);
    await captureError({ name: "checkout", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/checkout", source: "server" });
    return NextResponse.json({ error: "Couldn’t start checkout. Please try again." }, { status: 500 });
  }
}
