/* SEO Ranking Score 测试:npx tsx --test lib/seo-audit/tests/ranking.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANKING_PILLARS, RANKING_SUBS, type PillarId, type RankingFramework, type SubScore } from "../types";
import { runAllOnsiteChecks } from "../checks";
import { gradeFor, overallScore, scoreDimensions } from "../score";
import {
  brandDemandPoints,
  buildRankingContext,
  computeRanking,
  dataPoints,
  deliveredCount,
  experiencePoints,
  findTopicClusters,
  fleschPoints,
  gainPoints,
  inboundPoints,
  isContentPage,
  isYmylPage,
  scoreAuthorityBreadth,
  scoreAuthorityClusters,
  scoreAuthorityEditorial,
  scoreAuthorityEntity,
  scoreAuthorityInternal,
  scoreBehaviorPromise,
  scoreBehaviorReadability,
  scoreBehaviorRealUser,
  scoreBehaviorTask,
  scoreQualityAuthorship,
  scoreQualityData,
  scoreQualityExperience,
  scoreQualityFreshness,
  scoreQualityScaled,
  scoreRelevanceAlignment,
  scoreRelevanceCoverage,
  scoreRelevanceGain,
  scoreRelevanceIntent,
  type RankingInput,
} from "../ranking";
import { abs, brokenSite, makePage, makePsi, minhashFor } from "./fixtures";
import {
  NOW,
  competitor,
  contentPage,
  isoBefore,
  makeAuthority,
  makeContent,
  makePair,
  makeRelevance,
  makeVisibility,
  rankingInput,
  strongInput,
  weakAiInput,
} from "./ranking-fixtures";

const PILLAR_ORDER: PillarId[] = ["relevance", "quality", "authority", "behavior", "technical"];

function sub(r: RankingFramework, id: string): SubScore {
  const s = r.pillars.flatMap((p) => p.subs).find((x) => x.id === id);
  assert.ok(s, `sub ${id} present`);
  return s;
}

function pillar(r: RankingFramework, id: PillarId) {
  const p = r.pillars.find((x) => x.id === id);
  assert.ok(p, `pillar ${id} present`);
  return p;
}

/** 门槛:把免费版"坏站"的真实检查结果(含致命项)换进强站输入 */
function gatedInput(): RankingInput {
  const input = strongInput();
  const ctx = brokenSite();
  const checks = runAllOnsiteChecks(ctx);
  const dimensions = scoreDimensions(checks, { unlocked: true });
  const o = overallScore(dimensions, checks);
  return { ...input, checks, dimensions, technical: { score: o.score, grade: o.grade, blockers: o.blockers } };
}

function nullDataInput(): RankingInput {
  return { ...strongInput(), authority: null, visibility: null, relevance: null };
}

/** 一个场景下所有输出都要满足的契约(条数、取整、文案三态、元数据与 RANKING_SUBS 一致) */
function assertContract(r: RankingFramework, input: RankingInput, label: string): void {
  assert.equal(r.version, 1);
  assert.deepEqual(r.pillars.map((p) => p.id), PILLAR_ORDER, `${label}: pillar order`);
  const subs = r.pillars.flatMap((p) => p.subs);
  assert.deepEqual(subs.map((s) => s.id), RANKING_SUBS.map((s) => s.id), `${label}: every RANKING_SUBS id exactly once, in order`);
  assert.equal(new Set(subs.map((s) => s.id)).size, RANKING_SUBS.length);
  for (const s of subs) {
    const meta = RANKING_SUBS.find((m) => m.id === s.id)!;
    assert.equal(s.pillar, meta.pillar, `${label}: ${s.id} pillar`);
    assert.equal(s.label, meta.label);
    assert.equal(s.weight, meta.weight);
    assert.equal(s.confidence, meta.confidence);
    assert.ok(s.evidence.length >= 1 && s.evidence.length <= 4, `${label}: ${s.id} evidence count ${s.evidence.length}`);
    assert.ok(s.fixes.length <= 3, `${label}: ${s.id} fixes ≤3`);
    if (s.score === null) {
      assert.match(s.summary, /^Not measured: \S/, `${label}: ${s.id} null summary`);
    } else {
      assert.ok(Number.isInteger(s.score) && s.score >= 0 && s.score <= 100, `${label}: ${s.id} score ${s.score}`);
      assert.ok(!/^Not measured/.test(s.summary), `${label}: ${s.id} measured summary`);
      if (s.score >= 90) assert.equal(s.fixes.length, 0, `${label}: ${s.id} ≥90 → no fixes`);
      else assert.ok(s.fixes.length >= 1, `${label}: ${s.id} <90 → at least one fix`);
    }
    for (const t of [s.summary, ...s.evidence, ...s.fixes]) {
      assert.ok(t.trim().length > 0, `${label}: ${s.id} empty string`);
      assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b|\[object/.test(t), `${label}: ${s.id} leaked a raw value: ${t}`);
    }
  }
  for (const p of r.pillars) {
    const meta = RANKING_PILLARS[p.id];
    assert.equal(p.label, meta.label);
    assert.equal(p.role, meta.role);
    assert.equal(p.weight, meta.weight);
    assert.ok(p.summary.trim().length > 0 && !/\.\s/.test(p.summary), `${label}: ${p.id} summary is one sentence`);
    if (p.id === "technical") {
      assert.equal(p.score, input.technical.score, `${label}: technical pillar = free technical score`);
      assert.equal(p.grade, input.technical.grade);
      continue;
    }
    if (p.score === null) {
      assert.equal(p.grade, null);
      assert.ok(p.subs.every((s) => s.score === null), `${label}: ${p.id} null only when every sub is null`);
    } else {
      assert.ok(Number.isInteger(p.score) && p.score >= 0 && p.score <= 100);
      assert.equal(p.grade, gradeFor(p.score));
      const scored = p.subs.filter((s) => s.score !== null);
      const w = scored.reduce((n, s) => n + s.weight, 0);
      assert.equal(p.score, Math.round(scored.reduce((n, s) => n + s.weight * (s.score as number), 0) / w), `${label}: ${p.id} renormalised weighting`);
    }
  }
  assert.ok(Number.isInteger(r.overall.score) && r.overall.score >= 0 && r.overall.score <= 100);
  assert.equal(r.overall.capped, input.technical.blockers.length > 0);
  assert.equal(r.overall.grade, r.overall.capped ? "F" : gradeFor(r.overall.score));
  for (const s of subs.filter((x) => x.score === null)) assert.ok(r.notes.some((n) => n.startsWith(s.label)), `${label}: note for null ${s.id}`);
}

