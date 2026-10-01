/* ============================================================
   run.ts 编排逻辑 —— 纯离线(不联网、不碰数据库、不调任何付费 API)
   覆盖复审 C13/C14/C17/C18/C19/C20/C26/C27/C41/C44 在 run.ts 里的那一半:
   付费模块的沿用 / 补缺 / 刷新回退、blocked 不清空已付费模块、阶段顺序与单调进度、
   sitemap 叶子计数、两路拦截合并、TLS 不是 blocked、PSI 只在外层重试一次且每次扣配额。
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";

// @/lib/env 在 import 时校验 DATABASE_URL —— 必须在动态 import 之前放好(指向解析不了的主机,确保绝不真连)
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

import type { AuthorityResult, CompetitorsResult, PsiResult, SeoAuditProgress, SitemapInfo, VisibilityResult } from "../types";

const auth: AuthorityResult = { rank: 1, backlinks: 1, referringDomains: 1, referringMainDomains: 1, referringIps: 1, nofollowShare: 0, spamScore: 0, brokenBacklinks: 0, brokenPages: 0, firstSeen: null, tld: {}, linkTypes: {}, anchors: [], score: 50 };
const vis: VisibilityResult = { organicKeywords: 3, etv: 1, positions: { pos1: 0, pos2_3: 0, pos4_10: 1, pos11_20: 1, pos21_50: 1, pos51_100: 0 }, movement: { isNew: 0, isUp: 0, isDown: 0, isLost: 0 }, topKeywords: [], quickWins: [], score: 40 };
const comp: CompetitorsResult = { items: [], score: 30 };
const visNoData: VisibilityResult = { ...vis, noData: true, score: 0 };

/* ---------- 契约 1:missingPaidModules / 补缺 / 刷新 ---------- */

test("missingPaidModules: null modules are missing; a noData module object is NOT", async () => {
  const { missingPaidModules } = await import("../run");
  assert.deepEqual(missingPaidModules({ authority: null, visibility: null, competitors: null }), ["authority", "visibility", "competitors"]);
  assert.deepEqual(missingPaidModules({ authority: auth, visibility: null, competitors: comp }), ["visibility"]);
  assert.deepEqual(missingPaidModules({ authority: auth, visibility: visNoData, competitors: comp }), [], "noData is a valid answer, re-fetching gives the same");
});

test("paidModulesToFetch: no reuse → all three; reuse → none; reuse + fillMissing → only the null ones", async () => {
  const { paidModulesToFetch } = await import("../run");
  assert.deepEqual(paidModulesToFetch(null, false), ["authority", "visibility", "competitors"]);
  assert.deepEqual(paidModulesToFetch({ authority: auth, visibility: null, competitors: comp }, false), []);
  assert.deepEqual(paidModulesToFetch({ authority: auth, visibility: null, competitors: comp }, true), ["visibility"]);
  assert.deepEqual(paidModulesToFetch({ authority: auth, visibility: visNoData, competitors: comp }, true), []);
});

test("mergePaidModules: 'kept from the previous run' only when all three were reused", async () => {
  const { mergePaidModules } = await import("../run");
  const notes: string[] = [];
  const all = mergePaidModules({ reuse: { authority: auth, visibility: vis, competitors: comp }, fresh: { authority: null, visibility: null, competitors: null }, fetched: [] }, notes);
  assert.deepEqual(all, { authority: auth, visibility: vis, competitors: comp });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /kept from the previous run/);
});

test("mergePaidModules: fillMissing merges the freshly fetched module and names what was reused — never claims 'kept' for a null", async () => {
  const { mergePaidModules } = await import("../run");
  const notes: string[] = [];
  const merged = mergePaidModules({ reuse: { authority: auth, visibility: null, competitors: comp }, fresh: { authority: null, visibility: vis, competitors: null }, fetched: ["visibility"] }, notes);
  assert.deepEqual(merged, { authority: auth, visibility: vis, competitors: comp });
  assert.ok(!notes.some((n) => /kept from the previous run/.test(n)));
  assert.match(notes.join(" "), /Authority & backlinks, Competitors data were reused from the previous run; Search visibility was fetched because it was missing/);

  // 补拉失败:模块仍是 null,不写"已补到";失败原因由 runPaidModules 自己写
  const notes2: string[] = [];
  const failed = mergePaidModules({ reuse: { authority: auth, visibility: null, competitors: comp }, fresh: { authority: null, visibility: null, competitors: null }, fetched: ["visibility"] }, notes2);
  assert.equal(failed.visibility, null);
  assert.ok(!notes2.some((n) => /Search visibility/.test(n)), "the Unavailable card must find the module-unavailable note, not a misleading one");
});

test("mergePaidModules: a module missing from the previous run and not filled this time is named (the Unavailable card finds it)", async () => {
  const { mergePaidModules } = await import("../run");
  const notes: string[] = [];
  const merged = mergePaidModules({ reuse: { authority: auth, visibility: null, competitors: comp }, fresh: { authority: null, visibility: null, competitors: null }, fetched: [] }, notes);
  assert.equal(merged.visibility, null);
  assert.ok(notes.some((n) => /^Search visibility module has no data from an earlier run/.test(n)), notes.join(" | "));
  assert.ok(!notes.some((n) => /kept from the previous run/.test(n)));
});

