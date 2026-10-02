/* ============================================================
   相关性 / 搜索意图(relevance.ts)—— 纯离线测试
   网络全部注入:fetcher 是按 URL 路由的假响应,SERP 是假函数,时钟可以是假时钟。
   一个字节都不会发到网上,也不会 import dataforseo.ts(给了 serpFn 就不加载它)。
   运行:npx tsx --test lib/seo-audit/tests/relevance.test.ts
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRelevance,
  classifyFormat,
  computeCoverage,
  coreTokens,
  intentFromQuery,
  normalizeHeading,
  sameTopic,
  type RelevanceInput,
  type SerpFn,
} from "../relevance";
import { parsePageDetailed } from "../parse";
import type { FetchResult, SafeFetchOptions } from "../fetch";
import type { CrawledPage, PageContentSignals, RankedKeyword, RelevanceAnalysis, VisibilityResult } from "../types";
import { makePage } from "./fixtures";

/* ---------------- 夹具 ---------------- */

const BASE_CONTENT: PageContentSignals = {
  mainWords: 900,
  sentences: 45,
  paragraphs: 14,
  fleschReadingEase: 55,
  avgSentenceWords: 18,
  avgParagraphWords: 60,
  h2Count: 3,
  h3Count: 1,
  listCount: 1,
  orderedListCount: 0,
  listItemCount: 4,
  tableCount: 0,
  numberCount: 3,
  experienceMarkers: 0,
  originalDataMarkers: 0,
  aiPhraseHits: 0,
  authoritativeOutlinks: 0,
  outboundLinks: 2,
  imagesSelfHosted: 0,
  imagesStock: 0,
  byline: false,
  authorName: null,
  authorLink: null,
  authorInSchema: false,
  datePublished: null,
  dateModified: null,
  titleYear: null,
  leadText: "",
  firstParagraph: "",
  hasFaq: false,
  nextStepLinks: 0,
  clickbaitHits: 0,
  titleNumber: null,
  ymylHits: 0,
  orgName: null,
  siteName: null,
  titleBrand: null,
  sameAsCount: 0,
  interstitialHints: 0,
};

const content = (over: Partial<PageContentSignals> = {}): PageContentSignals => ({ ...BASE_CONTENT, ...over });

const H = (level: number, text: string) => ({ level, text });

/** 本站页面(抓取集合):makePage 的健康默认值 + 明确的标题 / 标题层级 / 内容信号 */
function sitePage(path: string, over: Partial<CrawledPage>): CrawledPage {
  return makePage({ url: `https://example.com${path}`, ...over });
}

const FILLER =
  "This paragraph exists so the page has real body text for the parser to count. It talks about search, answers, sources and the way assistants decide which brands to mention when people ask them for advice.";

