import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { cachedSitemapLocs, clearSitemapCache, discoverSitemaps, parseSitemapXml, sampleSitemapUrls, type SitemapFetcher } from "../sitemap";
import type { FetchResult } from "../fetch";

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schema/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-09-01</lastmod></url>
  <url><loc><![CDATA[https://example.com/a?x=1&y=2]]></loc><lastmod>2026-09-20T10:00:00+00:00</lastmod></url>
  <url><loc>https://example.com/b?p=1&amp;q=2</loc></url>
</urlset>`;

const INDEX = (n: number) => `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schema/sitemap/0.9">
${Array.from({ length: n }, (_, i) => `<sitemap><loc>https://example.com/sm-${i + 1}.xml</loc><lastmod>2026-08-0${(i % 9) + 1}</lastmod></sitemap>`).join("\n")}
</sitemapindex>`;

const urlsetOf = (prefix: string, n: number, withLastmod = true) =>
  `<urlset>${Array.from({ length: n }, (_, i) => `<url><loc>https://example.com/${prefix}/${i}</loc>${withLastmod ? `<lastmod>2026-07-${String((i % 28) + 1).padStart(2, "0")}</lastmod>` : ""}</url>`).join("")}</urlset>`;

function fr(url: string, init: Partial<FetchResult> & { body?: string; raw?: Uint8Array } = {}): FetchResult {
  const body = init.body ?? "";
  return {
    url,
    finalUrl: url,
    status: init.status ?? 200,
    headers: new Headers(),
    body,
    bytes: body.length,
    ms: 1,
    chain: [],
    contentType: init.contentType ?? "application/xml",
    ...init,
  };
}

beforeEach(() => clearSitemapCache());

test("parseSitemapXml: urlset with CDATA, entities and partial lastmod", () => {
  const p = parseSitemapXml(URLSET);
  assert.equal(p.valid, true);
  assert.equal(p.isIndex, false);
  assert.deepEqual(p.locs, ["https://example.com/", "https://example.com/a?x=1&y=2", "https://example.com/b?p=1&q=2"]);
  assert.equal(p.urlCount, 3);
  assert.equal(p.lastmodShare, 0.667);
  assert.equal(p.newestLastmod, "2026-09-20T10:00:00.000Z");
});

test("parseSitemapXml: index, html, empty, text list, first 2000 locs kept but every entry counted (V2)", () => {
  const idx = parseSitemapXml(INDEX(4));
  assert.equal(idx.isIndex, true);
  assert.equal(idx.valid, true);
  assert.equal(idx.locs.length, 4);

  const html = parseSitemapXml("<!DOCTYPE html><html><body>404</body></html>");
  assert.equal(html.valid, false);
  assert.match(html.error ?? "", /HTML/);

  assert.equal(parseSitemapXml("").valid, false);
  assert.equal(parseSitemapXml("<urlset></urlset>").valid, false);
  assert.equal(parseSitemapXml("<rss><channel></channel></rss>").valid, false);

  const txt = parseSitemapXml("https://example.com/a\nhttps://example.com/b\nnot a url\n");
  assert.equal(txt.valid, true);
  assert.equal(txt.urlCount, 2);

  const big = parseSitemapXml(urlsetOf("p", 5100, false));
  assert.equal(big.urlCount, 5100, "urlCount counts every entry in the file");
  assert.equal(big.locs.length, 2000, "only the first 2000 locs are kept in memory");
  assert.equal(big.lastmodShare, 0);
  assert.equal(big.newestLastmod, null);
  const half = parseSitemapXml(urlsetOf("q", 3000, true).replace(/<lastmod>[^<]*<\/lastmod>/g, (m, i) => (i % 2 ? m : "")));
  assert.equal(half.urlCount, 3000);
  assert.ok(half.lastmodShare > 0.3 && half.lastmodShare < 0.7, `lastmodShare over the whole file: ${half.lastmodShare}`);
});

test("discoverSitemaps: candidates from robots + defaults, one index expanded with at most 5 children, aggregation", async () => {
  const calls: string[] = [];
  const fetcher: SitemapFetcher = async (url) => {
    calls.push(url);
    const path = new URL(url).pathname;
    if (path === "/sm-index.xml") return fr(url, { body: INDEX(7) });
    if (/^\/sm-\d\.xml$/.test(path)) return fr(url, { body: urlsetOf(path.slice(1, -4), 10) });
    return fr(url, { status: 404, body: "nope", contentType: "text/html" });
  };

  const infos = await discoverSitemaps("https://example.com", ["/sm-index.xml", "https://example.com/sm-index.xml"], fetcher);
  // 索引 + 2 个默认候选(404)+ 5 个子文件
  assert.equal(infos.length, 8);
  const index = infos.find((i) => i.url === "https://example.com/sm-index.xml");
  assert.ok(index);
  assert.equal(index.isIndex, true);
  assert.equal(index.valid, true);
  assert.equal(index.urlCount, 50, "index aggregates its fetched children");
  assert.equal(index.lastmodShare, 1);
  assert.equal(index.children.length, 7);
  assert.equal(calls.filter((u) => /sm-\d\.xml$/.test(u)).length, 5, "only 5 children fetched");
  assert.equal(calls.filter((u) => u.endsWith("/sm-index.xml")).length, 1, "duplicate robots entries fetched once");

  const notFound = infos.filter((i) => i.status === 404);
  assert.equal(notFound.length, 2);
  assert.equal(notFound[0].valid, false);
  assert.equal(notFound[0].error, "HTTP 404");

  const sample = sampleSitemapUrls(infos, 5);
  assert.equal(sample.length, 5);
  assert.equal(new Set(sample).size, 5);
  assert.ok(sample.every((u) => /^https:\/\/example\.com\/sm-\d\/\d+$/.test(u)));
  assert.equal(sampleSitemapUrls(infos, 100).length, 50);
  assert.deepEqual(sampleSitemapUrls(infos, 0), []);
  assert.equal(cachedSitemapLocs(infos).length, 50, "cachedSitemapLocs exposes the whole pool");
});

test("discoverSitemaps: only the first sitemap index is expanded (V2: 1 index + 5 children)", async () => {
  const calls: string[] = [];
  const fetcher: SitemapFetcher = async (url) => {
    calls.push(url);
    const path = new URL(url).pathname;
    if (path === "/sitemap.xml" || path === "/sitemap_index.xml") return fr(url, { body: INDEX(2).replace(/sm-/g, path === "/sitemap.xml" ? "a-" : "b-") });
    if (/^\/[ab]-\d\.xml$/.test(path)) return fr(url, { body: urlsetOf(path.slice(1, -4), 3) });
    return fr(url, { status: 404 });
  };
  const infos = await discoverSitemaps("https://example.com", [], fetcher);
  const second = infos.find((i) => i.url.endsWith("/sitemap_index.xml"));
  assert.ok(second?.isIndex);
  assert.match(second?.error ?? "", /Not expanded/);
  assert.equal(calls.filter((u) => /\/b-\d\.xml$/.test(u)).length, 0, "children of the second index are never fetched");
  assert.equal(calls.filter((u) => /\/a-\d\.xml$/.test(u)).length, 2);
});

test("discoverSitemaps: a gzip bomb is rejected by the 5 MB decompression cap", async () => {
  const bomb = gzipSync(Buffer.alloc(6 * 1024 * 1024, 0x20));
  const fetcher: SitemapFetcher = async (url) => {
    if (url.endsWith("/sitemap.xml.gz")) return fr(url, { body: "", raw: new Uint8Array(bomb), contentType: "application/gzip" });
    return fr(url, { status: 404 });
  };
  const infos = await discoverSitemaps("https://example.com", ["https://example.com/sitemap.xml.gz"], fetcher);
  const gz = infos.find((i) => i.url.endsWith(".gz"));
  assert.ok(gz);
  assert.equal(gz.valid, false);
  assert.match(gz.error ?? "", /larger than the 5 MB limit/);
});

test("discoverSitemaps: gzipped sitemap is decompressed, network error is reported", async () => {
  const gz = gzipSync(Buffer.from(URLSET));
  const fetcher: SitemapFetcher = async (url) => {
    if (url.endsWith("/sitemap.xml.gz")) return fr(url, { body: "\u001f\u008b garbage", raw: new Uint8Array(gz), contentType: "application/gzip" });
    if (url.endsWith("/sitemap.xml")) return fr(url, { status: 0, error: "ECONNRESET", contentType: "" });
    return fr(url, { status: 404 });
  };
  const infos = await discoverSitemaps("https://example.com", ["https://example.com/sitemap.xml.gz"], fetcher);
  const gzInfo = infos.find((i) => i.url.endsWith(".gz"));
  assert.ok(gzInfo);
  assert.equal(gzInfo.valid, true);
  assert.equal(gzInfo.urlCount, 3);
  const broken = infos.find((i) => i.url.endsWith("/sitemap.xml"));
  assert.ok(broken);
  assert.equal(broken.status, null);
  assert.equal(broken.error, "ECONNRESET");
});

test("sampleSitemapUrls returns nothing when the cache was never filled", () => {
  assert.deepEqual(
    sampleSitemapUrls([{ url: "https://x.test/s.xml", status: 200, valid: true, isIndex: false, urlCount: 3, lastmodShare: 0, newestLastmod: null, children: [] }], 3),
    []
  );
});

/* ---------- 复审 C7:线性扫描,恶意 / 畸形输入不能把函数同步卡死 ---------- */

test("C7: a 2 MB sitemap of unclosed <url> tags parses in well under a second (was quadratic)", () => {
  const xml = `<urlset>${"<url>".repeat((2 * 1024 * 1024) / 5)}`;
  const t0 = Date.now();
  const p = parseSitemapXml(xml);
  const ms = Date.now() - t0;
  assert.ok(ms < 300, `took ${ms}ms`);
  assert.equal(p.valid, false);
  assert.equal(p.urlCount, 0);
});

test("C7: every other quadratic shape is linear too (5 MB each): unclosed <loc> fallback, unclosed <loc>/<lastmod> inside one entry, '<url ' without '>', unclosed <sitemap>", () => {
  const MB5 = 5 * 1024 * 1024;
  const shapes: [string, string][] = [
    ["unclosed <loc> fallback", `<urlset>${"<loc>".repeat(MB5 / 5)}`],
    ["unclosed <loc> in an entry", `<urlset><url>${"<loc>".repeat(MB5 / 5)}</url></urlset>`],
    ["unclosed <lastmod> in an entry", `<urlset><url><loc>https://example.com/a</loc>${"<lastmod>".repeat(MB5 / 9)}</url></urlset>`],
    ["'<url ' without '>'", `<urlset>${"<url ".repeat(MB5 / 5)}`],
    ["unclosed <sitemap>", `<sitemapindex>${"<sitemap>".repeat(MB5 / 9)}`],
  ];
  for (const [label, xml] of shapes) {
    const t0 = Date.now();
    parseSitemapXml(xml);
    const ms = Date.now() - t0;
    assert.ok(ms < 1_000, `${label}: ${ms}ms`);
  }
  // 一个条目里 <lastmod> 没闭合:<loc> 照收,lastmod 不算
  const p = parseSitemapXml(`<urlset><url><loc>https://example.com/a</loc><lastmod>2026-01-01</url></urlset>`);
  assert.equal(p.urlCount, 1);
  assert.equal(p.lastmodShare, 0);
});

