/* 站内检查项测试:npx tsx --test lib/seo-audit/tests/checks.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ONSITE_DIMENSIONS, type SeoCheck } from "../types";
import { runAllOnsiteChecks, checkOnPage, checkArchitecture, checkPerformance, checkCrawlability, checkStructured, checkSecurity } from "../checks";
import { pageTypeOf, jaccard, tokenize, normalizeUrl, urlKey, shareStatus, minhashSimilarity } from "../checks/helpers";
import { scoreDimensions, overallScore, GATE_OVERALL_CAP } from "../score";
import { healthySite, brokenSite, stripV2, makePage, makePsi, abs, minhashFor, daysAheadIso, tlsBrokenSite, subdomainSite, jsShellSite, SUB_HOST } from "./fixtures";

/** V2-2 全部 90 个 check id —— 少一个就是漏实现 */
const V2_IDS = [
  "crawl.blocked", "crawl.js-dependent", "crawl.robots.exists", "crawl.robots.blocks-site", "crawl.robots.resources", "crawl.robots.sitemap-directive",
  "crawl.robots.ai-crawlers", "crawl.sitemap.found", "crawl.sitemap.valid", "crawl.sitemap.sample", "crawl.sitemap.lastmod", "crawl.freshness",
  "crawl.entry.status", "crawl.entry.indexable", "crawl.pages.noindex", "crawl.noindex-robots-conflict", "crawl.canonical.entry", "crawl.canonical.pages",
  "crawl.https.redirect", "crawl.host.canonical", "crawl.url-variants", "crawl.redirect.chains", "crawl.soft404", "crawl.pages.errors", "crawl.links.broken",
  "crawl.links.to-redirects", "crawl.hreflang",
  "onpage.title.present", "onpage.title.length", "onpage.title.unique", "onpage.title.h1-slug-overlap", "onpage.description.present", "onpage.description.length",
  "onpage.description.unique", "onpage.h1.missing", "onpage.h1.multiple", "onpage.headings.order", "onpage.images.alt", "onpage.thin", "onpage.near-duplicate",
  "onpage.url.hygiene", "onpage.lang", "onpage.robots-nofollow",
  "perf.cwv.lcp", "perf.cwv.inp", "perf.cwv.cls", "perf.cwv.ttfb", "perf.lighthouse-score", "perf.crawl-ttfb", "perf.lcp-element", "perf.weight",
  "perf.render-blocking", "perf.compression", "perf.cache", "perf.images", "perf.unused-js",
  "mobile.viewport", "mobile.font-size", "mobile.tap-targets", "mobile.parity", "mobile.images.dims", "mobile.images.large", "mobile.accessibility",
  "schema.jsonld.valid", "schema.organization", "schema.website", "schema.breadcrumb", "schema.article", "schema.product", "schema.deprecated", "schema.og",
  "schema.twitter", "schema.favicon",
  "sec.https", "sec.tls.expired", "sec.tls.expiring", "sec.tls.www", "sec.https.variants", "sec.mixed-content", "sec.hsts", "sec.trust-pages", "sec.headers",
  "arch.depth", "arch.internal-links.min", "arch.internal-links.bloat", "arch.generic-anchors", "arch.orphans", "arch.breadcrumbs", "arch.url-depth", "arch.nav-consistency",
];

const byId = (checks: SeoCheck[]) => new Map(checks.map((c) => [c.id, c]));