/** 一份像样的 HTML:标题、H1、若干 H2/H3、可选 JSON-LD */
function html(o: { title: string; h1?: string; h2?: string[]; h3?: string[]; jsonLd?: Record<string, unknown>; lead?: string }): string {
  const ld = o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd)}</script>` : "";
  const h2 = (o.h2 ?? []).map((t) => `<h2>${t}</h2><p>${FILLER}</p>`).join("");
  const h3 = (o.h3 ?? []).map((t) => `<h3>${t}</h3><p>${FILLER}</p>`).join("");
  return `<!doctype html><html lang="en"><head><title>${o.title}</title>${ld}</head><body><main><h1>${o.h1 ?? o.title}</h1><p>${o.lead ?? FILLER}</p>${h2}${h3}</main></body></html>`;
}

type Route = { status?: number; body?: string; contentType?: string; headers?: Record<string, string> } | "throw";

function respond(url: string, r: Exclude<Route, "throw">): FetchResult {
  const status = r.status ?? 200;
  const contentType = r.contentType ?? (url.endsWith("/robots.txt") ? "text/plain" : "text/html; charset=utf-8");
  const headers = new Headers({ "content-type": contentType, ...(r.headers ?? {}) });
  const body = r.body ?? "";
  return { url, finalUrl: url, status, headers, body, bytes: body.length, ms: 3, chain: [], contentType, hops: [{ url, status, location: null }] };
}

/** 按完整 URL 路由的假 fetcher;没配的 robots.txt 回 404(= 没有规则),没配的页面回 404 */
function fakeFetcher(routes: Record<string, Route>, onCall?: (url: string) => void) {
  const calls: { url: string; opts?: SafeFetchOptions }[] = [];
  const fetcher = async (url: string, opts?: SafeFetchOptions): Promise<FetchResult> => {
    calls.push({ url, opts });
    onCall?.(url);
    const r = routes[url];
    if (r === "throw") throw new Error("socket hang up");
    if (r) return respond(url, r);
    return respond(url, { status: 404, body: url.endsWith("/robots.txt") ? "" : "<html><body>Not found</body></html>" });
  };
  return { fetcher, calls };
}

/** 真解析 + 固定内容信号:标题与 H2/H3 来自真实 HTML 解析,数字类信号按 URL 指定(不依赖 parse.ts 的内容信号实现细节) */
function parseWith(byUrl: Record<string, Partial<PageContentSignals>>): typeof parsePageDetailed {
  return (body, res, depth, host) => {
    const d = parsePageDetailed(body, res, depth, host);
    const h2Count = d.page.headings.filter((h) => h.level === 2).length;
    d.page.content = content({ h2Count, ...(byUrl[res.url] ?? {}) });
    return d;
  };
}

function kw(keyword: string, url: string | null, volume: number | null, position: number, intent: string | null): RankedKeyword {
  return { keyword, url, volume, position, intent, etv: null, cpc: null };
}

function visibility(topKeywords: RankedKeyword[], over: Partial<VisibilityResult> = {}): VisibilityResult {
  return {
    organicKeywords: topKeywords.length,
    etv: 100,
    positions: { pos1: 1, pos2_3: 0, pos4_10: 2, pos11_20: 1, pos21_50: 0, pos51_100: 0 },
    movement: { isNew: 0, isUp: 0, isDown: 0, isLost: 0 },
    topKeywords,
    quickWins: [],
    score: 40,
    ...over,
  };
}

function baseInput(over: Partial<RelevanceInput>): RelevanceInput {
  return {
    domain: "example.com",
    origin: "https://example.com",
    host: "example.com",
    pages: [],
    visibility: null,
    budgetMs: 60_000,
    minIntervalMs: 0,
    ...over,
  };
}

/* ============================================================
   纯函数
   ============================================================ */

test("classifyFormat: every spec rule — title patterns, list structure, schema and URL", () => {
  const p = (path: string, over: Partial<CrawledPage>) => sitePage(path, { content: content(), ...over });
  assert.equal(classifyFormat(p("/blog/ahrefs-vs-semrush", { title: "Ahrefs vs. Semrush: Which SEO Tool Wins in 2026?", pageType: "article" })), "comparison");
  assert.equal(classifyFormat(p("/compare", { title: "Compare AEO platforms side by side", pageType: "other", content: content({ tableCount: 1 }) })), "comparison");
  assert.equal(classifyFormat(p("/compare", { title: "Compare AEO platforms side by side", pageType: "article" })), "article", "compare without a table is not a comparison");
  assert.equal(classifyFormat(p("/blog/best-aeo-tools", { title: "The 9 Best AEO Tools for 2026 (Tested)", pageType: "article" })), "listicle");
  assert.equal(classifyFormat(p("/blog/top", { title: "Top 10 AI visibility trackers", pageType: "article" })), "listicle");
  assert.equal(classifyFormat(p("/blog/ways", { title: "7 proven ways to get cited by ChatGPT", pageType: "article" })), "listicle");
  assert.equal(classifyFormat(p("/blog/trends", { title: "2026 SEO trends and what they mean", pageType: "article" })), "article", "a leading year is not a list count");
  assert.equal(
    classifyFormat(p("/blog/roundup", { title: "AI visibility tracker roundup", pageType: "article", content: content({ listItemCount: 12, h2Count: 6 }) })),
    "listicle"
  );
  assert.equal(classifyFormat(p("/blog/chatgpt", { title: "How to Get Your Brand Recommended by ChatGPT", pageType: "article" })), "how-to");
  assert.equal(
    classifyFormat(p("/docs/llms", { title: "Setting up llms.txt", pageType: "article", content: content({ orderedListCount: 1, h2Count: 3 }) })),
    "how-to"
  );
  assert.equal(classifyFormat(p("/blog/what-is-aeo", { title: "What Is Answer Engine Optimization (AEO)?", pageType: "article" })), "definition");
  assert.equal(
    classifyFormat(
      p("/learn/aeo", {
        title: "Answer engine optimization",
        pageType: "article",
        content: content({ firstParagraph: "Answer engine optimization (AEO) is the practice of structuring content so AI assistants cite it." }),
      })
    ),
    "definition"
  );
  assert.equal(
    classifyFormat(p("/learn/guide", { title: "Our AEO guide", pageType: "article", content: content({ firstParagraph: "This is the guide we wish we had." }) })),
    "article",
    "a pronoun-led first sentence is not a definition"
  );
  assert.equal(classifyFormat(p("/pricing", { title: "Pricing — Example", pageType: "pricing" })), "pricing");
  assert.equal(classifyFormat(p("/products/audit", { title: "AI Visibility Audit", pageType: "product", jsonLdTypes: ["Product"] })), "product");
  assert.equal(classifyFormat(p("/dentist", { title: "Family dentistry", pageType: "other", jsonLdTypes: ["Dentist"] })), "local");
  assert.equal(
    classifyFormat(p("/visit", { title: "Visit our shop", pageType: "other", textSample: "Visit us at 1200 Main Street in Austin or call (512) 555-0134 today." })),
    "local"
  );
  assert.equal(classifyFormat(p("/", { title: "Example — AI visibility audits", pageType: "home" })), "homepage");
  assert.equal(classifyFormat(p("/blog/post", { title: "Notes from our launch week", pageType: "article" })), "article");
  assert.equal(classifyFormat(p("/tools/llms-txt-generator", { title: "Free llms.txt generator", pageType: "other" })), "other");
});

test("classifyFormat: structural rules never turn a homepage into a how-to / listicle / definition; missing content signals degrade to title + URL", () => {
  const home = sitePage("/", {
    title: "Example — See whether AI assistants recommend your brand",
    pageType: "home",
    content: content({
      orderedListCount: 2,
      h2Count: 6,
      listItemCount: 14,
      firstParagraph: "Example is an AI visibility audit that shows whether ChatGPT recommends you.",
    }),
  });
  assert.equal(classifyFormat(home), "homepage");
  // 标题规则照常作用于首页
  assert.equal(classifyFormat({ ...home, title: "Example vs Profound" }), "comparison");
  // 内容信号缺失:结构类规则整条跳过
  const bare = sitePage("/blog/roundup", { title: "AI visibility tracker roundup", pageType: "article" });
  delete bare.content;
  assert.equal(classifyFormat(bare), "article");
  // SERP 结果只有标题 + URL 也能估
  assert.equal(classifyFormat({ url: "https://www.dominos.co.uk/", title: "Domino's Pizza: Order Pizza Delivery & Takeaway" }), "homepage");
  assert.equal(classifyFormat({ url: "https://www.timeout.com/london/restaurants/best-pizza", title: "20 Best Pizza Restaurants in London" }), "listicle");
});

test("classifyFormat: strong signals beat list structure — a Wikipedia-style article with a huge reference list is a definition, a product page stays a product", () => {
  // 实测形状(2026-10-01 冒烟):firstParagraph 是站点外壳,参考文献是一个上百项的有序列表
  const wiki = sitePage("/wiki/SEO", {
    title: "Search engine optimization - Wikipedia",
    pageType: "article",
    content: content({
      firstParagraph: "From Wikipedia, the free encyclopedia",
      leadText: "from wikipedia the free encyclopedia search engine optimization seo is the process of improving the quality and quantity of website traffic",
      listItemCount: 132,
      orderedListCount: 1,
      h2Count: 9,
    }),
  });
  assert.equal(classifyFormat(wiki), "definition", "the lead defines the title's topic");
  // 同样的结构、开头没有下定义:落到第二轮的结构规则
  assert.equal(classifyFormat({ ...wiki, content: content({ firstParagraph: "Skip to main content", leadText: "skip to main content a history of the field", listItemCount: 132, orderedListCount: 1, h2Count: 9 }) }), "listicle");
  assert.equal(
    classifyFormat({ ...wiki, title: "AI Features and Your Website | Google Search Central", content: content({ firstParagraph: "Skip to main content", leadText: "skip to main content", listItemCount: 28, orderedListCount: 1, h2Count: 4 }) }),
    "how-to"
  );
  // 同位语很长的定义句(维基百科 GEO 条目的实测开头):在 textSample 里按"同一句"匹配
  const geo = sitePage("/wiki/GEO", {
    title: "Generative engine optimization - Wikipedia",
    pageType: "article",
    textSample:
      "Jump to content From Wikipedia, the free encyclopedia Digital marketing technique Generative engine optimization ( GEO ), also known as answer engine optimization (AEO) [ 1 ] and artificial intelligence optimization (AIO), [ 2 ] is the practice of improving visibility in responses",
    content: content({ firstParagraph: "From Wikipedia, the free encyclopedia", leadText: "", orderedListCount: 1, h2Count: 4 }),
  });
  assert.equal(classifyFormat(geo), "definition");
  // 从句修饰不是定义;跨句也不算
  assert.equal(
    classifyFormat({ ...geo, title: "AI visibility audit", textSample: "Run an AI visibility audit, which is the fastest way to see where you stand." }),
    "how-to",
    "falls through to the list-structure rule"
  );
  assert.equal(classifyFormat({ ...geo, title: "AI visibility audit", textSample: "AI visibility audit. The tool is a free scanner." }), "how-to");
  const product = sitePage("/products/audit", { title: "AI Visibility Audit", pageType: "product", content: content({ listItemCount: 20, orderedListCount: 2, h2Count: 6 }) });
  assert.equal(classifyFormat(product), "product");
  const local = sitePage("/clinic", { title: "Family dentistry", pageType: "other", jsonLdTypes: ["Dentist"], content: content({ orderedListCount: 1, h2Count: 4 }) });
  assert.equal(classifyFormat(local), "local");
});

test("intentFromQuery: spec patterns, brand-only navigation, precedence and the fallback", () => {
  const b = ["example"];
  const cases: [string, string][] = [
    ["ahrefs vs semrush", "commercial"],
    ["best aeo tools", "commercial"],
    ["profound alternatives", "commercial"],
    ["peec ai review", "commercial"],
    ["compare ai visibility trackers", "commercial"],
    ["example pricing", "transactional"],
    ["llm visibility tool free trial", "transactional"],
    ["buy backlinks", "transactional"],
    ["aeo audit cost", "transactional"],
    ["seo agency near me", "local"],
    ["seo agency chicago", "local"],
    ["san francisco aeo consultant", "local"],
    ["what is aeo", "informational"],
    ["what's llms.txt", "informational"],
    ["how to rank in chatgpt", "informational"],
    ["why is my brand not in chatgpt", "informational"],
    ["aeo guide", "informational"],
    ["example", "navigational"],
    ["Example.com", "navigational"],
    ["example login", "navigational"],
    ["exam ple", "navigational"],
    ["best price for an aeo audit", "commercial"], // commercial 先于 transactional(规格顺序)
    ["ai visibility audit", "informational"], // 兜底
    ["example ai visibility", "navigational"], // 兜底:含品牌
  ];
  for (const [q, want] of cases) assert.equal(intentFromQuery(q, b), want, q);
  // 没有品牌词时,纯名字查询走兜底
  assert.equal(intentFromQuery("example", []), "informational");
});

test("normalizeHeading / sameTopic: stopwords, numbers, years and plurals; Jaccard ≥ 0.5", () => {
  assert.equal(normalizeHeading("10 Best AEO Tools for 2026!"), "best aeo tool");
  assert.equal(normalizeHeading("What Are the Companies' Pricing Plans?"), "company pricing plan");
  assert.equal(normalizeHeading("How it works"), "work");
  assert.equal(normalizeHeading("Step 1: Install the plugin"), "step install plugin");
  assert.equal(normalizeHeading("The 1990s boxes & classes"), "box class");
  assert.equal(normalizeHeading("News and analytics"), "news analytic");
  assert.equal(normalizeHeading(normalizeHeading("Pricing plans for teams")), normalizeHeading("Pricing plans for teams"), "idempotent");

  assert.equal(sameTopic("Pricing plans", "Plans and pricing"), true);
  assert.equal(sameTopic("Key features", "Features"), true); // 1/2 = 0.5
  assert.equal(sameTopic("How to choose an AEO tool", "Choosing an AEO tool"), true); // {aeo, tool} / 4 = 0.5
  assert.equal(sameTopic("Pricing", "Integrations"), false);
  assert.equal(sameTopic("Benefits of AEO", "Common AEO mistakes"), false); // 1/4
  assert.equal(sameTopic("", ""), false);
  assert.equal(sameTopic("best aeo tool", "10 Best AEO Tools in 2026"), true, "works on already-normalised text");
});

test("computeCoverage: shared subtopics, covered / missing / unique and the <3 shared → null rule", () => {
  const target = ["Pricing plans", "How AEO works", "Our own benchmark data", "Conclusion"];
  const competitors = [
    ["Plans and pricing", "How AEO works", "Integrations", "Customer stories", "Conclusion"],
    ["Pricing", "How does AEO work", "Integrations", "Security"],
    ["Integrations", "Security & compliance", "Pricing plans", "Getting started guide"],
  ];
  const r = computeCoverage(target, competitors);
  // 共有(≥2 个竞品):pricing ×3、integrations ×3、how AEO works ×2、security ×2;"Conclusion" 是栏目模板,不算
  assert.equal(r.shared, 4);
  assert.equal(r.coverage, 0.5);
  assert.deepEqual(r.covered, ["Plans and pricing", "How AEO works"]);
  assert.deepEqual(r.missing, ["Integrations", "Security"]);
  assert.deepEqual(r.unique, ["Our own benchmark data"]);
  assert.equal(r.uniqueCount, 1);

  const few = computeCoverage(["Pricing"], [["Pricing", "Security"], ["Pricing plans", "Integrations"]]);
  assert.equal(few.shared, 1);
  assert.equal(few.coverage, null, "fewer than 3 shared subtopics is too small a sample");
  assert.deepEqual(few.covered, ["Pricing"]);

  const none = computeCoverage(["Pricing", "Our data"], []);
  assert.equal(none.coverage, null);
  assert.deepEqual(none.unique, [], "no competitors → nothing can be called unique");
  assert.equal(none.uniqueCount, 0);

  const full = computeCoverage(["Pricing", "Integrations", "Security", "How AEO works"], competitors);
  assert.equal(full.coverage, 1);
  assert.deepEqual(full.missing, []);
});

test("coreTokens: stopwords and brand removal (single token, compact multi-token, domain form), plural stems", () => {
  assert.deepEqual(coreTokens("Example vs Profound pricing", ["example"]), ["profound", "pricing"]);
  assert.deepEqual(coreTokens("exam ple reviews", ["example"]), ["review"]);
  assert.deepEqual(coreTokens("example.com", ["example"]), []);
  assert.deepEqual(coreTokens("what is llms.txt", ["example"]), ["llm", "txt"]);
  assert.deepEqual(coreTokens("Best AI visibility tools for SaaS teams", []), ["best", "ai", "visibility", "tool", "saas", "team"]);
  assert.deepEqual(coreTokens("the tools the TOOLS", []), ["tool"], "deduplicated");
});

/* ============================================================
   analyzeRelevance
   ============================================================ */

/** 页脚栏目标题:每页都有 → 本站模板标题,不算任何一页的子话题 */
const FOOTER = H(3, "Stay in the loop");

/** 本站抓取集合:首页、产品页、一篇定义文;/blog/aeo-vs-seo 故意不在里面 */
function crawlSet(): CrawledPage[] {
  return withFooter([
    sitePage("/", {
      depth: 0,
      pageType: "home",
      title: "Example — AI visibility audits for brands",
      h1s: ["AI visibility audits for growing brands"],
      headings: [H(1, "AI visibility audits for growing brands"), H(2, "How the audit works"), H(2, "Pricing")],
      content: content({ leadText: "ai visibility audits for growing brands see whether chatgpt recommends you" }),
    }),
    sitePage("/ai-visibility-audit", {
      depth: 1,
      pageType: "product",
      jsonLdTypes: ["Product"],
      title: "AI Visibility Audit — Check if ChatGPT recommends you | Example",
      h1s: ["AI visibility audit"],
      headings: [H(1, "AI visibility audit"), H(2, "How the audit works"), H(2, "Pricing plans"), H(2, "What you get")],
      content: content({
        numberCount: 12,
        tableCount: 1,
        imagesSelfHosted: 3,
        experienceMarkers: 2,
        leadText: "run an ai visibility audit to check whether chatgpt claude and gemini recommend your brand",
      }),
    }),
    sitePage("/blog/what-is-aeo", {
      depth: 2,
      pageType: "article",
      title: "What Is AEO? Answer Engine Optimization Explained",
      h1s: ["What is answer engine optimization (AEO)?"],
      headings: [
        H(1, "What is answer engine optimization (AEO)?"),
        H(2, "How AEO works"),
        H(2, "AEO vs SEO"),
        H(2, "Why AEO matters"),
        H(3, "Our 2026 citation study"),
      ],
      content: content({ numberCount: 1, leadText: "answer engine optimization aeo is the practice of earning citations in ai answers" }),
    }),
  ]);
}

function withFooter(pages: CrawledPage[]): CrawledPage[] {
  return pages.map((p) => ({ ...p, headings: [...p.headings, FOOTER] }));
}

const RANKING_KEYWORDS = [
  kw("example", "https://example.com/", 900, 1, "navigational"),
  kw("ai visibility audit", "https://example.com/ai-visibility-audit", 500, 4, "commercial"),
  kw("ai visibility checker", "https://example.com/ai-visibility-audit", 300, 9, "commercial"), // 同一 URL:只取量最高的那个
  kw("what is aeo", "https://example.com/blog/what-is-aeo", 400, 3, "informational"),
  kw("aeo vs seo", "https://www.example.com/blog/aeo-vs-seo", 200, 12, null), // 不在抓取集合里 → 单独抓;意图走模式
  kw("llms txt generator", "https://other.example/x", 1000, 2, null), // 不是本站 → 丢掉
  kw("orphan keyword", null, 800, 5, "informational"), // 没有 URL → 丢掉
];

/** 竞品站点:ai visibility audit 的前 5(blocked.test 的 robots 禁了 AEOeyeBot) + what is aeo 的前 3 */
function competitorRoutes(): Record<string, Route> {
  return {
    "https://alpha.test/ai-visibility-audit": {
      body: html({ title: "AI Visibility Audit Tool | Alpha", jsonLd: { "@type": "Product", name: "Alpha" }, h2: ["How the audit works", "Pricing", "Which AI engines we test", "Sample report"] }),
    },
    "https://beta.test/robots.txt": { body: "User-agent: *\nAllow: /\n" },
    "https://beta.test/audit": {
      body: html({ title: "Free AI Visibility Audit — Beta", jsonLd: { "@type": "Product", name: "Beta" }, h2: ["How it works", "Pricing plans", "Engines we test", "Integrations"] }),
    },
    "https://gamma.test/": { body: html({ title: "Gamma — AI search visibility platform", h2: ["Pricing", "Integrations", "Customer stories"] }) },
    "https://blocked.test/robots.txt": { body: "User-agent: AEOeyeBot\nDisallow: /tools/\n" },
    "https://blocked.test/tools/audit": { body: html({ title: "Should never be fetched" }) },
    "https://delta.test/pricing": { body: html({ title: "Delta Pricing", h2: ["Plans", "Integrations", "FAQ"] }) },
    "https://wiki.test/wiki/AEO": {
      body: html({
        title: "Answer engine optimization - Wikipedia",
        jsonLd: { "@type": "Article", name: "Answer engine optimization" },
        h2: ["History", "How answer engines choose sources", "Criticism", "See also", "References"],
      }),
    },
    "https://alpha.test/blog/what-is-aeo": {
      body: html({ title: "What is AEO? A complete guide", h2: ["How AEO works", "AEO vs SEO", "How answer engines choose sources", "AEO checklist"] }),
    },
    "https://beta.test/learn/aeo": { body: html({ title: "AEO explained: how answer engines pick sources", h2: ["How AEO works", "Why AEO matters", "AEO checklist"] }) },
    // 本站不在抓取集合里的排名页
    "https://www.example.com/blog/aeo-vs-seo": {
      body: html({ title: "AEO vs SEO: What Actually Changes", h1: "AEO vs SEO", h2: ["Where AEO and SEO overlap", "What changes for content teams"] }),
    },
  };
}

const COMPETITOR_SIGNALS: Record<string, Partial<PageContentSignals>> = {
  "https://alpha.test/ai-visibility-audit": { numberCount: 4, tableCount: 0 },
  "https://beta.test/audit": { numberCount: 6, tableCount: 1 },
  "https://gamma.test/": { numberCount: 2, tableCount: 0 },
  "https://delta.test/pricing": { numberCount: 10, tableCount: 1 },
  "https://www.example.com/blog/aeo-vs-seo": { numberCount: 5, leadText: "aeo vs seo what actually changes when answers replace links" },
};

const SERP: Record<string, { url: string; position: number; title: string }[]> = {
  "ai visibility audit": [
    { url: "https://example.com/ai-visibility-audit", position: 1, title: "Our own page" },
    { url: "https://alpha.test/ai-visibility-audit", position: 2, title: "AI Visibility Audit Tool | Alpha" },
    { url: "https://beta.test/audit", position: 3, title: "Free AI Visibility Audit — Beta" },
    { url: "https://gamma.test/", position: 4, title: "Gamma — AI search visibility platform" },
    { url: "https://blocked.test/tools/audit", position: 5, title: "Best AI visibility audit tools" },
    { url: "https://delta.test/pricing", position: 6, title: "Delta Pricing" },
    { url: "https://epsilon.test/x", position: 7, title: "Beyond the top 5" },
  ],
  "what is aeo": [
    { url: "https://wiki.test/wiki/AEO", position: 1, title: "Answer engine optimization - Wikipedia" },
    { url: "https://alpha.test/blog/what-is-aeo", position: 2, title: "What is AEO? A complete guide" },
    { url: "https://beta.test/learn/aeo", position: 3, title: "AEO explained: how answer engines pick sources" },
  ],
};

function fakeSerp(): { fn: SerpFn; queries: string[] } {
  const queries: string[] = [];
  const fn: SerpFn = async (q) => {
    queries.push(q);
    if (q === "aeo vs seo") throw new Error("DataForSEO serp/google/organic/live/regular: 40501 Invalid Field");
    return (SERP[q] ?? []).map((r) => ({ ...r, domain: new URL(r.url).hostname.replace(/^www\./, "") }));
  };
  return { fn, queries };
}

async function rankingRun(over: Partial<RelevanceInput> = {}) {
  const { fetcher, calls } = fakeFetcher(competitorRoutes());
  const serp = fakeSerp();
  const result = await analyzeRelevance(
    baseInput({
      pages: crawlSet(),
      visibility: visibility(RANKING_KEYWORDS),
      fetcher,
      serpFn: serp.fn,
      parse: parseWith(COMPETITOR_SIGNALS),
      ...over,
    })
  );
  return { result, calls, serp };
}

test("analyzeRelevance (ranking data): non-brand first by volume, one keyword per URL, out-of-crawl page fetched, SERP for the top 3", async () => {
  const { result, calls, serp } = await rankingRun();

  // 选对:非品牌词按量降序,品牌词垫后;同 URL 只取量最高的;外站 / 无 URL 的词丢掉
  assert.deepEqual(
    result.pairs.map((p) => p.query),
    ["ai visibility audit", "what is aeo", "aeo vs seo", "example"]
  );
  for (const p of result.pairs) assert.equal(p.source, "ranking");
  assert.deepEqual(
    result.pairs.map((p) => [p.volume, p.position]),
    [
      [500, 4],
      [400, 3],
      [200, 12],
      [900, 1],
    ]
  );
  assert.deepEqual(
    result.pairs.map((p) => [p.intent, p.intentSource]),
    [
      ["commercial", "dataforseo"],
      ["informational", "dataforseo"],
      ["commercial", "pattern"],
      ["navigational", "dataforseo"],
    ]
  );

  // SERP 只调前 3 对;第 3 对失败 → note,不抛
  assert.deepEqual(serp.queries.sort(), ["aeo vs seo", "ai visibility audit", "what is aeo"]);
  assert.equal(result.serpCalls, 3);
  assert.ok(result.notes.some((n) => /top results for "aeo vs seo" could not be loaded/.test(n)), result.notes.join("\n"));

  // 不在抓取集合里的排名页被单独抓了(先 robots,再页面)
  assert.ok(calls.some((c) => c.url === "https://www.example.com/robots.txt"));
  assert.ok(calls.some((c) => c.url === "https://www.example.com/blog/aeo-vs-seo"));
  // robots 禁止的竞品页从没被请求;本站结果、第 6 名之后的结果也不抓
  assert.ok(!calls.some((c) => c.url === "https://blocked.test/tools/audit"));
  assert.ok(!calls.some((c) => c.url.startsWith("https://epsilon.test/")));
  assert.ok(!calls.some((c) => c.url === "https://example.com/ai-visibility-audit"), "own page is never fetched as a competitor");
  // 每个竞品请求都带 8 秒上限与 2 MB 上限
  for (const c of calls.filter((x) => !x.url.endsWith("/robots.txt"))) {
    assert.ok((c.opts?.timeoutMs ?? 0) <= 8_000, c.url);
    assert.equal(c.opts?.maxBytes, 2 * 1024 * 1024);
  }
  assert.equal(result.competitorPagesFetched, 7);
});

test("analyzeRelevance (ranking data): competitor comparison — formats, coverage, gain signals, intent match and alignment", async () => {
  const { result } = await rankingRun();
  const [audit, aeo, vs, brand] = result.pairs;

  /* ---- 第 1 对:ai visibility audit(产品页)---- */
  assert.equal(audit.url, "https://example.com/ai-visibility-audit");
  assert.equal(audit.pageFormat, "product");
  assert.deepEqual(
    audit.competitors.map((c) => [c.domain, c.position, c.fetched, c.format]),
    [
      ["alpha.test", 2, true, "product"],
      ["beta.test", 3, true, "product"],
      ["gamma.test", 4, true, "homepage"],
      ["blocked.test", 5, false, "listicle"], // 没抓到:形态按 SERP 标题估
      ["delta.test", 6, true, "pricing"],
    ]
  );
  assert.match(audit.competitors[3].error ?? "", /robots\.txt/);
  assert.equal(audit.serpFormat, "product");
  assert.equal(audit.intentMatch, true);
  assert.equal(audit.coverage, 0.5);
  assert.deepEqual(audit.coveredTopics, ["Pricing", "How the audit works"]);
  assert.deepEqual(audit.missingTopics, ["Integrations", "Which AI engines we test"]);
  // 页脚的 "Stay in the loop" 出现在每个已抓页面上 → 模板标题,不算独有子话题
  assert.deepEqual(audit.uniqueTopics, ["What you get"]);
  // 数据点:本页 12 − 竞品中位数 median(4,6,2,10)=5 → 7;表格 1 − 0.5 → 1(四舍五入)
  assert.deepEqual(audit.gainSignals, { uniqueTopics: 1, extraNumbers: 7, extraTables: 1, ownImages: 3, experienceMarkers: 2 });
  // 竞品的 headings 存规范化后的形式
  assert.deepEqual(audit.competitors[0].headings, ["audit work", "pricing", "ai engine test", "sample report"]);
  assert.equal(audit.titleAlignment, 1);
  assert.equal(audit.h1Alignment, 1);
  assert.equal(audit.answerEarly, true);

  /* ---- 第 2 对:what is aeo(定义文)---- */
  assert.equal(aeo.pageFormat, "definition");
  assert.deepEqual(
    aeo.competitors.map((c) => c.format),
    ["article", "definition", "article"]
  );
  assert.equal(aeo.serpFormat, "article");
  assert.equal(aeo.intentMatch, true, "definition is acceptable for informational and compatible with an article SERP");
  assert.equal(aeo.coverage, 0.333);
  assert.deepEqual(aeo.coveredTopics, ["How AEO works"]);
  assert.deepEqual(aeo.missingTopics, ["How answer engines choose sources", "AEO checklist"]);
  assert.deepEqual(aeo.uniqueTopics, ["Our 2026 citation study"]);
  // "aeo" 在标题与 H1 里都有;正文开头只有 "aeo"(what/is 是停用词)
  assert.equal(aeo.titleAlignment, 1);
  assert.equal(aeo.h1Alignment, 1);
  assert.equal(aeo.answerEarly, true);

  /* ---- 第 3 对:aeo vs seo(SERP 失败 → 没有竞品对比,但页面级判定照做)---- */
  assert.equal(vs.url, "https://www.example.com/blog/aeo-vs-seo");
  assert.equal(vs.pageFormat, "comparison");
  assert.equal(vs.serpFormat, null);
  assert.equal(vs.intentMatch, true, "commercial accepts comparison");
  assert.equal(vs.coverage, null);
  assert.deepEqual(vs.competitors, []);
  assert.deepEqual(vs.uniqueTopics, [], "no competitors → nothing can be called unique");
  // 没有竞品时基准为 0:本页绝对数
  assert.equal(vs.gainSignals.extraNumbers, 5);

  /* ---- 第 4 对:品牌词(不做 SERP)---- */
  assert.equal(brand.query, "example");
  assert.equal(brand.pageFormat, "homepage");
  assert.equal(brand.intentMatch, true);
  assert.deepEqual(brand.competitors, []);
  // 纯品牌查询:去品牌后没有核心词 → 用品牌名本身对齐(标题里有,H1 里没有)
  assert.equal(brand.titleAlignment, 1);
  assert.equal(brand.h1Alignment, 0);
});

test("analyzeRelevance: robots.txt is respected per host — disallowed and unreadable (5xx) competitors are skipped without a page request", async () => {
  const { fetcher, calls } = fakeFetcher({
    "https://closed.test/robots.txt": { body: "User-agent: *\nDisallow: /\n" },
    "https://closed.test/guide": { body: html({ title: "Never fetched" }) },
    "https://flaky.test/robots.txt": { status: 503, body: "Service unavailable" },
    "https://flaky.test/guide": { body: html({ title: "Never fetched either" }) },
    "https://down.test/robots.txt": "throw",
    "https://open.test/guide": { body: html({ title: "How to rank in AI answers", h2: ["Step one", "Step two"] }) },
  });
  const serp: SerpFn = async () => [
    { url: "https://closed.test/guide", domain: "closed.test", position: 1, title: "Closed guide" },
    { url: "https://flaky.test/guide", domain: "flaky.test", position: 2, title: "Flaky guide" },
    { url: "https://down.test/guide", domain: "down.test", position: 3, title: "Down guide" },
    { url: "https://open.test/guide", domain: "open.test", position: 4, title: "Open guide" },
  ];
  const result = await analyzeRelevance(
    baseInput({ pages: crawlSet(), visibility: visibility([kw("ai visibility audit", "https://example.com/ai-visibility-audit", 500, 4, "commercial")]), fetcher, serpFn: serp })
  );
  const [pair] = result.pairs;
  assert.deepEqual(
    pair.competitors.map((c) => [c.domain, c.fetched]),
    [
      ["closed.test", false],
      ["flaky.test", false],
      ["down.test", false],
      ["open.test", true],
    ]
  );
  assert.match(pair.competitors[0].error ?? "", /Disallowed for AEOeyeBot by robots\.txt/);
  assert.match(pair.competitors[1].error ?? "", /robots\.txt could not be read \(HTTP 503\)/);
  assert.match(pair.competitors[2].error ?? "", /Could not connect/);
  assert.ok(!calls.some((c) => c.url === "https://closed.test/guide"));
  assert.ok(!calls.some((c) => c.url === "https://flaky.test/guide"));
  assert.ok(!calls.some((c) => c.url === "https://down.test/guide"));
  assert.equal(result.competitorPagesFetched, 1);
  assert.equal(pair.serpFormat, null, "one fetched competitor is not a 'mainstream' format");
  assert.ok(result.notes.some((n) => /2 competitor pages were not fetched because robots\.txt disallows AEOeyeBot/.test(n)), result.notes.join("\n"));
  assert.ok(result.notes.some((n) => /1 competitor page could not be fetched/.test(n)), result.notes.join("\n"));
});

test("analyzeRelevance: a host that rate-limits us (429) is not asked again in the same run", async () => {
  const { fetcher, calls } = fakeFetcher({
    "https://busy.test/a": { status: 429, body: "Too many requests", headers: { "retry-after": "60" } },
    "https://busy.test/b": { body: html({ title: "Would be fine" }) },
  });
  const serp: SerpFn = async (q) =>
    q === "ai visibility audit"
      ? [{ url: "https://busy.test/a", domain: "busy.test", position: 1, title: "A" }]
      : [{ url: "https://busy.test/b", domain: "busy.test", position: 1, title: "B" }];
  const result = await analyzeRelevance(
    baseInput({
      pages: crawlSet(),
      visibility: visibility([
        kw("ai visibility audit", "https://example.com/ai-visibility-audit", 500, 4, "commercial"),
        kw("what is aeo", "https://example.com/blog/what-is-aeo", 400, 3, "informational"),
      ]),
      fetcher,
      serpFn: serp,
    })
  );
  assert.equal(calls.filter((c) => c.url === "https://busy.test/a").length, 1);
  assert.equal(calls.filter((c) => c.url === "https://busy.test/b").length, 0, "no second request after a 429 from the same host");
  assert.match(result.pairs[0].competitors[0].error ?? "", /HTTP 429/);
  assert.match(result.pairs[1].competitors[0].error ?? "", /blocked an earlier request/);
});

test("analyzeRelevance (no ranking data): page-topic fallback — homepage + the two most-linked content pages", async () => {
  const link = (...paths: string[]) => paths.map((p) => `https://example.com${p}`);
  const pages: CrawledPage[] = [
    sitePage("/", {
      depth: 0,
      pageType: "home",
      title: "Example | AI visibility audits",
      h1s: ["AI visibility audits for growing brands"],
      headings: [H(1, "AI visibility audits for growing brands")],
      links: link("/blog/a", "/blog/b", "/blog/c", "/pricing", "/privacy"),
      content: content({ leadText: "ai visibility audits for growing brands" }),
    }),
    sitePage("/blog/a", {
      pageType: "article",
      title: "How AI assistants choose which brands to recommend | Example",
      h1s: ["How AI assistants choose which brands to recommend"],
      links: link("/blog/b", "/blog/c"),
      content: content({ mainWords: 1400 }),
    }),
    sitePage("/blog/b", {
      pageType: "article",
      title: "Schema markup for AI answers | Example",
      h1s: ["Welcome"],
      links: link("/blog/a"),
      content: content({ mainWords: 900 }),
    }),
    sitePage("/blog/c", {
      pageType: "article",
      title: "Brand mentions vs links | Example",
      h1s: ["Brand mentions vs links"],
      links: link("/"),
      content: content({ mainWords: 1200 }),
    }),
    // 入链最多但不是内容页:定价页、法律页、太短的页
    sitePage("/pricing", { pageType: "pricing", title: "Pricing", h1s: ["Pricing"], links: link("/blog/a"), content: content({ mainWords: 1000 }) }),
    sitePage("/privacy", { pageType: "legal", title: "Privacy", h1s: ["Privacy policy"], links: [], content: content({ mainWords: 3000 }) }),
    sitePage("/blog/d", { pageType: "article", title: "Short note", h1s: ["A short note on llms.txt"], links: [], content: content({ mainWords: 120 }) }),
  ];
  // 再加几个只为制造入链的页:/blog/b 3 条、/blog/a 2 条(+首页)、/blog/c 1 条(+首页)
  for (const extra of ["/x1", "/x2"]) pages.push(sitePage(extra, { pageType: "other", title: `Page ${extra}`, h1s: [`Page ${extra}`], links: link("/blog/b", "/blog/d", "/blog/d"), content: content({ mainWords: 50 }) }));

  const queries: string[] = [];
  const serp: SerpFn = async (q) => {
    queries.push(q);
    return [];
  };
  const result = await analyzeRelevance(
    baseInput({ pages, visibility: visibility([], { noData: true, organicKeywords: 0 }), fetcher: fakeFetcher({}).fetcher, serpFn: serp })
  );
  assert.deepEqual(
    result.pairs.map((p) => [p.query, p.url]),
    [
      ["ai visibility audits for growing brands", "https://example.com/"],
      // /blog/b 入链 4(首页 + /blog/a + x1 + x2);H1 "Welcome" 太泛 → 用去品牌的标题
      ["schema markup for ai answers", "https://example.com/blog/b"],
      ["how ai assistants choose which brands to recommend", "https://example.com/blog/a"],
    ]
  );
  for (const p of result.pairs) {
    assert.equal(p.source, "page-topic");
    assert.equal(p.volume, null);
    assert.equal(p.position, null);
    assert.equal(p.intentSource, "pattern");
  }
  assert.equal(result.serpCalls, 3, "page-topic pairs are still compared with the live SERP");
  assert.deepEqual(queries.sort(), result.pairs.map((p) => p.query).sort());
  assert.ok(result.notes.some((n) => /DataForSEO has no ranking keywords for example\.com yet/.test(n)), result.notes.join("\n"));
  assert.ok(result.notes.some((n) => /No other site ranked for/.test(n)));
  // 兜底意图(模式没命中)且没有 SERP 证据:不判(不进分母),而不是猜一个"不匹配"
  const home = result.pairs[0];
  assert.equal(home.intent, "informational");
  assert.equal(home.pageFormat, "homepage");
  assert.equal(home.intentMatch, null);
  assert.equal(home.answerEarly, true);

  // visibility = null 时同样走兜底,note 写明原因
  const r2 = await analyzeRelevance(baseInput({ pages, visibility: null, fetcher: fakeFetcher({}).fetcher, serpFn: serp }));
  assert.equal(r2.pairs.length, 3);
  assert.ok(r2.notes.some((n) => /Ranking data was not available/.test(n)));
});

