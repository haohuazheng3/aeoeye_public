/* ============================================================
   DataForSEO 付费模块 —— 纯离线测试
   fixture 全部录自 sandbox.dataforseo.com(免费,静态假数据),fetch 被 mock,
   这里一个字节都不会发到网上。运行:npx tsx --test lib/seo-audit/tests/dataforseo.test.ts
   ============================================================ */
import { test, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// @/lib/env 在 import 时校验 DATABASE_URL —— 必须在动态 import 之前把测试用环境放好
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.DATAFORSEO_B64 = "dGVzdDp0ZXN0"; // base64("test:test"),假凭据,fetch 已被 mock
process.env.DATAFORSEO_SANDBOX = "1";

type Task = { status_code: number; status_message?: string; cost: number; result: Array<Record<string, unknown>> | null };
type Envelope = { status_code: number; status_message?: string; tasks: Task[] };

const FIXTURES = (() => {
  try {
    return path.join(__dirname, "fixtures");
  } catch {
    return path.join(process.cwd(), "lib/seo-audit/tests/fixtures");
  }
})();

function fixture(name: string): Envelope {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as Envelope;
}

function result0<T>(e: Envelope): T {
  return e.tasks[0].result![0] as T;
}

function envelope(result: Array<Record<string, unknown>> | null, cost = 0, status = 20000): Envelope {
  return { status_code: 20000, tasks: [{ status_code: status, status_message: status === 20000 ? "Ok." : "Error", cost, result }] };
}

type Call = { url: string; body: Record<string, unknown> | null };

/** 按端点片段路由的 fetch mock;返回每次调用的 URL 与请求体,方便断言参数 */
function installFetch(routes: Record<string, Envelope | (() => Envelope)>): Call[] {
  const calls: Call[] = [];
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    const body = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown> | null;
    calls.push({ url, body });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    const r = routes[key];
    const payload = typeof r === "function" ? r() : r;
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  });
  return calls;
}

let dfs: typeof import("../dataforseo");
let envMod: typeof import("@/lib/env");
let costMod: typeof import("@/lib/cost");

/** 重试退避的等待记录:测试里不真等 2s,只记下"要等多久" */
let slept: number[] = [];

before(async () => {
  dfs = await import("../dataforseo");
  envMod = await import("@/lib/env");
  costMod = await import("@/lib/cost");
  dfs.dfsRetryTiming.sleep = async (ms: number) => {
    slept.push(ms);
  };
});

afterEach(() => {
  mock.restoreAll();
  envMod.env.DATAFORSEO_SANDBOX = "1";
  envMod.env.DATAFORSEO_B64 = "dGVzdDp0ZXN0";
  slept = [];
});

const AUTH_ROUTES = () => ({
  "backlinks/summary/live": fixture("dfs-backlinks-summary"),
  "backlinks/anchors/live": fixture("dfs-backlinks-anchors"),
  "backlinks/timeseries_new_lost_summary/live": fixture("dfs-backlinks-new-lost"),
});

const VIS_ROUTES = () => ({
  "domain_rank_overview/live": fixture("dfs-domain-rank-overview"),
  "ranked_keywords/live": fixture("dfs-ranked-keywords"),
  "serp/google/organic/live/regular": fixture("dfs-serp-site"),
});

/* ---------------- authority ---------------- */

test("fetchAuthority maps sandbox summary/anchors/new-lost and hits the sandbox base URL", async () => {
  const calls = installFetch(AUTH_ROUTES());
  const a = await dfs.fetchAuthority("https://www.aeoeye.com/some/path");

  assert.equal(calls.length, 3);
  for (const c of calls) assert.ok(c.url.startsWith("https://sandbox.dataforseo.com/v3/"), c.url);
  assert.equal(calls[0].body?.target, "aeoeye.com");
  assert.equal(calls[0].body?.include_subdomains, true);
  const ts = calls.find((c) => c.url.includes("timeseries_new_lost_summary"))!;
  assert.equal(ts.body?.group_range, "month");
  const from = new Date(String(ts.body?.date_from)).getTime();
  const to = new Date(String(ts.body?.date_to)).getTime();
  assert.ok(Math.abs(to - from - 90 * 86_400_000) < 86_400_000, "date_from is 90 days before date_to");
  // 供应商只收早于它"今天"的 date_to(40501):截止日至少比 UTC 今天早 2 天
  const todayUtc = new Date(new Date().toISOString().slice(0, 10)).getTime();
  assert.ok(to <= todayUtc - 2 * 86_400_000, `date_to ${String(ts.body?.date_to)} is at least 2 days before today`);
  const anchors = calls.find((c) => c.url.includes("backlinks/anchors"))!;
  assert.equal(anchors.body?.limit, 20);

  assert.equal(a.noData, false);
  assert.equal(a.rank, 51);
  assert.equal(a.backlinks, 332685);
  assert.equal(a.referringDomains, 2952);
  assert.equal(a.referringMainDomains, 2803);
  assert.equal(a.referringIps, 2315);
  assert.equal(a.spamScore, 15);
  assert.equal(a.brokenBacklinks, 1130);
  assert.equal(a.brokenPages, 130);
  assert.equal(a.firstSeen, "2019-01-15");
  assert.equal(a.nofollowShare, 0);
  assert.equal(a.tld.jetzt, 231921);
  assert.equal(Object.keys(a.tld).length, 10);
  assert.equal(a.linkTypes.image, 237276);
  assert.equal(a.anchors.length, 10);
  assert.deepEqual(a.anchors[0], { anchor: "dataforseo.com", backlinks: 570, referringDomains: 215 });
  // 沙盒按天回 32 行(2021-12-01 … 2022-01-01),模块自己按月归并
  assert.deepEqual(a.timeseries, [
    { month: "2021-12", newReferringDomains: 195, lostReferringDomains: 30 },
    { month: "2022-01", newReferringDomains: 2, lostReferringDomains: 0 },
  ]);
  // rank 51 → 56;rd 2952 → 86.76;spam 15 → −3.75 ⇒ 0.6×56 + 0.4×86.76 − 3.75 = 64.55 → 65
  assert.equal(a.score, 65);
});

