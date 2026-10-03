import test from "node:test";
import assert from "node:assert/strict";
import retired from "../../content/retired.json";
import { RETIRED_GONE, isRetiredPath, isRetiredPage, isRetiredSlug, resolveRetiredHref, retiredPath, retiredTarget } from "../content/retired";

/* 下线名单的离线测试(2026-10-03 第二轮清理把名单从"博客 slug"扩到"全部内容栏目的完整路径")。
   锁住三件事:老条目(无前导斜杠)仍按 /blog/<slug> 解释;合并链一跳到最终页;正文链接按栏目改写 / 拆掉。 */

test("legacy bare slugs still mean /blog/<slug>", () => {
  assert.equal(retiredPath("zoom-pricing"), "/blog/zoom-pricing");
  assert.equal(retiredPath("/answers/X"), "/answers/x");
  assert.ok(isRetiredSlug("zoom-pricing"), "a 2026-09-24 gone post");
  assert.ok(RETIRED_GONE.has("/blog/zoom-pricing"));
});

test("round-two retirements cover every content section", () => {
  assert.ok(isRetiredPage("answers", "what-is-llm-visibility"));
  assert.ok(isRetiredPage("guides", "how-to-rank-in-chatgpt"));
  assert.ok(isRetiredPage("compare", "geo-vs-seo"));
  assert.ok(isRetiredPage("glossary", "ai-agent"));
  assert.ok(isRetiredPath("/blog/perplexity-vs-claude"));
  assert.ok(!isRetiredPage("answers", "what-is-ai-visibility"), "canonical pages stay live");
  assert.ok(!isRetiredSlug("chatgpt-seo"));
});

test("merge chains resolve to the final page in one hop", () => {
  // 2026-09-24: chatgpt-user-statistics → chatgpt-statistics;2026-10-03: chatgpt-statistics → ai-search-statistics
  assert.equal(retiredTarget("chatgpt-user-statistics"), "/blog/ai-search-statistics");
  assert.equal(retiredTarget("/blog/seo-vs-geo"), "/blog/aeo-vs-seo");
  assert.equal(retiredTarget("/guides/how-to-rank-in-chatgpt"), "/blog/chatgpt-seo");
  assert.equal(retiredTarget("/blog/chatgpt-seo"), null, "a live page has no target");
  // 名单里每个合并目标都不能再是被合并 / 被删除的页
  for (const from of Object.keys(retired.merged)) {
    const t = retiredTarget(from);
    assert.ok(t, `${from} resolves`);
    assert.ok(!isRetiredPath(t!), `${from} → ${t} must land on a live page`);
  }
});

test("body links are rewritten per section; gone pages become plain text", () => {
  assert.equal(resolveRetiredHref("/answers/can-you-do-seo-for-chatgpt"), "/blog/chatgpt-seo");
  assert.equal(resolveRetiredHref("https://aeoeye.com/compare/geo-vs-seo#table"), "/blog/aeo-vs-seo");
  assert.equal(resolveRetiredHref("/blog/schema-markup-generator/"), "/tools/schema-generator");
  assert.equal(resolveRetiredHref("/blog/openai-revenue"), null);
  assert.equal(resolveRetiredHref("/glossary/ai-agent"), null);
  assert.equal(resolveRetiredHref("/blog/chatgpt-seo"), "/blog/chatgpt-seo");
  assert.equal(resolveRetiredHref("https://example.com/blog/openai-revenue"), "https://example.com/blog/openai-revenue", "other sites untouched");
  assert.equal(resolveRetiredHref("/tools/schema-generator"), "/tools/schema-generator");
  assert.equal(resolveRetiredHref(undefined), undefined);
});
