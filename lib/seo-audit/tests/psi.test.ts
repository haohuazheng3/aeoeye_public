/* ============================================================
   PSI 映射与重试 —— fetch 被 mock,一个字节都不会发到 Google。
   ============================================================ */
import { test, before } from "node:test";
import assert from "node:assert/strict";

// @/lib/env 在 import 时校验 DATABASE_URL —— 必须在动态 import 之前把测试用环境放好
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

type PsiModule = typeof import("../psi");
type PsiApiResponse = import("../psi").PsiApiResponse;
let mapPsiResponse: PsiModule["mapPsiResponse"];
let runPsi: PsiModule["runPsi"];
let emptyPsi: PsiModule["emptyPsi"];
before(async () => {
  ({ mapPsiResponse, runPsi, emptyPsi } = await import("../psi"));
});

const FIXTURE: PsiApiResponse = {
  id: "https://example.com/",
  loadingExperience: {
    id: "https://example.com/",
    overall_category: "AVERAGE",
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900, category: "AVERAGE" },
      INTERACTION_TO_NEXT_PAINT: { percentile: 150, category: "FAST" },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 7, category: "FAST" },
      EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 900, category: "AVERAGE" },
    },
  },
  originLoadingExperience: {
    overall_category: "FAST",
    metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1800, category: "FAST" } },
  },
  lighthouseResult: {
    finalDisplayedUrl: "https://example.com/",
    fetchTime: "2026-09-30T10:00:00.000Z",
    categories: { performance: { score: 0.91 }, seo: { score: 1 }, accessibility: { score: 0.85 }, "best-practices": { score: 0.7 } },
    audits: {
      "largest-contentful-paint": { id: "largest-contentful-paint", title: "LCP", score: 0.8, numericValue: 2345.6, displayValue: "2.3 s" },
      "cumulative-layout-shift": { id: "cumulative-layout-shift", score: 1, numericValue: 0.0123 },
      "total-byte-weight": { id: "total-byte-weight", score: 0.9, numericValue: 1_234_567 },
      "lcp-lazy-loaded": { id: "lcp-lazy-loaded", title: "Lazy LCP", score: 0, scoreDisplayMode: "binary" },
      "third-party-summary": { id: "third-party-summary", title: "3P", score: null, scoreDisplayMode: "informative" },
      "not-kept": { id: "not-kept", score: 1 },
    },
  },
};

test("mapPsiResponse: scores, lab, field categories, fieldMetrics p75 (page-level, CLS ÷100), fetchTime, audits incl. LCP element diagnostics", () => {
  const r = mapPsiResponse(FIXTURE, "mobile", "https://example.com/");
  assert.equal(r.scores.performance, 91);
  assert.equal(r.scores.bestPractices, 70);
  assert.equal(r.lab.lcpMs, 2346);
  assert.equal(r.lab.cls, 0.012);
  assert.equal(r.lab.totalBytes, 1_234_567);
  assert.deepEqual(r.field, { lcp: "AVERAGE", inp: "FAST", cls: "FAST", overall: "AVERAGE" });
  assert.deepEqual(r.fieldMetrics, { lcpMs: 2900, inpMs: 150, cls: 0.07, ttfbMs: 900, source: "page" });
  assert.equal(r.fetchTime, "2026-09-30T10:00:00.000Z");
  assert.ok(r.audits.some((a) => a.id === "lcp-lazy-loaded" && a.score === 0));
  assert.ok(r.audits.some((a) => a.id === "third-party-summary" && a.score === null), "informative audits keep score null");
  assert.ok(!r.audits.some((a) => a.id === "not-kept"));
  assert.equal(r.error, undefined);
});

test("mapPsiResponse: falls back to origin-level CrUX, null when no field data, runtime errors surface", () => {
  const originOnly = mapPsiResponse({ ...FIXTURE, loadingExperience: { metrics: {} } }, "mobile", "u");
  assert.deepEqual(originOnly.fieldMetrics, { lcpMs: 1800, inpMs: null, cls: null, ttfbMs: null, source: "origin" });
  assert.deepEqual(originOnly.field, { lcp: "FAST", inp: null, cls: null, overall: "FAST" });

  const none = mapPsiResponse({ ...FIXTURE, loadingExperience: undefined, originLoadingExperience: undefined }, "mobile", "u");
  assert.equal(none.fieldMetrics, null);
  assert.equal(none.field, null);

  const broken = mapPsiResponse({ lighthouseResult: { ...FIXTURE.lighthouseResult, runtimeError: { code: "FAILED_DOCUMENT_REQUEST", message: "boom" } } }, "desktop", "u");
  assert.match(broken.error ?? "", /FAILED_DOCUMENT_REQUEST: boom/);
  assert.equal(emptyPsi("mobile", "u", "x").fieldMetrics, null);
});

