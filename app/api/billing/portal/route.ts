import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { features } from "@/lib/env";
import { absoluteUrl } from "@/lib/site";

export const runtime = "nodejs";

export async function POST() {
  if (!features.stripe) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const session = await getSessionUser();
  const userId = session?.userId;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const sub = rows.find((s) => s.stripeCustomerId);
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found." }, { status: 404 });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: absoluteUrl("/dashboard"),
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("portal error", e);
    await captureError({ name: "billing-portal", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/billing/portal", source: "server" });
    return NextResponse.json({ error: "Couldn’t open billing portal." }, { status: 500 });
  }
}
