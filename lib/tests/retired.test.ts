import test from "node:test";
import assert from "node:assert/strict";
import retired from "../../content/retired.json";
import { RETIRED_GONE, isRetiredPath, isRetiredPage, isRetiredSlug, resolveRetiredHref, retiredPath, retiredTarget } from "../content/retired";

/* 下线名单的离线测试。
   2026-09-24 第一轮(博客 slug)→ 2026-10-03 扩到全部内容栏目的完整路径 → 2026-10-24 站长决定停做 SEO 内容,
   全部内容页 410,只保留跳到 /tools 的合并。锁住三件事:老条目(无前导斜杠)仍按 /blog/<slug> 解释;
   任何内容页都已下线;合并只允许落在非内容页上。 */

const CONTENT_SECTION = /^\/(?:blog|answers|guides|compare|vs|alternatives|for|glossary)\//;

test("legacy bare slugs still mean /blog/<slug>", () => {
  assert.equal(retiredPath("zoom-pricing"), "/blog/zoom-pricing");
  assert.equal(retiredPath("/answers/X"), "/answers/x");
  assert.ok(isRetiredSlug("zoom-pricing"), "a 2026-09-24 gone post");
  assert.ok(RETIRED_GONE.has("/blog/zoom-pricing"));
});

test("every content page is retired (2026-10-24: SEO content discontinued)", () => {
  assert.ok(isRetiredSlug("chatgpt-seo"), "the former top blog page");
  assert.ok(isRetiredPage("answers", "what-is-ai-visibility"));
  assert.ok(isRetiredPage("vs", "nightwatch"));
  assert.ok(isRetiredPage("glossary", "gptbot"));
  assert.ok(isRetiredPage("guides", "how-to-rank-in-chatgpt"));
  assert.ok(isRetiredPath("/blog/perplexity-vs-claude"));
  // 名单里不能有任何"合并到内容页"的条目 —— 那些目标页也已经没了
  for (const to of Object.values(retired.merged)) assert.ok(!CONTENT_SECTION.test(retiredPath(to)), `${to} is a content page`);
});

test("merges survive only when they land on a live non-content page", () => {
  assert.equal(retiredTarget("/blog/schema-markup-generator"), "/tools/schema-generator");
  assert.equal(retiredTarget("/blog/robots-txt-generator"), "/tools/ai-robots-txt-generator");
  // 曾经的链 chatgpt-user-statistics → chatgpt-statistics → ai-search-statistics 终点是博客页 → 现在整条链都是 410
  assert.equal(retiredTarget("chatgpt-user-statistics"), null);
  assert.ok(RETIRED_GONE.has("/blog/chatgpt-user-statistics"));
  for (const from of Object.keys(retired.merged)) {
    const t = retiredTarget(from);
    assert.ok(t, `${from} resolves`);
    assert.ok(!isRetiredPath(t!), `${from} → ${t} must land on a live page`);
  }
});

test("body links: content links drop to plain text; tool merges still rewrite", () => {
  assert.equal(resolveRetiredHref("/answers/can-you-do-seo-for-chatgpt"), null);
  assert.equal(resolveRetiredHref("/blog/chatgpt-seo"), null);
  assert.equal(resolveRetiredHref("https://aeoeye.com/compare/geo-vs-seo#table"), null);
  assert.equal(resolveRetiredHref("/blog/schema-markup-generator/"), "/tools/schema-generator");
  assert.equal(resolveRetiredHref("/glossary/ai-agent"), null);
  assert.equal(resolveRetiredHref("https://example.com/blog/openai-revenue"), "https://example.com/blog/openai-revenue", "other sites untouched");
  assert.equal(resolveRetiredHref("/tools/schema-generator"), "/tools/schema-generator");
  assert.equal(resolveRetiredHref(undefined), undefined);
});
