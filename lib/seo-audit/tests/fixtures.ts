/* ============================================================
   测试夹具工厂 —— 一个"健康站"与一个"坏站",各 20 页 + 探针 + PSI

   为什么要造得像真的:阈值检查(0% / ≤20% / >20%)只有在 20 页样本上
   才能验证边界;评分断言(健康 ≥85、gate 封顶 ≤40)必须跑完整的
   runAllOnsiteChecks 才可信,而不是喂几条手写 check。
   不联网、无随机(minhash 用固定种子)。
   ============================================================ */

import type { AuthorityResult, CompetitorsResult, CrawledPage, PsiAudit, PsiResult, SeoAuditResult, SiteProbe, UrlVariant, VisibilityResult } from "../types";
import type { CheckContext } from "../checks";
import { runAllOnsiteChecks } from "../checks";
import { buildRoadmap, overallScore, pickTopIssues, scoreDimensions } from "../score";

export const HOST = "example.com";
export const ORIGIN = `https://${HOST}`;
export const NAV = ["/", "/pricing", "/about", "/contact", "/privacy", "/terms", "/blog"];

export const abs = (path: string): string => `${ORIGIN}${path}`;
export const daysAgoIso = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
export const daysAheadIso = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 固定种子的 minhash 签名:同 seed 同签名,不同 seed 几乎不重合 */
export function minhashFor(seed: number): number[] {
  let s = seed >>> 0;
  return Array.from({ length: 64 }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % 100_003;
  });
}