/* ============================================================
   场景
   ============================================================ */

test("strong site scores ≥80 overall with every sub-score measured", () => {
  const input = strongInput();
  const r = computeRanking(input);
  assertContract(r, input, "strong");
  assert.ok(r.overall.score >= 80, `overall ${r.overall.score}`);
  assert.ok(r.overall.grade === "A" || r.overall.grade === "B");
  assert.equal(r.overall.capped, false);
  assert.ok(r.pillars.flatMap((p) => p.subs).every((s) => s.score !== null), "nothing missing on the strong site");
  for (const id of PILLAR_ORDER) assert.ok((pillar(r, id).score as number) >= 80, `${id} = ${pillar(r, id).score}`);
  assert.equal(r.notes.length, 0);
  // basis:可读页、内容页、查询、实际抓到的竞品(按 URL 去重)
  assert.equal(r.basis.pagesAnalyzed, input.pages.length);
  assert.equal(r.basis.contentPages, 14);
  assert.deepEqual(r.basis.queries.map((q) => q.query), ["how to fix crawl errors", "schema markup basics", "speed up lcp"]);
  assert.deepEqual(r.basis.queries[0], { query: "how to fix crawl errors", url: abs("/blog/crawl-errors-fix"), position: 4, volume: 880, intent: "informational" });
  assert.equal(r.basis.competitorsCompared, 5);
  assert.equal(r.relevance, input.relevance, "relevance passed through");
  assert.equal(sub(r, "quality.experience").summary, "All 14 content pages show first-hand experience");
  assert.equal(sub(r, "authority.breadth").score, 78, "breadth = authority.score");
});

