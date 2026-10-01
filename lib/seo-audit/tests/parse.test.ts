import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePage, parsePageDetailed } from "../parse";
import type { FetchResult } from "../fetch";

function fr(url: string, init: Partial<FetchResult> & { headers?: Headers } = {}): FetchResult {
  const body = init.body ?? "";
  return {
    url,
    finalUrl: init.finalUrl ?? url,
    status: init.status ?? 200,
    headers: init.headers ?? new Headers(),
    body,
    bytes: body.length,
    ms: 5,
    chain: init.chain ?? [],
    contentType: init.contentType ?? "text/html; charset=utf-8",
    ...init,
  };
}

const SIXTY_WORDS = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");

const HOME = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title> Example Site — Home </title>
<meta name="description" content="A description that is long enough to be considered fine for search snippets, really.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<link rel="canonical" href="/">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="alternate" hreflang="en" href="https://example.com/">
<link rel="alternate" hreflang="x-default" href="/">
<meta property="og:title" content="Example">
<meta property="og:image" content="https://example.com/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="http://cdn.example.com/style.css">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Example","url":"https://example.com"},{"@type":"WebPage","breadcrumb":{"@type":"BreadcrumbList","itemListElement":[]}}]}</script>
<script type="application/ld+json">{ this is broken</script>
<style>body { color: red }</style>
</head>
<body>
<header><nav><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/about/">About</a></nav></header>
<h1>Welcome to Example</h1>
<h3>Skipped level</h3>
<h2>Second</h2>
<p>${SIXTY_WORDS}</p>
<img src="/a.png" alt="A"><img src="http://example.com/b.png"><img src="/c.png" alt="">
<a href="/blog?utm_source=x#top">Blog</a>
<a href="https://www.example.com/pricing">Read more</a>
<a href="https://external.org/x">External</a>
<a href="mailto:hi@example.com">Mail</a>
<a href="/docs" rel="nofollow">click here!</a>
<script>document.write("not visible words here at all");</script>
<noscript><img src="/tracking.gif"><a href="/noscript-link">ns</a></noscript>
<template><a href="/template-link">t</a></template>
<footer><a href="/privacy">Privacy</a></footer>
</body></html>`;

test("parsePageDetailed extracts every field from a realistic page", () => {
  const { page, navLinks } = parsePageDetailed(HOME, fr("https://example.com/", { body: HOME }), 0, "example.com");

  assert.equal(page.url, "https://example.com/");
  assert.equal(page.status, 200);
  assert.equal(page.redirects, 0);
  assert.equal(page.depth, 0);
  assert.equal(page.title, "Example Site — Home");
  assert.match(page.description, /^A description/);
  assert.equal(page.lang, "en");
  assert.equal(page.viewport, "width=device-width, initial-scale=1");
  assert.equal(page.robotsMeta, "index, follow");
  assert.equal(page.canonical, "https://example.com/", "relative canonical resolved");
  assert.equal(page.hasFavicon, true);

  assert.deepEqual(page.h1s, ["Welcome to Example"]);
  assert.deepEqual(
    page.headings.map((h) => h.level),
    [1, 3, 2]
  );

  assert.deepEqual(page.hreflang, [
    { lang: "en", href: "https://example.com/" },
    { lang: "x-default", href: "https://example.com/" },
  ]);
  assert.equal(page.og["og:title"], "Example");
  assert.equal(page.og["og:image"], "https://example.com/og.png");
  assert.equal(page.twitter["twitter:card"], "summary_large_image");

  assert.deepEqual(page.jsonLdTypes.sort(), ["BreadcrumbList", "Organization", "WebPage"]);
  assert.equal(page.jsonLdErrors, 1);
  assert.equal(page.hasBreadcrumbSchema, true);

  assert.equal(page.mixedContent, 2, "http stylesheet + http image");
  assert.deepEqual(page.images, { total: 3, missingAlt: 1 }, "noscript images not counted; alt=\"\" is not missing");

  assert.equal(page.internalLinks, 7);
  assert.equal(page.externalLinks, 1);
  assert.deepEqual(page.links, [
    "https://example.com/pricing",
    "https://example.com/about/",
    "https://example.com/blog",
    "https://example.com/docs",
    "https://example.com/privacy",
  ]);
  assert.equal(page.genericAnchors, 2, "'Read more' and 'click here!'");
  assert.deepEqual(navLinks, ["https://example.com/pricing", "https://example.com/about/", "https://example.com/privacy"]);

  // 3+2+1 headings + 3 nav + 60 + Blog(1) Read more(2) External(1) Mail(1) click here(2) Privacy(1)
  assert.equal(page.wordCount, 77);
  assert.ok(page.textToHtml > 0 && page.textToHtml < 1);

  assert.ok(page.issues.includes("Title too short (19 chars)"), page.issues.join(" | "));
  assert.ok(page.issues.includes("Heading levels skipped (e.g. H1 → H3)"));
  assert.ok(page.issues.includes("1 of 3 images missing alt"));
  assert.ok(page.issues.includes("1 JSON-LD block failed to parse"));
  assert.ok(page.issues.includes("2 mixed-content resources (http:// on an https page)"));
  assert.ok(page.issues.includes("Thin content (77 words)"));
  assert.ok(!page.issues.some((i) => i.startsWith("Missing")), "nothing is missing on this page");
});

test("parsePage: minimal page issues, X-Robots-Tag, multiple canonicals, http page has no mixed content", () => {
  const html = `<html><head><title>${"T".repeat(70)}</title><link rel="canonical" href="https://example.com/x"><link rel="canonical" href="https://example.com/y"></head><body><h1>a</h1><h1>b</h1><img src="http://example.com/i.png"><p>hi</p></body></html>`;
  const page = parsePage(html, fr("http://example.com/x", { body: html, headers: new Headers({ "x-robots-tag": "noindex, nofollow" }) }), 1, "example.com");
  assert.equal(page.xRobotsTag, "noindex, nofollow");
  assert.equal(page.canonical, "https://example.com/x", "first canonical wins");
  assert.equal(page.mixedContent, 0, "http page cannot have mixed content");
  assert.equal(page.lang, null);
  assert.equal(page.viewport, null);
  for (const expected of [
    "Title too long (70 chars)",
    "Missing meta description",
    "2 H1 tags (should be one)",
    "2 canonical tags (should be exactly one)",
    "X-Robots-Tag: noindex, nofollow",
    "Only 0 internal links",
  ]) {
    assert.ok(page.issues.includes(expected), `${expected} in ${page.issues.join(" | ")}`);
  }
  assert.ok(!page.issues.includes("Missing viewport meta"), "viewport only flagged on the entry page");
});

test("parsePage: non-HTML, fetch failures, 404 and redirects are described, not scored", () => {
  const pdf = parsePage("", fr("https://example.com/f.pdf", { contentType: "application/pdf", body: "" }), 1, "example.com");
  assert.deepEqual(pdf.issues, ["Not an HTML page (application/pdf)"]);

  const dead = parsePage("", fr("https://example.com/dead", { status: 0, error: "ECONNREFUSED", contentType: "" }), 1, "example.com");
  assert.deepEqual(dead.issues, ["Fetch failed: ECONNREFUSED"]);

  const nf = parsePage("<html><body><h1>Not found</h1></body></html>", fr("https://example.com/nf", { status: 404, body: "<html><body><h1>Not found</h1></body></html>" }), 2, "example.com");
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.h1s, ["Not found"]);
  assert.deepEqual(nf.issues, ["HTTP 404"], "error pages are not judged on content");

  const moved = parsePage("<html><body></body></html>", fr("https://example.com/old", { finalUrl: "https://example.com/new", chain: ["https://example.com/new"], body: "<html><body></body></html>" }), 1, "example.com");
  assert.equal(moved.redirects, 1);
  assert.equal(moved.finalUrl, "https://example.com/new");
  assert.ok(moved.issues.includes("Reached via 1 redirect"));
});

test("parsePage: CJK text counts characters as words; svg <title> is not the page title", () => {
  const html = `<html><head></head><body><svg><title>icon</title></svg><p>你好世界 hello</p></body></html>`;
  const page = parsePage(html, fr("https://example.com/", { body: html }), 0, "example.com");
  assert.equal(page.title, "");
  assert.equal(page.wordCount, 5);
  assert.ok(page.issues.includes("Missing <title>"));
  assert.ok(page.issues.includes("Missing viewport meta"));
  assert.ok(page.issues.includes("Missing <html lang>"));
  assert.ok(page.issues.includes("Missing canonical"));
});

test("parsePage: JSON-LD wrapped in CDATA/comments still parses; microdata breadcrumb detected", () => {
  const html = `<html><head><script type="application/ld+json">//<![CDATA[
{"@type":["WebSite","Thing"],"name":"x"}
//]]></script></head><body><ol itemscope itemtype="https://schema.org/BreadcrumbList"></ol></body></html>`;
  const page = parsePage(html, fr("https://example.com/", { body: html }), 0, "example.com");
  assert.deepEqual(page.jsonLdTypes.sort(), ["Thing", "WebSite"]);
  assert.equal(page.jsonLdErrors, 0);
  assert.equal(page.hasBreadcrumbSchema, true);
});

