/* ============================================================
   付费链路的纯决策(复审 A 组)—— 纯离线测试(不联网、不碰数据库)
   覆盖:重跑的付费动作 / 刷新额度决策(契约 1)、被拦 / 零页重跑不覆盖旧报告(契约 2)。
   SQL 本身(markOrderPaid 的条件迁移、撤销 / 恢复、清理)另用 qa- 行对真实库核过,见 A 组报告。
   运行:npm run test:seo
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";

// @/lib/env 在 import 时校验 DATABASE_URL —— 必须在动态 import 之前放好。无条件指向解析不了的主机:
// 这里只测纯函数,万一将来有人加了碰库的断言,也绝不会落到真实库上
process.env.DATABASE_URL = "postgres://test:test@db.invalid:5432/test";
process.env.CRON_SECRET ||= "test-secret";

import type { CrawledPage, SeoAuditResult } from "../types";

function page(url: string): CrawledPage {
  return {
    url, finalUrl: url, status: 200, redirects: 0, contentType: "text/html", bytes: 20_000, fetchedMs: 90, depth: 0,
    title: "t", description: "", h1s: ["h"], headings: [], wordCount: 400, textToHtml: 0.2, canonical: null, robotsMeta: null,
    xRobotsTag: null, lang: "en", viewport: null, images: { total: 0, missingAlt: 0 }, internalLinks: 3, externalLinks: 0, links: [],
    genericAnchors: 0, jsonLdTypes: [], jsonLdErrors: 0, og: {}, twitter: {}, hreflang: [], mixedContent: 0, hasBreadcrumbSchema: false,
    hasFavicon: true, issues: [],
  };
}

function result(over: Partial<SeoAuditResult> = {}, meta: Partial<SeoAuditResult["meta"]> = {}): SeoAuditResult {
  return {
    version: 1,
    plan: "full",
    input: "site.test",
    entryUrl: "https://site.test/",
    domain: "site.test",
    generatedAt: "2026-09-30T10:00:00.000Z",
    durationMs: 1,
    overall: { score: 72, grade: "B" },
    dimensions: [],
    checks: [],
    pages: [page("https://site.test/"), page("https://site.test/a")],
    probe: {
      input: "site.test", entryUrl: "https://site.test/", origin: "https://site.test", host: "site.test", variants: [],
      robots: { url: "", status: null, found: false, disallowAll: false, blocksEntry: false, sitemaps: [], bytes: 0 }, sitemaps: [],
      soft404: { probeUrl: "", status: null, isSoft404: false },
      headers: { hsts: null, csp: null, xContentTypeOptions: null, xFrameOptions: null, referrerPolicy: null, server: null, xRobotsTag: null },
      blocked: { detected: false, kind: null, evidence: "" },
    },
    psi: { mobile: null, desktop: null },
    topIssues: [],
    roadmap: [],
    authority: null,
    visibility: null,
    competitors: null,
    cost: { dataforseoUsd: 0, calls: 0 },
    meta: { pagesCrawled: 2, pagesRequested: 40, crawlLimited: false, notes: [], lockedSections: [], outcome: "complete", ...meta },
    ...over,
  };
}

/* ---------- 契约 1:refreshPaid / fillMissing / 额度 ---------- */