test("weak scaled-AI site: scaled-content risk and first-hand experience score low", () => {
  const input = weakAiInput();
  const r = computeRanking(input);
  assertContract(r, input, "weak");
  const scaled = sub(r, "quality.scaled");
  assert.ok((scaled.score as number) <= 20, `scaled ${scaled.score}`);
  assert.equal(scaled.summary, "Parts of your content look mass-produced — the pattern Google's scaled-content spam policy targets");
  const ev = scaled.evidence.join("\n");
  assert.match(ev, /Near-duplicate content pages \(text over 80% identical\): 16 of 16/);
  assert.match(ev, /Stock AI phrases .*18\.5 per 1,000 words/);
  assert.match(ev, /16 of 16 content pages \(100%\) share the same publish date/);
  const exp = sub(r, "quality.experience");
  assert.equal(exp.score, 0);
  assert.equal(exp.summary, "None of your 16 content pages show first-hand experience");
  assert.ok(exp.evidence.some((e) => e.startsWith("First-person testing language found on 0 of 16 content pages")));
  assert.ok(exp.fixes[0].startsWith("Add what you actually did: the setup you tested, the numbers you saw, a screenshot from your own account"));
  assert.ok(r.overall.score < 50, `overall ${r.overall.score}`);
  assert.equal(sub(r, "relevance.intent").summary, "1 of 1 query lands on the wrong kind of page for what searchers want");
  assert.match(sub(r, "relevance.intent").fixes[0], /^Turn \/guides\/best-crm-for-dentists into a side-by-side comparison/);
  assert.match(sub(r, "authority.entity").summary, /doesn't match your domain example\.com/);
  assert.match(sub(r, "behavior.promise").evidence[1], /promises 10, the page has 2 sections or list items/);
});

test("summaries switch between the positive and the problem sentence", () => {
  const strong = computeRanking(strongInput());
  const weak = computeRanking(weakAiInput());
  let compared = 0;
  for (const meta of RANKING_SUBS) {
    const a = sub(strong, meta.id);
    const b = sub(weak, meta.id);
    if (a.score === null || b.score === null || a.score < 70 || b.score >= 70) continue;
    compared += 1;
    assert.notEqual(a.summary, b.summary, `${meta.id}: ≥70 and <70 must read differently`);
  }
  assert.ok(compared >= 15, `compared ${compared} sub-scores across the threshold`);
});

test("technical gate: blockers cap the overall score at 40 with grade F and say why", () => {
  const input = gatedInput();
  assert.ok(input.technical.blockers.length > 0, "fixture has blockers");
  const r = computeRanking(input);
  assertContract(r, input, "gate");
  assert.ok(r.overall.score <= 40, `overall ${r.overall.score}`);
  assert.equal(r.overall.grade, "F");
  assert.equal(r.overall.capped, true);
  assert.match(r.overall.note, /^Capped at 40 \(grade F\): fix the technical blockers first — /);
  assert.ok(r.overall.note.includes("Homepage is blocked from Google"), "blockers in plain English, not check ids");
  assert.ok(!/crawl\.entry\.indexable/.test(r.overall.note));
  assert.equal(pillar(r, "technical").score, input.technical.score);
  assert.equal(pillar(r, "technical").grade, "F");
  assert.match(sub(r, "technical.crawl").summary, /is capped by a critical issue/);
  assert.ok(r.notes[0].startsWith("Overall score capped at 40"));
  // 未封顶时本来就 <40 的分数保持原值(封顶只压不抬)
  const weak = weakAiInput();
  const uncapped = computeRanking(weak).overall.score;
  const capped = computeRanking({ ...weak, technical: { ...weak.technical, blockers: ["crawl.entry.indexable"] } });
  assert.equal(capped.overall.score, Math.min(uncapped, 40));
  assert.equal(capped.overall.grade, "F");
});

test("missing authority / visibility / relevance: those subs are null, the rest renormalise", () => {
  const input = nullDataInput();
  const r = computeRanking(input);
  assertContract(r, input, "null-data");
  for (const id of ["relevance.intent", "relevance.coverage", "relevance.gain", "relevance.alignment", "authority.editorial", "authority.breadth"]) {
    const s = sub(r, id);
    assert.equal(s.score, null, `${id} null`);
    assert.match(s.summary, /^Not measured: /);
  }
  assert.equal(sub(r, "relevance.intent").summary, "Not measured: the search-query comparison did not run for this report");
  assert.equal(sub(r, "authority.breadth").summary, "Not measured: backlink data was not available for this report");
  assert.equal(pillar(r, "relevance").score, null);
  assert.equal(pillar(r, "relevance").grade, null);
  // 品牌需求不计,按 60 分满额重新归一:实体一致 40 + sameAs 20 → 100
  const entity = sub(r, "authority.entity");
  assert.equal(entity.score, 100);
  assert.ok(entity.evidence.some((e) => e.startsWith("Brand search demand not measured")));
  // 答案前置一项缺失 → 其余三项重新归一
  assert.equal(sub(r, "behavior.task").score, 100);
  // 总分 = 有分支柱按权重重新归一
  const scored = r.pillars.filter((p) => p.score !== null);
  assert.deepEqual(scored.map((p) => p.id), ["quality", "authority", "behavior", "technical"]);
  const expected = Math.round(scored.reduce((n, p) => n + p.weight * (p.score as number), 0) / scored.reduce((n, p) => n + p.weight, 0));
  assert.equal(r.overall.score, expected);
  assert.equal(r.overall.note, "Based on 19 of 25 sub-scores — 6 could not be measured");
  assert.ok(r.notes.includes("Relevance & search intent is left out of the overall score: none of its sub-scores could be measured"));
  assert.deepEqual(r.basis.queries, []);
  assert.equal(r.basis.competitorsCompared, 0);
  assert.equal(r.relevance, null);
});

test("no pages at all: content subs are null and the overall falls back to the technical pillar", () => {
  const input = rankingInput({ pages: [], psi: { mobile: null, desktop: null }, technical: { score: 72, grade: "B", blockers: [] } });
  const r = computeRanking(input);
  assertContract(r, input, "empty");
  assert.equal(sub(r, "quality.experience").summary, "Not measured: we could not read any pages on the site");
  assert.equal(sub(r, "behavior.realuser").score, null);
  assert.deepEqual(r.pillars.filter((p) => p.score !== null).map((p) => p.id), ["technical"]);
  assert.equal(r.overall.score, 72);
  assert.equal(r.overall.grade, "B");
});

test("technical pillar equals input.technical.score even when the dimension average differs", () => {
  const base = strongInput();
  const input = { ...base, technical: { score: 63, grade: "C" as const, blockers: [] } };
  const r = computeRanking(input);
  assertContract(r, input, "technical");
  const t = pillar(r, "technical");
  assert.equal(t.score, 63);
  assert.equal(t.grade, "C");
  // 7 个小维度一一对应现有 7 个站内维度
  const map: Record<string, string> = {
    "technical.crawl": "crawlability",
    "technical.onpage": "onpage",
    "technical.cwv": "performance",
    "technical.mobile": "mobile",
    "technical.https": "security",
    "technical.structure": "architecture",
    "technical.schema": "structured",
  };
  for (const [subId, dimId] of Object.entries(map)) {
    assert.equal(sub(r, subId).score, base.dimensions.find((d) => d.id === dimId)!.score, subId);
  }
  // 小维度没分时 null + 原因
  const noDims = computeRanking({ ...input, dimensions: input.dimensions.map((d) => (d.id === "mobile" ? { ...d, score: null, summary: "Insufficient data" } : d)) });
  assert.equal(sub(noDims, "technical.mobile").score, null);
  assert.equal(sub(noDims, "technical.mobile").summary, "Not measured: too few of its checks could run on this site");
  assert.equal(pillar(noDims, "technical").score, 63);
});

test("deterministic and side-effect free: same input → deep-equal output, input untouched, survives a JSON round trip", () => {
  const input = strongInput();
  const before = structuredClone(input);
  const a = computeRanking(input);
  const b = computeRanking(input);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(input, before, "input not mutated");
  const revived = JSON.parse(JSON.stringify(input)) as RankingInput;
  revived.now = new Date(input.now as Date);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(computeRanking(revived))), JSON.parse(JSON.stringify(a)));
  for (const make of [weakAiInput, gatedInput, nullDataInput]) {
    const x = make();
    assert.deepStrictEqual(computeRanking(x), computeRanking(x));
  }
});

/* ============================================================
   内容页口径
   ============================================================ */

