/* 评分模型测试:npx tsx --test lib/seo-audit/tests/score.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DimensionId, SeoCheck, Severity, CheckStatus } from "../types";
import { DIMENSIONS, ONSITE_DIMENSIONS } from "../types";
import { runAllOnsiteChecks } from "../checks";
import { scoreDimensions, overallScore, pickTopIssues, buildRoadmap, gradeFor, INSUFFICIENT_DATA, GATE_DIMENSION_CAP, GATE_OVERALL_CAP } from "../score";
import { healthySite, brokenSite, healthyPages } from "./fixtures";

function mk(id: string, dimension: DimensionId, status: CheckStatus, severity: Severity, extra: Partial<SeoCheck> = {}): SeoCheck {
  const weight: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return { id, dimension, title: id, status, severity, weight: weight[severity], evidence: [], affected: [], fix: "", effort: "low", ...extra };
}
const dim = (dims: ReturnType<typeof scoreDimensions>, id: DimensionId) => dims.find((d) => d.id === id)!;

test("healthy site scores ≥85 with grade A and no blockers", () => {
  const checks = runAllOnsiteChecks(healthySite());
  const dims = scoreDimensions(checks, { unlocked: false });
  for (const id of ONSITE_DIMENSIONS) {
    const d = dim(dims, id);
    assert.equal(typeof d.score, "number", `${id} scored`);
    assert.ok((d.score as number) >= 85, `${id} = ${d.score}`);
    assert.equal(d.locked, false);
  }
  for (const id of ["authority", "visibility", "competitors"] as DimensionId[]) {
    assert.equal(dim(dims, id).score, null);
    assert.equal(dim(dims, id).locked, true);
  }
  const o = overallScore(dims, checks);
  assert.ok(o.score >= 85, `overall ${o.score}`);
  assert.equal(o.grade, "A");
  assert.deepEqual(o.blockers, []);
  assert.equal(o.scoreNote, "", "all 7 dimensions measured → no note");
});

test("broken site: gate caps dimension ≤30 and overall ≤40 with grade F, blockers listed", () => {
  const checks = runAllOnsiteChecks(brokenSite());
  const dims = scoreDimensions(checks, { unlocked: false });
  assert.ok((dim(dims, "crawlability").score as number) <= GATE_DIMENSION_CAP, `crawlability ${dim(dims, "crawlability").score}`);
  assert.ok((dim(dims, "security").score as number) <= GATE_DIMENSION_CAP, `security ${dim(dims, "security").score}`);
  assert.ok(/Capped at 30/.test(dim(dims, "crawlability").summary));
  const o = overallScore(dims, checks);
  assert.ok(o.score <= GATE_OVERALL_CAP, `overall ${o.score}`);
  assert.equal(o.grade, "F");
  for (const id of ["crawl.entry.indexable", "crawl.robots.blocks-site", "sec.tls.expired"]) assert.ok(o.blockers.includes(id), `blocker ${id}`);
  assert.ok(/Capped at 40/.test(o.scoreNote));
  // 用户看到的封顶说明是问题句,不是 check id(复审契约第 7 条);meta.blockers 仍是 id
  assert.ok(o.scoreNote.includes("Homepage is blocked from Google"), o.scoreNote);
  assert.ok(!/crawl\.entry\.indexable|sec\.tls\.expired/.test(o.scoreNote), o.scoreNote);
  assert.ok(dim(dims, "crawlability").summary.includes("robots.txt blocks Google from crawling your site"), dim(dims, "crawlability").summary);
  // 没传 checks 也能从 scoreDimensions 的登记里拿到 blockers
  const o2 = overallScore(dims);
  assert.deepEqual(o2.blockers.sort(), o.blockers.sort());
  assert.equal(o2.grade, "F");
});

test("weights: pass full, warn half, fail zero; info and na excluded from the denominator", () => {
  const checks = [
    mk("a", "onpage", "pass", "critical"), // 4/4
    mk("b", "onpage", "warn", "high"), // 1.5/3
    mk("c", "onpage", "fail", "medium"), // 0/2
    mk("d", "onpage", "pass", "low"), // 1/1
    mk("e", "onpage", "na", "critical"),
    mk("f", "onpage", "info", "critical"),
    mk("g", "onpage", "na", "high"),
  ];
  const d = dim(scoreDimensions(checks, { unlocked: false }), "onpage");
  assert.equal(d.score, Math.round((6.5 / 10) * 100));
  assert.equal(d.pass, 2);
  assert.equal(d.warn, 1);
  assert.equal(d.fail, 1);
  assert.equal(d.na, 3, "info counts with na as 'not scored'");
  // 只有 na/info 时不出分
  const onlyNa = dim(scoreDimensions([mk("x", "mobile", "na", "high"), mk("y", "mobile", "info", "low")], { unlocked: false }), "mobile");
  assert.equal(onlyNa.score, null);
  assert.equal(onlyNa.summary, INSUFFICIENT_DATA);
});

test("fewer than 3 applicable checks → score null and 'Insufficient data'; exactly 3 scores", () => {
  const two = dim(scoreDimensions([mk("a", "security", "pass", "high"), mk("b", "security", "pass", "high"), mk("c", "security", "na", "high")], { unlocked: false }), "security");
  assert.equal(two.score, null);
  assert.equal(two.summary, INSUFFICIENT_DATA);
  const three = dim(scoreDimensions([mk("a", "security", "pass", "high"), mk("b", "security", "pass", "high"), mk("c", "security", "fail", "low")], { unlocked: false }), "security");
  assert.equal(three.score, Math.round((6 / 7) * 100));
});

test("gate fail caps the dimension even when everything else passes", () => {
  const checks = [mk("gate", "crawlability", "fail", "critical", { gate: true }), ...Array.from({ length: 10 }, (_, i) => mk(`p${i}`, "crawlability", "pass", "high"))];
  const d = dim(scoreDimensions(checks, { unlocked: false }), "crawlability");
  assert.equal(d.score, GATE_DIMENSION_CAP, `raw would be ${Math.round((30 / 34) * 100)}, capped`);
  const nonGate = dim(scoreDimensions([mk("x", "crawlability", "fail", "critical"), ...Array.from({ length: 10 }, (_, i) => mk(`p${i}`, "crawlability", "pass", "high"))], { unlocked: false }), "crawlability");
  assert.equal(nonGate.score, 88, "a non-gate critical fail is not capped");
});

test("overall renormalises over dimensions that have a score and notes the missing ones", () => {
  const checks: SeoCheck[] = [];
  for (const id of ONSITE_DIMENSIONS) {
    if (id === "performance" || id === "mobile") continue; // 没测
    checks.push(mk(`${id}.1`, id, "pass", "high"), mk(`${id}.2`, id, "pass", "high"), mk(`${id}.3`, id, id === "onpage" ? "fail" : "pass", "high"));
  }
  const dims = scoreDimensions(checks, { unlocked: false });
  assert.equal(dim(dims, "performance").score, null);
  const o = overallScore(dims, checks);
  // onpage = 67,其余 100;权重 25+20+10+10+10 = 75
  const expected = Math.round((100 * 25 + 67 * 20 + 100 * 10 + 100 * 10 + 100 * 10) / 75);
  assert.equal(o.score, expected);
  assert.equal(o.grade, gradeFor(expected));
  assert.ok(/Based on 5 of 7 dimensions/.test(o.scoreNote), o.scoreNote);
  assert.ok(/Performance/.test(o.scoreNote) && /Mobile/.test(o.scoreNote));
  const none = overallScore(scoreDimensions([], { unlocked: false }));
  assert.equal(none.score, 0);
  assert.equal(none.grade, "F");
});

test("grade scale matches SEO_GRADE_SCALE (A≥85 B≥70 C≥55 D≥40)", () => {
  assert.equal(gradeFor(100), "A");
  assert.equal(gradeFor(85), "A");
  assert.equal(gradeFor(84), "B");
  assert.equal(gradeFor(70), "B");
  assert.equal(gradeFor(69), "C");
  assert.equal(gradeFor(55), "C");
  assert.equal(gradeFor(54), "D");
  assert.equal(gradeFor(40), "D");
  assert.equal(gradeFor(39), "F");
});

test("pickTopIssues: gate → critical fail → high fail → … → warn; onsite only; affected count breaks ties", () => {
  const checks = [
    mk("warn.critical", "onpage", "warn", "critical"),
    mk("fail.low", "onpage", "fail", "low"),
    mk("fail.high.small", "onpage", "fail", "high", { affectedCount: 2, scope: "page" }),
    mk("fail.high.big", "mobile", "fail", "high", { affectedCount: 9, scope: "page" }),
    mk("fail.critical", "security", "fail", "critical"),
    mk("gate", "crawlability", "fail", "critical", { gate: true }),
    mk("paid.fail", "authority", "fail", "critical"),
    mk("pass", "onpage", "pass", "critical"),
  ];
  assert.deepEqual(pickTopIssues(checks), ["gate", "fail.critical", "fail.high.big"]);
  assert.deepEqual(pickTopIssues(checks, 6), ["gate", "fail.critical", "fail.high.big", "fail.high.small", "fail.low", "warn.critical"]);
  assert.deepEqual(pickTopIssues([mk("ok", "onpage", "pass", "low"), mk("n", "onpage", "na", "low")]), []);
});

test("buildRoadmap: impact = rank × (1 + log2(1 + pages)); buckets by impact and effort; gate always this_week", () => {
  const pages = healthyPages();
  const checks = [
    mk("gate.hard", "crawlability", "fail", "critical", { gate: true, effort: "high" }),
    mk("page.high.low", "onpage", "fail", "high", { scope: "page", affectedCount: 3, effort: "low" }), // 3 × (1+2) = 9 → this_week
    mk("page.high.hard", "onpage", "fail", "high", { scope: "page", affectedCount: 3, effort: "high" }), // 9 → this_month (effort)
    mk("page.low.one", "onpage", "warn", "low", { scope: "page", affectedCount: 1, effort: "low" }), // 1 × 2 = 2 → later
    mk("site.medium.low", "mobile", "warn", "medium", { effort: "low" }), // 2 × (1+log2(21)) ≈ 10.8 → this_week
    mk("pass", "onpage", "pass", "high"),
    mk("na", "onpage", "na", "high"),
  ];
  const rm = buildRoadmap(checks, pages);
  const by = new Map(rm.map((r) => [r.checkId, r]));
  assert.equal(rm.length, 5, "only fail/warn become roadmap items");
  assert.equal(by.get("gate.hard")!.bucket, "this_week");
  assert.equal(by.get("gate.hard")!.pagesAffected, 20);
  assert.equal(by.get("page.high.low")!.impact, 9);
  assert.equal(by.get("page.high.low")!.bucket, "this_week");
  assert.equal(by.get("page.high.hard")!.bucket, "this_month");
  assert.equal(by.get("page.low.one")!.impact, 2);
  assert.equal(by.get("page.low.one")!.bucket, "later");
  assert.equal(by.get("site.medium.low")!.bucket, "this_week");
  assert.equal(by.get("site.medium.low")!.impact, Math.round(2 * (1 + Math.log2(21)) * 10) / 10);
  // 排序:桶顺序,桶内 impact 降序
  const order = rm.map((r) => r.bucket);
  assert.deepEqual(order, [...order].sort((a, b) => ["this_week", "this_month", "later"].indexOf(a) - ["this_week", "this_month", "later"].indexOf(b)));
  assert.ok(Object.keys(DIMENSIONS).length === 10);
});
