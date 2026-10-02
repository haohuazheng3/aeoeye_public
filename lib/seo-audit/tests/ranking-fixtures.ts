/* ============================================================
   SEO Ranking Score 测试夹具

   为什么单独一份(不改 tests/fixtures.ts):那份是站内检查的"健康站 / 坏站",
   页面上没有内容信号;这里在它的 makePage / makeProbe / makePsi 之上补 page.content,
   造三类站:强站(各支柱都好)、规模化 AI 弱站(模板页 + 套话 + 同日批量发布)、
   以及按需拼装的小场景(单测每个小维度的公式)。
   全部固定时间(NOW)、无随机、不联网 —— 同一输入跑两次必须逐字节相同。
   ============================================================ */

import type {
  AuthorityResult,
  CompetitorPageSignals,
  CrawledPage,
  PageContentSignals,
  PsiResult,
  RelevanceAnalysis,
  RelevancePair,
  VisibilityResult,
} from "../types";
import type { RankingInput } from "../ranking";
import type { CheckContext } from "../checks";
import { runAllOnsiteChecks } from "../checks";
import { overallScore, scoreDimensions } from "../score";
import { HOST, NAV, abs, makePage, makeProbe, makePsi, minhashFor } from "./fixtures";

/** 固定"现在":新鲜度、标题年份都相对它计算 */
export const NOW = new Date("2026-10-01T12:00:00.000Z");
export const isoBefore = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** 一篇"好文章"的内容信号;各场景只覆盖需要的字段 */
export function makeContent(over: Partial<PageContentSignals> = {}): PageContentSignals {
  return {
    mainWords: 1500,
    sentences: 90,
    paragraphs: 28,
    fleschReadingEase: 62,
    avgSentenceWords: 16,
    avgParagraphWords: 54,
    h2Count: 6,
    h3Count: 4,
    listCount: 2,
    orderedListCount: 1,
    listItemCount: 12,
    tableCount: 1,
    numberCount: 24,
    experienceMarkers: 4,
    originalDataMarkers: 2,
    aiPhraseHits: 0,
    authoritativeOutlinks: 3,
    outboundLinks: 6,
    imagesSelfHosted: 3,
    imagesStock: 0,
    byline: true,
    authorName: "Example Editorial Team",
    authorLink: abs("/authors/editorial-team"),
    authorInSchema: true,
    datePublished: isoBefore(200),
    dateModified: isoBefore(40),
    titleYear: null,
    leadText: "",
    firstParagraph: "",
    hasFaq: true,
    nextStepLinks: 3,
    clickbaitHits: 0,
    titleNumber: null,
    ymylHits: 0,
    orgName: null,
    siteName: "Example",
    titleBrand: "Example SEO tools",
    sameAsCount: 0,
    interstitialHints: 0,
    ...over,
  };
}

/** 带内容信号的页(默认是一篇文章) */
export function contentPage(path: string, content: Partial<PageContentSignals> = {}, page: Partial<CrawledPage> = {}): CrawledPage {
  return makePage({ url: abs(path), pageType: "article", depth: 2, content: makeContent(content), ...page });
}

/** 按需拼一份 RankingInput:默认没有外链 / 排名 / 相关性数据,技术分 90 */
export function rankingInput(over: Partial<RankingInput> & { pages: CrawledPage[] }): RankingInput {
  return {
    domain: HOST,
    probe: makeProbe(over.pages),
    psi: { mobile: makePsi(), desktop: null },
    checks: [],
    dimensions: [],
    technical: { score: 90, grade: "A", blockers: [] },
    authority: null,
    visibility: null,
    relevance: null,
    now: NOW,
    ...over,
  };
}

/** 跑真实的站内检查,得到技术支柱需要的三样东西(与免费版同一条管线) */
export function technicalFor(pages: CrawledPage[], psi: { mobile: PsiResult | null; desktop: PsiResult | null }): Pick<RankingInput, "checks" | "dimensions" | "technical" | "probe"> {
  const probe = makeProbe(pages);
  const ctx: CheckContext = { probe, pages, entry: pages[0], psi, sitemapSample: pages.map((p) => p.url) };
  const checks = runAllOnsiteChecks(ctx);
  const dimensions = scoreDimensions(checks, { unlocked: true });
  const o = overallScore(dimensions, checks);
  return { probe, checks, dimensions, technical: { score: o.score, grade: o.grade, blockers: o.blockers } };
}

/* ---------- 竞品与相关性 ---------- */

export function competitor(i: number, over: Partial<CompetitorPageSignals> = {}): CompetitorPageSignals {
  return {
    url: `https://rival${i}.com/guide`,
    domain: `rival${i}.com`,
    position: i,
    title: `Rival guide ${i}`,
    h1: `Rival guide ${i}`,
    wordCount: 1800,
    format: "how-to",
    headings: ["what it is", "step by step", "common mistakes"],
    numbers: 10,
    tables: 0,
    orderedLists: 1,
    images: 3,
    fetched: true,
    ...over,
  };
}

