import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Neon HTTP 驱动(无状态,适配 Serverless/Edge 友好的请求生命周期)
// 关键:禁用 fetch 缓存。否则 Next.js/Vercel 的 Data Cache 会缓存数据库读取,
// 导致"付款写入 unlocked=true 后,报告页仍读到旧快照(未解锁)"这类陈旧读取问题。
const sql = neon(env.DATABASE_URL, { fetchOptions: { cache: "no-store" } });

export const db = drizzle(sql, { schema });
export { schema };
