import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { seoAudits, seoGscClaims } from "@/lib/db/schema";
import { shortId } from "@/lib/utils";
import { captureError } from "@/lib/errors";
import { GscError, listSites, serviceAccountEmail, type GscSite } from "@/lib/google/search-console";
import {
  activeClaim,
  checkSiteControl,
  claimStateFor,
  decideIntent,
  decideVerification,
  gscAccessLost,
  gscInstructions,
  matchProperty,
  newSiteToken,
  pullGscData,
  verificationTarget,
  GSC_INTENT_TTL_MS,
  type ClaimFacts,
  type GscClaimState,
  type GscInstructions,
  type SiteControlProof,
} from "./gsc";
import { registrableDomain } from "./url";
import type { GscData, RankingFramework, SeoAuditResult } from "./types";

/* ============================================================
   Search Console 绑定(seo_gsc_claims)的编排 —— 判定在 gsc.ts 的纯函数里,这里负责
   "读 claim → 判定 → 证明站点控制权 / 查属性访问权 → 拉数据 → 并入报告 → 改 claim 状态"。

   结构:核心流程(intentWith / verifyWith / disconnectWith / refreshWith)只依赖一组端口(GscPorts):
   数据库读写、Google、站点证明、分数重算全部从端口进来。生产用 dbPorts(drizzle + 真实 Google);
   测试用内存端口把整条流程跑通 —— 包括"两个用户各自证明了控制权、都通过"这种协议层面的性质。

   写报告的纪律(neon-http 没有交互式事务):
   - `{ gsc, ranking }` 与 gsc_property 用**一条** UPDATE 写入,且只在 status=complete、result 的 generatedAt
     仍是我们读到的那一份时生效(乐观并发:读 → 重算 → 写之间若有一次运行落库,就重读重算,最多 3 次)。
   - 分数用 ranking.ts 的 recomputeRankingFromResult 从已存结果重算(纯函数,不抓取、不花钱、不占重跑配额),
     now 取原结果的 generatedAt —— 这样除了依赖 GSC 的小维度,其余分数与原报告逐字一致。
   - verify:先把数据并入报告,再把 claim 改成 verified;改不成(本人在另一个标签页取消了)就把数据撤回。
   claim 的 note 列只给人工处理看,**永远不返回给前端**。
   ============================================================ */

const ROUTE = "/api/seo-audit/[id]/gsc";

export interface GscClaimRecord extends ClaimFacts {
  domain: string;
  property: string | null;
  token: string | null;
  verifiedAt: Date | null;
  lastSyncedAt: Date | null;
}

export interface GscReportSnapshot {
  id: string;
  url: string;
  domain: string;
  status: string;
  gscProperty: string | null;
  result: SeoAuditResult | null;
}

export type ReportPatch = { gsc: GscData | null; ranking?: RankingFramework };

/** 核心流程依赖的全部外部能力(生产 = dbPorts;测试 = 内存实现) */
export interface GscPorts {
  now(): Date;
  serviceAccountEmail(): string | null;
  newId(): string;
  newToken(): string;
  /** 本用户在这份报告上的 claim(新的在前) */
  ownClaims(auditId: string, userId: string): Promise<GscClaimRecord[]>;
  /** 这份报告上所有 verified 的 claim(刷新用,不分用户) */
  verifiedClaimsOnAudit(auditId: string): Promise<GscClaimRecord[]>;
  insertClaim(c: { id: string; domain: string; userId: string; auditId: string; token: string; createdAt: Date }): Promise<void>;
  /** CAS:pending / verified → verified(同时记属性与同步时间);目标行已被撤销则返回 false */
  markVerified(claimId: string, property: string, at: Date): Promise<boolean>;
  /** 只动 pending / verified;原因追加进 note */
  markRevoked(claimIds: string[], note: string): Promise<void>;
  readReport(auditId: string): Promise<GscReportSnapshot | null>;
  /** 一条语句:result = result || patch、gsc_property = property;只在 result 非空、status=complete、generatedAt 未变时生效 */
  patchReport(auditId: string, patch: ReportPatch, gscProperty: string | null, expectGeneratedAt: string | null): Promise<boolean>;
  setGscProperty(auditId: string, property: string | null): Promise<void>;
  listSites(): Promise<GscSite[]>;
  pull(property: string, domain: string): Promise<GscData>;
  siteControl(args: { domain: string; entryUrl: string; token: string }): Promise<SiteControlProof>;
  recompute(result: SeoAuditResult, overrides: { gsc: GscData | null; now?: Date }): Promise<RankingFramework | null>;
  /** 非致命问题记一笔(生产 = 错误收件箱 warn) */
  warn(name: string, message: string, meta: Record<string, unknown>): Promise<void>;
}