test("content pages: article / product / other / listing with ≥300 words; home, legal, contact, pricing, tools, shells excluded", () => {
  const yes = [
    contentPage("/blog/a"),
    makePage({ url: abs("/blog"), pageType: "listing", content: makeContent({ mainWords: 400 }) }),
    makePage({ url: abs("/features"), pageType: "other", content: makeContent({ mainWords: 300 }) }),
    makePage({ url: abs("/product/x"), pageType: "product", content: makeContent({ mainWords: 600 }) }),
  ];
  const no = [
    makePage({ url: abs("/"), pageType: "home", content: makeContent({ mainWords: 2000 }) }),
    makePage({ url: abs("/privacy"), pageType: "legal", content: makeContent({ mainWords: 2000 }) }),
    makePage({ url: abs("/contact"), pageType: "contact", content: makeContent({ mainWords: 900 }) }),
    makePage({ url: abs("/pricing"), pageType: "pricing", content: makeContent({ mainWords: 900 }) }),
    makePage({ url: abs("/product/y"), pageType: "product", content: makeContent({ mainWords: 299 }) }),
    makePage({ url: abs("/login"), pageType: "other", content: makeContent({ mainWords: 500 }) }),
    contentPage("/blog/shell", {}, { jsShell: true }),
    contentPage("/blog/gone", {}, { status: 404 }),
    makePage({ url: abs("/blog/no-signals"), pageType: "article" }),
  ];
  for (const p of yes) assert.equal(isContentPage(p), true, p.url);
  for (const p of no) assert.equal(isContentPage(p), false, p.url);
  const ctx = buildRankingContext(rankingInput({ pages: [...yes, ...no] }));
  assert.deepEqual(ctx.contentPages.map((p) => p.url), yes.map((p) => p.url));
  assert.deepEqual(ctx.articlePages.map((p) => p.url), [abs("/blog/a")]);
  assert.equal(ctx.readable.length, yes.length + no.length - 1, "the 404 page is not readable");
});

/* ============================================================
   相关性 / 搜索意图
   ============================================================ */

test("relevance.intent = 100 × matched / judged pairs (null intentMatch ignored)", () => {
  const relevance = makeRelevance([
    makePair({ query: "a b", url: abs("/blog/a") }),
    makePair({ query: "c d", url: abs("/blog/c") }),
    makePair({ query: "best crm", url: abs("/blog/crm"), intent: "commercial", pageFormat: "article", serpFormat: "listicle", intentMatch: false }),
    makePair({ query: "e f", url: abs("/blog/e"), intentMatch: null }),
  ]);
  const s = scoreRelevanceIntent(buildRankingContext(rankingInput({ pages: [], relevance })));
  assert.equal(s.score, 67);
  assert.equal(s.summary, "1 of 3 queries land on the wrong kind of page for what searchers want");
  assert.match(s.evidence[0], /^"best crm" \(commercial intent\) → \/blog\/crm is an article; the top results are mostly lists of options — mismatch$/);
  assert.match(s.fixes[0], /^Turn \/blog\/crm into a ranked list of options/);
  const allGood = scoreRelevanceIntent(buildRankingContext(rankingInput({ pages: [], relevance: makeRelevance([makePair({ query: "x", url: abs("/x") })]) })));
  assert.equal(allGood.score, 100);
  assert.equal(allGood.summary, "The query we checked lands on the kind of page Google ranks for it");
  assert.deepEqual(allGood.fixes, []);
  const noneJudged = scoreRelevanceIntent(buildRankingContext(rankingInput({ pages: [], relevance: makeRelevance([makePair({ query: "x", url: abs("/x"), intentMatch: null })]) })));
  assert.equal(noneJudged.score, null);
  const noPairs = scoreRelevanceIntent(buildRankingContext(rankingInput({ pages: [], relevance: makeRelevance([], { notes: ["SERP comparison skipped: time budget used up."] }) })));
  assert.equal(noPairs.summary, "Not measured: no search queries could be matched to your pages");
  assert.deepEqual(noPairs.evidence, ["SERP comparison skipped: time budget used up"]);
});

test("relevance.coverage = min(100, average coverage / 0.7 × 100); no coverage → null", () => {
  const at = (covs: (number | null)[]) =>
    scoreRelevanceCoverage(buildRankingContext(rankingInput({ pages: [], relevance: makeRelevance(covs.map((c, i) => makePair({ query: `q${i}`, url: abs(`/p${i}`), coverage: c }))) })));
  const half = at([0.35, 0.35]);
  assert.equal(half.score, 50);
  assert.equal(half.summary, "Your pages cover only 35% of the subtopics the top-ranking pages have in common");
  assert.match(half.fixes[0], /^Add sections on log file analysis to \/p0/);
  assert.equal(at([0.9]).score, 100);
  assert.deepEqual(at([0.9]).fixes, []);
  assert.equal(at([0.7, null]).score, 100, "pairs without coverage are ignored");
  assert.equal(at([null, null]).score, null);
});

test("relevance.gain: competitor formula per pair; self-only estimate capped at 60 when no competitor was fetched", () => {
  assert.equal(gainPoints({ uniqueTopics: 3, extraNumbers: 6, extraTables: 1, ownImages: 1, experienceMarkers: 2 }), 77);
  assert.equal(gainPoints({ uniqueTopics: 9, extraNumbers: 10, extraTables: 2, ownImages: 5, experienceMarkers: 5 }), 100);
  assert.equal(gainPoints({ uniqueTopics: 0, extraNumbers: 1, extraTables: 0, ownImages: 0, experienceMarkers: 1 }), 10);
  assert.equal(gainPoints({ uniqueTopics: 9, extraNumbers: 10, extraTables: 2, ownImages: 5, experienceMarkers: 5 }, false), 60);

  const g = { uniqueTopics: 3, extraNumbers: 6, extraTables: 1, ownImages: 1, experienceMarkers: 2 };
  const unfetched = [1, 2, 3].map((i) => competitor(i, { fetched: false, error: "robots.txt disallows AEOeyeBot" }));
  // 只有部分对有竞品:只平均做过对比的对
  const mixed = scoreRelevanceGain(
    buildRankingContext(
      rankingInput({
        pages: [contentPage("/blog/b")],
        relevance: makeRelevance([makePair({ query: "a", url: abs("/blog/a"), gainSignals: g }), makePair({ query: "b", url: abs("/blog/b"), competitors: unfetched })]),
      }),
    ),
  );
  assert.equal(mixed.score, 77);

  // 一个竞品都没抓到:用本页信号(24 个数据点、1 张表、3 张自有图、4 处一手经验)→ 20 + 15 + 15 + 10 = 60
  const input = rankingInput({ pages: [contentPage("/blog/b")], relevance: makeRelevance([makePair({ query: "b", url: abs("/blog/b"), competitors: unfetched })]) });
  const est = scoreRelevanceGain(buildRankingContext(input));
  assert.equal(est.score, 60);
  assert.equal(est.confidence, "estimated");
  assert.match(est.summary, /not compared with ranking pages, so capped at 60$/);
  assert.match(est.evidence[0], /^Not compared with ranking pages/);
  assert.ok(computeRanking(input).notes.some((n) => n.startsWith("Information gain is estimated from your own pages only")));
});

