/* 免费视图测试:npx tsx --test lib/seo-audit/tests/view.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_FULL_DETAIL_MAX, type SeoAuditResult, type SeoCheck } from "../types";
import { toPublicView, freeFullDetailIds } from "../view";
import { makeResult, brokenSite, healthySite } from "./fixtures";

test("unlocked → the result is returned untouched", () => {
  const r = makeResult(brokenSite(), { paid: true });
  const v = toPublicView(r, true);
  assert.equal(v, r);
  assert.ok(v.pages.length === 20 && v.authority && v.roadmap && v.psi.desktop);
});

test("locked: exactly the V2-3 set keeps evidence/fix (≤8, critical/high fail|warn ∪ topIssues); everything else is stripped", () => {
  const r = makeResult(brokenSite());
  const before = JSON.stringify(r);
  const v = toPublicView(r, false);
  assert.equal(JSON.stringify(r), before, "input is not mutated");

  const full = freeFullDetailIds(r);
  assert.ok(full.size <= FREE_FULL_DETAIL_MAX, `fullDetail ${full.size}`);
  for (const id of r.topIssues) assert.ok(full.has(id), `top issue ${id} is fully visible`);

  const candidates = r.checks.filter((c) => (c.severity === "critical" || c.severity === "high") && (c.status === "fail" || c.status === "warn"));
  assert.ok(candidates.length > FREE_FULL_DETAIL_MAX, "broken site has more than 8 critical/high issues, so the cap matters");

  for (const c of v.checks) {
    const orig = r.checks.find((o) => o.id === c.id)!;
    assert.equal(c.status, orig.status);
    assert.equal(c.title, orig.title);
    assert.equal(c.affectedCount, orig.affectedCount, "affects-N-pages count survives");
    if (full.has(c.id)) {
      assert.equal(c.locked, false);
      assert.deepEqual(c.evidence, orig.evidence);
      assert.equal(c.fix, orig.fix);
      assert.ok(c.affected.length <= 3 && c.sample!.length <= 3);
    } else {
      assert.equal(c.locked, true, `${c.id} locked`);
      assert.deepEqual(c.evidence, [], `${c.id} evidence hidden`);
      assert.equal(c.fix, "", `${c.id} fix hidden`);
      assert.deepEqual(c.affected, []);
      assert.ok((c.sample?.length ?? 0) <= 1, `${c.id} sample ≤1`);
    }
  }
  // 没有任何 medium/low 检查泄露证据或修法
  const leak = v.checks.filter((c) => (c.severity === "medium" || c.severity === "low") && !r.topIssues.includes(c.id) && (c.evidence.length || c.fix));
  assert.deepEqual(leak.map((c) => c.id), []);
  // 有受影响页的锁定检查仍带 1 个样例 URL
  const lockedWithPages = v.checks.filter((c) => c.locked && (c.affectedCount ?? 0) > 0);
  assert.ok(lockedWithPages.length > 0);
  assert.ok(lockedWithPages.every((c) => c.sample!.length === 1));
});

test("locked: pages emptied, PSI audits emptied, desktop null, paid modules null, roadmap first item + bucket counts", () => {
  const r = makeResult(brokenSite());
  const v = toPublicView(r, false);
  assert.deepEqual(v.pages, []);
  assert.deepEqual(v.psi.mobile!.audits, []);
  assert.equal(v.psi.mobile!.fieldMetrics!.lcpMs, 4800, "CrUX headline metrics stay visible");
  assert.equal(v.psi.mobile!.scores.performance, 31, "Lighthouse score stays visible");
  assert.equal(v.psi.desktop, null);
  assert.equal(v.authority, null);
  assert.equal(v.visibility, null);
  assert.equal(v.competitors, null);
  assert.equal(v.roadmap!.length, 1);
  assert.equal(v.roadmap![0].checkId, r.roadmap![0].checkId);
  const counts = { this_week: 0, this_month: 0, later: 0 };
  for (const it of r.roadmap!) counts[it.bucket] += 1;
  assert.ok(v.meta.lockedSections.includes(`roadmap:this_week=${counts.this_week},this_month=${counts.this_month},later=${counts.later}`), v.meta.lockedSections.join(" | "));
  for (const s of ["pages=20", `psi.audits=${r.psi.mobile!.audits.length}`, "psi.desktop", "authority", "visibility", "competitors", "export"]) {
    assert.ok(v.meta.lockedSections.includes(s), `lockedSections has ${s}`);
  }
  const lockedCount = v.checks.filter((c) => c.locked).length;
  assert.ok(v.meta.lockedSections.includes(`checks=${lockedCount}`));
  assert.equal(v.overall.score, r.overall.score, "score/grade/dimensions stay");
  assert.deepEqual(v.dimensions, r.dimensions);
  assert.equal(v.meta.scoreNote, r.meta.scoreNote);
});

test("healthy site: nothing is critical/high fail|warn, so only topIssues (if any) are unlocked and the rest locks", () => {
  const r = makeResult(healthySite());
  const v = toPublicView(r, false);
  assert.deepEqual(r.topIssues, []);
  assert.ok(v.checks.every((c) => c.locked === true && c.evidence.length === 0));
  assert.equal(v.roadmap!.length, 0);
  assert.ok(v.meta.lockedSections.includes("roadmap:this_week=0,this_month=0,later=0"));
});

test("a medium-severity top issue is still fully visible", () => {
  const r = makeResult(healthySite());
  const medium: SeoCheck = { id: "onpage.h1.missing", dimension: "onpage", title: "x", status: "fail", severity: "medium", weight: 2, evidence: ["Across 20 crawled pages, 6 (30%) have no <h1>: /a, /b"], affected: ["a", "b", "c", "d", "e", "f"], fix: "Add an H1.", effort: "low", scope: "page", affectedCount: 6, sample: ["a", "b", "c"] };
  r.checks = r.checks.map((c) => (c.id === medium.id ? medium : c));
  r.topIssues = [medium.id];
  r.roadmap = null;
  const v = toPublicView(r, false);
  const c = v.checks.find((x) => x.id === medium.id)!;
  assert.equal(c.locked, false);
  assert.equal(c.fix, "Add an H1.");
  assert.equal(c.affected.length, 3);
  assert.equal(v.roadmap, null);
  assert.ok(v.meta.lockedSections.includes("roadmap"));
});

/* ============================================================
   复审 C3/C24/C42:免费视图的 probe 白名单 —— 锁定检查的原始证据不能从 probe 里漏出去
   ============================================================ */