test("C7: a large well-formed sitemap is still counted in full and quickly; <url> never matches <urlset>; self-closing entries are skipped", () => {
  const xml = `<urlset>${Array.from({ length: 60_000 }, (_, i) => `<url><loc>https://example.com/p/${i}</loc><lastmod>2026-08-01</lastmod></url>`).join("\n")}</urlset>`;
  const t0 = Date.now();
  const p = parseSitemapXml(xml);
  assert.ok(Date.now() - t0 < 1_000);
  assert.equal(p.urlCount, 60_000);
  assert.equal(p.locs.length, 2000);
  assert.equal(p.lastmodShare, 1);
  assert.equal(parseSitemapXml(`<urlset><url/><url><loc>https://example.com/x</loc></url></urlset>`).urlCount, 1);
  assert.deepEqual(parseSitemapXml(`<urlset xmlns="x"><url ><loc > https://example.com/sp </loc ></url ></urlset>`).locs, ["https://example.com/sp"], "whitespace inside tags is tolerated");
});

test("C7: an out-of-range numeric entity is left as text instead of throwing (one typo must not fail the whole probe)", () => {
  const p = parseSitemapXml(`<urlset><url><loc>https://example.com/a&#x110000;b&#65;</loc></url></urlset>`);
  assert.equal(p.valid, true);
  assert.deepEqual(p.locs, ["https://example.com/a&#x110000;bA"]);
});
