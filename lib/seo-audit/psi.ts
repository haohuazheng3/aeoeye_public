/* ============================================================
   SEO Audit · Google PageSpeed Insights

   与 lib/engine/psi.ts(AI 可见度报告用,只取 CrUX 字段数据)不同,
   SEO 审计需要 Lighthouse 的实验室指标与各项 audit —— 用户要看的是
   "哪一项没过、怎么修",字段数据给不了这些。所以这里两者都取,
   但在 PsiResult 里分开放:lab 是实验室、field 是真实用户,报告层
   必须分开标注,不能混着说。

   V2:fieldMetrics 给出 CrUX p75 的**数值**(页面级优先,退回 origin 级
   并标 source),评分以它为准;fetchTime 记录 Lighthouse 抓取时间;
   5xx / 超时 / 网络错误重试一次(退避 3s)—— PSI 偶发 500 很常见,
   一次重试能救回大部分。

   永不抛:密钥缺失、超时、配额用尽、Lighthouse 跑崩,一律返回
   带 error 的空结果,让 performance/mobile 维度变 na 而不是整份
   报告失败。密钥只通过 env 引用,绝不出现在日志或错误信息里。

   复审 C44:审计编排(run.ts psiOrNull)以 retries: 0 调用,重试只在外层做一次
   (每次真实请求都扣一次 PSI 日配额)。外层要知道"这次失败值不值得重试"——
   4xx(配额、参数)与缺密钥再打一次也一样,用 psiFailureIsFatal 判断。
   ============================================================ */

import { env } from "@/lib/env";
import type { PsiAudit, PsiResult } from "./types";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const PSI_TIMEOUT_MS = 60_000;
export const PSI_RETRY_DELAY_MS = 3_000;

/** 规格附录 A:报告里保留的 audit id(顺序即展示顺序)+ V2 的 LCP 元素诊断项 */
export const PSI_AUDIT_IDS: readonly string[] = [
  "largest-contentful-paint",
  "cumulative-layout-shift",
  "total-blocking-time",
  "first-contentful-paint",
  "speed-index",
  "interactive",
  "server-response-time",
  "total-byte-weight",
  "render-blocking-resources",
  "uses-text-compression",
  "uses-long-cache-ttl",
  "modern-image-formats",
  "uses-optimized-images",
  "uses-responsive-images",
  "unused-javascript",
  "unused-css-rules",
  "unminified-javascript",
  "unminified-css",
  "efficient-animated-content",
  "redirects",
  "uses-rel-preconnect",
  "font-display",
  "viewport",
  "document-title",
  "meta-description",
  "http-status-code",
  "link-text",
  "crawlable-anchors",
  "is-crawlable",
  "robots-txt",
  "hreflang",
  "canonical",
  "image-alt",
  "tap-targets",
  "font-size",
  "color-contrast",
  "errors-in-console",
  "is-on-https",
  "image-aspect-ratio",
  "image-size-responsive",
  "heading-order",
  "html-has-lang",
  "html-lang-valid",
  "link-name",
  "button-name",
  "label",
  "dom-size",
  "third-party-summary",
  "largest-contentful-paint-element",
  "layout-shift-elements",
  "long-tasks",
  "mainthread-work-breakdown",
  "bootup-time",
  "lcp-lazy-loaded",
  "prioritize-lcp-image",
  "unsized-images",
];

type RawAudit = {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
};

type CruxBlock = {
  id?: string;
  overall_category?: string;
  metrics?: Record<string, { percentile?: number; category?: string }>;
};

export interface PsiApiResponse {
  id?: string;
  loadingExperience?: CruxBlock;
  originLoadingExperience?: CruxBlock;
  lighthouseResult?: {
    finalUrl?: string;
    finalDisplayedUrl?: string;
    requestedUrl?: string;
    fetchTime?: string;
    runtimeError?: { code?: string; message?: string };
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, RawAudit>;
  };
  error?: { code?: number; message?: string };
}