const PROBE_WHITELIST = new Set(["input", "entryUrl", "origin", "host", "variants", "robots", "sitemaps", "soft404", "headers", "blocked", "jsDependent", "coverage", "entryError"]);

/** 模拟落库的运行期对象:probe 是 crawl.ts ProbeResult 的超集(robots 带 raw/groups,还有 entry / altHost) */
function withRuntimeExtras(r: SeoAuditResult): SeoAuditResult {
  const probe = r.probe as SeoAuditResult["probe"] & Record<string, unknown>;
  (probe.robots as unknown as Record<string, unknown>).raw = "User-agent: *\nDisallow: /secret-admin-path/\n";
  (probe.robots as unknown as Record<string, unknown>).groups = [{ agents: ["*"], rules: [{ allow: false, path: "/secret-admin-path/" }] }];
  (probe.robots as unknown as Record<string, unknown>).error = "robots-internal-error-detail";
  probe.entry = { status: 200, finalUrl: "https://example.com/", ms: 120 };
  probe.altHost = { host: "www.example.com", exists: true };
  probe.largeImages = [{ url: "https://example.com/img/huge-hero-LEAK.jpg", bytes: 2_400_000 }];
  probe.brokenOutbound = [{ from: "https://example.com/blog", to: "https://dead-partner-LEAK.test/x", status: 404 }];
  probe.canonicalTargets = [{ url: "https://other-LEAK.test/canonical", status: 404, finalUrl: null, noindex: false }];
  probe.sitemapSample = [{ url: "https://example.com/sitemap-sample-LEAK", status: 404, noindex: true, canonical: null, sameHost: true }];
  probe.entryError = null;
  (r as unknown as Record<string, unknown>).internalDebug = { secret: "top-level-runtime-LEAK" };
  (r.meta as unknown as Record<string, unknown>).internalTrace = "meta-runtime-LEAK";
  r.cost = { dataforseoUsd: 0.083, calls: 6 };
  return r;
}