/* ---------- V2 字段 ---------- */

import { minhashSignature, pageTypeFor } from "../parse";

const WORDS = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

test("V2: ttfbMs, lastModified (max of header and JSON-LD dateModified), metaRefresh, robots directives, link/image counters, textSample", () => {
  const body = `<!DOCTYPE html><html><head><title>${"Title long enough for the checks here".padEnd(35, ".")}</title>
<meta http-equiv="refresh" content="5; url=/new">
<meta name="googlebot" content="noindex">
<script type="application/ld+json">{"@type":"Article","dateModified":"2026-09-20T00:00:00Z","headline":"h"}</script>
</head><body>
<header><nav><a href="/">Home</a><a href="/a">A</a><a href="/b">B</a></nav></header>
<main><h1>Main</h1><p>${WORDS(30)}</p>
<a href="/c" rel="nofollow noopener">C</a><a href="/c">C again</a><a href="https://ext.test/1">E1</a><a href="https://ext.test/2">E2</a><a href="https://ext.test/1">E1 dup</a>
<img src="/i1.png" width="10" height="10" alt="a"><img src="/i2.png" alt="b"><img src="data:image/png;base64,AAAA" alt="c"><img src="https://cdn.test/i3.png" height="3">
</main>
<footer><a href="/privacy">Privacy</a><p>footer words here</p></footer>
</body></html>`;
  const page = parsePage(body, fr("https://example.com/x", { body, headers: new Headers({ "x-robots-tag": "nofollow", "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT" }), ttfbMs: 321 }), 1, "example.com");
  assert.equal(page.ttfbMs, 321);
  assert.equal(page.lastModified, "2026-09-20T00:00:00.000Z", "JSON-LD dateModified is newer than the Last-Modified header");
  assert.equal(page.metaRefresh, true);
  assert.ok(page.issues.includes("Uses <meta http-equiv=\"refresh\"> redirect"));
  assert.equal(page.robotsNoindex, true, "googlebot meta noindex");
  assert.equal(page.robotsNofollow, true, "X-Robots-Tag nofollow");
  assert.equal(page.nofollowInternal, 1);
  assert.equal(page.uniqueInternalLinks, 5, "/ /a /b /c /privacy (self excluded, /c deduped)");
  assert.equal(page.navLinks, 4, "/ /a /b in <nav>, /privacy in <footer>");
  assert.equal(page.imagesMissingDims, 3);
  assert.deepEqual(page.imageUrls, ["https://example.com/i1.png", "https://example.com/i2.png", "https://cdn.test/i3.png"], "data: URIs skipped");
  assert.deepEqual(page.outboundLinks, ["https://ext.test/1", "https://ext.test/2"]);
  assert.ok(page.textSample?.startsWith("Main w0 w1"), `textSample starts with main content, not nav: ${page.textSample?.slice(0, 40)}`);
  assert.ok(!page.textSample?.includes("footer words"), "footer text is not part of the main text");
  assert.ok(page.wordCount > 30, "wordCount keeps nav/footer (v1 contract)");
  assert.equal(page.pageType, "article", "Article JSON-LD wins");
  assert.ok(typeof page.scriptShare === "number" && page.scriptShare > 0 && page.scriptShare < 1);
  assert.equal(page.jsShell, false);
  assert.ok(Array.isArray(page.minhash) && page.minhash.length === 64);

  const headerOnly = parsePage("<html><body><p>x</p></body></html>", fr("https://example.com/", { body: "<html><body><p>x</p></body></html>", headers: new Headers({ "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT" }) }), 0, "example.com");
  assert.equal(headerOnly.lastModified, "2025-01-01T00:00:00.000Z");
  assert.equal(headerOnly.robotsNoindex, false);
  assert.equal(headerOnly.minhash, undefined, "fewer than 5 words → no signature");
  assert.equal(parsePage("", fr("https://example.com/", { status: 0, error: "x", contentType: "" }), 0, "example.com").lastModified, null);
});

