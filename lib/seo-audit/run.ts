import { features } from "@/lib/env";
import { withCostLedger, summarizeCost, type CostEntry } from "@/lib/cost";
import { normalizeInput, assertPublicHost, SeoAuditError } from "./url";
import { sampleSitemapUrls, discoverSitemaps } from "./sitemap";
import { probeSite, crawlSiteDetailed, enrichProbe, fetchRobots, politeIntervalFor, type ProbeResult, type CrawlCoverage, type CrawlResult } from "./crawl";
import { runPsi, psiFailureIsFatal } from "./psi";
import { runAllOnsiteChecks } from "./checks";
import { scoreDimensions, overallScore, pickTopIssues, buildRoadmap } from "./score";
import { dfsEnabled, fetchAuthority, fetchVisibility, fetchCompetitors, paidChecks } from "./dataforseo";
import {
  DIMENSIONS,
  FREE_CRAWL_PAGES,
  FULL_CRAWL_PAGES,
  type AuthorityResult,
  type CompetitorsResult,
  type CrawledPage,
  type DimensionId,
  type DimensionScore,
  type PaidModuleId,
  type PsiResult,
  type SeoAuditProgress,
  type SeoAuditResult,
  type SeoAuditStage,
  type SeoCheck,
  type SeoPlan,
  type SiteProbe,
  type VisibilityResult,
} from "./types";

/* ============================================================
   SEO 审计编排 —— 免费轮零边际成本,付费轮才碰 DataForSEO。

   三条硬规矩:
   1. 付费 API 只在 plan === "full" 下调用(runPaidModules 的第一行就是这道门)。
      免费轮哪怕 DataForSEO 已配置也一次不调 —— 免费预览的成本必须是 0。
   2. 任何单个模块失败都不让整份报告失败:模块置 null、meta.notes 写明原因。
      用户等了 90 秒,拿到"抓了 20 页但 PSI 没回来"的报告,远好过一个 500。
   3. 全程一个共享 deadline(默认 250s,Vercel 函数上限 300s 留出落库余量):
      到点就停止等待,用手里已有的部分结果出报告,并在 meta.notes 注明。

   v2 两道前置门(V2-0):
   - probe.blocked.detected → meta.outcome="blocked":不跑 PSI、丢弃抓取,检查层全部 na,
     报告只解释"防火墙拦住了 AEOeyeBot,加白后重跑"。
   - probe.jsDependent → meta.outcome="limited":内容类检查基于原始 HTML,总分带 scoreNote。
   crawl.ts 的 probeSite 会填这两个字段(以它为准);抓取侧入口被拦(entryBlock)同样算 blocked。
   入口证书 / 握手失败(probe.entryError.kind === "tls")**不是** blocked:照常出一份报告,
   由 sec.https / sec.tls.expired 两道 gate 封顶(复审 C20)。

   付费模块(复审 C13/C14/C27/C41):refreshPaid → 三个全重拉(失败的退回上一份);否则沿用上一份里
   非 null 的模块;fillMissing → 只补上一份里为 null 的模块(missingPaidModules)。blocked 的运行
   绝不把已付费的模块清空。"kept from the previous run" 只在三个模块确实全部沿用时才写。
   ============================================================ */

export interface RunOpts {
  plan: SeoPlan;
  /** v1 契约:阶段名回调(保留) */
  onStage?: (stage: string) => void;
  /** v2:带百分比与已抓页数的完整进度帧,repo 把它落到 seo_audits.progress */
  onProgress?: (p: SeoAuditProgress) => void;
  /** 共享 deadline(毫秒),默认 250s */
  deadlineMs?: number;
  /** PSI 日配额:返回 false 表示今天额度已尽 —— 这次不跑 PSI、写 note,不拒绝运行 */
  psiQuota?: () => Promise<boolean>;
  /** 结果是从哪一行复制的(免费层缓存),原样写进 meta.cachedFrom */
  cachedFrom?: string | null;
  /** 付费重跑:不刷新 DataForSEO 时沿用上次的三模块(每次刷新都是真钱,上限 2 次)—— 只沿用非 null 的 */
  reusePaid?: PaidModules | null;
  /** 与 reusePaid 同用:reusePaid 里为 null 的模块这次补拉(只拉缺的,不碰已有的)(契约 1) */
  fillMissing?: boolean;
  /** refreshPaid 时传上一份的三模块:某模块这次刷新失败就退回旧值,blocked 时整体保留 —— 已付费的数据不能被 null 覆盖 */
  fallbackPaid?: PaidModules | null;
  /** 重跑:把上一次的分数记进 meta.notes("Previous score: N (date)"),UI 据此并列显示新旧分 */
  previousScore?: { score: number; date: string } | null;
}

export type UpgradeModule = "crawl40" | "psiDesktop" | "authority" | "visibility" | "competitors";

export interface UpgradeOpts {
  /** 每个模块一落地就回调 —— repo.mergeModule 立即落库,进程中途被杀时重试只补缺的模块 */
  onModule?: (name: UpgradeModule, patch: Partial<SeoAuditResult>) => void | Promise<void>;
  onStage?: (stage: string) => void;
  onProgress?: (p: SeoAuditProgress) => void;
  deadlineMs?: number;
  psiQuota?: () => Promise<boolean>;
}

export type PaidModules = {
  authority: AuthorityResult | null;
  visibility: VisibilityResult | null;
  competitors: CompetitorsResult | null;
};

export const PAID_MODULE_IDS: readonly PaidModuleId[] = ["authority", "visibility", "competitors"];

/** 报告与 UI(paid-sections 的 Unavailable 卡按这些标签找 note)统一用的模块名 */
const PAID_LABELS: Record<PaidModuleId, string> = {
  authority: "Authority & backlinks",
  visibility: "Search visibility",
  competitors: "Competitors",
};

const NO_PAID: PaidModules = { authority: null, visibility: null, competitors: null };

/**
 * 结果里值为 null 的付费模块(契约 1)。noData:true 的模块对象**不算**缺失 —— 那是
 * "DataForSEO 没有这个域名的数据"这一有效结论,补拉也还是它。
 */
export function missingPaidModules(result: Pick<SeoAuditResult, "authority" | "visibility" | "competitors">): PaidModuleId[] {
  return PAID_MODULE_IDS.filter((m) => result[m] == null);
}

/** 这次要拉哪些付费模块:没有可沿用的 → 全拉;fillMissing → 只拉沿用里为 null 的;否则一个不拉 */
export function paidModulesToFetch(reuse: PaidModules | null | undefined, fillMissing: boolean): PaidModuleId[] {
  if (!reuse) return [...PAID_MODULE_IDS];
  return fillMissing ? PAID_MODULE_IDS.filter((m) => reuse[m] == null) : [];
}

/**
 * 把"沿用 / 新拉 / 刷新失败的回退"合并成最终三模块,并按实际情况写 note:
 *   · 三个都沿用 → "…were kept from the previous run…"(只有这一种情况写这句);
 *   · 部分沿用 → 点名哪些沿用了;
 *   · 刷新失败退回旧值 → 点名;
 *   · 上一份就缺、这次也没补 → 点名(paid-sections 的 Unavailable 卡按模块名找到这句)。
 * 拉取失败本身的原因由 runPaidModules 写("<模块> module unavailable: …")。
 */
