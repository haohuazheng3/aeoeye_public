/* ============================================================
   站外声誉(reputation.ts)—— 纯离线测试
   SERP 全部注入(给了 serpFn 就不 import dataforseo.ts),一个字节都不会发到网上。
   运行:npx tsx --test lib/seo-audit/tests/reputation.test.ts
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeReputation, reputationBrand, type ReputationSerpFn } from "../reputation";
import type { CrawledPage, PageContentSignals, SerpSnapshot } from "../types";
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

function page(url: string, brand: Partial<Pick<PageContentSignals, "orgName" | "siteName" | "titleBrand">>): CrawledPage {
  return makePage({ url, content: { ...BASE_CONTENT, ...brand } });
}

/** AEOeye 站:首页三处品牌信号一致,其余页只有标题品牌段 */
function aeoeyePages(): CrawledPage[] {
  return [
    page("https://aeoeye.com/", { orgName: "AEOeye", siteName: "AEOeye", titleBrand: "AEOeye" }),
    page("https://aeoeye.com/seo-audit", { titleBrand: "AEOeye" }),
    page("https://aeoeye.com/blog/what-is-aeo", { titleBrand: "AEOeye Blog" }),
    // 通用的 og:site_name 与域名不符:不能拿去当品牌名搜
    page("https://aeoeye.com/docs", { siteName: "Docs" }),
  ];
}

type Org = { url: string; position: number; title: string };

function snap(organic: Org[], extra: Partial<SerpSnapshot> = {}): SerpSnapshot {
  return {
    organic: organic.map((o) => ({ ...o, domain: new URL(o.url).hostname.replace(/^www\./, "") })),
    itemTypes: ["organic"],
    aiOverview: null,
    featuredSnippet: null,
    paa: [],
    knowledgeGraph: false,
    ratings: [],
    ...extra,
  };
}

function fakeSerp(byQuery: Record<string, SerpSnapshot | Error>) {
  const calls: { q: string; loadAiOverview: boolean | undefined }[] = [];
  const fn: ReputationSerpFn = async (q, opts) => {
    calls.push({ q, loadAiOverview: opts?.loadAiOverview });
    const r = byQuery[q];
    if (r instanceof Error) throw r;
    return r ?? snap([]);
  };
  return { fn, calls };
}

/* ---------------- 品牌名 ---------------- */

test("reputationBrand: majority of on-site brand signals that match the domain; legal suffixes dropped; falls back to the domain label", () => {
  assert.deepEqual(reputationBrand("aeoeye.com", aeoeyePages()), { name: "AEOeye", fromSite: true });
  // 品牌名与域名主体相互包含即算相符(getjobber.com ↔ Jobber);公司后缀不进查询
  assert.deepEqual(
    reputationBrand("getjobber.com", [
      page("https://getjobber.com/", { orgName: "Jobber, Inc.", siteName: "Jobber" }),
      page("https://getjobber.com/pricing", { titleBrand: "Jobber" }),
    ]),
    { name: "Jobber", fromSite: true }
  );
  // 只有通用名 / 没有内容信号 → 域名主体
  assert.deepEqual(reputationBrand("zzqx-widgets.com", [page("https://zzqx-widgets.com/", { siteName: "Blog", titleBrand: "Home" })]), {
    name: "zzqx-widgets",
    fromSite: false,
  });
  assert.deepEqual(reputationBrand("example.co.uk", [makePage({ url: "https://example.co.uk/" })]), { name: "example", fromSite: false });
});

/* ---------------- analyzeReputation ---------------- */

