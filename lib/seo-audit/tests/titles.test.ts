/* ============================================================
   检查项标题(复审契约第 7 条):npx tsx --test lib/seo-audit/tests/titles.test.ts

   为什么单独一份测试:标题表与 8 个产出检查的文件是分开维护的,
   新加一条检查却忘了写标题、或者标题表里留着已删除的 id,都只会在
   报告页上悄悄变成"显示 id / 显示旧句子"。这里把所有站内场景 + 付费检查
   全跑一遍,逐条核对:
   - 每个产出的 id 都在表里,表里每个 id 都会被产出(没有死条目);
   - fail / warn 的标题就是表里的问题句,pass / na 是达标句,info 是 info 句(没有则达标句);
   - name 是中性名;问题句 ≤70 字符、和达标句不同、彼此不重复。
   ============================================================ */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { AuthorityResult, CompetitorsResult, SeoCheck, VisibilityResult } from "../types";
import { runAllOnsiteChecks, type CheckContext } from "../checks";
import { CHECK_TITLES, checkTitle, checkName } from "../checks/titles";
import { healthySite, brokenSite, stripV2, tlsBrokenSite, subdomainSite, jsShellSite, abs } from "./fixtures";

// @/lib/env 在 import 时校验 DATABASE_URL —— dataforseo.ts 要在环境放好之后再动态 import
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

let dfs: typeof import("../dataforseo");
before(async () => {
  dfs = await import("../dataforseo");
});

/** 站内场景:覆盖 pass / warn / fail / na / info 的各种出口 */
function onsiteScenarios(): Record<string, CheckContext> {
  const blocked = healthySite();
  blocked.probe.blocked = { detected: true, kind: "waf", evidence: "HTTP 403 with cf-mitigated: challenge" };
  blocked.pages = [];
  blocked.entry = null;

  // SPA:未知 URL 回 200 的完整页面(soft404 = info)、没有面包屑(两个 breadcrumb = info)、没有文章(thin = info)
  const spa = healthySite();
  spa.probe.soft404 = { probeUrl: abs("/aeoeye-404-probe-x1y2z3"), status: 200, isSoft404: false };
  spa.pages = spa.pages
    .filter((p) => p.pageType !== "article")
    .map((p) => ({ ...p, hasBreadcrumbSchema: false, jsonLdTypes: p.jsonLdTypes.filter((t) => t !== "BreadcrumbList"), wordCount: 80, pageType: p.pageType ?? "other" }));
  spa.entry = spa.pages[0];

  return {
    healthy: healthySite(),
    broken: brokenSite(),
    legacy: stripV2(healthySite()),
    blocked,
    spa,
    tlsExpired: tlsBrokenSite(),
    tlsNoPages: tlsBrokenSite({ withEntryPage: false }),
    subdomain: subdomainSite(),
    subdomainUnknown: subdomainSite({ altHostExists: null }),
    jsShell: jsShellSite(),
    jsShellMixed: jsShellSite({ extraPages: 6 }),
  };
}

const STRONG_AUTH: AuthorityResult = {
  rank: 320, backlinks: 50_000, referringDomains: 4_000, referringMainDomains: 3_800, referringIps: 3_000, nofollowShare: 0.2, spamScore: 4,
  brokenBacklinks: 20, brokenPages: 2, firstSeen: "2019-01-15", tld: {}, linkTypes: {},
  anchors: [{ anchor: "example", backlinks: 9_000, referringDomains: 900 }], score: 92,
  timeseries: [{ month: "2026-08", newReferringDomains: 40, lostReferringDomains: 10 }], noData: false,
};
const WEAK_AUTH: AuthorityResult = {
  rank: 5, backlinks: 100, referringDomains: 6, referringMainDomains: 6, referringIps: 5, nofollowShare: 0.8, spamScore: 45,
  brokenBacklinks: 30, brokenPages: 9, firstSeen: null, tld: {}, linkTypes: {},
  anchors: [{ anchor: "cheap seo tool", backlinks: 70, referringDomains: 3 }], score: 8,
  timeseries: [{ month: "2026-08", newReferringDomains: 1, lostReferringDomains: 5 }], noData: false,
};
const STRONG_VIS: VisibilityResult = {
  organicKeywords: 2_000, etv: 9_000, positions: { pos1: 30, pos2_3: 40, pos4_10: 120, pos11_20: 300, pos21_50: 600, pos51_100: 910 },
  movement: { isNew: 50, isUp: 30, isDown: 10, isLost: 20 },
  topKeywords: [{ keyword: "seo audit", position: 6, volume: 900, etv: 40, url: "https://example.com/audit", intent: "commercial", cpc: 3 }],
  quickWins: [{ keyword: "seo audit", position: 6, volume: 900, etv: 40, url: "https://example.com/audit", intent: "commercial", cpc: 3 }],
  score: 80, brandKeywords: 200, nonBrandKeywords: 1_800, aiOverviewShare: 0.3,
  indexEstimate: { googleResults: 90, sitemapUrls: 100, ratio: 0.9 }, noData: false,
};
const WEAK_VIS: VisibilityResult = {
  organicKeywords: 12, etv: 15, positions: { pos1: 0, pos2_3: 0, pos4_10: 1, pos11_20: 3, pos21_50: 4, pos51_100: 4 },
  movement: { isNew: 1, isUp: 0, isDown: 2, isLost: 6 }, topKeywords: [], quickWins: [], score: 10,
  brandKeywords: 10, nonBrandKeywords: 2, aiOverviewShare: null, indexEstimate: { googleResults: 5, sitemapUrls: 100, ratio: 0.05 }, noData: false,
};
const RIVALS: CompetitorsResult = { items: [{ domain: "rival.example", intersections: 40, avgPosition: 7, etv: 20_000, organicKeywords: 5_000 }], score: 40, noData: false };
const CLOSE_RIVALS: CompetitorsResult = { items: [{ domain: "peer.example", intersections: 40, avgPosition: 7, etv: 12_000, organicKeywords: 2_000 }], score: 90, noData: false };