test("V2: jsShell — empty mount point with few words/links, or script-dominated HTML", () => {
  const shell = `<html><head><title>App</title></head><body><div id="__next"></div><script src="/app.js"></script></body></html>`;
  const p1 = parsePage(shell, fr("https://example.com/", { body: shell }), 0, "example.com");
  assert.equal(p1.jsShell, true);
  assert.ok(p1.issues.includes("Raw HTML is a JavaScript shell (content rendered client-side)"));

  const heavy = `<html><body><p>a few words only</p><script>${"y".repeat(5000)}</script></body></html>`;
  assert.equal(parsePage(heavy, fr("https://example.com/", { body: heavy }), 0, "example.com").jsShell, true, "script share > 0.6 with < 80 words");

  const ssr = `<html><body><div id="root"><h1>Real</h1><p>${WORDS(150)}</p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></div><script>${"y".repeat(200)}</script></body></html>`;
  assert.equal(parsePage(ssr, fr("https://example.com/", { body: ssr }), 0, "example.com").jsShell, false, "mount point with content is fine");

  const staticNoMount = `<html><body><p>short</p></body></html>`;
  assert.equal(parsePage(staticNoMount, fr("https://example.com/", { body: staticNoMount }), 0, "example.com").jsShell, false, "thin but no mount point and no scripts");
});

