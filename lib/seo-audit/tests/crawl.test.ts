import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFetchError,
  crawlSite,
  crawlSiteDetailed,
  detectBlock,
  enrichProbe,
  hasNonHtmlExtension,
  politeIntervalFor,
  probeAndCrawl,
  probeSite,
  stratifiedSample,
  type Fetcher,
} from "../crawl";
import { safeFetch, USER_AGENT, type FetchResult } from "../fetch";
import { parsePageDetailed } from "../parse";
import { AI_CRAWLERS, emptyRobots, parseRobots, type RobotsRules } from "../robots";
import { clearSitemapCache, discoverSitemaps } from "../sitemap";
import { SeoAuditError } from "../url";
import { SEO_BOT_MOBILE_UA, SEO_BOT_UA } from "../types";

/* ---------- 假站点 ---------- */

interface FakePage {
  status?: number;
  body?: string;
  contentType?: string;
  location?: string;
  headers?: Record<string, string>;
  /** 按方法拆分状态(测 HEAD → GET 回退) */
  headStatus?: number;
  /** 按 UA 子串给不同响应(WAF / parity 用) */
  forUa?: Record<string, FakePage>;
  /** 模拟首字节时间 */
  ttfb?: number;
  /** 网络层失败(status 0 + error),例如证书过期、DNS 查不到 */
  error?: string;
}

const html = (title: string, links: string[], nav: string[] = [], extraHead = "", words = 40) =>
  `<!DOCTYPE html><html lang="en"><head><title>${title}</title>${extraHead}</head><body>
<nav>${nav.map((l) => `<a href="${l}">${l}</a>`).join("")}</nav>
<h1>${title}</h1><p>${"word ".repeat(words)}</p>
${links.map((l) => `<a href="${l}">${l}</a>`).join("")}
</body></html>`;

const SITE: Record<string, FakePage> = {
  "https://site.test/": {
    body: html(
      "Home",
      [
        "/deep/a/b/c",
        "/contact",
        "/file.pdf",
        "/data.json",
        "/image",
        "/admin/secret",
        "https://www.site.test/pricing?utm_source=x#top",
        "https://other.test/x",
        "mailto:a@site.test",
      ],
      ["/about", "/pricing", "/blog"],
      '<link rel="canonical" href="https://site.test/"><meta property="og:image" content="/og.png"><script src="/static/app.js"></script><link rel="stylesheet" href="/blocked-assets/site.css">'
    ),
    headers: { "strict-transport-security": "max-age=63072000", "x-frame-options": "DENY", server: "fake" },
    ttfb: 120,
  },
  "https://site.test/about": { body: html("About", ["/team", "/old"], [], '<link rel="canonical" href="https://site.test/about">'), ttfb: 300 },
  "https://site.test/pricing": { body: html("Pricing", []), ttfb: 80 },
  "https://site.test/blog": { body: html("Blog", ["/blog/post-1", "/blog/post-2"]), ttfb: 900 },
  "https://site.test/contact": { status: 404, body: html("Not found", []) },
  "https://site.test/deep/a/b/c": { body: html("Deep", []) },
  "https://site.test/team": { body: html("Team", ["/missing", "https://dead.test/gone", "https://botwall.test/p"]) + '<img src="/big.jpg"><img src="/small.jpg">' },
  "https://botwall.test/p": { status: 403, body: "no bots" },
  "https://site.test/old": { status: 301, location: "https://site.test/about-new" },
  "https://site.test/about-new": { body: html("About new", []) },
  "https://site.test/blog/post-1": { body: html("Post 1", []) },
  "https://site.test/blog/post-2": { body: html("Post 2", []) },
  "https://site.test/image": { body: "PNG", contentType: "image/png" },
  "https://site.test/admin/secret": { body: html("Secret", []) },
  // probeSite 用
  "https://www.site.test/": { status: 301, location: "https://site.test/" },
  "http://site.test/": { status: 301, location: "https://site.test/" },
  "http://www.site.test/": { status: 301, location: "https://www.site.test/" },
  "https://site.test/about/": { status: 301, location: "https://site.test/about" },
  "https://site.test/ABOUT": { body: html("About upper", [], [], '<link rel="canonical" href="https://site.test/about">') },
  "https://site.test/?utm_source=aeoeye&utm_medium=seo-audit": { body: html("Home utm", [], [], '<link rel="canonical" href="https://site.test/">') },
  "https://site.test/og.png": { body: "PNG", contentType: "image/png", headers: { "content-length": "4321" } },
  "https://site.test/big.jpg": { body: "JPG", contentType: "image/jpeg", headers: { "content-length": "300000" } },
  "https://site.test/small.jpg": { body: "JPG", contentType: "image/jpeg", headers: { "content-length": "20000" } },
  "https://site.test/orphan-1": { body: html("Orphan", [], [], '<meta name="robots" content="noindex">') },
  "https://site.test/robots.txt": { body: "User-agent: *\nDisallow: /admin/\nDisallow: /blocked-assets/\nSitemap: https://site.test/sitemap.xml\n", contentType: "text/plain" },
  "https://site.test/sitemap.xml": {
    body: `<urlset><url><loc>https://site.test/</loc><lastmod>2026-09-01</lastmod></url><url><loc>https://site.test/about</loc></url><url><loc>https://site.test/orphan-1</loc></url><url><loc>https://site.test/orphan-2</loc></url></urlset>`,
    contentType: "application/xml",
  },
};

type LogEntry = { url: string; method: string; ua: string; t: number };

function makeFetcher(site: Record<string, FakePage>, log: LogEntry[] = [], delayMs = 0): Fetcher {
  return async (url, opts) => {
    const method = opts?.method ?? "GET";
    const ua = opts?.userAgent ?? USER_AGENT;
    log.push({ url, method, ua, t: Date.now() });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const lookup = (u: string): FakePage => {
      const base: FakePage = site[u] ?? (u.includes("/aeoeye-404-probe-") ? { status: site.__soft404__?.status ?? 404, body: "nope" } : { status: 404, body: "nope" });
      if (base.forUa) for (const [needle, page] of Object.entries(base.forUa)) if (ua.includes(needle)) return { ...base, ...page };
      return base;
    };
    const chain: string[] = [];
    const hops: NonNullable<FetchResult["hops"]>[number][] = [];
    let current = url;
    for (let i = 0; i < 6; i++) {
      const p = lookup(current);
      if (p.error) return { url, finalUrl: current, status: 0, headers: new Headers(), body: "", bytes: 0, ms: 1, chain, contentType: "", error: p.error, hops };
      const status = method === "HEAD" && p.headStatus !== undefined ? p.headStatus : (p.status ?? 200);
      hops.push({ url: current, status, location: p.location ?? null });
      if (p.location && status >= 300 && status < 400) {
        chain.push(p.location);
        current = p.location;
        continue;
      }
      const body = method === "HEAD" ? "" : (p.body ?? "");
      const out: FetchResult = {
        url,
        finalUrl: current,
        status,
        headers: new Headers(p.headers ?? {}),
        body,
        bytes: body.length,
        ms: 1,
        chain,
        contentType: p.contentType ?? "text/html; charset=utf-8",
        hops,
      };
      if (p.ttfb !== undefined) out.ttfbMs = p.ttfb;
      return out;
    }
    throw new Error("unreachable");
  };
}

const ROBOTS: RobotsRules = { ...emptyRobots(200), found: true, ...parseRobots(SITE["https://site.test/robots.txt"].body ?? "") };
const FAST = { minIntervalMs: 0 };
const noHostCheck = async () => undefined;
const fakeTls = async () => ({ validTo: "2027-01-01T00:00:00.000Z", daysLeft: 92, issuer: "Fake CA", coversWww: true, error: null });

/* ---------- crawlSite ---------- */