test("mergePaidModules: refreshPaid — a module whose refresh fails falls back to the previous value, never to null", async () => {
  const { mergePaidModules } = await import("../run");
  const notes: string[] = [];
  const fresher = { ...auth, score: 77 };
  const merged = mergePaidModules(
    { reuse: null, fresh: { authority: fresher, visibility: null, competitors: comp }, fallback: { authority: auth, visibility: vis, competitors: { items: [], score: 1 } }, fetched: ["authority", "visibility", "competitors"] },
    notes
  );
  assert.equal(merged.authority, fresher, "fresh data win");
  assert.equal(merged.visibility, vis, "failed refresh → previous data");
  assert.equal(merged.competitors, comp);
  assert.deepEqual(notes, ["Search visibility could not be refreshed on this run; the previous data are shown."]);
});

test("paidOnBlockedRun: a blocked full run keeps the previous paid modules (reuse or refresh fallback) instead of nulling them (C13/C26)", async () => {
  const { paidOnBlockedRun } = await import("../run");
  const notes: string[] = [];
  assert.deepEqual(paidOnBlockedRun({ reusePaid: { authority: auth, visibility: null, competitors: comp } }, notes), { authority: auth, visibility: null, competitors: comp });
  assert.deepEqual(paidOnBlockedRun({ reusePaid: null, fallbackPaid: { authority: auth, visibility: vis, competitors: comp } }, notes), { authority: auth, visibility: vis, competitors: comp });
  assert.deepEqual(paidOnBlockedRun({}, notes), { authority: null, visibility: null, competitors: null });
  assert.match(notes[0], /previous run were kept/);
  assert.match(notes[2], /skipped because the crawler was blocked/);
});

/* ---------- 契约 3:阶段顺序与单调进度(C17) ---------- */

test("percentFor follows the stage order: verifying sits between pagespeed and the paid stages, nothing goes backwards", async () => {
  const { percentFor, SEO_STAGE_ORDER } = await import("../run");
  assert.deepEqual(SEO_STAGE_ORDER, ["queued", "probing", "crawling", "pagespeed", "verifying", "authority", "visibility", "competitors", "scoring", "done"]);
  assert.equal(percentFor("verifying"), 76);
  const ps = SEO_STAGE_ORDER.map((s) => percentFor(s, 20, 20));
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i] >= ps[i - 1], `${SEO_STAGE_ORDER[i]} (${ps[i]}) < ${SEO_STAGE_ORDER[i - 1]} (${ps[i - 1]})`);
});

test("progressEmitter is monotonic: a late 'crawling' frame after 'authority' keeps the stage and only updates the page count", async () => {
  const { progressEmitter } = await import("../run");
  const frames: SeoAuditProgress[] = [];
  const emit = progressEmitter({ onProgress: (p) => frames.push(p) }, 40);
  emit("probing");
  emit("crawling", { pagesCrawled: 3 });
  emit("verifying");
  emit("authority");
  emit("crawling", { pagesCrawled: 30 });
  emit("probing");
  emit("visibility");
  emit("competitors");
  emit("scoring");
  emit("done");
  assert.deepEqual(frames.map((f) => f.stage), ["probing", "crawling", "verifying", "authority", "authority", "authority", "visibility", "competitors", "scoring", "done"]);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].percent >= frames[i - 1].percent);
  assert.equal(frames[4].pagesCrawled, 30, "page count still flows");
});

/* ---------- C18:sitemap 只数叶子文件 ---------- */

test("sitemapUrlCount counts leaf sitemaps only — an index row's aggregate is not added on top of its children", async () => {
  const { sitemapUrlCount } = await import("../run");
  const info = (url: string, urlCount: number, isIndex = false, valid = true): SitemapInfo => ({ url, status: 200, valid, isIndex, urlCount, lastmodShare: 0, newestLastmod: null, children: [] });
  assert.equal(sitemapUrlCount({ sitemaps: [info("/sitemap.xml", 60_000, true), info("/s1.xml", 30_000), info("/s2.xml", 30_000), info("/404.xml", 0, false, false)] }), 60_000);
  assert.equal(sitemapUrlCount({ sitemaps: [info("/sitemap.xml", 50, true)] }), null, "an index with no fetched leaf gives no count");
  assert.equal(sitemapUrlCount({ sitemaps: [] }), null);
});

/* ---------- C19 / C20:拦截合并、TLS 不是拦截 ---------- */

