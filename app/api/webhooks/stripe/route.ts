import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { markOrderPaid, revokeOrderByPaymentIntent, restoreOrderByPaymentIntent, setSubscriptionStatus, syncSubscriptionFromStripe } from "@/lib/orders";
import { env, features } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!features.stripe || !features.stripeWebhook) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return NextResponse.json({ error: `invalid signature: ${e instanceof Error ? e.message : ""}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      // 延迟结算的付款方式(银行转账等)在 completed 时 payment_status 还是 unpaid,
      // 钱到账后 Stripe 再发这一条 —— 少了它就是"付了钱、永远没解锁"。
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment" && session.payment_status === "paid") {
          // 带上买家在 Stripe 填的邮箱 —— 匿名购买靠它认领报告
          await markOrderPaid(
            session.id,
            (session.payment_intent as string) || undefined,
            session.customer_details?.email || session.customer_email || undefined
          );
        }
        break;
      }
      // 退款 / 拒付 → 撤销解锁(只撤 unlocked,数据与 plan 保留,便于争议胜诉后恢复)。
      // 撤销之后 markOrderPaid 拒绝把这笔订单翻回 paid —— 回跳 URL 回放、completed 重投都恢复不了(复审 C1)
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (pi && charge.refunded) {
          const r = await revokeOrderByPaymentIntent(pi, "refunded");
          if (r) await captureError({ name: "order-refunded", message: `order ${r.orderId} (${r.product}) refunded; seo audit unlock revoked=${r.revokedSeoAudit}`, route: "/api/webhooks/stripe", source: "server", level: "warn", meta: { ...r, paymentIntent: pi } });
        }
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const pi = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
        if (pi) {
          const r = await revokeOrderByPaymentIntent(pi, "disputed");
          await captureError({
            name: "order-disputed",
            message: r ? `order ${r.orderId} (${r.product}) disputed (${dispute.reason}); seo audit unlock revoked=${r.revokedSeoAudit}` : `dispute on unknown payment intent ${pi} (${dispute.reason})`,
            route: "/api/webhooks/stripe",
            source: "server",
            level: "error",
            meta: { ...(r ?? {}), paymentIntent: pi, reason: dispute.reason, amount: dispute.amount },
          });
        }
        break;
      }
      // 争议结束:won(争议胜诉)/ warning_closed(询问期结束、没有升级成拒付,钱从没被扣走)→ 显式恢复;
      // lost 保持撤销。恢复只走这一条显式路径,不再依赖 session_id 回放(那条路已经堵上了)
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        const pi = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
        if (pi) {
          const won = dispute.status === "won" || dispute.status === "warning_closed";
          const r = won ? await restoreOrderByPaymentIntent(pi) : null;
          await captureError({
            name: won ? "order-dispute-won" : "order-dispute-closed",
            message: won
              ? r
                ? `order ${r.orderId} (${r.product}) dispute closed as ${dispute.status}; order restored=${r.restoredOrder}, seo audit unlock restored=${r.restoredSeoAudit}`
                : `dispute on unknown payment intent ${pi} closed as ${dispute.status}`
              : `dispute on ${pi} closed as ${dispute.status}; access stays revoked`,
            route: "/api/webhooks/stripe",
            source: "server",
            level: "warn",
            meta: { ...(r ?? {}), paymentIntent: pi, status: dispute.status, reason: dispute.reason, amount: dispute.amount },
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscriptionFromStripe(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await setSubscriptionStatus(sub.id, "canceled");
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("webhook handler error", event.type, e);
    await captureError({ name: "stripe-webhook", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/webhooks/stripe", source: "server" });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