test("healthy site: every V2-2 check id is produced exactly once and nothing fails", () => {
  const checks = runAllOnsiteChecks(healthySite());
  const ids = checks.map((c) => c.id);
  for (const id of V2_IDS) assert.equal(ids.filter((x) => x === id).length, 1, `check ${id} should appear exactly once`);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  const fails = checks.filter((c) => c.status === "fail").map((c) => c.id);
  assert.deepEqual(fails, [], `healthy site must not fail any check, got ${fails.join(", ")}`);
  const warns = checks.filter((c) => c.status === "warn").map((c) => c.id);
  assert.deepEqual(warns, [], `healthy site must not warn, got ${warns.join(", ")}`);
  for (const c of checks) {
    assert.ok(ONSITE_DIMENSIONS.includes(c.dimension), `${c.id} dimension`);
    assert.ok(c.evidence.length > 0, `${c.id} has evidence`);
    assert.ok(c.docs && /^https:\/\/(developers\.google\.com|web\.dev|developer\.mozilla\.org|developer\.chrome\.com|ogp\.me|developer\.x\.com)\//.test(c.docs), `${c.id} has an official docs link`);
    assert.ok(c.weight >= 1 && c.weight <= 4, `${c.id} weight derived from severity`);
  }
});

test("broken site: gates, page-level failures and concrete evidence", () => {
  const m = byId(runAllOnsiteChecks(brokenSite()));
  const expectFail = (id: string) => {
    const c = m.get(id)!;
    assert.ok(c, `${id} present`);
    assert.equal(c.status, "fail", `${id} should fail (got ${c.status}: ${c.evidence[0]})`);
    assert.ok(c.fix.length > 30, `${id} has an actionable fix`);
    return c;
  };
  assert.equal(expectFail("crawl.entry.indexable").gate, true);
  assert.equal(expectFail("crawl.robots.blocks-site").gate, true);
  assert.equal(expectFail("sec.tls.expired").gate, true);
  expectFail("crawl.sitemap.found");
  expectFail("crawl.https.redirect");
  expectFail("mobile.viewport");
  expectFail("perf.cwv.lcp");
  expectFail("perf.cwv.inp");
  expectFail("perf.cwv.cls");
  expectFail("perf.cwv.ttfb");
  expectFail("sec.https.variants");
  assert.equal(m.get("crawl.soft404")!.status, "warn");

  const errors = expectFail("crawl.pages.errors");
  assert.equal(errors.scope, "page");
  assert.equal(errors.affectedCount, 5);
  assert.ok(errors.evidence[0].startsWith("Across 20 crawled pages, 5 (25%)"), errors.evidence[0]);
  assert.equal(errors.sample!.length, 3);

  const titles = expectFail("onpage.title.present");
  assert.equal(titles.affectedCount, 7, "6 pages + the homepage");
  assert.ok(titles.evidence[0].startsWith("Across 15 crawled pages"), titles.evidence[0]);

  const broken = expectFail("crawl.links.broken");
  assert.equal(broken.affectedCount, 6);
  assert.ok(broken.evidence.some((e) => /old-page-12/.test(e)), "lists from → to");

  const mixed = m.get("sec.mixed-content")!;
  assert.equal(mixed.status, "warn", "2 of 15 pages = 13% → warn");
  assert.equal(m.get("sec.tls.expiring")!.status, "na", "expired certificate is not double-counted");
  assert.equal(m.get("sec.tls.www")!.status, "warn");
});

test("page-level thresholds: 0% pass, ≤20% warn, >20% fail — with sample size in the first sentence", () => {
  const run = (missing: number) => {
    const ctx = healthySite();
    for (let i = 1; i <= missing; i += 1) ctx.pages[i] = { ...ctx.pages[i], title: "" };
    return byId(checkOnPage(ctx)).get("onpage.title.present")!;
  };
  assert.equal(run(0).status, "pass");
  assert.ok(run(0).evidence[0].startsWith("Across 20 crawled pages, none"));
  assert.equal(run(1).status, "warn");
  assert.ok(run(1).evidence[0].startsWith("Across 20 crawled pages, 1 (5%)"));
  assert.equal(run(4).status, "warn", "4/20 = 20% is still warn");
  assert.equal(run(5).status, "fail", "5/20 = 25% fails");
  assert.deepEqual(run(5).affected.length, 5);
  assert.equal(run(5).sample!.length, 3, "sample capped at 3");
  assert.equal(shareStatus(2, 20, { pass: 0.1, warn: 0.3 }), "pass");
  assert.equal(shareStatus(6, 20, { pass: 0.1, warn: 0.3 }), "warn");
  assert.equal(shareStatus(7, 20, { pass: 0.1, warn: 0.3 }), "fail");
});

test("missing v2 fields and missing PSI → status na with a note, never fail", () => {
  const ctx = stripV2(healthySite());
  const m = byId(runAllOnsiteChecks(ctx));
  const mustBeNa = [
    "crawl.blocked", "crawl.js-dependent", "crawl.robots.resources", "crawl.robots.ai-crawlers", "crawl.sitemap.sample", "crawl.links.broken",
    "onpage.near-duplicate", "onpage.robots-nofollow",
    "perf.cwv.lcp", "perf.cwv.inp", "perf.cwv.cls", "perf.cwv.ttfb", "perf.lighthouse-score", "perf.crawl-ttfb", "perf.lcp-element", "perf.weight",
    "mobile.font-size", "mobile.tap-targets", "mobile.parity", "mobile.images.dims", "mobile.images.large", "mobile.accessibility",
    "sec.tls.expired", "sec.tls.expiring", "sec.tls.www",
  ];
  for (const id of mustBeNa) {
    const c = m.get(id)!;
    assert.ok(c, `${id} present`);
    assert.equal(c.status, "na", `${id} should be na without v2 data (got ${c.status})`);
    assert.ok(c.evidence[0].length > 10, `${id} explains why it was not measured`);
  }
  // 老字段仍然能评:noindex 回退到 robotsMeta 字符串,freshness 回退到 sitemap lastmod
  assert.equal(m.get("crawl.entry.indexable")!.status, "pass");
  assert.equal(m.get("crawl.freshness")!.status, "pass");
  assert.equal(m.get("onpage.thin")!.status, "pass", "pageType heuristic from URL still finds the articles");
  const fails = Array.from(m.values()).filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.evidence[0]}`);
  assert.deepEqual(fails, [], "no fail from missing data");
});

test("blocked by WAF: crawl.blocked fails and crawl-dependent checks are na", () => {
  const ctx = healthySite();
  ctx.probe.blocked = { detected: true, kind: "waf", evidence: "HTTP 403 with cf-mitigated: challenge" };
  ctx.pages = [];
  ctx.entry = null;
  const m = byId(runAllOnsiteChecks(ctx));
  const b = m.get("crawl.blocked")!;
  assert.equal(b.status, "fail");
  assert.equal(b.severity, "critical");
  assert.ok(/AEOeyeBot/.test(b.fix));
  for (const id of ["crawl.entry.status", "crawl.entry.indexable", "onpage.title.present", "mobile.viewport", "schema.og", "arch.depth", "crawl.pages.errors"]) {
    assert.equal(m.get(id)!.status, "na", `${id} should be na when blocked`);
    assert.ok(/blocked/i.test(m.get(id)!.evidence[0]), `${id} note mentions the block`);
  }
});

test("onpage.thin only scores article pages; non-article thin pages are info", () => {
  const ctx = healthySite();
  ctx.pages = ctx.pages.map((p) => (p.pageType === "article" ? { ...p, wordCount: 120 } : p));
  const thin = byId(checkOnPage(ctx)).get("onpage.thin")!;
  assert.equal(thin.status, "fail");
  assert.equal(thin.affectedCount, 8);
  assert.ok(thin.evidence[0].startsWith("Across 8 article pages"));

  const ctx2 = healthySite();
  ctx2.pages = ctx2.pages.filter((p) => p.pageType !== "article").map((p) => ({ ...p, wordCount: 80, pageType: p.pageType ?? "other" }));
  ctx2.entry = ctx2.pages[0];
  const thin2 = byId(checkOnPage(ctx2)).get("onpage.thin")!;
  assert.equal(thin2.status, "info");

  // JS 依赖时按页剔除空壳(复审 C22):只有一个空壳入口 → na;入口是壳但还有服务端渲染的文章 → 照样评文章
  const shellOnly = byId(checkOnPage(jsShellSite())).get("onpage.thin")!;
  assert.equal(shellOnly.status, "na");
  assert.match(shellOnly.evidence[0], /^Not measured: based on raw HTML, which is a JavaScript shell/);
  const ctx3 = healthySite();
  ctx3.probe.jsDependent = true;
  ctx3.pages = ctx3.pages.map((p) => (p.pageType === "article" ? { ...p, wordCount: 120 } : p));
  const mixed = byId(checkOnPage(ctx3)).get("onpage.thin")!;
  assert.equal(mixed.status, "fail", "the 8 SSR articles are still judged when only the entry page is a shell");
  assert.ok(mixed.evidence.some((e) => /1 JavaScript-shell page\(s\) excluded/.test(e)), mixed.evidence.join(" | "));
});

test("near-duplicate clusters from minhash", () => {
  const ctx = healthySite();
  const sig = minhashFor(42);
  ctx.pages[7] = { ...ctx.pages[7], minhash: sig };
  ctx.pages[8] = { ...ctx.pages[8], minhash: sig.map((v, i) => (i < 58 ? v : v + 1)) };
  ctx.pages[9] = { ...ctx.pages[9], minhash: sig };
  const c = byId(checkOnPage(ctx)).get("onpage.near-duplicate")!;
  assert.equal(c.status, "warn", "3/20 = 15% → warn");
  assert.equal(c.affectedCount, 3);
  assert.ok(c.evidence.some((e) => e.startsWith("Cluster:")));
  assert.equal(minhashSimilarity(sig, sig), 1);
  assert.equal(minhashSimilarity(sig, undefined), null);
});

test("performance: lab fallback is capped at warn and labelled; field data can fail", () => {
  const ctx = healthySite();
  ctx.psi.mobile = makePsi({ fieldMetrics: null, lab: { ...makePsi().lab, lcpMs: 6000, serverResponseMs: 3000, cls: 0.5, tbtMs: 900 } });
  const m = byId(checkPerformance(ctx));
  for (const id of ["perf.cwv.lcp", "perf.cwv.inp", "perf.cwv.cls", "perf.cwv.ttfb"]) {
    assert.equal(m.get(id)!.status, "warn", `${id} lab poor → warn, not fail`);
    assert.ok(/lab/i.test(m.get(id)!.evidence[0]), `${id} says lab`);
  }
  const ctx2 = healthySite();
  ctx2.psi.mobile = makePsi({ fieldMetrics: { lcpMs: 5000, inpMs: 100, cls: 0.05, ttfbMs: 600, source: "origin" } });
  const m2 = byId(checkPerformance(ctx2));
  assert.equal(m2.get("perf.cwv.lcp")!.status, "fail");
  assert.ok(/real Chrome users/.test(m2.get("perf.cwv.lcp")!.evidence[0]));
  assert.equal(m2.get("perf.cwv.inp")!.status, "pass");
  assert.equal(m2.get("perf.lighthouse-score")!.status, "info");

  const ctx3 = healthySite();
  ctx3.psi.mobile = makePsi({ error: "quota exceeded", audits: [], fieldMetrics: null });
  const m3 = byId(checkPerformance(ctx3));
  assert.ok(Array.from(m3.values()).filter((c) => c.id !== "perf.crawl-ttfb").every((c) => c.status === "na"), "PSI error → na");
  assert.equal(m3.get("perf.crawl-ttfb")!.status, "pass", "crawl TTFB does not depend on PSI");
});

test("architecture: fewer than 5 crawled pages → all na; deep pages and orphans are flagged", () => {
  const small = healthySite();
  small.pages = small.pages.slice(0, 4);
  const naAll = checkArchitecture(small);
  assert.equal(naAll.length, 8);
  assert.ok(naAll.every((c) => c.status === "na"));

  const ctx = healthySite();
  ctx.pages = ctx.pages.map((p, i) => (i >= 15 ? { ...p, depth: 5 } : p));
  ctx.sitemapSample = [...ctx.pages.slice(0, 5).map((p) => p.url), ...Array.from({ length: 15 }, (_, i) => abs(`/orphan-${i}`))];
  const m = byId(checkArchitecture(ctx));
  assert.equal(m.get("arch.depth")!.status, "fail", "5/20 deeper than 3 clicks");
  assert.equal(m.get("arch.orphans")!.status, "warn", "15/20 orphan sample = 75%");
  assert.ok(/Sampling caveat/.test(m.get("arch.orphans")!.evidence[1]));
  assert.equal(m.get("arch.nav-consistency")!.status, "pass");
});

test("crawlability: canonical targets, url variants and redirect chains", () => {
  const ctx = healthySite();
  ctx.pages[0] = { ...ctx.pages[0], canonical: abs("/old-home") };
  ctx.entry = ctx.pages[0];
  ctx.probe.canonicalTargets = [{ url: abs("/old-home"), status: 301, finalUrl: abs("/"), noindex: false }];
  ctx.probe.variants = ctx.probe.variants.map((v) => (v.kind === "utm" ? { ...v, canonical: null } : v.kind === "http-www" ? { ...v, chain: [v.url, `https://www.example.com/`, abs("/")], hops: [301, 301] } : v));
  const m = byId(checkCrawlability(ctx));
  assert.equal(m.get("crawl.canonical.entry")!.status, "fail");
  assert.equal(m.get("crawl.canonical.entry")!.severity, "high");
  assert.equal(m.get("crawl.url-variants")!.status, "warn");
  assert.equal(m.get("crawl.redirect.chains")!.status, "warn", "2 hops → warn");
  assert.equal(m.get("crawl.robots.ai-crawlers")!.status, "info");
  assert.ok(/aeoeye\.com/.test(m.get("crawl.robots.ai-crawlers")!.fix), "cross-sell link present");
});

