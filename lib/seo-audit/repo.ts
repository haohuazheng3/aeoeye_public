import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { seoAudits, type SeoAudit } from "@/lib/db/schema";
import { shortId } from "@/lib/utils";
import { captureError } from "@/lib/errors";
import { normalizeInput, SeoAuditError } from "./url";
import { runSeoAudit, upgradeSeoAudit, rerunSeoAudit, missingPaidModules, RUN_DEADLINE_MS, type UpgradeModule } from "./run";
import { consumePsiQuota } from "./quota";
import type { PaidModuleId, SeoAuditProgress, SeoAuditResult, SeoAuditRow, SeoPlan } from "./types";

/* ============================================================
   seo_audits 表的读写 —— 与 lib/engine/repo.ts 同构,但两张表绝不交叉。

   状态机:pending → running → complete | failed。
   付费升级**不**把 status 改回 running:重生成期间报告页仍要能展示已有内容 +
   进度页,不能闪回"运行中"空屏(与 $29 报告的 upgradeToFull 同一教训)。

   v2(hardening):
   - 运行改为异步:路由只建行(startSeoAudit),真正的运行由 runSeoAuditInBackground 在
     waitUntil 里继续;进度逐帧写进 progress 列,报告页每 3s 轮询。
   - 免费层缓存:同入口 URL 6h 内已完成的免费报告 → **新建本人一行并复制 payload**
     (cached_from **列**记来源 id,只供内部查询;result.meta.cachedFrom 只存来源的完成时间),
     绝不把别人的 id 发出去 —— 报告凭 id 公开,来源 id 就是别人的报告钥匙(复审 C2)。
   - 付费升级:DB CAS(claimUpgrade)决定谁跑;每个模块一落地就 mergeModule 落库,重试只补缺。
   - 付费重跑:解锁后 30 天内重跑免费模块(总次数不限,频率由 quota.ts 的 rerun 桶限),
     DataForSEO 最多刷新 / 补缺 2 次(paid_refresh_count)。
   - unlocked 只由付款(lib/orders.ts)置 true / 撤销;这里任何一条写入都不碰它(复审 C1:
     升级跑完时顺手写 unlocked=true,会把运行期间到达的退款撤销覆盖掉)。
   ============================================================ */

/** 同入口 URL 6 小时内的免费报告复制给新请求者 —— 省 PSI 配额与等待时间,也是防滥用的一道闸 */
export const SEO_AUDIT_REUSE_MS = 6 * 60 * 60 * 1000;
/** 解锁后可重跑的窗口 */
export const SEO_RERUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** DataForSEO 模块最多刷新次数(每次都是真钱) */
export const SEO_PAID_REFRESH_MAX = 2;
/** 超过这个时长还在 running 的升级 / 运行视为卡死(运行本身有 250s deadline) */
export const SEO_STALE_RUN_MS = 6 * 60 * 1000;

function toRow(r: SeoAudit): SeoAuditRow {
  return {
    id: r.id,
    input: r.input,
    url: r.url,
    domain: r.domain,
    status: r.status as SeoAuditRow["status"],
    plan: r.plan as SeoPlan,
    score: r.score,
    grade: r.grade,
    result: r.result ?? null,
    error: r.error,
    email: r.email,
    unlocked: r.unlocked,
    userId: r.userId,
    source: r.source,
    ipHash: r.ipHash,
    costCents: r.costCents,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    unlockedAt: r.unlockedAt,
    progress: r.progress ?? null,
    cachedFrom: r.cachedFrom ?? null,
    upgradeState: r.upgradeState ?? null,
    upgradeStartedAt: r.upgradeStartedAt ?? null,
    rerunCount: r.rerunCount ?? 0,
    paidRefreshCount: r.paidRefreshCount ?? 0,
  };
}