export function makePair(over: Partial<RelevancePair> & { query: string; url: string }): RelevancePair {
  return {
    source: "ranking",
    volume: 880,
    position: 4,
    intent: "informational",
    intentSource: "dataforseo",
    pageFormat: "how-to",
    serpFormat: "how-to",
    intentMatch: true,
    titleAlignment: 1,
    h1Alignment: 1,
    answerEarly: true,
    coverage: 0.8,
    coveredTopics: ["what it is", "step by step", "common mistakes"],
    missingTopics: ["log file analysis"],
    uniqueTopics: ["our test results", "real crawl logs", "cost breakdown", "before and after"],
    gainSignals: { uniqueTopics: 4, extraNumbers: 8, extraTables: 1, ownImages: 3, experienceMarkers: 4 },
    competitors: [1, 2, 3, 4, 5].map((i) => competitor(i)),
    ...over,
  };
}

export function makeRelevance(pairs: RelevancePair[], over: Partial<RelevanceAnalysis> = {}): RelevanceAnalysis {
  const fetched = new Set(pairs.flatMap((p) => p.competitors.filter((c) => c.fetched).map((c) => c.url)));
  return { pairs, serpCalls: pairs.filter((p) => p.competitors.length).length, competitorPagesFetched: fetched.size, notes: [], ...over };
}

/* ---------- 外链与排名 ---------- */

export function makeAuthority(over: Partial<AuthorityResult> = {}): AuthorityResult {
  return {
    rank: 320,
    backlinks: 12_000,
    referringDomains: 900,
    referringMainDomains: 850,
    referringIps: 800,
    nofollowShare: 0.2,
    spamScore: 4,
    brokenBacklinks: 12,
    brokenPages: 2,
    firstSeen: "2019-03-01",
    tld: { com: 600, org: 120 },
    linkTypes: { anchor: 11_000, image: 1000 },
    anchors: [],
    score: 78,
    timeseries: [
      { month: "2026-07", newReferringDomains: 30, lostReferringDomains: 10 },
      { month: "2026-08", newReferringDomains: 25, lostReferringDomains: 12 },
    ],
    noData: false,
    semanticLocations: { article: 5000, main: 2000, section: 1000, footer: 500, aside: 300, nav: 100, "": 3100 },
    platformTypes: { blogs: 3000, news: 1500, cms: 1000, organization: 800, ecommerce: 200, unknown: 5500 },
    ...over,
  };
}

export function makeVisibility(over: Partial<VisibilityResult> = {}): VisibilityResult {
  return {
    organicKeywords: 1200,
    etv: 5400,
    positions: { pos1: 40, pos2_3: 80, pos4_10: 200, pos11_20: 300, pos21_50: 380, pos51_100: 200 },
    movement: { isNew: 50, isUp: 120, isDown: 80, isLost: 30 },
    topKeywords: [
      { keyword: "example", position: 1, volume: 2400, etv: 700, url: abs("/"), intent: "navigational", cpc: 1.2 },
      { keyword: "example seo tools", position: 1, volume: 320, etv: 90, url: abs("/"), intent: "navigational", cpc: 0.8 },
      { keyword: "how to fix crawl errors", position: 4, volume: 880, etv: 60, url: abs("/blog/crawl-errors-fix"), intent: "informational", cpc: 2.1 },
      { keyword: "schema markup basics", position: 6, volume: 590, etv: 30, url: abs("/blog/schema-markup-basics"), intent: "informational", cpc: 1.9 },
      { keyword: "speed up lcp", position: 3, volume: 480, etv: 40, url: abs("/blog/speed-up-lcp"), intent: "informational", cpc: 1.5 },
    ],
    quickWins: [],
    score: 64,
    brandKeywords: 40,
    nonBrandKeywords: 1160,
    aiOverviewShare: 0.2,
    indexEstimate: { googleResults: 40, sitemapUrls: 40, ratio: 1 },
    noData: false,
    ...over,
  };
}

/* ============================================================
   强站:12 篇文章分 3 个主题簇、有署名 / 一手经验 / 数据 / 权威外链,外链与品牌需求都强
   ============================================================ */

export const STRONG_TOPICS: Record<string, string[]> = {
  crawl: ["crawl-errors-fix", "crawl-budget-explained", "crawl-depth-audit", "crawl-stats-report"],
  schema: ["schema-markup-basics", "schema-for-products", "schema-validation-steps", "schema-testing-workflow"],
  speed: ["speed-up-lcp", "speed-audit-for-shops", "speed-budget-template", "image-speed-fixes"],
};
export const FEATURED = ["/blog/crawl-errors-fix", "/blog/schema-markup-basics", "/blog/speed-up-lcp"];
const COMMON_LINKS = [...NAV, "/features", "/product/audits", ...FEATURED];