test("analyzeReputation: brand-owned SERP with a knowledge panel and two rated review platforms → every field populated", async () => {
  const brand = snap(
    [
      { url: "https://aeoeye.com/", position: 1, title: "AEOeye — AI visibility audits" },
      { url: "https://www.linkedin.com/company/aeoeye", position: 2, title: "AEOeye | LinkedIn" },
      { url: "https://www.g2.com/products/aeoeye/reviews", position: 3, title: "AEOeye Reviews 2026: Details, Pricing, & Features | G2" },
      { url: "https://www.producthunt.com/products/aeoeye", position: 4, title: "AEOeye - Product Information, Latest Updates, and Reviews 2026" },
      { url: "https://techcrunch.com/2026/09/01/aeoeye-raises-seed/", position: 5, title: "AEOeye raises a seed round to audit AI search" },
      { url: "https://www.reddit.com/r/SEO/comments/abc/aeoeye_review/", position: 6, title: "Anyone tried AEOeye? : r/SEO" },
      { url: "https://news.example.org/2026/aeoeye-launch", position: 7, title: "AEOeye launches its AI visibility audit" },
      { url: "https://docs.aeoeye.com/getting-started", position: 8, title: "Getting started — AEOeye docs" },
      { url: "https://some-blog.test/aeoeye-alternatives", position: 9, title: "7 AEOeye alternatives worth a look" },
      { url: "https://en.wikipedia.org/wiki/AEOeye", position: 10, title: "AEOeye - Wikipedia" },
      // 第 11 名不进"前 10 独立域名"
      { url: "https://late.test/aeoeye", position: 11, title: "AEOeye mentioned late" },
    ],
    {
      itemTypes: ["organic", "knowledge_graph", "people_also_ask"],
      knowledgeGraph: true,
      ratings: [{ domain: "g2.com", url: "https://www.g2.com/products/aeoeye/reviews", value: 4.6, votes: 31 }],
    }
  );
  const reviews = snap(
    [
      { url: "https://www.trustpilot.com/review/aeoeye.com", position: 1, title: "AEOeye Reviews | Read Customer Service Reviews of aeoeye.com" },
      { url: "https://www.g2.com/products/aeoeye/reviews", position: 2, title: "AEOeye Reviews 2026 | G2" },
      // 别家公司的评价页:标题与 URL 都没有品牌名 → 不算
      { url: "https://www.capterra.com/p/123/OtherTool/", position: 3, title: "OtherTool Reviews 2026" },
      { url: "https://www.reddit.com/r/SaaS/comments/def/is_aeoeye_a_scam/", position: 4, title: "Is AEOeye a scam? : r/SaaS" },
    ],
    {
      ratings: [
        { domain: "trustpilot.com", url: "https://www.trustpilot.com/review/aeoeye.com", value: 4.2, votes: 120 },
        { domain: "capterra.com", url: "https://www.capterra.com/p/123/OtherTool/", value: 4.9, votes: 400 },
      ],
    }
  );
  const serp = fakeSerp({ AEOeye: brand, "AEOeye reviews": reviews });
  const r = await analyzeReputation({ domain: "aeoeye.com", pages: aeoeyePages(), budgetMs: 30_000, serpFn: serp.fn });

  assert.equal(r.brandName, "AEOeye");
  assert.equal(r.brandQuery, "AEOeye");
  assert.equal(r.reviewsQuery, "AEOeye reviews");
  // 2 次 SERP,都不加载 AI 摘要(声誉用不上,不多花钱)
  assert.equal(r.serpCalls, 2);
  assert.deepEqual(
    serp.calls.map((c) => [c.q, c.loadAiOverview]),
    [
      ["AEOeye", false],
      ["AEOeye reviews", false],
    ]
  );
  assert.equal(r.ownsBrandSerp, true);
  assert.equal(r.brandTop3, true);
  assert.equal(r.knowledgePanel, true);
  // 评价平台按出现顺序、每个平台一条;评分按 URL 对上
  assert.deepEqual(r.reviewPlatforms, [
    { domain: "g2.com", title: "AEOeye Reviews 2026: Details, Pricing, & Features | G2", rating: { value: 4.6, votes: 31 } },
    { domain: "producthunt.com", title: "AEOeye - Product Information, Latest Updates, and Reviews 2026", rating: null },
    { domain: "trustpilot.com", title: "AEOeye Reviews | Read Customer Service Reviews of aeoeye.com", rating: { value: 4.2, votes: 120 } },
  ]);
  // 前 10 里的独立域名:techcrunch / news.example.org / some-blog.test / wikipedia.org
  // (不含本站与 docs 子域、LinkedIn、Reddit、评价平台、第 11 名)
  assert.equal(r.independentDomains, 4);
  assert.equal(r.forumMentions, 2);
  assert.equal(r.negativeSignals, 1);
  assert.ok(r.notes.some((n) => /^1 review-site result was about other companies \(no mention of "AEOeye"\) and was not counted\.$/.test(n)), r.notes.join("\n"));
  assert.ok(!r.notes.some((n) => /No brand name matching/.test(n)));
});