export function mergePaidModules(
  args: { reuse: PaidModules | null | undefined; fresh: PaidModules; fallback?: PaidModules | null; fetched: readonly PaidModuleId[] },
  notes: string[]
): PaidModules {
  const out: PaidModules = { ...NO_PAID };
  const kept: PaidModuleId[] = [];
  const refilled: PaidModuleId[] = [];
  const fellBack: PaidModuleId[] = [];
  const notFilled: PaidModuleId[] = [];
  const set = <K extends PaidModuleId>(m: K, v: PaidModules[K]) => {
    out[m] = v;
  };
  for (const m of PAID_MODULE_IDS) {
    const prev = args.reuse?.[m] ?? null;
    if (args.fetched.includes(m)) {
      const fresh = args.fresh[m] ?? null;
      const fb = args.fallback?.[m] ?? null;
      if (fresh !== null) {
        set(m, fresh);
        if (args.reuse) refilled.push(m);
      } else if (fb !== null) {
        set(m, fb);
        fellBack.push(m);
      }
      continue;
    }
    if (prev !== null) {
      set(m, prev);
      kept.push(m);
    } else if (args.reuse) notFilled.push(m);
  }
  const names = (ms: PaidModuleId[]) => ms.map((m) => PAID_LABELS[m]).join(", ");
  if (args.reuse && kept.length === PAID_MODULE_IDS.length) {
    notes.push("Authority, rankings and competitor data were kept from the previous run (paid data refreshes are limited to 2 per report).");
  } else if (kept.length) {
    // 只点名真正补到的模块;补拉失败的由 runPaidModules 的 "module unavailable" 说明(它排在前面,Unavailable 卡先找到它)
    const filled = refilled.length ? `; ${names(refilled)} ${refilled.length > 1 ? "were" : "was"} fetched because ${refilled.length > 1 ? "they were" : "it was"} missing` : "";
    notes.push(`${names(kept)} data were reused from the previous run${filled}.`);
  }
  for (const m of fellBack) notes.push(`${PAID_LABELS[m]} could not be refreshed on this run; the previous data are shown.`);
  for (const m of notFilled) notes.push(`${PAID_LABELS[m]} module has no data from an earlier run, and it was not fetched again on this run.`);
  return out;
}

/**
 * 被拦的完整版运行:不调 DataForSEO,但**绝不清空**已付费的模块(复审 C13/C26)——
 * 有上一份的就原样保留(沿用或刷新的兜底都算),没有才是三个 null。
 */
export function paidOnBlockedRun(opts: Pick<RunOpts, "reusePaid" | "fallbackPaid">, notes: string[]): PaidModules {
  const keep = opts.reusePaid ?? opts.fallbackPaid ?? null;
  if (keep) {
    notes.push("DataForSEO modules were not refreshed because the crawler was blocked; the paid data from the previous run were kept. Allow AEOeyeBot and re-run.");
    return { authority: keep.authority ?? null, visibility: keep.visibility ?? null, competitors: keep.competitors ?? null };
  }
  notes.push("Authority, rankings and competitor modules were skipped because the crawler was blocked; allow AEOeyeBot and re-run.");
  return { ...NO_PAID };
}

/** 时间预算(毫秒)。共享 deadline 250s;各模块自己的上限只是在 deadline 之内再收紧 */
export const RUN_DEADLINE_MS = 250_000;
const PROBE_TIMEOUT_MS = 30_000;
/**
 * 探针最坏要对同一主机发 ~25 个请求,还要和并行的抓取共用同一个令牌桶 —— Crawl-delay 2s 时
 * 光排队就要一分多钟。探针超时会让整次审计失败,所以上限按实际间隔放宽(复审 C40 的连带后果)。
 */
const PROBE_SLOTS = 45;

/** 探针的超时:默认 30s;Crawl-delay 让间隔变大时按 45 个请求槽放宽,但给后续阶段留出 30s */
export function probeTimeoutFor(intervalMs: number, remainingMs: number): number {
  const wanted = Math.max(PROBE_TIMEOUT_MS, intervalMs * PROBE_SLOTS);
  return Math.max(5_000, Math.min(wanted, remainingMs - 30_000));
}
const FREE_CRAWL_BUDGET_MS = 45_000;
const FULL_CRAWL_BUDGET_MS = 60_000;
const PSI_TIMEOUT_MS = 65_000;
/** V2-0:付费模块各自 60s 超时 */
const DFS_MODULE_TIMEOUT_MS = 60_000;
/** 供"孤页信号"抽样的 sitemap URL 数 */
const SITEMAP_SAMPLE = 20;
/** 抓到的页数低于此值时 Architecture 维度标低置信(V2-0) */
const LOW_CONFIDENCE_PAGES = 5;

/** 统一构造引擎错误 —— 只在这一处依赖 SeoAuditError 的构造签名 */
function fail(code: SeoAuditError["code"], message: string): SeoAuditError {
  return new SeoAuditError(code, message);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 已经是引擎错误就原样抛(它带着准确的 code 与用户文案);否则包成指定 code */
function asAuditError(e: unknown, code: SeoAuditError["code"], message: string): SeoAuditError {
  return e instanceof SeoAuditError ? e : fail(code, `${message} (${errMsg(e)})`);
}

/* ---------- 共享 deadline ---------- */

export interface Deadline {
  /** 绝对时间戳(ms) */
  at: number;
  /** 到点时 abort —— 传给任何接受 AbortSignal 的下游 */
  signal: AbortSignal;
  remaining(): number;
  expired(): boolean;
  /** 释放定时器(运行结束时调用,避免拖住进程) */
  dispose(): void;
}

export function createDeadline(ms: number, now: number = Date.now()): Deadline {
  const at = now + Math.max(1_000, ms);
  const controller = new AbortController();
  // 刻意**不** unref:等待中的下游若只剩这个定时器在撑着事件循环,unref 会让进程在 deadline
  // 之前就退出(node:test 里实测如此)。运行结束时 dispose() 清掉它,不会拖住进程。
  const timer = setTimeout(() => controller.abort(new Error("deadline")), Math.max(0, at - Date.now()));
  return {
    at,
    signal: controller.signal,
    remaining: () => Math.max(0, at - Date.now()),
    expired: () => Date.now() >= at,
    dispose: () => clearTimeout(timer),
  };
}

/**
 * 外层超时。底层 promise 不会被取消(fetch 已各自带 AbortSignal),这里只保证编排层
 * 不会被某个模块拖过预算 —— 报告晚 20 秒出,就有一部分用户关掉页面。
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * 到 deadline 就不再等:有 fallback 则用它继续(部分结果),没有则按超时拒绝。
 * 下游 promise 之后才回来的结果直接丢弃 —— 报告已经在出了。
 */
export function untilDeadline<T>(p: Promise<T>, deadline: Deadline, label: string, fallback?: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      deadline.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      if (fallback) resolve(fallback());
      else reject(new Error(`${label} stopped at the run deadline`));
    };
    if (deadline.expired()) {
      onAbort();
      return;
    }
    deadline.signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        if (settled) return;
        finish();
        resolve(v);
      },
      (e) => {
        if (settled) return;
        finish();
        reject(e);
      }
    );
  });
}