test("crawlSite: BFS with nav-first, shallow-first ordering; depth recorded; redirects and 404s kept", async () => {
  const log: LogEntry[] = [];
  const pages = await crawlSite("site.test", { maxPages: 20, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE, log), concurrency: 1, ...FAST });

  assert.deepEqual(
    pages.map((p) => p.url),
    [
      "https://site.test/",
      "https://site.test/about",
      "https://site.test/pricing",
      "https://site.test/blog",
      "https://site.test/contact",
      "https://site.test/deep/a/b/c",
      "https://site.test/team",
      "https://site.test/old",
      "https://site.test/blog/post-1",
      "https://site.test/blog/post-2",
      "https://site.test/missing",
    ]
  );
  const byUrl = Object.fromEntries(pages.map((p) => [p.url, p]));
  assert.equal(byUrl["https://site.test/"].depth, 0);
  assert.equal(byUrl["https://site.test/missing"].depth, 3);
  assert.equal(byUrl["https://site.test/missing"].status, 404);
  assert.equal(byUrl["https://site.test/about"].depth, 1);
  assert.equal(byUrl["https://site.test/team"].depth, 2);
  assert.equal(byUrl["https://site.test/contact"].status, 404);
  assert.equal(byUrl["https://site.test/old"].status, 200);
  assert.equal(byUrl["https://site.test/old"].redirects, 1);
  assert.equal(byUrl["https://site.test/old"].finalUrl, "https://site.test/about-new");
  assert.equal(byUrl["https://site.test/about"].ttfbMs, 300, "ttfbMs flows from the fetch result");

  const fetched = log.map((l) => l.url);
  assert.ok(!fetched.includes("https://site.test/admin/secret"), "robots-disallowed path never fetched");
  assert.ok(!fetched.some((u) => u.endsWith(".pdf") || u.endsWith(".json")), "non-HTML extensions skipped without a request");
  assert.ok(fetched.includes("https://site.test/image"), "unknown extension is fetched once");
  assert.ok(!pages.some((p) => p.url === "https://site.test/image"), "non-HTML content-type is not a page");
  assert.equal(fetched.filter((u) => u.includes("pricing")).length, 1, "www/utm/fragment variants deduped to one fetch");
  assert.ok(!fetched.some((u) => u.includes("other.test")), "external hosts never fetched");
});

test("crawlSite: maxPages cap and progress callback", async () => {
  const seen: number[] = [];
  const pages = await crawlSite("https://site.test/", { maxPages: 4, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE), onProgress: (n) => seen.push(n), ...FAST });
  assert.equal(pages.length, 4);
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.equal(pages[0].url, "https://site.test/");
});

test("crawlSite: entry page ignores robots, everything else respects it; SiteProbe-shaped robots tolerated", async () => {
  const blockAll: RobotsRules = { ...emptyRobots(200), found: true, ...parseRobots("User-agent: *\nDisallow: /") };
  const log: LogEntry[] = [];
  const { pages, coverage } = await crawlSiteDetailed("https://site.test/", { maxPages: 10, robots: blockAll, timeBudgetMs: 5_000, fetcher: makeFetcher(SITE, log), ...FAST });
  assert.equal(pages.length, 1);
  assert.equal(log.length, 1);
  assert.ok(coverage.skippedByRobots >= 5, `skippedByRobots=${coverage.skippedByRobots}`);

  const probeShaped = { url: "https://site.test/robots.txt", status: 200, found: true, disallowAll: false, blocksEntry: false, sitemaps: [], bytes: 0 } as unknown as RobotsRules;
  const pages2 = await crawlSite("https://site.test/", { maxPages: 3, robots: probeShaped, timeBudgetMs: 5_000, fetcher: makeFetcher(SITE), ...FAST });
  assert.equal(pages2.length, 3);
});

test("crawlSite: global time budget stops the crawl and does not record budget-caused failures", async () => {
  const started = Date.now();
  const pages = await crawlSite("https://site.test/", { maxPages: 40, robots: ROBOTS, timeBudgetMs: 1_000, fetcher: makeFetcher(SITE, [], 180), concurrency: 1, ...FAST });
  const elapsed = Date.now() - started;
  assert.ok(pages.length >= 2 && pages.length < 10, `crawled ${pages.length}`);
  assert.ok(elapsed < 2_500, `took ${elapsed}ms`);
  assert.ok(pages.every((p) => p.status !== 0));
});

test("crawlSite: per-host spacing keeps request starts ≥ minIntervalMs apart even with concurrency 4", async () => {
  const log: LogEntry[] = [];
  const pages = await crawlSite("https://site.test/", { maxPages: 6, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE, log), concurrency: 4, minIntervalMs: 40 });
  assert.equal(pages.length, 6);
  const starts = log.map((l) => l.t).sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 35, `gap ${i}: ${starts[i] - starts[i - 1]}ms`);
});

test("crawlSite: Crawl-delay ≤ 2s is honoured as the interval; > 2s halves the page budget", async () => {
  const gentle: RobotsRules = { ...emptyRobots(200), found: true, ...parseRobots("User-agent: *\nCrawl-delay: 0.05\n") };
  const log: LogEntry[] = [];
  await crawlSite("https://site.test/", { maxPages: 4, robots: gentle, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE, log), concurrency: 4, ...FAST });
  const starts = log.map((l) => l.t).sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 45, `gap ${i}: ${starts[i] - starts[i - 1]}ms`);

  const slow: RobotsRules = { ...emptyRobots(200), found: true, ...parseRobots("User-agent: *\nCrawl-delay: 30\n") };
  const started = Date.now();
  const { pages } = await crawlSiteDetailed("https://site.test/", { maxPages: 4, robots: slow, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE), concurrency: 4, ...FAST });
  assert.equal(pages.length, 2, "budget halved from 4 to 2");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1_900 && elapsed < 4_000, `waited the 2s cap between requests (${elapsed}ms)`);
});

test("crawlSiteDetailed: stratified sitemap sampling by first path segment fills the budget after nav BFS; coverage reported", async () => {
  clearSitemapCache();
  const site: Record<string, FakePage> = {
    "https://tpl.test/": { body: html("Home", [], ["/about"]) },
    "https://tpl.test/about": { body: html("About", []) },
    "https://tpl.test/sitemap.xml": {
      contentType: "application/xml",
      body: `<urlset>${["/", "/about", "/docs/a", "/docs/b", "/docs/c", "/blog/x", "/blog/y", "/legal/privacy", "/admin/x", "/file.pdf"].map((p) => `<url><loc>https://tpl.test${p}</loc></url>`).join("")}</urlset>`,
    },
  };
  for (const p of ["/docs/a", "/docs/b", "/docs/c", "/blog/x", "/blog/y", "/legal/privacy", "/admin/x"]) site[`https://tpl.test${p}`] = { body: html(p, []) };
  const log: LogEntry[] = [];
  const fetcher = makeFetcher(site, log);
  const robots: RobotsRules = { ...emptyRobots(200), found: true, ...parseRobots("User-agent: *\nDisallow: /admin/\n") };
  const infos = await discoverSitemaps("https://tpl.test", ["https://tpl.test/sitemap.xml"], (u) => fetcher(u));

  const { pages, coverage } = await crawlSiteDetailed("https://tpl.test/", { maxPages: 6, navPages: 2, robots, timeBudgetMs: 10_000, fetcher, sitemaps: infos, ...FAST });
  assert.equal(pages.length, 6);
  assert.deepEqual(coverage, { navPages: 2, sitemapPages: 4, skippedByRobots: 1, stoppedEarly: null });
  const sitemapPicked = pages.slice(2).map((p) => new URL(p.url).pathname);
  assert.deepEqual(new Set(sitemapPicked.map((p) => p.split("/")[1])), new Set(["docs", "blog", "legal"]), "every template gets a page before any template gets a second");
  assert.equal(sitemapPicked.filter((p) => p.startsWith("/docs")).length, 2);
  assert.ok(!log.some((l) => l.url.includes("/admin/") || l.url.endsWith(".pdf")));
  assert.ok(pages.slice(2).every((p) => p.depth === 1));

  // 没传 infos 时按主机在缓存里找(探针与抓取并行的真实情况)
  const again = await crawlSiteDetailed("https://tpl.test/", { maxPages: 5, navPages: 2, robots, timeBudgetMs: 10_000, fetcher, ...FAST });
  assert.equal(again.coverage.sitemapPages, 3);
  clearSitemapCache();
});