test("locked view rebuilds probe from a whitelist: no broken-link table, sitemap sample, canonical targets, large images, variants, robots raw/groups, TTFB list, TLS, parity, headers", () => {
  const r = withRuntimeExtras(makeResult(brokenSite()));
  const before = JSON.stringify(r);
  const v = toPublicView(r, false);
  assert.equal(JSON.stringify(r), before, "input is not mutated (upgrade / rerun still read the stored probe)");
  assert.notEqual(v.probe, r.probe);

  for (const k of Object.keys(v.probe)) assert.ok(PROBE_WHITELIST.has(k), `probe.${k} is not whitelisted`);
  const p = v.probe as unknown as Record<string, unknown>;
  for (const k of ["brokenInternal", "brokenOutbound", "sitemapSample", "canonicalTargets", "largeImages", "crawlTtfb", "robotsMeta", "tls", "parity", "ogImage", "altHost", "entry"]) {
    assert.equal(p[k], undefined, `probe.${k} must not be in the free view`);
  }
  assert.deepEqual(v.probe.variants, []);
  assert.deepEqual(v.probe.sitemaps, []);
  assert.deepEqual(v.probe.soft404, { probeUrl: "", status: null, isSoft404: false });
  assert.deepEqual(Object.values(v.probe.headers), [null, null, null, null, null, null, null]);
  assert.deepEqual(Object.keys(v.probe.robots).sort(), ["blocksEntry", "bytes", "disallowAll", "found", "sitemaps", "status", "url"]);
  assert.deepEqual(v.probe.robots.sitemaps, []);
  assert.equal(v.probe.robots.bytes, 0);

  // 保留的只有 UI 真用到的 / 无付费价值的标量
  assert.equal(v.probe.entryUrl, r.probe.entryUrl);
  assert.equal(v.probe.host, r.probe.host);
  assert.deepEqual(v.probe.blocked, r.probe.blocked);
  assert.equal(v.probe.jsDependent, r.probe.jsDependent);
  assert.deepEqual(v.probe.coverage, r.probe.coverage);
  assert.equal(v.probe.entryError, null);

  // 原始证据一条都不在 probe 里
  const probeJson = JSON.stringify(v.probe);
  for (const leak of [
    ...(r.probe.brokenInternal ?? []).map((b) => b.to),
    ...(r.probe.crawlTtfb?.slowest ?? []).map((s) => s.url),
    // 入口 URL 本身是白名单字段(entryUrl),只查变体特有的 URL
    ...r.probe.variants.map((x) => x.url).filter((u) => u !== r.probe.entryUrl),
    "secret-admin-path",
    "robots-internal-error-detail",
    "nginx",
  ]) {
    assert.ok(!probeJson.includes(leak), `probe leaks ${leak}`);
  }
  // 类型之外的运行期字段与内部成本:整个响应体里都不能有
  const json = JSON.stringify(v);
  for (const leak of ["LEAK", "\"raw\"", "\"groups\"", "internalDebug", "internalTrace"]) assert.ok(!json.includes(leak), `free view leaks ${leak}`);
  assert.deepEqual(v.cost, { dataforseoUsd: 0, calls: 0 });
});

test("locked view: a blocked report keeps the firewall evidence the outcome notice needs, nothing else", () => {
  const r = makeResult(brokenSite());
  r.probe.blocked = { detected: true, kind: "waf", evidence: "403 from cloudflare on AEOeyeBot" };
  r.meta.outcome = "blocked";
  const v = toPublicView(r, false);
  assert.deepEqual(v.probe.blocked, { detected: true, kind: "waf", evidence: "403 from cloudflare on AEOeyeBot" });
  assert.equal(v.meta.outcome, "blocked");
});