test("analyzeReputation: a generic name with an empty SERP → brand falls back to the domain label and ownsBrandSerp is null (not false)", async () => {
  const serp = fakeSerp({});
  const r = await analyzeReputation({
    domain: "https://www.zzqx-widgets.com/some/path",
    pages: [page("https://zzqx-widgets.com/", { siteName: "Blog", titleBrand: "Home" })],
    budgetMs: 30_000,
    serpFn: serp.fn,
  });
  assert.equal(r.brandName, "zzqx-widgets");
  assert.equal(r.reviewsQuery, "zzqx-widgets reviews");
  assert.equal(r.serpCalls, 2);
  assert.equal(r.ownsBrandSerp, null);
  assert.equal(r.brandTop3, false);
  assert.equal(r.knowledgePanel, false);
  assert.deepEqual(r.reviewPlatforms, []);
  assert.equal(r.independentDomains, 0);
  assert.equal(r.forumMentions, 0);
  assert.equal(r.negativeSignals, 0);
  assert.ok(r.notes.some((n) => /^No brand name matching zzqx-widgets\.com was found on the site, so the domain name "zzqx-widgets" was searched/.test(n)), r.notes.join("\n"));
  assert.ok(r.notes.some((n) => /^Google returned no organic results for "zzqx-widgets"/.test(n)), r.notes.join("\n"));
});

test("analyzeReputation: negative titles are counted only when they name the brand; not ranking #1 means ownsBrandSerp = false; a stranger's knowledge panel is not counted", async () => {
  const brand = snap(
    [
      { url: "https://www.bbb.org/us/ca/san-francisco/profile/software/aeoeye-1116-123/complaints", position: 1, title: "AEOeye | Complaints | Better Business Bureau® Profile" },
      { url: "https://lawnews.test/aeoeye-lawsuit", position: 2, title: "Customers file lawsuit against AEOeye" },
      { url: "https://other.test/aeoeye", position: 3, title: "AEOeye: the eye clinic downtown" },
      { url: "https://aeoeye.com/", position: 4, title: "AEOeye — AI visibility audits" },
    ],
    { knowledgeGraph: true }
  );
  const reviews = snap([
    { url: "https://www.sitejabber.com/reviews/aeoeye.com", position: 1, title: "AEOeye Reviews — is it a ripoff? | Sitejabber" },
    // 没提品牌名的负面标题:说的是别人,不算
    { url: "https://scamwatch.test/seo-scams", position: 2, title: "The 9 most common SEO scams" },
    { url: "https://www.trustpilot.com/review/aeoeye.com", position: 3, title: "AEOeye fraud warning | Trustpilot" },
  ]);
  const r = await analyzeReputation({ domain: "aeoeye.com", pages: aeoeyePages(), budgetMs: 30_000, serpFn: fakeSerp({ AEOeye: brand, "AEOeye reviews": reviews }).fn });
  // complaints + lawsuit + ripoff + fraud(BBB 与 Sitejabber 同时也是评价平台)
  assert.equal(r.negativeSignals, 4);
  assert.equal(r.ownsBrandSerp, false);
  assert.equal(r.brandTop3, false);
  assert.equal(r.knowledgePanel, false);
  assert.ok(r.notes.some((n) => /knowledge panel for "AEOeye", but aeoeye\.com is not in the top 3 results/.test(n)), r.notes.join("\n"));
  assert.deepEqual(
    r.reviewPlatforms.map((p) => p.domain),
    ["bbb.org", "sitejabber.com", "trustpilot.com"]
  );
  // 前 10 独立域名:lawnews.test、other.test(BBB 是评价平台,本站不算)
  assert.equal(r.independentDomains, 2);
});