test("structured: article schema only judged on article pages; product na without product pages", () => {
  const ctx = healthySite();
  ctx.pages = ctx.pages.map((p) => (p.pageType === "article" ? { ...p, jsonLdTypes: ["BreadcrumbList"] } : p));
  const m = byId(checkStructured(ctx));
  assert.equal(m.get("schema.article")!.status, "fail");
  assert.equal(m.get("schema.article")!.affectedCount, 8);
  assert.equal(m.get("schema.product")!.status, "na");
  assert.equal(m.get("schema.deprecated")!.status, "info");
  const ctx2 = healthySite();
  ctx2.probe.ogImage = { url: abs("/og.png"), status: 404, bytes: null, contentType: "text/html" };
  assert.equal(byId(checkStructured(ctx2)).get("schema.og")!.status, "warn");
});

test("helpers: page type heuristic, tokens/jaccard, url normalisation", () => {
  assert.equal(pageTypeOf(makePage({ url: abs("/"), pageType: undefined })), "home");
  assert.equal(pageTypeOf(makePage({ url: abs("/blog/how-to-fix-crawl-errors"), pageType: undefined })), "article");
  assert.equal(pageTypeOf(makePage({ url: abs("/products/blue-widget"), pageType: undefined })), "product");
  assert.equal(pageTypeOf(makePage({ url: abs("/privacy"), pageType: undefined })), "legal");
  assert.equal(pageTypeOf(makePage({ url: abs("/pricing"), pageType: undefined })), "pricing");
  assert.equal(pageTypeOf(makePage({ url: abs("/tools"), pageType: undefined, wordCount: 120 })), "other");
  assert.equal(jaccard(tokenize("How to fix crawl errors"), tokenize("fix crawl errors fast")), 3 / 4);
  assert.equal(normalizeUrl("https://WWW.Example.com/a/index.html?utm_source=x&b=1#frag"), "https://example.com/a?b=1");
  assert.equal(urlKey("http://example.com/pricing/"), urlKey("https://www.example.com/pricing"));
});

