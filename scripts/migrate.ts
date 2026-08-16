import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

/**
 * 执行 drizzle/ 下尚未应用的迁移 —— `npm run db:migrate`。
 *
 * 走 **unpooled** 直连:DDL 经过连接池时可能落在不同后端连接上,
 * 迁移中途换连接会留下半套表结构。
 *
 * 与 `drizzle-kit push` 的区别:push 是拿当前 schema 去"对齐"数据库,
 * 它会自己推断改动、也可能提出删列;migrate 只跑 drizzle/ 里已经生成、
 * 已经进版本库、人看过的那些 SQL。生产库只用后者。
 */

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !out[m[1]]) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
      }
    } catch {
      /* 文件不存在就跳过 —— CI 上变量来自环境 */
    }
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

const env = loadEnv();
const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 缺失 —— 无法迁移");
  process.exit(1);
}

// 包成函数再调:tsx 以 cjs 输出时不支持顶层 await(实测 TransformError)
async function main() {
  const db = drizzle(neon(url!));
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ 迁移已应用");
}

main().catch((e) => {
  console.error("迁移失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