test("fetchAuthority (v3) maps referring-link semantic locations and platform types from the same summary response", async () => {
  const calls = installFetch(AUTH_ROUTES());
  const a = await dfs.fetchAuthority("aeoeye.com");
  assert.equal(calls.length, 3, "no extra request for the v3 fields");
  // 沙盒 summary 原样带着这两个分布;"" = 位置未知,保留给计分端自己剔除
  assert.deepEqual(a.semanticLocations, {
    "": 320802,
    article: 4244,
    section: 2312,
    main: 1274,
    header: 211,
    footer: 161,
    aside: 81,
    details: 61,
    figure: 21,
    nav: 5,
  });
  assert.deepEqual(a.platformTypes, {
    unknown: 241580,
    organization: 57549,
    blogs: 4074,
    cms: 3199,
    news: 1153,
    ecommerce: 394,
    "message-boards": 81,
  });
  // 按数量降序
  assert.deepEqual(Object.keys(a.platformTypes!).slice(0, 3), ["unknown", "organization", "blogs"]);
});

test("fetchAuthority (v3): missing distributions stay undefined (not measured ≠ zero); junk values are dropped", async () => {
  installFetch({
    "backlinks/summary/live": envelope([
      {
        rank: 40,
        backlinks: 120,
        referring_domains: 30,
        referring_links_semantic_locations: { article: 7, footer: 0, main: "3", nav: -1, section: Number.NaN },
      },
    ]),
    "backlinks/anchors/live": envelope([{ items: null }]),
    "backlinks/timeseries_new_lost_summary/live": envelope([{ items: null }]),
  });
  const a = await dfs.fetchAuthority("site.example");
  assert.deepEqual(a.semanticLocations, { article: 7 });
  assert.equal(a.platformTypes, undefined);
  assert.equal("platformTypes" in a, false, "absent rather than an explicit undefined key");

  mock.restoreAll();
  installFetch({ "backlinks/summary/live": envelope([{ backlinks: 0, referring_domains: 0 }]) });
  const none = await dfs.fetchAuthority("new.example");
  assert.equal(none.noData, true);
  assert.equal(none.semanticLocations, undefined);
  assert.equal(none.platformTypes, undefined);
});

test("fetchAuthority: zero backlinks → noData with zeros, no further calls", async () => {
  const calls = installFetch({
    "backlinks/summary/live": envelope([{ target: "new.example", rank: 0, backlinks: 0, referring_domains: 0 }]),
  });
  const a = await dfs.fetchAuthority("new.example");
  assert.equal(calls.length, 1);
  assert.equal(a.noData, true);
  assert.equal(a.score, 0);
  assert.equal(a.rank, null);
  assert.equal(a.referringDomains, 0);
  assert.deepEqual(a.anchors, []);
  assert.deepEqual(a.timeseries, []);
});

test("fetchAuthority: a rejected trend request (40501) leaves an empty trend, not a failed module", async () => {
  const warn = mock.method(console, "warn", () => undefined);
  installFetch({
    "backlinks/summary/live": fixture("dfs-backlinks-summary"),
    "backlinks/anchors/live": fixture("dfs-backlinks-anchors"),
    "backlinks/timeseries_new_lost_summary/live": {
      status_code: 20000,
      tasks: [{ status_code: 40501, status_message: "Invalid Field: 'date_to - must be earlier than present date'.", cost: 0, result: null }],
    },
  });
  const a = await dfs.fetchAuthority("aeoeye.com");
  assert.equal(a.noData, false);
  assert.equal(a.referringDomains, 2952, "summary data survive");
  assert.equal(a.anchors.length, 10, "anchors survive");
  assert.deepEqual(a.timeseries, []);
  assert.equal(warn.mock.callCount(), 1);
});

test("fetchAuthority: result [null] → noData rather than a throw", async () => {
  installFetch({ "backlinks/summary/live": envelope([null as unknown as Record<string, unknown>]) });
  const a = await dfs.fetchAuthority("new.example");
  assert.equal(a.noData, true);
});

test("authority score formula: strong site 94, weak spammy site 6", async () => {
  installFetch({
    "backlinks/summary/live": envelope([{ rank: 300, backlinks: 50000, referring_domains: 10000, backlinks_spam_score: 0 }]),
    "backlinks/anchors/live": envelope([{ items: null }]),
    "backlinks/timeseries_new_lost_summary/live": envelope([{ items: null }]),
  });
  const strong = await dfs.fetchAuthority("strong.example");
  assert.equal(strong.score, 94); // 0.6×90 + 0.4×100
  mock.restoreAll();
  installFetch({
    "backlinks/summary/live": envelope([{ rank: 20, backlinks: 40, referring_domains: 5, backlinks_spam_score: 50 }]),
    "backlinks/anchors/live": envelope([{ items: null }]),
    "backlinks/timeseries_new_lost_summary/live": envelope([{ items: null }]),
  });
  const weak = await dfs.fetchAuthority("weak.example");
  assert.equal(weak.score, 6); // 0.6×33.3 + 0.4×19.45 − 22.14
  assert.equal(weak.spamScore, 50);
});