test("unlocked view keeps the probe untouched (paid report shows every list)", () => {
  const r = withRuntimeExtras(makeResult(brokenSite(), { paid: true }));
  const v = toPublicView(r, true);
  assert.equal(v, r);
  assert.equal(v.probe.brokenInternal?.length, r.probe.brokenInternal?.length);
});

/* ============================================================
   复审 C8:退款 / 拒付撤销后(unlocked=false 但 plan=full)还原成免费形状
   ============================================================ */

const PAID_EVIDENCE = "PAID-ONLY: 5 referring domains (5 main domains, 4 IPs) link to example.com";
const PAID_FIX = "PAID-FIX: earn links from industry directories";

function paidCheck(id: string, dimension: "authority" | "visibility" | "competitors", over: Partial<SeoCheck> = {}): SeoCheck {
  return { id, dimension, title: `${id} title`, status: "fail", severity: "high", weight: 3, evidence: [`${PAID_EVIDENCE} (${id})`], affected: [`https://example.com/paid-affected-${id}`], fix: PAID_FIX, effort: "medium", ...over };
}

/** plan=full 的结果:站内检查 + 付费检查,付费维度带真实分数,路线图第 1 项是付费检查(最坏情况) */
function revokedFull(base = makeResult(brokenSite(), { paid: true })): SeoAuditResult {
  const r = base;
  const paid = [
    paidCheck("auth.referring-domains", "authority"),
    paidCheck("vis.keywords", "visibility"),
    paidCheck("vis.index-ratio", "visibility", { status: "warn" }),
    paidCheck("comp.gap", "competitors", { severity: "medium" }),
    paidCheck("auth.rank", "authority", { status: "pass", severity: "low", evidence: [`${PAID_EVIDENCE} rank`] }),
  ];
  r.checks = [...r.checks, ...paid];
  r.dimensions = r.dimensions.map((d) =>
    d.id === "authority" || d.id === "visibility" || d.id === "competitors" ? { ...d, score: 53, locked: false, pass: 1, warn: 1, fail: 2, na: 0, summary: "PAID-SUMMARY: 2 failing of 4 measured checks" } : d
  );
  r.roadmap = [{ checkId: "auth.referring-domains", title: "paid first", bucket: "this_week", impact: 9, effort: "low", pagesAffected: 1, fix: PAID_FIX }, ...(r.roadmap ?? [])];
  r.topIssues = ["auth.referring-domains", ...r.topIssues];
  r.meta.blockers = [...(r.meta.blockers ?? []), "vis.keywords"];
  r.cost = { dataforseoUsd: 0.091, calls: 7 };
  return r;
}

test("revoked full report (unlocked=false, plan=full): paid checks removed, paid dimensions nulled, roadmap/topIssues/blockers on-site only, no paid evidence anywhere", () => {
  const r = revokedFull();
  const paidIds = new Set(r.checks.filter((c) => c.dimension === "authority" || c.dimension === "visibility" || c.dimension === "competitors").map((c) => c.id));
  const v = toPublicView(r, false);

  assert.deepEqual(v.checks.filter((c) => paidIds.has(c.id)).map((c) => c.id), [], "no paid-dimension check survives, not even as a locked title");
  for (const d of v.dimensions.filter((x) => x.id === "authority" || x.id === "visibility" || x.id === "competitors")) {
    assert.equal(d.score, null, `${d.id} score hidden`);
    assert.equal(d.locked, true);
    assert.deepEqual([d.pass, d.warn, d.fail, d.na], [0, 0, 0, 0], `${d.id} counts hidden`);
    assert.equal(d.summary, "Unlock the full report to see this dimension.");
  }
  // 站内维度不受影响
  for (const d of v.dimensions.filter((x) => !(x.id === "authority" || x.id === "visibility" || x.id === "competitors"))) {
    assert.deepEqual(d, r.dimensions.find((o) => o.id === d.id));
  }
  assert.ok(v.roadmap && v.roadmap.length === 1 && !paidIds.has(v.roadmap[0].checkId), "first roadmap item is an on-site check");
  const onsiteRoadmap = (r.roadmap ?? []).filter((it) => !paidIds.has(it.checkId));
  const counts = { this_week: 0, this_month: 0, later: 0 };
  for (const it of onsiteRoadmap) counts[it.bucket] += 1;
  assert.ok(v.meta.lockedSections.includes(`roadmap:this_week=${counts.this_week},this_month=${counts.this_month},later=${counts.later}`), "bucket counts exclude paid items");
  assert.ok(v.topIssues.every((id) => !paidIds.has(id)));
  assert.ok((v.meta.blockers ?? []).every((id) => !paidIds.has(id)));
  assert.equal(v.authority, null);
  assert.equal(v.visibility, null);
  assert.equal(v.competitors, null);
  assert.equal(v.psi.desktop, null);
  assert.deepEqual(v.pages, []);
  assert.deepEqual(v.cost, { dataforseoUsd: 0, calls: 0 });

  const json = JSON.stringify(v);
  for (const leak of ["PAID-ONLY", "PAID-FIX", "PAID-SUMMARY", "paid-affected-", "0.091"]) assert.ok(!json.includes(leak), `revoked view leaks ${leak}`);
  assert.equal(v.meta.lockedSections.includes(`checks=${v.checks.filter((c) => c.locked).length}`), true);
});