test("V2: pageTypeFor heuristics", () => {
  const t = (url: string, types: string[] = [], dated = 0) => pageTypeFor(url, types, dated);
  assert.equal(t("https://x.test/"), "home");
  assert.equal(t("https://x.test/index.html"), "home");
  assert.equal(t("https://x.test/pricing"), "pricing");
  assert.equal(t("https://x.test/en/plans/"), "pricing");
  assert.equal(t("https://x.test/legal/privacy"), "legal");
  assert.equal(t("https://x.test/terms-of-service"), "legal");
  assert.equal(t("https://x.test/about-us"), "contact");
  assert.equal(t("https://x.test/contact"), "contact");
  assert.equal(t("https://x.test/blog/my-post"), "article");
  assert.equal(t("https://x.test/docs/getting-started"), "article");
  assert.equal(t("https://x.test/blog"), "listing");
  assert.equal(t("https://x.test/blog/page/2"), "listing");
  assert.equal(t("https://x.test/category/shoes"), "listing");
  assert.equal(t("https://x.test/tag/x"), "listing");
  assert.equal(t("https://x.test/search?q=x"), "listing");
  assert.equal(t("https://x.test/shop/red-shoe"), "product");
  assert.equal(t("https://x.test/shop"), "listing");
  assert.equal(t("https://x.test/anything", ["Product"]), "product");
  assert.equal(t("https://x.test/anything", ["BlogPosting"]), "article");
  assert.equal(t("https://x.test/anything", [], 2), "article", "two dated paragraphs");
  assert.equal(t("https://x.test/anything", [], 1), "other");
  assert.equal(t("https://x.test/features"), "other");

  const dated = `<html><body><h1>T</h1><p>Published on September 12, 2026</p><p>${WORDS(20)}</p><time datetime="2026-09-13">Sep 13</time></body></html>`;
  assert.equal(parsePage(dated, fr("https://x.test/some-slug", { body: dated }), 1, "x.test").pageType, "article");
});