test("mergeBlocked: the crawl's entry block counts even when the probe's request got through; TLS failures are never 'blocked'", async () => {
  const { mergeBlocked, deriveBlocked } = await import("../run");
  const clear = { detected: false, kind: null, evidence: "" } as const;
  assert.deepEqual(mergeBlocked(clear, { kind: "rate-limited", evidence: "HTTP 429" }), { detected: true, kind: "rate-limited", evidence: "HTTP 429" });
  assert.deepEqual(mergeBlocked(clear, null), clear);
  const probeBlock = { detected: true, kind: "waf" as const, evidence: "HTTP 403 from cloudflare" };
  assert.deepEqual(mergeBlocked(probeBlock, { kind: "rate-limited", evidence: "x" }), probeBlock, "the probe's own evidence wins");

  const tls = deriveBlocked({ entryUrl: "https://x.test/", headers: { hsts: null, csp: null, xContentTypeOptions: null, xFrameOptions: null, referrerPolicy: null, server: null, xRobotsTag: null }, entry: { status: 0, finalUrl: "https://x.test/", ms: 1, error: "CERT_HAS_EXPIRED: certificate has expired" } });
  assert.equal(tls.detected, false, "an expired certificate is not a firewall");
  assert.equal(tls.kind, "tls");
});

/* ---------- C44:PSI 只在外层重试一次,每次真实请求都扣配额 ---------- */

function psiStub(results: Array<Partial<PsiResult> & { error?: string; fatal?: boolean }>, seen: Array<{ retries?: number }>) {
  let i = 0;
  return async (url: string, strategy: "mobile" | "desktop", opts: { timeoutMs?: number; retries?: number } = {}): Promise<PsiResult> => {
    seen.push({ retries: opts.retries });
    const { emptyPsi } = await import("../psi");
    const r = results[Math.min(i++, results.length - 1)];
    if (r.error) return emptyPsi(strategy, url, r.error);
    return { ...emptyPsi(strategy, url, ""), error: undefined, scores: { performance: 90, seo: 90, accessibility: 90, bestPractices: 90 } };
  };
}

test("psiOrNull: runPsi is called with retries: 0; a 5xx-style failure is retried once and the retry consumes quota again", async () => {
  const { psiOrNull, createDeadline } = await import("../run");
  const d = createDeadline(120_000);
  try {
    const seen: Array<{ retries?: number }> = [];
    let quotaCalls = 0;
    const notes: string[] = [];
    const r = await psiOrNull("https://x.test/", "mobile", notes, d, async () => (quotaCalls++, true), { enabled: true, retryDelayMs: 1, run: psiStub([{ error: "PageSpeed Insights error: backend" }, {}], seen) });
    assert.ok(r && !r.error);
    assert.deepEqual(seen, [{ retries: 0 }, { retries: 0 }], "no inner retry: exactly two real requests");
    assert.equal(quotaCalls, 2, "each real request is counted against the daily PSI budget");

    // 配额说不行 → 不重试
    const seen2: Array<{ retries?: number }> = [];
    let q = 0;
    const notes2: string[] = [];
    const r2 = await psiOrNull("https://x.test/", "mobile", notes2, d, async () => ++q === 1, { enabled: true, retryDelayMs: 1, run: psiStub([{ error: "PageSpeed Insights error: backend" }, {}], seen2) });
    assert.equal(r2, null);
    assert.equal(seen2.length, 1);
    assert.match(notes2[0], /returned no data/);
  } finally {
    d.dispose();
  }
});

test("psiOrNull: timeouts and fatal (4xx / unconfigured) failures are not retried", async () => {
  const { psiOrNull, createDeadline } = await import("../run");
  const { runPsi } = await import("../psi");
  const d = createDeadline(120_000);
  try {
    const seen: Array<{ retries?: number }> = [];
    const r = await psiOrNull("https://x.test/", "desktop", [], d, undefined, { enabled: true, retryDelayMs: 1, run: psiStub([{ error: "PageSpeed Insights timed out after 60s" }, {}], seen) });
    assert.equal(r, null);
    assert.equal(seen.length, 1);

    let calls = 0;
    const fatalRun: typeof runPsi = (url, strategy, opts = {}) => {
      calls++;
      // 真实的 runPsi 遇到 4xx 会把结果标成 fatal:用一个回 429 的 fetch 驱动它
      return runPsi(url, strategy, { ...opts, apiKey: "k", fetchImpl: (async () => new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 })) as typeof fetch });
    };
    const notes: string[] = [];
    const r2 = await psiOrNull("https://x.test/", "desktop", notes, d, undefined, { enabled: true, retryDelayMs: 1, run: fatalRun });
    assert.equal(r2, null);
    assert.equal(calls, 1, "a 4xx is not worth a second request");
    assert.match(notes[0], /Quota exceeded/);
  } finally {
    d.dispose();
  }
});

test("probeTimeoutFor: 30s normally; widened for a Crawl-delay so an honoured delay cannot fail the audit; always leaves 30s for later stages", async () => {
  const { probeTimeoutFor } = await import("../run");
  assert.equal(probeTimeoutFor(250, 250_000), 30_000);
  assert.equal(probeTimeoutFor(2_000, 250_000), 90_000, "Crawl-delay 2s → room for ~45 request slots");
  assert.equal(probeTimeoutFor(2_000, 100_000), 70_000, "but never eats the last 30s of the run");
  assert.equal(probeTimeoutFor(2_000, 20_000), 5_000);
});