test("analyzeReputation never throws: budget too small (no calls), hung SERP (returns at the deadline), failing SERP, empty domain", async () => {
  // 预算不够一次像样的 SERP:不调(不花钱),写明原因
  const idle = fakeSerp({});
  const short = await analyzeReputation({ domain: "aeoeye.com", pages: aeoeyePages(), budgetMs: 1_000, serpFn: idle.fn });
  assert.equal(short.serpCalls, 0);
  assert.equal(idle.calls.length, 0);
  assert.equal(short.ownsBrandSerp, null);
  assert.ok(short.notes.some((n) => /not enough time left in this run to check brand reputation/.test(n)), short.notes.join("\n"));

  // SERP 卡住不回:假时钟在发出请求时跳到截止前 20 ms,真实只等 20 ms
  let t = 1_000_000;
  const hang: ReputationSerpFn = () => {
    t = 1_000_000 + 6_000 - 20;
    return new Promise(() => undefined);
  };
  const t0 = Date.now();
  const hung = await analyzeReputation({ domain: "aeoeye.com", pages: aeoeyePages(), budgetMs: 6_000, serpFn: hang, now: () => t });
  assert.ok(Date.now() - t0 < 2_000, "returns at the deadline instead of waiting for the hung calls");
  assert.equal(hung.serpCalls, 2);
  assert.equal(hung.ownsBrandSerp, null);
  // 失败 note 的顺序固定:品牌词在前
  assert.deepEqual(
    hung.notes.filter((n) => /time budget ran out/.test(n)),
    ['The time budget ran out while searching Google for "AEOeye".', 'The time budget ran out while searching Google for "AEOeye reviews".']
  );

  // 一个失败、一个成功:成功的那一半照常解读
  const half = await analyzeReputation({
    domain: "aeoeye.com",
    pages: aeoeyePages(),
    budgetMs: 30_000,
    serpFn: fakeSerp({
      AEOeye: new Error("DataForSEO serp/google/organic/live/advanced: 50000 Internal Error"),
      "AEOeye reviews": snap([{ url: "https://www.trustpilot.com/review/aeoeye.com", position: 1, title: "AEOeye Reviews" }]),
    }).fn,
  });
  assert.equal(half.ownsBrandSerp, null);
  assert.deepEqual(
    half.reviewPlatforms.map((p) => p.domain),
    ["trustpilot.com"]
  );
  assert.ok(half.notes.some((n) => /^The Google results for "AEOeye" could not be loaded \(DataForSEO serp/.test(n)), half.notes.join("\n"));

  // 同步抛错、返回垃圾:都收成 note / 空结果
  const sync: ReputationSerpFn = () => {
    throw new Error("boom");
  };
  const s = await analyzeReputation({ domain: "aeoeye.com", pages: aeoeyePages(), budgetMs: 30_000, serpFn: sync });
  assert.equal(s.serpCalls, 2);
  assert.ok(s.notes.some((n) => /could not be loaded \(boom\)/.test(n)));
  const junk = await analyzeReputation({
    domain: "aeoeye.com",
    pages: aeoeyePages(),
    budgetMs: 30_000,
    serpFn: async () => ({ organic: "nope" }) as unknown as SerpSnapshot,
  });
  assert.equal(junk.ownsBrandSerp, null);

  const empty = await analyzeReputation({ domain: "", pages: [], budgetMs: 30_000, serpFn: idle.fn });
  assert.equal(empty.serpCalls, 0);
  assert.ok(empty.notes.length >= 1);
  const garbage = await analyzeReputation({ domain: "aeoeye.com", pages: [null, { url: 5 }] as unknown as CrawledPage[], budgetMs: 30_000, serpFn: idle.fn });
  assert.equal(garbage.brandName, "aeoeye");
});