/* ---------------- visibility ---------------- */

test("fetchVisibility maps overview/ranked/site: SERP and computes brand, AI Overview and index estimate", async () => {
  const calls = installFetch(VIS_ROUTES());
  const v = await dfs.fetchVisibility("aeoeye.com", { sitemapUrls: 100 });

  assert.equal(calls.length, 3);
  const ranked = calls.find((c) => c.url.includes("ranked_keywords"))!;
  assert.equal(ranked.body?.limit, 50);
  assert.deepEqual(ranked.body?.order_by, ["keyword_data.keyword_info.search_volume,desc"]);
  assert.equal(ranked.body?.location_code, 2840);
  assert.equal(ranked.body?.language_code, "en");
  const serp = calls.find((c) => c.url.includes("serp/google/organic/live/regular"))!;
  assert.equal(serp.body?.keyword, "site:aeoeye.com");
  assert.equal(serp.body?.depth, 10);

  assert.equal(v.noData, false);
  assert.equal(v.organicKeywords, 11625);
  assert.equal(v.etv, 32394);
  assert.deepEqual(v.positions, { pos1: 42, pos2_3: 170, pos4_10: 1512, pos11_20: 2705, pos21_50: 5346, pos51_100: 1850 });
  assert.deepEqual(v.movement, { isNew: 9698, isUp: 1117, isDown: 627, isLost: 1948 });
  assert.equal(v.topKeywords.length, 3);
  assert.deepEqual(v.topKeywords[0], {
    keyword: "1000 keywords",
    position: 1,
    volume: 40,
    etv: 12.15999984741211,
    url: "https://dataforseo.com/free-seo-stats/top-1000-keywords",
    intent: "informational",
    cpc: null,
  });
  assert.deepEqual(v.quickWins, []); // 三个词都在第 1 位
  assert.equal(v.brandKeywords, 0);
  assert.equal(v.nonBrandKeywords, 11625);
  assert.equal(v.aiOverviewShare, 1); // 沙盒三条 serp_item_types 都含 ai_overview
  assert.deepEqual(v.indexEstimate, { googleResults: 2220000, sitemapUrls: 100, ratio: 22200 });
  assert.equal(v.score, 100);
});

test("fetchVisibility: brand tokens from Organization name split brand vs non-brand (scaled estimate)", async () => {
  installFetch(VIS_ROUTES());
  const v = await dfs.fetchVisibility("aeoeye.com", { brandTokens: ["Amazon Inc"] });
  // 样本 3 条里 "amazon search volume api" 命中 → 1/3 × 11625 = 3875
  assert.equal(v.brandKeywords, 3875);
  assert.equal(v.nonBrandKeywords, 7750);
  assert.equal(v.indexEstimate?.sitemapUrls, null);
  assert.equal(v.indexEstimate?.ratio, null);
  assert.equal(v.score, 100); // 没有 sitemap 数时收录比不参与、其余两项重新归一
});

test("fetchVisibility: quick wins (position 4–20, volume ≥100) and low index ratio lower the score", async () => {
  const ranked = fixture("dfs-ranked-keywords");
  type RankedItem = {
    keyword_data: { keyword_info: { search_volume: number } };
    ranked_serp_element: { serp_item: { rank_group: number } };
  };
  const items = (result0<{ items: RankedItem[] }>(ranked)).items;
  items[0].ranked_serp_element.serp_item.rank_group = 7;
  items[0].keyword_data.keyword_info.search_volume = 500;
  items[1].ranked_serp_element.serp_item.rank_group = 25; // 超出 20 位,不算快赢
  items[1].keyword_data.keyword_info.search_volume = 900;
  const serp = fixture("dfs-serp-site");
  result0<{ se_results_count: number }>(serp).se_results_count = 20;
  installFetch({
    "domain_rank_overview/live": fixture("dfs-domain-rank-overview"),
    "ranked_keywords/live": ranked,
    "serp/google/organic/live/regular": serp,
  });
  const v = await dfs.fetchVisibility("aeoeye.com", { sitemapUrls: 100 });
  assert.equal(v.quickWins.length, 1);
  assert.equal(v.quickWins[0].keyword, "1000 keywords");
  assert.equal(v.quickWins[0].position, 7);
  assert.deepEqual(v.indexEstimate, { googleResults: 20, sitemapUrls: 100, ratio: 0.2 });
  // kw 100 + top10 100 + index 25 ⇒ 45 + 35 + 5 = 85
  assert.equal(v.score, 85);
});

test("fetchVisibility: organic count 0 → noData, zeros, single call, sitemap count preserved", async () => {
  const overview = fixture("dfs-domain-rank-overview");
  result0<{ items: { metrics: { organic: { count: number } } }[] }>(overview).items[0].metrics.organic.count = 0;
  const calls = installFetch({ "domain_rank_overview/live": overview });
  const v = await dfs.fetchVisibility("new.example", { sitemapUrls: 42 });
  assert.equal(calls.length, 1);
  assert.equal(v.noData, true);
  assert.equal(v.score, 0);
  assert.equal(v.organicKeywords, 0);
  assert.deepEqual(v.topKeywords, []);
  assert.deepEqual(v.indexEstimate, { googleResults: null, sitemapUrls: 42, ratio: null });
});

test("fetchVisibility: overview with no items → noData", async () => {
  installFetch({ "domain_rank_overview/live": envelope([{ total_count: 0, items_count: 0, items: null }]) });
  const v = await dfs.fetchVisibility("new.example");
  assert.equal(v.noData, true);
});

/* ---------------- competitors ---------------- */

