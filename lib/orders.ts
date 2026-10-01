import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { orders, subscriptions, audits, seoAudits } from "@/lib/db/schema";
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

/**
 * 订单状态:pending → paid → refunded | disputed。
 * refunded / disputed 是"权益已撤销"的终态:之后任何一次 markOrderPaid(回跳页带着旧 session_id
 * 重开、Stripe 重投 checkout.session.completed)都不能把它翻回 paid —— Checkout Session 的
 * payment_status 在退款 / 拒付之后仍是 "paid",不挡这一步,撤销就形同虚设(复审 C1/C15/C30/C37)。
 * 争议胜诉后的恢复只走显式的 restoreOrderByPaymentIntent(webhook charge.dispute.closed)。
 */
export const REVOKED_ORDER_STATUSES = ["refunded", "disputed"] as const;

export async function markOrderPaid(
  sessionId: string,
  paymentIntent?: string,
  /** Stripe 结账时买家填的邮箱 —— 匿名购买时这是认领报告的唯一凭据,必须落库 */
  buyerEmail?: string
): Promise<{ auditId?: string; revoked?: boolean } | null> {
  const rows = await db.select().from(orders).where(eq(orders.stripeSessionId, sessionId)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const email = normEmail(buyerEmail) || order.email || "";
  // 一条条件更新,以它的结果为准(不是"先读 status 再写"——读和写之间可能插进一次撤销)。
  // pending 与 paid 都照常(幂等)走下去:neon-http 没有事务,第一次调用可能写完订单、没写完解锁就挂了,
  // webhook 与回跳确认的"重放"正是靠这里幂等才能自愈;只有撤销态被拒。
  // paidAt 用 coalesce:回放不能覆盖首次付款时间。
  const moved = await db
    .update(orders)
    .set({ status: "paid", stripePaymentIntent: paymentIntent, paidAt: sql`coalesce(${orders.paidAt}, now())`, email })
    .where(and(eq(orders.stripeSessionId, sessionId), notInArray(orders.status, [...REVOKED_ORDER_STATUSES])))
    .returning({ id: orders.id });
  if (!moved.length) {
    // 已退款 / 拒付:不改订单、不解锁任何东西
    return { auditId: order.auditId ?? undefined, revoked: true };
  }
  if (order.auditId && order.product === "seo_report") {
    // $10 完整 SEO 报告:只解锁,**不改 plan** —— plan 要等升级真把 40 页抓取 + DataForSEO 三模块
    // 跑完才置 "full",报告页据此决定渲染进度页还是完整报告。
    // 也绝不碰 audits 表:两个产品各自一张表,id 空间互不相干,更新错表就是静默无效。
    // unlockedAt 用 coalesce:webhook 与回跳确认会各调一次,首次付款时间不该被后到的那次覆盖。
    // WHERE 里再查一次订单此刻仍是 paid:挡住"上面那条更新之后、这条解锁之前"插进来的撤销。
    // 归属跟着付款人走(复审 C16/C25):匿名付款(order 没有 userId)且是**首次**解锁(unlocked_at 为空)时,
    // 把行归为匿名购买(user_id = null)—— 否则创建者 A 的行被别人(或 A 自己没登录时)匿名买下后,
    // 只有 A 登录才能重跑;买家之后用 Stripe 邮箱登录时由 claimAnonymousAudits 认领。
    // 只在首次解锁时清空:webhook 重投 / 回跳回放不能把已经认领的归属再抹掉
    // (SET 里引用的 unlocked_at 是更新前的值)。
    await db
      .update(seoAudits)
      .set({
        unlocked: true,
        unlockedAt: sql`coalesce(${seoAudits.unlockedAt}, now())`,
        userId: order.userId ? order.userId : sql`case when ${seoAudits.unlockedAt} is null then null else ${seoAudits.userId} end`,
        ...(email ? { email } : {}),
      })
      .where(
        and(
          eq(seoAudits.id, order.auditId),
          sql`exists (select 1 from orders o where o.stripe_session_id = ${sessionId} and o.status = 'paid')`
        )
      );
  } else if (order.auditId) {
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
 * 退款 / 拒付 → 撤销权益。按 stripe_payment_intent 找订单(charge.refunded 与
 * charge.dispute.* 事件里都只有 payment_intent,没有 session id)。
 * 退款 → orders.status='refunded'(终态);拒付 → 'disputed'(争议胜诉后可由 restoreOrderByPaymentIntent 恢复;
 * 已经退款的订单再被拒付仍记 refunded —— 退了的钱不能因为"争议胜诉"又被恢复成已付款)。
 * $10 SEO 报告的 seo_audits.unlocked=false —— **只撤销解锁,数据与 plan 不动**:争议胜诉后要能恢复,
 * 而且历史上"跑过完整版"这个事实(cost_cents)不该被抹掉;免费视图会把撤销态还原成免费形状。
 * 幂等:重复事件安全。找不到订单返回 null(不是本站的 PI,或订单在 webhook 之前就被删了)。
 */
export async function revokeOrderByPaymentIntent(
  paymentIntentId: string,
  reason: "refunded" | "disputed" | string
): Promise<{ orderId: string; product: string; auditId: string | null; revokedSeoAudit: boolean } | null> {
  if (!paymentIntentId) return null;
  const rows = await db.select().from(orders).where(eq(orders.stripePaymentIntent, paymentIntentId)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const status =
    reason === "disputed" ? sql`case when ${orders.status} = 'refunded' then 'refunded' else 'disputed' end` : "refunded";
  await db.update(orders).set({ status }).where(eq(orders.id, order.id));
  let revokedSeoAudit = false;
  if (order.product === "seo_report" && order.auditId) {
    const res = await db
      .update(seoAudits)
      .set({ unlocked: false })
      .where(and(eq(seoAudits.id, order.auditId), eq(seoAudits.unlocked, true)))
      .returning({ id: seoAudits.id });
    revokedSeoAudit = res.length > 0;
  }
  console.warn(`order ${order.id} (${order.product}) revoked: ${reason}`);
  return { orderId: order.id, product: order.product, auditId: order.auditId ?? null, revokedSeoAudit };
}

/**
 * 争议胜诉 / 询问期结束(charge.dispute.closed: won | warning_closed)→ 显式恢复权益:
 * 只把 'disputed' 的订单翻回 'paid'(退款是终态,绝不恢复),再把 $10 SEO 报告重新解锁。
 * 解锁语句同样以"订单此刻是 paid"为条件,与 markOrderPaid 同一条纪律。幂等。
 */
export async function restoreOrderByPaymentIntent(
  paymentIntentId: string
): Promise<{ orderId: string; product: string; auditId: string | null; restoredOrder: boolean; restoredSeoAudit: boolean } | null> {
  if (!paymentIntentId) return null;
  const rows = await db.select().from(orders).where(eq(orders.stripePaymentIntent, paymentIntentId)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const moved = await db
    .update(orders)
    .set({ status: "paid", paidAt: sql`coalesce(${orders.paidAt}, now())` })
    .where(and(eq(orders.id, order.id), eq(orders.status, "disputed")))
    .returning({ id: orders.id });
  let restoredSeoAudit = false;
  if (order.product === "seo_report" && order.auditId) {
    const res = await db
      .update(seoAudits)
      .set({ unlocked: true, unlockedAt: sql`coalesce(${seoAudits.unlockedAt}, now())` })
      .where(
        and(
          eq(seoAudits.id, order.auditId),
          eq(seoAudits.unlocked, false),
          sql`exists (select 1 from orders o where o.id = ${order.id} and o.status = 'paid')`
        )
      )
      .returning({ id: seoAudits.id });
    restoredSeoAudit = res.length > 0;
  }
  console.warn(`order ${order.id} (${order.product}) restored after dispute: order=${moved.length > 0} seo=${restoredSeoAudit}`);
  return { orderId: order.id, product: order.product, auditId: order.auditId ?? null, restoredOrder: moved.length > 0, restoredSeoAudit };
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
        if (o.auditId && o.product === "seo_report") {
          await db.update(seoAudits).set({ email: found }).where(eq(seoAudits.id, o.auditId));
        } else if (o.auditId) {
          await db.update(audits).set({ email: found }).where(eq(audits.id, o.auditId));
        }
      } catch {
        /* 单笔回查失败不影响其余认领 */
      }
    }
  }

  // 2) 认领:邮箱匹配 + 尚无归属。按 product 分表 —— $10 SEO 报告在 seo_audits,
  //    $29 报告在 audits;同一个 id 字面量在两张表里指的是不同东西,不能混着 update。
  const claimable = await db
    .select({ id: orders.auditId, product: orders.product })
    .from(orders)
    .where(and(eq(orders.status, "paid"), eq(orders.email, email)));
  const seen = new Set<string>();
  let claimed = 0;
  for (const { id, product } of claimable) {
    if (!id) continue;
    const key = `${product}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (product === "seo_report") {
      const res = await db
        .update(seoAudits)
        .set({ userId })
        .where(and(eq(seoAudits.id, id), isNull(seoAudits.userId)))
        .returning({ id: seoAudits.id });
      claimed += res.length;
    } else {
      const res = await db
        .update(audits)
        .set({ userId })
        .where(and(eq(audits.id, id), isNull(audits.userId)))
        .returning({ id: audits.id });
      claimed += res.length;
    }
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
      // 已退款 / 拒付的订单:Stripe 的 session 仍写着 paid,但对我们来说这笔钱已经不算数 ——
      // 不解锁,也不再让页面重发一次 purchase 事件
      if (r?.revoked) return { paid: false, auditId: r.auditId };
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
