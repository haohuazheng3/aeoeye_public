/* v3 Ranking Score 的出口闸门测试:npx tsx --test lib/seo-audit/tests/ranking-view.test.ts
   免费 / 撤销视图绝不下发 ranking;导出只留我们自己的分析,剥掉 DataForSEO 的行。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankingFramework, RelevanceAnalysis } from "../types";
import { toPublicView } from "../view";
import { toExportView } from "../export";
import { makeResult, healthySite } from "./fixtures";

const COMPETITOR_URL = "https://rival.example.org/guide/secret-path";

function relevance(): RelevanceAnalysis {
  return {
    pairs: [
      {
        query: "seo audit tool",
        source: "ranking",
        volume: 2400,
        position: 7,
        intent: "commercial",
        intentSource: "dataforseo",
        url: "https://example.com/",
        pageFormat: "homepage",
        serpFormat: "listicle",
        intentMatch: false,
        titleAlignment: 0.67,
        h1Alignment: 0.33,
        answerEarly: true,
        coverage: 0.4,
        coveredTopics: ["pricing"],
        missingTopics: ["free vs paid", "how it works"],
        uniqueTopics: ["ai visibility"],
        gainSignals: { uniqueTopics: 1, extraNumbers: 3, extraTables: 0, ownImages: 1, experienceMarkers: 0 },
        competitors: [
          {
            url: COMPETITOR_URL,
            domain: "rival.example.org",
            position: 1,
            title: "Best SEO audit tools",
            h1: "Best SEO audit tools",
            wordCount: 2100,
            format: "listicle",
            headings: ["free vs paid", "how it works"],
            numbers: 30,
            tables: 2,
            orderedLists: 1,
            images: 6,
            fetched: true,
          },
        ],
      },
    ],
    serpCalls: 1,
    competitorPagesFetched: 1,
    notes: [],
  };
}

function ranking(): RankingFramework {
  return {
    version: 1,
    overall: { score: 61, grade: "C", capped: false, note: "" },
    pillars: [
      {
        id: "quality",
        label: "Content quality (E-E-A-T)",
        role: "Decides whether rankings survive core updates",
        weight: 25,
        score: 48,
        grade: "D",
        summary: "Few pages show first-hand experience.",
        subs: [
          {
            id: "quality.experience",
            pillar: "quality",
            label: "First-hand experience",
            score: 22,
            weight: 25,
            confidence: "estimated",
            summary: "Only 2 of 9 articles show first-hand experience",
            evidence: ["First-person testing language found on 2 of 9 content pages (/blog/a, /blog/b)"],
            fixes: ["Add what you actually did: the setup you tested and the numbers you saw."],
          },
        ],
      },
    ],
    basis: {
      pagesAnalyzed: 20,
      contentPages: 9,
      queries: [{ query: "seo audit tool", url: "https://example.com/", position: 7, volume: 2400, intent: "commercial" }],
      competitorsCompared: 1,
    },
    relevance: relevance(),
    notes: [],
  };
}

test("locked view never carries the Ranking Score, even when the stored result has one (revoked full report)", () => {
  const r = { ...makeResult(healthySite(), { paid: true }), ranking: ranking() };
  const v = toPublicView(r, false);
  assert.equal(v.ranking, null);
  assert.ok(v.meta.lockedSections.includes("ranking"));
  assert.ok(!JSON.stringify(v).includes("First-hand experience"), "no sub-score text leaks");
  assert.ok(!JSON.stringify(v).includes(COMPETITOR_URL), "no competitor URL leaks");
});

test("free result: ranking stays null in the public view", () => {
  const r = makeResult(healthySite());
  assert.equal(toPublicView(r, false).ranking, null);
});

test("unlocked view returns the Ranking Score untouched", () => {
  const r = { ...makeResult(healthySite(), { paid: true }), ranking: ranking() };
  const v = toPublicView(r, true);
  assert.deepEqual(v.ranking, r.ranking);
});

test("export keeps our analysis but strips DataForSEO rows (volumes, positions, SERP URLs and titles)", () => {
  const r = { ...makeResult(healthySite(), { paid: true }), ranking: ranking() };
  const e = toExportView(r);
  assert.ok(e.ranking);
  assert.equal(e.ranking!.overall.score, 61);
  assert.equal(e.ranking!.pillars[0].subs[0].score, 22, "sub-scores are exported");
  assert.deepEqual(e.ranking!.basis.queries, [{ query: "seo audit tool", url: "https://example.com/", intent: "commercial" }]);
  const pair = e.ranking!.relevance!.pairs[0] as unknown as Record<string, unknown>;
  assert.equal("volume" in pair, false);
  assert.equal("position" in pair, false);
  assert.equal(pair.coverage, 0.4);
  assert.deepEqual(pair.competitors, [{ domain: "rival.example.org", format: "listicle", wordCount: 2100, fetched: true, weakSpots: [] }]);
  const json = JSON.stringify(e);
  assert.ok(!json.includes(COMPETITOR_URL), "competitor URL is not exported");
  assert.ok(!json.includes("Best SEO audit tools"), "SERP title is not exported");
  // 原结果不被改动
  assert.equal(r.ranking.relevance!.pairs[0].volume, 2400);
  assert.equal(r.ranking.relevance!.pairs[0].competitors[0].url, COMPETITOR_URL);
});

test("export of a full report without a Ranking Score (older reports) has ranking = null", () => {
  const r = makeResult(healthySite(), { paid: true });
  assert.equal(toExportView(r).ranking, null);
});