test("fetchCompetitors maps rows, requests limit 6 with exclude_top_domains, scores by shared-keyword gap", async () => {
  const calls = installFetch({ "competitors_domain/live": fixture("dfs-competitors-domain") });
  const c = await dfs.fetchCompetitors("aeoeye.com");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body?.limit, 6);
  assert.equal(calls[0].body?.exclude_top_domains, true);
  assert.equal(calls[0].body?.target, "aeoeye.com");

  assert.equal(c.noData, false);
  assert.equal(c.items.length, 3);
  assert.deepEqual(c.items[0], { domain: "newmouth.com", intersections: 144, avgPosition: 75, etv: 68324.9899052903, organicKeywords: 25394 });
  assert.equal(c.items[1].domain, "youtube.com");
  // 最强差距:youtube 在交集词上 1545.18 vs 本站 238.69 = 6.47× → 15×log2 = 40 → 60
  assert.equal(c.score, 60);
});

test("fetchCompetitors drops the target domain itself and caps at 5", async () => {
  const fx = fixture("dfs-competitors-domain");
  const r = result0<{ items: Record<string, unknown>[] }>(fx);
  r.items[0].domain = "www.aeoeye.com";
  const extra = Array.from({ length: 6 }, (_, i) => ({ ...r.items[2], domain: `rival${i}.example` }));
  r.items.push(...extra);
  installFetch({ "competitors_domain/live": fx });
  const c = await dfs.fetchCompetitors("aeoeye.com");
  assert.equal(c.items.length, 5);
  assert.ok(!c.items.some((it) => it.domain.includes("aeoeye")));
});

test("fetchCompetitors: empty items → noData", async () => {
  installFetch({ "competitors_domain/live": envelope([{ total_count: 0, items_count: 0, items: null }]) });
  const c = await dfs.fetchCompetitors("new.example");
  assert.deepEqual(c, { items: [], score: 0, noData: true });
});

/* ---------------- v3 · SERP top results ---------------- */

test("fetchSerpTop: Google US/en, depth 10, sandbox base URL; organic items mapped in rank order", async () => {
  const calls = installFetch({ "serp/google/organic/live/regular": fixture("dfs-serp-organic") });
  const items = await dfs.fetchSerpTop("  best   aeo tools ");

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://sandbox.dataforseo.com/v3/serp/google/organic/live/regular"), calls[0].url);
  assert.deepEqual(calls[0].body, { keyword: "best aeo tools", location_code: 2840, language_code: "en", depth: 10 });

  // 沙盒回的是固定的 "pizza" SERP(10 条 organic)
  assert.equal(items.length, 10);
  assert.deepEqual(items[0], {
    url: "https://www.tripadvisor.co.uk/Restaurants-g186338-c31-zfp19-London_England.html",
    domain: "tripadvisor.co.uk",
    position: 1,
    title: "The Best Pizza Places Delivery in London",
  });
  assert.deepEqual(
    items.map((i) => i.position),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "position = rank_group (organic rank), not rank_absolute"
  );
  assert.equal(items[2].domain, "en.wikipedia.org");
  for (const it of items) {
    assert.ok(/^https:\/\//.test(it.url));
    assert.ok(!it.domain.startsWith("www."), it.domain);
    assert.equal(typeof it.title, "string");
  }
});

test("fetchSerpTop: keeps organic items only and de-duplicates by URL (best position wins)", async () => {
  const fx = fixture("dfs-serp-organic");
  const r = result0<{ items: Record<string, unknown>[] }>(fx);
  const first = r.items[0];
  r.items.unshift({ type: "paid", rank_group: 1, rank_absolute: 1, domain: "ads.example", url: "https://ads.example/landing", title: "Ad" });
  r.items.push({ type: "people_also_ask", rank_group: 1, rank_absolute: 20, url: null, title: "People also ask" });
  // 同一页的另一种写法(末尾斜杠 + #fragment)排在更后面 → 丢掉
  r.items.push({ ...first, rank_group: 11, rank_absolute: 30, url: `${String(first.url)}/#reviews` });
  // 名次缺失时退到 rank_absolute
  r.items.push({ type: "organic", rank_absolute: 31, domain: "late.example", url: "https://late.example/page", title: "Late" });
  // 非 http(s) 链接不要
  r.items.push({ type: "organic", rank_group: 12, rank_absolute: 32, domain: "x", url: "ftp://files.example/x", title: "FTP" });
  installFetch({ "serp/google/organic/live/regular": fx });

  const items = await dfs.fetchSerpTop("best aeo tools", { depth: 20 });
  assert.equal(items.length, 11);
  assert.ok(!items.some((i) => i.domain === "ads.example"), "paid results are excluded");
  assert.equal(items.filter((i) => i.domain === "tripadvisor.co.uk").length, 1, "duplicate URL collapsed");
  assert.equal(items[0].position, 1);
  assert.deepEqual(items[items.length - 1], { url: "https://late.example/page", domain: "late.example", position: 31, title: "Late" });
});

test("fetchSerpTop: depth option is clamped and passed through; empty keyword makes no request", async () => {
  const calls = installFetch({ "serp/google/organic/live/regular": fixture("dfs-serp-organic") });
  await dfs.fetchSerpTop("aeo", { depth: 20 });
  await dfs.fetchSerpTop("aeo", { depth: 500 });
  assert.deepEqual(
    calls.map((c) => c.body?.depth),
    [20, 100]
  );
  assert.deepEqual(await dfs.fetchSerpTop("   "), []);
  assert.equal(calls.length, 2, "blank keyword is free: no call");
});

test("fetchSerpTop: cost is booked per call; empty result → []; task error → SeoAuditError('unreachable')", async () => {
  const { SeoAuditError } = await import("../url");
  const fx = fixture("dfs-serp-organic");
  fx.tasks[0].cost = 0.002;
  installFetch({ "serp/google/organic/live/regular": fx });
  const { result, entries } = await costMod.withCostLedger(() => dfs.fetchSerpTop("best aeo tools"));
  assert.equal(result.length, 10);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].resource, "serp/google/organic/live/regular");
  assert.equal(entries[0].stage, "seo-audit");
  assert.equal(entries[0].usd, 0.002);
  mock.restoreAll();

  installFetch({ "serp/google/organic/live/regular": envelope([{ items: null }]) });
  assert.deepEqual(await dfs.fetchSerpTop("nothing ranks"), []);
  mock.restoreAll();

  installFetch({ "serp/google/organic/live/regular": envelope(null, 0, 40501) });
  await assert.rejects(dfs.fetchSerpTop("x"), (e: unknown) => e instanceof SeoAuditError && e.code === "unreachable");
});