export type GscRefusalCode = "no_intent" | "expired" | "token_not_found" | "no_property_access" | "report_busy";

export interface GscActionOk extends Partial<GscInstructions> {
  ok: true;
  state: GscClaimState;
  property: string | null;
  /** 给用户看的一句话(英文) */
  message: string;
  /** 分数已按新的 Search Console 数据当场重算(verify / disconnect) */
  scoresUpdated?: boolean;
}

export interface GscActionRefusal extends Partial<GscInstructions> {
  ok: false;
  state: GscClaimState;
  code: GscRefusalCode;
  error: string;
  /** verify 的两项证明各自是否通过(UI 可以画成清单) */
  checks?: { siteToken: boolean; searchConsoleAccess: boolean };
}

export type GscActionResult = GscActionOk | GscActionRefusal;

export type GscRefresh =
  /** 新数据已拉到;applied = 已并入报告(有运行在跑时为 false,由那次运行自己拉) */
  | { status: "ok"; data: GscData; applied: boolean }
  /** 没有接入(或绑定已不在,残留数据已撤掉) */
  | { status: "none" }
  /** 刷新时发现属性已不可访问:claim 已撤销,数据已从报告撤掉 */
  | { status: "revoked" }
  /** 临时故障(Google 超时 / 5xx / 配额):什么都没改 */
  | { status: "error"; reason: string };

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function requireEmail(ports: GscPorts): string {
  const email = ports.serviceAccountEmail();
  if (!email) throw new GscError("unconfigured", "Search Console service account is not configured.");
  return email;
}

/* ---------- 文案(英文 UI;不提任何其他用户的信息) ---------- */

function refusal(
  code: GscRefusalCode,
  state: GscClaimState,
  error: string,
  extra: { instructions?: GscInstructions | null; checks?: GscActionRefusal["checks"] } = {}
): GscActionRefusal {
  return { ok: false, state, code, error, ...(extra.instructions ?? {}), ...(extra.checks ? { checks: extra.checks } : {}) };
}

/** verify 没通过时逐项说清缺什么(pending 状态下 ins 一定有:token 与邮箱本来就该给这个用户看) */
function notProvenText(domain: string, ins: GscInstructions, checks: { siteToken: boolean; searchConsoleAccess: boolean }, detail?: string): string {
  const parts: string[] = [];
  if (!checks.siteToken) {
    parts.push(
      `We couldn't find your verification tag on ${domain}. Add ${ins.metaTag} inside the <head> of your homepage, or add a DNS TXT record with the value ${ins.dnsTxt} to ${domain}.`
    );
    if (detail) parts.push(`(We checked: ${detail}.)`);
  }
  if (!checks.searchConsoleAccess) {
    parts.push(
      `${checks.siteToken ? "Your site is verified, but our" : "Also, our"} service account can't see a Search Console property for ${domain} yet: add ${ins.serviceAccountEmail} under Search Console → Settings → Users and permissions (Restricted is enough). New users can take a minute to show up.`
    );
  }
  parts.push("Then click Verify again.");
  return parts.join(" ");
}

const TEXT = {
  noIntent: "Click Connect Search Console first to get your verification tag.",
  expired: `This connection request expired after ${Math.round(GSC_INTENT_TTL_MS / 86_400_000)} days. Click Connect Search Console to get a new verification tag.`,
  busy: "A run is in progress for this report. Click Verify again when it finishes.",
  lost: (domain: string) =>
    `We can no longer see a Search Console property for ${domain}, so the connection was removed and its data taken out of this report. To reconnect, click Connect Search Console and follow the steps again.`,
  noData: (domain: string, email: string) =>
    `Google lists a Search Console property for ${domain} but won't share its data with our service account yet. Check that ${email} has Restricted or Full permission, wait a minute, then click Verify again.`,
};

/* ============================================================
   并入报告 / 撤出报告
   ============================================================ */

type ApplyOutcome = "applied" | "applied_without_ranking" | "busy" | "missing";

/**
 * 把 gsc(null = 撤掉)并入报告并重算分数:读 → 重算 → 条件写,最多 3 次。
 * 有运行在跑(status ≠ complete)→ busy:那次运行落库时会整份覆盖 result,现在写进去也会丢。
 */
