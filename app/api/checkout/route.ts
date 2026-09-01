import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { stripe, priceIdFor, isSubscription, type Product } from "@/lib/stripe";
import { createPendingOrder } from "@/lib/orders";
import { features } from "@/lib/env";
import { absoluteUrl } from "@/lib/site";

export const runtime = "nodejs";

const Body = z.object({
  product: z.enum(["report", "pro_monthly", "pro_yearly"]),
  auditId: z.string().max(40).optional(),
  // 测试用优惠券(如 freezhen);仅接受安全字符
  coupon: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(40).optional(),
});

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

  // Pro 订阅已下线 —— 站点只卖 $29 一次性完整报告。前端入口已移除,这里同样拒绝,
  // 否则直接打 API 仍能开出新订阅(既有订阅不受影响,由 Stripe 侧单独处理)。
  if (isSubscription(product)) {
    return NextResponse.json(
      { error: "Subscriptions are no longer offered — the full report is a one-time $29 purchase." },
      { status: 410 }
    );
  }

  const priceId = priceIdFor(product);
  if (!priceId) return NextResponse.json({ error: "This plan isn’t available yet." }, { status: 503 });

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

  const successPath = sub
    ? "/dashboard?welcome=1"
    : body.auditId
      ? `/audit/${body.auditId}?unlocked=1`
      : "/dashboard";
  const cancelPath = body.auditId ? `/audit/${body.auditId}` : "/pricing";

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
      line_items: [{ price: priceId, quantity: 1 }],
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
        amount: product === "report" ? 2900 : 0,
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