test("relevance.alignment = 40 × title + 30 × H1 + 30 × answer-first, averaged", () => {
  const relevance = makeRelevance([
    makePair({ query: "fix crawl errors", url: abs("/a"), titleAlignment: 0.5, h1Alignment: 1, answerEarly: false }),
    makePair({ query: "b", url: abs("/b") }),
  ]);
  const s = scoreRelevanceAlignment(buildRankingContext(rankingInput({ pages: [], relevance })));
  assert.equal(s.score, 75);
  assert.equal(s.evidence[0], '"fix crawl errors" → /a: title covers 50% of the query\'s key words, H1 100%, answered in the first 150 words: no');
  assert.deepEqual(s.fixes, ['Use the words "fix crawl errors" in the title and H1 of /a', 'Answer "fix crawl errors" in the first two sentences of /a, before any background']);
});

/* ============================================================
   内容质量
   ============================================================ */

test("quality.experience: brief example — only 3 of 18 content pages show first-hand experience", () => {
  const withExp = ["a", "b", "c"].map((s) => contentPage(`/blog/${s}`, { experienceMarkers: 3, imagesSelfHosted: 0 }));
  const without = Array.from({ length: 15 }, (_, i) => contentPage(`/blog/p${i + 1}`, { experienceMarkers: 0, imagesSelfHosted: 0 }));
  const s = scoreQualityExperience(buildRankingContext(rankingInput({ pages: [...withExp, ...without] })));
  assert.equal(s.score, Math.round((3 * 70) / 18));
  assert.equal(s.summary, "Only 3 of 18 content pages show first-hand experience");
  assert.equal(s.evidence[0], "First-person testing language found on 3 of 18 content pages (/blog/a, /blog/b, /blog/c)");
  assert.equal(s.confidence, "estimated");
  // 公式:min(经验词, 3)/3 × 70 + 自有图片 30
  assert.equal(Math.round(experiencePoints(makeContent({ experienceMarkers: 1, imagesSelfHosted: 0 })) * 100) / 100, 23.33);
  assert.equal(experiencePoints(makeContent({ experienceMarkers: 7, imagesSelfHosted: 1 })), 100);
  const mixed = scoreQualityExperience(
    buildRankingContext(rankingInput({ pages: [contentPage("/a", { experienceMarkers: 1, imagesSelfHosted: 0 }), contentPage("/b", { experienceMarkers: 3, imagesSelfHosted: 1 })] })),
  );
  assert.equal(mixed.score, 62);
  const none = scoreQualityExperience(buildRankingContext(rankingInput({ pages: [makePage({ url: abs("/"), pageType: "home", content: makeContent() })] })));
  assert.equal(none.score, null);
  assert.match(none.summary, /^Not measured: none of the 1 page we read has 300\+ words of main text/);
});

test("quality.data per page: original data 40 + table 20 + authoritative links per 1,000 words (40/25/10)", () => {
  assert.equal(dataPoints(makeContent({ originalDataMarkers: 1, tableCount: 0, authoritativeOutlinks: 1, mainWords: 1000 })), 45);
  assert.equal(dataPoints(makeContent({ originalDataMarkers: 2, tableCount: 1, authoritativeOutlinks: 2, mainWords: 1000 })), 100);
  assert.equal(dataPoints(makeContent({ originalDataMarkers: 0, tableCount: 0, authoritativeOutlinks: 1, mainWords: 2000 })), 10);
  assert.equal(dataPoints(makeContent({ originalDataMarkers: 0, tableCount: 0, authoritativeOutlinks: 0 })), 0);
  const s = scoreQualityData(buildRankingContext(rankingInput({ pages: [contentPage("/a", { originalDataMarkers: 0, tableCount: 0, authoritativeOutlinks: 0 })] })));
  assert.equal(s.score, 0);
  assert.equal(s.summary, "Your content pages make claims without original data or sources readers can check");
});