test("V2: minhash — identical text → 1.0, near-identical → high, unrelated → low; deterministic", () => {
  const same = (a: number[] | undefined, b: number[] | undefined) => {
    assert.ok(a && b);
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++;
    return n / a.length;
  };
  const base = WORDS(200, "alpha");
  const a = minhashSignature(base);
  assert.deepEqual(a, minhashSignature(base));
  assert.equal(same(a, minhashSignature(base)), 1);
  const nearly = `${base} one extra sentence at the end here`;
  assert.ok(same(a, minhashSignature(nearly)) > 0.85, "adding a few words keeps similarity high");
  assert.ok(same(a, minhashSignature(WORDS(200, "beta"))) < 0.2, "different vocabulary → low");
  const half = `${WORDS(100, "alpha")} ${WORDS(100, "gamma")}`;
  const s = same(a, minhashSignature(half));
  assert.ok(s > 0.2 && s < 0.6, `about half the shingles shared: ${s}`);
  assert.equal(minhashSignature("one two three four"), undefined);
  assert.equal(minhashSignature("one two three four five")?.length, 64);

  const pageA = `<html><body><nav><a href="/">Home</a><a href="/x">X</a></nav><main><p>${base}</p></main><footer>© 2026 Example Inc</footer></body></html>`;
  const pageB = `<html><body><nav><a href="/">Home</a><a href="/y">Y</a></nav><main><p>${base}</p></main><footer>© 2026 Example Inc</footer></body></html>`;
  const pa = parsePage(pageA, fr("https://x.test/a", { body: pageA }), 1, "x.test");
  const pb = parsePage(pageB, fr("https://x.test/b", { body: pageB }), 1, "x.test");
  assert.equal(same(pa.minhash, pb.minhash), 1, "nav/footer differences do not affect the main-text fingerprint");
});

/* ---------- 复审 C6:DOM 炸弹与落库体积 ---------- */

import { MAX_DOM_ELEMENTS, MAX_LINKS, MAX_HEADINGS, MAX_H1S, MAX_HREFLANG, MAX_META_KEYS, clipText, prepareMarkup, robotsDirectiveFlags } from "../parse";

const timed = <T,>(fn: () => T): { value: T; ms: number } => {
  const t0 = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t0 };
};

test("C6: a 2 MB page of flat links is truncated before parsing, stays fast and small, and keeps the true link counts", () => {
  const units: string[] = ["<html><body>"];
  let len = 12;
  for (let i = 0; len < 2 * 1024 * 1024; i++) {
    const u = `<a href="/p${i}">x</a>\n`;
    units.push(u);
    len += u.length;
  }
  const body = units.join("");
  const { value: page, ms } = timed(() => parsePage(body, fr("https://example.com/", { body }), 1, "example.com"));
  assert.ok(ms < 3_000, `parse took ${ms}ms`);
  assert.ok(page.issues.includes(`Unusually large DOM (>${MAX_DOM_ELEMENTS.toLocaleString("en-US")} elements); analysis truncated`), page.issues.join(" | "));
  assert.equal(page.links.length, MAX_LINKS, "stored links are capped");
  assert.ok((page.uniqueInternalLinks ?? 0) > MAX_LINKS, "the unique-link count is not capped");
  assert.equal(page.internalLinks, page.uniqueInternalLinks);
  assert.ok(JSON.stringify(page).length < 100_000, `stored page is ${JSON.stringify(page).length} bytes`);
});

test("C6: headings / H1s / hreflang / og / twitter / JSON-LD types are capped, H1 count and heading skips use the full stream", () => {
  const heads = Array.from({ length: 400 }, (_, i) => `<h${(i % 3) + 1}>Heading ${i} ${"t".repeat(300)}</h${(i % 3) + 1}>`).join("");
  const metas = Array.from({ length: 120 }, (_, i) => `<meta property="og:k${i}" content="v${i}"><meta name="twitter:k${i}" content="v${i}">`).join("");
  const alts = Array.from({ length: 150 }, (_, i) => `<link rel="alternate" hreflang="x-${i}" href="/l/${i}">`).join("");
  const ld = `<script type="application/ld+json">[${Array.from({ length: 300 }, (_, i) => `{"@type":"T${i}","dateModified":"2026-0${(i % 9) + 1}-01"}`).join(",")}]</script>`;
  const body = `<html><head><title>t</title>${metas}${alts}${ld}</head><body>${heads}<h5>skip</h5></body></html>`;
  const page = parsePage(body, fr("https://example.com/x", { body }), 1, "example.com");
  assert.equal(page.headings.length, MAX_HEADINGS);
  assert.equal(page.h1s.length, MAX_H1S);
  assert.ok(page.headings.every((h) => h.text.length <= 200), "heading text is clipped");
  assert.ok(page.issues.includes("134 H1 tags (should be one)"), "the H1 count is the real one");
  assert.ok(page.issues.includes("Heading levels skipped (e.g. H1 → H3)"), "a skip after the cap is still seen");
  assert.equal(page.hreflang.length, MAX_HREFLANG);
  assert.equal(Object.keys(page.og).length, MAX_META_KEYS);
  assert.equal(Object.keys(page.twitter).length, MAX_META_KEYS);
  assert.equal(page.jsonLdTypes.length, 100);
  assert.equal(page.lastModified, "2026-09-01T00:00:00.000Z");
});