/* ---------- 进度 ---------- */

/**
 * 阶段顺序(契约 3,与报告页 SeoProgress 的 ORDER 一致):抓后补全是 "verifying",
 * 不能回退成 "probing";付费三阶段只在完整版运行里出现。
 */
export const SEO_STAGE_ORDER: readonly SeoAuditStage[] = ["queued", "probing", "crawling", "pagespeed", "verifying", "authority", "visibility", "competitors", "scoring", "done"];

/** 经验百分比:queued 0 → probing 8 → crawling 15–60(按页数)→ pagespeed 70 → verifying 76 → authority 79 → visibility 82 → competitors 86 → scoring 90 → done 100 */
export function percentFor(stage: SeoAuditStage, pagesCrawled = 0, maxPages = FREE_CRAWL_PAGES): number {
  switch (stage) {
    case "queued":
      return 0;
    case "probing":
      return 8;
    case "crawling": {
      const share = maxPages > 0 ? Math.min(1, pagesCrawled / maxPages) : 0;
      return Math.round(15 + 45 * share);
    }
    case "pagespeed":
      return 70;
    case "verifying":
      return 76;
    case "authority":
      return 79;
    case "visibility":
      return 82;
    case "competitors":
      return 86;
    case "scoring":
      return 90;
    case "done":
      return 100;
    default:
      return 0;
  }
}

type Emit = (stage: SeoAuditStage, extra?: { pagesCrawled?: number; message?: string }) => void;

/**
 * 进度帧发射器 —— **单调**:阶段只前进不后退(并行的抓取回调晚到时只更新页数),百分比只增不减。
 * 升级路径里付费模块与 40 页抓取并行,"authority" 之后还会收到 "crawling" 的页数回调。
 */
export function progressEmitter(opts: Pick<RunOpts, "onStage" | "onProgress">, maxPages: number): Emit {
  const startedAt = new Date().toISOString();
  let pagesCrawled = 0;
  let current: SeoAuditStage | null = null;
  let rank = -1;
  let percent = 0;
  return (next, extra) => {
    if (typeof extra?.pagesCrawled === "number") pagesCrawled = Math.max(pagesCrawled, extra.pagesCrawled);
    const r = SEO_STAGE_ORDER.indexOf(next);
    if (r >= rank) {
      rank = r;
      current = next;
    }
    const stage = current ?? next;
    percent = Math.max(percent, percentFor(stage, pagesCrawled, maxPages));
    const frame: SeoAuditProgress = {
      stage,
      percent,
      pagesCrawled,
      startedAt,
      updatedAt: new Date().toISOString(),
      ...(extra?.message ? { message: extra.message } : {}),
    };
    try {
      opts.onStage?.(stage);
      opts.onProgress?.(frame);
    } catch {
      /* 进度回调失败不影响运行 */
    }
  };
}

/* ---------- 前置门推断 ---------- */

const WAF_SERVER = /cloudflare|akamai|imperva|incapsula|sucuri|ddos-guard|barracuda|bigip|f5|fortiweb|awselb|aws waf|radware|stackpath|kasada|datadome|perimeterx/i;
const CHALLENGE_TITLE =
  /just a moment|attention required|access denied|security check|verify you are (a )?human|checking your browser|pardon our interruption|request blocked|are you a robot|one more step|bot detection|human verification|403 forbidden/i;
const TLS_ERROR = /certificate|CERT_|TLS|SSL|handshake|self.signed|UNABLE_TO_VERIFY|ERR_TLS/i;

/**
 * WAF / 挑战页 / 403 拦截。crawl.ts 填了 probe.blocked 就以它为准;否则按入口响应推断:
 * 401/403 → forbidden;429 → rate-limited;503 且 server 头是已知 WAF、或入口页标题是挑战页文案 → challenge。
 * TLS 握手失败**不是**拦截(复审 C20):返回 detected:false(kind 仍标 "tls" 供证据引用),
 * 由 sec.https / sec.tls.expired 的 gate 处理 —— 证书坏了所有访客和 Googlebot 都进不来,
 * 不能对站长说"这不是 SEO 问题,把我们加白就行"。
 */
export function deriveBlocked(probe: Pick<ProbeResult, "entry" | "headers" | "entryUrl"> & { blocked?: SiteProbe["blocked"] }, entryPage?: CrawledPage | null): NonNullable<SiteProbe["blocked"]> {
  if (probe.blocked) return probe.blocked;
  const entry = probe.entry;
  const status = entry?.status ?? 0;
  const server = probe.headers?.server ?? "";
  const title = entryPage?.title ?? "";
  const where = entry?.finalUrl || probe.entryUrl;

  if (entry?.error && TLS_ERROR.test(entry.error)) {
    return { detected: false, kind: "tls", evidence: `TLS handshake with ${where} failed: ${entry.error}` };
  }
  if (status === 429) {
    return { detected: true, kind: "rate-limited", evidence: `HTTP 429 from ${where} on the very first request.` };
  }
  if (status === 401 || status === 403) {
    return { detected: true, kind: "forbidden", evidence: `HTTP ${status} from ${where}${server ? ` (server: ${server})` : ""}.` };
  }
  if (CHALLENGE_TITLE.test(title) && (status === 200 || status === 503 || status === 405 || status === 406)) {
    return { detected: true, kind: "challenge", evidence: `The entry page returned HTTP ${status} with the title "${clip(title, 80)}"${server ? ` (server: ${server})` : ""} — a bot challenge page, not your content.` };
  }
  if ((status === 503 || status === 405 || status === 406) && WAF_SERVER.test(server)) {
    return { detected: true, kind: "challenge", evidence: `HTTP ${status} from ${where} served by ${server} — typical of a firewall challenge.` };
  }
  return { detected: false, kind: null, evidence: "" };
}

/** 截断但不劈开代理对(半个 emoji 会让 jsonb 拒收整份结果) */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const c = s.charCodeAt(max - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? max - 1 : max);
}

/**
 * 两路的拦截结论合并:探针看到的,或抓取侧入口被拦(两边并行,谁先撞上都算 —— 抓取侧的拦截页
 * 不会入库,不合并的话 crawl.entry.status 会因为我们自己被限流而 gate fail,复审 C19)。
 */
export function mergeBlocked(fromProbe: NonNullable<SiteProbe["blocked"]>, crawlEntryBlock: CrawlResult["entryBlock"] | null | undefined): NonNullable<SiteProbe["blocked"]> {
  if (fromProbe.detected || !crawlEntryBlock) return fromProbe;
  return { detected: true, kind: crawlEntryBlock.kind, evidence: crawlEntryBlock.evidence };
}

/**
 * JS 渲染依赖:crawl.ts 填了 probe.jsDependent 就以它为准;否则看入口页的原始 HTML ——
 * parse 给了 jsShell 用 jsShell,没有则用保守启发式(有一定体积的 HTML 却几乎没有词与内链)。
 * 入口页拿不到时返回 undefined(检查层会标 na,不猜)。
 */
