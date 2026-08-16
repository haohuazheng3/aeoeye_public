import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { errorEvents } from "@/lib/db/schema";
import { shortId } from "@/lib/utils";

type Level = "error" | "warn";
type Source = "server" | "client" | "edge";

/**
 * 全栈错误捕获入库(E26)。按"错误名 + 首帧 + 路由"指纹分组,重复则计数 +1。
 * 铁律:此函数**绝不抛错**——错误收件箱本身故障不能拖垮主流程。
 */
export async function captureError(input: {
  name?: string;
  message?: string;
  stack?: string;
  route?: string;
  level?: Level;
  source?: Source;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const name = (input.name || "Error").slice(0, 200);
    const message = (input.message || "").slice(0, 2000);
    const stack = (input.stack || "").split("\n").slice(0, 6).join("\n").slice(0, 4000);
    const route = (input.route || "").slice(0, 300);
    const firstFrame =
      stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at ")) || message.slice(0, 80);
    const fingerprint = createHash("sha256").update(`${name}|${firstFrame}|${route}`).digest("hex").slice(0, 32);

    await db
      .insert(errorEvents)
      .values({
        id: shortId(14),
        fingerprint,
        name,
        message,
        stack,
        route,
        level: input.level || "error",
        source: input.source || "server",
        sampleMeta: input.meta,
      })
      .onConflictDoUpdate({
        target: errorEvents.fingerprint,
        set: {
          count: sql`${errorEvents.count} + 1`,
          lastSeenAt: new Date(),
          message,
          stack,
          resolved: false,
          resolvedAt: null,
        },
      });
  } catch {
    /* 绝不抛错 */
  }
}