function linksFor(path: string, extra: string[] = []): string[] {
  return Array.from(new Set([...COMMON_LINKS, ...extra])).filter((p) => p !== path).map(abs);
}

export function strongPages(): CrawledPage[] {
  const brand = { orgName: null, siteName: "Example", titleBrand: "Example SEO tools" };
  const pages: CrawledPage[] = [
    makePage({
      url: abs("/"), depth: 0, pageType: "home", jsonLdTypes: ["Organization", "WebSite"], hasBreadcrumbSchema: false, links: linksFor("/"),
      content: makeContent({ mainWords: 620, orgName: "Example", sameAsCount: 3, byline: false, authorInSchema: false, hasFaq: false }),
    }),
    makePage({ url: abs("/pricing"), depth: 1, pageType: "pricing", links: linksFor("/pricing"), content: makeContent({ ...brand, mainWords: 480, byline: false }) }),
    makePage({ url: abs("/about"), depth: 1, links: linksFor("/about"), content: makeContent({ ...brand, mainWords: 520, byline: false }) }),
    makePage({
      url: abs("/contact"), depth: 1, links: linksFor("/contact"),
      textSample: "Contact Example. Email hello@example.com or call +1 (415) 555-0134. Example Inc, 500 Market Street, Suite 200, San Francisco, CA 94105.",
      content: makeContent({ ...brand, mainWords: 140, byline: false }),
    }),
    makePage({ url: abs("/privacy"), depth: 1, pageType: "legal", wordCount: 1200, links: linksFor("/privacy"), content: makeContent({ ...brand, mainWords: 1100, byline: false }) }),
    makePage({ url: abs("/terms"), depth: 1, pageType: "legal", wordCount: 1200, links: linksFor("/terms"), content: makeContent({ ...brand, mainWords: 1150, byline: false }) }),
    // 博客首页:摘要列表,不到 300 词 —— 计入"薄内容"分母,但不是内容页
    makePage({ url: abs("/blog"), depth: 1, pageType: "listing", links: linksFor("/blog", Object.values(STRONG_TOPICS).flat().map((s) => `/blog/${s}`)), content: makeContent({ ...brand, mainWords: 250, byline: false }) }),
    makePage({
      url: abs("/features"), depth: 1, pageType: "other", links: linksFor("/features"),
      content: makeContent({ ...brand, mainWords: 900, h2Count: 4, h3Count: 2, experienceMarkers: 2, imagesSelfHosted: 4, originalDataMarkers: 1, authoritativeOutlinks: 1, byline: false, authorInSchema: false, hasFaq: false }),
    }),
    makePage({
      url: abs("/product/audits"), depth: 2, pageType: "product", jsonLdTypes: ["Product", "BreadcrumbList"], links: linksFor("/product/audits"),
      content: makeContent({ ...brand, mainWords: 900, h2Count: 4, h3Count: 2, experienceMarkers: 2, imagesSelfHosted: 4, originalDataMarkers: 1, authoritativeOutlinks: 1, byline: false, authorInSchema: false, hasFaq: false }),
    }),
  ];
  let i = 0;
  for (const slugs of Object.values(STRONG_TOPICS)) {
    for (const slug of slugs) {
      const path = `/blog/${slug}`;
      const siblings = slugs.filter((s) => s !== slug).map((s) => `/blog/${s}`);
      pages.push(
        contentPage(
          path,
          { ...brand, datePublished: isoBefore(120 + i * 17), dateModified: isoBefore(20 + i * 9) },
          { links: linksFor(path, siblings), jsonLdTypes: ["Article", "BreadcrumbList"], wordCount: 1600 },
        ),
      );
      i += 1;
    }
  }
  return pages;
}

export function strongRelevance(): RelevanceAnalysis {
  return makeRelevance([
    makePair({ query: "how to fix crawl errors", url: abs("/blog/crawl-errors-fix") }),
    makePair({ query: "schema markup basics", url: abs("/blog/schema-markup-basics"), pageFormat: "definition", serpFormat: "definition", volume: 590, position: 6 }),
    makePair({ query: "speed up lcp", url: abs("/blog/speed-up-lcp"), volume: 480, position: 3 }),
  ]);
}

export function strongInput(): RankingInput {
  const pages = strongPages();
  const psi = { mobile: makePsi(), desktop: makePsi({ strategy: "desktop" }) };
  return {
    domain: HOST,
    pages,
    psi,
    ...technicalFor(pages, psi),
    authority: makeAuthority(),
    visibility: makeVisibility(),
    relevance: strongRelevance(),
    now: NOW,
  };
}

