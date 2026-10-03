/* SEO Ranking Score 测试(v2:7 支柱 · 40 小维度 · 站点类型权重):npx tsx --test lib/seo-audit/tests/ranking.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PILLAR_IDS,
  RANKING_PILLARS,
  RANKING_SUBS,
  SITE_PROFILE_SUB_WEIGHTS,
  SITE_PROFILE_WEIGHTS,
  type CrawledPage,
  type GscData,
  type PillarId,
  type RankingFramework,
  type SeoAuditResult,
  type SiteProfileId,
  type SubScore,
} from "../types";
import { runAllOnsiteChecks } from "../checks";
import { gradeFor, overallScore, scoreDimensions } from "../score";
import {
  absorption,
  anchorPoints,
  applyProfileSubWeights,
  brandDemandPoints,
  buildRankingContext,
  citabilityParts,
  competitorWeakSpots,
  computeRanking,
  coreVocabulary,
  ctrPoints,
  dataPoints,
  deliveredCount,
  detectSiteProfile,
  difficultyPoints,
  expectedCtr,
  experiencePoints,
  findTopicClusters,
  fleschPoints,
  gainPoints,
  gapPoints,
  inboundPoints,
  isContentPage,
  isYmylPage,
  keywordKey,
  momentumFromChange,
  recomputeRankingFromResult,
  reputationScore,
  scoreAiSearchCitability,
  scoreAiSearchCrawlers,
  scoreAiSearchOverview,
  scoreAiSearchZeroClick,
  scoreAuthorityBreadth,
  scoreAuthorityClusters,
  scoreAuthorityEditorial,
  scoreAuthorityEntity,
  scoreAuthorityFocus,
  scoreAuthorityInternal,
  scoreAuthorityLinkProfile,
  scoreAuthorityReputation,
  scoreBehaviorCtr,
  scoreBehaviorPromise,
  scoreBehaviorReadability,
  scoreBehaviorRealUser,
  scoreBehaviorTask,
  scoreQualityAuthorship,
  scoreQualityData,
  scoreQualityExperience,
  scoreQualityFreshness,
  scoreQualityScaled,
  scoreQualitySources,
  scoreRelevanceAlignment,
  scoreRelevanceCannibalization,
  scoreRelevanceCoverage,
  scoreRelevanceGain,
  scoreRelevanceIntent,
  scoreWinnabilityDifficulty,
  scoreWinnabilityGap,
  scoreWinnabilityMomentum,
  scoreWinnabilitySerpWeakness,
  scoreWinnabilityStriking,
  sourcesTerms,
  strikingPoints,
  weakSpotPoints,
  type RankingInput,
} from "../ranking";
import { HOST, abs, brokenSite, makePage, makeProbe, makePsi, minhashFor } from "./fixtures";
import {
  NOW,
  aiCrawlerVerdicts,
  competitor,
  contentPage,
  isoBefore,
  makeAuthority,
  makeContent,
  makeGsc,
  makePair,
  makeRelevance,
  makeReputation,
  makeVisibility,
  rankingInput,
  robotsMetaWith,
  strongInput,
  weakAiInput,
} from "./ranking-fixtures";

/** 计分函数可按数据来源改写可信度的小维度(规格 v2 §2:有 Search Console 时 measured,否则 estimated) */
const CONFIDENCE_OVERRIDABLE = new Set(["relevance.cannibalization", "winnability.momentum"]);

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

const ctxOf = (over: Partial<RankingInput> & { pages: CrawledPage[] }) => buildRankingContext(rankingInput(over));

/** 规格 v2 §1:站点类型覆盖个别小维度权重,同支柱其余小维度按比例压缩(保留 1 位小数)—— 测试里独立再算一遍 */
function expectedWeight(profile: SiteProfileId, id: string): number {
  const meta = RANKING_SUBS.find((m) => m.id === id)!;
  const over = SITE_PROFILE_SUB_WEIGHTS[profile] ?? {};
  const mine = RANKING_SUBS.filter((m) => m.pillar === meta.pillar);
  const hit = mine.filter((m) => typeof over[m.id] === "number");
  if (!hit.length) return meta.weight;
  if (typeof over[id] === "number") return over[id];
  const total = mine.reduce((n, m) => n + m.weight, 0);
  const fixed = hit.reduce((n, m) => n + over[m.id], 0);
  const rest = total - hit.reduce((n, m) => n + m.weight, 0);
  return Math.round(((meta.weight * (total - fixed)) / rest) * 10) / 10;
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

/** 一个场景下所有输出都要满足的契约(条数、取整、文案三态、元数据与 RANKING_SUBS / 站点类型权重一致) */
function assertContract(r: RankingFramework, input: RankingInput, label: string): void {
  assert.equal(r.version, 2, `${label}: version`);
  assert.ok(r.profile, `${label}: profile`);
  const profile = r.profile;
  assert.equal(profile.label, SITE_PROFILE_WEIGHTS[profile.id].label);
  assert.deepEqual(profile.weights, SITE_PROFILE_WEIGHTS[profile.id].weights, `${label}: profile weights`);
  assert.equal(Object.values(profile.weights).reduce((a, b) => a + b, 0), 100, `${label}: profile weights sum to 100`);
  assert.ok(profile.reason.trim().length > 0 && !/\.$/.test(profile.reason), `${label}: profile reason`);
  assert.deepEqual(r.pillars.map((p) => p.id), [...PILLAR_IDS], `${label}: pillar order`);
  const subs = r.pillars.flatMap((p) => p.subs);
  assert.deepEqual(subs.map((s) => s.id), RANKING_SUBS.map((s) => s.id), `${label}: every RANKING_SUBS id exactly once, in order`);
  assert.equal(new Set(subs.map((s) => s.id)).size, RANKING_SUBS.length);
  for (const s of subs) {
    const meta = RANKING_SUBS.find((m) => m.id === s.id)!;
    assert.equal(s.pillar, meta.pillar, `${label}: ${s.id} pillar`);
    assert.equal(s.label, meta.label);
    assert.equal(s.weight, expectedWeight(profile.id, s.id), `${label}: ${s.id} weight`);
    if (CONFIDENCE_OVERRIDABLE.has(s.id)) assert.ok(s.confidence === "measured" || s.confidence === "estimated", `${label}: ${s.id} confidence`);
    else assert.equal(s.confidence, meta.confidence, `${label}: ${s.id} confidence`);
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
      assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b|\bInfinity\b|\[object/.test(t), `${label}: ${s.id} leaked a raw value: ${t}`);
    }
  }
  for (const p of r.pillars) {
    const meta = RANKING_PILLARS[p.id];
    assert.equal(p.label, meta.label);
    assert.equal(p.role, meta.role);
    assert.equal(p.weight, profile.weights[p.id], `${label}: ${p.id} weight from the profile`);
    // 一句话(小维度标签里的 "vs." 不算句号)
    assert.ok(p.summary.trim().length > 0 && !/\.\s/.test(p.summary.replace(/\bvs\.\s/g, "vs ")), `${label}: ${p.id} summary is one sentence`);
    if (p.id === "technical") {
      assert.equal(p.score, input.technical.score, `${label}: technical pillar = free technical score`);
      assert.equal(p.grade, input.technical.grade);
      continue;
    }
    if (p.score === null) {
      assert.equal(p.grade, null);
      // 站长 2026-10-02:支柱至少要 MIN_MEASURED_SUBS(2)个小维度测到才算分
      assert.ok(p.subs.filter((s) => s.score !== null).length < 2, `${label}: ${p.id} null only when fewer than 2 subs are measured`);
    } else {
      assert.ok(p.subs.filter((s) => s.score !== null).length >= 2, `${label}: ${p.id} scored only with 2+ measured subs`);
      assert.ok(Number.isInteger(p.score) && p.score >= 0 && p.score <= 100);
      assert.equal(p.grade, gradeFor(p.score));
      const scored = p.subs.filter((s) => s.score !== null);
      const w = scored.reduce((n, s) => n + s.weight, 0);
      assert.equal(p.score, Math.round(scored.reduce((n, s) => n + s.weight * (s.score as number), 0) / w), `${label}: ${p.id} renormalised weighting`);
    }
  }
  const scoredPillars = r.pillars.filter((p) => p.score !== null);
  const pw = scoredPillars.reduce((n, p) => n + p.weight, 0);
  const raw = Math.round(scoredPillars.reduce((n, p) => n + p.weight * (p.score as number), 0) / pw);
  assert.ok(Number.isInteger(r.overall.score) && r.overall.score >= 0 && r.overall.score <= 100);
  assert.equal(r.overall.score, r.overall.capped ? Math.min(raw, 40) : raw, `${label}: overall = profile-weighted pillar average`);
  assert.equal(r.overall.capped, input.technical.blockers.length > 0);
  assert.equal(r.overall.grade, r.overall.capped ? "F" : gradeFor(r.overall.score));
  assert.equal(r.basis.gscConnected, !!input.gsc, `${label}: gscConnected`);
  assert.ok(Array.isArray(r.basis.targetKeywords));
  for (const q of r.basis.queries) assert.ok(q.source === "target" || q.source === "ranking" || q.source === "page-topic", `${label}: query source`);
  for (const s of subs.filter((x) => x.score === null)) assert.ok(r.notes.some((n) => n.startsWith(s.label)), `${label}: note for null ${s.id}`);
}

/* ============================================================
   场景
   ============================================================ */

test("v2 shape: version 2, 7 pillars in PILLAR_IDS order, all 40 RANKING_SUBS exactly once in every scenario", () => {
  assert.equal(RANKING_SUBS.length, 40);
  for (const [label, make] of [
    ["strong", strongInput],
    ["weak", weakAiInput],
    ["null-data", nullDataInput],
    ["gate", gatedInput],
    ["empty", () => rankingInput({ pages: [] })],
  ] as const) {
    const input = make();
    const r = computeRanking(input);
    assert.equal(r.version, 2);
    assert.equal(r.pillars.length, 7);
    assertContract(r, input, label);
  }
});