test("analyzeRelevance (re-run): reuse makes zero SERP calls, keeps queries and re-fetches the same competitor URLs", async () => {
  const first = (await rankingRun()).result;
  const { fetcher, calls } = fakeFetcher(competitorRoutes());
  let serpCalled = 0;
  const serpFn: SerpFn = async () => {
    serpCalled += 1;
    throw new Error("must not be called on a reuse run");
  };
  const again = await analyzeRelevance(
    baseInput({
      pages: crawlSet(),
      // 排名数据变了也不影响:沿用上次的查询
      visibility: visibility([kw("something new", "https://example.com/", 5000, 1, "commercial")]),
      reuse: first,
      refreshSerp: false,
      fetcher,
      serpFn,
      parse: parseWith(COMPETITOR_SIGNALS),
    })
  );
  assert.equal(serpCalled, 0);
  assert.equal(again.serpCalls, 0);
  assert.deepEqual(
    again.pairs.map((p) => p.query),
    first.pairs.map((p) => p.query)
  );
  assert.deepEqual(
    again.pairs.map((p) => [p.intent, p.intentSource, p.volume, p.position]),
    first.pairs.map((p) => [p.intent, p.intentSource, p.volume, p.position])
  );
  // 竞品 URL 原样沿用,并重新抓取(页面会变)
  assert.deepEqual(
    again.pairs[0].competitors.map((c) => c.url),
    first.pairs[0].competitors.map((c) => c.url)
  );
  assert.ok(calls.some((c) => c.url === "https://alpha.test/ai-visibility-audit"));
  assert.equal(again.competitorPagesFetched, first.competitorPagesFetched);
  assert.equal(again.pairs[0].coverage, first.pairs[0].coverage);
  assert.ok(again.notes.some((n) => /^Re-run: reused 4 queries and 8 competitor URLs/.test(n)), again.notes.join("\n"));

  // 付费刷新:不沿用,重新调 SERP
  const serp = fakeSerp();
  const refreshed = await analyzeRelevance(
    baseInput({
      pages: crawlSet(),
      visibility: visibility(RANKING_KEYWORDS),
      reuse: first,
      refreshSerp: true,
      fetcher: fakeFetcher(competitorRoutes()).fetcher,
      serpFn: serp.fn,
    })
  );
  assert.equal(refreshed.serpCalls, 3);
  assert.equal(serp.queries.length, 3);

  // reuse 是空壳(上次没算成):照样零 SERP,退回排名词选对,写明原因
  const emptyReuse: RelevanceAnalysis = { pairs: [], serpCalls: 0, competitorPagesFetched: 0, notes: [] };
  const fallback = await analyzeRelevance(
    baseInput({ pages: crawlSet(), visibility: visibility(RANKING_KEYWORDS), reuse: emptyReuse, fetcher: fakeFetcher(competitorRoutes()).fetcher, serpFn })
  );
  assert.equal(serpCalled, 0);
  assert.equal(fallback.serpCalls, 0);
  assert.equal(fallback.pairs.length, 4);
  for (const p of fallback.pairs) assert.deepEqual(p.competitors, []);
  assert.ok(fallback.notes.some((n) => /only queried on the first paid run/.test(n)));
});

