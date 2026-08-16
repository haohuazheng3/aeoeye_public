import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { audits } from "@/lib/db/schema";
import type { Audit } from "@/lib/db/schema";
import { shortId, domainOf, looksLikeUrl, normalizeUrl } from "@/lib/utils";
import { runAudit, expandToAllEngines, AuditError, type RunOptions } from "./run";
import type { AuditResult } from "./types";

export async function createAudit(args: {
  input: string;
  source?: string;
  userId?: string;
  email?: string;
}): Promise<string> {
  const id = shortId(11);
  const url = looksLikeUrl(args.input) ? normalizeUrl(args.input) : null;
  await db.insert(audits).values({
    id,
    input: args.input,
    brand: args.input,
    url,
    domain: domainOf(args.input),
    status: "pending",
    source: args.source,
    userId: args.userId,
    email: args.email,
  });
  return id;
}

/**
 * 通过公开 API 生成的报告 —— 一步落库成"已完成 + 已解锁的完整报告"。
 *
 * 与站点路径不同:那边先建 pending 行再跑,是为了让前端有个可轮询的 id;
 * API 是同步跑完才返回,没有中间态可给,建行时结果就已经在手上了。
 * unlocked 直接置 true —— 它本来就是完整报告,没有再"解锁"一次的说法;
 * 留 false 会让报告页给自己的 owner 显示付费墙。
 */
export async function saveApiReport(args: {
  input: string;
  result: AuditResult;
  userId?: string;
}): Promise<string> {
  const id = shortId(11);
  await db.insert(audits).values({
    id,
    input: args.input,
    brand: args.result.brand,
    url: args.result.url,
    domain: args.result.domain,
    category: args.result.category,
    status: "complete",
    source: "api",
    userId: args.userId,
    score: args.result.overallScore,
    grade: args.result.grade,
    result: args.result,
    unlocked: true,
    plan: "full",
    completedAt: new Date(),
  });
  return id;
}

export async function getAudit(id: string): Promise<Audit | null> {
  const rows = await db.select().from(audits).where(eq(audits.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function saveAuditResult(id: string, result: AuditResult): Promise<void> {
  await db
    .update(audits)
    .set({
      status: "complete",
      brand: result.brand,
      url: result.url,
      domain: result.domain,
      category: result.category,
      score: result.overallScore,
      grade: result.grade,
      result,
      completedAt: new Date(),
    })
    .where(eq(audits.id, id));
}

export async function failAudit(id: string, message: string): Promise<void> {
  await db.update(audits).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(audits.id, id));
}

/**
 * 同域名上一次完成审计的品类 —— 作为本次出题的锚。
 * 不锚定时两轮审计会各自措辞品类,题目整批漂移,同一品牌两次分数没有可比性
 * (实测 realworldappeal.com:24F ↔ 41D,差的只是出题)。
 */
async function lastCategoryFor(domain: string, excludeId?: string): Promise<string | undefined> {
  try {
    const rows = await db
      .select({ id: audits.id, category: audits.category })
      .from(audits)
      .where(and(eq(audits.domain, domain), eq(audits.status, "complete"), isNotNull(audits.category)))
      .orderBy(desc(audits.completedAt))
      .limit(2);
    const hit = rows.find((r) => r.id !== excludeId && r.category);
    return hit?.category ?? undefined;
  } catch {
    return undefined; // 查不到就不锚,照常出题
  }
}

/** 创建并同步运行一次审计,落库后返回 id 与结果 */
export async function runAndStore(
  input: string,
  opts: RunOptions & { source?: string; userId?: string; email?: string } = {}
): Promise<{ id: string; result: AuditResult }> {
  const id = await createAudit({ input, source: opts.source, userId: opts.userId, email: opts.email });
  await db.update(audits).set({ status: "running" }).where(eq(audits.id, id));
  try {
    const categoryHint = await lastCategoryFor(domainOf(input), id);
    const result = await runAudit(input, { plan: opts.plan, source: opts.source, categoryHint });
    await saveAuditResult(id, result);
    return { id, result };
  } catch (e) {
    const msg = e instanceof AuditError ? e.message : "Something went wrong while running the audit.";
    await failAudit(id, msg);
    throw e;
  }
}

/**
 * 付费解锁后,把已有报告升级为完整版:以 full 真正跑一次(激活 DataForSEO 多引擎)。
 * 故意不把 status 改成 "running" —— 重生成期间报告页仍展示已有内容 + "生成中"提示,
 * 不会闪回"运行中"空屏。完成后用新结果覆盖,并确保 unlocked/plan 正确。
 */
export async function upgradeToFull(id: string): Promise<void> {
  const row = await getAudit(id);
  if (!row) throw new AuditError("Audit not found.", "invalid");
  // 有免费轮结果就在其上扩展(沿用同一批问题,用户读过的内容不变样);
  // 只有异常缺结果的老记录才整跑一次。
  const prev = row.result as AuditResult | null;
  const result =
    prev && prev.questions?.length && prev.matrix?.length
      ? await expandToAllEngines(prev)
      : await runAudit(row.input, {
          plan: "full",
          source: row.source ?? undefined,
          categoryHint: row.category ?? undefined,
        });
  await saveAuditResult(id, result);
  await db.update(audits).set({ unlocked: true, plan: "full" }).where(eq(audits.id, id));
}

/** 对已存在的审计重新运行(用于完整报告升级) */
export async function rerun(id: string, plan: "free" | "full"): Promise<AuditResult> {
  const row = await getAudit(id);
  if (!row) throw new AuditError("Audit not found.", "invalid");
  await db.update(audits).set({ status: "running" }).where(eq(audits.id, id));
  const categoryHint = row.category ?? (await lastCategoryFor(row.domain ?? domainOf(row.input), id));
  const result = await runAudit(row.input, { plan, categoryHint });
  await saveAuditResult(id, result);
  if (plan === "full") {
    await db.update(audits).set({ unlocked: true, plan: "full" }).where(eq(audits.id, id));
  }
  return result;
}