async function applyToReport(ports: GscPorts, auditId: string, gsc: GscData | null, property: string | null): Promise<ApplyOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const report = await ports.readReport(auditId);
    if (!report?.result) return "missing";
    if (report.status !== "complete") return "busy";
    const generatedAt = typeof report.result.generatedAt === "string" ? report.result.generatedAt : null;
    const at = generatedAt ? new Date(generatedAt) : null;
    let ranking: RankingFramework | null = null;
    try {
      ranking = await ports.recompute(report.result, { gsc, ...(at && Number.isFinite(at.getTime()) ? { now: at } : {}) });
    } catch (e) {
      // 重算出 bug 不能挡住接入 / 断开:数据照常写,分数保持原样,站长在收件箱里看到
      await ports.warn("seo_gsc_recompute", errText(e), { auditId });
    }
    const patch: ReportPatch = ranking ? { gsc, ranking } : { gsc };
    if (await ports.patchReport(auditId, patch, property, generatedAt)) return ranking ? "applied" : "applied_without_ranking";
  }
  return "busy";
}

/** 撤出:先无条件清 gsc_property(之后开始的运行就不会再拉),再撤数据、重算分数 */
async function removeFromReport(ports: GscPorts, auditId: string): Promise<ApplyOutcome> {
  await ports.setGscProperty(auditId, null);
  return applyToReport(ports, auditId, null, null);
}

/* ============================================================
   核心流程
   ============================================================ */

/** 发起接入:幂等(已有自己的有效 pending / verified 就原样返回);否则发一个新 token。没有拒绝分支 */
export async function intentWith(ports: GscPorts, args: { auditId: string; userId: string; domain: string }): Promise<GscActionResult> {
  const email = requireEmail(ports);
  const now = ports.now();
  const domain = registrableDomain(args.domain);
  let own = await ports.ownClaims(args.auditId, args.userId);
  if (decideIntent({ auditId: args.auditId, ownClaims: own, now }).action === "create") {
    await ports.insertClaim({ id: ports.newId(), domain, userId: args.userId, auditId: args.auditId, token: ports.newToken(), createdAt: now });
    // 重读:连点两次并发建了两行时,两个请求都回"最早那条有效 pending",token 一致
    own = await ports.ownClaims(args.auditId, args.userId);
  }
  const { claim, state } = activeClaim(own, args.auditId, now);
  const ins = gscInstructions(email, claim, state);
  if (!claim || !ins) throw new Error("Search Console intent: the new claim could not be read back.");
  const record = own.find((c) => c.id === claim.id);
  return {
    ok: true,
    state,
    property: state === "verified" ? (record?.property ?? null) : null,
    ...ins,
    message:
      state === "verified"
        ? "Search Console is already connected for this report."
        : `Add the verification tag to your homepage (or the DNS TXT record), add ${email} as a Restricted user in Search Console, then click Verify.`,
  };
}

/**
 * Verify。pending:首页 meta / DNS TXT 里有本次 token **且** 服务账号能访问匹配属性 → 拉数据、并入报告、verified。
 * verified 再点 = 重新同步:只看属性访问权(不再查 token);没有了 → 撤销并撤出数据。
 * Google 不可达 / 临时错误 → 抛 GscError(路由回 503),什么都不改。
 */