export function deriveJsDependent(probe: { jsDependent?: boolean }, entryPage?: CrawledPage | null): boolean | undefined {
  if (typeof probe.jsDependent === "boolean") return probe.jsDependent;
  if (!entryPage || entryPage.status < 200 || entryPage.status >= 300) return undefined;
  if (typeof entryPage.jsShell === "boolean") return entryPage.jsShell;
  return entryPage.wordCount < 80 && entryPage.internalLinks < 3 && entryPage.bytes > 4096;
}

/* ---------- PSI ---------- */

export interface PsiDeps {
  /** 测试注入用:替代 runPsi */
  run?: typeof runPsi;
  /** 测试注入用:替代 features.psi */
  enabled?: boolean;
  /** 测试注入用:重试前的退避(默认 3s) */
  retryDelayMs?: number;
}

/**
 * PSI:缺 key、日配额用尽或失败都回 null 并写一条 note,由检查层把 performance/mobile 标 na。
 * 刻意不把带 error 的空 PsiResult 往下传 —— null 是契约里唯一的"没有数据"信号。
 * 失败重试 1 次(退避 3s,V2-0),超时不重试(再来一次也是超时),4xx / 未配置不重试。
 * 复审 C44:runPsi 以 retries: 0 调用 —— 重试**只在这一层**做,而且重试本身再扣一次日配额
 * (配额说不行就不重试),这样 seo_quota 记的就是真实请求数,外层超时后也不会有内层的第二次请求在后台白跑。
 */
export async function psiOrNull(
  url: string,
  strategy: "mobile" | "desktop",
  notes: string[],
  deadline: Deadline,
  quota?: () => Promise<boolean>,
  deps: PsiDeps = {}
): Promise<PsiResult | null> {
  if (!(deps.enabled ?? features.psi)) {
    notes.push(`PageSpeed Insights is not configured; ${strategy} performance and accessibility checks are marked n/a.`);
    return null;
  }
  if (quota) {
    const allowed = await quota().catch(() => true);
    if (!allowed) {
      notes.push(`Daily PageSpeed Insights budget reached; ${strategy} performance and mobile checks are marked n/a for this run. Re-run tomorrow for Core Web Vitals.`);
      return null;
    }
  }
  const run = deps.run ?? runPsi;
  const attempt = async (): Promise<PsiResult> => {
    const timeoutMs = Math.max(5_000, Math.min(PSI_TIMEOUT_MS, deadline.remaining() - 2_000));
    return withTimeout(run(url, strategy, { timeoutMs, retries: 0 }), timeoutMs + 1_000, `PageSpeed Insights (${strategy})`);
  };
  try {
    let r = await attempt();
    if (r.error && !/timed out/i.test(r.error) && !psiFailureIsFatal(r) && deadline.remaining() > 20_000) {
      // 重试也是一次真实请求:同样要过日配额
      const allowed = quota ? await quota().catch(() => true) : true;
      if (allowed) {
        await new Promise((res) => setTimeout(res, deps.retryDelayMs ?? 3_000));
        const again = await attempt();
        if (!again.error) r = again;
      }
    }
    if (r.error) {
      notes.push(`PageSpeed Insights (${strategy}) returned no data: ${r.error}`);
      return null;
    }
    return r;
  } catch (e) {
    notes.push(`PageSpeed Insights (${strategy}) failed: ${errMsg(e)}`);
    return null;
  }
}

/** 入口 4 个变体里至少有一个给了 HTTP 响应 —— 否则整站不可达 */
function entryReachable(probe: SiteProbe): boolean {
  return probe.variants.some((v) => typeof v.status === "number" && v.status > 0);
}

function pickEntry(pages: CrawledPage[]): CrawledPage | null {
  return pages.find((p) => p.depth === 0) ?? pages[0] ?? null;
}

function safeSitemapSample(probe: SiteProbe): string[] {
  try {
    return sampleSitemapUrls(probe.sitemaps, SITEMAP_SAMPLE);
  } catch {
    return [];
  }
}

/* ---------- 抓取 ---------- */

/**
 * robots 用 crawl.ts 自己的 fetchRobots(与探针同一套解析),再交给 crawlSite。
 * 抓取预算收在 deadline 之内:crawlSite 自己会在预算耗尽时带着已抓页面返回,
 * 这样 deadline 到点时手里是部分结果而不是空。
 */
type CrawlOutcome = { pages: CrawledPage[]; coverage: CrawlCoverage | null; intervalMs?: number; entryBlock?: CrawlResult["entryBlock"] };

async function crawlWithinDeadline(
  entryUrl: string,
  origin: string,
  maxPages: number,
  budgetMs: number,
  deadline: Deadline,
  onProgress?: (n: number) => void,
  knownRobots?: Awaited<ReturnType<typeof fetchRobots>> | null
): Promise<CrawlOutcome> {
  const robots = knownRobots ?? (await fetchRobots(origin));
  const budget = Math.max(5_000, Math.min(budgetMs, deadline.remaining() - 10_000));
  // crawlSiteDetailed = 导航 BFS + sitemap 分层抽样(覆盖不同模板)+ 礼貌间隔 + 早停,
  // 并带回 coverage、实际请求间隔(含 Crawl-delay,补全阶段沿用)与入口拦截
  const r = await crawlSiteDetailed(entryUrl, { maxPages, robots, timeBudgetMs: budget, onProgress });
  return { pages: r.pages, coverage: r.coverage, intervalMs: r.intervalMs, entryBlock: r.entryBlock };
}

/**
 * 抓后补全:需要"抓取集合"才能做的探针(sitemap 抽样可收录性、canonical 目标、断链、失效外链、
 * 大图、og:image、跨页 TTFB、coverage)。失败只记 note,绝不让整次审计失败。
 */
async function enrichWithinDeadline(
  probe: ProbeResult,
  pages: CrawledPage[],
  coverage: CrawlCoverage | null,
  deadline: Deadline,
  notes: string[],
  intervalMs?: number
): Promise<void> {
  const budget = Math.min(25_000, deadline.remaining() - 8_000);
  if (budget < 4_000) {
    notes.push("Post-crawl probes (sitemap sample, broken links, image sizes) were skipped: not enough time left.");
    return;
  }
  try {
    // 同主机间隔沿用抓取实际用的(Crawl-delay ≤2s 照做),不能退回默认 250ms(复审 C40)
    await enrichProbe(probe, pages, { timeBudgetMs: budget, coverage: coverage ?? undefined, minIntervalMs: intervalMs });
  } catch (e) {
    notes.push(`Post-crawl probes did not finish: ${errMsg(e)}.`);
  }
}

/* ---------- 付费模块 ---------- */

/**
 * vis.index-ratio 需要 sitemap 条数:只累加**叶子**文件(复审 C18)。索引行的 urlCount 是它已抓取
 * 子文件的汇总,子文件行也在同一个数组里 —— 两者都加就把同一批 URL 算了两遍。
 * 注意:索引最多只展开前 5 个子文件,子文件更多时这是下界。
 */