test("quality.authorship: byline / schema / About / Contact / sameAs, with the stricter YMYL rule", () => {
  assert.equal(isYmylPage(makeContent({ ymylHits: 2, mainWords: 600 })), false);
  assert.equal(isYmylPage(makeContent({ ymylHits: 3, mainWords: 1000 })), true);
  assert.equal(isYmylPage(makeContent({ ymylHits: 3, mainWords: 2000 })), false, "incidental mentions in a long page");
  const page = (path: string, byline: boolean, ymylHits: number) => contentPage(path, { byline, authorInSchema: byline, ymylHits }, { links: [] });
  const pages = [page("/a", true, 10), page("/b", true, 0), page("/c", false, 10), page("/d", false, 0), page("/e", false, 0)];
  const ymyl = scoreQualityAuthorship(buildRankingContext(rankingInput({ pages })));
  // 40 × 0.4 + 15 × 0.4 − 15(YMYL 占 40% 且署名 <80%)
  assert.equal(ymyl.score, 7);
  assert.match(ymyl.summary, /health, finance and legal topics are held to a stricter standard/);
  assert.ok(ymyl.evidence.some((e) => e.startsWith("2 of 5 content pages (40%) cover health, money or legal topics")));
  const plain = scoreQualityAuthorship(buildRankingContext(rankingInput({ pages: pages.map((p) => ({ ...p, content: { ...p.content!, ymylHits: 0 } })) })));
  assert.equal(plain.score, 22);
  assert.ok(!/stricter/.test(plain.summary));
  // About + 带邮箱的 Contact + sameAs ≥2 各 15
  const full = scoreQualityAuthorship(
    buildRankingContext(
      rankingInput({
        pages: [
          ...pages.map((p) => ({ ...p, content: { ...p.content!, ymylHits: 0 } })),
          makePage({ url: abs("/about"), pageType: "contact", links: [], content: makeContent({ mainWords: 200 }) }),
          makePage({ url: abs("/contact"), pageType: "contact", links: [], textSample: "Questions? Write to support@example.com and we reply within a day.", content: makeContent({ mainWords: 60 }) }),
          makePage({ url: abs("/"), pageType: "home", links: [], content: makeContent({ sameAsCount: 2 }) }),
        ],
      }),
    ),
  );
  assert.equal(full.score, 67);
  assert.match(full.evidence[1], /About page: found \(\/about\); contact page with email, phone or address: found \(\/contact, with email\)/);
  // 只有表单、没有联系方式的 Contact 页不给分
  const formOnly = scoreQualityAuthorship(
    buildRankingContext(rankingInput({ pages: [...pages, makePage({ url: abs("/contact"), pageType: "contact", links: [], textSample: "Send us a message using the form below.", content: makeContent({ mainWords: 40 }) })] })),
  );
  assert.match(formOnly.evidence[1], /found \(\/contact\) but no email, phone or address detected/);
  assert.ok(formOnly.fixes.some((f) => f.startsWith("Show an email address, phone number or postal address on /contact")));
});

test("quality.freshness: 60 × updated in 365 days + 20 × dated + 20 × (1 − outdated title year)", () => {
  const pages = [
    contentPage("/a", { dateModified: isoBefore(30), datePublished: isoBefore(400), titleYear: 2026 }),
    contentPage("/b", { dateModified: null, datePublished: isoBefore(800), titleYear: 2023 }),
    contentPage("/c", { dateModified: null, datePublished: null, titleYear: 2025 }),
    contentPage("/d", { dateModified: isoBefore(10), datePublished: null, titleYear: null }),
  ];
  const s = scoreQualityFreshness(buildRankingContext(rankingInput({ pages })));
  // recent 2/4 → 30;dated 3/4 → 15;过期年份(2023 < 2025)1/4 → 15
  assert.equal(s.score, 60);
  assert.equal(s.summary, "Only 2 of 4 content pages show an update in the last 12 months");
  assert.ok(s.evidence.includes("Outdated year in the title: /b (2023)"));
  assert.ok(s.evidence.some((e) => e.startsWith("Oldest last update: /b (")));
  // 未来日期是坏数据,不算"最近更新"
  const future = scoreQualityFreshness(buildRankingContext(rankingInput({ pages: [contentPage("/f", { dateModified: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(), datePublished: null })] })));
  assert.equal(future.score, 40);
});

test("quality.scaled: duplicates, AI phrases, publishing bursts, thin pages and zero experience each cost points", () => {
  const sameDay = isoBefore(3);
  const pages = (n: number, over: Parameters<typeof makeContent>[0] = {}) => Array.from({ length: n }, (_, i) => contentPage(`/blog/p${i}`, { datePublished: isoBefore(10 + i * 7), ...over }));
  const scaled = (ps: ReturnType<typeof pages>) => scoreQualityScaled(buildRankingContext(rankingInput({ pages: ps })));
  assert.equal(scaled(pages(10)).score, 100);
  // ≥10 个内容页且 ≥40% 同一天发布 → −20
  const burst = pages(10).map((p, i) => (i < 4 ? { ...p, content: { ...p.content!, datePublished: sameDay } } : p));
  assert.equal(scaled(burst).score, 80);
  assert.equal(scaled(burst.map((p, i) => (i === 3 ? { ...p, content: { ...p.content!, datePublished: isoBefore(99) } } : p))).score, 100, "30% on one day is not a burst");
  assert.equal(scaled(pages(9, { datePublished: sameDay })).score, 100, "fewer than 10 content pages never counts as a burst");
  // 近重复:一半的页 minhash 相同 → 0.5 × 40
  assert.equal(scaled(pages(10).map((p, i) => (i < 5 ? { ...p, minhash: minhashFor(7) } : p))).score, 80);
  // AI 套话每千词 2(≥1.5)→ −12;≥3 → −25
  assert.equal(scaled(pages(10, { aiPhraseHits: 3 })).score, 88);
  assert.equal(scaled(pages(10, { aiPhraseHits: 5 })).score, 75);
  // 薄内容占比(分母 = 内容类型页)× 20:10 个内容页 + 2 个薄页 → −3.33
  assert.equal(scaled([...pages(10), contentPage("/blog/t1", { mainWords: 120 }), contentPage("/blog/t2", { mainWords: 150 })]).score, 97);
  // ≥80% 零一手经验 → −10
  assert.equal(scaled(pages(10, { experienceMarkers: 0 })).score, 90);
});

/* ============================================================
   权威与外链
   ============================================================ */