/* ---------------- 复审 C18:sitemap 索引不重复计数 ---------------- */

test("sitemap index + 2 children of 30,000 URLs: totals count leaves once, no false 50,000-URL failure", () => {
  const ctx = healthySite();
  const leaf = (n: number) => ({ url: abs(`/sitemap-${n}.xml`), status: 200, valid: true, isIndex: false, urlCount: 30_000, lastmodShare: 1, newestLastmod: new Date().toISOString(), children: [] as string[] });
  // sitemap.ts 把子文件条数汇总写回索引行(60,000),子文件行本身也在数组里
  ctx.probe.sitemaps = [
    { url: abs("/sitemap.xml"), status: 200, valid: true, isIndex: true, urlCount: 60_000, lastmodShare: 1, newestLastmod: new Date().toISOString(), children: [abs("/sitemap-1.xml"), abs("/sitemap-2.xml")] },
    leaf(1),
    leaf(2),
    { url: abs("/sitemap_index.xml"), status: 404, valid: false, isIndex: false, urlCount: 0, lastmodShare: 0, newestLastmod: null, children: [], error: "HTTP 404" },
  ];
  const m = byId(checkCrawlability(ctx));
  const found = m.get("crawl.sitemap.found")!;
  assert.equal(found.status, "pass");
  assert.match(found.evidence[0], /2 sitemap file\(s\) listing 60000 URLs and 1 sitemap index file\(s\)/, found.evidence[0]);
  assert.ok(!/120000/.test(found.evidence.join(" ")), "no double count");
  const valid = m.get("crawl.sitemap.valid")!;
  assert.equal(valid.status, "pass", valid.evidence[0]);
  assert.match(valid.evidence[0], /60000 URLs; largest file 30000 URLs/);

  // 真正超限的是叶子文件:单个 60,000 条的 urlset 照样 fail,且只点名它
  const big = healthySite();
  big.probe.sitemaps = [{ url: abs("/sitemap.xml"), status: 200, valid: true, isIndex: false, urlCount: 60_000, lastmodShare: 1, newestLastmod: null, children: [] }];
  const v2 = byId(checkCrawlability(big)).get("crawl.sitemap.valid")!;
  assert.equal(v2.status, "fail");
  assert.deepEqual(v2.affected, [abs("/sitemap.xml")]);

  // 索引列了没读到的子文件:证据要说明总数只是下界
  const partial = healthySite();
  partial.probe.sitemaps = [
    { url: abs("/sitemap.xml"), status: 200, valid: true, isIndex: true, urlCount: 30_000, lastmodShare: 1, newestLastmod: null, children: [abs("/sitemap-1.xml"), abs("/sitemap-2.xml"), abs("/sitemap-3.xml")] },
    leaf(1),
  ];
  const f3 = byId(checkCrawlability(partial)).get("crawl.sitemap.found")!;
  assert.ok(f3.evidence.some((e) => /2 more child sitemap\(s\) that were not read/.test(e)), f3.evidence.join(" | "));
});