test("strong site scores ≥80 overall with every one of the 40 sub-scores measured", () => {
  const input = strongInput();
  const r = computeRanking(input);
  assertContract(r, input, "strong");
  assert.ok(r.overall.score >= 80, `overall ${r.overall.score}`);
  assert.ok(r.overall.grade === "A" || r.overall.grade === "B");
  assert.equal(r.overall.capped, false);
  assert.equal(r.overall.note, "Based on all 40 sub-scores");
  assert.ok(r.pillars.flatMap((p) => p.subs).every((s) => s.score !== null), "nothing missing on the strong site");
  for (const id of PILLAR_IDS) assert.ok((pillar(r, id).score as number) >= 80, `${id} = ${pillar(r, id).score}`);
  assert.equal(r.notes.length, 0);
  assert.equal(r.profile?.id, "default");
  // basis:可读页、内容页、查询(v2 带 source)、实际抓到的竞品(按 URL 去重;v2 夹具里多了一个 reddit 结果 → 6)
  assert.equal(r.basis.pagesAnalyzed, input.pages.length);
  assert.equal(r.basis.contentPages, 14);
  assert.deepEqual(r.basis.queries.map((q) => q.query), ["how to fix crawl errors", "schema markup basics", "speed up lcp"]);
  assert.deepEqual(r.basis.queries[0], { query: "how to fix crawl errors", url: abs("/blog/crawl-errors-fix"), position: 4, volume: 880, intent: "informational", source: "ranking" });
  assert.equal(r.basis.competitorsCompared, 6);
  assert.equal(r.basis.gscConnected, true);
  assert.deepEqual(r.basis.targetKeywords, []);
  assert.deepEqual(r.basis.sitemapFocus, { considered: 3, offTopic: 1, examples: ["/blog/best-pizza-in-naples"] });
  assert.equal(sub(r, "quality.experience").summary, "All 14 content pages show first-hand experience");
  assert.equal(sub(r, "authority.breadth").score, 78, "breadth = authority.score");
  // 两个新支柱的说法
  assert.match(pillar(r, "winnability").summary, /^(These look like fights you can win|Mostly winnable fights)/);
  assert.match(pillar(r, "aisearch").summary, /^(Your rankings should still earn visits|Rankings should still earn visits)/);
});

test("weak scaled-AI site scores under 40: scaled-content risk and first-hand experience score low", () => {
  const input = weakAiInput();
  const r = computeRanking(input);
  assertContract(r, input, "weak");
  assert.ok(r.overall.score < 40, `overall ${r.overall.score}`);
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
  assert.equal(sub(r, "relevance.intent").summary, "1 of 1 query lands on the wrong kind of page for what searchers want");
  assert.match(sub(r, "relevance.intent").fixes[0], /^Turn \/guides\/best-crm-for-dentists into a side-by-side comparison/);
  assert.match(sub(r, "authority.entity").summary, /doesn't match your domain example\.com/);
  assert.match(sub(r, "behavior.promise").evidence[1], /promises 10, the page has 2 sections or list items/);
  // 新维度在弱站上也该是低分
  assert.equal(sub(r, "quality.sources").score, 0);
  assert.equal(sub(r, "authority.reputation").score, 0);
  assert.equal(sub(r, "aisearch.citability").score, 0);
  assert.equal(sub(r, "aisearch.overview").score, 0);
  assert.equal(sub(r, "winnability.difficulty").score, 10);
  assert.equal(sub(r, "behavior.ctr").summary, "Not measured: connect Search Console");
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
  assert.ok(compared >= 25, `compared ${compared} sub-scores across the threshold`);
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
  const nulls = [
    "relevance.intent", "relevance.coverage", "relevance.gain", "relevance.alignment",
    "authority.editorial", "authority.breadth", "authority.linkprofile",
    "winnability.serpweakness", "winnability.difficulty", "winnability.gap", "winnability.striking",
    "aisearch.overview", "aisearch.zeroclick",
  ];
  for (const id of nulls) {
    const s = sub(r, id);
    assert.equal(s.score, null, `${id} null`);
    assert.match(s.summary, /^Not measured: /);
  }
  assert.equal(sub(r, "relevance.intent").summary, "Not measured: the search-query comparison did not run for this report");
  assert.equal(sub(r, "authority.breadth").summary, "Not measured: backlink data was not available for this report");
  // 一个意图一页不依赖相关性分析(内容页 + Search Console),但支柱至少要 2 个小维度测到才算分(站长 2026-10-02):
  // 只剩它一个时相关性支柱为 null,不让一个 100 分撑起整个支柱
  assert.equal(sub(r, "relevance.cannibalization").score, 100);
  assert.equal(pillar(r, "relevance").score, null);
  assert.equal(pillar(r, "relevance").summary, "Not measured: only 1 of its 5 sub-scores had data — too little to score the pillar");
  assert.ok(r.notes.some((n) => n.startsWith("Relevance & search intent is left out of the overall score: only 1 of its sub-scores could be measured")));
  // 品牌需求不计,按 60 分满额重新归一:实体一致 40 + sameAs 20 → 100
  const entity = sub(r, "authority.entity");
  assert.equal(entity.score, 100);
  assert.ok(entity.evidence.some((e) => e.startsWith("Brand search demand not measured")));
  // 答案前置一项缺失 → 其余三项重新归一
  assert.equal(sub(r, "behavior.task").score, 100);
  // Search Console 还在:动量与点击率照常是实测
  assert.equal(sub(r, "winnability.momentum").confidence, "measured");
  assert.notEqual(sub(r, "behavior.ctr").score, null);
  // 总分 = 有分支柱按站点类型权重重新归一(由 assertContract 逐项核对)
  // 可赢性只剩动量(Search Console)一个小维度 → 同样不计分;其余支柱照常
  assert.deepEqual(r.pillars.filter((p) => p.score !== null).map((p) => p.id), PILLAR_IDS.filter((id) => id !== "relevance" && id !== "winnability"));
  assert.equal(r.overall.note, `Based on ${40 - nulls.length} of 40 sub-scores — ${nulls.length} could not be measured`);
  assert.deepEqual(r.basis.queries, []);
  assert.equal(r.basis.competitorsCompared, 0);
  assert.equal(r.relevance, null);
});

test("no pages at all: content subs are null; with no robots data either, the overall falls back to the technical pillar", () => {
  const bare = rankingInput({ pages: [], psi: { mobile: null, desktop: null }, technical: { score: 72, grade: "B", blockers: [] }, probe: makeProbe([], { robotsMeta: undefined, jsDependent: undefined }) });
  const r = computeRanking(bare);
  assertContract(r, bare, "empty");
  assert.equal(sub(r, "quality.experience").summary, "Not measured: we could not read any pages on the site");
  assert.equal(sub(r, "quality.sources").summary, "Not measured: we could not read any pages on the site, and no outbound links could be tested (we need 5 or more)");
  assert.equal(sub(r, "behavior.realuser").score, null);
  assert.deepEqual(r.pillars.filter((p) => p.score !== null).map((p) => p.id), ["technical"]);
  assert.equal(r.overall.score, 72);
  assert.equal(r.overall.grade, "B");
  // robots.txt 读得到时,AI 爬虫可达性不依赖页面也能测;但 AI 搜索支柱只有它一个小维度,不足 2 个 → 支柱不计分,
  // 总分仍落回技术支柱(站长 2026-10-02:一个小维度不能代表整个支柱)
  const withRobots = rankingInput({ pages: [], psi: { mobile: null, desktop: null }, technical: { score: 72, grade: "B", blockers: [] } });
  const r2 = computeRanking(withRobots);
  assertContract(r2, withRobots, "empty+robots");
  assert.notEqual(sub(r2, "aisearch.crawlers").score, null);
  assert.deepEqual(r2.pillars.filter((p) => p.score !== null).map((p) => p.id), ["technical"]);
  assert.equal(r2.overall.score, 72);
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
  assert.equal(a.version, 2);
  const revived = JSON.parse(JSON.stringify(input)) as RankingInput;
  revived.now = new Date(input.now as Date);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(computeRanking(revived))), JSON.parse(JSON.stringify(a)));
  for (const make of [weakAiInput, gatedInput, nullDataInput]) {
    const x = make();
    assert.deepStrictEqual(computeRanking(x), computeRanking(x));
  }
});

/* ============================================================
   站点类型与权重
   ============================================================ */