test("analyzeRelevance: budget exhaustion — skipped work becomes notes, finished work is kept, nothing throws", async () => {
  // 假时钟:每个页面请求"花" 4 秒;robots 不花时间。预算 20 秒:单独抓排名页用掉 4 秒,
  // 剩 16 秒 ≥ 开 SERP 的 10 秒门槛 → 竞品只够抓前几个,其余跳过
  let clock = 1_000_000;
  const { fetcher } = fakeFetcher(competitorRoutes(), (url) => {
    if (!url.endsWith("/robots.txt")) clock += 4_000;
  });
  const result = await analyzeRelevance(
    baseInput({
      pages: crawlSet(),
      visibility: visibility(RANKING_KEYWORDS),
      fetcher,
      serpFn: fakeSerp().fn,
      parse: parseWith(COMPETITOR_SIGNALS),
      now: () => clock,
      budgetMs: 20_000,
    })
  );
  const all = result.pairs.flatMap((p) => p.competitors);
  const skipped = all.filter((c) => c.error === "Skipped: time budget reached");
  assert.ok(skipped.length >= 1, JSON.stringify(all.map((c) => [c.url, c.fetched, c.error])));
  assert.ok(all.some((c) => c.fetched), "work finished before the deadline is kept");
  assert.ok(result.notes.some((n) => /skipped because the time budget ran out/.test(n)), result.notes.join("\n"));
  assert.ok(result.pairs.length >= 3);

  // 预算不够开 SERP:不调(不花钱),写明原因
  const serp = fakeSerp();
  const short = await analyzeRelevance(baseInput({ pages: crawlSet(), visibility: visibility(RANKING_KEYWORDS), fetcher: fakeFetcher({}).fetcher, serpFn: serp.fn, budgetMs: 5_000 }));
  assert.equal(short.serpCalls, 0);
  assert.equal(serp.queries.length, 0);
  assert.ok(short.notes.some((n) => /not enough time left/.test(n)));
  assert.ok(short.pairs.length >= 3, "pairs inside the crawl are still analysed");

  // 预算连抓一页都不够:不在抓取集合里的排名页跳过并注明
  const tiny = await analyzeRelevance(baseInput({ pages: crawlSet(), visibility: visibility(RANKING_KEYWORDS), fetcher: fakeFetcher(competitorRoutes()).fetcher, serpFn: serp.fn, budgetMs: 500 }));
  assert.ok(tiny.notes.some((n) => /aeo-vs-seo for "aeo vs seo" is not in the crawl and could not be fetched \(time budget reached\)/.test(n)), tiny.notes.join("\n"));
  assert.deepEqual(
    tiny.pairs.map((p) => p.query),
    ["ai visibility audit", "what is aeo", "example"]
  );

  // SERP 卡住不回:到预算就不再等。假时钟在发出 SERP 请求时跳到截止前 30 ms,真实只等 30 ms
  let t = 5_000_000;
  const hang: SerpFn = () => {
    t = 5_000_000 + 15_000 - 30;
    return new Promise(() => undefined);
  };
  const t0 = Date.now();
  const hung = await analyzeRelevance(
    baseInput({ pages: crawlSet(), visibility: visibility(RANKING_KEYWORDS.slice(1, 2)), fetcher: fakeFetcher({}).fetcher, serpFn: hang, now: () => t, budgetMs: 15_000 })
  );
  assert.ok(Date.now() - t0 < 2_000, "returns at the deadline instead of waiting for the hung call");
  assert.equal(hung.serpCalls, 1);
  assert.equal(hung.pairs.length, 1);
  assert.ok(hung.notes.some((n) => /time budget ran out while loading the top results/.test(n)), hung.notes.join("\n"));
});