/* ---------------- failures, cost ledger, base URL ---------------- */

test("network error and non-20000 task status both throw SeoAuditError('unreachable')", async () => {
  const { SeoAuditError } = await import("../url");
  const net = mock.method(globalThis, "fetch", async () => {
    throw new Error("ECONNRESET");
  });
  await assert.rejects(dfs.fetchAuthority("x.example"), (e: unknown) => e instanceof SeoAuditError && e.code === "unreachable");
  assert.equal(net.mock.callCount(), 2, "a network error is retried exactly once before giving up");
  mock.restoreAll();

  installFetch({ "domain_rank_overview/live": envelope(null, 0, 40101) });
  await assert.rejects(dfs.fetchVisibility("x.example"), (e: unknown) => e instanceof SeoAuditError && e.code === "unreachable");
  mock.restoreAll();

  // 顶层 status_code 非 20000(如 40100 未授权)同样是 unreachable
  mock.method(globalThis, "fetch", async () => ({ json: async () => ({ status_code: 40100, status_message: "Unauthorized", tasks: [] }) }) as unknown as Response);
  await assert.rejects(dfs.fetchCompetitors("x.example"), (e: unknown) => e instanceof SeoAuditError && e.code === "unreachable");
});

test("every task cost is recorded in the cost ledger as measured DataForSEO spend, stage seo-audit", async () => {
  const summary = fixture("dfs-backlinks-summary");
  const anchors = fixture("dfs-backlinks-anchors");
  const newLost = fixture("dfs-backlinks-new-lost");
  summary.tasks[0].cost = 0.02;
  anchors.tasks[0].cost = 0.01;
  newLost.tasks[0].cost = 0.03;
  installFetch({
    "backlinks/summary/live": summary,
    "backlinks/anchors/live": anchors,
    "backlinks/timeseries_new_lost_summary/live": newLost,
  });
  const { result, entries } = await costMod.withCostLedger(() => dfs.fetchAuthority("aeoeye.com"));
  assert.equal(result.referringDomains, 2952);
  assert.equal(entries.length, 3);
  for (const e of entries) {
    assert.equal(e.provider, "dataforseo");
    assert.equal(e.stage, "seo-audit");
    assert.equal(e.accuracy, "measured");
    assert.equal(e.calls, 1);
  }
  assert.deepEqual(
    entries.map((e) => e.resource).sort(),
    ["backlinks/anchors/live", "backlinks/summary/live", "backlinks/timeseries_new_lost_summary/live"]
  );
  const summaryCost = costMod.summarizeCost(entries);
  assert.equal(summaryCost.measuredUsd, 0.06);
  assert.equal(summaryCost.byStage[0].stage, "seo-audit");
});

test("a rejected task with a non-zero cost is still booked before the throw", async () => {
  installFetch({ "backlinks/summary/live": envelope(null, 0.02, 40501) });
  const { entries } = await costMod.withCostLedger(async () => {
    await dfs.fetchAuthority("x.example").catch(() => null);
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].usd, 0.02);
});

test("base URL switches between sandbox and production on DATAFORSEO_SANDBOX", async () => {
  envMod.env.DATAFORSEO_SANDBOX = "";
  const calls = installFetch({ "competitors_domain/live": fixture("dfs-competitors-domain") });
  await dfs.fetchCompetitors("aeoeye.com");
  assert.ok(calls[0].url.startsWith("https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live"), calls[0].url);
  mock.restoreAll();
  envMod.env.DATAFORSEO_SANDBOX = "1";
  const calls2 = installFetch({ "competitors_domain/live": fixture("dfs-competitors-domain") });
  await dfs.fetchCompetitors("aeoeye.com");
  assert.ok(calls2[0].url.startsWith("https://sandbox.dataforseo.com/v3/"), calls2[0].url);
});

/* ---------------- dfsEnabled / dfsReady ---------------- */

test("dfsEnabled follows DATAFORSEO_B64", () => {
  assert.equal(dfs.dfsEnabled(), true);
  envMod.env.DATAFORSEO_B64 = "";
  assert.equal(dfs.dfsEnabled(), false);
});