test("C6: thousands of nested elements do not blow the stack — the page is re-read shallowly instead of failing the crawl", () => {
  const body = `<html><head><title>Deep page title long enough ok</title></head><body>${"<div>".repeat(20_000)}<a href="/x">x</a></body></html>`;
  const { value: page, ms } = timed(() => parsePage(body, fr("https://example.com/", { body }), 0, "example.com"));
  assert.ok(ms < 3_000, `took ${ms}ms`);
  assert.ok(page.issues.some((i) => /nested too deeply/.test(i)), page.issues.join(" | "));
  assert.equal(page.title, "Deep page title long enough ok");
});

test("C6: nested headings / anchors over one huge text node are not copied once per level", () => {
  const body = `<html><body>${"<h2><span>".repeat(1500)}${"word ".repeat(300_000)}</body></html>`;
  const { value: page, ms } = timed(() => parsePage(body, fr("https://example.com/", { body }), 1, "example.com"));
  assert.ok(ms < 3_000, `took ${ms}ms`);
  assert.equal(page.headings.length, MAX_HEADINGS);
  assert.ok(page.headings.every((h) => h.text.length <= 200));
});

test("C6: an unclosed <!-- cuts the page there (browsers hide the rest too) and is flagged; thousands of them are linear", () => {
  const body = `<html><head><title>Comment test page title ok</title></head><body><p>visible text here</p><!-- forgot to close <a href="/hidden">h</a>${"<!--x".repeat(100_000)}`;
  const { value: page, ms } = timed(() => parsePage(body, fr("https://example.com/", { body }), 1, "example.com"));
  assert.ok(ms < 1_000, `took ${ms}ms`);
  assert.ok(page.issues.includes("Unclosed HTML comment (<!--): browsers treat everything after it as a comment"));
  assert.ok(!page.links.includes("https://example.com/hidden"));
  assert.ok(page.wordCount >= 3);
});

test("C6: script/style/noscript/template contents are cut out before parsing — JSON-LD, script share and the noscript/template exclusions still hold", () => {
  const pre = prepareMarkup(`<p>a</p><script type="application/ld+json">{"@type":"X"}</script><STYLE>p>a{}</STYLE><noscript><img src=/n.gif></noscript><template><a href=/t>t</a></template><script>var s = "</scr" + "ipt>";</script><b>z</b>`);
  assert.deepEqual(pre.blocks.map((b) => b.tag), ["script", "style", "noscript", "template", "script"]);
  assert.equal(pre.blocks[0].content, '{"@type":"X"}');
  assert.ok(!pre.html.includes("n.gif") && !pre.html.includes("/t>"), pre.html);
  assert.ok(pre.html.includes("<b>z</b>"));
  assert.equal(pre.elements, 7, "p, script, style, noscript, template, script, b — the img/a inside raw-text blocks are not counted");

  // 引号里的 '<script' 不是一个原始文本块
  const quoted = prepareMarkup(`<a title="<script>">link</a><p>after</p><script>x</script>`);
  assert.deepEqual(quoted.blocks.map((b) => b.content), ["x"]);
  assert.ok(quoted.html.includes("<p>after</p>"));

  // 几千个 script 也是线性的(解析器不再为每个 script 把整篇文档 toLowerCase 一遍)
  const many = `<html><body>${Array.from({ length: 5_000 }, (_, i) => `<script>var a${i}=1;</script>`).join("")}${"<p>filler text</p>".repeat(50_000)}`;
  const { value: page, ms } = timed(() => parsePage(many, fr("https://example.com/", { body: many }), 1, "example.com"));
  assert.ok(ms < 3_000, `took ${ms}ms`);
  assert.ok((page.scriptShare ?? 0) > 0);
});