test("decideRerunPaid: explicit refresh uses the budget; otherwise missing modules are filled (also budgeted); nothing to do costs nothing", async () => {
  const { decideRerunPaid, SEO_PAID_REFRESH_MAX } = await import("../repo");
  assert.equal(SEO_PAID_REFRESH_MAX, 2);
  // 买家要求刷新、有额度 → 全量刷新,计一次
  assert.deepEqual(decideRerunPaid({ requestedRefresh: true, paidRefreshCount: 0, missing: [] }), { refreshPaid: true, fillMissing: false, countsRefresh: true });
  // 要求刷新时即使缺模块也不是"补缺"(全量刷新已经包含)
  assert.deepEqual(decideRerunPaid({ requestedRefresh: true, paidRefreshCount: 1, missing: ["visibility"] }), { refreshPaid: true, fillMissing: false, countsRefresh: true });
  // 默认重跑 + 上一份缺模块 → 只补缺,计一次("Re-run to retry" 必须真的能补回来)
  assert.deepEqual(decideRerunPaid({ requestedRefresh: false, paidRefreshCount: 0, missing: ["visibility"] }), { refreshPaid: false, fillMissing: true, countsRefresh: true });
  assert.deepEqual(decideRerunPaid({ requestedRefresh: false, paidRefreshCount: 1, missing: ["authority", "competitors"] }), { refreshPaid: false, fillMissing: true, countsRefresh: true });
  // 默认重跑、什么都不缺 → 不碰 DataForSEO、不计额度
  assert.deepEqual(decideRerunPaid({ requestedRefresh: false, paidRefreshCount: 0, missing: [] }), { refreshPaid: false, fillMissing: false, countsRefresh: false });
  // 额度用尽:刷新与补缺都不再花钱
  assert.deepEqual(decideRerunPaid({ requestedRefresh: true, paidRefreshCount: 2, missing: ["visibility"] }), { refreshPaid: false, fillMissing: false, countsRefresh: false });
  assert.deepEqual(decideRerunPaid({ requestedRefresh: false, paidRefreshCount: 2, missing: ["visibility"] }), { refreshPaid: false, fillMissing: false, countsRefresh: false });
  assert.deepEqual(decideRerunPaid({ requestedRefresh: false, paidRefreshCount: 5, missing: ["visibility"] }), { refreshPaid: false, fillMissing: false, countsRefresh: false });
});

/* ---------- 契约 2:被拦 / 零页的重跑不覆盖已付费的报告 ---------- */

test("rerunDegradation: a blocked re-run never overwrites a non-blocked report; the evidence goes into the message", async () => {
  const { rerunDegradation } = await import("../repo");
  const prev = result();
  const blocked = result(
    { pages: [], probe: { ...prev.probe, blocked: { detected: true, kind: "rate-limited", evidence: "429 Too Many Requests on AEOeyeBot" } } },
    { outcome: "blocked" }
  );
  const v = rerunDegradation(prev, blocked);
  assert.equal(v.keepPrevious, true);
  assert.match(v.message, /^Re-run blocked: 429 Too Many Requests on AEOeyeBot/);
  assert.match(v.message, /previous report was kept/);

  // 证据为空也给一句人话
  const silent = result({ pages: [], probe: { ...prev.probe, blocked: { detected: true, kind: "waf", evidence: "" } } }, { outcome: "blocked" });
  assert.match(rerunDegradation(prev, silent).message, /^Re-run blocked: the site's firewall blocked our crawler/);
});

test("rerunDegradation: zero pages while the previous report had pages is kept too (e.g. a TLS failure on the entry)", async () => {
  const { rerunDegradation } = await import("../repo");
  const prev = result();
  const tls = result({ pages: [], probe: { ...prev.probe, entryError: { kind: "tls", message: "certificate has expired" } } }, { outcome: "complete" });
  const v = rerunDegradation(prev, tls);
  assert.equal(v.keepPrevious, true);
  assert.match(v.message, /^Re-run blocked: no pages could be fetched this time \(certificate has expired\)/);
});

test("rerunDegradation: normal re-runs, blocked-after-blocked and first runs are saved as usual", async () => {
  const { rerunDegradation } = await import("../repo");
  const prev = result();
  assert.equal(rerunDegradation(prev, result()).keepPrevious, false, "a normal re-run replaces the report");
  assert.equal(rerunDegradation(prev, result({ pages: [page("https://site.test/")] })).keepPrevious, false, "fewer pages is still a real result");
  const prevBlocked = result({ pages: [] }, { outcome: "blocked" });
  const blockedAgain = result({ pages: [] }, { outcome: "blocked" });
  assert.equal(rerunDegradation(prevBlocked, blockedAgain).keepPrevious, false, "nothing to lose when the previous report was blocked too");
  assert.equal(rerunDegradation(prevBlocked, result()).keepPrevious, false, "unblocked now → save");
  assert.equal(rerunDegradation(null, result({ pages: [] }, { outcome: "blocked" })).keepPrevious, false, "no previous report → save whatever we got");
});
