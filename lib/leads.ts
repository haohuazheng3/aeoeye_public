import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { shortId } from "@/lib/utils";

export async function saveLead(args: {
  email: string;
  type: "unlock" | "contact" | "newsletter" | "waitlist" | "monitor";
  auditId?: string;
  brand?: string;
  name?: string;
  message?: string;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const id = shortId(11);
  await db.insert(leads).values({
    id,
    email: args.email.toLowerCase().trim(),
    type: args.type,
    auditId: args.auditId,
    brand: args.brand,
    name: args.name,
    message: args.message,
    meta: args.meta,
  });
  return id;
}