test("C6: stored strings are clipped without splitting a surrogate pair (half an emoji would make jsonb reject the whole report)", () => {
  assert.equal(clipText("ab😀cd", 3), "ab", "the high surrogate at the cut is dropped, not left dangling");
  assert.equal(clipText("ab😀cd", 4), "ab😀");
  assert.equal(clipText("short", 10), "short");
  const text = `${"x".repeat(399)}😀 tail words here for the sample`;
  const body = `<html><body><main><p>${text}</p></main></body></html>`;
  const page = parsePage(body, fr("https://example.com/a", { body }), 1, "example.com");
  const last = page.textSample?.charCodeAt((page.textSample?.length ?? 1) - 1) ?? 0;
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), "textSample does not end in a lone high surrogate");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(page)));
});

/* ---------- 复审 C23:robots 指令逐项整项匹配 ---------- */

test("C23: max-image-preview:none is not noindex; valued directives are skipped; none = noindex + nofollow", () => {
  const meta = (content: string) => {
    const body = `<html><head><meta name="robots" content="${content}"></head><body><h1>x</h1></body></html>`;
    return parsePage(body, fr("https://example.com/", { body }), 0, "example.com");
  };
  const preview = meta("index, follow, max-image-preview:none");
  assert.equal(preview.robotsNoindex, false);
  assert.equal(preview.robotsNofollow, false);
  assert.ok(!preview.issues.some((i) => i.startsWith("Meta robots")), "no noindex issue for a preview directive");
  assert.equal(meta("max-snippet:-1, max-video-preview:-1").robotsNoindex, false);
  assert.equal(meta("max-image-preview: none").robotsNoindex, false, "space after the colon");
  const none = meta("none");
  assert.equal(none.robotsNoindex, true);
  assert.equal(none.robotsNofollow, true);
  assert.equal(meta("NOINDEX,NOFOLLOW").robotsNoindex, true);
  assert.equal(meta("noindex nofollow").robotsNofollow, true, "space-separated tokens are still read");
  assert.ok(meta("noindex").issues.includes("Meta robots: noindex"));
  assert.equal(meta("unavailable_after: Saturday, 01-Jul-00 15:00:00 PST").robotsNoindex, false, "the date's own commas do not create tokens");
});

test("C23: X-Robots-Tag user-agent scopes — only unprefixed or googlebot directives count, the scope runs until the next prefix", () => {
  const header = (value: string) => {
    const body = "<html><head><title>x</title></head><body><h1>x</h1></body></html>";
    return parsePage(body, fr("https://example.com/", { body, headers: new Headers({ "x-robots-tag": value }) }), 1, "example.com");
  };
  assert.equal(header("otherbot: noindex").robotsNoindex, false);
  assert.ok(!header("otherbot: noindex").issues.some((i) => i.startsWith("X-Robots-Tag")), "no issue for another crawler's rule");
  assert.equal(header("otherbot: noindex, nofollow").robotsNofollow, false, "the scope continues after the comma");
  assert.equal(header("bingbot: nofollow, noindex").robotsNoindex, false);
  assert.equal(header("googlebot: noindex").robotsNoindex, true);
  assert.equal(header("googlebot: max-image-preview:none").robotsNoindex, false);
  const mixed = header("googlebot: nofollow, otherbot: noindex, nofollow");
  assert.equal(mixed.robotsNoindex, false);
  assert.equal(mixed.robotsNofollow, true);
  assert.equal(header("noindex").robotsNoindex, true);
  assert.equal(header("unavailable_after: 25 Jun 2010 15:00:00 PST, noindex").robotsNoindex, true);
  assert.deepEqual(robotsDirectiveFlags("max-image-preview:none", true), { noindex: false, nofollow: false });
  assert.deepEqual(robotsDirectiveFlags("googlebot: none", true), { noindex: true, nofollow: true });
});
