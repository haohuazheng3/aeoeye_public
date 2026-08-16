"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

/* ============================================================
   FlowGlance 业务事件

   snippet 在 layout 的 <head> 里,它注入全局 fw()。这里只负责在**正确的时刻**
   把业务语义喂给它:谁在用、谁付了钱、东西有没有真的交付。

   三条纪律:
   1. 全部包在 try 里 —— 分析永远不能弄坏页面本身;
   2. 一次性事件用 sessionStorage/localStorage 去重 —— 用户刷新一次就多一笔
      营收的分析工具还不如没有;
   3. purchase 与 unlock **分开发**。前者是"付了钱",后者是"东西到手了"。
      FlowGlance 的 revenue 端点正是拿这两者比对来做交付核验 —— 合成一个,
      就再也发现不了"付款成功但报告没生成"那类事故(2026-08-10 真发生过)。
   ============================================================ */

type FwFn = (action: string, a?: unknown, b?: unknown) => void;

function fw(action: string, a?: unknown, b?: unknown): void {
  try {
    const f = (window as unknown as { fw?: FwFn }).fw;
    if (typeof f === "function") f(action, a, b);
  } catch {
    /* 分析失败静默 —— 绝不影响页面 */
  }
}

/** 只发一次(按 key 记忆)。scope=local 跨会话去重,session 仅本次会话。 */
function once(key: string, scope: "local" | "session", fn: () => void): void {
  try {
    const store = scope === "local" ? localStorage : sessionStorage;
    if (store.getItem(key)) return;
    store.setItem(key, "1");
  } catch {
    /* 隐私模式下存不了 —— 那就照发,重复一次好过永远不发 */
  }
  fn();
}

/**
 * 登录后告诉 FlowGlance 这台设备背后是谁。
 * 挂在 layout,全站生效;未登录时什么都不做。
 */
export function FlowGlanceIdentity() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    const email = user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress;
    // 每个会话认一次就够:重复 identify 不会错,但没必要每次路由变化都打
    once(`fw_id_${user.id}`, "session", () => fw("identify", { userRef: user.id, email }));
  }, [isLoaded, isSignedIn, user]);

  return null;
}

/**
 * 从 Stripe 回跳的那一次 —— 记一笔真实营收。
 * 金额来自 Stripe 的 amount_total(实收),不是价目表上的标价。
 * 按 checkout session 去重,用 localStorage:用户过几天再打开同一条链接,
 * 不该再记一笔钱。
 */
export function FlowGlancePurchase({
  auditId,
  amountCents,
  currency,
  sessionId,
}: {
  auditId: string;
  amountCents?: number;
  currency?: string;
  sessionId: string;
}) {
  useEffect(() => {
    once(`fw_purchase_${sessionId}`, "local", () =>
      fw("event", "purchase", {
        // FlowGlance 的 money 字段按整数分处理(spec: "Money is integer cents")
        amount: amountCents,
        currency: (currency || "usd").toLowerCase(),
        item: "full-report",
        id: auditId,
      })
    );
  }, [auditId, amountCents, currency, sessionId]);

  return null;
}

/**
 * 付费内容**真的到手了** —— 完整报告已经生成完毕并渲染在页面上。
 *
 * 与 purchase 分开的意义:付款成功不等于交付成功。这个站就出过
 * "付了 $29、升级一次都没执行"的事故 —— 那时 purchase 会有、unlock 不会有,
 * 两个数字一对就露馅。所以判据必须是"内容到齐"(plan === full),
 * 不能是"页面解锁了"。
 */
export function FlowGlanceUnlock({ auditId, delivered }: { auditId: string; delivered: boolean }) {
  useEffect(() => {
    if (!delivered) return;
    once(`fw_unlock_${auditId}`, "local", () => fw("event", "unlock", { id: auditId, item: "full-report" }));
  }, [auditId, delivered]);

  return null;
}

/** 业务事件的通用出口 —— 供表单等交互处直接调用 */
export function fwEvent(name: string, props?: Record<string, unknown>): void {
  fw("event", name, props);
}