/* ---------------- 复审 C20:证书失败走 gate,不是"防火墙拦截" ---------------- */

test("expired certificate: sec.https + sec.tls.expired gates fail with the TLS error string; no firewall advice, no fake content failures", () => {
  for (const withEntryPage of [true, false]) {
    const ctx = tlsBrokenSite({ withEntryPage });
    const checks = runAllOnsiteChecks(ctx);
    const m = byId(checks);
    const https = m.get("sec.https")!;
    assert.equal(https.status, "fail");
    assert.equal(https.gate, true);
    assert.ok(https.evidence.some((e) => e.includes("CERT_HAS_EXPIRED: certificate has expired")), https.evidence.join(" | "));
    const expired = m.get("sec.tls.expired")!;
    assert.equal(expired.status, "fail");
    assert.equal(expired.gate, true);
    assert.ok(expired.evidence.join(" ").includes("certificate has expired"), expired.evidence.join(" | "));
    assert.equal(m.get("sec.tls.expiring")!.status, "na", "expiry is not double-counted");

    const blocked = m.get("crawl.blocked")!;
    assert.equal(blocked.status, "na", "a certificate failure is not a firewall block");
    assert.ok(/certificate/i.test(blocked.evidence[0]) && !/AEOeyeBot/.test(blocked.evidence[0] + blocked.fix), blocked.evidence[0]);
    for (const c of checks) assert.ok(!/Allow AEOeyeBot/.test(c.evidence.join(" ")), `${c.id} must not tell the owner to allow-list our crawler`);

    // 入口没读到 → 内容类入口检查一律 na,不能报"缺 viewport / 缺 OG"
    for (const id of ["mobile.viewport", "onpage.lang", "schema.og", "schema.organization", "crawl.entry.indexable", "crawl.canonical.entry", "sec.hsts", "sec.headers"]) {
      const c = m.get(id)!;
      assert.equal(c.status, "na", `${id} should be na when the homepage did not load (got ${c.status}: ${c.evidence[0]})`);
      assert.ok(/did not load|certificate/i.test(c.evidence[0]), `${id} says why: ${c.evidence[0]}`);
    }
    const entryStatus = m.get("crawl.entry.status")!;
    assert.equal(entryStatus.status, "fail");
    assert.ok(/certificate error/.test(entryStatus.evidence[0]), entryStatus.evidence[0]);
    assert.ok(/certificate/i.test(entryStatus.fix), "fix points at the certificate");

    const dims = scoreDimensions(checks, { unlocked: false });
    const o = overallScore(dims, checks);
    assert.ok(o.score <= GATE_OVERALL_CAP, `overall ${o.score}`);
    assert.equal(o.grade, "F");
    for (const id of ["sec.https", "sec.tls.expired"]) assert.ok(o.blockers.includes(id), `blocker ${id} (got ${o.blockers.join(", ")})`);
  }
});

