import { and, eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { orders, subscriptions, audits } from "@/lib/db/schema";
import { shortId } from "@/lib/utils";
import { stripe } from "@/lib/stripe";
import { features } from "@/lib/env";

export async function createPendingOrder(args: {
  sessionId: string;
  email: string;
  product: string;
  amount: number;
  auditId?: string;
  userId?: string;
}): Promise<string> {
  const id = shortId(11);
  await db.insert(orders).values({
    id,
    stripeSessionId: args.sessionId,
    email: args.email,
    product: args.product,
    amount: args.amount,
    auditId: args.auditId,
    userId: args.userId,
    status: "pending",
  });
  return id;
}

export async function markOrderPaid(
  sessionId: string,
  paymentIntent?: string,
  /** Stripe 结账时买家填的邮箱 —— 匿名购买时这是认领报告的唯一凭据,必须落库 */
  buyerEmail?: string
): Promise<{ auditId?: string } | null> {
  const rows = await db.select().from(orders).where(eq(orders.stripeSessionId, sessionId)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const email = normEmail(buyerEmail) || order.email || "";
  await db
    .update(orders)
    .set({ status: "paid", stripePaymentIntent: paymentIntent, paidAt: new Date(), email })
    .where(eq(orders.stripeSessionId, sessionId));
  if (order.auditId) {
    // 解锁报告。匿名购买没有 userId,只能记下买家邮箱 —— 之后用同一邮箱注册登录时
    // 由 claimAnonymousAudits 认领(此前这里只在有 userId 时绑定,匿名买家在
    // dashboard 里永远找不到自己刚买的报告)。
    const set: { unlocked: boolean; plan: string; userId?: string; email?: string } = {
      unlocked: true,
      plan: "full",
    };
    if (order.userId) set.userId = order.userId;
    if (email) set.email = email;
    await db.update(audits).set(set).where(eq(audits.id, order.auditId));
  }
  return { auditId: order.auditId ?? undefined };
}

function normEmail(e?: string | null): string {
  return (e || "").trim().toLowerCase();
}

/**
 * 认领匿名购买的报告:把"邮箱对得上、还没归属任何账号"的审计绑定到当前登录用户。
 *
 * 匿名结账时我们拿不到邮箱(用户是在 Stripe 页面里填的),所以对历史订单先做一次
 * 补录 —— 已付款但库里没邮箱的,回查 Stripe 取 customer_details.email。
 * 安全边界:邮箱来自 Clerk 已验证的登录态,且只认领 userId 为空的记录。
 */
export async function claimAnonymousAudits(userId: string, rawEmail: string): Promise<number> {
  const email = normEmail(rawEmail);
  if (!userId || !email) return 0;

  // 1) 补录历史订单缺失的买家邮箱(仅已付款、且确实缺邮箱的少量记录)
  if (features.stripe) {
    const orphans = await db
      .select()
      .from(orders)
      .where(and(eq(orders.status, "paid"), eq(orders.email, "")))
      .limit(20);
    for (const o of orphans) {
      if (!o.stripeSessionId) continue;
      try {
        const s = await stripe.checkout.sessions.retrieve(o.stripeSessionId);
        const found = normEmail(s.customer_details?.email || (s as { customer_email?: string }).customer_email);
        if (!found) continue;
        await db.update(orders).set({ email: found }).where(eq(orders.id, o.id));
        if (o.auditId) {
          await db.update(audits).set({ email: found }).where(eq(audits.id, o.auditId));
        }
      } catch {
        /* 单笔回查失败不影响其余认领 */
      }
    }
  }

  // 2) 认领:邮箱匹配 + 尚无归属
  const claimable = await db
    .select({ id: orders.auditId })
    .from(orders)
    .where(and(eq(orders.status, "paid"), eq(orders.email, email)));
  const ids = [...new Set(claimable.map((r) => r.id).filter((x): x is string => !!x))];
  let claimed = 0;
  for (const id of ids) {
    const res = await db
      .update(audits)
      .set({ userId })
      .where(and(eq(audits.id, id), isNull(audits.userId)))
      .returning({ id: audits.id });
    claimed += res.length;
  }
  return claimed;
}

export async function upsertSubscription(args: {
  userId: string;
  email: string;
  stripeCustomerId?: string;
  stripeSubscriptionId: string;
  status: string;
  priceId?: string;
  interval?: string;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}): Promise<void> {
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, args.stripeSubscriptionId))
    .limit(1);
  if (existing[0]) {
    await db
      .update(subscriptions)
      .set({
        status: args.status,
        priceId: args.priceId,
        interval: args.interval,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
        stripeCustomerId: args.stripeCustomerId ?? existing[0].stripeCustomerId,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, args.stripeSubscriptionId));
  } else {
    await db.insert(subscriptions).values({
      id: shortId(11),
      userId: args.userId,
      email: args.email,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      status: args.status,
      plan: "pro",
      priceId: args.priceId,
      interval: args.interval,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
    });
  }
}

export async function setSubscriptionStatus(stripeSubscriptionId: string, status: string): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status, updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

export async function activeSubscriptionFor(userId: string) {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return rows.find((s) => s.status === "active" || s.status === "trialing") ?? null;
}

/** 从 Stripe 订阅对象同步到本库(webhook 与返回确认共用) */
export async function syncSubscriptionFromStripe(sub: Stripe.Subscription): Promise<void> {
  const userId = (sub.metadata?.userId as string) || "";
  if (!userId) return;
  const item = sub.items.data[0];
  let email = "";
  try {
    const customer = await stripe.customers.retrieve(sub.customer as string);
    if (customer && !("deleted" in customer)) email = customer.email || "";
  } catch {
    /* ignore */
  }
  await upsertSubscription({
    userId,
    email,
    stripeCustomerId: sub.customer as string,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    priceId: item?.price?.id,
    interval: item?.price?.recurring?.interval,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

/**
 * 用户从 Stripe 返回时,直接向 Stripe 确认会话状态并立即解锁/同步,
 * 不依赖异步 webhook —— 消除"付款已成功但 webhook 还没到"的竞态。
 * 幂等:重复调用安全。
 */
export async function confirmCheckoutSession(
  sessionId: string
): Promise<{ paid: boolean; auditId?: string; amountCents?: number; currency?: string }> {
  if (!features.stripe || !sessionId.startsWith("cs_")) return { paid: false };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode === "payment" && session.payment_status === "paid") {
      const r = await markOrderPaid(
        sessionId,
        (session.payment_intent as string) || undefined,
        session.customer_details?.email || session.customer_email || undefined
      );
      // 金额取 Stripe 实收的 amount_total,**不要**用价目表上的 $29 —— 优惠券、
      // 促销码、货币换算都会让两者对不上,而分析里的营收数字一旦是猜的就没用了。
      return {
        paid: true,
        auditId: r?.auditId,
        amountCents: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
      };
    }
    if (session.mode === "subscription" && session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      await syncSubscriptionFromStripe(sub);
      return { paid: true };
    }
    return { paid: false };
  } catch {
    return { paid: false };
  }
}