/** 不值得重试的失败(4xx、缺密钥)—— 用 WeakSet 标在结果对象上,不改 PsiResult 的形状 */
const FATAL_FAILURES = new WeakSet<PsiResult>();

/** 这个失败结果再请求一次也不会好(4xx / 未配置) */
export function psiFailureIsFatal(r: PsiResult): boolean {
  return FATAL_FAILURES.has(r);
}

export function emptyPsi(strategy: "mobile" | "desktop", url: string, error: string): PsiResult {
  return {
    strategy,
    fetchedUrl: url,
    scores: { performance: null, seo: null, accessibility: null, bestPractices: null },
    lab: { lcpMs: null, cls: null, tbtMs: null, fcpMs: null, speedIndexMs: null, ttiMs: null, serverResponseMs: null, totalBytes: null },
    field: null,
    audits: [],
    error,
    fieldMetrics: null,
    fetchTime: null,
  };
}

const pct = (s: number | null | undefined): number | null => (typeof s === "number" ? Math.round(s * 100) : null);
const ms = (a: RawAudit | undefined): number | null => (typeof a?.numericValue === "number" ? Math.round(a.numericValue) : null);

function hasMetrics(block: CruxBlock | undefined): block is CruxBlock & { metrics: NonNullable<CruxBlock["metrics"]> } {
  return !!block?.metrics && Object.keys(block.metrics).length > 0;
}