test("crawlSiteDetailed: 429 / challenge mid-crawl stops the crawl and the blocked responses are NOT recorded as site pages (C19)", async () => {
  const site: Record<string, FakePage> = {
    ...SITE,
    "https://site.test/pricing": { status: 429, body: "slow down", headers: { "retry-after": "30" } },
  };
  const log: LogEntry[] = [];
  const { pages, coverage } = await crawlSiteDetailed("https://site.test/", { maxPages: 20, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(site, log), concurrency: 1, ...FAST });
  assert.match(coverage.stoppedEarly ?? "", /HTTP 429/);
  assert.ok(pages.length < 6, `stopped after ${pages.length} pages`);
  assert.ok(!pages.some((p) => p.status === 429), "our own rate limiting is not a site error page");
  assert.equal(log.at(-1)?.url, "https://site.test/pricing", "no request after the 429");

  // 内页是 200 的挑战页(强签名)同样停、同样不记
  const challenge: Record<string, FakePage> = { ...SITE, "https://site.test/about": { body: "<html><script src='/cdn-cgi/challenge-platform/x'></script></html>" } };
  const c = await crawlSiteDetailed("https://site.test/", { maxPages: 20, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(challenge), concurrency: 1, ...FAST });
  assert.match(c.coverage.stoppedEarly ?? "", /challenge/);
  assert.ok(!c.pages.some((p) => p.url === "https://site.test/about"));
});

test("crawlSiteDetailed: entry blocked for our UA → stop at once, no UA switch, no retry, blocked page not recorded, entryBlock reported (C39/C19)", async () => {
  const waf: Record<string, FakePage> = {
    ...SITE,
    "https://site.test/": { ...SITE["https://site.test/"], forUa: { AEOeyeBot: { status: 403, body: "<html><title>Access denied</title></html>", headers: { server: "cloudflare" } } } },
  };
  const log: LogEntry[] = [];
  const r = await crawlSiteDetailed("https://site.test/", { maxPages: 3, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(waf, log), ...FAST });
  assert.equal(r.userAgent, SEO_BOT_UA);
  assert.equal(r.pages.length, 0, "a firewall page is not the site's home page");
  assert.equal(log.length, 1, "exactly one request: no browser-UA retry");
  assert.equal(log[0].ua, SEO_BOT_UA);
  assert.equal(r.entryBlock?.kind, "waf");
  assert.match(r.coverage.stoppedEarly ?? "", /Entry page blocked/);

  const limited: Record<string, FakePage> = { ...SITE, "https://site.test/": { status: 429, body: "slow down", headers: { "retry-after": "5" } } };
  const log2: LogEntry[] = [];
  const l = await crawlSiteDetailed("https://site.test/", { maxPages: 5, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(limited, log2), ...FAST });
  assert.equal(log2.length, 1, "429 on the entry is not retried");
  assert.equal(l.entryBlock?.kind, "rate-limited");
  assert.deepEqual(l.pages, []);

  const hard: Record<string, FakePage> = { ...SITE, "https://site.test/": { status: 403, body: "<html>cf-chl-bypass</html>", headers: { "cf-mitigated": "challenge" } } };
  const h = await crawlSiteDetailed("https://site.test/", { maxPages: 5, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(hard), ...FAST });
  assert.equal(h.pages.length, 0);
  assert.equal(h.entryBlock?.kind, "challenge");
  assert.match(h.coverage.stoppedEarly ?? "", /Entry page blocked/);
});

test("crawlSiteDetailed: an internal link that redirects off-site is not a site page and takes no nav slot; an off-site entry redirect is kept (C19)", async () => {
  const site: Record<string, FakePage> = {
    "https://hop.test/": { body: html("Home", [], ["/discord", "/a", "/b"]) },
    "https://hop.test/discord": { status: 302, location: "https://discord.example/invite/abc" },
    "https://discord.example/invite/abc": { status: 403, body: "<title>Just a moment...</title>", headers: { "cf-mitigated": "challenge" } },
    "https://hop.test/a": { body: html("A", []) },
    "https://hop.test/b": { body: html("B", []) },
  };
  const r = await crawlSiteDetailed("https://hop.test/", { maxPages: 3, navPages: 3, robots: emptyRobots(), timeBudgetMs: 10_000, fetcher: makeFetcher(site), concurrency: 1, ...FAST });
  assert.deepEqual(r.pages.map((p) => new URL(p.url).pathname), ["/", "/a", "/b"], "/discord does not take one of the 3 nav slots");
  assert.equal(r.coverage.stoppedEarly, null, "another site's challenge page does not stop our crawl");

  const moved: Record<string, FakePage> = { "https://old.test/": { status: 301, location: "https://new.example/" }, "https://new.example/": { body: html("New home", []) } };
  const m = await crawlSiteDetailed("https://old.test/", { maxPages: 3, robots: emptyRobots(), timeBudgetMs: 10_000, fetcher: makeFetcher(moved), ...FAST });
  assert.equal(m.pages.length, 1, "the whole site moving to another domain is a fact the report must show");
  assert.equal(m.pages[0].finalUrl, "https://new.example/");
});

test("crawlSiteDetailed: one 403 internal page is a real finding; a second 403 stops the crawl and the whole 403 batch is excluded (C19)", async () => {
  const one: Record<string, FakePage> = { ...SITE, "https://site.test/pricing": { status: 403, body: "members only" } };
  const a = await crawlSiteDetailed("https://site.test/", { maxPages: 20, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(one), concurrency: 1, ...FAST });
  assert.ok(a.pages.some((p) => p.url === "https://site.test/pricing" && p.status === 403), "a single genuine 403 stays");
  assert.equal(a.coverage.stoppedEarly, null);

  const two: Record<string, FakePage> = { ...SITE, "https://site.test/pricing": { status: 403, body: "nope" }, "https://site.test/blog": { status: 403, body: "nope" } };
  const b = await crawlSiteDetailed("https://site.test/", { maxPages: 20, robots: ROBOTS, timeBudgetMs: 10_000, fetcher: makeFetcher(two), concurrency: 1, ...FAST });
  assert.match(b.coverage.stoppedEarly ?? "", /Repeated HTTP 403/);
  assert.ok(!b.pages.some((p) => p.status === 403), "the 403 batch is dropped once the early-stop rule fires");
  assert.equal(b.coverage.navPages, b.pages.length, "coverage counts follow the excluded pages");
});

test("crawlSiteDetailed: an entry with a certificate error is recorded as unreachable and stops the crawl (no UA games)", async () => {
  const site: Record<string, FakePage> = { "https://tls.test/": { error: "CERT_HAS_EXPIRED: certificate has expired" } };
  const log: LogEntry[] = [];
  const r = await crawlSiteDetailed("https://tls.test/", { maxPages: 5, robots: emptyRobots(), timeBudgetMs: 5_000, fetcher: makeFetcher(site, log), ...FAST });
  assert.equal(log.length, 1);
  assert.equal(r.entryBlock, null, "a TLS failure is not a firewall block");
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].status, 0);
  assert.match(r.coverage.stoppedEarly ?? "", /Entry page unreachable \(CERT_HAS_EXPIRED/);
});

