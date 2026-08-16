import Stripe from "stripe";
import { env, features } from "./env";

export const stripe = features.stripe ? new Stripe(env.STRIPE_SECRET_KEY) : (null as unknown as Stripe);

export type Product = "report" | "pro_monthly" | "pro_yearly";

export function priceIdFor(product: Product): string | null {
  switch (product) {
    case "report":
      return env.STRIPE_PRICE_REPORT || null;
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
  pro_monthly: "Pro (monthly)",
  pro_yearly: "Pro (yearly)",
};
