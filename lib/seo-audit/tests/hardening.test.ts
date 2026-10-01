/* ============================================================
   hardening v2 —— 纯离线测试(不联网、不碰数据库)
   覆盖:clientIp 信任顺序、配额桶名 / IP 归桶 / 日哈希 / 判定、deadline 工具、
   进度百分比、前置门推断(blocked / jsDependent)、升级模块存在性、导出剥离。
   运行:npm run test:seo
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";

// @/lib/env 在 import 时校验 DATABASE_URL —— 必须在动态 import 之前把测试用环境放好。
// **无条件覆盖**成一个解析不了的主机(.invalid 是 RFC 2606 保留域名):这些测试绝不能碰真实库 ——
// shell / CI 里导出了真的 DATABASE_URL 时,||= 会让配额测试真的往生产库写桶;
// QuotaUnavailableError 那条测试也正是靠"库连不上"来验证放行语义。
process.env.DATABASE_URL = "postgres://test:test@db.invalid:5432/test";
process.env.CRON_SECRET ||= "test-secret";

import { clientIp, rateLimit } from "../../ratelimit";
import type { CrawledPage, SeoAuditResult, AuthorityResult, VisibilityResult, CompetitorsResult } from "../types";

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

/* ---------- clientIp ---------- */

test("clientIp trusts x-real-ip first and ignores cf-connecting-ip", () => {
  assert.equal(clientIp(headers({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "9.9.9.9", "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "9.9.9.9");
  assert.equal(clientIp(headers({ "cf-connecting-ip": "1.1.1.1" })), "unknown");
});

test("clientIp falls back to x-vercel-forwarded-for then x-forwarded-for (first hop)", () => {
  assert.equal(clientIp(headers({ "x-vercel-forwarded-for": "5.5.5.5, 6.6.6.6", "x-forwarded-for": "7.7.7.7" })), "5.5.5.5");
  assert.equal(clientIp(headers({ "x-forwarded-for": " 7.7.7.7 , 8.8.8.8" })), "7.7.7.7");
  assert.equal(clientIp(headers({})), "unknown");
});

test("rateLimit still works as the cheap in-process layer", () => {
  const key = `t:${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, { limit: 3, windowMs: 60_000 }).ok, true);
  const r = rateLimit(key, { limit: 3, windowMs: 60_000 });
  assert.equal(r.ok, false);
  assert.ok(r.retryAfter >= 1);
});

/* ---------- quota(纯函数部分) ---------- */

test("ipBucketKey keeps IPv4, unwraps IPv4-mapped and buckets IPv6 by /64", async () => {
  const { ipBucketKey } = await import("../quota");
  assert.equal(ipBucketKey("203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucketKey("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucketKey("2001:db8:85a3:1234:8a2e:370:7334:1"), "2001:0db8:85a3:1234::/64");
  assert.equal(ipBucketKey("2001:db8:85a3:1234::1"), "2001:0db8:85a3:1234::/64");
  assert.equal(ipBucketKey("2001:db8:85a3:1234:ffff:ffff:ffff:ffff%eth0"), "2001:0db8:85a3:1234::/64");
  assert.equal(ipBucketKey(""), "unknown");
  assert.equal(ipBucketKey("not-an-ip"), "not-an-ip");
});

test("ipHash is 32 hex chars, stable within a day, different across days and per /64", async () => {
  const { ipHash } = await import("../quota");
  const d1 = new Date("2026-09-30T10:00:00Z");
  const d1b = new Date("2026-09-30T23:59:59Z");
  const d2 = new Date("2026-10-01T00:00:01Z");
  const a = ipHash("203.0.113.9", d1);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(ipHash("203.0.113.9", d1b), a);
  assert.notEqual(ipHash("203.0.113.9", d2), a);
  assert.notEqual(ipHash("203.0.113.10", d1), a);
  // 同一 /64 内的两个 IPv6 地址落同一桶
  assert.equal(ipHash("2001:db8:85a3:1234::1", d1), ipHash("2001:db8:85a3:1234:aaaa::9", d1));
});

test("decideQuota: ok while n <= limit, retryAfter counts down to the window reset", async () => {
  const { decideQuota } = await import("../quota");
  const start = new Date("2026-09-30T10:00:00Z");
  const now = new Date("2026-09-30T10:10:00Z");
  assert.deepEqual(decideQuota(5, start, 3_600_000, 5, now), { ok: true, n: 5, retryAfterSec: 0 });
  const denied = decideQuota(6, start, 3_600_000, 5, now);
  assert.equal(denied.ok, false);
  assert.equal(denied.n, 6);
  assert.equal(denied.retryAfterSec, 50 * 60);
  // 窗口已过但计数还没重置(不该发生,但 retryAfter 至少 1s 而不是负数)
  assert.equal(decideQuota(9, start, 60_000, 5, now).retryAfterSec, 1);
});

test("bucket names and limits match V2-0 (+ copy / rerun buckets from the review)", async () => {
  const { bucketFor, QUOTA, domainKey } = await import("../quota");
  assert.equal(bucketFor.ipHour("abc"), "ip:abc:1h");
  assert.equal(bucketFor.ipDay("abc"), "ip:abc:24h");
  assert.equal(bucketFor.userDay("u1"), "user:u1:24h");
  assert.equal(bucketFor.domainHour("Example.com"), `domain:${domainKey("example.com")}:1h`);
  assert.equal(bucketFor.fresh("user:u1", "Example.com"), `fresh:user:u1:${domainKey("example.com")}:1h`);
  assert.equal(bucketFor.globalHour(), "global:1h");
  assert.equal(bucketFor.psiDay(), "psi:24h");
  assert.equal(bucketFor.copyHour("user:u1"), "copy:user:u1:1h");
  assert.equal(bucketFor.rerunHour("Ab3dE5gH7jK"), "rerun:Ab3dE5gH7jK:1h");
  assert.equal(bucketFor.rerunDay("Ab3dE5gH7jK"), "rerun:Ab3dE5gH7jK:24h");
  assert.equal(QUOTA.ipHour.limit, 5);
  assert.equal(QUOTA.ipDayAnonymous.limit, 3);
  assert.equal(QUOTA.userDay.limit, 20);
  assert.equal(QUOTA.domainHour.limit, 6);
  assert.equal(QUOTA.globalHour.limit, 120);
  assert.equal(QUOTA.freshHour.limit, 1);
  assert.equal(QUOTA.psiDay.limit, 1500);
  assert.equal(QUOTA.copyHour.limit, 20);
  assert.equal(QUOTA.rerunHour.limit, 6);
  assert.equal(QUOTA.rerunDay.limit, 30);
});

test("C9: domain buckets use a fixed-length digest, so even a 253-char host can never make a bucket name invalid", async () => {
  const { bucketFor, domainKey, quotaSubject, ipHash } = await import("../quota");
  const label = (n: number, c: string) => c.repeat(n);
  const longHost = `${label(63, "a")}.${label(63, "b")}.${label(63, "c")}.${label(53, "d")}.evil.co`; // 253 字符(主机名上限)
  assert.equal(longHost.length, 253);
  assert.match(domainKey(longHost), /^[0-9a-f]{32}$/);
  assert.equal(domainKey(" EXAMPLE.com "), domainKey("example.com"), "case / whitespace insensitive");
  assert.notEqual(domainKey("a.example.com"), domainKey("b.example.com"));
  const subjects = [quotaSubject({ ipHash: ipHash("203.0.113.9") }), quotaSubject({ userId: "user_2NNEqL2nrIRdJ194ndJqAHwEfxC", ipHash: "x" })];
  for (const who of subjects) {
    for (const b of [bucketFor.domainHour(longHost), bucketFor.fresh(who, longHost), bucketFor.copyHour(who)]) {
      assert.ok(b.length <= 200, `${b.length} chars: ${b}`);
      assert.ok(!b.includes("aaaa"), "the raw host never appears in a bucket name");
    }
  }
  assert.equal(quotaSubject({ userId: "u1", ipHash: "h" }), "user:u1");
  assert.equal(quotaSubject({ userId: null, ipHash: "h" }), "h");
});

test("C9: only database failures raise QuotaUnavailableError (fail-open); an invalid bucket is a plain Error (fail-closed)", async () => {
  const { consumeQuota, consumeRunQuotas, consumeRerunQuotas, consumeCopyQuota, QuotaUnavailableError } = await import("../quota");
  // 桶名非法:确定性错误,在碰数据库之前就抛,且**不是** QuotaUnavailableError
  await assert.rejects(consumeQuota("x".repeat(201), 1000, 1), (e: unknown) => e instanceof Error && !(e instanceof QuotaUnavailableError));
  await assert.rejects(consumeQuota("", 1000, 1), (e: unknown) => !(e instanceof QuotaUnavailableError));
  // 测试环境的 DATABASE_URL 指向一个不存在的库:任何真实计数都会失败 → 必须是 QuotaUnavailableError
  const unavailable = (e: unknown) => e instanceof QuotaUnavailableError && e.name === "QuotaUnavailableError";
  await assert.rejects(consumeQuota("qa-test-bucket", 1000, 1), unavailable);
  await assert.rejects(consumeRunQuotas({ ipHash: "h", userId: null, domain: "example.com", fresh: true }), unavailable);
  await assert.rejects(consumeRerunQuotas("Ab3dE5gH7jK"), unavailable);
  await assert.rejects(consumeCopyQuota("h"), unavailable);
});

test("retryInWords reads like a person wrote it", async () => {
  const { retryInWords } = await import("../quota");
  assert.equal(retryInWords(1), "a minute");
  assert.equal(retryInWords(60), "a minute");
  assert.equal(retryInWords(61), "2 minutes");
  assert.equal(retryInWords(3600), "1 hour");
  assert.equal(retryInWords(3 * 3600), "3 hours");
});

/* ---------- run.ts 工具 ---------- */

test("untilDeadline resolves the fallback at the deadline and the value before it", async () => {
  const { createDeadline, untilDeadline } = await import("../run");
  const d = createDeadline(1_000);
  try {
    const fast = await untilDeadline(Promise.resolve("v"), d, "fast", () => "fallback");
    assert.equal(fast, "v");
    const never = new Promise<string>(() => {});
    const t0 = Date.now();
    const late = await untilDeadline(never, d, "slow", () => "fallback");
    assert.equal(late, "fallback");
    assert.ok(Date.now() - t0 >= 900 && Date.now() - t0 < 3_000);
    assert.equal(d.expired(), true);
    await assert.rejects(untilDeadline(never, d, "no-fallback"), /deadline/);
  } finally {
    d.dispose();
  }
});

test("percentFor is monotonic across stages and scales crawling by pages", async () => {
  const { percentFor } = await import("../run");
  assert.equal(percentFor("queued"), 0);
  assert.equal(percentFor("probing"), 8);
  assert.equal(percentFor("crawling", 0, 20), 15);
  assert.equal(percentFor("crawling", 10, 20), 38);
  assert.equal(percentFor("crawling", 40, 20), 60);
  assert.equal(percentFor("pagespeed"), 70);
  assert.equal(percentFor("scoring"), 90);
  assert.equal(percentFor("done"), 100);
});

function page(over: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://site.test/",
    finalUrl: "https://site.test/",
    status: 200,
    redirects: 0,
    contentType: "text/html",
    bytes: 30_000,
    fetchedMs: 100,
    depth: 0,
    title: "Home",
    description: "",
    h1s: ["Home"],
    headings: [],
    wordCount: 400,
    textToHtml: 0.2,
    canonical: null,
    robotsMeta: null,
    xRobotsTag: null,
    lang: "en",
    viewport: null,
    images: { total: 0, missingAlt: 0 },
    internalLinks: 12,
    externalLinks: 1,
    links: [],
    genericAnchors: 0,
    jsonLdTypes: [],
    jsonLdErrors: 0,
    og: {},
    twitter: {},
    hreflang: [],
    mixedContent: 0,
    hasBreadcrumbSchema: false,
    hasFavicon: true,
    issues: [],
    ...over,
  };
}

const probeBase = {
  entryUrl: "https://site.test/",
  headers: { hsts: null, csp: null, xContentTypeOptions: null, xFrameOptions: null, referrerPolicy: null, server: null, xRobotsTag: null },
};

test("deriveBlocked: 403/401 → forbidden, 429 → rate-limited, TLS error → tls, challenge title → challenge, 200 → not blocked", async () => {
  const { deriveBlocked } = await import("../run");
  const at = (status: number, extra: Partial<{ error: string; server: string }> = {}) =>
    deriveBlocked({ ...probeBase, headers: { ...probeBase.headers, server: extra.server ?? null }, entry: { status, finalUrl: "https://site.test/", ms: 10, ...(extra.error ? { error: extra.error } : {}) } });
  assert.equal(at(403).kind, "forbidden");
  assert.equal(at(401).detected, true);
  assert.equal(at(429).kind, "rate-limited");
  assert.equal(at(0, { error: "unable to verify the first certificate" }).kind, "tls");
  assert.equal(at(503, { server: "cloudflare" }).kind, "challenge");
  assert.equal(at(503).detected, false, "a plain 503 is an outage, not a firewall");
  assert.equal(at(200).detected, false);
  const challenge = deriveBlocked({ ...probeBase, entry: { status: 200, finalUrl: "https://site.test/", ms: 10 } }, page({ title: "Just a moment..." }));
  assert.equal(challenge.kind, "challenge");
  // crawl.ts 自己填了就以它为准
  const own = { detected: true as const, kind: "waf" as const, evidence: "x" };
  assert.deepEqual(deriveBlocked({ ...probeBase, blocked: own, entry: { status: 200, finalUrl: "", ms: 1 } }), own);
});

test("deriveJsDependent: honours probe/jsShell, falls back to a conservative heuristic, undefined without an entry page", async () => {
  const { deriveJsDependent } = await import("../run");
  assert.equal(deriveJsDependent({ jsDependent: true }, page()), true);
  assert.equal(deriveJsDependent({}, page({ jsShell: true })), true);
  assert.equal(deriveJsDependent({}, page({ jsShell: false, wordCount: 5 })), false);
  assert.equal(deriveJsDependent({}, page({ wordCount: 20, internalLinks: 1, bytes: 50_000 })), true);
  assert.equal(deriveJsDependent({}, page({ wordCount: 20, internalLinks: 1, bytes: 1_000 })), false, "tiny page is just thin, not a JS shell");
  assert.equal(deriveJsDependent({}, page()), false);
  assert.equal(deriveJsDependent({}, null), undefined);
  assert.equal(deriveJsDependent({}, page({ status: 500 })), undefined);
});

function result(over: Partial<SeoAuditResult> = {}): SeoAuditResult {
  return {
    version: 1,
    plan: "free",
    input: "site.test",
    entryUrl: "https://site.test/",
    domain: "site.test",
    generatedAt: "2026-09-30T10:00:00.000Z",
    durationMs: 1,
    overall: { score: 70, grade: "B" },
    dimensions: [],
    checks: [],
    pages: [page()],
    probe: { ...probeBase, input: "site.test", origin: "https://site.test", host: "site.test", variants: [], robots: { url: "", status: null, found: false, disallowAll: false, blocksEntry: false, sitemaps: [], bytes: 0 }, sitemaps: [], soft404: { probeUrl: "", status: null, isSoft404: false } },
    psi: { mobile: null, desktop: null },
    topIssues: [],
    roadmap: null,
    authority: null,
    visibility: null,
    competitors: null,
    cost: { dataforseoUsd: 0, calls: 0 },
    meta: { pagesCrawled: 1, pagesRequested: 20, crawlLimited: false, notes: [], lockedSections: [] },
    ...over,
  };
}

test("presentModules: free result has nothing; merged modules are detected so retries only redo the missing ones", async () => {
  const { presentModules } = await import("../run");
  const free = presentModules(result());
  assert.deepEqual(free, { crawl40: false, psiDesktop: false, authority: false, visibility: false, competitors: false });
  const auth: AuthorityResult = { rank: 1, backlinks: 1, referringDomains: 1, referringMainDomains: 1, referringIps: 1, nofollowShare: 0, spamScore: 0, brokenBacklinks: 0, brokenPages: 0, firstSeen: null, tld: {}, linkTypes: {}, anchors: [], score: 50 };
  const partial = presentModules(result({ authority: auth, meta: { pagesCrawled: 40, pagesRequested: 40, crawlLimited: true, notes: [], lockedSections: [] }, pages: [page()] }));
  assert.equal(partial.authority, true);
  assert.equal(partial.crawl40, true);
  assert.equal(partial.visibility, false);
});

test("confidenceFor flags architecture as low confidence under 5 pages and lists unmeasured dimensions", async () => {
  const { confidenceFor } = await import("../run");
  const dims = [
    { id: "crawlability" as const, label: "x", score: 80, weight: 25, pass: 1, warn: 0, fail: 0, na: 0, locked: false, summary: "" },
    { id: "performance" as const, label: "x", score: null, weight: 15, pass: 0, warn: 0, fail: 0, na: 3, locked: false, summary: "" },
    { id: "authority" as const, label: "x", score: null, weight: 0, pass: 0, warn: 0, fail: 0, na: 0, locked: true, summary: "" },
  ];
  const c = confidenceFor(dims, [page(), page()]);
  assert.equal(c.pagesSampled, 2);
  assert.deepEqual(c.lowConfidence, ["architecture"]);
  assert.deepEqual(c.unmeasured, ["performance"]);
  assert.deepEqual(confidenceFor(dims, Array.from({ length: 6 }, () => page())).lowConfidence, []);
});

/* ---------- export ---------- */

test("toExportView strips DataForSEO raw rows but keeps aggregates and derived metrics", async () => {
  const { toExportView, EXPORT_NOTE } = await import("../export");
  const authority: AuthorityResult = {
    rank: 40, backlinks: 900, referringDomains: 120, referringMainDomains: 110, referringIps: 100, nofollowShare: 0.2, spamScore: 5, brokenBacklinks: 3, brokenPages: 1,
    firstSeen: "2020-01-01", tld: { com: 80 }, linkTypes: { anchor: 900 }, score: 66,
    anchors: [{ anchor: "brand", backlinks: 600, referringDomains: 50 }, { anchor: "click here", backlinks: 300, referringDomains: 20 }],
    timeseries: [{ month: "2026-08", newReferringDomains: 3, lostReferringDomains: 1 }],
  };
  const visibility: VisibilityResult = {
    organicKeywords: 800, etv: 1234, positions: { pos1: 5, pos2_3: 10, pos4_10: 30, pos11_20: 40, pos21_50: 100, pos51_100: 200 },
    movement: { isNew: 3, isUp: 4, isDown: 2, isLost: 1 },
    topKeywords: [{ keyword: "secret kw", position: 3, volume: 100, etv: 10, url: null, intent: null, cpc: null }],
    quickWins: [{ keyword: "another kw", position: 12, volume: 100, etv: 1, url: null, intent: null, cpc: null }],
    score: 55, brandKeywords: 100, nonBrandKeywords: 700, aiOverviewShare: 0.3,
  };
  const competitors: CompetitorsResult = { items: [{ domain: "rival.test", intersections: 50, avgPosition: 8, etv: 5000, organicKeywords: 900 }], score: 40 };
  const out = toExportView(result({ plan: "full", authority, visibility, competitors }));
  const json = JSON.stringify(out);
  assert.equal(out.exportNote, EXPORT_NOTE);
  assert.ok(!json.includes("secret kw") && !json.includes("another kw"), "keyword rows must not leak");
  assert.ok(!json.includes("click here"), "anchor rows must not leak");
  assert.ok(!("anchors" in (out.authority as object)) && !("topKeywords" in (out.visibility as object)) && !("items" in (out.competitors as object)));
  assert.equal(out.authority?.referringDomains, 120);
  assert.equal(out.authority?.anchorsCount, 2);
  assert.equal(out.authority?.topAnchorShare, 0.667);
  assert.deepEqual(out.authority?.timeseries, authority.timeseries);
  assert.equal(out.visibility?.organicKeywords, 800);
  assert.equal(out.visibility?.topKeywordsCount, 1);
  assert.equal(out.visibility?.quickWinsCount, 1);
  assert.deepEqual(out.visibility?.positions, visibility.positions);
  assert.equal(out.competitors?.itemsCount, 1);
  assert.deepEqual(out.competitors?.domains, ["rival.test"]);
  assert.equal(out.competitors?.score, 40);
  assert.equal(out.plan, "full");
  assert.equal(out.pages.length, 1, "our own crawl data stays");
  assert.equal(toExportView(result()).authority, null);
});

test("toExportView drops our internal cost ledger and never exports a cached-from source id", async () => {
  const { toExportView } = await import("../export");
  const base = result({ plan: "full", cost: { dataforseoUsd: 0.083, calls: 6 } });
  const out = toExportView({ ...base, meta: { ...base.meta, cachedFrom: "Ab3dE5gH7jK" } });
  assert.equal("cost" in out, false, "cost is not part of the export");
  assert.ok(!JSON.stringify(out).includes("0.083"));
  assert.ok(out.meta.cachedFrom && out.meta.cachedFrom !== "Ab3dE5gH7jK", "legacy source id replaced");
  assert.ok(!JSON.stringify(out).includes("Ab3dE5gH7jK"));
  const ts = toExportView({ ...base, meta: { ...base.meta, cachedFrom: "2026-09-30T08:00:00.000Z" } });
  assert.equal(ts.meta.cachedFrom, "2026-09-30T08:00:00.000Z");
  assert.equal(toExportView(base).meta.cachedFrom, null);
});