export function sitemapUrlCount(probe: Pick<SiteProbe, "sitemaps"> | null | undefined): number | null {
  const all = probe?.sitemaps ?? [];
  const leaves = all.filter((x) => x.valid && !x.isIndex && x.urlCount > 0);
  if (leaves.length === 0) return null;
  // 索引里列了比我们实际读到的更多子文件(只展开前 5 个)→ 合计只是下界。
  // 拿下界当分母会把"收录比"算高,可能把一个真实偏低的站判成通过;宁可让 vis.index-ratio 标"未测"。
  const fetched = new Set(all.filter((x) => !x.isIndex).map((x) => x.url));
  const incomplete = all.some((x) => x.isIndex && x.children.some((c) => !fetched.has(c)));
  if (incomplete) return null;
  return leaves.reduce((a, x) => a + x.urlCount, 0);
}

interface PaidRunOpts {
  /** 每个模块一落地就回调(升级路径用它立即落库) */
  onModule?: UpgradeOpts["onModule"];
  visOpts?: { sitemapUrls?: number | null; brandTokens?: string[] };
  /** 只拉这些模块;其余不发请求、不写 note、不回调,返回 null 由调用方用已有值合并(复审 C14/C41) */
  only?: readonly PaidModuleId[];
  /** 某个模块有了结论(成功或失败)—— 进度阶段据此推进 */
  onSettled?: (m: PaidModuleId) => void;
}

/**
 * 站外三模块。**硬门**:plan 不是 full 一律不调 —— 这行不是防御式编程,是成本红线。
 * 并行,单个失败降级为 null + note,绝不让付费报告整体失败(用户已经付了钱)。
 * only 指定时只拉列出的模块 —— 已经到手的模块绝不重复付费。
 */
async function runPaidModules(plan: SeoPlan, domain: string, notes: string[], opts: PaidRunOpts = {}): Promise<PaidModules> {
  const empty: PaidModules = { ...NO_PAID };
  if (plan !== "full") return empty;
  const wanted = new Set<PaidModuleId>(opts.only ?? PAID_MODULE_IDS);
  if (wanted.size === 0) return empty;
  if (!features.seoAuditPaid || !dfsEnabled()) {
    notes.push("DataForSEO is not configured; authority, rankings and competitor modules are unavailable for this report.");
    return empty;
  }
  const persist = async (name: UpgradeModule, patch: Partial<SeoAuditResult>) => {
    try {
      await opts.onModule?.(name, patch);
    } catch (e) {
      notes.push(`Could not persist the ${name} module immediately (${errMsg(e)}); it is included in the final save.`);
    }
  };
  const settled = (m: PaidModuleId) => {
    try {
      opts.onSettled?.(m);
    } catch {
      /* 进度回调失败不影响运行 */
    }
  };
  const run = <T,>(m: PaidModuleId, load: () => Promise<T>, patch: (r: T) => Partial<SeoAuditResult>): Promise<T | null> | null => {
    // 不在 only 里的模块:不发请求(真钱)、不写 note、不回调
    if (!wanted.has(m)) return null;
    return withTimeout(load(), DFS_MODULE_TIMEOUT_MS, PAID_LABELS[m])
      .then(async (r) => {
        await persist(m, patch(r));
        return r;
      })
      .finally(() => settled(m));
  };
  const tasks = {
    authority: run("authority", () => fetchAuthority(domain), (r) => ({ authority: r })),
    visibility: run("visibility", () => fetchVisibility(domain, opts.visOpts), (r) => ({ visibility: r })),
    competitors: run("competitors", () => fetchCompetitors(domain), (r) => ({ competitors: r })),
  };
  const [a, v, c] = await Promise.allSettled([tasks.authority ?? Promise.resolve(null), tasks.visibility ?? Promise.resolve(null), tasks.competitors ?? Promise.resolve(null)]);
  const settle = <T,>(r: PromiseSettledResult<T | null>, m: PaidModuleId): T | null => {
    if (r.status === "fulfilled") return r.value;
    notes.push(`${PAID_LABELS[m]} module unavailable: ${errMsg(r.reason)}`);
    return null;
  };
  return {
    authority: settle(a, "authority"),
    visibility: settle(v, "visibility"),
    competitors: settle(c, "competitors"),
  };
}