test("authority.editorial: body placement (60) + editorial platforms (40); missing data handled", () => {
  const at = (a: Parameters<typeof makeAuthority>[0] | null) =>
    scoreAuthorityEditorial(buildRankingContext(rankingInput({ pages: [], authority: a === null ? null : makeAuthority(a) })));
  const s = at({ semanticLocations: { article: 45, footer: 55, "": 900 }, platformTypes: { blogs: 30, organization: 70, unknown: 900 } });
  assert.equal(s.score, 65);
  assert.equal(s.summary, "Most of your backlinks sit in footers, sidebars or directories rather than inside articles");
  assert.equal(at({ semanticLocations: { article: 45, footer: 55 }, platformTypes: undefined }).score, 75, "only placement reported → renormalised to 100");
  assert.equal(at({ semanticLocations: undefined, platformTypes: undefined }).score, null);
  assert.equal(at(null).score, null);
  const nd = at({ noData: true });
  assert.equal(nd.score, null);
  assert.equal(nd.summary, "Not measured: DataForSEO has no backlink data for this domain yet");
  const zero = at({ backlinks: 0, referringDomains: 0 });
  assert.equal(zero.score, 0);
  assert.equal(zero.summary, "No backlinks found yet, so no editorial links either");
});

test("authority.breadth is the authority module's own score", () => {
  const s = scoreAuthorityBreadth(buildRankingContext(rankingInput({ pages: [], authority: makeAuthority({ score: 63, referringDomains: 240, rank: 140 }) })));
  assert.equal(s.score, 63);
  assert.equal(s.summary, "Your link authority trails stronger sites: 240 referring domains, Domain Rank 140");
  assert.equal(scoreAuthorityBreadth(buildRankingContext(rankingInput({ pages: [], authority: makeAuthority({ noData: true }) }))).score, null);
});

test("authority.clusters: linked pages sharing a topic word; fewer than 5 content pages → null", () => {
  const linked = (slugs: string[]) => slugs.map((s) => contentPage(`/blog/${s}`, {}, { links: slugs.filter((x) => x !== s).map((x) => abs(`/blog/${x}`)) }));
  const cluster = linked(["seo-audit-basics", "seo-audit-checklist", "seo-audit-tools-compared"]);
  const loners = ["pricing-psychology", "hiring-engineers", "remote-culture"].map((s) => contentPage(`/blog/${s}`, {}, { links: [] }));
  const found = findTopicClusters([...cluster, ...loners]);
  assert.ok(found.some((c) => c.token === "audit" && c.urls.length === 3));
  const s = scoreAuthorityClusters(buildRankingContext(rankingInput({ pages: [...cluster, ...loners] })));
  // 3/6 = 0.5 → 0.5 / 0.6 × 100
  assert.equal(s.score, 83);
  assert.ok(s.evidence.some((e) => e.startsWith("Standalone content pages (no linked pages on the same topic): 3 of 6")));
  // 同主题但互不链接 → 不成簇
  const unlinked = ["seo-audit-basics", "seo-audit-checklist", "seo-audit-tools-compared", "a-b", "c-d"].map((s) => contentPage(`/blog/${s}`, {}, { links: [] }));
  assert.equal(scoreAuthorityClusters(buildRankingContext(rankingInput({ pages: unlinked }))).score, 0);
  const few = scoreAuthorityClusters(buildRankingContext(rankingInput({ pages: cluster })));
  assert.equal(few.score, null);
  assert.equal(few.summary, "Not measured: fewer than 5 content pages (found 3), too few to form topic clusters");
});

test("authority.internal: share of crawled pages linking to each core page (100 / 70 / 40 / 10)", () => {
  assert.equal(inboundPoints(0.5), 100);
  assert.equal(inboundPoints(0.49), 70);
  assert.equal(inboundPoints(0.2), 70);
  assert.equal(inboundPoints(0.19), 40);
  assert.equal(inboundPoints(0.05), 40);
  assert.equal(inboundPoints(0.049), 10);
  const others = Array.from({ length: 10 }, (_, i) => contentPage(`/blog/p${i}`, {}, { links: [abs("/")] }));
  const pages = [
    makePage({ url: abs("/"), pageType: "home", links: [], content: makeContent() }),
    makePage({ url: abs("/pricing"), pageType: "pricing", links: [], content: makeContent() }),
    ...others,
  ];
  const s = scoreAuthorityInternal(buildRankingContext(rankingInput({ pages })));
  // 首页:10/11 → 100;定价页:0/11 → 10
  assert.equal(s.score, 55);
  assert.equal(s.evidence[0], "/pricing (pricing page) is linked from 0 of 11 other crawled pages (0%)");
  assert.match(s.fixes[0], /^Link \/pricing \(pricing page\) from your main navigation or footer/);
  // 排名词对应的 URL 也是核心页
  const vis = makeVisibility({ topKeywords: [{ keyword: "seo audit", position: 5, volume: 900, etv: 10, url: abs("/blog/p3"), intent: "commercial", cpc: 3 }] });
  const withRank = scoreAuthorityInternal(buildRankingContext(rankingInput({ pages, visibility: vis })));
  assert.ok(withRank.evidence.some((e) => e.startsWith('/blog/p3 (ranks for "seo audit") is linked from 0 of 11')));
});

test("authority.entity: consistent brand 40 + sameAs 20 + brand demand 40; renormalised to 60 without ranking data", () => {
  assert.deepEqual([1000, 999, 100, 99, 1, 0].map(brandDemandPoints), [40, 25, 25, 10, 10, 0]);
  const pages = Array.from({ length: 5 }, (_, i) => contentPage(`/blog/p${i}`, { siteName: "Example", titleBrand: "Example", sameAsCount: 0 }));
  const noVis = scoreAuthorityEntity(buildRankingContext(rankingInput({ pages })));
  assert.equal(noVis.score, 67, "40 / 60 × 100");
  const vis = (volume: number) => makeVisibility({ topKeywords: [{ keyword: "example login", position: 1, volume, etv: 1, url: abs("/"), intent: "navigational", cpc: 0 }] });
  assert.equal(scoreAuthorityEntity(buildRankingContext(rankingInput({ pages, visibility: vis(150) }))).score, 65);
  assert.equal(scoreAuthorityEntity(buildRankingContext(rankingInput({ pages, visibility: vis(0) }))).score, 40);
  // 品牌名在页面之间不一致(只有 2/5 页带品牌)→ 实体项 0
  const mixed = pages.map((p, i) => (i < 3 ? { ...p, content: { ...p.content!, siteName: null, titleBrand: null } } : p));
  const m = scoreAuthorityEntity(buildRankingContext(rankingInput({ pages: mixed })));
  assert.equal(m.score, 0);
  assert.equal(m.summary, 'Your brand name isn\'t used consistently enough for Google to tie every page to "Example"');
});