function seedOf(url: string): number {
  let h = 2166136261;
  for (let i = 0; i < url.length; i += 1) h = Math.imul(h ^ url.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makePage(over: Partial<CrawledPage> & { url: string }): CrawledPage {
  const url = over.url;
  const path = new URL(url).pathname;
  const slug = path.split("/").filter(Boolean).pop() ?? "home";
  const words = slug.replace(/[-_]+/g, " ");
  const h1 = cap(words === "home" ? "AI visibility audits for growing brands" : words);
  const title = `${h1} — Example SEO tools`;
  const description = `Learn ${words} with Example: practical steps, real numbers and a checklist you can run today on ${slug}.`;
  const page: CrawledPage = {
    url,
    finalUrl: url,
    status: 200,
    redirects: 0,
    contentType: "text/html; charset=utf-8",
    bytes: 42_000,
    fetchedMs: 320,
    depth: Math.max(0, path.split("/").filter(Boolean).length),
    title,
    description,
    h1s: [h1],
    headings: [
      { level: 1, text: h1 },
      { level: 2, text: "Why it matters" },
      { level: 2, text: "How to do it" },
      { level: 3, text: "Step by step" },
    ],
    wordCount: 700,
    textToHtml: 0.22,
    canonical: url,
    robotsMeta: "index, follow",
    xRobotsTag: null,
    lang: "en",
    viewport: "width=device-width, initial-scale=1",
    images: { total: 4, missingAlt: 0 },
    internalLinks: 24,
    externalLinks: 3,
    links: NAV.map(abs),
    genericAnchors: 0,
    jsonLdTypes: ["BreadcrumbList"],
    jsonLdErrors: 0,
    og: { "og:title": title, "og:description": description, "og:image": abs("/og.png") },
    twitter: { "twitter:card": "summary_large_image" },
    hreflang: [],
    mixedContent: 0,
    hasBreadcrumbSchema: true,
    hasFavicon: true,
    issues: [],
    ttfbMs: 250,
    lastModified: daysAgoIso(30),
    metaRefresh: false,
    scriptShare: 0.2,
    jsShell: false,
    robotsNoindex: false,
    robotsNofollow: false,
    nofollowInternal: 0,
    uniqueInternalLinks: 20,
    navLinks: 7,
    imagesMissingDims: 0,
    imageUrls: [abs("/img/hero.jpg")],
    outboundLinks: ["https://developers.google.com/search/docs"],
    minhash: minhashFor(seedOf(url)),
    textSample: `${h1}. ${description}`,
  };
  return { ...page, ...over };
}

export const ARTICLE_SLUGS = [
  "how-to-fix-crawl-errors",
  "what-is-a-canonical-tag",
  "site-speed-checklist",
  "mobile-first-indexing-guide",
  "structured-data-basics",
  "internal-linking-playbook",
  "https-migration-steps",
  "sitemap-best-practices",
];

/** 20 页:7 个导航页 + 8 篇文章 + 5 个其它模板页 */
export function healthyPages(): CrawledPage[] {
  const posts = ARTICLE_SLUGS.map((s) => abs(`/blog/${s}`));
  const extra = ["/features", "/docs/getting-started", "/docs/api", "/tools", "/faq"].map(abs);
  const all = [...NAV.map(abs), ...posts, ...extra];
  return all.map((url, i) => {
    const isHome = url === abs("/");
    const isPost = posts.includes(url);
    const related = posts.filter((p) => p !== url).slice(i % 3, (i % 3) + 2);
    return makePage({
      url,
      depth: isHome ? 0 : isPost || url.includes("/docs/") ? 2 : 1,
      links: [...NAV.map(abs), ...related, abs("/features"), abs("/tools"), abs("/faq"), abs("/docs/getting-started"), abs("/docs/api")].filter((l) => l !== url),
      jsonLdTypes: isHome ? ["Organization", "WebSite"] : isPost ? ["Article", "BreadcrumbList"] : ["BreadcrumbList"],
      hasBreadcrumbSchema: !isHome,
      pageType: isHome ? "home" : isPost ? "article" : url.endsWith("/blog") ? "listing" : undefined,
      wordCount: isPost ? 900 + i * 15 : url.includes("/privacy") || url.includes("/terms") ? 1200 : 500 + i * 10,
    });
  });
}

const STD_AUDITS: [string, string, number | null, string][] = [
  ["total-byte-weight", "Avoids enormous network payloads", 1, "Total size was 880 KiB"],
  ["render-blocking-resources", "Eliminate render-blocking resources", 1, ""],
  ["uses-text-compression", "Enable text compression", 1, ""],
  ["uses-long-cache-ttl", "Uses efficient cache policy on static assets", 1, "0 resources found"],
  ["modern-image-formats", "Serve images in next-gen formats", 1, ""],
  ["uses-optimized-images", "Efficiently encode images", 1, ""],
  ["uses-responsive-images", "Properly size images", 1, ""],
  ["unused-javascript", "Reduce unused JavaScript", 1, ""],
  ["font-size", "Document uses legible font sizes", 1, "100% legible text"],
  ["tap-targets", "Tap targets are sized appropriately", 1, "100% appropriately sized tap targets"],
  ["lcp-lazy-loaded", "Largest Contentful Paint image was not lazily loaded", 1, ""],
  ["prioritize-lcp-image", "Preload Largest Contentful Paint image", 1, ""],
  ["unsized-images", "Image elements have explicit width and height", 1, ""],
  ["largest-contentful-paint-element", "Largest Contentful Paint element", null, "1 element found"],
];

export function makeAudits(overrides: Record<string, Partial<PsiAudit>> = {}): PsiAudit[] {
  return STD_AUDITS.map(([id, title, score, displayValue]) => ({ id, title, score, displayValue, description: "", ...(overrides[id] ?? {}) }));
}

export function makePsi(over: Partial<PsiResult> = {}): PsiResult {
  return {
    strategy: "mobile",
    fetchedUrl: abs("/"),
    scores: { performance: 92, seo: 100, accessibility: 95, bestPractices: 96 },
    lab: { lcpMs: 1900, cls: 0.02, tbtMs: 90, fcpMs: 1200, speedIndexMs: 2100, ttiMs: 2600, serverResponseMs: 300, totalBytes: 900_000 },
    field: { lcp: "FAST", inp: "FAST", cls: "FAST", overall: "FAST" },
    audits: makeAudits(),
    fieldMetrics: { lcpMs: 1800, inpMs: 120, cls: 0.03, ttfbMs: 500, source: "page" },
    fetchTime: new Date().toISOString(),
    ...over,
  };
}

export function makeProbe(pages: CrawledPage[], over: Partial<SiteProbe> = {}): SiteProbe {
  const entryUrl = abs("/");
  const probe: SiteProbe = {
    input: HOST,
    entryUrl,
    origin: ORIGIN,
    host: HOST,
    variants: [
      { url: `http://${HOST}/`, status: 301, location: entryUrl, chain: [`http://${HOST}/`, entryUrl], kind: "http-apex", hops: [301], finalUrl: entryUrl },
      { url: `http://www.${HOST}/`, status: 301, location: entryUrl, chain: [`http://www.${HOST}/`, entryUrl], kind: "http-www", hops: [301], finalUrl: entryUrl },
      { url: entryUrl, status: 200, location: null, chain: [entryUrl], kind: "https-apex", hops: [], finalUrl: entryUrl, canonical: entryUrl },
      { url: `https://www.${HOST}/`, status: 301, location: entryUrl, chain: [`https://www.${HOST}/`, entryUrl], kind: "https-www", hops: [301], finalUrl: entryUrl },
      { url: abs("/pricing/"), status: 301, location: abs("/pricing"), chain: [abs("/pricing/"), abs("/pricing")], kind: "trailing-slash", hops: [301], finalUrl: abs("/pricing") },
      { url: abs("/index.html"), status: 404, location: null, chain: [abs("/index.html")], kind: "index-html", hops: [], finalUrl: abs("/index.html") },
      { url: abs("/PRICING"), status: 404, location: null, chain: [abs("/PRICING")], kind: "uppercase", hops: [], finalUrl: abs("/PRICING") },
      { url: abs("/?utm_source=audit"), status: 200, location: null, chain: [abs("/?utm_source=audit")], kind: "utm", hops: [], finalUrl: abs("/?utm_source=audit"), canonical: entryUrl },
    ],
    robots: { url: abs("/robots.txt"), status: 200, found: true, disallowAll: false, blocksEntry: false, sitemaps: [abs("/sitemap.xml")], bytes: 180 },
    sitemaps: [{ url: abs("/sitemap.xml"), status: 200, valid: true, isIndex: false, urlCount: 40, lastmodShare: 1, newestLastmod: daysAgoIso(5), children: [] }],
    soft404: { probeUrl: abs("/aeoeye-404-probe-x1y2z3"), status: 404, isSoft404: false },
    headers: {
      hsts: "max-age=31536000; includeSubDomains; preload",
      csp: "default-src 'self'",
      xContentTypeOptions: "nosniff",
      xFrameOptions: "SAMEORIGIN",
      referrerPolicy: "strict-origin-when-cross-origin",
      server: "Vercel",
      xRobotsTag: null,
    },
    blocked: { detected: false, kind: null, evidence: "" },
    jsDependent: false,
    tls: { validTo: daysAheadIso(200), daysLeft: 200, issuer: "Let's Encrypt", coversWww: true, error: null },
    parity: { mobileWords: 800, desktopWords: 820, mobileH1: "AI visibility audits for growing brands", desktopH1: "AI visibility audits for growing brands", mobileLinks: 24, desktopLinks: 24, mobileJsonLd: 2, desktopJsonLd: 2 },
    robotsMeta: {
      contentType: "text/plain",
      isHtml: false,
      googlebotDisallowAll: false,
      blocksResources: [],
      crawlDelay: null,
      aiCrawlers: { GPTBot: "allow", ClaudeBot: "allow", PerplexityBot: "allow", "Google-Extended": "unspecified", "OAI-SearchBot": "allow" },
      hasSitemapDirective: true,
    },
    sitemapSample: pages.map((p) => ({ url: p.url, status: 200, noindex: false, canonical: p.url, sameHost: true })),
    canonicalTargets: [],
    brokenInternal: [],
    brokenOutbound: [],
    largeImages: [],
    ogImage: { url: abs("/og.png"), status: 200, bytes: 80_000, contentType: "image/png" },
    crawlTtfb: { p50: 240, p90: 380, slowest: [{ url: abs("/blog"), ms: 410 }, { url: abs("/docs/api"), ms: 390 }, { url: abs("/tools"), ms: 380 }] },
    coverage: { navPages: 12, sitemapPages: 8, skippedByRobots: 0, stoppedEarly: null },
  };
  return { ...probe, ...over };
}

export function healthySite(): CheckContext {
  const pages = healthyPages();
  return { probe: makeProbe(pages), pages, entry: pages[0], psi: { mobile: makePsi(), desktop: null }, sitemapSample: pages.map((p) => p.url) };
}

/**
 * 坏站:首页 noindex + 无 viewport + 无标题;robots 全禁;5 页 4xx/5xx;
 * 6 页缺标题;证书过期;http 不跳 https;soft 404;CWV 全 poor;无 sitemap;
 * 混合内容与失效内链。
 */
export function brokenSite(): CheckContext {
  const pages = healthyPages();
  pages[0] = { ...pages[0], robotsMeta: "noindex, nofollow", robotsNoindex: true, viewport: null, title: "" };
  for (const i of [1, 2, 3, 4]) pages[i] = { ...pages[i], status: 404 };
  pages[5] = { ...pages[5], status: 500 };
  for (const i of [6, 7, 8, 9, 10, 11]) pages[i] = { ...pages[i], title: "" };
  pages[12] = { ...pages[12], mixedContent: 3 };
  pages[13] = { ...pages[13], mixedContent: 1 };
  const brokenInternal = [12, 13, 14, 15, 16, 17].map((i) => ({ from: pages[i].url, to: abs(`/old-page-${i}`), status: 404 }));
  const probe = makeProbe(pages, {
    robots: { url: abs("/robots.txt"), status: 200, found: true, disallowAll: true, blocksEntry: true, sitemaps: [], bytes: 40 },
    sitemaps: [],
    sitemapSample: [],
    soft404: { probeUrl: abs("/aeoeye-404-probe-x1y2z3"), status: 200, isSoft404: true },
    tls: { validTo: daysAgoIso(3), daysLeft: -3, issuer: "Let's Encrypt", coversWww: false, error: null },
    brokenInternal,
    headers: { hsts: null, csp: null, xContentTypeOptions: null, xFrameOptions: null, referrerPolicy: null, server: "nginx", xRobotsTag: null },
  });
  probe.robotsMeta = { ...probe.robotsMeta!, googlebotDisallowAll: true, hasSitemapDirective: false };
  probe.variants = probe.variants.map((v) => (v.kind === "http-apex" ? { ...v, status: 200, location: null, chain: [v.url], hops: [], finalUrl: v.url } : v));
  const psi = makePsi({ fieldMetrics: { lcpMs: 4800, inpMs: 650, cls: 0.4, ttfbMs: 2200, source: "origin" }, scores: { performance: 31, seo: 70, accessibility: 60, bestPractices: 50 } });
  return { probe, pages, entry: pages[0], psi: { mobile: psi, desktop: null }, sitemapSample: [] };
}

/**
 * 证书失败的站(复审 C20):入口在 TLS 握手时就失败 —— crawl.ts 记 probe.entryError(kind "tls"),
 * blocked 保持 detected:false(证书坏了不是防火墙)。爬虫只留下一个 status 0 的入口页(withEntryPage)或什么都没有。
 * 默认是"证书已过期";传 message / tls 可以造主机名不符、自签等。
 */
export function tlsBrokenSite(opts: { message?: string; tls?: SiteProbe["tls"]; withEntryPage?: boolean } = {}): CheckContext {
  const message = opts.message ?? "CERT_HAS_EXPIRED: certificate has expired";
  const entryUrl = abs("/");
  const entryPage = makePage({
    url: entryUrl, status: 0, contentType: "", bytes: 0, depth: 0, title: "", description: "", h1s: [], headings: [], wordCount: 0,
    canonical: null, robotsMeta: null, lang: null, viewport: null, images: { total: 0, missingAlt: 0 }, internalLinks: 0, links: [],
    jsonLdTypes: [], og: {}, twitter: {}, hasBreadcrumbSchema: false, hasFavicon: false, jsShell: false, minhash: undefined, uniqueInternalLinks: 0,
    imagesMissingDims: undefined, nofollowInternal: undefined, ttfbMs: null, lastModified: null,
  });
  const pages = opts.withEntryPage === false ? [] : [entryPage];
  const unreachable = (url: string, kind: NonNullable<UrlVariant["kind"]>): UrlVariant => ({ url, status: null, location: null, chain: [], kind, error: message });
  const probe = makeProbe(pages, {
    blocked: { detected: false, kind: null, evidence: "" },
    entryError: { kind: "tls", message },
    jsDependent: undefined,
    tls: opts.tls ?? { validTo: daysAgoIso(12), daysLeft: -12, issuer: "Let's Encrypt", coversWww: true, error: "expired: the certificate has expired" },
    variants: [
      { url: `http://${HOST}/`, status: 301, location: entryUrl, chain: [`http://${HOST}/`, entryUrl], kind: "http-apex", hops: [301], error: message },
      { url: `http://www.${HOST}/`, status: 301, location: entryUrl, chain: [`http://www.${HOST}/`, entryUrl], kind: "http-www", hops: [301], error: message },
      unreachable(entryUrl, "https-apex"),
      unreachable(`https://www.${HOST}/`, "https-www"),
    ],
    robots: { url: abs("/robots.txt"), status: null, found: false, disallowAll: false, blocksEntry: false, sitemaps: [], bytes: 0, error: message },
    sitemaps: [{ url: abs("/sitemap.xml"), status: null, valid: false, isIndex: false, urlCount: 0, lastmodShare: 0, newestLastmod: null, children: [], error: message }],
    soft404: { probeUrl: abs("/aeoeye-404-probe-x1y2z3"), status: null, isSoft404: false },
    headers: { hsts: null, csp: null, xContentTypeOptions: null, xFrameOptions: null, referrerPolicy: null, server: null, xRobotsTag: null },
    parity: null,
    sitemapSample: [],
    canonicalTargets: [],
    brokenInternal: [],
    brokenOutbound: [],
    largeImages: [],
    ogImage: null,
    crawlTtfb: { p50: null, p90: null, slowest: [] },
    coverage: { navPages: pages.length, sitemapPages: 0, skippedByRobots: 0, stoppedEarly: `Entry page unreachable (${message})` },
  });
  return { probe, pages, entry: pages[0] ?? null, psi: { mobile: null, desktop: null }, sitemapSample: [] };
}

/**
 * 子域名站(复审 C21):blog.example.com 没有 www.blog.example.com。crawl.ts 把另一主机记成
 * altHost.exists=false(DNS 解析失败),www 变体全是 ENOTFOUND;tls.ts 对它回 coversWww=null。
 * 其余与健康站完全一致(整份上下文把 example.com 换成 blog.example.com)。
 */
export const SUB_HOST = `blog.${HOST}`;
export function subdomainSite(opts: { altHostExists?: boolean | null } = {}): CheckContext {
  const json = JSON.stringify(healthySite()).split(HOST).join(SUB_HOST);
  const ctx = JSON.parse(json) as CheckContext;
  ctx.entry = ctx.pages[0];
  const notFound = (url: string, kind: NonNullable<UrlVariant["kind"]>): UrlVariant => ({ url, status: null, location: null, chain: [], kind, error: `getaddrinfo ENOTFOUND www.${SUB_HOST}` });
  ctx.probe.variants = ctx.probe.variants.map((v) =>
    v.kind === "https-www" ? notFound(`https://www.${SUB_HOST}/`, "https-www") : v.kind === "http-www" ? notFound(`http://www.${SUB_HOST}/`, "http-www") : v,
  );
  const exists = opts.altHostExists === undefined ? false : opts.altHostExists;
  ctx.probe.altHost = { host: `www.${SUB_HOST}`, exists, ...(exists === false ? { error: "ENOTFOUND" } : {}) };
  ctx.probe.tls = { ...ctx.probe.tls!, coversWww: exists === false ? null : false };
  return ctx;
}

/**
 * JS 空壳站(复审 C22):入口原始 HTML 只有挂载点 —— <head> 里的 title / description / lang / viewport 都在,
 * 正文、H1、图片、内链要等脚本跑完才有。extraPages > 0 时再带上服务端渲染的普通页(sitemap 抽样来的)。
 */
export function jsShellSite(opts: { extraPages?: number } = {}): CheckContext {
  const shell = makePage({
    url: abs("/"), depth: 0, pageType: "home", title: "Example — AI visibility audits for growing brands", description: "Audit how ChatGPT, Claude and Perplexity talk about your brand, and fix what they get wrong in minutes.",
    h1s: [], headings: [], wordCount: 3, textToHtml: 0.01, images: { total: 0, missingAlt: 0 }, internalLinks: 0, uniqueInternalLinks: 0, links: [], navLinks: 0,
    jsonLdTypes: [], hasBreadcrumbSchema: false, jsShell: true, scriptShare: 0.9, minhash: undefined, textSample: "",
  });
  const rest = healthyPages().slice(1, 1 + (opts.extraPages ?? 0));
  const pages = [shell, ...rest];
  const probe = makeProbe(pages, { jsDependent: true, sitemapSample: rest.map((p) => ({ url: p.url, status: 200, noindex: false, canonical: p.url, sameHost: true })) });
  return { probe, pages, entry: shell, psi: { mobile: makePsi(), desktop: null }, sitemapSample: rest.map((p) => p.url) };
}

/** 去掉所有 v2 可选字段 —— 模拟引擎 hardening 前的旧数据 */
export function stripV2(ctx: CheckContext): CheckContext {
  const pages = ctx.pages.map((p) => {
    const q: CrawledPage = { ...p };
    delete q.ttfbMs; delete q.lastModified; delete q.metaRefresh; delete q.scriptShare; delete q.jsShell; delete q.robotsNoindex; delete q.robotsNofollow;
    delete q.nofollowInternal; delete q.uniqueInternalLinks; delete q.navLinks; delete q.imagesMissingDims; delete q.imageUrls; delete q.outboundLinks;
    delete q.pageType; delete q.minhash; delete q.textSample;
    return q;
  });
  const probe: SiteProbe = { ...ctx.probe };
  delete probe.blocked; delete probe.jsDependent; delete probe.tls; delete probe.parity; delete probe.robotsMeta; delete probe.sitemapSample;
  delete probe.canonicalTargets; delete probe.brokenInternal; delete probe.brokenOutbound; delete probe.largeImages; delete probe.ogImage; delete probe.crawlTtfb; delete probe.coverage;
  return { probe, pages, entry: pages[0], psi: { mobile: null, desktop: null }, sitemapSample: ctx.sitemapSample };
}

/** 跑完整管线得到一份 SeoAuditResult(供 view 测试) */
export function makeResult(ctx: CheckContext, opts: { paid?: boolean } = {}): SeoAuditResult {
  const checks = runAllOnsiteChecks(ctx);
  const dimensions = scoreDimensions(checks, { unlocked: !!opts.paid });
  const overall = overallScore(dimensions, checks);
  const topIssues = pickTopIssues(checks);
  const roadmap = buildRoadmap(checks, ctx.pages);
  return {
    version: 1,
    plan: opts.paid ? "full" : "free",
    input: HOST,
    entryUrl: abs("/"),
    domain: HOST,
    generatedAt: new Date().toISOString(),
    durationMs: 61_000,
    overall: { score: overall.score, grade: overall.grade },
    dimensions,
    checks,
    pages: ctx.pages,
    probe: ctx.probe,
    psi: { mobile: ctx.psi.mobile, desktop: ctx.psi.mobile ? makePsi({ strategy: "desktop" }) : null },
    topIssues,
    roadmap,
    authority: { score: 55, referringDomains: 120, backlinks: 900 } as unknown as AuthorityResult,
    visibility: { score: 40, organicKeywords: 300, etv: 1200 } as unknown as VisibilityResult,
    competitors: { score: 50, items: [{ domain: "rival.com", intersections: 40, avgPosition: 8, etv: 5000, organicKeywords: 900 }] } as CompetitorsResult,
    cost: { dataforseoUsd: 0, calls: 0 },
    meta: {
      pagesCrawled: ctx.pages.length,
      pagesRequested: 20,
      crawlLimited: false,
      notes: [],
      lockedSections: [],
      outcome: "complete",
      blockers: overall.blockers,
      scoreNote: overall.scoreNote,
    },
  };
}