test("profile: default / ymyl / local / ecommerce detection, weights from SITE_PROFILE_WEIGHTS (each sums to 100)", () => {
  for (const id of ["default", "ecommerce", "local", "ymyl"] as const) {
    assert.equal(Object.values(SITE_PROFILE_WEIGHTS[id].weights).reduce((a, b) => a + b, 0), 100, `${id} weights sum to 100`);
  }
  const profileOf = (pages: CrawledPage[]) => detectSiteProfile(ctxOf({ pages }));
  const plain = (n: number, from = 0) => Array.from({ length: n }, (_, i) => contentPage(`/blog/plain-topic-${from + i}`));
  const home = (over: Partial<CrawledPage> = {}) => makePage({ url: abs("/"), depth: 0, pageType: "home", content: makeContent(), ...over });

  // default:强站
  const d = detectSiteProfile(buildRankingContext(strongInput()));
  assert.equal(d.id, "default");
  assert.equal(d.label, "Business, SaaS or publisher site");
  assert.equal(d.reason, "No strong signs of an online store, a local business or a health, finance or legal site, so the standard weights apply");

  // ymyl:YMYL 内容页 ≥30%
  const ymyl = profileOf([contentPage("/blog/mortgage-rates", { ymylHits: 6 }), contentPage("/blog/tax-deductions", { ymylHits: 6 }), ...plain(2)]);
  assert.equal(ymyl.id, "ymyl");
  assert.equal(ymyl.reason, "2 of 4 content pages (50%) cover health, money or legal topics, which Google holds to a stricter standard");
  assert.deepEqual(ymyl.weights, SITE_PROFILE_WEIGHTS.ymyl.weights);
  assert.equal(profileOf([...[1, 2, 3].map((i) => contentPage(`/blog/loan-${i}`, { ymylHits: 6 })), ...plain(7)]).id, "ymyl", "3 of 10 = 30%");
  assert.equal(profileOf([...[1, 2].map((i) => contentPage(`/blog/loan-${i}`, { ymylHits: 6 })), ...plain(8)]).id, "default", "2 of 10 = 20%");

  // local:入口页有 LocalBusiness 系 schema
  const dentist = profileOf([home({ jsonLdTypes: ["Dentist", "WebSite"] }), ...plain(3)]);
  assert.equal(dentist.id, "local");
  assert.equal(dentist.label, "Local business");
  assert.equal(dentist.reason, "Your homepage is marked up as a local business (Dentist structured data)");
  // local:≥2 个可读页有 LocalBusiness 系 schema
  const locations = profileOf([home(), makePage({ url: abs("/locations/austin"), jsonLdTypes: ["LocalBusiness"] }), makePage({ url: abs("/locations/dallas"), jsonLdTypes: ["LocalBusiness"] }), ...plain(3)]);
  assert.equal(locations.id, "local");
  assert.equal(locations.reason, "2 pages are marked up as a local business (LocalBusiness structured data on /locations/austin, /locations/dallas)");
  // 站长 2026-10-02:只认 LocalBusiness 系结构化数据 —— 页脚有公司地址与客服电话的 SaaS 不是本地商家
  const phone = (p: CrawledPage): CrawledPage => ({ ...p, content: { ...p.content!, contactDetails: { email: false, phone: true, address: false } } });
  const homeContact = home({ content: makeContent({ contactDetails: { email: true, phone: true, address: true } }) });
  assert.equal(profileOf([homeContact, ...plain(9).map(phone)]).id, "default", "address + phone everywhere, but no LocalBusiness schema");

  // ecommerce:Product / Offer schema ≥20% 可读页
  const products = (n: number, from = 0) => Array.from({ length: n }, (_, i) => makePage({ url: abs(`/item-${from + i}`), jsonLdTypes: ["Product", "Offer"] }));
  const shop = profileOf([...products(2), ...plain(8)]);
  assert.equal(shop.id, "ecommerce");
  assert.equal(shop.label, "Online store");
  assert.equal(shop.reason, "2 of 10 pages we read carry product or offer structured data");
  assert.equal(profileOf([...products(5), ...plain(25)]).id, "ecommerce", "5 pages is enough even under 20%");
  // SaaS 全站布局里的 SoftwareApplication + Offer 不算商品
  const saas = Array.from({ length: 10 }, (_, i) => makePage({ url: abs(`/feature-${i}`), jsonLdTypes: ["SoftwareApplication", "Offer"] }));
  assert.equal(profileOf(saas).id, "default");
  // ecommerce:classifyFormat = product 的页 ≥20%,且站内有购物车 / 结账入口(SaaS 的 /product/ 功能页没有)
  const withCart = (p: CrawledPage): CrawledPage => ({ ...p, links: [...(p.links ?? []), abs("/cart")] });
  const productPages = profileOf([makePage({ url: abs("/p/widget-a"), pageType: "product" }), makePage({ url: abs("/p/widget-b"), pageType: "product" }), ...plain(8).map(withCart)]);
  assert.equal(productPages.id, "ecommerce");
  assert.equal(productPages.reason, "2 of 10 pages we read are product pages, and the site has a cart or checkout");
  assert.equal(
    profileOf([makePage({ url: abs("/p/widget-a"), pageType: "product" }), makePage({ url: abs("/p/widget-b"), pageType: "product" }), ...plain(8)]).id,
    "default",
    "product-looking pages without a cart or product schema are a SaaS feature section"
  );
  // ecommerce:路径 /products/ /shop/ /collections/ ≥20%,且有购物车 / 结账入口
  const paths = profileOf([makePage({ url: abs("/collections/summer") }), makePage({ url: abs("/products/hat") }), ...plain(8).map(withCart)]);
  assert.equal(paths.id, "ecommerce");
  assert.equal(paths.reason, "2 of 10 pages we read sit under /products/, /shop/ or /collections/, and the site has a cart or checkout");
  assert.equal(profileOf([makePage({ url: abs("/product/analytics") }), makePage({ url: abs("/product/alerts") }), ...plain(8)]).id, "default", "SaaS /product/ pages");

  // 优先级:ymyl > local > ecommerce
  assert.equal(profileOf([home({ jsonLdTypes: ["Dentist"] }), contentPage("/blog/dental-insurance", { ymylHits: 8 }), ...plain(1)]).id, "ymyl");
  assert.equal(profileOf([home({ jsonLdTypes: ["Store"] }), ...products(3), ...plain(3)]).id, "local");
});