test("hostname mismatch: sec.https fails with the error; sec.tls.expired passes on dates; flaky handshake alone is not a gate", () => {
  const mismatch = "ERR_TLS_CERT_ALTNAME_INVALID: Hostname/IP does not match certificate's altnames: Host: example.com. is not in the cert's altnames: DNS:www.example.com";
  const ctx = tlsBrokenSite({ message: mismatch, tls: { validTo: daysAheadIso(200), daysLeft: 200, issuer: "R11", coversWww: true, error: "hostname mismatch: Host: example.com. is not in the cert's altnames" } });
  const m = byId(checkSecurity(ctx));
  assert.equal(m.get("sec.https")!.status, "fail");
  assert.ok(m.get("sec.https")!.evidence[0].includes("ERR_TLS_CERT_ALTNAME_INVALID"), m.get("sec.https")!.evidence[0]);
  assert.match(m.get("sec.https")!.fix, /names include example\.com/);
  assert.equal(m.get("sec.tls.expired")!.status, "pass", "dates are fine — the mismatch is reported by sec.https, not as expiry");
  assert.ok(m.get("sec.tls.expired")!.evidence.some((e) => /fails for another reason/.test(e)));

  // 主机自己的证书没过期,入口跳转到的 www 上的证书过期了:仍是 expiry gate,证据说清是哪张证书
  const redirected = tlsBrokenSite({ tls: { validTo: daysAheadIso(90), daysLeft: 90, issuer: "R11", coversWww: true, error: null } });
  const r = byId(checkSecurity(redirected));
  assert.equal(r.get("sec.https")!.status, "fail");
  assert.equal(r.get("sec.tls.expired")!.status, "fail");
  assert.ok(r.get("sec.tls.expired")!.evidence[0].includes("CERT_HAS_EXPIRED"), r.get("sec.tls.expired")!.evidence[0]);
  assert.ok(r.get("sec.tls.expired")!.evidence.some((e) => /served by a host/.test(e)));
  assert.equal(r.get("sec.tls.expiring")!.status, "na");

  // 入口照常可达、只是独立握手超时:不是证书问题,两个 gate 都不能 fail
  const flaky = healthySite();
  flaky.probe.tls = { validTo: null, daysLeft: null, issuer: null, coversWww: null, error: "handshake timed out" };
  const f = byId(checkSecurity(flaky));
  assert.equal(f.get("sec.https")!.status, "pass");
  assert.equal(f.get("sec.tls.expired")!.status, "na");
  assert.match(f.get("sec.tls.expired")!.evidence[0], /handshake timed out/);

  // 旧数据兜底:crawl.ts 旧版把证书失败记成 blocked(kind "tls", detected true)
  const legacy = healthySite();
  legacy.probe.blocked = { detected: true, kind: "tls", evidence: "CERT_HAS_EXPIRED: certificate has expired" };
  legacy.pages = [];
  legacy.entry = null;
  const l = byId(runAllOnsiteChecks(legacy));
  assert.equal(l.get("crawl.blocked")!.status, "na");
  assert.equal(l.get("sec.https")!.status, "fail");
  for (const c of l.values()) assert.ok(!/Allow AEOeyeBot/.test(c.evidence.join(" ")), `${c.id} must not blame a firewall`);
});

