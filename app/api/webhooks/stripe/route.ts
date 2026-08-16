import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { markOrderPaid, setSubscriptionStatus, syncSubscriptionFromStripe } from "@/lib/orders";
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
      case "checkout.session.completed": {
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