test("profile weights drive the pillars; local sets authority.reputation to 25 and compresses the rest of the pillar", () => {
  const pages = [makePage({ url: abs("/"), depth: 0, pageType: "home", jsonLdTypes: ["Dentist"], content: makeContent() }), ...Array.from({ length: 6 }, (_, i) => contentPage(`/blog/teeth-care-${i}`))];
  const input = rankingInput({ pages, reputation: makeReputation(), authority: makeAuthority(), visibility: makeVisibility() });
  const r = computeRanking(input);
  assertContract(r, input, "local");
  assert.equal(r.profile?.id, "local");
  for (const id of PILLAR_IDS) assert.equal(pillar(r, id).weight, SITE_PROFILE_WEIGHTS.local.weights[id]);
  const authority = pillar(r, "authority").subs;
  assert.deepEqual(
    authority.map((s) => [s.id, s.weight]),
    [
      ["authority.editorial", 15.7],
      ["authority.breadth", 15.7],
      ["authority.linkprofile", 8.7],
      ["authority.clusters", 8.7],
      ["authority.focus", 10.5],
      ["authority.internal", 8.7],
      ["authority.entity", 7],
      ["authority.reputation", 25],
    ],
  );
  assert.ok(Math.abs(authority.reduce((n, s) => n + s.weight, 0) - 100) < 0.05, "the pillar still sums to 100");
  assert.match(r.overall.note, /^Scored as a local business; based on \d+ of 40 sub-scores/);
  // 其他类型不改小维度权重
  const subs = computeRanking(strongInput()).pillars.flatMap((p) => p.subs);
  assert.deepEqual(applyProfileSubWeights(subs, "ecommerce").map((s) => s.weight), RANKING_SUBS.map((m) => m.weight));
  // 网店 / YMYL 的总分说明
  const shop = rankingInput({ pages: [...Array.from({ length: 3 }, (_, i) => makePage({ url: abs(`/item-${i}`), jsonLdTypes: ["Product"] })), ...Array.from({ length: 7 }, (_, i) => contentPage(`/blog/guide-${i}`))] });
  assert.match(computeRanking(shop).overall.note, /^Scored as an online store; based on/);
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
  assert.equal(ctx.home?.url, abs("/"), "the entry page is the home page");
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

const PHONETIC = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo"];

function cannibalSite(): { pages: CrawledPage[]; visibility: ReturnType<typeof makeVisibility> } {
  // 18 个主题各异的内容页 + 2 个标题主题相同、形态相同的内容页 = 20
  const pages = [...PHONETIC.map((w) => contentPage(`/blog/${w}-workflow`)), contentPage("/blog/seo-audit-checklist"), contentPage("/blog/seo-audit-checklists")];
  const visibility = makeVisibility({
    topKeywords: [
      { keyword: "alpha workflow", position: 5, volume: 300, etv: 10, url: abs("/blog/alpha-workflow"), intent: "informational", cpc: 1 },
      // 同一个搜索(复数)落在首页:alpha-workflow 也在跟首页抢
      { keyword: "alpha workflows", position: 9, volume: 90, etv: 2, url: abs("/"), intent: "informational", cpc: 1 },
    ],
  });
  return { pages, visibility };
}

test("relevance.cannibalization: title + format overlaps and split ranking keywords; share 0.15 → 50", () => {
  assert.equal(keywordKey("SEO audits"), keywordKey("audit for seo"));
  assert.notEqual(keywordKey("best crm"), keywordKey("crm"), "best changes the intent");
  const { pages, visibility } = cannibalSite();
  const s = scoreRelevanceCannibalization(ctxOf({ pages, visibility }));
  // 3 / 20 = 0.15 → 100 − 0.15 / 0.3 × 100
  assert.equal(s.score, 50);
  assert.equal(s.confidence, "estimated");
  assert.equal(s.summary, "3 of 20 content pages compete with another page for the same search, so Google has to choose between them");
  assert.deepEqual(s.evidence, [
    "3 of 20 content pages (15%) compete with another page for the same search",
    'Google ranks /blog/alpha-workflow for "alpha workflow" and / for "alpha workflows" — the same search worded differently',
    '/blog/seo-audit-checklist, /blog/seo-audit-checklists target the same topic ("seo audit") with the same format (lists of options)',
    "Estimated from your titles and ranking keywords — connect Search Console to see which searches really split between pages",
  ]);
  // 另一方是首页:不建议把首页合并掉
  assert.equal(s.fixes[0], 'Pick one page to rank for "alpha workflow": keep it on /blog/alpha-workflow and have / link there with that phrase instead of covering the same search');
  // 没有重叠 → 100
  assert.equal(scoreRelevanceCannibalization(ctxOf({ pages: pages.slice(0, 18) })).score, 100);
  // 只有 1 个内容页 → null
  const one = scoreRelevanceCannibalization(ctxOf({ pages: [contentPage("/blog/a")] }));
  assert.equal(one.score, null);
  assert.equal(one.summary, "Not measured: only 1 content page (/blog/a), so no two pages can compete for the same search");
});

test("relevance.cannibalization with Search Console: real impression splits count and the confidence becomes measured", () => {
  const { pages, visibility } = cannibalSite();
  const gsc = makeGsc({
    cannibalized: [
      {
        query: "bravo workflow",
        impressions: 400,
        pages: [
          { page: abs("/blog/bravo-workflow"), clicks: 20, impressions: 260 },
          { page: abs("/blog/charlie-workflow"), clicks: 5, impressions: 120 },
          // 5% 的曝光不算"分走"
          { page: abs("/blog/delta-workflow"), clicks: 0, impressions: 20 },
        ],
      },
      // query 曝光不足 20 不算
      { query: "tiny query", impressions: 15, pages: [{ page: abs("/blog/echo-workflow"), clicks: 1, impressions: 8 }, { page: abs("/blog/foxtrot-workflow"), clicks: 0, impressions: 7 }] },
    ],
  });
  const s = scoreRelevanceCannibalization(ctxOf({ pages, visibility, gsc }));
  // 5 / 20 = 0.25 → 100 − 83.3
  assert.equal(s.score, 17);
  assert.equal(s.confidence, "measured");
  assert.equal(s.evidence[1], 'Search Console: impressions for "bravo workflow" are split between /blog/bravo-workflow (65%) and /blog/charlie-workflow (30%)');
  assert.equal(s.fixes[0], "Merge /blog/charlie-workflow into /blog/bravo-workflow and 301-redirect it, or rewrite one of them to answer a different question");
  assert.ok(!s.evidence.some((e) => e.includes("tiny query")));
  // null 时可信度同样跟着数据源走
  assert.equal(scoreRelevanceCannibalization(ctxOf({ pages: [contentPage("/blog/a")], gsc })).confidence, "measured");
  // 品牌词在首页与关于页之间分曝光是站点链接的正常形态;不涉及任何内容页的组(首页 vs 定价页)也不算
  const normal = makeGsc({
    cannibalized: [
      { query: "example", impressions: 900, pages: [{ page: abs("/"), clicks: 500, impressions: 700 }, { page: abs("/about"), clicks: 20, impressions: 200 }] },
      { query: "seo audit pricing", impressions: 300, pages: [{ page: abs("/"), clicks: 9, impressions: 180 }, { page: abs("/pricing"), clicks: 6, impressions: 120 }] },
    ],
  });
  const brandVis = makeVisibility({
    topKeywords: [
      { keyword: "example", position: 1, volume: 900, etv: 1, url: abs("/"), intent: "navigational", cpc: 0 },
      { keyword: "example", position: 2, volume: 900, etv: 1, url: abs("/blog/alpha-workflow"), intent: "navigational", cpc: 0 },
    ],
  });
  const clean = scoreRelevanceCannibalization(ctxOf({ pages: pages.slice(0, 18), gsc: normal, visibility: brandVis }));
  assert.equal(clean.score, 100);
  assert.deepEqual(clean.evidence, ["None of your 18 content pages compete with another page for the same search"]);
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

test("quality.sources: broken outbound 50 + outdated data 30 + unsourced pages 20, renormalised when a part has no denominator", () => {
  assert.deepEqual(sourcesTerms({ brokenShare: 0.1, staleShare: 0.5, unsourcedShare: 0.25 }), { broken: 25, stale: 15, unsourced: 15 });
  assert.equal(sourcesTerms({ brokenShare: 0.4, staleShare: null, unsourcedShare: 0 }).broken, 0, "20%+ broken → 0");
  const pages = [
    contentPage("/a", { bodyYears: [2019, 2022], outboundLinks: 4 }),
    contentPage("/b", { bodyYears: [2021, 2023], outboundLinks: 0 }),
    contentPage("/c", { bodyYears: [2025], outboundLinks: 3 }),
    contentPage("/d", { bodyYears: [2024, 2026], outboundLinks: 5 }),
  ];
  const broken = [
    { from: abs("/a"), to: "https://gone.example.org/x", status: 404 },
    { from: abs("/c"), to: "https://gone.example.org/y", status: null },
  ];
  const s = scoreQualitySources(ctxOf({ pages, probe: makeProbe(pages, { outboundChecked: 20, brokenOutbound: broken }) }));
  // 失效 2/20 = 10% → 25;过时(最新年份 ≤ 2023)2/4 → 15;无来源 1/4 → 15
  assert.equal(s.score, 55);
  assert.equal(s.summary, "10% of the outbound links we tested are broken");
  assert.deepEqual(s.evidence, [
    "Broken outbound links: 2 of 20 we tested (10%) — e.g. /a links to https://gone.example.org/x (HTTP 404)",
    "Pages where the newest year mentioned is 2023 or earlier: 2 of 4 pages that mention a year (e.g. /a — newest 2022)",
    "Content pages that link to no outside source: 1 of 4 (/b)",
  ]);
  assert.equal(s.fixes[0], "Fix or remove 2 broken outbound links — start with /a → https://gone.example.org/x");
  // 测过的外链不到 5 条:失效项不计,(15 + 15) / 50
  assert.equal(scoreQualitySources(ctxOf({ pages, probe: makeProbe(pages, { outboundChecked: 4, brokenOutbound: broken }) })).score, 60);
  // 没有页提到年份:过时项不计,(25 + 15) / 70
  const noYears = pages.map((p) => ({ ...p, content: { ...p.content!, bodyYears: [] } }));
  assert.equal(scoreQualitySources(ctxOf({ pages: noYears, probe: makeProbe(noYears, { outboundChecked: 20, brokenOutbound: broken }) })).score, 57);
  // 三项都没有分母 → null
  const none = scoreQualitySources(ctxOf({ pages: [], probe: makeProbe([], { outboundChecked: 0 }) }));
  assert.equal(none.score, null);
  assert.equal(none.summary, "Not measured: we could not read any pages on the site, and no outbound links could be tested (we need 5 or more)");
});

/* ============================================================
   权威、外链与声誉
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

test("authority.linkprofile: growth 40 × new / (new + lost) + anchors 30 / 15 / 0 + deep links 30 × share, renormalised", () => {
  assert.deepEqual([0.4, 0.41, 0.6, 0.61].map(anchorPoints), [30, 15, 15, 0]);
  const authority = makeAuthority({
    anchors: [
      { anchor: "Example", backlinks: 100, referringDomains: 10 },
      { anchor: "best seo audit tool", backlinks: 300, referringDomains: 10 },
    ],
  });
  const visibility = makeVisibility({
    topKeywords: [
      { keyword: "example", position: 1, volume: 1000, etv: 1, url: abs("/"), intent: "navigational", cpc: 0, pageReferringDomains: 500 },
      { keyword: "seo audit tool", position: 4, volume: 500, etv: 1, url: abs("/a"), intent: "commercial", cpc: 1, pageReferringDomains: 3 },
      { keyword: "audit checklist", position: 8, volume: 300, etv: 1, url: abs("/b"), intent: "informational", cpc: 1, pageReferringDomains: 0 },
      // null = 供应商没有这页的外链记录 → 不进分母
      { keyword: "audit template", position: 12, volume: 200, etv: 1, url: abs("/c"), intent: "informational", cpc: 1, pageReferringDomains: null },
      { keyword: "seo audit tools", position: 9, volume: 100, etv: 1, url: abs("/a"), intent: "commercial", cpc: 1, pageReferringDomains: 0 },
    ],
  });
  const s = scoreAuthorityLinkProfile(ctxOf({ pages: [], authority, visibility }));
  // 增速 55/77 × 40 = 28.6;关键词锚占引荐域 50% → 15;有外链的排名页 1/2 → 15
  assert.equal(s.score, 59);
  assert.deepEqual(s.evidence, [
    "Last 90 days: 55 new vs 22 lost referring domains — 71% of the movement is growth",
    'Most-used keyword anchor: "best seo audit tool" on 50% of linking domains; brand and URL anchors make up 50%',
    "Ranking pages (other than the homepage) with backlinks of their own: 1 of 2 — none for /b",
  ]);
  assert.equal(s.summary, 'One keyword anchor ("best seo audit tool") dominates your backlinks — a pattern Google treats as manipulative');
  assert.equal(s.fixes.length, 3);
  // 没有排名数据:深链项不计,(28.6 + 15) / 70
  assert.equal(scoreAuthorityLinkProfile(ctxOf({ pages: [], authority })).score, 62);
  const none = scoreAuthorityLinkProfile(ctxOf({ pages: [] }));
  assert.equal(none.score, null);
  assert.equal(none.summary, "Not measured: backlink data was not available for this report");
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

/** 主题聚焦夹具:首页定义核心主题(烘焙),内容页都在深度 2 且互不链接,所以核心词汇只来自首页 */
function bakerySite(): CrawledPage[] {
  const home = makePage({
    url: abs("/"), depth: 0, pageType: "home", title: "Sourdough baking supplies and recipes — Example", h1s: ["Sourdough baking supplies"],
    description: "Starter kits, flour and proofing baskets for home bakers.", links: [], content: makeContent({ titleBrand: "Example" }),
  });
  return [home, ...["sourdough-starter-guide", "flour-types-compared", "proofing-basket-care", "office-chair-reviews"].map((s) => contentPage(`/blog/${s}`, {}, { links: [] }))];
}

const BAKERY_SITEMAP = [
  abs("/recipes/sourdough-pizza-dough"),
  abs("/shop/proofing-baskets"),
  abs("/recipes/whole-wheat-flour-bread"),
  abs("/recipes/rye-starter-feeding"),
  abs("/guides/banneton-proofing-basket-sizes"),
  abs("/blog/crypto-tax-tips"),
  abs("/blog/sourdough-starter-guide"), // 已抓到 → 不重复计
  abs("/tag/sourdough-tips"), // 标签页
  abs("/blog/page/3"), // 分页
  abs("/privacy-policy"), // 法律页
  abs("/careers/head-baker"), // 公司功能页
  abs("/about"), // slug 只有 1 个词
  abs("/images/sourdough-loaf.jpg"), // 不是页面
  "https://cdn.other.com/blog/sourdough-bread-tips", // 别的站
];

test("authority.focus: off-topic share across crawled pages + sitemap URLs; share 0.2 → 60; stored sitemap counts reproduce it", () => {
  const pages = bakerySite();
  const ctx = ctxOf({ pages, sitemapUrls: BAKERY_SITEMAP });
  assert.deepEqual(Array.from(coreVocabulary(ctx).keys()).sort(), ["baker", "baking", "basket", "flour", "kit", "proofing", "recipe", "sourdough", "starter", "supply"]);
  const s = scoreAuthorityFocus(ctx);
  // 4 个已抓内容页 + 6 条 sitemap URL,跑题 2(办公椅评测、加密货币报税)→ 0.2 / 0.5 → 100 × (1 − 0.4)
  assert.equal(s.score, 60);
  assert.equal(s.confidence, "estimated");
  assert.deepEqual(s.evidence, [
    "Core topics (from your homepage and most-linked pages): baker, baking, basket, flour, kit, proofing, recipe, sourdough",
    "Off-topic: 2 of 10 pages share no topic word with them (4 crawled content pages + 6 more from your sitemap)",
    "Off-topic examples: /blog/office-chair-reviews, /blog/crypto-tax-tips",
  ]);
  assert.equal(s.summary, "2 of 10 pages (20%) are off your core topics, which blurs what Google thinks the site is about");
  // computeRanking 把 sitemap 那部分存进 basis;重算时只给这份计数,结果逐字相同
  const r = computeRanking(rankingInput({ pages, sitemapUrls: BAKERY_SITEMAP }));
  assert.deepEqual(r.basis.sitemapFocus, { considered: 6, offTopic: 1, examples: ["/blog/crypto-tax-tips"] });
  assert.deepStrictEqual(scoreAuthorityFocus(ctxOf({ pages, sitemapFocus: r.basis.sitemapFocus })), s);
  // 没有 sitemap 数据:只看已抓内容页(1/4 跑题 → 50)
  assert.equal(scoreAuthorityFocus(ctxOf({ pages })).score, 50);
  // 有 Search Console 时证据另列 0 点击页
  const withGsc = scoreAuthorityFocus(ctxOf({ pages, sitemapUrls: BAKERY_SITEMAP, gsc: makeGsc() }));
  assert.ok(withGsc.evidence.includes("Search Console: 2 of 30 pages with impressions got no clicks in the last 28 days"));
  // 核心词汇不到 5 个词 → null
  const vague = [makePage({ url: abs("/"), depth: 0, pageType: "home", title: "Home — Example", h1s: [], description: "", links: [], content: makeContent({ titleBrand: "Example" }) }), ...pages.slice(1)];
  const none = scoreAuthorityFocus(ctxOf({ pages: vague }));
  assert.equal(none.score, null);
  assert.equal(none.summary, "Not measured: your homepage and main pages name too few topic words (0) to tell what the site is about");
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

test("authority.reputation: brand SERP 35 + reviews 45 + independent mentions 20 − negatives, renormalised without a brand SERP", () => {
  assert.equal(reputationScore(makeReputation()), 100);
  // 本站在前 3 但不是第 1(15)、无知识面板;1 个评价平台 15 + 3.6 分 8;独立提及 2 → 10
  assert.equal(reputationScore(makeReputation({ ownsBrandSerp: false, brandTop3: true, knowledgePanel: false, reviewPlatforms: [{ domain: "trustpilot.com", title: "t", rating: { value: 3.6, votes: 40 } }], independentDomains: 2 })), 48);
  // 品牌词无法判定:其余两项(满分 65)按 100 归一 —— (15 + 8 + 20) / 65
  assert.equal(Math.round(reputationScore(makeReputation({ ownsBrandSerp: null, brandTop3: false, knowledgePanel: false, reviewPlatforms: [{ domain: "trustpilot.com", title: "t", rating: { value: 3.6, votes: 40 } }], independentDomains: 4 }))), 66);
  assert.equal(reputationScore(makeReputation({ negativeSignals: 5 })), 80, "negatives cost at most 20");
  assert.equal(reputationScore(makeReputation({ ownsBrandSerp: false, brandTop3: false, knowledgePanel: false, reviewPlatforms: [], independentDomains: 0, negativeSignals: 2 })), 0, "never below 0");

  const rep = makeReputation({
    reviewPlatforms: [
      { domain: "g2.com", title: "g", rating: { value: 4.2, votes: 10 } },
      { domain: "capterra.com", title: "c", rating: { value: 4.2, votes: 30 } },
    ],
    independentDomains: 3,
    negativeSignals: 1,
  });
  const s = scoreAuthorityReputation(ctxOf({ pages: [], reputation: rep }));
  // 25 + 10 + 30 + 15 + 10 − 10
  assert.equal(s.score, 80);
  assert.equal(s.summary, 'People searching for "Example" find you first and see independent reviews');
  assert.deepEqual(s.evidence, [
    'Searching "example": your site is #1, with a knowledge panel',
    'Review sites for "example reviews": g2.com 4.2★ (10 reviews), capterra.com 4.2★ (30 reviews) — average 4.2★',
    '3 independent sites in the top 10 for "example", plus 2 forum threads (Reddit, Quora …)',
    "1 result for your brand mention scams, complaints or lawsuits",
  ]);
  const nobody = scoreAuthorityReputation(ctxOf({ pages: [], reputation: makeReputation({ ownsBrandSerp: false, brandTop3: false, knowledgePanel: false, reviewPlatforms: [], independentDomains: 1 }) }));
  assert.equal(nobody.score, 0);
  assert.equal(nobody.summary, 'Buyers searching "example reviews" find no reviews of you');
  const none = scoreAuthorityReputation(ctxOf({ pages: [] }));
  assert.equal(none.score, null);
  assert.equal(none.summary, "Not measured: the brand reputation check did not run for this report");
});

/* ============================================================
   可赢性
   ============================================================ */

test("winnability.serpweakness: weak results in the top 5 → 20 / 50 / 80 / 100; 2 weak → 80; own-rank rule adds low-authority", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(weakSpotPoints), [20, 50, 80, 100, 100]);
  const flagged = (flags: string[][]) => flags.map((f, i) => competitor(i + 1, { weakSpots: f }));
  const two = makePair({ query: "crm for dentists", url: abs("/a"), competitors: flagged([["forum"], ["stale"], [], [], []]) });
  const s = scoreWinnabilitySerpWeakness(ctxOf({ pages: [], relevance: makeRelevance([two]) }));
  assert.equal(s.score, 80);
  assert.equal(s.summary, "The top 5 for your queries include beatable pages — 2 weak results per query on average");
  assert.equal(s.evidence[0], '"crm for dentists": 2 of the top 5 are beatable — rival1.com (forum or user-generated page); rival2.com (not updated in 18+ months)');
  // "≤ 本站 rank" 规则:rival1 的 300 ≤ 本站 320 → low-authority
  const close = makePair({ query: "crm pricing", url: abs("/b"), competitors: [1, 2, 3, 4, 5].map((i) => competitor(i, i === 1 ? { domainRank: 300 } : {})) });
  assert.equal(scoreWinnabilitySerpWeakness(ctxOf({ pages: [], relevance: makeRelevance([close]), authority: makeAuthority({ rank: 320 }) })).score, 50);
  assert.equal(scoreWinnabilitySerpWeakness(ctxOf({ pages: [], relevance: makeRelevance([close]) })).score, 20, "no own rank → no extra flag");
  // 多个查询取平均
  assert.equal(scoreWinnabilitySerpWeakness(ctxOf({ pages: [], relevance: makeRelevance([two, close]), authority: makeAuthority({ rank: 320 }) })).score, 65);
  // 只看前 5 名
  const sixth = makePair({ query: "crm", url: abs("/c"), competitors: [...[1, 2, 3, 4, 5].map((i) => competitor(i)), competitor(6, { weakSpots: ["thin"] })] });
  assert.equal(scoreWinnabilitySerpWeakness(ctxOf({ pages: [], relevance: makeRelevance([sixth]) })).score, 20);
  // 已知结果不到 3 个的查询不进平均;一个都没有 → null
  const unknown = makePair({ query: "crm tips", url: abs("/d"), competitors: [1, 2, 3, 4, 5].map((i) => competitor(i, i <= 2 ? {} : { fetched: false, weakSpots: undefined })) });
  const none = scoreWinnabilitySerpWeakness(ctxOf({ pages: [], relevance: makeRelevance([unknown]) }));
  assert.equal(none.score, null);
  assert.equal(none.summary, "Not measured: we could not assess at least 3 of the top 5 results for any of your queries");
  assert.equal(scoreWinnabilitySerpWeakness(ctxOf({ pages: [] })).summary, "Not measured: the search-query comparison did not run for this report");
});

test("winnability weak spots: legacy competitors are flagged by the same rules, flags come out in a stable order", () => {
  const legacy = competitor(1, { weakSpots: undefined, ugc: true, dateModified: isoBefore(600), wordCount: 300, domainRank: 50 });
  assert.deepEqual(competitorWeakSpots(legacy, null, NOW), ["forum", "stale", "thin", "low-authority"]);
  assert.deepEqual(competitorWeakSpots(competitor(1, { weakSpots: undefined, dateModified: isoBefore(500) }), null, NOW), [], "17 months is not stale yet");
  // relevance.ts 给的标记顺序不定 → 输出固定为 forum, stale, thin, off-intent, low-authority
  assert.deepEqual(competitorWeakSpots(competitor(1, { weakSpots: ["low-authority", "off-intent", "forum"] }), null, NOW), ["forum", "off-intent", "low-authority"]);
  assert.deepEqual(competitorWeakSpots(competitor(1, { weakSpots: ["stale"], domainRank: 200 }), 320, NOW), ["stale", "low-authority"]);
});

test("output relevance carries the merged weak spots (own-rank low-authority included) without mutating the input", () => {
  const input = strongInput();
  const before = structuredClone(input);
  const r = computeRanking(input);
  // 强站第 3 个查询的 rival1:domainRank 250 ≤ 本站 320,输入里没有标记
  assert.deepEqual(input.relevance!.pairs[2].competitors[0].weakSpots, []);
  assert.deepEqual(r.relevance!.pairs[2].competitors[0].weakSpots, ["low-authority"]);
  assert.deepEqual(r.relevance!.pairs[0].competitors[0].weakSpots, ["stale"]);
  assert.notEqual(r.relevance, input.relevance, "a copy, not the input object");
  assert.deepStrictEqual(input, before, "input not mutated");
  // 除弱位外,输出的相关性分析与输入一致
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "weakSpots" ? undefined : v)));
  assert.deepStrictEqual(strip(r.relevance), strip(input.relevance));
  // 没评估过的竞品原样保留(不凭空写空数组)
  const unknown = makePair({ query: "q", url: abs("/q"), competitors: [competitor(1, { fetched: false, weakSpots: undefined })] });
  const out = computeRanking(rankingInput({ pages: [], relevance: makeRelevance([unknown]) }));
  assert.equal(out.relevance!.pairs[0].competitors[0].weakSpots, undefined);
});

test("winnability.difficulty: KD vs strength (Domain Rank / 8) bands, volume-weighted; absolute KD bands without a Domain Rank", () => {
  assert.deepEqual([50, 51, 65, 66, 80, 81].map((kd) => difficultyPoints(kd, 40)), [100, 70, 70, 40, 40, 10]);
  assert.deepEqual([30, 31, 45, 46, 60, 61].map((kd) => difficultyPoints(kd, null)), [100, 70, 70, 40, 40, 10]);
  const relevance = makeRelevance([
    makePair({ query: "q1", url: abs("/1"), kd: 45, volume: 1000 }),
    makePair({ query: "q2", url: abs("/2"), kd: 60, volume: 500 }),
    makePair({ query: "q3", url: abs("/3"), kd: 75, volume: 300 }),
    makePair({ query: "q4", url: abs("/4"), kd: 90, volume: null }),
  ]);
  const s = scoreWinnabilityDifficulty(ctxOf({ pages: [], relevance, authority: makeAuthority({ rank: 320 }) }));
  // 强度 40:(1000 × 100 + 500 × 70 + 300 × 40 + 1 × 10) / 1801
  assert.equal(s.score, 82);
  assert.equal(s.evidence[0], "Your strength: Domain Rank 320 ≈ 40/100 on the keyword-difficulty scale");
  assert.equal(s.evidence[1], '"q4" — difficulty 90/100: out of reach for now');
  assert.equal(s.summary, "Most of your queries are within reach for a site of your strength");
  // 强度上限 100
  assert.equal(scoreWinnabilityDifficulty(ctxOf({ pages: [], relevance: makeRelevance([makePair({ query: "q", url: abs("/q"), kd: 100 })]), authority: makeAuthority({ rank: 1000 }) })).score, 100);
  // 没有 Domain Rank:按绝对难度
  const abs2 = makeRelevance([makePair({ query: "a", url: abs("/a"), kd: 25, volume: 100 }), makePair({ query: "b", url: abs("/b"), kd: 50, volume: 100 })]);
  const absolute = scoreWinnabilityDifficulty(ctxOf({ pages: [], relevance: abs2 }));
  assert.equal(absolute.score, 70);
  assert.equal(absolute.summary, "Most of your queries are within reach (judged on absolute difficulty — no Domain Rank available)");
  // 没有任何 KD
  assert.equal(scoreWinnabilityDifficulty(ctxOf({ pages: [], relevance: makeRelevance([makePair({ query: "x", url: abs("/x") })]) })).summary, "Not measured: this report predates keyword difficulty data — re-run it to measure");
  assert.equal(scoreWinnabilityDifficulty(ctxOf({ pages: [], relevance: makeRelevance([makePair({ query: "x", url: abs("/x"), kd: null })]) })).summary, "Not measured: DataForSEO has no keyword difficulty for the queries we analysed");
});

test("winnability.gap: own Domain Rank ÷ ranking sites' authority (top-10 average, else median of the top 5) → 100 / 70 / 40 / 10", () => {
  assert.deepEqual([1, 0.99, 0.6, 0.59, 0.3, 0.29].map(gapPoints), [100, 70, 70, 40, 40, 10]);
  const ranks = [200, 900, 1500, 400, 1000];
  const relevance = makeRelevance([
    makePair({ query: "q1", url: abs("/1"), avgTopDomainRank: 300 }),
    makePair({ query: "q2", url: abs("/2"), avgTopDomainRank: 500 }),
    // 没有前 10 平均:用前 5 竞品 domainRank 的中位数 900
    makePair({ query: "q3", url: abs("/3"), avgTopDomainRank: null, competitors: ranks.map((r, i) => competitor(i + 1, { domainRank: r })) }),
  ]);
  const s = scoreWinnabilityGap(ctxOf({ pages: [], relevance, authority: makeAuthority({ rank: 320 }) }));
  // 320/300 → 100;320/500 = 0.64 → 70;320/900 = 0.36 → 40
  assert.equal(s.score, 70);
  assert.equal(s.evidence[1], '"q3": ranking sites 900 (median of the top 5 we checked) — you\'re at 36% of that');
  // 对手权威为 0 → 视为 ≥1
  const zero = makeRelevance([makePair({ query: "z", url: abs("/z"), avgTopDomainRank: 0, competitors: [1, 2, 3].map((i) => competitor(i, { domainRank: 0 })) })]);
  assert.equal(scoreWinnabilityGap(ctxOf({ pages: [], relevance: zero, authority: makeAuthority({ rank: 320 }) })).score, 100);
  const far = scoreWinnabilityGap(ctxOf({ pages: [], relevance: makeRelevance([makePair({ query: "f", url: abs("/f"), avgTopDomainRank: 450 })]), authority: makeAuthority({ rank: 8 }) }));
  assert.equal(far.score, 10);
  assert.equal(far.summary, "The sites ranking for your queries have far more authority than yours (Domain Rank 8 vs about 450)");
  // null:没有本站 rank / 没有对手数据
  assert.equal(scoreWinnabilityGap(ctxOf({ pages: [], relevance })).summary, "Not measured: backlink data was not available for this report");
  assert.equal(scoreWinnabilityGap(ctxOf({ pages: [], relevance, authority: makeAuthority({ rank: null }) })).summary, "Not measured: your Domain Rank was not reported");
  const blind = makeRelevance([makePair({ query: "b", url: abs("/b"), avgTopDomainRank: null, competitors: [1, 2, 3].map((i) => competitor(i, { domainRank: null })) })]);
  assert.equal(scoreWinnabilityGap(ctxOf({ pages: [], relevance: blind, authority: makeAuthority() })).summary, "Not measured: we have no authority data for the sites ranking for your queries");
});

test("winnability.striking: volume-weighted position bands for non-brand keywords; 4–15 with 50+ searches listed", () => {
  assert.deepEqual([3, 4, 10, 11, 20, 21].map(strikingPoints), [100, 70, 70, 40, 40, 10]);
  const visibility = makeVisibility({
    topKeywords: [
      { keyword: "example", position: 1, volume: 2400, etv: 1, url: abs("/"), intent: "navigational", cpc: 0 },
      { keyword: "audit tool", position: 2, volume: 1000, etv: 1, url: abs("/a"), intent: "commercial", cpc: 1 },
      { keyword: "audit checklist", position: 7, volume: 500, etv: 1, url: abs("/b"), intent: "informational", cpc: 1 },
      { keyword: "audit template", position: 15, volume: 300, etv: 1, url: abs("/c"), intent: "informational", cpc: 1 },
      { keyword: "audit history", position: 40, volume: 200, etv: 1, url: abs("/d"), intent: "informational", cpc: 1 },
    ],
  });
  const s = scoreWinnabilityStriking(ctxOf({ pages: [], visibility }));
  // 品牌词不算:(1000 × 100 + 500 × 70 + 300 × 40 + 200 × 10) / 2000 = 74.5
  assert.equal(s.score, 75);
  assert.deepEqual(s.evidence, [
    "1 of 4 non-brand keywords rank in the top 3, 1 at 4–10 and 1 on page two (11–20)",
    'Close to the top: "audit checklist" (#7, 500/mo), "audit template" (#15, 300/mo)',
  ]);
  assert.match(s.fixes[0], /^Push "audit checklist" \(#7, 500 searches a month\) into the top 3: refresh \/b/);
  assert.equal(scoreWinnabilityStriking(ctxOf({ pages: [], visibility: makeVisibility({ noData: true, topKeywords: [] }) })).summary, "Not measured: DataForSEO has no ranking data for this domain yet");
  assert.equal(scoreWinnabilityStriking(ctxOf({ pages: [] })).summary, "Not measured: ranking data was not available for this report");
  const brandOnly = makeVisibility({ topKeywords: [{ keyword: "example login", position: 1, volume: 500, etv: 1, url: abs("/"), intent: "navigational", cpc: 0 }] });
  assert.equal(scoreWinnabilityStriking(ctxOf({ pages: [], visibility: brandOnly })).summary, "Not measured: you don't rank for any non-brand keywords yet");
});

test("winnability.momentum: Search Console clicks change → clamp(50 + change% / 40 × 50) measured; keyword movement estimated", () => {
  assert.deepEqual([40, -40, 0, 10, 100, -100].map(momentumFromChange), [100, 0, 50, 63, 100, 0]);
  const gsc = (cur: number, prev: number) => makeGsc({ totals: { clicks: cur, impressions: 1000, ctr: 0.01, position: 9 }, previous: { clicks: prev, impressions: 1000, ctr: 0.01, position: 9 } });
  const up = scoreWinnabilityMomentum(ctxOf({ pages: [], gsc: gsc(6000, 5000) }));
  assert.equal(up.score, 75);
  assert.equal(up.confidence, "measured");
  assert.equal(up.summary, "Clicks from Google are growing: +20% vs the previous 28 days");
  assert.equal(up.evidence[0], "Search Console clicks: 6,000 in the last 28 days vs 5,000 in the 28 days before (+20%)");
  const down = scoreWinnabilityMomentum(ctxOf({ pages: [], gsc: gsc(4000, 5000) }));
  assert.equal(down.score, 25);
  assert.equal(down.summary, "Clicks from Google fell 20% vs the previous 28 days");
  assert.equal(scoreWinnabilityMomentum(ctxOf({ pages: [], gsc: gsc(50, 0) })).score, 100, "up from zero");
  // 没有 Search Console:排名词升降 (50 + 120 − 80 − 30) / 280 → 50 + 50 × 0.214
  const mv = scoreWinnabilityMomentum(ctxOf({ pages: [], visibility: makeVisibility() }));
  assert.equal(mv.score, 61);
  assert.equal(mv.confidence, "estimated");
  assert.equal(mv.summary, "Only slightly more of your keywords are rising than falling");
  assert.equal(mv.evidence[1], "Your top 5 keywords with rank history: 3 moved up, 1 moved down, 0 new");
  // 点击太少(两期合计 < 20)但曝光够(合计 ≥ 200):改用曝光,仍是实测(站长 2026-10-02:2 次 vs 0 次不是增长)
  const small = (clicks: [number, number], impr: [number, number]) =>
    makeGsc({ totals: { clicks: clicks[0], impressions: impr[0], ctr: 0, position: 28 }, previous: { clicks: clicks[1], impressions: impr[1], ctr: 0, position: 63 } });
  const byImpr = scoreWinnabilityMomentum(ctxOf({ pages: [], visibility: makeVisibility(), gsc: small([2, 0], [509, 158]) }));
  assert.equal(byImpr.score, 100);
  assert.equal(byImpr.confidence, "measured");
  assert.equal(byImpr.summary, "Impressions from Google are growing: +222% vs the previous 28 days");
  assert.ok(byImpr.evidence[0].includes("clicks are too few to compare — 2 vs 0 — so this uses impressions"));
  const flat = scoreWinnabilityMomentum(ctxOf({ pages: [], visibility: makeVisibility(), gsc: gsc(0, 0) }));
  assert.equal(flat.score, 50, "0 clicks both periods, 1,000 vs 1,000 impressions → flat");
  assert.equal(flat.confidence, "measured");
  // 点击、曝光都太少:退回排名升降,可信度不冒充 measured
  const quiet = scoreWinnabilityMomentum(ctxOf({ pages: [], visibility: makeVisibility(), gsc: small([2, 0], [60, 40]) }));
  assert.equal(quiet.score, 61);
  assert.equal(quiet.confidence, "estimated");
  const none = scoreWinnabilityMomentum(ctxOf({ pages: [] }));
  assert.equal(none.score, null);
  assert.equal(none.summary, "Not measured: neither Search Console data nor ranking history was available");
});

test("Search Console presence flips cannibalization and momentum confidence to measured", () => {
  const withGsc = computeRanking(strongInput());
  const without = computeRanking({ ...strongInput(), gsc: null });
  for (const id of ["relevance.cannibalization", "winnability.momentum"]) {
    assert.equal(sub(withGsc, id).confidence, "measured", `${id} with GSC`);
    assert.equal(sub(without, id).confidence, "estimated", `${id} without GSC`);
  }
  assert.equal(sub(without, "behavior.ctr").score, null);
  assert.equal(without.basis.gscConnected, false);
});

/* ============================================================
   AI 搜索与点击机会
   ============================================================ */

test("aisearch.overview: share of AI Overviews (present and loaded) that cite you; null when none shows one", () => {
  const ref = (domain: string) => ({ domain, url: `https://${domain}/x` });
  const relevance = makeRelevance([
    makePair({ query: "a", url: abs("/a"), aiOverview: { present: true, loaded: true, cited: true, references: [ref(HOST)] } }),
    makePair({ query: "b", url: abs("/b"), aiOverview: { present: true, loaded: true, cited: false, references: [ref("web.dev"), ref("moz.com")] } }),
    // 出现了但没加载到来源:不进分母
    makePair({ query: "c", url: abs("/c"), aiOverview: { present: true, loaded: false, cited: false, references: [] } }),
    makePair({ query: "d", url: abs("/d"), aiOverview: null, serpFeatures: ["organic"] }),
  ]);
  const s = scoreAiSearchOverview(ctxOf({ pages: [], relevance }));
  assert.equal(s.score, 50);
  assert.equal(s.evidence[0], "AI Overview on 3 of 4 queries we checked; you're cited in 1 of the 2 whose sources we could load");
  assert.equal(s.evidence[1], '"b": doesn\'t cite you — cites web.dev, moz.com');
  assert.match(s.fixes[0], /^Get cited in the AI Overview for "b": answer it in 2–3 plain sentences near the top of \/b/);
  // 引用列表里有本站(www 也算)即视为被引
  const viaRefs = makeRelevance([makePair({ query: "a", url: abs("/a"), aiOverview: { present: true, loaded: true, cited: false, references: [ref(`www.${HOST}`)] } })]);
  assert.equal(scoreAiSearchOverview(ctxOf({ pages: [], relevance: viaRefs })).score, 100);
  // null 的三种原因
  const noneShown = makeRelevance([makePair({ query: "a", url: abs("/a"), aiOverview: null, serpFeatures: ["organic"] })]);
  assert.equal(scoreAiSearchOverview(ctxOf({ pages: [], relevance: noneShown })).summary, "Not measured: none of the analysed queries show an AI Overview");
  assert.equal(scoreAiSearchOverview(ctxOf({ pages: [], relevance: makeRelevance([makePair({ query: "a", url: abs("/a") })]) })).summary, "Not measured: no live search results were checked for this report's queries");
  const unloaded = makeRelevance([makePair({ query: "c", url: abs("/c"), aiOverview: { present: true, loaded: false, cited: false, references: [] } })]);
  assert.equal(scoreAiSearchOverview(ctxOf({ pages: [], relevance: unloaded })).summary, "Not measured: AI Overviews appear on 1 of your queries, but their sources could not be loaded");
});

test("aisearch.crawlers: retrieval bots allowed × 70 + not a JS shell 30; training bots are evidence only", () => {
  const probeWith = (over: Parameters<typeof makeProbe>[1]) => makeProbe([], over);
  const twoBlocked = probeWith({ robotsMeta: robotsMetaWith(aiCrawlerVerdicts("allow", "unspecified", { "Claude-SearchBot": "disallow", "Claude-User": "disallow" })) });
  const s = scoreAiSearchCrawlers(ctxOf({ pages: [], probe: twoBlocked }));
  // 6 / 8 × 70 + 30 = 82.5
  assert.equal(s.score, 83);
  assert.equal(s.evidence[0], "AI search crawlers allowed: 6 of 8 — blocked: Claude-SearchBot, Claude-User");
  assert.equal(s.fixes[0], "Allow Claude-SearchBot and Claude-User in robots.txt — blocking them keeps you out of answers in Claude");
  assert.equal(s.summary, "AI search crawlers can reach and read your pages (6 of 8 allowed)");
  // JS 空壳:30 分没了
  assert.equal(scoreAiSearchCrawlers(ctxOf({ pages: [], probe: { ...twoBlocked, jsDependent: true } })).score, 53);
  // 只挡训练类:不扣分,只在证据里写明
  const training = scoreAiSearchCrawlers(ctxOf({ pages: [], probe: probeWith({ robotsMeta: robotsMetaWith(aiCrawlerVerdicts("allow", "disallow")) }) }));
  assert.equal(training.score, 100);
  assert.ok(training.evidence.some((e) => e.startsWith("Training crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended, Bytespider): 6 blocked, 0 allowed")));
  // 没有 robots.txt(404)= 全部允许
  const noRobots = probeWith({ robots: { url: abs("/robots.txt"), status: 404, found: false, disallowAll: false, blocksEntry: false, sitemaps: [], bytes: 0 }, robotsMeta: undefined });
  const open = scoreAiSearchCrawlers(ctxOf({ pages: [], probe: noRobots }));
  assert.equal(open.score, 100);
  assert.equal(open.evidence[0], "No robots.txt, so every AI crawler is allowed by default");
  // 旧报告只有 6 个键:没有键的机器人不进分母(PerplexityBot 挡、OAI-SearchBot 放 → 1/2 × 70 + 30)
  const legacy = probeWith({ robotsMeta: robotsMetaWith({ GPTBot: "allow", ClaudeBot: "allow", PerplexityBot: "disallow", "Google-Extended": "unspecified", "OAI-SearchBot": "allow", CCBot: "allow" }) });
  assert.equal(scoreAiSearchCrawlers(ctxOf({ pages: [], probe: legacy })).score, 65);
  // 读不到任何检索类判定:只用 JS 空壳项归一
  const unread = scoreAiSearchCrawlers(ctxOf({ pages: [], probe: probeWith({ robotsMeta: undefined }) }));
  assert.equal(unread.score, 100);
  assert.equal(unread.evidence[0], "We could not read AI crawler rules from your robots.txt — scored on JavaScript rendering only");
  // 两项都无从判断 → null
  const blind = scoreAiSearchCrawlers(ctxOf({ pages: [], probe: probeWith({ robotsMeta: undefined, jsDependent: undefined }) }));
  assert.equal(blind.score, null);
  assert.equal(blind.summary, "Not measured: we could not read the AI crawler rules in your robots.txt or your homepage");
});

test("aisearch.citability: opening 25 + questions 20 + data 20 / 10 + lists 15 + schema 10 + byline & date 10, averaged", () => {
  const full = contentPage("/blog/sourdough-starter-guide", { firstParagraph: "A sourdough starter is a live culture of flour and water that makes bread rise." }, { jsonLdTypes: ["Article"] });
  assert.equal(citabilityParts(full).points, 100);
  const vary = (c: Parameters<typeof makeContent>[0], page: Partial<CrawledPage> = {}) =>
    citabilityParts(contentPage("/blog/sourdough-starter-guide", { firstParagraph: "A sourdough starter is a live culture of flour and water that makes bread rise.", ...c }, { jsonLdTypes: ["Article"], ...page })).points;
  assert.equal(vary({ firstParagraph: `Sourdough starter ${"care tips and notes ".repeat(20)}` }), 75, "a first paragraph that fills the 300-character cap is not a short answer");
  assert.equal(vary({ firstParagraph: "Welcome to our blog, where we share news from the bakery." }), 75, "opening must use the title's words");
  assert.equal(vary({ questionHeadings: 1, hasFaq: false }), 80);
  assert.equal(vary({ numberCount: 3, mainWords: 1000 }), 90, "3 data points per 1,000 words → 10");
  assert.equal(vary({ numberCount: 1, mainWords: 1000 }), 80);
  assert.equal(vary({ listCount: 0, tableCount: 0 }), 85);
  assert.equal(vary({}, { jsonLdTypes: ["BreadcrumbList"] }), 90);
  assert.equal(vary({ datePublished: null, dateModified: null }), 90);
  const weak = contentPage(
    "/blog/rye-bread-basics",
    { firstParagraph: "Rye bread basics: rye flour, water, salt and time — that is all a rye loaf needs.", questionHeadings: 0, hasFaq: false, numberCount: 3, mainWords: 1000, listCount: 0, tableCount: 0 },
    { jsonLdTypes: ["BreadcrumbList"] },
  );
  assert.equal(citabilityParts(weak).points, 45);
  const relevance = makeRelevance([makePair({ query: "sourdough starter", url: abs("/blog/sourdough-starter-guide"), paa: ["How long does a sourdough starter last?", "Can I freeze sourdough starter?"] })]);
  const s = scoreAiSearchCitability(ctxOf({ pages: [full, weak], relevance }));
  // (100 + 45) / 2
  assert.equal(s.score, 73);
  assert.equal(s.evidence[0], "Short, direct opening answer (60 words or fewer, using the title's words): 2 of 2 content pages");
  assert.ok(s.fixes.includes('Use the questions searchers also ask as subheadings and answer each right below — e.g. "How long does a sourdough starter last?", "Can I freeze sourdough starter?"'));
  const none = scoreAiSearchCitability(ctxOf({ pages: [] }));
  assert.equal(none.score, null);
  assert.equal(none.summary, "Not measured: we could not read any pages on the site");
});

test("aisearch.zeroclick: absorption weights per SERP feature, volume-weighted; own snippet only from the live SERP", () => {
  const pct = (x: number) => Math.round(x * 100);
  assert.equal(pct(absorption(["organic", "ai_overview", "people_also_ask"])), 40);
  assert.equal(pct(absorption(["featured_snippet"])), 20);
  assert.equal(pct(absorption(["featured_snippet"], true)), 0, "your own snippet doesn't take your click");
  assert.equal(pct(absorption(["paid", "shopping"])), 15, "ads and shopping count once");
  assert.equal(pct(absorption(["local_pack", "map"])), 15);
  assert.equal(pct(absorption(["AI_OVERVIEW"])), 35, "case-insensitive");
  assert.equal(pct(absorption(["ai_overview", "featured_snippet", "answer_box", "paid", "local_pack", "knowledge_graph", "video", "people_also_ask", "top_stories"])), 85, "capped at 0.85");
  const visibility = makeVisibility({
    topKeywords: [
      // 品牌词不算
      { keyword: "example login", position: 1, volume: 900, etv: 1, url: abs("/"), intent: "navigational", cpc: 0, serpItemTypes: ["knowledge_graph"] },
      { keyword: "sourdough starter", position: 3, volume: 1000, etv: 1, url: abs("/a"), intent: "informational", cpc: 1, serpItemTypes: ["organic", "ai_overview", "people_also_ask"] },
      // isFeaturedSnippet 已被 DataForSEO 弃用:不据它判"本站拥有"
      { keyword: "rye bread recipe", position: 1, volume: 500, etv: 1, url: abs("/b"), intent: "informational", cpc: 1, serpItemTypes: ["organic", "featured_snippet"], isFeaturedSnippet: true },
      { keyword: "proofing basket", position: 5, volume: 500, etv: 1, url: abs("/c"), intent: "commercial", cpc: 1, serpItemTypes: ["organic", "paid", "shopping"] },
    ],
  });
  // (1000 × 0.4 + 500 × 0.2 + 500 × 0.15) / 2000 = 0.2875
  assert.equal(scoreAiSearchZeroClick(ctxOf({ pages: [], visibility })).score, 71);
  // live SERP 确认精选摘要是本站的 → 那个词不再被吸收:(400 + 0 + 75) / 2000 = 0.2375
  const relevance = makeRelevance([makePair({ query: "rye bread recipe", url: abs("/b"), serpFeatures: ["organic", "featured_snippet"], featuredSnippet: { domain: HOST, url: abs("/b"), own: true } })]);
  const s = scoreAiSearchZeroClick(ctxOf({ pages: [], visibility, relevance }));
  assert.equal(s.score, 76);
  assert.deepEqual(s.evidence, [
    "Search features take about 24% of the clicks across 3 non-brand keywords (weighted by search volume)",
    "AI Overview on 1 of 3; featured snippet held by another site on 0; ads or shopping results on 1",
    'Most crowded: "sourdough starter" (AI Overview, People also ask) — about 40% of clicks go to features, not links',
  ]);
  assert.equal(s.summary, "Your keywords still send clicks: search features take only about 24% of them");
  // null:[] = 供应商没给;字段不存在 = 旧报告;一个非品牌词都没有
  const kw = (serpItemTypes?: string[]) => makeVisibility({ topKeywords: [{ keyword: "rye bread", position: 3, volume: 10, etv: 1, url: abs("/x"), intent: null, cpc: null, ...(serpItemTypes ? { serpItemTypes } : {}) }] });
  assert.equal(scoreAiSearchZeroClick(ctxOf({ pages: [], visibility: kw([]) })).summary, "Not measured: DataForSEO had no search-feature data for your non-brand keywords");
  assert.equal(scoreAiSearchZeroClick(ctxOf({ pages: [], visibility: kw() })).summary, "Not measured: this report predates search-feature data — re-run it to measure");
  assert.equal(scoreAiSearchZeroClick(ctxOf({ pages: [] })).summary, "Not measured: no non-brand keywords were available to check");
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

test("behavior.ctr: expected CTR curve with interpolation, min(100, 85 × actual / expected); null without Search Console", () => {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  assert.deepEqual([0.5, 1, 3, 3.5, 10, 10.5, 11, 30].map((p) => r3(expectedCtr(p))), [0.276, 0.276, 0.11, 0.097, 0.024, 0.017, 0.01, 0.01]);
  assert.deepEqual([1, 1.2, 0.5].map(ctrPoints), [85, 100, 42.5]);
  const gsc = makeGsc({
    queries: [
      { query: "example", clicks: 900, impressions: 1000, ctr: 0.9, position: 1, pages: 1, brand: true },
      { query: "sourdough starter", clicks: 276, impressions: 1000, ctr: 0.276, position: 1, pages: 1, brand: false },
      { query: "rye bread recipe", clicks: 55, impressions: 1000, ctr: 0.055, position: 3, pages: 1, brand: false },
      { query: "tiny", clicks: 0, impressions: 40, ctr: 0, position: 2, pages: 1, brand: false },
    ],
  });
  const s = scoreBehaviorCtr(ctxOf({ pages: [], gsc }));
  // 品牌词与曝光 <50 的不算:331 / (276 + 110) = 0.857 → 85 × 0.857
  assert.equal(s.score, 73);
  assert.equal(s.confidence, "measured");
  assert.equal(s.summary, "Your pages earn 86% of the clicks their positions should get");
  assert.deepEqual(s.evidence, [
    "2 non-brand queries with 50+ impressions earned 331 clicks vs about 386 expected for their positions (86% of expected)",
    '"rye bread recipe": 1,000 impressions at position 3, 5.5% click-through vs 11% expected',
  ]);
  assert.equal(s.fixes[0], 'Rewrite the title and meta description of the page ranking for "rye bread recipe" — it shows 1,000 times in 28 days but earns 55 clicks');
  const capped = scoreBehaviorCtr(ctxOf({ pages: [], gsc: makeGsc({ queries: [{ query: "q", clicks: 400, impressions: 1000, ctr: 0.4, position: 1, pages: 1, brand: false }] }) }));
  assert.equal(capped.score, 100);
  const off = scoreBehaviorCtr(ctxOf({ pages: [] }));
  assert.equal(off.score, null);
  assert.equal(off.summary, "Not measured: connect Search Console");
  const quiet = scoreBehaviorCtr(ctxOf({ pages: [], gsc: makeGsc({ queries: [{ query: "example", clicks: 9, impressions: 100, ctr: 0.09, position: 1, pages: 1, brand: true }] }) }));
  assert.equal(quiet.summary, "Not measured: no non-brand query had 50 or more impressions in the last 28 days");
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

/* ============================================================
   基础信息与重算
   ============================================================ */

test("basis: query sources, target keywords and the Search Console flag", () => {
  const relevance = makeRelevance(
    [makePair({ query: "sourdough starter kit", url: abs("/kit"), source: "target" }), makePair({ query: "rye bread", url: abs("/rye"), source: "page-topic" })],
    { targetKeywords: ["sourdough starter kit"] },
  );
  const fromRelevance = computeRanking(rankingInput({ pages: [], relevance }));
  assert.deepEqual(fromRelevance.basis.queries.map((q) => q.source), ["target", "page-topic"]);
  assert.deepEqual(fromRelevance.basis.targetKeywords, ["sourdough starter kit"]);
  assert.equal(fromRelevance.basis.gscConnected, false);
  // 集成方传入的目标词优先(去空白、去重)
  const given = computeRanking(rankingInput({ pages: [], relevance, targetKeywords: [" sourdough starter kit ", "sourdough starter kit", "", "rye flour"], gsc: makeGsc() }));
  assert.deepEqual(given.basis.targetKeywords, ["sourdough starter kit", "rye flour"]);
  assert.equal(given.basis.gscConnected, true);
});

function resultOf(input: RankingInput, plan: "free" | "full" = "full"): SeoAuditResult {
  return {
    version: 1,
    plan,
    input: HOST,
    entryUrl: abs("/"),
    domain: input.domain,
    generatedAt: NOW.toISOString(),
    durationMs: 61_000,
    overall: { score: input.technical.score, grade: input.technical.grade },
    dimensions: input.dimensions,
    checks: input.checks,
    pages: input.pages,
    probe: input.probe,
    psi: input.psi,
    topIssues: [],
    roadmap: null,
    authority: input.authority,
    visibility: input.visibility,
    competitors: null,
    cost: { dataforseoUsd: 0, calls: 0 },
    ranking: computeRanking(input),
    reputation: input.reputation,
    gsc: input.gsc,
    meta: { pagesCrawled: input.pages.length, pagesRequested: 40, crawlLimited: false, notes: [], lockedSections: [], outcome: "complete", blockers: input.technical.blockers },
  };
}

test("recomputeRankingFromResult: same Search Console data → deep-equal ranking; disconnecting removes every GSC-only query", () => {
  const gsc: GscData = makeGsc({
    queries: [...makeGsc().queries, { query: "zz gsc only crawl checker", clicks: 5, impressions: 2000, ctr: 0.0025, position: 4.5, pages: 2, brand: false }],
    cannibalized: [
      {
        query: "zz gsc only schema generator",
        impressions: 600,
        pages: [
          { page: abs("/blog/schema-for-products"), clicks: 10, impressions: 330 },
          { page: abs("/blog/schema-markup-basics"), clicks: 4, impressions: 240 },
        ],
      },
    ],
  });
  const input: RankingInput = { ...strongInput(), gsc };
  const result = resultOf(input);
  const ranking = result.ranking as RankingFramework;
  // 同一份 Search Console 数据、同一个 now → 逐字相同(sitemap 部分来自 basis.sitemapFocus,而不是原始 URL)
  assert.deepStrictEqual(recomputeRankingFromResult(result, { gsc, now: NOW }), ranking);
  // 从数据库读回来的形状(JSON 往返)同样可复现
  const stored = JSON.parse(JSON.stringify(result)) as SeoAuditResult;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(recomputeRankingFromResult(stored, { gsc: stored.gsc ?? null, now: NOW }))), JSON.parse(JSON.stringify(ranking)));

  const text = (r: RankingFramework) => JSON.stringify([r.overall.note, r.notes, r.pillars.map((p) => [p.summary, p.subs.map((s) => [s.summary, s.evidence, s.fixes])])]);
  // 只来自 Search Console 的 query(其他数据里没有出现过的)
  const elsewhere = new Set([
    ...(input.relevance?.pairs ?? []).flatMap((p) => [p.query, ...(p.paa ?? [])]),
    ...(input.visibility?.topKeywords ?? []).map((k) => k.keyword),
    input.reputation?.brandQuery ?? "",
    input.reputation?.reviewsQuery ?? "",
  ]);
  const gscOnly = [...gsc.queries.map((q) => q.query), ...gsc.cannibalized.map((c) => c.query)].filter((q) => !elsewhere.has(q));
  assert.ok(text(ranking).includes("zz gsc only crawl checker") && text(ranking).includes("zz gsc only schema generator"), "connected report shows the GSC queries");

  const off = recomputeRankingFromResult(result, { gsc: null, now: NOW }) as RankingFramework;
  assertContract(off, { ...input, gsc: null }, "recompute-disconnected");
  assert.equal(sub(off, "behavior.ctr").score, null);
  assert.equal(sub(off, "behavior.ctr").summary, "Not measured: connect Search Console");
  assert.equal(off.basis.gscConnected, false);
  assert.equal(sub(off, "winnability.momentum").confidence, "estimated");
  for (const q of gscOnly) assert.ok(!text(off).includes(q), `disconnected report must not mention "${q}"`);
  assert.ok(!text(off).includes("Search Console:"), "no Search Console evidence lines left");
  // 免费 / 没有 ranking 的结果不重算
  assert.equal(recomputeRankingFromResult(resultOf(input, "free"), { gsc, now: NOW }), null);
  assert.equal(recomputeRankingFromResult({ ...result, ranking: null }, { gsc, now: NOW }), null);
});