test("analyzeRelevance never throws: empty input, injected fetcher that throws, malformed reuse", async () => {
  const empty = await analyzeRelevance(baseInput({ domain: "", origin: "", host: "", pages: [], budgetMs: 1_000 }));
  assert.deepEqual(empty.pairs, []);
  assert.ok(empty.notes.length >= 1);

  const throwing = async (): Promise<FetchResult> => {
    throw new Error("boom");
  };
  const r = await analyzeRelevance(
    baseInput({
      pages: crawlSet(),
      visibility: visibility(RANKING_KEYWORDS),
      fetcher: throwing,
      serpFn: async () => [{ url: "https://alpha.test/x", domain: "alpha.test", position: 1, title: "X" }],
    })
  );
  assert.ok(r.pairs.length >= 3);
  assert.ok(r.pairs[0].competitors.every((c) => !c.fetched));

  const malformed = { pairs: [null, { query: 42 }, { query: "ai visibility audit", url: "https://example.com/ai-visibility-audit", competitors: "nope" }] } as unknown as RelevanceAnalysis;
  const m = await analyzeRelevance(baseInput({ pages: crawlSet(), visibility: null, reuse: malformed, fetcher: fakeFetcher({}).fetcher, serpFn: async () => [] }));
  assert.equal(m.serpCalls, 0);
  assert.deepEqual(
    m.pairs.map((p) => p.query),
    ["ai visibility audit"]
  );
});

test("analyzeRelevance degrades gracefully without content signals (parse.ts without v3 fields)", async () => {
  const pages = crawlSet().map((p) => {
    const copy = { ...p };
    delete copy.content;
    return copy;
  });
  const result = await analyzeRelevance(
    baseInput({
      pages,
      visibility: visibility(RANKING_KEYWORDS.slice(1, 2)),
      fetcher: fakeFetcher(competitorRoutes()).fetcher,
      serpFn: fakeSerp().fn,
      // 竞品页也不带内容信号
      parse: (body, res, depth, host) => {
        const d = parsePageDetailed(body, res, depth, host);
        delete d.page.content;
        return d;
      },
    })
  );
  const [pair] = result.pairs;
  assert.equal(pair.pageFormat, "product");
  assert.deepEqual(pair.gainSignals, { uniqueTopics: pair.uniqueTopics.length, extraNumbers: 0, extraTables: 0, ownImages: 0, experienceMarkers: 0 });
  assert.equal(pair.coverage, 0.5, "subtopic coverage only needs headings");
  assert.ok(result.notes.some((n) => /Content signals were unavailable for \d+ analysed pages/.test(n)), result.notes.join("\n"));
});