export async function verifyWith(
  ports: GscPorts,
  args: { auditId: string; userId: string; domain: string; entryUrl: string }
): Promise<GscActionResult> {
  const email = requireEmail(ports);
  const now = ports.now();
  const domain = registrableDomain(args.domain);
  const own = await ports.ownClaims(args.auditId, args.userId);
  const target = verificationTarget({ auditId: args.auditId, ownClaims: own, now });
  if (target.kind === "refuse") {
    return refusal(target.code, claimStateFor(own, args.auditId, now), target.code === "expired" ? TEXT.expired : TEXT.noIntent);
  }
  const claim = own.find((c) => c.id === target.claimId) as GscClaimRecord;
  const stateNow: GscClaimState = target.kind === "resync" ? "verified" : "pending";
  // 重新同步不需要 token(验证后删掉 meta 标签是常态);只有 prove 才要求这条 claim 带着合法 token
  const ins = gscInstructions(email, claim, stateNow);

  // 两项检查并行:属性访问权(sites.list)与站点控制权(首页 + DNS,只在 pending 时查)
  const [sites, proof] = await Promise.all([
    ports.listSites(),
    target.kind === "prove" ? ports.siteControl({ domain, entryUrl: args.entryUrl, token: claim.token ?? "" }) : Promise.resolve(null),
  ]);
  const property = matchProperty(domain, sites, { preferHost: hostOf(args.entryUrl) });
  const checks = { siteToken: proof ? proof.found : true, searchConsoleAccess: !!property };
  const decision = decideVerification({ kind: target.kind, siteProof: checks.siteToken, hasAccess: checks.searchConsoleAccess });

  if (decision.action === "revoke") {
    await ports.markRevoked([claim.id], `${now.toISOString()} access lost on re-sync: no accessible Search Console property for ${domain}`);
    await removeFromReport(ports, args.auditId);
    return refusal("no_property_access", "revoked", TEXT.lost(domain));
  }
  if (decision.action === "refuse") {
    // 只有 prove 会走到这里;verificationTarget 只把带合法 token 的 pending 判成 prove,所以 ins 一定有
    if (!ins) throw new Error("Search Console verify: the pending claim has no usable token.");
    return refusal(decision.code, stateNow, notProvenText(domain, ins, checks, proof && !proof.found ? proof.detail : undefined), { instructions: ins, checks });
  }

  const prop = property as string;
  let data: GscData;
  try {
    data = await ports.pull(prop, domain);
  } catch (e) {
    // 列表里有属性、数据却 403:多半是刚加的用户还没生效 —— 不撤销,让用户稍后再点
    if (gscAccessLost(e)) {
      return refusal("no_property_access", stateNow, TEXT.noData(domain, email), { instructions: ins, checks: { ...checks, searchConsoleAccess: false } });
    }
    throw e;
  }

  const outcome = await applyToReport(ports, args.auditId, data, prop);
  if (outcome === "busy" || outcome === "missing") return refusal("report_busy", stateNow, TEXT.busy, { instructions: ins, checks });

  if (!(await ports.markVerified(claim.id, prop, now))) {
    // 本人在另一个标签页取消 / 断开了:刚并入的数据撤回,按最新状态回答
    await removeFromReport(ports, args.auditId);
    const latest = await ports.ownClaims(args.auditId, args.userId);
    return refusal("no_intent", claimStateFor(latest, args.auditId, now), TEXT.noIntent);
  }
  return {
    ok: true,
    state: "verified",
    property: prop,
    ...(gscInstructions(email, { ...claim, status: "verified" }, "verified") ?? {}),
    scoresUpdated: outcome === "applied",
    message:
      outcome === "applied"
        ? "Search Console connected. Your scores now use your real search data."
        : "Search Console connected and your search data is in the report.",
  };
}

/**
 * 断开 / 取消:撤销本用户在这份报告上的 pending 与 verified claim;报告里有 GSC 数据就撤掉并当场重算分数。
 * 撤回授权永远要能做:有运行在跑时 gsc_property 照样先清掉,数据由那次运行落库时去掉(见集成说明)。
 */
export async function disconnectWith(ports: GscPorts, args: { auditId: string; userId: string }): Promise<GscActionResult> {
  const now = ports.now();
  const own = await ports.ownClaims(args.auditId, args.userId);
  const active = own.filter((c) => c.status === "pending" || c.status === "verified");
  const hadVerified = active.some((c) => c.status === "verified");
  if (active.length) await ports.markRevoked(active.map((c) => c.id), `${now.toISOString()} disconnected by the report owner`);

  const report = await ports.readReport(args.auditId);
  const hasData = !!report && (!!report.gscProperty || !!report.result?.gsc);
  const outcome = hasData ? await removeFromReport(ports, args.auditId) : null;
  const removeHint = " To revoke access completely, also remove the AEOeye service account you added under Search Console → Settings → Users and permissions.";
  const message =
    outcome === "busy"
      ? `Search Console disconnected. A run is in progress for this report; its Search Console data will be removed when the run finishes.${removeHint}`
      : outcome === "applied" || outcome === "applied_without_ranking"
        ? `Search Console disconnected and its data removed from this report${outcome === "applied" ? "; your scores were recalculated" : ""}.${removeHint}`
        : hadVerified
          ? `Search Console disconnected.${removeHint}`
          : active.length
            ? "Connection request cancelled."
            : "Search Console wasn't connected to this report.";
  // 状态与 GET 用同一套推导(曾接通过 → revoked,只是取消了申请 → none),两边永远一致
  const state = claimStateFor(await ports.ownClaims(args.auditId, args.userId), args.auditId, now);
  return { ok: true, state, property: null, scoresUpdated: outcome === "applied", message };
}