/** 账本里 DataForSEO 的实测美元与调用次数(其他供应商在这条产品线上没有花费) */
function costFromEntries(entries: CostEntry[]): SeoAuditResult["cost"] {
  const s = summarizeCost(entries);
  const dfs = s.byProvider.find((p) => p.provider === "dataforseo");
  return { dataforseoUsd: dfs?.usd ?? 0, calls: dfs?.calls ?? 0 };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/* ---------- 计分收尾 ---------- */

type Scored = Pick<SeoAuditResult, "overall" | "dimensions" | "checks" | "topIssues" | "roadmap"> & {
  blockers: string[];
  scoreNote: string;
};

/** 检查 + 计分 + 路线图:免费与付费两条路径共用的收尾 */
function assemble(args: {
  plan: SeoPlan;
  probe: SiteProbe;
  pages: CrawledPage[];
  psi: SeoAuditResult["psi"];
  paid: PaidModules;
  domain: string;
}): Scored {
  const ctx = {
    probe: args.probe,
    pages: args.pages,
    entry: pickEntry(args.pages),
    psi: args.psi,
    sitemapSample: safeSitemapSample(args.probe),
  };
  let checks: SeoCheck[] = runAllOnsiteChecks(ctx);
  if (args.plan === "full") {
    checks = checks.concat(paidChecks(args.paid.authority, args.paid.visibility, args.paid.competitors, args.domain));
  }
  const unlocked = args.plan === "full";
  const dimensions = scoreDimensions(checks, { unlocked });
  // 付费三维度的分数用各模块自己的公式分(dataforseo.ts 里有文档),不用"检查项加权"——
  // competitors 只有 1 条计分检查,按 <3 条规则永远是 "Insufficient data";authority 两套分还会打架。
  // 站内 7 维与总分不受影响(付费维度 weight=0,从不进总分)。
  if (unlocked) {
    const modules: Record<string, { score: number; noData?: boolean } | null> = {
      authority: args.paid.authority,
      visibility: args.paid.visibility,
      competitors: args.paid.competitors,
    };
    for (const d of dimensions) {
      if (!(d.id in modules)) continue;
      const m = modules[d.id];
      if (!m) {
        d.score = null;
        d.summary = "This module could not be loaded — re-run to retry.";
      } else if (m.noData) {
        d.score = null;
        d.summary = "Not enough data for this domain yet.";
      } else {
        d.score = Math.max(0, Math.min(100, Math.round(m.score)));
      }
    }
  }
  const o = overallScore(dimensions, checks);
  const topIssues = pickTopIssues(checks, 3);
  // 路线图始终构建:免费视图由 toPublicView 只留三桶计数 + 第 1 项(V2-3 ⑥),这里给 null 免费版就没有骨架可展示
  const roadmap = buildRoadmap(checks, args.pages);
  return {
    overall: { score: o.score, grade: o.grade },
    dimensions,
    checks,
    topIssues,
    roadmap,
    blockers: o.blockers ?? checks.filter((c) => c.gate && c.status === "fail").map((c) => c.id),
    scoreNote: o.scoreNote ?? "",
  };
}

/** 样本量与低置信维度(V2-0:抓到 <5 页时 Architecture 低置信;score=null 的站内维度 = 未测量) */
export function confidenceFor(dimensions: DimensionScore[], pages: CrawledPage[]): NonNullable<SeoAuditResult["meta"]["confidence"]> {
  const unmeasured = dimensions.filter((d) => !DIMENSIONS[d.id]?.paid && d.score === null).map((d) => d.id);
  const lowConfidence: DimensionId[] = [];
  if (pages.length < LOW_CONFIDENCE_PAGES && !unmeasured.includes("architecture")) lowConfidence.push("architecture");
  return { pagesSampled: pages.length, lowConfidence, unmeasured };
}

function outcomeNote(outcome: NonNullable<SeoAuditResult["meta"]["outcome"]>, blocked: NonNullable<SiteProbe["blocked"]>): string | null {
  if (outcome === "blocked") {
    // 旧数据里可能还有 kind=tls 的 blocked:那是证书问题,不能叫站长去加白爬虫
    if (blocked.kind === "tls") {
      return `The HTTPS certificate or TLS handshake failed (${blocked.evidence}). Browsers and Googlebot hit the same error. Fix the certificate, then re-run.`;
    }
    return `Our crawler was blocked before it could read the site (${blocked.kind ?? "unknown"}: ${blocked.evidence}). No score is given. Allow the user agent AEOeyeBot (see https://aeoeye.com/bot) and re-run.`;
  }
  if (outcome === "limited") {
    return "The entry page depends on JavaScript to render its content. Content checks are based on the raw HTML Google fetches first; scores for those checks may improve once you server-render or pre-render the page.";
  }
  return null;
}

/* ============================================================
   runSeoAudit
   ============================================================ */

/**
 * 跑一次审计。
 *   free:probe ∥ crawl(20) ∥ PSI mobile → 站内检查 → 计分
 *   full:probe ∥ crawl(40) ∥ PSI mobile → 站外三模块 ∥ PSI desktop → 全部检查 → 计分 + 路线图
 * 三路并行、共享 deadline;probe 失败才整体失败(站点不可达),其余模块失败只降级。
 * 全程包在成本账本里,结束时把 DataForSEO 实测花费写进 result.cost。
 */
export async function runSeoAudit(input: string, opts: RunOpts): Promise<SeoAuditResult> {
  const started = Date.now();
  const plan = opts.plan;
  const deadline = createDeadline(opts.deadlineMs ?? RUN_DEADLINE_MS, started);
  const { entryUrl, origin, host, domain } = normalizeInput(input);
  await assertPublicHost(host);

  const maxPages = plan === "full" ? FULL_CRAWL_PAGES : FREE_CRAWL_PAGES;
  const crawlBudget = plan === "full" ? FULL_CRAWL_BUDGET_MS : FREE_CRAWL_BUDGET_MS;
  const emit = progressEmitter(opts, maxPages);

  try {
    const { result, entries } = await withCostLedger(async () => {
      const notes: string[] = [];
      emit("probing");

      let psiDone = false;
      let crawlDone = false;
      const psiTask = psiOrNull(entryUrl, "mobile", notes, deadline, opts.psiQuota).finally(() => {
        psiDone = true;
      });
      // robots 只取一次,探针与抓取共用:Crawl-delay 从第一个请求起就对两边生效(复审 C40)。
      // fetchRobots 不抛(safeFetch 把失败当数据返回),catch 只是兜底。
      const robotsTask = fetchRobots(origin).catch(() => null);
      const crawlTask = robotsTask
        .then((robots) => crawlWithinDeadline(entryUrl, origin, maxPages, crawlBudget, deadline, (n) => emit("crawling", { pagesCrawled: n }), robots))
        .finally(() => {
          crawlDone = true;
          if (!psiDone) emit("pagespeed");
        });
      const probeTask = robotsTask
        .then((robots) =>
          withTimeout(
            probeSite(entryUrl, robots ? { robots } : {}),
            probeTimeoutFor(politeIntervalFor(robots).intervalMs, deadline.remaining()),
            "Site probe"
          )
        )
        .then((p) => {
          if (!crawlDone) emit("crawling");
          return p;
        });

      const [probeS, crawlS, psiS] = await Promise.allSettled([
        probeTask,
        untilDeadline(crawlTask, deadline, "Crawl", (): CrawlOutcome => ({ pages: [], coverage: null })),
        untilDeadline(psiTask, deadline, "PageSpeed Insights", () => null),
      ]);

      if (probeS.status === "rejected") {
        throw asAuditError(probeS.reason, "unreachable", `We couldn't reach ${host}. Check the URL and that the site is online.`);
      }
      const probe: ProbeResult = probeS.value;

      let pages: CrawledPage[] = [];
      let coverage: CrawlCoverage | null = null;
      let intervalMs: number | undefined;
      let crawlEntryBlock: CrawlResult["entryBlock"] = null;
      if (crawlS.status === "fulfilled") {
        pages = crawlS.value.pages;
        coverage = crawlS.value.coverage;
        intervalMs = crawlS.value.intervalMs;
        crawlEntryBlock = crawlS.value.entryBlock ?? null;
      } else {
        notes.push(`Crawl did not finish: ${errMsg(crawlS.reason)}. Page-level checks are limited.`);
      }

      // 前置门 ①:防火墙 / 挑战页 —— 探针看到的,或抓取侧入口被拦。抓到的"页面"是挑战页,不能当内容评
      const blocked = mergeBlocked(deriveBlocked(probe, pickEntry(pages)), crawlEntryBlock);
      probe.blocked = blocked;
      let outcome: NonNullable<SeoAuditResult["meta"]["outcome"]> = "complete";
      let psiMobile: PsiResult | null = psiS.status === "fulfilled" ? psiS.value : null;
      if (blocked.detected) {
        outcome = "blocked";
        pages = [];
        psiMobile = null;
      } else {
        // 入口证书 / 握手失败:不是"站点不可达",照常出报告,让 sec.https / sec.tls.expired 两道 gate 封顶(复审 C20)
        const tlsBroken = probe.entryError?.kind === "tls";
        if (pages.length === 0 && !tlsBroken) {
          if (!entryReachable(probe)) {
            throw fail("unreachable", `${host} did not respond to any request. Make sure the site is online and publicly reachable.`);
          }
          notes.push("The crawler could not fetch any HTML page; on-page, content and architecture checks are based on the probe only.");
        }
        if (tlsBroken) {
          notes.push(`The HTTPS connection to ${host} failed (${clip(probe.entryError?.message ?? "TLS error", 200)}), so no page could be read. Browsers and Googlebot hit the same error — fix the certificate, then re-run.`);
        }
        // 前置门 ②:JS 渲染依赖
        const jsDependent = deriveJsDependent(probe, pickEntry(pages));
        if (typeof jsDependent === "boolean") probe.jsDependent = jsDependent;
        if (jsDependent) outcome = "limited";
        // 抓后补全探针(只对没被拦的站做;抓取被叫停时同主机探针也不做)—— 阶段是 verifying,不回退成 probing(复审 C17)
        emit("verifying");
        await enrichWithinDeadline(probe, pages, coverage, deadline, notes, intervalMs);
      }
      if (deadline.expired()) {
        notes.push(`The audit reached its ${Math.round((opts.deadlineMs ?? RUN_DEADLINE_MS) / 1000)}s time limit; results are based on what was collected before that.`);
      }

      const psi: SeoAuditResult["psi"] = { mobile: psiMobile, desktop: null };

      let paid: PaidModules = { ...NO_PAID };
      if (plan === "full" && outcome !== "blocked") {
        const reuse = opts.reusePaid ?? null;
        const toFetch = paidModulesToFetch(reuse, opts.fillMissing === true);
        // 进度:authority → visibility → competitors 按"已有结论的模块数"推进(沿用的模块算已完成)
        const stages: SeoAuditStage[] = ["authority", "visibility", "competitors"];
        let settledCount = PAID_MODULE_IDS.length - toFetch.length;
        emit("authority");
        for (let i = 1; i <= Math.min(2, settledCount); i++) emit(stages[i]);
        const onSettled = () => {
          settledCount++;
          emit(stages[Math.min(2, settledCount)]);
        };
        const [fresh, psiDesktop] = await Promise.all([
          toFetch.length
            ? runPaidModules(plan, domain, notes, { visOpts: { sitemapUrls: sitemapUrlCount(probe) }, only: toFetch, onSettled })
            : Promise.resolve<PaidModules>({ ...NO_PAID }),
          untilDeadline(psiOrNull(entryUrl, "desktop", notes, deadline, opts.psiQuota), deadline, "PageSpeed Insights (desktop)", () => null),
        ]);
        paid = mergePaidModules({ reuse, fresh, fallback: opts.fallbackPaid ?? null, fetched: toFetch }, notes);
        psi.desktop = psiDesktop;
      } else if (plan === "full") {
        paid = paidOnBlockedRun(opts, notes);
      }

      emit("scoring");
      const scored = assemble({ plan, probe, pages, psi, paid, domain });
      const note = outcomeNote(outcome, blocked);
      if (note) notes.unshift(note);
      if (opts.previousScore) {
        notes.unshift(`Previous score: ${opts.previousScore.score} (${opts.previousScore.date})`);
      }

      const out: SeoAuditResult = {
        version: 1,
        plan,
        input,
        entryUrl,
        domain,
        generatedAt: new Date().toISOString(),
        durationMs: 0,
        overall: scored.overall,
        dimensions: scored.dimensions,
        checks: scored.checks,
        topIssues: scored.topIssues,
        roadmap: scored.roadmap,
        pages,
        probe,
        psi,
        authority: paid.authority,
        visibility: paid.visibility,
        competitors: paid.competitors,
        cost: { dataforseoUsd: 0, calls: 0 },
        meta: {
          pagesCrawled: pages.length,
          pagesRequested: maxPages,
          crawlLimited: pages.length >= maxPages,
          notes,
          lockedSections: [],
          outcome,
          blockers: scored.blockers,
          confidence: confidenceFor(scored.dimensions, pages),
          scoreNote: scored.scoreNote,
          psiFetchTime: psi.mobile?.fetchTime ?? null,
          cachedFrom: opts.cachedFrom ?? null,
        },
      };
      emit("done");
      return out;
    });

    return { ...result, cost: costFromEntries(entries), durationMs: Date.now() - started };
  } finally {
    deadline.dispose();
  }
}

/* ============================================================
   upgradeSeoAudit —— 付费升级(在免费结果上补齐)
   ============================================================ */

/** prev 里已经有哪些完整版模块(重试只补缺的) */
export function presentModules(prev: SeoAuditResult): Record<UpgradeModule, boolean> {
  return {
    crawl40: prev.meta.pagesRequested >= FULL_CRAWL_PAGES && prev.pages.length > 0,
    psiDesktop: prev.psi.desktop !== null,
    authority: prev.authority !== null,
    visibility: prev.visibility !== null,
    competitors: prev.competitors !== null,
  };
}

/**
 * 在已有(免费)结果上补齐完整版:重抓 40 页、桌面 PSI、DataForSEO 三模块,重新计分,plan = "full"。
 * 复用 prev.probe 与 prev.psi.mobile —— 几分钟内 robots/sitemap/变体不会变,省 30 秒。
 * **每个模块一落地就通过 onModule 落库**,进程中途被杀时,下一次调用拿着落库后的 prev 只补缺的模块。
 * 重抓失败就退回 prev.pages 并写明:用户付了钱,拿到的完整报告不能比免费版还少。
 */
export async function upgradeSeoAudit(prev: SeoAuditResult, opts: UpgradeOpts = {}): Promise<SeoAuditResult> {
  const started = Date.now();
  const deadline = createDeadline(opts.deadlineMs ?? RUN_DEADLINE_MS, started);
  const { entryUrl, origin, host, domain } = normalizeInput(prev.entryUrl || prev.input);
  await assertPublicHost(host);
  const emit = progressEmitter(opts, FULL_CRAWL_PAGES);
  const have = presentModules(prev);

  const persist = async (name: UpgradeModule, patch: Partial<SeoAuditResult>, notes: string[]) => {
    try {
      await opts.onModule?.(name, patch);
    } catch (e) {
      notes.push(`Could not persist the ${name} module immediately (${errMsg(e)}); it is included in the final save.`);
    }
  };

  try {
    const { result, entries } = await withCostLedger(async () => {
      const notes: string[] = [];
      emit("crawling", { pagesCrawled: have.crawl40 ? prev.pages.length : 0 });

      // 预热 sitemap 缓存:升级复用 prev.probe,不再跑 probeSite;不预热的话 40 页抓取拿不到
      // sitemap 分层抽样(全靠导航 BFS),sitemap 抽样可收录性探针也会是空的。失败不影响升级。
      if (!have.crawl40) {
        try {
          await withTimeout(discoverSitemaps(origin, prev.probe.robots?.sitemaps ?? []), 15_000, "Sitemap discovery");
        } catch (e) {
          notes.push(`Sitemap discovery for the full crawl did not finish (${errMsg(e)}); pages were sampled from navigation only.`);
        }
      }

      let recrawlBlocked: string | null = null;
      const crawlTask: Promise<CrawledPage[] | null> = have.crawl40
        ? Promise.resolve(null)
        : untilDeadline(
            crawlWithinDeadline(entryUrl, origin, FULL_CRAWL_PAGES, FULL_CRAWL_BUDGET_MS, deadline, (n) => emit("crawling", { pagesCrawled: n })),
            deadline,
            "Crawl",
            (): CrawlOutcome => ({ pages: [], coverage: null })
          ).then(async ({ pages, coverage, intervalMs, entryBlock }) => {
            // 入口被拦时抓取不入库任何页(拦截页不是首页)—— 下面会退回免费轮的页面,并写明原因
            if (entryBlock) recrawlBlocked = entryBlock.evidence;
            if (pages.length > 0) {
              // 40 页的抓取集合上重做抓后补全(sitemap 抽样/断链/大图…),写回 prev.probe;间隔沿用抓取的
              emit("verifying");
              await enrichWithinDeadline(prev.probe as ProbeResult, pages, coverage, deadline, notes, intervalMs);
              await persist(
                "crawl40",
                { pages, meta: { ...prev.meta, pagesCrawled: pages.length, pagesRequested: FULL_CRAWL_PAGES, crawlLimited: pages.length >= FULL_CRAWL_PAGES } },
                notes
              );
            }
            return pages;
          });

      const psiTask: Promise<PsiResult | null> = have.psiDesktop
        ? Promise.resolve(prev.psi.desktop)
        : untilDeadline(psiOrNull(entryUrl, "desktop", notes, deadline, opts.psiQuota), deadline, "PageSpeed Insights (desktop)", () => null).then(async (d) => {
            if (d) await persist("psiDesktop", { psi: { mobile: prev.psi.mobile, desktop: d } }, notes);
            return d;
          });

      const paidTask: Promise<PaidModules> = (async () => {
        // 只拉缺的模块:中途被杀后的重试、或某模块上次失败,已到手的模块绝不重复付费(复审 C14/C41)
        const missing = PAID_MODULE_IDS.filter((m) => !have[m]);
        if (missing.length === 0) return { authority: prev.authority, visibility: prev.visibility, competitors: prev.competitors };
        const stages: SeoAuditStage[] = ["authority", "visibility", "competitors"];
        let settledCount = PAID_MODULE_IDS.length - missing.length;
        emit("authority");
        for (let i = 1; i <= Math.min(2, settledCount); i++) emit(stages[i]);
        const fresh = await untilDeadline(
          runPaidModules("full", domain, notes, {
            onModule: (name, patch) => persist(name, patch, notes),
            visOpts: { sitemapUrls: sitemapUrlCount(prev.probe) },
            only: missing,
            onSettled: () => {
              settledCount++;
              emit(stages[Math.min(2, settledCount)]);
            },
          }),
          deadline,
          "DataForSEO modules",
          () => ({ ...NO_PAID })
        );
        return {
          authority: have.authority ? prev.authority : fresh.authority,
          visibility: have.visibility ? prev.visibility : fresh.visibility,
          competitors: have.competitors ? prev.competitors : fresh.competitors,
        };
      })();

      const [crawlS, psiDesktop, paid] = await Promise.all([
        Promise.allSettled([crawlTask]).then((r) => r[0]),
        psiTask.catch((e) => {
          notes.push(`PageSpeed Insights (desktop) failed: ${errMsg(e)}`);
          return null;
        }),
        paidTask,
      ]);

      let pages: CrawledPage[] = prev.pages;
      if (crawlS.status === "fulfilled" && crawlS.value && crawlS.value.length > 0) {
        pages = crawlS.value;
      } else if (!have.crawl40) {
        notes.push(
          crawlS.status === "rejected"
            ? `Re-crawl for the full report did not finish (${errMsg(crawlS.reason)}); page-level results reuse the ${prev.pages.length} pages from the free run.`
            : recrawlBlocked
              ? `Re-crawl was blocked by the site (${recrawlBlocked}); page-level results reuse the ${prev.pages.length} pages from the free run.`
              : `Re-crawl returned no pages; page-level results reuse the ${prev.pages.length} pages from the free run.`
        );
      }
      if (deadline.expired()) {
        notes.push(`The upgrade reached its ${Math.round((opts.deadlineMs ?? RUN_DEADLINE_MS) / 1000)}s time limit; modules that did not finish are marked unavailable.`);
      }

      emit("scoring");
      const psi: SeoAuditResult["psi"] = { mobile: prev.psi.mobile, desktop: psiDesktop };
      const scored = assemble({ plan: "full", probe: prev.probe, pages, psi, paid, domain });

      // 免费轮的 notes 里关于 PSI/抓取的说明仍然成立,保留;去重避免同一句出现两遍
      const mergedNotes = [...new Set([...prev.meta.notes, ...notes])];

      const out: SeoAuditResult = {
        ...prev,
        plan: "full",
        generatedAt: new Date().toISOString(),
        durationMs: 0,
        overall: scored.overall,
        dimensions: scored.dimensions,
        checks: scored.checks,
        topIssues: scored.topIssues,
        roadmap: scored.roadmap,
        pages,
        psi,
        authority: paid.authority,
        visibility: paid.visibility,
        competitors: paid.competitors,
        meta: {
          ...prev.meta,
          pagesCrawled: pages.length,
          pagesRequested: FULL_CRAWL_PAGES,
          crawlLimited: pages.length >= FULL_CRAWL_PAGES,
          notes: mergedNotes,
          lockedSections: [],
          blockers: scored.blockers,
          confidence: confidenceFor(scored.dimensions, pages),
          scoreNote: scored.scoreNote,
          psiFetchTime: psi.mobile?.fetchTime ?? prev.meta.psiFetchTime ?? null,
        },
      };
      emit("done");
      return out;
    });

    const fresh = costFromEntries(entries);
    return {
      ...result,
      // 累计:免费轮(通常 0)+ 本次升级
      cost: { dataforseoUsd: round6(prev.cost.dataforseoUsd + fresh.dataforseoUsd), calls: prev.cost.calls + fresh.calls },
      durationMs: Date.now() - started,
    };
  } finally {
    deadline.dispose();
  }
}

/* ============================================================
   rerunSeoAudit —— 解锁后 30 天内的重跑
   ============================================================ */

export interface RerunOpts {
  /** true 且还有刷新额度时才重新调 DataForSEO;否则沿用上一份的三模块 */
  refreshPaid?: boolean;
  /** 没要求刷新时,只补上一份里为 null 的模块(missingPaidModules),其余沿用(契约 1;是否给补由 repo 决定) */
  fillMissing?: boolean;
  onStage?: (stage: string) => void;
  onProgress?: (p: SeoAuditProgress) => void;
  deadlineMs?: number;
  psiQuota?: () => Promise<boolean>;
}

/**
 * 免费模块(探针 / 40 页抓取 / PSI 移动端 + 桌面端)总是重跑。DataForSEO 三模块(契约 1):
 *   · refreshPaid → 三个全部重拉;某个这次失败就退回上一份的值(已付费的数据不能被 null 覆盖);
 *   · fillMissing → 只补上一份里为 null 的模块并合并,非 null 的原样沿用;
 *   · 都不是 → 沿用上一份(null 的继续是 null,并写明没补)。
 * 运行被判 blocked 时三模块原样保留。上一次的总分写进 meta.notes("Previous score: N (date)")。
 * cost 累计(上一份 + 本次)。
 */
export async function rerunSeoAudit(prev: SeoAuditResult, opts: RerunOpts = {}): Promise<SeoAuditResult> {
  const prevPaid: PaidModules = { authority: prev.authority ?? null, visibility: prev.visibility ?? null, competitors: prev.competitors ?? null };
  const refresh = opts.refreshPaid === true;
  const next = await runSeoAudit(prev.entryUrl || prev.input, {
    plan: "full",
    onStage: opts.onStage,
    onProgress: opts.onProgress,
    deadlineMs: opts.deadlineMs,
    psiQuota: opts.psiQuota,
    reusePaid: refresh ? null : prevPaid,
    fillMissing: !refresh && opts.fillMissing === true,
    fallbackPaid: refresh ? prevPaid : null,
    previousScore: { score: prev.overall.score, date: (prev.generatedAt || "").slice(0, 10) || "previous run" },
  });
  return {
    ...next,
    cost: { dataforseoUsd: round6(prev.cost.dataforseoUsd + next.cost.dataforseoUsd), calls: prev.cost.calls + next.cost.calls },
  };
}