/* ---------------- 复审 C21:子域名没有 www.<子域>,不能扣分 ---------------- */

test("subdomain without a www counterpart: alt-host variants are ignored instead of warned", () => {
  const ctx = subdomainSite();
  const checks = runAllOnsiteChecks(ctx);
  const m = byId(checks);
  assert.equal(m.get("crawl.https.redirect")!.status, "pass", m.get("crawl.https.redirect")!.evidence.join(" | "));
  assert.equal(m.get("crawl.host.canonical")!.status, "na");
  assert.match(m.get("crawl.host.canonical")!.evidence[0], new RegExp(`www\\.${SUB_HOST.replace(/\./g, "\\.")} does not exist`));
  assert.equal(m.get("crawl.redirect.chains")!.status, "pass");
  const variants = m.get("sec.https.variants")!;
  assert.equal(variants.status, "pass", variants.evidence.join(" | "));
  assert.ok(variants.evidence.some((e) => /has no DNS record/.test(e)));
  const www = m.get("sec.tls.www")!;
  assert.equal(www.status, "na");
  assert.equal(www.evidence[0], `No www.${SUB_HOST} host exists — nothing to cover.`);
  assert.deepEqual(checks.filter((c) => c.status === "warn" || c.status === "fail").map((c) => c.id), [], "a healthy subdomain site has nothing to fix");

  // 另一主机"存在性未知"(旧数据 / DNS 以外的失败)时维持原判:没响应仍然提示
  const unknown = byId(runAllOnsiteChecks(subdomainSite({ altHostExists: null })));
  assert.equal(unknown.get("sec.https.variants")!.status, "warn");
  assert.equal(unknown.get("crawl.https.redirect")!.status, "warn");
});