/**
 * 刷新(给路由用,不分用户):拉最新 28 天并入报告。只看属性是否仍可访问,**不再**查 token。
 * 属性不可访问 → 本报告的 verified claim 全部撤销、数据撤出(授权已撤回,公开报告上不该继续挂着)。
 * 绑定的属性没了但同域名还有另一个可访问的属性(例如删了域名属性、还留着 URL 前缀属性)→ 换过去,不撤销。
 * 永不抛(Google 临时故障 → error,什么都不改)。
 */
export async function refreshWith(ports: GscPorts, auditId: string): Promise<GscRefresh> {
  try {
    const now = ports.now();
    const report = await ports.readReport(auditId);
    if (!report?.gscProperty) return { status: "none" };
    const property = report.gscProperty;
    const claims = await ports.verifiedClaimsOnAudit(auditId);
    if (!claims.length) {
      // 属性还挂着、却已没有任何 verified 绑定(被撤销 / 人工处理过):把残留数据撤掉
      await removeFromReport(ports, auditId);
      return { status: "none" };
    }
    let sites: GscSite[];
    try {
      sites = await ports.listSites();
    } catch (e) {
      return { status: "error", reason: errText(e) };
    }
    const stillThere = sites.some((s) => s.siteUrl === property && s.permissionLevel !== "siteUnverifiedUser");
    const next = stillThere ? property : matchProperty(report.domain, sites, { preferHost: hostOf(report.url) });
    if (!next) {
      await ports.markRevoked(
        claims.map((c) => c.id),
        `${now.toISOString()} access lost on refresh: ${property} is no longer accessible to the service account`
      );
      await removeFromReport(ports, auditId);
      return { status: "revoked" };
    }
    let data: GscData;
    try {
      data = await ports.pull(next, report.domain);
    } catch (e) {
      return { status: "error", reason: errText(e) };
    }
    const outcome = await applyToReport(ports, auditId, data, next);
    for (const c of claims) await ports.markVerified(c.id, next, now);
    return { status: "ok", data, applied: outcome === "applied" || outcome === "applied_without_ranking" };
  } catch (e) {
    return { status: "error", reason: errText(e) };
  }
}

/* ============================================================
   生产端口(drizzle + 真实 Google + 真实站点检查 + ranking.ts 重算)
   ============================================================ */