/** DataForSEO 实测美元 → 整数分。单次通常 $0.06–0.10,四舍五入到分不会归零 */
function usdToCents(usd: number): number {
  return Math.max(0, Math.round((usd || 0) * 100));
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------
   落库清洗:Postgres 的 jsonb / text 拒收两类字符 —— \u0000,以及孤立的 UTF-16 代理项。
   后者在"按固定长度截断页面文本"时很容易出现:截在 emoji 中间,留下半个代理对。
   一旦出现,整份结果 UPDATE 报错、整次审计失败(引擎组 2026-10-01 在 Neon 上实测确认)。
   被审计页面的文本完全不受我们控制,所以在落库口统一清洗,键和值都洗(og/twitter 的键也来自页面)。
   注意:先截断、再清洗 —— 反过来清洗完再 slice 仍可能劈开一个代理对。
   ------------------------------------------------------------ */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanText(s: string): string {
  return s.replace(/\u0000/g, "").replace(LONE_SURROGATE, "\uFFFD");
}

export function jsonbSafe<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map((v) => jsonbSafe(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[cleanText(k)] = jsonbSafe(v);
    return out as T;
  }
  return value;
}

function queuedProgress(startedAt: string = nowIso()): SeoAuditProgress {
  return { stage: "queued", percent: 0, pagesCrawled: 0, startedAt, updatedAt: startedAt };
}

/**
 * 终态帧(SQL):startedAt 从行上已有的帧里沿用(报告页据此显示"用时 N 秒"),
 * 只把 stage/percent/updatedAt(/message/pagesCrawled)换掉。
 */
function doneProgressSql(extra: { pagesCrawled?: number; message?: string }) {
  const t = nowIso();
  const frame: Record<string, unknown> = jsonbSafe({ stage: "done", percent: 100, updatedAt: t, ...extra });
  return sql`jsonb_build_object('startedAt', coalesce(${seoAudits.progress}->>'startedAt', ${t}::text)) || ${JSON.stringify(frame)}::jsonb`;
}

/** 面向用户的失败原因:引擎给出的准确说法原样透出,未知错误用一句不吓人的话 */
function failureMessage(e: unknown): string {
  if (e instanceof SeoAuditError) return e.message || "We couldn't audit this site.";
  return "Something went wrong while running the SEO audit. Please try again.";
}

/**
 * 进度写入器:同一阶段 1.5s 内只落一次(抓取每页都会回调),阶段切换与 done 立刻落;
 * 写入串行排队,避免后发先至把 "crawling 12 pages" 盖在 "scoring" 上。永不抛。
 */
function progressWriter(id: string) {
  let last = 0;
  let lastStage: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  const push = (p: SeoAuditProgress) => {
    const now = Date.now();
    const stageChanged = p.stage !== lastStage;
    if (!stageChanged && p.stage !== "done" && now - last < 1500) return;
    last = now;
    lastStage = p.stage;
    queue = queue.then(() => setProgress(id, p)).catch(() => {});
  };
  const flush = () => queue;
  return { push, flush };
}

/* ============================================================
   基本读写
   ============================================================ */

export async function createSeoAudit(args: {
  input: string;
  url: string;
  domain: string;
  source?: string;
  userId?: string;
  email?: string;
  ipHash?: string;
  progress?: SeoAuditProgress;
}): Promise<string> {
  const id = shortId(11);
  await db.insert(seoAudits).values({
    id,
    input: args.input,
    url: args.url,
    domain: args.domain,
    status: "pending",
    plan: "free",
    source: args.source,
    userId: args.userId,
    email: args.email,
    ipHash: args.ipHash,
    progress: args.progress ?? queuedProgress(),
    upgradeState: "idle",
  });
  return id;
}

export async function getSeoAudit(id: string): Promise<SeoAuditRow | null> {
  if (!id) return null;
  const rows = await db.select().from(seoAudits).where(eq(seoAudits.id, id)).limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * 写入一次运行的结果。costCents 是**本次运行**的花费,累加到行上(而不是覆盖):
 * 免费轮是 0,付费升级再加一笔,行上的数字始终是这份报告的总花费。
 * 成功即清空 error(上一次重跑失败留下的提示不该挂在新报告上)。
 * outcome=blocked 的结果不出分(V2-0):行上的 score/grade 写 null —— 标签页标题、dashboard、
 * 缓存副本都读这两列,写进一个"探针类检查算出来的分数"就是在对外报一个虚构的分(复审 C35)。
 */
export async function saveSeoAuditResult(id: string, result: SeoAuditResult, costCents: number): Promise<void> {
  const blocked = result.meta?.outcome === "blocked";
  await db
    .update(seoAudits)
    .set({
      status: "complete",
      plan: result.plan,
      url: result.entryUrl,
      domain: result.domain,
      score: blocked ? null : result.overall.score,
      grade: blocked ? null : result.overall.grade,
      result: jsonbSafe(result),
      error: null,
      costCents: sql`${seoAudits.costCents} + ${Math.max(0, Math.round(costCents))}`,
      completedAt: new Date(),
      progress: doneProgressSql({ pagesCrawled: result.meta.pagesCrawled }),
    })
    .where(eq(seoAudits.id, id));
}

export async function failSeoAudit(id: string, message: string): Promise<void> {
  await db
    .update(seoAudits)
    .set({ status: "failed", error: cleanText(message.slice(0, 500)), completedAt: new Date(), progress: doneProgressSql({ message: message.slice(0, 200) }) })
    .where(eq(seoAudits.id, id));
}

/** 落一帧进度;pending 的行顺手变 running(第一帧到达 = 运行真的开始了) */
export async function setProgress(id: string, progress: SeoAuditProgress): Promise<void> {
  await db
    .update(seoAudits)
    .set({
      progress: jsonbSafe(progress),
      status: sql`case when ${seoAudits.status} = 'pending' then 'running' else ${seoAudits.status} end`,
    })
    .where(eq(seoAudits.id, id));
}

/**
 * 同入口 URL(或同域名)近期已完成的免费报告 —— 只认 plan=free、未解锁、且本身不是缓存副本的行:
 * 已付款的报告属于买家,不能作为公共缓存发给下一个输入同一域名的陌生人;
 * 副本的 6h 要从原始运行算,所以只找 cached_from 为空的原件。
 */
export async function findRecentFreeSeoAudit(domain: string, withinMs: number, entryUrl?: string): Promise<SeoAuditRow | null> {
  const since = new Date(Date.now() - withinMs);
  const rows = await db
    .select()
    .from(seoAudits)
    .where(
      and(
        eq(seoAudits.domain, domain),
        ...(entryUrl ? [eq(seoAudits.url, entryUrl)] : []),
        eq(seoAudits.status, "complete"),
        eq(seoAudits.plan, "free"),
        eq(seoAudits.unlocked, false),
        isNull(seoAudits.cachedFrom),
        gte(seoAudits.createdAt, since)
      )
    )
    .orderBy(desc(seoAudits.createdAt))
    .limit(1);
  return rows[0] && rows[0].result ? toRow(rows[0]) : null;
}

/**
 * 免费层缓存:给**这个请求者**新建一行,复制来源的 result/score/grade,status 直接 complete。
 * 永远不把来源行的 id 发出去 —— 那是别人的报告链接:来源 id 只进 cached_from 列(内部查询用),
 * result.meta.cachedFrom 存来源的完成时间(UI 只做真值判断,"Audited N h ago")。
 */
export async function createCachedCopy(
  source: SeoAuditRow,
  args: { input: string; source?: string; userId?: string; email?: string; ipHash?: string }
): Promise<string> {
  if (!source.result) throw new SeoAuditError("invalid", "Cached report has no result.");
  const id = shortId(11);
  const origin = source.cachedFrom ?? source.id;
  const t = nowIso();
  const sourceDoneAt = (source.completedAt ?? new Date()).toISOString();
  const result: SeoAuditResult = { ...source.result, meta: { ...source.result.meta, cachedFrom: sourceDoneAt } };
  await db.insert(seoAudits).values({
    id,
    input: args.input,
    url: source.url,
    domain: source.domain,
    status: "complete",
    plan: "free",
    score: source.score,
    grade: source.grade,
    result,
    source: args.source,
    userId: args.userId,
    email: args.email,
    ipHash: args.ipHash,
    cachedFrom: origin,
    completedAt: source.completedAt ?? new Date(),
    progress: { stage: "done", percent: 100, pagesCrawled: source.result.meta.pagesCrawled, startedAt: t, updatedAt: t },
    upgradeState: "idle",
  });
  return id;
}

/**
 * 登录用户对同一来源已经有一份未解锁的副本 → 直接给回那一行(零写入,复审 C5/C43)。
 * 只对登录用户这样做:匿名按 ip_hash 复用会让同一 NAT 后面的不同人拿到同一个报告链接,
 * 其中一人付款后另一人的链接就成了付费报告的钥匙。
 */
export async function findOwnCachedCopy(userId: string, originId: string): Promise<string | null> {
  if (!userId || !originId) return null;
  const rows = await db
    .select({ id: seoAudits.id })
    .from(seoAudits)
    .where(
      and(
        eq(seoAudits.userId, userId),
        eq(seoAudits.cachedFrom, originId),
        eq(seoAudits.unlocked, false),
        eq(seoAudits.status, "complete")
      )
    )
    .orderBy(desc(seoAudits.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** 按 ip_hash 数近期发起的审计(缓存副本也算一行,但它们不触发抓取)。保留给运维脚本 */
export async function countSeoAuditsByIp(ipHash: string, withinMs: number): Promise<number> {
  if (!ipHash) return 0;
  const since = new Date(Date.now() - withinMs);
  const rows = await db
    .select({ n: count() })
    .from(seoAudits)
    .where(and(eq(seoAudits.ipHash, ipHash), gte(seoAudits.createdAt, since)));
  return Number(rows[0]?.n ?? 0);
}

/* ============================================================
   免费运行(异步)
   ============================================================ */

/**
 * 只建行(status=pending, progress.stage=queued),<1s 返回。真正的运行交给
 * runSeoAuditInBackground(路由用 waitUntil 挂在同一请求的后台)。
 * 无效输入在建行之前就拒绝(抛 SeoAuditError("invalid")),表里不留垃圾。
 */
export async function startSeoAudit(
  input: string,
  opts: { source?: string; userId?: string; email?: string; ipHash?: string } = {}
): Promise<{ id: string; entryUrl: string; domain: string }> {
  const norm = normalizeInput(input);
  const id = await createSeoAudit({
    input,
    url: norm.entryUrl,
    domain: norm.domain,
    source: opts.source,
    userId: opts.userId,
    email: opts.email,
    ipHash: opts.ipHash,
    progress: queuedProgress(),
  });
  return { id, entryUrl: norm.entryUrl, domain: norm.domain };
}

/**
 * 后台跑完一次免费审计并落库。**永不抛**:waitUntil 里没有人接错误,
 * 失败一律写进行的 error 与错误收件箱。已完成的行直接返回(幂等)。
 */
export async function runSeoAuditInBackground(id: string): Promise<void> {
  let row: SeoAuditRow | null = null;
  try {
    row = await getSeoAudit(id);
    if (!row || row.status === "complete") return;
    const writer = progressWriter(id);
    const startedAt = row.progress?.startedAt ?? nowIso();
    await setProgress(id, { stage: "probing", percent: 5, pagesCrawled: 0, startedAt, updatedAt: nowIso() });
    try {
      const result = await runSeoAudit(row.input, {
        plan: "free",
        onProgress: writer.push,
        psiQuota: consumePsiQuota,
        deadlineMs: RUN_DEADLINE_MS,
      });
      await writer.flush();
      await saveSeoAuditResult(id, result, usdToCents(result.cost.dataforseoUsd));
    } catch (e) {
      await writer.flush();
      await failSeoAudit(id, failureMessage(e));
      // 用户输入侧的问题(不可达、超时、私网)记 warn:它们不是我们的故障,不能把 /api/health 拖红
      const code = e instanceof SeoAuditError ? e.code : "unknown";
      await captureError({
        name: `seo_audit_${code}`,
        message: String((e as Error)?.message ?? e),
        stack: e instanceof SeoAuditError ? undefined : (e as Error)?.stack,
        route: "/api/seo-audit",
        source: "server",
        level: e instanceof SeoAuditError && code !== "unconfigured" ? "warn" : "error",
        meta: { id, input: row.input.slice(0, 200) },
      });
    }
  } catch (e) {
    // 连落库都失败了(数据库抖动):至少进收件箱
    await captureError({ name: "seo_audit_background", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/seo-audit", source: "server", meta: { id } });
  }
}

/**
 * v1 契约(同步):创建并跑完一次**免费**审计,落库后返回 id。给脚本 / 测试用;
 * 路由走 startSeoAudit + runSeoAuditInBackground。
 * fresh=false(默认)时,同入口 URL 6 小时内已有完成的免费报告 → 复制成新行返回(reused=true)。
 */
export async function runAndStoreSeoAudit(
  input: string,
  opts: { source?: string; userId?: string; email?: string; ipHash?: string; fresh?: boolean } = {}
): Promise<{ id: string; reused: boolean }> {
  const norm = normalizeInput(input);
  if (!opts.fresh) {
    const recent = await findRecentFreeSeoAudit(norm.domain, SEO_AUDIT_REUSE_MS, norm.entryUrl);
    if (recent) {
      const id = await createCachedCopy(recent, { input, source: opts.source, userId: opts.userId, email: opts.email, ipHash: opts.ipHash });
      return { id, reused: true };
    }
  }
  const { id } = await startSeoAudit(input, opts);
  await runSeoAuditInBackground(id);
  const row = await getSeoAudit(id);
  if (!row || row.status !== "complete") {
    throw new SeoAuditError("unreachable", row?.error || "We couldn't finish this SEO audit.");
  }
  return { id, reused: false };
}

/* ============================================================
   付费升级(DB CAS + 模块级落库)
   ============================================================ */

export type UpgradeState = "idle" | "running" | "done" | "failed" | "pending_provider";

/**
 * 抢升级的执行权:一条 UPDATE … WHERE … RETURNING,跨实例只有一个赢家。
 * 可抢的状态:从未跑过 / idle / failed / pending_provider,或上一个 running 已超过 6 分钟(卡死);
 * 另外 done 但 plan 仍不是 full 的不一致行也放行(否则永远修不好)。
 */
export async function claimUpgrade(id: string): Promise<boolean> {
  const interval = sql.raw(`interval '${Math.floor(SEO_STALE_RUN_MS / 1000)} seconds'`);
  const res = await db.execute(sql`
    update seo_audits
    set upgrade_state = 'running', upgrade_started_at = now()
    where id = ${id}
      and unlocked
      and (
        upgrade_state is null
        or upgrade_state in ('idle', 'failed', 'pending_provider')
        or (upgrade_state = 'done' and plan <> 'full')
        or upgrade_started_at is null
        or upgrade_started_at < now() - ${interval}
      )
    returning id
  `);
  const rows = (res as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

export async function setUpgradeState(id: string, state: UpgradeState): Promise<void> {
  await db.update(seoAudits).set({ upgradeState: state }).where(eq(seoAudits.id, id));
}

/**
 * 把一个模块的结果合并进 result(jsonb 顶层 `||`,一条语句原子完成)。
 * 只在 result 已存在时合并 —— 免费轮失败后的空行不能被拼成半个报告。
 */
export async function mergeModule(id: string, patch: Partial<SeoAuditResult>): Promise<void> {
  await db.execute(sql`
    update seo_audits
    set result = result || ${JSON.stringify(jsonbSafe(patch))}::jsonb
    where id = ${id} and result is not null
  `);
}

/** 升级完成的唯一判据:结果自己的 plan(与 $29 报告同一条纪律,别发明第二种) */
export function upgradeDone(row: SeoAuditRow): boolean {
  return row.result?.plan === "full";
}

export function upgradeRunning(row: SeoAuditRow, now: number = Date.now()): boolean {
  if (row.upgradeState !== "running") return false;
  const at = row.upgradeStartedAt ? row.upgradeStartedAt.getTime() : 0;
  return now - at < SEO_STALE_RUN_MS;
}

/**
 * 付费模块(DataForSEO 三项)跑完仍为 null、或 Ranking Score 缺席 → 错误收件箱(level=error,/api/health 会变红)。
 * 买家付了钱却缺一块,站长必须知道;noData(供应商没有这个域名的数据)是有效结果,不算缺
 * —— 判定以 run.ts 的 missingPaidModules 为准。永不抛。
 */
async function alertMissingPaidModules(id: string, result: SeoAuditResult, route: string, kind: "upgrade" | "re-run"): Promise<void> {
  try {
    if (result.plan !== "full") return;
    const missing: PaidModuleId[] = missingPaidModules(result);
    if (missing.length) {
      await captureError({
        name: "seo_audit_paid_module_missing",
        message: `Paid modules missing after ${kind} of ${id}: ${missing.join(", ")}`,
        route,
        source: "server",
        level: "error",
        meta: { id, missing },
      });
    }
    // v3:SEO Ranking Score 是完整版的头条内容。计分是纯函数、拿不到的数据只会让小维度标"未测",
    // 所以非 blocked 的完整版缺它 = 代码缺陷,必须让站长看到(blocked 的运行本来就不出分)
    if (!result.ranking && result.meta?.outcome !== "blocked") {
      await captureError({
        name: "seo_audit_ranking_missing",
        message: `SEO Ranking Score missing after ${kind} of ${id}`,
        route,
        source: "server",
        level: "error",
        meta: { id, notes: (result.meta?.notes ?? []).filter((n) => /ranking score|top-ranking/i.test(n)).slice(0, 3) },
      });
    }
  } catch {
    /* 报警本身不能拖垮主流程 */
  }
}

/**
 * 真正生成完整报告(调用方已通过 claimUpgrade 抢到执行权)。**永不抛**。
 * 每个模块一落地就 mergeModule;整体成功 → plan=full、upgrade_state=done;
 * 失败 → upgrade_state=failed(允许再次 POST 重试,重试时只补缺的模块)。
 * 完成时**不写 unlocked**:运行期间到达的退款 / 拒付撤销必须保留(复审 C1),
 * 撤销后的行是 plan=full + unlocked=false,toPublicView 会还原成免费形状。
 */
export async function runUpgradeInBackground(id: string): Promise<{ ok: boolean; done: boolean }> {
  let row: SeoAuditRow | null = null;
  try {
    row = await getSeoAudit(id);
    if (!row) return { ok: false, done: false };
    if (upgradeDone(row)) {
      await setUpgradeState(id, "done");
      return { ok: true, done: true };
    }
    const writer = progressWriter(id);
    const prev = row.result;
    try {
      const result =
        prev && prev.version === 1 && prev.probe
          ? await upgradeSeoAudit(prev, {
              onModule: (_name: UpgradeModule, patch) => mergeModule(id, patch),
              onProgress: writer.push,
              psiQuota: consumePsiQuota,
              deadlineMs: RUN_DEADLINE_MS,
            })
          : await runSeoAudit(row.input, { plan: "full", onProgress: writer.push, psiQuota: consumePsiQuota, deadlineMs: RUN_DEADLINE_MS });
      await writer.flush();
      // upgradeSeoAudit 回来的 cost 是累计值(prev + 本次);行上只加本次的增量
      const deltaUsd = Math.max(0, result.cost.dataforseoUsd - (prev?.cost.dataforseoUsd ?? 0));
      await saveSeoAuditResult(id, result, usdToCents(deltaUsd));
      await db.update(seoAudits).set({ plan: "full", upgradeState: "done" }).where(eq(seoAudits.id, id));
      await alertMissingPaidModules(id, result, "/api/seo-audit/[id]/upgrade", "upgrade");
      return { ok: true, done: true };
    } catch (e) {
      await writer.flush();
      await setUpgradeState(id, "failed");
      const msg = String((e as Error)?.message ?? e);
      await captureError({
        name: e instanceof SeoAuditError ? "seo_audit_upgrade_unavailable" : "seo_audit_upgrade",
        message: msg,
        stack: e instanceof SeoAuditError ? undefined : (e as Error)?.stack,
        route: "/api/seo-audit/[id]/upgrade",
        source: "server",
        level: e instanceof SeoAuditError ? "warn" : "error",
        meta: { id },
      });
      return { ok: false, done: false };
    }
  } catch (e) {
    await captureError({ name: "seo_audit_upgrade_background", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/seo-audit/[id]/upgrade", source: "server", meta: { id } });
    return { ok: false, done: false };
  }
}

/**
 * v1 契约(同步):付费解锁后把报告升级为完整版。不改 status;完成后 plan="full"、cost 累加(unlocked 只由付款置位)。
 * 自己抢 CAS;抢不到(另一实例在跑)抛 SeoAuditError("timeout")。失败时抛出,由调用方决定文案。
 */
export async function upgradeSeoAuditToFull(id: string): Promise<void> {
  const row = await getSeoAudit(id);
  if (!row) throw new SeoAuditError("invalid", "SEO audit not found.");
  if (upgradeDone(row)) return;
  const claimed = await claimUpgrade(id);
  if (!claimed) throw new SeoAuditError("timeout", "Another run is already building this report.");
  const r = await runUpgradeInBackground(id);
  if (!r.ok) throw new SeoAuditError("unreachable", "We hit a snag building the full report — retry in a minute.");
}

/* ============================================================
   付费重跑(解锁后 30 天内)
   ============================================================ */

export function rerunAllowed(row: SeoAuditRow, now: number = Date.now()): boolean {
  if (!row.unlocked || !row.unlockedAt) return false;
  return now - row.unlockedAt.getTime() <= SEO_RERUN_WINDOW_MS;
}

/** 一次重跑要不要碰 DataForSEO:refreshPaid = 三模块全部重拉;fillMissing = 只补上一份里为 null 的模块 */
export interface RerunPaidPlan {
  refreshPaid: boolean;
  fillMissing: boolean;
}

/**
 * 纯函数(离线可测):决定这次重跑的付费动作,以及要不要计一次 paid_refresh_count。
 * - refreshPaid:买家明确要求,且还有额度;
 * - fillMissing:没要求刷新,但上一份缺模块(升级时某模块超时 / 报错),且还有额度 ——
 *   "Re-run to retry" 必须真的能补回来(复审 C14/C27),但补缺同样是真钱,和刷新共用 2 次额度封顶;
 * - 两者任一为真都计一次额度。
 */
export function decideRerunPaid(args: { requestedRefresh: boolean; paidRefreshCount: number; missing: readonly string[] }): RerunPaidPlan & { countsRefresh: boolean } {
  const budgetLeft = (args.paidRefreshCount ?? 0) < SEO_PAID_REFRESH_MAX;
  const refreshPaid = args.requestedRefresh && budgetLeft;
  const fillMissing = !refreshPaid && args.missing.length > 0 && budgetLeft;
  return { refreshPaid, fillMissing, countsRefresh: refreshPaid || fillMissing };
}

/**
 * 登记一次重跑:status → running、progress → queued、计数 +1;付费动作见 decideRerunPaid,
 * 动用额度时 paid_refresh_count 同一条语句 +1。
 * WHERE status='complete' 保证同一报告不会被并发重跑两次;抢不到抛 SeoAuditError("timeout")。
 */
export async function startRerun(id: string, opts: { refreshPaid?: boolean } = {}): Promise<RerunPaidPlan> {
  const row = await getSeoAudit(id);
  if (!row) throw new SeoAuditError("invalid", "SEO audit not found.");
  const missing = row.result ? missingPaidModules(row.result) : [];
  const plan = decideRerunPaid({ requestedRefresh: !!opts.refreshPaid, paidRefreshCount: row.paidRefreshCount ?? 0, missing });
  const res = await db
    .update(seoAudits)
    .set({
      status: "running",
      error: null,
      progress: queuedProgress(),
      rerunCount: sql`${seoAudits.rerunCount} + 1`,
      ...(plan.countsRefresh ? { paidRefreshCount: sql`${seoAudits.paidRefreshCount} + 1` } : {}),
    })
    .where(and(eq(seoAudits.id, id), eq(seoAudits.unlocked, true), eq(seoAudits.status, "complete")))
    .returning({ id: seoAudits.id });
  if (!res.length) throw new SeoAuditError("timeout", "A run is already in progress for this report.");
  return { refreshPaid: plan.refreshPaid, fillMissing: plan.fillMissing };
}

/**
 * 纯函数(离线可测):这次重跑的结果能不能覆盖上一份(契约 2,复审 C13/C26)。
 * 上一份不是 blocked、这一次被拦(outcome=blocked),或这一次一页都没抓到而上一份有页 ——
 * 覆盖就等于把已付费的报告(页面表、路线图、站外三模块)换成一张空壳,而且再也换不回来。
 * 此时保留旧报告,只把原因写进 error / progress.message。
 */
export function rerunDegradation(prev: SeoAuditResult | null, next: SeoAuditResult): { keepPrevious: boolean; message: string } {
  if (!prev) return { keepPrevious: false, message: "" };
  const prevBlocked = prev.meta?.outcome === "blocked";
  const nextBlocked = next.meta?.outcome === "blocked";
  const evidence = (next.probe?.blocked?.evidence || "").trim();
  if (nextBlocked && !prevBlocked) {
    return {
      keepPrevious: true,
      message: `Re-run blocked: ${evidence || "the site's firewall blocked our crawler"}. Your previous report was kept — allow AEOeyeBot and re-run.`,
    };
  }
  const lostPages = (next.pages?.length ?? 0) === 0 && (prev.pages?.length ?? 0) > 0;
  if (lostPages) {
    const why = (next.probe?.entryError?.message || evidence).trim();
    return {
      keepPrevious: true,
      message: `Re-run blocked: no pages could be fetched this time${why ? ` (${why})` : ""}. Your previous report was kept.`,
    };
  }
  return { keepPrevious: false, message: "" };
}

/**
 * 重跑结果被丢弃时的落库(契约 2):status 回 complete,旧 result / score / grade / completedAt 一律不动,
 * 原因写进 error 与 progress.message(报告页在 complete 行上显示它);这次真花掉的 DataForSEO 钱照样记账;
 * 预扣的刷新额度退回(greatest(n-1, 0),同一条语句)。
 */
export async function keepPreviousAfterRerun(id: string, args: { message: string; costCents: number; refundRefresh: boolean }): Promise<void> {
  await db
    .update(seoAudits)
    .set({
      status: "complete",
      error: cleanText(args.message.slice(0, 500)),
      progress: doneProgressSql({ message: args.message.slice(0, 200) }),
      costCents: sql`${seoAudits.costCents} + ${Math.max(0, Math.round(args.costCents))}`,
      ...(args.refundRefresh ? { paidRefreshCount: sql`greatest(${seoAudits.paidRefreshCount} - 1, 0)` } : {}),
    })
    .where(eq(seoAudits.id, id));
}

/**
 * 后台重跑。**永不抛**。成功 → 新结果覆盖(plan=full,notes 里带 "Previous score");
 * 被拦 / 零页 → 旧报告原样保留(rerunDegradation);失败 → 旧报告原样保留(status 回到 complete),
 * 错误写进 error 与 progress.message(报告页在 complete 行上显示它)。
 * 这次重跑若动用了刷新额度(refreshPaid || fillMissing)却没真正拿到站外数据(被拦 / 被丢弃),额度退回。
 */
export async function runRerunInBackground(id: string, opts: RerunPaidPlan): Promise<void> {
  let row: SeoAuditRow | null = null;
  const countedRefresh = opts.refreshPaid || opts.fillMissing;
  const refundRefresh = countedRefresh ? { paidRefreshCount: sql`greatest(${seoAudits.paidRefreshCount} - 1, 0)` } : {};
  try {
    row = await getSeoAudit(id);
    if (!row) return;
    const prev = row.result;
    const writer = progressWriter(id);
    try {
      const result =
        prev && prev.version === 1 && prev.probe
          ? await rerunSeoAudit(prev, {
              refreshPaid: opts.refreshPaid,
              fillMissing: opts.fillMissing,
              onProgress: writer.push,
              psiQuota: consumePsiQuota,
              deadlineMs: RUN_DEADLINE_MS,
            })
          : await runSeoAudit(row.input, { plan: "full", onProgress: writer.push, psiQuota: consumePsiQuota, deadlineMs: RUN_DEADLINE_MS });
      await writer.flush();
      const deltaUsd = Math.max(0, result.cost.dataforseoUsd - (prev?.cost.dataforseoUsd ?? 0));

      const verdict = rerunDegradation(prev, result);
      if (verdict.keepPrevious) {
        await keepPreviousAfterRerun(id, { message: verdict.message, costCents: usdToCents(deltaUsd), refundRefresh: countedRefresh });
        await captureError({
          name: "seo_audit_rerun_blocked",
          message: verdict.message,
          route: "/api/seo-audit/[id]/rerun",
          source: "server",
          level: "warn",
          meta: { id, outcome: result.meta?.outcome ?? null, pages: result.pages?.length ?? 0 },
        });
        return;
      }

      await saveSeoAuditResult(id, result, usdToCents(deltaUsd));
      // 上一份本来就是 blocked、这一次还是 blocked:结果照常落库(没有东西可丢),
      // 但被拦的运行不会去调 DataForSEO —— 预扣的额度退回
      const blockedAgain = result.meta?.outcome === "blocked";
      await db
        .update(seoAudits)
        .set({ upgradeState: "done", plan: "full", ...(blockedAgain ? refundRefresh : {}) })
        .where(eq(seoAudits.id, id));
      await alertMissingPaidModules(id, result, "/api/seo-audit/[id]/rerun", "re-run");
    } catch (e) {
      await writer.flush();
      const msg = `Re-run failed: ${failureMessage(e)}`;
      await db
        .update(seoAudits)
        .set({
          status: prev ? "complete" : "failed",
          error: cleanText(msg.slice(0, 500)),
          progress: doneProgressSql({ message: msg.slice(0, 200) }),
          // 整次重跑抛错 = 一个模块都没落库,预扣的额度退回
          ...refundRefresh,
        })
        .where(eq(seoAudits.id, id));
      await captureError({
        name: e instanceof SeoAuditError ? `seo_audit_rerun_${e.code}` : "seo_audit_rerun",
        message: String((e as Error)?.message ?? e),
        stack: e instanceof SeoAuditError ? undefined : (e as Error)?.stack,
        route: "/api/seo-audit/[id]/rerun",
        source: "server",
        level: e instanceof SeoAuditError ? "warn" : "error",
        meta: { id },
      });
    }
  } catch (e) {
    await captureError({ name: "seo_audit_rerun_background", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack, route: "/api/seo-audit/[id]/rerun", source: "server", meta: { id } });
  }
}

/* ============================================================
   列表 / 运维
   ============================================================ */

export async function listSeoAuditsForUser(userId: string): Promise<SeoAuditRow[]> {
  if (!userId) return [];
  const rows = await db
    .select()
    .from(seoAudits)
    .where(eq(seoAudits.userId, userId))
    .orderBy(desc(seoAudits.createdAt))
    .limit(30);
  return rows.map(toRow);
}

function rowsOf(res: unknown): unknown[] {
  return (res as { rows?: unknown[] }).rows ?? [];
}

/**
 * 卡死清扫(cron):pending/running 超过 staleMs 的行 ——
 *   有旧报告的重跑(result 非空)→ 恢复 complete,error 记 "Re-run timed out",报告不丢;
 *   其余 → failed "Timed out"。
 *   running 超过 staleMs 的升级 → upgrade_state=failed(允许再次 POST 重试)。
 * 运行自己的 deadline 是 250s,这里只是最后一道兜底。
 */
export async function sweepStaleSeoAudits(staleMs: number = SEO_STALE_RUN_MS): Promise<{ restored: number; timedOut: number; upgradesFailed: number }> {
  const interval = sql.raw(`interval '${Math.max(60, Math.floor(staleMs / 1000))} seconds'`);
  const stale = sql`coalesce((progress->>'startedAt')::timestamptz, created_at) < now() - ${interval}`;
  const restoredProgress = JSON.stringify({ stage: "done", percent: 100, message: "Re-run timed out", updatedAt: nowIso() });
  const timedOutProgress = JSON.stringify({ stage: "done", percent: 100, message: "Timed out", updatedAt: nowIso() });
  const restored = await db.execute(sql`
    update seo_audits
    set status = 'complete', error = 'Re-run timed out', progress = ${restoredProgress}::jsonb
    where status in ('pending', 'running') and result is not null and ${stale}
    returning id
  `);
  const timedOut = await db.execute(sql`
    update seo_audits
    set status = 'failed', error = 'Timed out', completed_at = now(), progress = ${timedOutProgress}::jsonb
    where status in ('pending', 'running') and result is null and ${stale}
    returning id
  `);
  const upgrades = await db.execute(sql`
    update seo_audits
    set upgrade_state = 'failed'
    where upgrade_state = 'running' and (upgrade_started_at is null or upgrade_started_at < now() - ${interval})
    returning id
  `);
  return { restored: rowsOf(restored).length, timedOut: rowsOf(timedOut).length, upgradesFailed: rowsOf(upgrades).length };
}

/** 失败行的保留期:没有结果、没解锁的 failed 行只是"那次没跑成"的记录,30 天后没有任何用处 */
export const SEO_FAILED_RETENTION_DAYS = 30;

/**
 * 清理(cron,零成本 SQL):超过保留期、没有 result、没解锁的 failed 行(复审 C43:seo_audits 只增不减)。
 * 已解锁或有结果的行一律不动 —— dashboard 历史与买家的报告链接要用。分批删,单次最多 limit 行。
 */
export async function purgeFailedSeoAudits(limit = 500): Promise<number> {
  const res = await db.execute(purgeFailedSeoAuditsQuery(limit));
  const row = (rowsOf(res)[0] ?? {}) as { n?: number | string };
  return Number(row.n ?? 0);
}

/** 上面那条语句本身(单独导出:运维 / 校验可以对它 EXPLAIN 而不真的删) */
export function purgeFailedSeoAuditsQuery(limit = 500) {
  const n = Math.max(1, Math.min(5_000, Math.floor(limit)));
  const days = sql.raw(`interval '${SEO_FAILED_RETENTION_DAYS} days'`);
  return sql`
    with d as (
      delete from seo_audits
      where id in (
        select id from seo_audits
        where status = 'failed' and result is null and not unlocked and created_at < now() - ${days}
        limit ${n}
      )
      returning 1
    )
    select count(*)::int as n from d
  `;
}

/** /api/health 的 SEO 审计快照(只读) */
export async function seoAuditHealth(): Promise<{ runsLastHour: number; stuckRunning: number; unlockedTotal: number }> {
  const interval = sql.raw(`interval '${Math.floor(SEO_STALE_RUN_MS / 1000)} seconds'`);
  const res = await db.execute(sql`
    select
      (select count(*)::int from seo_audits where created_at >= now() - interval '1 hour' and cached_from is null) as runs_last_hour,
      (select count(*)::int from seo_audits where status in ('pending', 'running')
         and coalesce((progress->>'startedAt')::timestamptz, created_at) < now() - ${interval}) as stuck_running,
      (select count(*)::int from seo_audits where unlocked) as unlocked_total
  `);
  const row = (rowsOf(res)[0] ?? {}) as { runs_last_hour?: number | string; stuck_running?: number | string; unlocked_total?: number | string };
  return {
    runsLastHour: Number(row.runs_last_hour ?? 0),
    stuckRunning: Number(row.stuck_running ?? 0),
    unlockedTotal: Number(row.unlocked_total ?? 0),
  };
}