/* ============================================================
   用户满意信号
   ============================================================ */

test("behavior.realuser: CrUX LCP / INP / CLS bands (good 33.3, needs improvement 16.7, poor 0)", () => {
  const ru = (psi: RankingInput["psi"]) => scoreBehaviorRealUser(buildRankingContext(rankingInput({ pages: [], psi })));
  const mixed = ru({ mobile: makePsi({ fieldMetrics: { lcpMs: 3000, inpMs: 150, cls: 0.3, ttfbMs: 900, source: "origin" } }), desktop: null });
  assert.equal(mixed.score, 50);
  assert.equal(mixed.summary, "Real Chrome users see a jumpy layout: Cumulative Layout Shift is 0.3 (poor)");
  assert.equal(mixed.evidence[3], "Source: origin-level Chrome UX Report data (real users, mobile)");
  // 旧数据只有 field 分档
  assert.equal(ru({ mobile: makePsi({ fieldMetrics: null, field: { lcp: "FAST", inp: "AVERAGE", cls: "SLOW", overall: "AVERAGE" } }), desktop: null }).score, 50);
  // 移动端报错 → 用桌面端
  assert.equal(ru({ mobile: makePsi({ error: "timeout" }), desktop: makePsi({ strategy: "desktop" }) }).score, 100);
  const none = ru({ mobile: makePsi({ fieldMetrics: null, field: null }), desktop: null });
  assert.equal(none.score, null);
  assert.match(none.summary, /^Not measured: Google has no real-user data/);
});

test("behavior.task: answer-first 40 + next step 30 + FAQ 15 + no pop-ups 15, renormalised when a part is missing", () => {
  const pages = [contentPage("/a"), contentPage("/b", { nextStepLinks: 0, hasFaq: false })];
  // 没有查询对:(30 × 0.5 + 15 × 0.5 + 15 × 1) / 60
  assert.equal(scoreBehaviorTask(buildRankingContext(rankingInput({ pages }))).score, 63);
  const relevance = makeRelevance([makePair({ query: "a", url: abs("/a"), answerEarly: false }), makePair({ query: "b", url: abs("/b"), answerEarly: false })]);
  const s = scoreBehaviorTask(buildRankingContext(rankingInput({ pages, relevance })));
  // (40 × 0 + 30 × 0.5 + 15 × 0.5 + 15 × 1) / 100
  assert.equal(s.score, 38);
  assert.equal(s.summary, "Pages make visitors dig for the answer before they get it");
  assert.equal(s.evidence[0], "The main query is answered in the first 150 words on 0 of 2 pages we checked against search queries");
});

test("behavior.readability: Flesch bands, paragraph length, words per heading, lists; Flesch null counts as 35", () => {
  assert.deepEqual([65, 60, 45, 40, 35, 30, 10].map(fleschPoints), [50, 50, 35, 35, 20, 20, 10]);
  assert.equal(fleschPoints(null), 35);
  const nonEnglish = scoreBehaviorReadability(buildRankingContext(rankingInput({ pages: [contentPage("/a", { fleschReadingEase: null })] })));
  assert.equal(nonEnglish.score, 85);
  assert.equal(nonEnglish.evidence[0], "Reading ease not measured (pages aren't in English) — counted as average");
  const hard = scoreBehaviorReadability(
    buildRankingContext(rankingInput({ pages: [contentPage("/a", { fleschReadingEase: 25, avgParagraphWords: 130, h2Count: 1, h3Count: 1, listCount: 0, tableCount: 0 })] })),
  );
  assert.equal(hard.score, 10);
  assert.equal(hard.summary, "Your content is hard to read: long sentences and complex words");
});

test("behavior.promise: clickbait, unkept title numbers and off-topic openings cost 50 / 30 / 20", () => {
  assert.equal(deliveredCount(makeContent({ h2Count: 4, h3Count: 11, listItemCount: 3 })), 11);
  const pages = [
    contentPage("/a"),
    contentPage("/b"),
    contentPage("/c"),
    contentPage("/ten-ways", { titleNumber: 10, h2Count: 4, h3Count: 0, listItemCount: 3 }),
  ];
  const s = scoreBehaviorPromise(buildRankingContext(rankingInput({ pages })));
  // 1/4 页数字不兑现 → 100 − 7.5
  assert.equal(s.score, 93);
  assert.match(s.evidence[1], /^Titles promising a number the page doesn't deliver: 1 of 4 — \/ten-ways promises 10, the page has 4 sections or list items$/);
  const kept = scoreBehaviorPromise(buildRankingContext(rankingInput({ pages: [contentPage("/ten-ways", { titleNumber: 10, h2Count: 12 })] })));
  assert.equal(kept.score, 100);
  assert.equal(kept.summary, "Your titles promise what the pages deliver");
  const offTopic = scoreBehaviorPromise(
    buildRankingContext(
      rankingInput({
        pages: [contentPage("/crawl-budget-explained", { leadText: "welcome to our blog", clickbaitHits: 2 }, { h1s: ["Welcome"], headings: [{ level: 2, text: "Intro" }] })],
      }),
    ),
  );
  assert.equal(offTopic.score, 30);
  assert.equal(offTopic.summary, "Some titles promise more than the page delivers");
});