function mockFetch(responses: Array<{ status: number; body?: unknown; throw?: Error }>, calls: string[]): typeof fetch {
  let i = 0;
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r.throw) throw r.throw;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("runPsi: retries once after a 5xx (with backoff), then maps the result; the key never leaks into errors", async () => {
  const calls: string[] = [];
  const r = await runPsi("https://example.com/", "mobile", { apiKey: "SECRET-KEY", fetchImpl: mockFetch([{ status: 503, body: { error: { message: "backend SECRET-KEY" } } }, { status: 200, body: FIXTURE }], calls), retryDelayMs: 5 });
  assert.equal(calls.length, 2);
  assert.equal(r.scores.performance, 91);
  assert.ok(calls[0].includes("strategy=mobile") && calls[0].includes("category=seo"));

  const fail = await runPsi("https://example.com/", "mobile", { apiKey: "SECRET-KEY", fetchImpl: mockFetch([{ status: 500, body: { error: { message: "x SECRET-KEY y" } } }], calls), retryDelayMs: 5 });
  assert.equal(fail.error, "PageSpeed Insights error: x [key] y");
  assert.equal(calls.length, 4, "second attempt made, then gave up");
});

test("runPsi: 4xx is not retried; timeouts are retried; missing key short-circuits", async () => {
  const calls: string[] = [];
  const quota = await runPsi("u", "desktop", { apiKey: "k", fetchImpl: mockFetch([{ status: 429, body: { error: { message: "Quota exceeded" } } }], calls), retryDelayMs: 5 });
  assert.equal(calls.length, 1);
  assert.match(quota.error ?? "", /Quota exceeded/);

  const timeoutErr = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const after = await runPsi("u", "mobile", { apiKey: "k", fetchImpl: mockFetch([{ status: 0, throw: timeoutErr }, { status: 200, body: FIXTURE }], calls), retryDelayMs: 5, timeoutMs: 1234 });
  assert.equal(calls.length, 3);
  assert.equal(after.error, undefined);
  assert.equal(after.fetchTime, "2026-09-30T10:00:00.000Z");

  const twice = await runPsi("u", "mobile", { apiKey: "k", fetchImpl: mockFetch([{ status: 0, throw: timeoutErr }], calls), retryDelayMs: 5, timeoutMs: 1234 });
  assert.equal(twice.error, "PageSpeed Insights timed out after 1s");

  const none = await runPsi("u", "mobile", { apiKey: "", fetchImpl: mockFetch([{ status: 200, body: FIXTURE }], calls) });
  assert.match(none.error ?? "", /not configured/);
});

test("C44: fatal failures (4xx, missing key) are marked so the single outer retry can skip them; 5xx / timeouts are not", async () => {
  const { psiFailureIsFatal } = await import("../psi");
  const calls: string[] = [];
  const quota = await runPsi("u", "mobile", { apiKey: "k", fetchImpl: mockFetch([{ status: 429, body: { error: { message: "Quota exceeded" } } }], calls), retries: 0 });
  assert.equal(psiFailureIsFatal(quota), true);
  const server = await runPsi("u", "mobile", { apiKey: "k", fetchImpl: mockFetch([{ status: 500, body: {} }], calls), retries: 0 });
  assert.ok(server.error);
  assert.equal(psiFailureIsFatal(server), false);
  assert.equal(calls.length, 2, "retries: 0 means exactly one request each");
  const timeoutErr = Object.assign(new Error("aborted"), { name: "TimeoutError" });
  assert.equal(psiFailureIsFatal(await runPsi("u", "mobile", { apiKey: "k", fetchImpl: mockFetch([{ status: 0, throw: timeoutErr }], calls), retries: 0, timeoutMs: 1000 })), false);
  assert.equal(psiFailureIsFatal(await runPsi("u", "mobile", { apiKey: "" })), true);
  assert.equal(psiFailureIsFatal(mapPsiResponse(FIXTURE, "mobile", "u")), false);
});
