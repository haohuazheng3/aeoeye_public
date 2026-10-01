import Stripe from "stripe";
import { env, features } from "./env";

export const stripe = features.stripe ? new Stripe(env.STRIPE_SECRET_KEY) : (null as unknown as Stripe);

/**
 * report      —— $29 一次性 AI 可见度完整报告(audits 表)
 * seo_report  —— $10 一次性完整 SEO 报告(seo_audits 表;orders.product 也存这个字面量)
 * pro_*       —— 已下线的订阅,只为历史订阅用户保留类型
 */
export type Product = "report" | "seo_report" | "pro_monthly" | "pro_yearly";

export function priceIdFor(product: Product): string | null {
  switch (product) {
    case "report":
      return env.STRIPE_PRICE_REPORT || null;
    case "seo_report":
      // 留空不是故障:checkout 会退回内联 price_data($10),不需要先去 Stripe 后台建 Price
      return env.STRIPE_PRICE_SEO_REPORT || null;
    case "pro_monthly":
      return env.STRIPE_PRICE_PRO_MONTHLY || null;
    case "pro_yearly":
      return env.STRIPE_PRICE_PRO_YEARLY || null;
    default:
      return null;
  }
}

export function isSubscription(product: Product): boolean {
  return product === "pro_monthly" || product === "pro_yearly";
}

export const PRODUCT_LABEL: Record<Product, string> = {
  report: "Full report",
  seo_report: "Full SEO report",
  pro_monthly: "Pro (monthly)",
  pro_yearly: "Pro (yearly)",
};