test("dfsReady: unconfigured / sandbox / low balance / ok / unreachable, and the 10-minute cache", async () => {
  envMod.env.DATAFORSEO_B64 = "";
  assert.deepEqual(await dfs.dfsReady({ force: true }), { ok: false, balance: null, reason: "unconfigured" });
  envMod.env.DATAFORSEO_B64 = "dGVzdDp0ZXN0";

  // 沙盒:余额是假的(fixture 里是负数),连通即 ready
  let calls = installFetch({ "appendix/user_data": fixture("dfs-user-data") });
  const sb = await dfs.dfsReady({ force: true });
  assert.equal(sb.ok, true);
  assert.equal(sb.reason, "sandbox");
  assert.ok(typeof sb.balance === "number" && sb.balance < 0);
  assert.ok(calls[0].url.startsWith("https://sandbox.dataforseo.com/v3/appendix/user_data"));
  mock.restoreAll();

  // 生产:余额 < $1 → low_balance
  envMod.env.DATAFORSEO_SANDBOX = "";
  installFetch({ "appendix/user_data": envelope([{ money: { total: 10, balance: 0.5 } }]) });
  assert.deepEqual(await dfs.dfsReady({ force: true }), { ok: false, balance: 0.5, reason: "low_balance" });
  mock.restoreAll();

  // 生产:余额充足 → ok,并进入 10 分钟缓存
  calls = installFetch({ "appendix/user_data": envelope([{ money: { total: 10, balance: 7.25 } }]) });
  assert.deepEqual(await dfs.dfsReady({ force: true }), { ok: true, balance: 7.25 });
  assert.equal(calls.length, 1);
  assert.deepEqual(await dfs.dfsReady(), { ok: true, balance: 7.25 });
  assert.equal(calls.length, 1, "second call is served from cache without fetching");
  mock.restoreAll();

  // 网络错误 → unreachable(force 绕过缓存)
  mock.method(globalThis, "fetch", async () => {
    throw new Error("timeout");
  });
  assert.deepEqual(await dfs.dfsReady({ force: true }), { ok: false, balance: null, reason: "unreachable" });
  mock.restoreAll();

  // task 非 20000 → unreachable
  installFetch({ "appendix/user_data": envelope(null, 0, 40100) });
  assert.equal((await dfs.dfsReady({ force: true })).reason, "unreachable");
});

/* ---------------- paidChecks ---------------- */

const AUTH_IDS = ["auth.referring-domains", "auth.rank", "auth.spam-score", "auth.nofollow-share", "auth.broken", "auth.anchors", "auth.trend"];
const VIS_IDS = ["vis.keywords", "vis.top10", "vis.etv", "vis.quick-wins", "vis.movement", "vis.index-ratio", "vis.brand-share", "vis.ai-overview-share"];
const COMP_IDS = ["comp.gap", "comp.list"];