function paidScenarios(): SeoCheck[][] {
  const noData = { ...WEAK_AUTH, noData: true };
  return [
    dfs.paidChecks(STRONG_AUTH, STRONG_VIS, CLOSE_RIVALS, "example.com"),
    dfs.paidChecks(WEAK_AUTH, WEAK_VIS, RIVALS, "example.com"),
    dfs.paidChecks(null, null, null, "example.com"),
    dfs.paidChecks(noData, { ...WEAK_VIS, noData: true }, { items: [], score: 0, noData: true }, "example.com"),
  ];
}

function allRuns(): { label: string; checks: SeoCheck[] }[] {
  const onsite = Object.entries(onsiteScenarios()).map(([label, ctx]) => ({ label, checks: runAllOnsiteChecks(ctx) }));
  const paid = paidScenarios().map((checks, i) => ({ label: `paid#${i}`, checks }));
  return [...onsite, ...paid];
}

test("every produced check id has a title entry, and every title entry is produced (no dead rows)", () => {
  const produced = new Set<string>();
  for (const run of allRuns()) {
    for (const c of run.checks) {
      produced.add(c.id);
      assert.ok(CHECK_TITLES[c.id], `${run.label}: check ${c.id} has no entry in checks/titles.ts`);
    }
  }
  const table = Object.keys(CHECK_TITLES);
  const dead = table.filter((id) => !produced.has(id));
  assert.deepEqual(dead, [], `title entries for ids no check produces: ${dead.join(", ")}`);
  assert.equal(produced.size, table.length);
  assert.equal(table.length, 90 + 17, "90 on-site checks + 17 paid checks");
});

test("titles follow the status: fail/warn → issue text, pass/na → pass text, info → info text (or pass); name is the neutral label", () => {
  const seen = new Set<string>();
  for (const run of allRuns()) {
    for (const c of run.checks) {
      const t = CHECK_TITLES[c.id];
      seen.add(c.status);
      assert.equal(c.name, t.name, `${run.label}: ${c.id} name`);
      if (c.status === "fail" || c.status === "warn") assert.equal(c.title, t.issue, `${run.label}: ${c.id} is ${c.status} but its title is "${c.title}"`);
      else if (c.status === "info") assert.equal(c.title, t.info ?? t.pass, `${run.label}: ${c.id} info title`);
      else assert.equal(c.title, t.pass, `${run.label}: ${c.id} is ${c.status} but its title is "${c.title}"`);
      assert.equal(c.title, checkTitle(c.id, c.status));
      assert.equal(c.name, checkName(c.id));
    }
  }
  for (const s of ["pass", "warn", "fail", "na", "info"]) assert.ok(seen.has(s), `scenarios exercise status ${s}`);
});

test("the title table reads well: short plain problem statements, never identical to the pass statement", () => {
  const issues = new Map<string, string>();
  for (const [id, t] of Object.entries(CHECK_TITLES)) {
    for (const [field, text] of Object.entries(t)) {
      assert.equal(typeof text, "string", `${id}.${field}`);
      assert.ok((text as string).trim().length > 0, `${id}.${field} is empty`);
      assert.equal(text, (text as string).trim(), `${id}.${field} has stray whitespace`);
      assert.ok((text as string).length <= 70, `${id}.${field} is ${(text as string).length} chars: "${text}"`);
      assert.ok(!/[.!]$/.test(text as string), `${id}.${field} is a headline, not a sentence: "${text}"`);
    }
    assert.notEqual(t.issue, t.pass, `${id}: issue text must differ from the pass text`);
    if (t.info) assert.notEqual(t.issue, t.info, `${id}: issue text must differ from the info text`);
    assert.ok(!issues.has(t.issue), `${id} and ${issues.get(t.issue)} share the issue text "${t.issue}"`);
    issues.set(t.issue, id);
  }
  // 契约里给的例子(原文)
  assert.equal(CHECK_TITLES["mobile.images.dims"].name, "Image dimensions");
  assert.equal(CHECK_TITLES["mobile.images.dims"].pass, "Images declare width and height");
  assert.equal(CHECK_TITLES["mobile.images.dims"].issue, "Images are missing width and height");
  assert.equal(CHECK_TITLES["crawl.sitemap.sample"].issue, "Sitemap lists pages Google can't index");
  // 表里没有的 id 退回 id 本身,不会渲染出空标题
  assert.equal(checkTitle("not.a.check", "fail"), "not.a.check");
  assert.equal(checkName("not.a.check"), "not.a.check");
});