/**
 * 与 repo.ts 的 jsonbSafe 同一份逻辑(Postgres 的 jsonb 拒收 \u0000 与孤立代理项)。
 * 不从 repo.ts 引:它会把整个审计引擎(run.ts)拉进本模块的依赖图,单测就没法只测接入流程了。
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function cleanText(s: string): string {
  return s.replace(/\u0000/g, "").replace(LONE_SURROGATE, "�");
}
function jsonbSafe<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map((v) => jsonbSafe(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[cleanText(k)] = jsonbSafe(v);
    return out as T;
  }
  return value;
}

type ClaimRow = typeof seoGscClaims.$inferSelect;

function toRecord(r: ClaimRow): GscClaimRecord {
  return {
    id: r.id,
    domain: r.domain,
    userId: r.userId,
    auditId: r.auditId,
    status: r.status,
    property: r.property,
    token: r.token,
    createdAt: r.createdAt,
    verifiedAt: r.verifiedAt,
    lastSyncedAt: r.lastSyncedAt,
  };
}

function rowsOf(res: unknown): unknown[] {
  return (res as { rows?: unknown[] }).rows ?? [];
}

export const dbPorts: GscPorts = {
  now: () => new Date(),
  serviceAccountEmail,
  newId: () => shortId(16),
  newToken: newSiteToken,
  async ownClaims(auditId, userId) {
    const rows = await db
      .select()
      .from(seoGscClaims)
      .where(and(eq(seoGscClaims.auditId, auditId), eq(seoGscClaims.userId, userId)))
      .orderBy(desc(seoGscClaims.createdAt))
      .limit(50);
    return rows.map(toRecord);
  },
  async verifiedClaimsOnAudit(auditId) {
    const rows = await db
      .select()
      .from(seoGscClaims)
      .where(and(eq(seoGscClaims.auditId, auditId), eq(seoGscClaims.status, "verified")))
      .limit(50);
    return rows.map(toRecord);
  },
  async insertClaim(c) {
    await db.insert(seoGscClaims).values({ id: c.id, domain: c.domain, userId: c.userId, auditId: c.auditId, status: "pending", token: c.token, createdAt: c.createdAt });
  },
  async markVerified(claimId, property, at) {
    const res = await db
      .update(seoGscClaims)
      .set({ status: "verified", property, verifiedAt: sql`coalesce(${seoGscClaims.verifiedAt}, now())`, lastSyncedAt: at })
      .where(and(eq(seoGscClaims.id, claimId), inArray(seoGscClaims.status, ["pending", "verified"])))
      .returning({ id: seoGscClaims.id });
    return res.length > 0;
  },
  async markRevoked(claimIds, note) {
    if (!claimIds.length) return;
    await db
      .update(seoGscClaims)
      .set({ status: "revoked", note: sql`concat_ws(' | ', ${seoGscClaims.note}, ${note.slice(0, 500)}::text)` })
      .where(and(inArray(seoGscClaims.id, claimIds), inArray(seoGscClaims.status, ["pending", "verified"])));
  },
  async readReport(auditId) {
    const [r] = await db
      .select({ id: seoAudits.id, url: seoAudits.url, domain: seoAudits.domain, status: seoAudits.status, gscProperty: seoAudits.gscProperty, result: seoAudits.result })
      .from(seoAudits)
      .where(eq(seoAudits.id, auditId))
      .limit(1);
    return r ? { ...r, result: r.result ?? null } : null;
  },
  async patchReport(auditId, patch, gscProperty, expectGeneratedAt) {
    const res = await db.execute(sql`
      update seo_audits
      set result = result || ${JSON.stringify(jsonbSafe(patch))}::jsonb,
          gsc_property = ${gscProperty}
      where id = ${auditId}
        and result is not null
        and status = 'complete'
        and (result->>'generatedAt') is not distinct from ${expectGeneratedAt}::text
      returning id
    `);
    return rowsOf(res).length > 0;
  },
  async setGscProperty(auditId, property) {
    await db.update(seoAudits).set({ gscProperty: property }).where(eq(seoAudits.id, auditId));
  },
  listSites: () => listSites(),
  pull: (property, domain) => pullGscData(property, domain),
  siteControl: (args) => checkSiteControl(args),
  async recompute(result, overrides) {
    // 动态引入:ranking.ts 很大,且只有真正写报告时才需要
    const { recomputeRankingFromResult } = await import("./ranking");
    return recomputeRankingFromResult(result, overrides);
  },
  async warn(name, message, meta) {
    await captureError({ name, message, route: ROUTE, source: "server", level: "warn", meta });
  },
};

/* ============================================================
   对外 API(路由与集成方用)
   ============================================================ */

/** GET 用:报告当前绑定的属性 + 当前用户在这份报告上的 claim(未登录为空) */
export async function getGscStatus(auditId: string, userId: string | null): Promise<{ property: string | null; ownClaims: GscClaimRecord[] }> {
  const [audit] = await db.select({ gscProperty: seoAudits.gscProperty }).from(seoAudits).where(eq(seoAudits.id, auditId)).limit(1);
  return { property: audit?.gscProperty ?? null, ownClaims: userId ? await dbPorts.ownClaims(auditId, userId) : [] };
}

/**
 * 匿名购买的报告(user_id 为空):第一个发起接入的登录用户认领它。单语句 CAS,
 * 返回 false = 已被别人认领(调用方重读后按 403 处理)。
 */
export async function claimReportOwnership(auditId: string, userId: string): Promise<boolean> {
  const res = await db
    .update(seoAudits)
    .set({ userId })
    .where(and(eq(seoAudits.id, auditId), isNull(seoAudits.userId)))
    .returning({ id: seoAudits.id });
  return res.length > 0;
}

export function startGscIntent(args: { auditId: string; userId: string; domain: string }): Promise<GscActionResult> {
  return intentWith(dbPorts, args);
}

export function verifyGscClaim(args: { auditId: string; userId: string; domain: string; entryUrl: string }): Promise<GscActionResult> {
  return verifyWith(dbPorts, args);
}

export function disconnectGsc(args: { auditId: string; userId: string }): Promise<GscActionResult> {
  return disconnectWith(dbPorts, args);
}

/** 给路由用的刷新(见 refreshWith)。重跑(run.ts)不走这里:它直接 pullGscData,失败沿用上一份 */
export function refreshGscForAudit(auditId: string): Promise<GscRefresh> {
  return refreshWith(dbPorts, auditId);
}