/* ---------------- 复审 C22:JS 空壳页上的正文类检查 na ---------------- */

test("JavaScript shell entry: rendered-content checks are na with the raw-HTML note; head checks still score", () => {
  const ctx = jsShellSite();
  const checks = runAllOnsiteChecks(ctx);
  const m = byId(checks);
  for (const id of ["onpage.h1.missing", "onpage.h1.multiple", "onpage.headings.order", "onpage.title.h1-slug-overlap", "onpage.images.alt", "onpage.near-duplicate", "onpage.thin", "onpage.robots-nofollow"]) {
    const c = m.get(id)!;
    assert.equal(c.status, "na", `${id} should be na on a JS shell (got ${c.status}: ${c.evidence[0]})`);
    assert.match(c.evidence[0], /^Not measured: based on raw HTML, which is a JavaScript shell/, id);
  }
  for (const id of ["onpage.title.present", "onpage.title.length", "onpage.description.present", "onpage.url.hygiene", "onpage.lang"]) {
    assert.equal(m.get(id)!.status, "pass", `${id} is a <head>/URL signal and is still judged`);
  }
  assert.equal(m.get("crawl.js-dependent")!.status, "warn");
  const onpage = scoreDimensions(checks, { unlocked: false }).find((d) => d.id === "onpage")!;
  assert.equal(typeof onpage.score, "number", "On-Page still has ≥3 measurable checks");

  // 入口是壳、其余页是服务端渲染:正文类检查照常评其余页,并说明排除了谁
  const mixed = byId(runAllOnsiteChecks(jsShellSite({ extraPages: 6 })));
  const h1 = mixed.get("onpage.h1.missing")!;
  assert.equal(h1.status, "pass");
  assert.ok(h1.evidence[0].startsWith("Across 6 crawled pages"), h1.evidence[0]);
  assert.ok(h1.evidence.some((e) => /1 JavaScript-shell page\(s\) excluded/.test(e)));
});