/* ============================================================
   规模化 AI 弱站:16 篇同模板"best CRM for <行业>"(近重复、AI 套话、同一天发布、
   无一手经验、只有图库图、标题党、标题数字不兑现)+ 5 个薄页
   ============================================================ */

export const WEAK_INDUSTRIES = [
  "dentists", "lawyers", "plumbers", "realtors", "roofers", "bakeries", "gyms", "salons",
  "florists", "tutors", "photographers", "architects", "caterers", "landscapers", "chiropractors", "veterinarians",
];

export function weakAiPages(): CrawledPage[] {
  const dup = minhashFor(4242);
  const sameDay = isoBefore(30);
  const brand = { orgName: null, siteName: null, titleBrand: "CRM Picks" };
  const pages: CrawledPage[] = [
    makePage({ url: abs("/"), depth: 0, pageType: "home", content: makeContent({ ...brand, mainWords: 400, byline: false, authorInSchema: false, experienceMarkers: 0, imagesSelfHosted: 0 }) }),
    makePage({ url: abs("/pricing"), depth: 1, pageType: "pricing", content: makeContent({ ...brand, mainWords: 200, byline: false }) }),
    makePage({ url: abs("/privacy"), depth: 1, pageType: "legal", content: makeContent({ ...brand, mainWords: 900, byline: false }) }),
  ];
  for (const ind of WEAK_INDUSTRIES) {
    pages.push(
      makePage({
        url: abs(`/guides/best-crm-for-${ind}`),
        depth: 2,
        pageType: "article",
        h1s: ["Welcome to our guide"],
        headings: [{ level: 1, text: "Welcome to our guide" }, { level: 2, text: "Overview" }, { level: 2, text: "Conclusion" }],
        minhash: dup,
        links: [abs("/"), abs("/pricing"), abs("/privacy")],
        content: makeContent({
          ...brand,
          mainWords: 650,
          fleschReadingEase: 28,
          avgParagraphWords: 140,
          h2Count: 2,
          h3Count: 0,
          listCount: 0,
          orderedListCount: 0,
          listItemCount: 0,
          tableCount: 0,
          numberCount: 1,
          experienceMarkers: 0,
          originalDataMarkers: 0,
          aiPhraseHits: 12,
          authoritativeOutlinks: 0,
          imagesSelfHosted: 0,
          imagesStock: 3,
          byline: false,
          authorName: null,
          authorLink: null,
          authorInSchema: false,
          datePublished: sameDay,
          dateModified: null,
          titleYear: 2023,
          leadText: "in today s fast paced world every business deserves software that unlocks its full potential",
          hasFaq: false,
          nextStepLinks: 0,
          clickbaitHits: 2,
          titleNumber: 10,
          interstitialHints: 2,
        }),
      }),
    );
  }
  for (let i = 1; i <= 5; i += 1) {
    pages.push(
      makePage({
        url: abs(`/guides/crm-tips-${i}`),
        depth: 2,
        pageType: "article",
        minhash: minhashFor(9000 + i),
        content: makeContent({ ...brand, mainWords: 120, experienceMarkers: 0, imagesSelfHosted: 0, byline: false, datePublished: sameDay }),
      }),
    );
  }
  return pages;
}

export function weakAiInput(): RankingInput {
  const pages = weakAiPages();
  const psi = {
    mobile: makePsi({ fieldMetrics: { lcpMs: 4800, inpMs: 650, cls: 0.4, ttfbMs: 2200, source: "origin" }, field: { lcp: "SLOW", inp: "SLOW", cls: "SLOW", overall: "SLOW" } }),
    desktop: null,
  };
  return {
    domain: HOST,
    pages,
    psi,
    ...technicalFor(pages, psi),
    authority: makeAuthority({
      rank: 8,
      backlinks: 160,
      referringDomains: 14,
      score: 12,
      spamScore: 45,
      semanticLocations: { footer: 40, aside: 20, article: 5, "": 100 },
      platformTypes: { organization: 30, "message-boards": 20, blogs: 2, unknown: 80 },
    }),
    visibility: makeVisibility({ noData: true, topKeywords: [], organicKeywords: 0 }),
    relevance: makeRelevance([
      makePair({
        query: "best crm for dentists",
        url: abs("/guides/best-crm-for-dentists"),
        intent: "commercial",
        pageFormat: "article",
        serpFormat: "comparison",
        intentMatch: false,
        titleAlignment: 0.5,
        h1Alignment: 0,
        answerEarly: false,
        coverage: 0.2,
        missingTopics: ["pricing tiers", "hipaa compliance", "integrations"],
        uniqueTopics: [],
        gainSignals: { uniqueTopics: 0, extraNumbers: 0, extraTables: 0, ownImages: 0, experienceMarkers: 0 },
      }),
    ]),
    now: NOW,
  };
}