test("paidChecks with real modules: ids, dimensions and statuses", async () => {
  installFetch({ ...AUTH_ROUTES(), ...VIS_ROUTES(), "competitors_domain/live": fixture("dfs-competitors-domain") });
  const a = await dfs.fetchAuthority("aeoeye.com");
  const v = await dfs.fetchVisibility("aeoeye.com", { sitemapUrls: 100 });
  const c = await dfs.fetchCompetitors("aeoeye.com");
  const checks = dfs.paidChecks(a, v, c, "aeoeye.com");

  assert.deepEqual(checks.map((x) => x.id), [...AUTH_IDS, ...VIS_IDS, ...COMP_IDS]);
  const by = Object.fromEntries(checks.map((x) => [x.id, x]));
  for (const id of AUTH_IDS) assert.equal(by[id].dimension, "authority");
  for (const id of VIS_IDS) assert.equal(by[id].dimension, "visibility");
  for (const id of COMP_IDS) assert.equal(by[id].dimension, "competitors");
  for (const x of checks) {
    assert.ok(x.evidence.length > 0, `${x.id} evidence`);
    assert.ok(x.fix.length > 20, `${x.id} fix`);
    assert.equal(x.scope, "site");
    assert.ok(Array.isArray(x.affected));
  }

  assert.equal(by["auth.referring-domains"].status, "pass"); // 2952 ≥ 100
  assert.equal(by["auth.rank"].status, "pass"); // 51 ≥ 30
  assert.equal(by["auth.spam-score"].status, "warn"); // 15 ∈ (10, 30]
  assert.equal(by["auth.nofollow-share"].status, "pass");
  assert.equal(by["auth.broken"].status, "pass"); // 0.34%
  assert.equal(by["auth.anchors"].status, "pass"); // 空锚(图片链接)不算,最大非品牌锚 1.3%
  assert.equal(by["auth.trend"].status, "pass"); // +197 / −30
  assert.match(by["auth.trend"].evidence[0], /\+197 new \/ −30 lost/);

  assert.equal(by["vis.keywords"].status, "pass"); // 11625
  assert.equal(by["vis.top10"].status, "pass"); // 1724
  assert.equal(by["vis.etv"].status, "pass"); // 32394
  assert.equal(by["vis.quick-wins"].status, "na");
  assert.equal(by["vis.movement"].status, "pass"); // lost 1948 ≤ new 9698
  assert.equal(by["vis.index-ratio"].status, "pass");
  assert.match(by["vis.index-ratio"].evidence[0], /Google's rough estimate/);
  assert.equal(by["vis.brand-share"].status, "info");
  assert.equal(by["vis.ai-overview-share"].status, "info");
  assert.match(by["vis.ai-overview-share"].evidence[0], /^100% of your top 3 ranking keywords/);
  assert.match(by["vis.ai-overview-share"].fix, /https:\/\/aeoeye\.com\//);

  assert.equal(by["comp.gap"].status, "fail"); // youtube 3.3B vs 32394
  assert.match(by["comp.gap"].evidence[0], /youtube\.com/);
  assert.equal(by["comp.list"].status, "info");
  assert.equal(by["comp.list"].evidence.length, 3);
});

test("paidChecks thresholds: weak authority/visibility produce fail/warn, quick wins list URLs", () => {
  const a: import("../types").AuthorityResult = {
    rank: 12,
    backlinks: 100,
    referringDomains: 25,
    referringMainDomains: 25,
    referringIps: 20,
    nofollowShare: 0.7,
    spamScore: 45,
    brokenBacklinks: 10,
    brokenPages: 3,
    firstSeen: "2025-01-01",
    tld: {},
    linkTypes: {},
    anchors: [
      { anchor: "cheap seo tool", backlinks: 50, referringDomains: 10 },
      { anchor: "aeoeye", backlinks: 30, referringDomains: 8 },
    ],
    score: 20,
    timeseries: [{ month: "2026-08", newReferringDomains: 1, lostReferringDomains: 4 }],
    noData: false,
  };
  const v: import("../types").VisibilityResult = {
    organicKeywords: 60,
    etv: 150,
    positions: { pos1: 0, pos2_3: 1, pos4_10: 3, pos11_20: 10, pos21_50: 20, pos51_100: 26 },
    movement: { isNew: 2, isUp: 1, isDown: 3, isLost: 5 },
    topKeywords: [],
    quickWins: [
      { keyword: "ai visibility audit", position: 8, volume: 320, etv: 5, url: "https://aeoeye.com/audit", intent: "commercial", cpc: 2 },
      { keyword: "aeo tools", position: 14, volume: 210, etv: 2, url: "https://aeoeye.com/tools", intent: null, cpc: null },
    ],
    score: 30,
    brandKeywords: 40,
    nonBrandKeywords: 20,
    aiOverviewShare: 0.25,
    indexEstimate: { googleResults: 10, sitemapUrls: 100, ratio: 0.1 },
    noData: false,
  };
  const c: import("../types").CompetitorsResult = {
    items: [{ domain: "rival.example", intersections: 30, avgPosition: 5.5, etv: 900, organicKeywords: 400 }],
    score: 70,
    noData: false,
  };
  const by = Object.fromEntries(dfs.paidChecks(a, v, c, "aeoeye.com").map((x) => [x.id, x]));
  assert.equal(by["auth.referring-domains"].status, "warn"); // 25 ∈ [20,100)
  assert.equal(by["auth.rank"].status, "warn"); // 12 ∈ [10,30)
  assert.equal(by["auth.spam-score"].status, "fail"); // 45 > 30
  assert.equal(by["auth.nofollow-share"].status, "warn"); // 70%
  assert.equal(by["auth.broken"].status, "warn"); // 10%
  assert.equal(by["auth.anchors"].status, "warn"); // "cheap seo tool" 50% > 40%;品牌锚 "aeoeye" 不算
  assert.match(by["auth.anchors"].evidence[0], /"cheap seo tool" carries 50%/);
  assert.equal(by["auth.trend"].status, "warn"); // lost 4 > new 1
  assert.equal(by["vis.keywords"].status, "warn"); // 60 ∈ [50,500)
  assert.equal(by["vis.top10"].status, "warn"); // 4 ∈ [3,20)
  assert.equal(by["vis.etv"].status, "warn"); // 150 ∈ [100,1000)
  assert.equal(by["vis.quick-wins"].status, "info");
  assert.deepEqual(by["vis.quick-wins"].affected, ["https://aeoeye.com/audit", "https://aeoeye.com/tools"]);
  assert.equal(by["vis.movement"].status, "warn"); // lost 5 > new 2
  assert.equal(by["vis.index-ratio"].status, "fail"); // 10%
  assert.equal(by["comp.gap"].status, "warn"); // 900/150 = 6×
  assert.equal(by["comp.gap"].severity, "medium");
});

test("paidChecks: null or noData modules → every check is na with the no-data evidence and a what-to-do-first fix", async () => {
  const EXPECTED = [...AUTH_IDS, ...VIS_IDS, ...COMP_IDS];
  const nulls = dfs.paidChecks(null, null, null, "new.example");
  assert.deepEqual(nulls.map((x) => x.id), EXPECTED);
  for (const x of nulls) {
    assert.equal(x.status, "na", x.id);
    assert.equal(x.evidence[0], "No index/backlink data for this domain yet");
    assert.match(x.evidence[1], /did not return/);
    assert.ok(x.fix.length > 40, x.id);
  }

  installFetch({
    "backlinks/summary/live": envelope([{ backlinks: 0, referring_domains: 0 }]),
    "domain_rank_overview/live": envelope([{ items: null }]),
    "competitors_domain/live": envelope([{ items: [] }]),
  });
  const a = await dfs.fetchAuthority("new.example");
  const v = await dfs.fetchVisibility("new.example");
  const c = await dfs.fetchCompetitors("new.example");
  assert.equal(a.noData && v.noData && c.noData, true);
  const noData = dfs.paidChecks(a, v, c, "new.example");
  for (const x of noData) {
    assert.equal(x.status, "na", x.id);
    assert.equal(x.evidence[0], "No index/backlink data for this domain yet");
    assert.match(x.evidence[1], /new.example/);
  }

  // 混合:只有 authority 有数据 → authority 正常、其余 na;comp.gap 缺本站 etv 也是 na
  mock.restoreAll();
  installFetch(AUTH_ROUTES());
  const a2 = await dfs.fetchAuthority("aeoeye.com");
  const mixed = dfs.paidChecks(a2, null, null, "aeoeye.com");
  const byId = Object.fromEntries(mixed.map((x) => [x.id, x]));
  assert.equal(byId["auth.referring-domains"].status, "pass");
  assert.equal(byId["vis.keywords"].status, "na");
  assert.equal(byId["comp.gap"].status, "na");
});

/* ---------------- 复审 D2:生产环境忽略沙盒开关 ---------------- */

test("production (VERCEL_ENV=production) ignores DATAFORSEO_SANDBOX: live endpoint, real balance check, warned once", async () => {
  const prev = process.env.VERCEL_ENV;
  const warn = mock.method(console, "warn", () => {});
  const calls = installFetch({
    "competitors_domain/live": fixture("dfs-competitors-domain"),
    "appendix/user_data": envelope([{ money: { total: 10, balance: 0.5 } }]),
  });
  try {
    process.env.VERCEL_ENV = "production";
    envMod.env.DATAFORSEO_SANDBOX = "1";
    assert.equal(dfs.dfsMode(), "live");
    await dfs.fetchCompetitors("aeoeye.com");
    assert.ok(calls[0].url.startsWith("https://api.dataforseo.com/v3/"), calls[0].url);
    // 预检不再走"沙盒连通即 ready"的捷径:余额不足照样拦下
    assert.deepEqual(await dfs.dfsReady({ force: true }), { ok: false, balance: 0.5, reason: "low_balance" });
    assert.ok(calls[1].url.startsWith("https://api.dataforseo.com/v3/appendix/user_data"), calls[1].url);
    assert.equal(warn.mock.callCount(), 1, "the misconfiguration is logged once, not on every request");
    assert.match(String(warn.mock.calls[0].arguments[0]), /DATAFORSEO_SANDBOX=1 is ignored in production/);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
  // 预览 / 本地照旧走沙盒
  process.env.VERCEL_ENV = "preview";
  try {
    assert.equal(dfs.dfsMode(), "sandbox");
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

/* ---------------- 复审 C41:瞬时故障原地重试一次 ---------------- */

type Step = "network" | "timeout" | { status: number; body: unknown };

/** 按顺序回放响应;返回调用计数 */
function scriptedFetch(steps: Step[]): { calls: () => number } {
  let n = 0;
  mock.method(globalThis, "fetch", async () => {
    const step = steps[Math.min(n, steps.length - 1)];
    n += 1;
    if (step === "network") throw new TypeError("fetch failed: ECONNRESET");
    if (step === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    return { ok: step.status < 400, status: step.status, json: async () => step.body } as unknown as Response;
  });
  return { calls: () => n };
}

test("a network error is retried once after a ~2 s backoff, then succeeds", async () => {
  const f = scriptedFetch(["network", { status: 200, body: fixture("dfs-competitors-domain") }]);
  const c = await dfs.fetchCompetitors("aeoeye.com");
  assert.equal(c.items.length, 3);
  assert.equal(f.calls(), 2);
  assert.deepEqual(slept, [2_000]);
});

test("HTTP 5xx and DataForSEO 5xxxx are retried; the cost of every attempt is booked", async () => {
  const ok = fixture("dfs-competitors-domain");
  ok.tasks[0].cost = 0.01;
  const busy = { status_code: 50000, status_message: "Internal Error.", tasks: [{ status_code: 50000, status_message: "Internal Error.", cost: 0.002, result: null }] };
  const f = scriptedFetch([{ status: 503, body: busy }, { status: 200, body: ok }]);
  const { result, entries } = await costMod.withCostLedger(() => dfs.fetchCompetitors("aeoeye.com"));
  assert.equal(result.noData, false);
  assert.equal(f.calls(), 2);
  assert.deepEqual(entries.map((e) => e.usd), [0.002, 0.01], "both attempts are in the ledger");
  mock.restoreAll();

  // HTTP 200 但信封里是 5xxxx(供应商内部错误)同样重试
  const g = scriptedFetch([{ status: 200, body: busy }, { status: 200, body: fixture("dfs-competitors-domain") }]);
  await dfs.fetchCompetitors("aeoeye.com");
  assert.equal(g.calls(), 2);
});

test("4xx, 40xxx task errors and timeouts are never retried; a second transient failure gives up", async () => {
  const { SeoAuditError } = await import("../url");
  const isUnreachable = (e: unknown) => e instanceof SeoAuditError && e.code === "unreachable";

  let f = scriptedFetch([{ status: 401, body: { status_code: 40100, status_message: "Unauthorized.", tasks: [] } }]);
  await assert.rejects(dfs.fetchCompetitors("x.example"), isUnreachable);
  assert.equal(f.calls(), 1, "HTTP 4xx is not retried");
  mock.restoreAll();

  f = scriptedFetch([{ status: 200, body: envelope(null, 0, 40501) }]);
  await assert.rejects(dfs.fetchCompetitors("x.example"), isUnreachable);
  assert.equal(f.calls(), 1, "a DataForSEO 40xxx task error is not retried");
  mock.restoreAll();

  f = scriptedFetch([{ status: 200, body: envelope(null, 0, 40200) }]);
  await assert.rejects(dfs.fetchCompetitors("x.example"), /40200/);
  assert.equal(f.calls(), 1, "payment required is not retried");
  mock.restoreAll();

  f = scriptedFetch(["timeout"]);
  await assert.rejects(dfs.fetchCompetitors("x.example"), isUnreachable);
  assert.equal(f.calls(), 1, "a timed-out live task may already be billed — never resend it");
  mock.restoreAll();

  f = scriptedFetch(["network", { status: 502, body: null }, { status: 200, body: fixture("dfs-competitors-domain") }]);
  await assert.rejects(dfs.fetchCompetitors("x.example"), /HTTP 502/);
  assert.equal(f.calls(), 2, "only one retry");
  assert.deepEqual(slept, [2_000]);
});