function pickField(block: CruxBlock | undefined): PsiResult["field"] {
  if (!hasMetrics(block)) return null;
  const cat = (key: string) => block.metrics[key]?.category ?? null;
  return {
    lcp: cat("LARGEST_CONTENTFUL_PAINT_MS"),
    inp: cat("INTERACTION_TO_NEXT_PAINT"),
    cls: cat("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    overall: block.overall_category ?? null,
  };
}

/** CrUX p75 数值。CLS 在 API 里是 ×100 的整数(例如 5 = 0.05),这里还原成小数 */
function pickFieldMetrics(block: CruxBlock | undefined, source: "page" | "origin"): NonNullable<PsiResult["fieldMetrics"]> | null {
  if (!hasMetrics(block)) return null;
  const p75 = (key: string): number | null => {
    const v = block.metrics[key]?.percentile;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const clsRaw = p75("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  const out = {
    lcpMs: p75("LARGEST_CONTENTFUL_PAINT_MS"),
    inpMs: p75("INTERACTION_TO_NEXT_PAINT"),
    cls: clsRaw === null ? null : Number((clsRaw / 100).toFixed(3)),
    ttfbMs: p75("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    source,
  };
  if (out.lcpMs === null && out.inpMs === null && out.cls === null && out.ttfbMs === null) return null;
  return out;
}

/** 纯映射:API JSON → PsiResult(可用 fixture 单测) */
export function mapPsiResponse(json: PsiApiResponse, strategy: "mobile" | "desktop", url: string): PsiResult {
  const lh = json.lighthouseResult;
  if (!lh) return emptyPsi(strategy, url, json.error?.message ?? "PageSpeed Insights returned no Lighthouse result");

  const audits = lh.audits ?? {};
  const cats = lh.categories ?? {};
  const kept: PsiAudit[] = [];
  for (const id of PSI_AUDIT_IDS) {
    const a = audits[id];
    if (!a) continue;
    const scored = a.scoreDisplayMode === undefined || a.scoreDisplayMode === "numeric" || a.scoreDisplayMode === "binary" || a.scoreDisplayMode === "metricSavings";
    kept.push({
      id,
      title: a.title ?? id,
      score: scored && typeof a.score === "number" ? a.score : null,
      displayValue: a.displayValue ?? "",
      description: a.description ?? "",
    });
  }

  const clsRaw = audits["cumulative-layout-shift"]?.numericValue;
  const result: PsiResult = {
    strategy,
    fetchedUrl: lh.finalDisplayedUrl || lh.finalUrl || lh.requestedUrl || json.id || url,
    scores: {
      performance: pct(cats.performance?.score),
      seo: pct(cats.seo?.score),
      accessibility: pct(cats.accessibility?.score),
      bestPractices: pct(cats["best-practices"]?.score),
    },
    lab: {
      lcpMs: ms(audits["largest-contentful-paint"]),
      cls: typeof clsRaw === "number" ? Number(clsRaw.toFixed(3)) : null,
      tbtMs: ms(audits["total-blocking-time"]),
      fcpMs: ms(audits["first-contentful-paint"]),
      speedIndexMs: ms(audits["speed-index"]),
      ttiMs: ms(audits["interactive"]),
      serverResponseMs: ms(audits["server-response-time"]),
      totalBytes: ms(audits["total-byte-weight"]),
    },
    // 页面自身的字段数据优先;不够流量时退到整站聚合
    field: pickField(json.loadingExperience) ?? pickField(json.originLoadingExperience),
    audits: kept,
    fieldMetrics: pickFieldMetrics(json.loadingExperience, "page") ?? pickFieldMetrics(json.originLoadingExperience, "origin"),
    fetchTime: typeof lh.fetchTime === "string" && lh.fetchTime ? lh.fetchTime : null,
  };

  const rt = lh.runtimeError;
  if (rt?.code && rt.code !== "NO_ERROR") result.error = `Lighthouse runtime error ${rt.code}${rt.message ? `: ${rt.message}` : ""}`;
  return result;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Attempt = { kind: "ok"; json: PsiApiResponse } | { kind: "fatal"; error: string } | { kind: "retryable"; error: string };

async function attempt(qs: string, key: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Attempt> {
  const redact = (s: string) => s.split(key).join("[key]");
  try {
    const res = await fetchImpl(`${ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    let json: PsiApiResponse | null = null;
    try {
      json = (await res.json()) as PsiApiResponse;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = redact(json?.error?.message ?? `HTTP ${res.status}`);
      return { kind: res.status >= 500 ? "retryable" : "fatal", error: `PageSpeed Insights error: ${msg}` };
    }
    if (!json) return { kind: "retryable", error: "PageSpeed Insights returned an unreadable response" };
    return { kind: "ok", json };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      kind: "retryable",
      error: timedOut ? `PageSpeed Insights timed out after ${Math.round(timeoutMs / 1000)}s` : `PageSpeed Insights request failed: ${redact(err?.message ?? String(e))}`,
    };
  }
}

/**
 * 跑一次 PSI(四个类别)。需要 env.PSI_API;缺失或任何失败都返回带 error 的空结果。
 * 5xx / 超时 / 网络错误重试一次(退避 retryDelayMs,默认 3s);4xx(配额、参数)不重试。
 * 第三个参数只给测试注入用。
 */
export async function runPsi(
  url: string,
  strategy: "mobile" | "desktop",
  opts: { fetchImpl?: typeof fetch; apiKey?: string; timeoutMs?: number; retryDelayMs?: number; retries?: number } = {}
): Promise<PsiResult> {
  const key = opts.apiKey ?? env.PSI_API;
  if (!key) {
    const r = emptyPsi(strategy, url, "PageSpeed Insights is not configured (PSI_API missing)");
    FATAL_FAILURES.add(r);
    return r;
  }
  const timeoutMs = opts.timeoutMs ?? PSI_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? PSI_RETRY_DELAY_MS;

  const qs = new URLSearchParams({ url, strategy, key });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) qs.append("category", c);
  const query = qs.toString();

  let lastError = "PageSpeed Insights did not respond";
  let fatal = false;
  for (let i = 0; i <= retries; i++) {
    const r = await attempt(query, key, fetchImpl, timeoutMs);
    if (r.kind === "ok") return mapPsiResponse(r.json, strategy, url);
    lastError = r.error;
    if (r.kind === "fatal") {
      fatal = true;
      break;
    }
    if (i < retries) await sleep(retryDelayMs);
  }
  const out = emptyPsi(strategy, url, lastError);
  if (fatal) FATAL_FAILURES.add(out);
  return out;
}