test("crawlSiteDetailed: reports the per-host interval it used (Crawl-delay ≤ 2s honoured) so the post-crawl phase can reuse it (C40)", async () => {
  const gentle: RobotsRules = { ...emptyRobots(200), found: true, ...parseRobots("User-agent: *\nCrawl-delay: 1.5\n") };
  const r = await crawlSiteDetailed("https://site.test/", { maxPages: 1, robots: gentle, timeBudgetMs: 5_000, fetcher: makeFetcher(SITE), ...FAST });
  assert.equal(r.intervalMs, 1500);
  assert.deepEqual(politeIntervalFor(gentle, 250), { intervalMs: 1500, halvePages: false });
  assert.deepEqual(politeIntervalFor({ ...emptyRobots(200), found: true, ...parseRobots("User-agent: *\nCrawl-delay: 9\n") }, 250), { intervalMs: 2000, halvePages: true });
  assert.deepEqual(politeIntervalFor(null, 250), { intervalMs: 250, halvePages: false });
});

test("crawlSiteDetailed: a DOM-bomb page is parsed with a truncated DOM in well under a second and stored small (C6)", async () => {
  const bomb = `<html><body>${Array.from({ length: 60_000 }, (_, i) => `<a href=/p${i}>x</a>`).join("")}`;
  const site: Record<string, FakePage> = { "https://bomb.test/": { body: bomb } };
  const t0 = Date.now();
  const r = await crawlSiteDetailed("https://bomb.test/", { maxPages: 1, robots: emptyRobots(), timeBudgetMs: 10_000, fetcher: makeFetcher(site), ...FAST });
  const ms = Date.now() - t0;
  assert.ok(ms < 3_000, `took ${ms}ms`);
  const p = r.pages[0];
  assert.ok(p.issues.some((i) => /Unusually large DOM/.test(i)));
  assert.equal(p.links.length, 500);
  assert.ok(JSON.stringify(p).length < 100_000);
});

test("stratifiedSample / hasNonHtmlExtension / detectBlock", () => {
  assert.deepEqual(stratifiedSample(["/a/1", "/a/2", "/b/1", "/c/1", "/a/3"].map((p) => `https://x.test${p}`), 4).map((u) => new URL(u).pathname), ["/a/1", "/b/1", "/c/1", "/a/2"]);
  assert.deepEqual(stratifiedSample([], 3), []);

  assert.equal(hasNonHtmlExtension("https://x.test/a.PDF"), true);
  assert.equal(hasNonHtmlExtension("https://x.test/a.pdf?x=1"), true);
  assert.equal(hasNonHtmlExtension("https://x.test/blog/post.html"), false);
  assert.equal(hasNonHtmlExtension("https://x.test/download"), false);

  const fr = (status: number, body = "", headers: Record<string, string> = {}, error?: string): FetchResult => ({ url: "u", finalUrl: "u", status, headers: new Headers(headers), body, bytes: body.length, ms: 1, chain: [], contentType: "text/html", error });
  assert.equal(detectBlock(fr(200, "<p>Solve the captcha to comment</p>")), null, "body markers alone never block a 200");
  assert.equal(detectBlock(fr(200, "<script src='/cdn-cgi/challenge-platform/x'></script>"))?.kind, "challenge", "strong signatures do");
  assert.equal(detectBlock(fr(403, "", { "cf-mitigated": "challenge" }))?.kind, "challenge");
  assert.equal(detectBlock(fr(503, "<title>Just a moment...</title>"))?.kind, "challenge");
  assert.equal(detectBlock(fr(429))?.kind, "rate-limited");
  assert.equal(detectBlock(fr(403, "", { server: "AkamaiGHost" }))?.kind, "waf");
  assert.equal(detectBlock(fr(403, "forbidden"))?.kind, "forbidden");
  assert.equal(detectBlock(fr(0, "", {}, "CERT_HAS_EXPIRED: certificate has expired")), null, "no HTTP response is never a firewall block (C20)");
  assert.equal(detectBlock(fr(0, "", {}, "ECONNREFUSED")), null);
  assert.equal(detectBlock(fr(404)), null);
});

/* ---------- probeSite ---------- */

test("probeSite: 8 variant kinds with hops/finalUrl/canonical, robots (+Googlebot resource blocks), sitemaps, soft-404, headers, tls, og:image", async () => {
  clearSitemapCache();
  const log: LogEntry[] = [];
  const probe = await probeSite("site.test", { fetcher: makeFetcher(SITE, log), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });

  assert.equal(probe.entryUrl, "https://site.test/");
  assert.equal(probe.host, "site.test");
  assert.equal(probe.entry.status, 200);
  assert.equal(probe.entry.userAgent, SEO_BOT_UA);
  assert.deepEqual(probe.blocked, { detected: false, kind: null, evidence: "" });
  assert.equal(probe.entryError, null);
  assert.deepEqual(probe.altHost, { host: "www.site.test", exists: true });
  assert.equal(probe.jsDependent, false);

  const v = Object.fromEntries(probe.variants.map((x) => [x.kind, x]));
  assert.deepEqual(Object.keys(v).sort(), ["http-apex", "http-www", "https-apex", "https-www", "index-html", "trailing-slash", "uppercase", "utm"]);
  assert.equal(v["https-apex"].status, 200);
  assert.deepEqual(v["https-apex"].chain, []);
  assert.equal(v["https-apex"].canonical, "https://site.test/", "entry response reused for the identical variant");
  assert.equal(v["http-apex"].status, 301);
  assert.equal(v["http-apex"].location, "https://site.test/");
  assert.deepEqual(v["http-apex"].chain, ["https://site.test/"]);
  assert.deepEqual(v["http-apex"].hops, [301]);
  assert.equal(v["http-apex"].finalUrl, "https://site.test/");
  assert.deepEqual(v["http-www"].chain, ["https://www.site.test/", "https://site.test/"]);
  assert.deepEqual(v["http-www"].hops, [301, 301]);
  assert.equal(v["trailing-slash"].url, "https://site.test/about/");
  assert.equal(v["trailing-slash"].status, 301);
  assert.equal(v["uppercase"].url, "https://site.test/ABOUT");
  assert.equal(v["uppercase"].status, 200);
  assert.equal(v["uppercase"].canonical, "https://site.test/about");
  assert.equal(v["index-html"].url, "https://site.test/index.html");
  assert.equal(v["index-html"].status, 404);
  assert.equal(v["utm"].url, "https://site.test/?utm_source=aeoeye&utm_medium=seo-audit");
  assert.equal(v["utm"].canonical, "https://site.test/");
  assert.equal(v["utm"].metaRefresh, false);
  assert.equal(log.filter((l) => l.method === "HEAD" && /^https?:\/\/(www\.)?site\.test\/$/.test(l.url)).length, 3, "host variants use HEAD; the one equal to the entry is reused");
  assert.equal(log.filter((l) => l.url === "https://site.test/" && l.method === "GET").length, 2, "entry fetched with our desktop and mobile UA, nothing more");
  assert.deepEqual(new Set(log.map((l) => l.ua)), new Set([SEO_BOT_UA, SEO_BOT_MOBILE_UA]), "only AEOeyeBot user agents, never a browser or Googlebot (C39)");

  assert.equal(probe.robots.found, true);
  assert.equal(probe.robots.blocksEntry, false);
  assert.equal(probe.robots.disallowAll, false);
  assert.deepEqual(probe.robots.sitemaps, ["https://site.test/sitemap.xml"]);
  assert.ok(Array.isArray(probe.robots.groups), "probe.robots can be handed straight to crawlSite");
  assert.equal(probe.robots.contentType, "text/plain");
  assert.deepEqual(probe.robotsMeta, {
    contentType: "text/plain",
    isHtml: false,
    googlebotDisallowAll: false,
    blocksResources: ["https://site.test/blocked-assets/site.css"],
    crawlDelay: null,
    // 名单归 robots.ts 管(v4 补了检索类 / 训练类机器人);这里只要求名单里每一个都有判定 —— 本站 robots 没点名任何 AI 爬虫
    aiCrawlers: Object.fromEntries(Object.keys(AI_CRAWLERS).map((name) => [name, "unspecified"])),
    hasSitemapDirective: true,
  });

  const sm = probe.sitemaps.find((s) => s.url === "https://site.test/sitemap.xml");
  assert.ok(sm);
  assert.equal(sm.valid, true);
  assert.equal(sm.urlCount, 4);
  assert.equal(sm.lastmodShare, 0.25);

  assert.match(probe.soft404.probeUrl, /^https:\/\/site\.test\/aeoeye-404-probe-[0-9a-f]{8}$/);
  assert.equal(probe.soft404.status, 404);
  assert.equal(probe.soft404.isSoft404, false);

  assert.equal(probe.headers.hsts, "max-age=63072000");
  assert.equal(probe.headers.xFrameOptions, "DENY");
  assert.equal(probe.headers.server, "fake");
  assert.equal(probe.headers.csp, null);

  assert.deepEqual(probe.tls, { validTo: "2027-01-01T00:00:00.000Z", daysLeft: 92, issuer: "Fake CA", coversWww: true, error: null });
  assert.deepEqual(probe.ogImage, { url: "https://site.test/og.png", status: 200, bytes: 4321, contentType: "image/png" });
  assert.deepEqual(probe.canonicalTargets, [], "self-referencing canonical is not a target");
  assert.ok(probe.parity);
  assert.equal(probe.parity.mobileWords, probe.parity.desktopWords);
  assert.equal(probe.parity.mobileH1, "Home");
});