test("freeFullDetailIds never selects a paid-dimension check, even when the site has few on-site issues", () => {
  // 健康站点:站内没有 critical/high 问题,旧实现会把付费的 high fail 检查塞进免费完整细节名单
  const r = revokedFull(makeResult(healthySite(), { paid: true }));
  const ids = freeFullDetailIds(r);
  for (const id of ids) {
    const c = r.checks.find((x) => x.id === id)!;
    assert.ok(!(c.dimension === "authority" || c.dimension === "visibility" || c.dimension === "competitors"), `${id} is paid`);
  }
  const v = toPublicView(r, false);
  assert.ok(!JSON.stringify(v).includes("PAID-ONLY"));
});

test("free (never paid) result: paid dimensions keep their locked shape untouched", () => {
  const r = makeResult(brokenSite());
  const v = toPublicView(r, false);
  assert.deepEqual(v.dimensions, r.dimensions);
});

/* ============================================================
   复审 C2:meta.cachedFrom 对外只能是时间戳,不能是来源报告的 id
   ============================================================ */

test("cachedFrom: a legacy source id is replaced in both views; ISO timestamps pass through; no cachedFrom keeps identity", async () => {
  const { publicCachedFrom } = await import("../view");
  const legacy = makeResult(brokenSite());
  legacy.meta.cachedFrom = "Ab3dE5gH7jK"; // 旧副本行:来源行的 shortId
  for (const unlocked of [false, true]) {
    const v = toPublicView(legacy, unlocked);
    assert.ok(v.meta.cachedFrom, "still marked as cached (UI tests truthiness)");
    assert.notEqual(v.meta.cachedFrom, "Ab3dE5gH7jK", `source id leaks (unlocked=${unlocked})`);
    assert.ok(!JSON.stringify(v).includes("Ab3dE5gH7jK"));
  }
  assert.equal(legacy.meta.cachedFrom, "Ab3dE5gH7jK", "input not mutated");
  assert.equal(publicCachedFrom(legacy), legacy.generatedAt);

  const fresh = makeResult(brokenSite(), { paid: true });
  fresh.meta.cachedFrom = "2026-09-30T08:00:00.000Z";
  assert.equal(toPublicView(fresh, true), fresh, "timestamp → paid view returned as-is");
  assert.equal(toPublicView(fresh, false).meta.cachedFrom, "2026-09-30T08:00:00.000Z");
  assert.equal(publicCachedFrom({ generatedAt: "", meta: { ...fresh.meta, cachedFrom: null } }), null);
  assert.equal(publicCachedFrom({ generatedAt: "not-a-date", meta: { ...fresh.meta, cachedFrom: "zzzzzzzzzzz" } }), "cached");
});