test("probeSite: soft-404 detected, HEAD falls back to GET on 405, blocked host throws", async () => {
  const site: Record<string, FakePage> = { ...SITE, __soft404__: { status: 200 }, "https://site.test/": { ...SITE["https://site.test/"], headStatus: 405 } };
  const log: LogEntry[] = [];
  const probe = await probeSite("https://site.test/pricing", { fetcher: makeFetcher(site, log), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.equal(probe.soft404.isSoft404, true);
  const methods = log.filter((l) => l.url === "https://site.test/").map((l) => l.method);
  assert.deepEqual(methods, ["HEAD", "GET"], "405 on HEAD → GET fallback (entry is /pricing, so no reuse)");
  assert.equal(probe.variants.find((x) => x.kind === "https-apex")?.status, 200);
  assert.equal(probe.variants.find((x) => x.kind === "trailing-slash")?.url, "https://site.test/pricing/");
  assert.equal(probe.variants.find((x) => x.kind === "index-html")?.url, "https://site.test/index.html");
  assert.equal(probe.variants.find((x) => x.kind === "utm")?.url, "https://site.test/pricing?utm_source=aeoeye&utm_medium=seo-audit");

  await assert.rejects(
    probeSite("https://10.0.0.1/", { fetcher: makeFetcher(site), ...FAST }),
    (e: unknown) => e instanceof SeoAuditError && e.code === "blocked"
  );
});

test("probeSite: a firewall rule against our UA → blocked at once (no browser-UA retry, no further requests); blocked for every UA → outcome blocked", async () => {
  const botOnly: Record<string, FakePage> = {
    ...SITE,
    "https://site.test/": { ...SITE["https://site.test/"], forUa: { AEOeyeBot: { status: 403, body: "<h1>Access denied</h1>", headers: { server: "cloudflare" } } } },
  };
  const log1: LogEntry[] = [];
  const p1 = await probeSite("site.test", { fetcher: makeFetcher(botOnly, log1), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.equal(p1.blocked?.detected, true, "a UA rule against AEOeyeBot must take effect (C39)");
  assert.equal(p1.blocked?.kind, "waf");
  assert.equal(p1.entry.status, 403);
  assert.equal(p1.entry.userAgent, SEO_BOT_UA);
  assert.deepEqual(p1.variants, []);
  assert.equal(p1.jsDependent, undefined);
  assert.deepEqual(new Set(log1.map((l) => l.url)), new Set(["https://site.test/", "https://site.test/robots.txt"]), "after the block only robots.txt (fetched in parallel) — no mobile, soft-404, sitemap or variant requests");
  assert.ok(log1.every((l) => l.ua === SEO_BOT_UA));

  const all: Record<string, FakePage> = {
    ...SITE,
    "https://site.test/": { status: 503, body: "<title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1'></script>", headers: { server: "cloudflare", "cf-mitigated": "challenge" } },
  };
  const log: LogEntry[] = [];
  const p2 = await probeSite("site.test", { fetcher: makeFetcher(all, log), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.equal(p2.blocked?.detected, true);
  assert.equal(p2.blocked?.kind, "challenge");
  assert.match(p2.blocked?.evidence ?? "", /cf-mitigated: challenge/);
  assert.deepEqual(p2.variants, [], "no variant probing against a site that blocks us");
  assert.equal(p2.jsDependent, undefined);
  assert.equal(p2.parity, null);
  assert.equal(p2.ogImage, null);
  assert.deepEqual(p2.sitemaps, [], "no sitemap requests against a site that just blocked us");
  assert.equal(p2.robots.found, true, "robots.txt is still recorded");
  assert.equal(p2.entryError, null, "an HTTP block is not a connection error");
  assert.ok(!log.some((l) => l.url.includes("/ABOUT") || l.url.includes("utm_source") || l.url.includes("sitemap")));
});

test("probeSite: mobile UA (ours) gets less content than the desktop UA (ours) → parity gap", async () => {
  const site: Record<string, FakePage> = {
    "https://par.test/": {
      body: html("Desktop", ["/a", "/b", "/c"], [], '<script type="application/ld+json">{"@type":"WebSite"}</script>', 200),
      forUa: { Mobile: { body: html("Mobile", ["/a"], [], "", 20) } },
    },
  };
  const log: LogEntry[] = [];
  const probe = await probeSite("par.test", { fetcher: makeFetcher(site, log), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.ok(probe.parity);
  assert.equal(probe.parity.mobileWords < probe.parity.desktopWords * 0.5, true);
  assert.equal(probe.parity.mobileH1, "Mobile");
  assert.equal(probe.parity.desktopH1, "Desktop");
  assert.equal(probe.parity.mobileLinks, 1);
  assert.equal(probe.parity.desktopLinks, 3);
  assert.equal(probe.parity.mobileJsonLd, 0);
  assert.equal(probe.parity.desktopJsonLd, 1);
  assert.deepEqual(new Set(log.filter((l) => l.url === "https://par.test/").map((l) => l.ua)), new Set([SEO_BOT_UA, SEO_BOT_MOBILE_UA]));
});

test("probeSite: the entry page is parsed once when the mobile body is identical (C6)", async () => {
  let entryParses = 0;
  const counting: typeof parsePageDetailed = (body, res, depth, host) => {
    if (res.url === "https://site.test/" && body) entryParses++;
    return parsePageDetailed(body, res, depth, host);
  };
  clearSitemapCache();
  const probe = await probeSite("site.test", { fetcher: makeFetcher(SITE), hostCheck: noHostCheck, tlsCheck: fakeTls, parse: counting, ...FAST });
  assert.ok(probe.parity);
  assert.equal(entryParses, 1, "desktop entry, mobile parity and the reused https-apex variant share one parse");
  clearSitemapCache();
});

test("probeSite: JS shell entry → jsDependent; canonical elsewhere → canonicalTargets", async () => {
  const shell = `<!DOCTYPE html><html><head><title>App</title><link rel="canonical" href="https://spa.test/home"></head><body><div id="root"></div><script src="/static/app.js"></script><script>${"x".repeat(4000)}</script></body></html>`;
  const site: Record<string, FakePage> = {
    "https://spa.test/": { body: shell },
    "https://spa.test/home": { body: html("Home", [], [], '<meta name="robots" content="noindex">') },
    "https://spa.test/robots.txt": { body: "User-agent: *\nDisallow: /static/\nUser-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nAllow: /\nCrawl-delay: 1\n", contentType: "text/plain" },
  };
  const probe = await probeSite("spa.test", { fetcher: makeFetcher(site), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.equal(probe.jsDependent, true);
  assert.deepEqual(probe.robotsMeta?.blocksResources, ["https://spa.test/static/app.js"]);
  assert.equal(probe.robotsMeta?.aiCrawlers.GPTBot, "disallow");
  assert.equal(probe.robotsMeta?.aiCrawlers.ClaudeBot, "allow");
  assert.equal(probe.robotsMeta?.aiCrawlers.PerplexityBot, "unspecified");
  assert.equal(probe.robotsMeta?.hasSitemapDirective, false);
  assert.deepEqual(probe.canonicalTargets, [{ url: "https://spa.test/home", status: 200, finalUrl: "https://spa.test/home", noindex: true }]);
  assert.equal(probe.robotsMeta?.crawlDelay, null, "Crawl-delay belongs to ClaudeBot's group, not ours");
});

/* ---------- enrichProbe / probeAndCrawl ---------- */

test("enrichProbe: sitemap sample excludes crawled URLs, broken internal/outbound links, large images, crawl TTFB, coverage", async () => {
  clearSitemapCache();
  const fetcher = makeFetcher(SITE);
  const probe = await probeSite("site.test", { fetcher, hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  // 7 页:/team 抓到了(它链到 /missing 与两条外链),/old、/blog/post-*、/missing 留在抓取集合之外
  const { pages, coverage } = await crawlSiteDetailed("site.test", { maxPages: 7, robots: probe.robots, timeBudgetMs: 10_000, fetcher, sitemaps: probe.sitemaps, ...FAST });
  assert.deepEqual(pages.map((p) => new URL(p.url).pathname), ["/", "/about", "/pricing", "/blog", "/contact", "/deep/a/b/c", "/team"]);
  const log: LogEntry[] = [];
  const enriched = await enrichProbe(probe, pages, { fetcher: makeFetcher(SITE, log), coverage, ...FAST });

  assert.deepEqual(enriched.sitemapSample, [
    { url: "https://site.test/orphan-1", status: 200, noindex: true, canonical: null, sameHost: true },
    { url: "https://site.test/orphan-2", status: 404, noindex: false, canonical: null, sameHost: true },
  ]);
  assert.deepEqual(enriched.brokenInternal, [{ from: "https://site.test/team", to: "https://site.test/missing", status: 404 }]);
  assert.ok(!log.some((l) => l.url === "https://site.test/contact"), "already-crawled 404s are not re-checked");
  assert.ok(log.some((l) => l.url === "https://site.test/old" && l.method === "HEAD"), "unfetched internal targets are HEAD-checked");
  assert.ok(log.some((l) => l.url === "https://site.test/blog/post-1"));
  assert.deepEqual(enriched.brokenOutbound?.map((b) => b.to).sort(), ["https://dead.test/gone", "https://other.test/x"], "403 from botwall.test is a bot block, not a broken link");
  assert.ok(log.some((l) => l.url === "https://botwall.test/p"), "it was still checked");
  // v4:分母 = 实际请求过的外链(other.test、dead.test、botwall.test);403 查过了,只是不算死链
  assert.equal(enriched.outboundChecked, 3);
  assert.deepEqual(enriched.largeImages, [{ url: "https://site.test/big.jpg", bytes: 300000 }]);
  assert.ok(log.filter((l) => l.url.endsWith(".jpg")).every((l) => l.method === "HEAD"));
  assert.deepEqual(enriched.crawlTtfb, { p50: 120, p90: 900, slowest: [{ url: "https://site.test/blog", ms: 900 }, { url: "https://site.test/about", ms: 300 }, { url: "https://site.test/", ms: 120 }] });
  assert.deepEqual(enriched.coverage, coverage);
  assert.deepEqual(coverage, { navPages: 7, sitemapPages: 0, skippedByRobots: 1, stoppedEarly: null });
  clearSitemapCache();
});

test("probeAndCrawl: end to end on the fake site, robots fetched once", async () => {
  clearSitemapCache();
  const log: LogEntry[] = [];
  const { probe, pages, coverage } = await probeAndCrawl("site.test", { maxPages: 20, fetcher: makeFetcher(SITE, log), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.equal(log.filter((l) => l.url.endsWith("/robots.txt")).length, 1);
  assert.ok(pages.length >= 10);
  assert.equal(probe.coverage, coverage);
  assert.ok(Array.isArray(probe.sitemapSample));
  assert.ok(Array.isArray(probe.brokenInternal));
  assert.equal(probe.variants.length, 8);
  clearSitemapCache();
});

/* ---------- safeFetch(注入 fetchImpl + hostCheck,不联网;共享的跳转循环) ---------- */

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(routes: Record<string, Route>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    if (!route) return new Response("missing", { status: 404 });
    return route(url, init ?? {});
  }) as typeof fetch;
}

test("safeFetch follows redirects manually, re-checking every host, and records hops", async () => {
  const checked: string[] = [];
  const res = await safeFetch("https://a.test/start", {
    fetchImpl: fakeFetch({
      "https://a.test/start": () => new Response(null, { status: 301, headers: { location: "/next" } }),
      "https://a.test/next": () => new Response(null, { status: 302, headers: { location: "https://b.test/final#frag" } }),
      "https://b.test/final": () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    }),
    hostCheck: async (h) => {
      checked.push(h);
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.finalUrl, "https://b.test/final");
  assert.deepEqual(res.chain, ["https://a.test/next", "https://b.test/final"]);
  assert.deepEqual(
    res.hops?.map((h) => [h.status, h.location]),
    [
      [301, "https://a.test/next"],
      [302, "https://b.test/final"],
      [200, null],
    ]
  );
  assert.deepEqual(checked, ["a.test", "a.test", "b.test"]);
  assert.equal(res.body, "<html>ok</html>");
  assert.equal(res.contentType, "text/html; charset=utf-8");
  assert.equal(res.error, undefined);
  assert.equal(typeof res.ttfbMs, "number");
});

test("safeFetch refuses redirects into blocked hosts, downgrades, too many redirects, bad schemes and ports", async () => {
  const toEvil = await safeFetch("https://a.test/", {
    fetchImpl: fakeFetch({ "https://a.test/": () => new Response(null, { status: 302, headers: { location: "https://evil.internal/" } }) }),
    hostCheck: async (h) => {
      if (h.endsWith(".internal")) throw new SeoAuditError("blocked");
    },
  });
  assert.equal(toEvil.status, 0);
  assert.match(toEvil.error ?? "", /^blocked:/);
  assert.equal(toEvil.hops?.length, 1);

  const downgrade = await safeFetch("https://a.test/", {
    fetchImpl: fakeFetch({ "https://a.test/": () => new Response(null, { status: 302, headers: { location: "http://a.test/" } }) }),
    hostCheck: noHostCheck,
  });
  assert.equal(downgrade.status, 302);
  assert.match(downgrade.error ?? "", /^downgrade:/);

  const loop = await safeFetch("https://a.test/", {
    fetchImpl: fakeFetch({ "https://a.test/": () => new Response(null, { status: 301, headers: { location: "https://a.test/" } }) }),
    hostCheck: noHostCheck,
    maxRedirects: 3,
  });
  assert.equal(loop.status, 301);
  assert.match(loop.error ?? "", /Too many redirects/);
  assert.equal(loop.chain.length, 3);

  assert.match((await safeFetch("ftp://a.test/", { hostCheck: noHostCheck, fetchImpl: fakeFetch({}) })).error ?? "", /Unsupported protocol/);
  assert.match((await safeFetch("https://a.test:8443/", { hostCheck: noHostCheck, fetchImpl: fakeFetch({}) })).error ?? "", /Non-default port/);
  assert.match((await safeFetch("https://u:p@a.test/", { hostCheck: noHostCheck, fetchImpl: fakeFetch({}) })).error ?? "", /Credentials/);
});

test("safeFetch caps the body by reading the stream, decodes charsets, handles HEAD, never throws", async () => {
  const chunk = new Uint8Array(1000).fill(97);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const capped = await safeFetch("https://a.test/big", {
    fetchImpl: fakeFetch({ "https://a.test/big": () => new Response(stream, { status: 200, headers: { "content-type": "text/html" } }) }),
    hostCheck: noHostCheck,
    maxBytes: 1500,
  });
  assert.equal(capped.status, 200);
  assert.equal(capped.bytes, 1500);
  assert.equal(capped.truncated, true);
  assert.equal(capped.body.length, 1500);

  const latin = await safeFetch("https://a.test/latin", {
    fetchImpl: fakeFetch({ "https://a.test/latin": () => new Response(new Uint8Array([0xe9]), { status: 200, headers: { "content-type": "text/html; charset=iso-8859-1" } }) }),
    hostCheck: noHostCheck,
  });
  assert.equal(latin.body, "é");

  const head = await safeFetch("https://a.test/", {
    fetchImpl: fakeFetch({ "https://a.test/": (_u, init) => new Response(init.method === "HEAD" ? null : "body", { status: 200 }) }),
    hostCheck: noHostCheck,
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");

  const down = await safeFetch("https://a.test/", {
    fetchImpl: (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND a.test" } });
    }) as typeof fetch,
    hostCheck: noHostCheck,
  });
  assert.equal(down.status, 0);
  assert.match(down.error ?? "", /ENOTFOUND/);

  const slow = await safeFetch("https://a.test/", {
    fetchImpl: ((_u: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch,
    hostCheck: noHostCheck,
    timeoutMs: 60,
  });
  assert.equal(slow.status, 0);
  assert.match(slow.error ?? "", /Timed out after 60ms/);

  const ua = await safeFetch("https://a.test/", {
    fetchImpl: fakeFetch({ "https://a.test/": (_u, init) => new Response(String(new Headers(init.headers).get("user-agent")), { status: 200 }) }),
    hostCheck: noHostCheck,
  });
  assert.equal(ua.body, SEO_BOT_UA);
  const custom = await safeFetch("https://a.test/", {
    fetchImpl: fakeFetch({ "https://a.test/": (_u, init) => new Response(String(new Headers(init.headers).get("user-agent")), { status: 200 }) }),
    hostCheck: noHostCheck,
    userAgent: SEO_BOT_MOBILE_UA,
  });
  assert.equal(custom.body, SEO_BOT_MOBILE_UA);
});

/* ---------- 复审 C20:入口证书 / 握手失败不是"防火墙拦截" ---------- */

test("classifyFetchError: tls / dns / timeout / refused / other", () => {
  assert.equal(classifyFetchError("CERT_HAS_EXPIRED: certificate has expired"), "tls");
  assert.equal(classifyFetchError("ERR_TLS_CERT_ALTNAME_INVALID: Hostname/IP does not match certificate's altnames"), "tls");
  assert.equal(classifyFetchError("UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate"), "tls");
  assert.equal(classifyFetchError("ECONNRESET: Client network socket disconnected before secure TLS connection was established"), "tls");
  assert.equal(classifyFetchError("EPROTO: write EPROTO wrong version number"), "tls");
  assert.equal(classifyFetchError("ENOTFOUND: getaddrinfo ENOTFOUND nope.example"), "dns");
  assert.equal(classifyFetchError("EAI_AGAIN: getaddrinfo EAI_AGAIN nope.example"), "dns");
  assert.equal(classifyFetchError('unreachable: DNS lookup failed for "nope.example".'), "dns");
  assert.equal(classifyFetchError("Timed out after 8000ms"), "timeout");
  assert.equal(classifyFetchError("No response within 5000ms (connect / first byte)"), "timeout");
  assert.equal(classifyFetchError("ECONNREFUSED: connect ECONNREFUSED 1.2.3.4:443"), "refused");
  assert.equal(classifyFetchError("ECONNRESET: socket hang up"), "other");
  assert.equal(classifyFetchError(undefined), "other");
});

test("probeSite: expired certificate on the entry → entryError tls, NOT blocked, variants still probed (C20)", async () => {
  const site: Record<string, FakePage> = {
    "https://expired.test/": { error: "CERT_HAS_EXPIRED: certificate has expired" },
    "https://www.expired.test/": { error: "CERT_HAS_EXPIRED: certificate has expired" },
    "http://expired.test/": { status: 301, location: "https://expired.test/" },
    "http://www.expired.test/": { status: 301, location: "https://expired.test/" },
  };
  const probe = await probeSite("expired.test", { fetcher: makeFetcher(site), hostCheck: noHostCheck, tlsCheck: async () => ({ validTo: null, daysLeft: -3, issuer: "X", coversWww: null, error: "expired: the certificate has expired" }), ...FAST });
  assert.deepEqual(probe.blocked, { detected: false, kind: null, evidence: "" });
  assert.deepEqual(probe.entryError, { kind: "tls", message: "CERT_HAS_EXPIRED: certificate has expired" });
  assert.equal(probe.entry.status, 0);
  const http = probe.variants.find((v) => v.kind === "http-apex");
  assert.equal(http?.status, 301, "the http variant still shows where it redirects");
  assert.equal(probe.altHost?.exists, true, "www responds at the TCP level (a certificate error is not a missing host)");
});

/* ---------- 复审 C21:www ↔ 裸域另一主机是否存在 ---------- */

test("probeSite: a subdomain whose www.<sub> host does not resolve → altHost.exists false; an IP host gets no www variants", async () => {
  const dns = "ENOTFOUND: getaddrinfo ENOTFOUND www.blog.sub.test";
  const site: Record<string, FakePage> = {
    "https://blog.sub.test/": { body: html("Blog", []) },
    "http://blog.sub.test/": { status: 301, location: "https://blog.sub.test/" },
    "https://www.blog.sub.test/": { error: dns },
    "http://www.blog.sub.test/": { error: dns },
  };
  const probe = await probeSite("blog.sub.test", { fetcher: makeFetcher(site), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.deepEqual(probe.altHost, { host: "www.blog.sub.test", exists: false, error: dns });
  assert.equal(probe.variants.find((v) => v.kind === "https-www")?.status, null, "the variants stay (checks ignore them via altHost)");

  // www 入口的另一主机是裸域
  const fromWww = await probeSite("www.site.test", { fetcher: makeFetcher(SITE), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.equal(fromWww.altHost?.host, "site.test");
  assert.equal(fromWww.altHost?.exists, true);

  const ip = await probeSite("https://93.184.216.34/", { fetcher: makeFetcher({ "https://93.184.216.34/": { body: html("IP", []) } }), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  assert.equal(ip.altHost, null);
  assert.ok(!ip.variants.some((v) => v.kind === "https-www" || v.kind === "http-www"), "no www.<ip> nonsense hosts");
});

/* ---------- 复审 C40:补全阶段的礼貌 ---------- */

test("enrichProbe: after the crawl stopped early, no same-host request is made and those fields stay undefined (n/a, not '0 problems'); off-site links are still checked", async () => {
  clearSitemapCache();
  const probe = await probeSite("site.test", { fetcher: makeFetcher(SITE), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  const { pages } = await crawlSiteDetailed("site.test", { maxPages: 7, robots: probe.robots, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE), sitemaps: probe.sitemaps, ...FAST });
  delete (probe as { ogImage?: unknown }).ogImage;
  const coverage = { navPages: 7, sitemapPages: 0, skippedByRobots: 1, stoppedEarly: "HTTP 429 at /x — crawl stopped to stay polite" };
  const log: LogEntry[] = [];
  const enriched = await enrichProbe(probe, pages, { fetcher: makeFetcher(SITE, log), coverage, ...FAST });
  assert.ok(!log.some((l) => new URL(l.url).hostname.endsWith("site.test")), `same-host requests after a stop: ${log.map((l) => l.url).join(", ")}`);
  assert.equal(enriched.sitemapSample, undefined);
  assert.equal(enriched.brokenInternal, undefined);
  assert.equal(enriched.largeImages, undefined);
  assert.equal(enriched.ogImage, undefined);
  assert.deepEqual(enriched.brokenOutbound?.map((b) => b.to).sort(), ["https://dead.test/gone", "https://other.test/x"], "outbound links live on other hosts: still checked");
  assert.equal(enriched.outboundChecked, 3);
  assert.ok(enriched.crawlTtfb, "TTFB comes from the crawl itself");
  clearSitemapCache();
});

test("enrichProbe: outboundChecked is the number of outbound links actually requested — set when none is broken, 0 when blocked or out of budget", async () => {
  clearSitemapCache();
  // 三条外链全部有效:brokenOutbound 为空,但分母照样是 3("查了 3 条、0 条坏" ≠ "没查")
  const healthy: Record<string, FakePage> = {
    ...SITE,
    "https://other.test/x": { body: "ok" },
    "https://dead.test/gone": { body: "ok" },
    "https://botwall.test/p": { body: "ok" },
  };
  const probe = await probeSite("site.test", { fetcher: makeFetcher(healthy), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  const { pages, coverage } = await crawlSiteDetailed("site.test", { maxPages: 7, robots: probe.robots, timeBudgetMs: 10_000, fetcher: makeFetcher(healthy), sitemaps: probe.sitemaps, ...FAST });
  const log: LogEntry[] = [];
  const enriched = await enrichProbe(probe, pages, { fetcher: makeFetcher(healthy, log), coverage, ...FAST });
  assert.deepEqual(enriched.brokenOutbound, []);
  assert.equal(enriched.outboundChecked, 3);
  assert.equal(log.filter((l) => !new URL(l.url).hostname.endsWith("site.test")).length, 3, "one request per outbound link (HEAD answered, no GET fallback)");

  // 预算一开始就用完:一条都没发出去 → 分母 0,而不是"3 条全部有效"
  const p2 = await probeSite("site.test", { fetcher: makeFetcher(SITE), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  const c2 = await crawlSiteDetailed("site.test", { maxPages: 7, robots: p2.robots, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE), sitemaps: p2.sitemaps, ...FAST });
  const log2: LogEntry[] = [];
  const e2 = await enrichProbe(p2, c2.pages, { fetcher: makeFetcher(SITE, log2), coverage: c2.coverage, timeBudgetMs: 0, ...FAST });
  assert.equal(e2.outboundChecked, 0);
  assert.deepEqual(e2.brokenOutbound, []);
  assert.ok(!log2.some((l) => l.url.startsWith("https://other.test/")), "nothing was requested");

  // 站点把我们拦了:整个补全阶段不做,分母 0
  const p3 = await probeSite("site.test", { fetcher: makeFetcher(SITE), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  p3.blocked = { detected: true, kind: "waf", evidence: "HTTP 403 from a WAF" };
  const e3 = await enrichProbe(p3, c2.pages, { fetcher: makeFetcher(SITE), coverage: c2.coverage, ...FAST });
  assert.equal(e3.outboundChecked, 0);
  assert.deepEqual(e3.brokenOutbound, []);
  clearSitemapCache();
});

test("enrichProbe: same-host requests keep the crawl's interval (Crawl-delay), concurrency 4 by default", async () => {
  clearSitemapCache();
  const probe = await probeSite("site.test", { fetcher: makeFetcher(SITE), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  const { pages, coverage } = await crawlSiteDetailed("site.test", { maxPages: 7, robots: probe.robots, timeBudgetMs: 10_000, fetcher: makeFetcher(SITE), sitemaps: probe.sitemaps, ...FAST });
  const log: LogEntry[] = [];
  await enrichProbe(probe, pages, { fetcher: makeFetcher(SITE, log), coverage, minIntervalMs: 60 });
  const starts = log.filter((l) => new URL(l.url).hostname === "site.test").map((l) => l.t).sort((a, b) => a - b);
  assert.ok(starts.length >= 4, `${starts.length} same-host requests`);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 55, `gap ${i}: ${starts[i] - starts[i - 1]}ms`);
  clearSitemapCache();
});

test("enrichProbe: a 429 during the post-crawl phase halts further same-host probes; 401/403/429 targets are never 'broken links'", async () => {
  clearSitemapCache();
  const site: Record<string, FakePage> = {
    ...SITE,
    "https://site.test/missing": { status: 403, body: "members only" },
    "https://site.test/old": { status: 429, body: "slow down" },
  };
  const probe = await probeSite("site.test", { fetcher: makeFetcher(site), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  const { pages, coverage } = await crawlSiteDetailed("site.test", { maxPages: 7, robots: probe.robots, timeBudgetMs: 10_000, fetcher: makeFetcher(site), sitemaps: probe.sitemaps, ...FAST });
  assert.equal(coverage.stoppedEarly, null);
  const log: LogEntry[] = [];
  const enriched = await enrichProbe(probe, pages, { fetcher: makeFetcher(site, log), coverage, concurrency: 1, ...FAST });
  const hit429 = log.findIndex((l) => l.url === "https://site.test/old");
  assert.ok(hit429 >= 0);
  const after = log.slice(hit429 + 1).filter((l) => new URL(l.url).hostname === "site.test");
  assert.deepEqual(after, [], "nothing more to the host that rate-limited us");
  assert.equal(enriched.brokenInternal, undefined, "the broken-link sample was cut short → n/a, not a partial pass");
  assert.match(enriched.coverage?.stoppedEarly ?? "", /HTTP 429 at \/old — post-crawl checks stopped/);
  clearSitemapCache();

  // 没有被限流时:403 内链目标不算死链
  const site2: Record<string, FakePage> = { ...SITE, "https://site.test/missing": { status: 403, body: "members only" } };
  const p2 = await probeSite("site.test", { fetcher: makeFetcher(site2), hostCheck: noHostCheck, tlsCheck: fakeTls, ...FAST });
  const c2 = await crawlSiteDetailed("site.test", { maxPages: 7, robots: p2.robots, timeBudgetMs: 10_000, fetcher: makeFetcher(site2), sitemaps: p2.sitemaps, ...FAST });
  const e2 = await enrichProbe(p2, c2.pages, { fetcher: makeFetcher(site2), coverage: c2.coverage, ...FAST });
  assert.deepEqual(e2.brokenInternal, [], "a 403 target is access control, not a broken link");
  clearSitemapCache();
});

test("probeSite: with robots known up front, its Crawl-delay spaces every probe request", async () => {
  clearSitemapCache();
  const robots = { ...emptyRobots(200), found: true, ...parseRobots("User-agent: *\nCrawl-delay: 0.08\n"), url: "https://site.test/robots.txt" };
  const log: LogEntry[] = [];
  await probeSite("site.test", { fetcher: makeFetcher(SITE, log), hostCheck: noHostCheck, tlsCheck: fakeTls, robots, ...FAST });
  const starts = log.filter((l) => new URL(l.url).hostname === "site.test").map((l) => l.t).sort((a, b) => a - b);
  assert.ok(starts.length >= 6);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 75, `gap ${i}: ${starts[i] - starts[i - 1]}ms`);
  clearSitemapCache();
});
