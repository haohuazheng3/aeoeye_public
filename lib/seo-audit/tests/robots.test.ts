import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRobots, isPathAllowed, parseRobots, type RobotsRules } from "../robots";

const FIXTURE = `# Example robots
User-agent: *
Disallow: /admin/
Disallow: /tmp
Allow: /admin/public
Crawl-delay: 5

User-agent: AEOeyeBot
User-agent: OtherBot
Disallow: /private/

User-Agent: Googlebot/2.1
Disallow:

Sitemap: https://example.com/sitemap.xml
Sitemap: /sitemap2.xml
Sitemap: https://example.com/sitemap.xml
`;

const rules = (text: string): RobotsRules => ({ ...emptyRobots(200), found: true, ...parseRobots(text) });

test("parseRobots builds groups, merges consecutive user-agents, collects sitemaps", () => {
  const r = parseRobots(FIXTURE);
  assert.equal(r.groups.length, 3);
  assert.deepEqual(r.groups[0], { agents: ["*"], allow: ["/admin/public"], disallow: ["/admin/", "/tmp"] });
  assert.deepEqual(r.groups[1], { agents: ["aeoeyebot", "otherbot"], allow: [], disallow: ["/private/"] });
  assert.deepEqual(r.groups[2], { agents: ["googlebot"], allow: [], disallow: [] });
  assert.deepEqual(r.sitemaps, ["https://example.com/sitemap.xml", "/sitemap2.xml"]);
  assert.equal(r.disallowAll, false);
});

test("isPathAllowed picks the most specific agent group, falls back to *", () => {
  const r = rules(FIXTURE);
  // AEOeyeBot has its own group → only /private/ is off limits
  assert.equal(isPathAllowed(r, "/admin/x"), true);
  assert.equal(isPathAllowed(r, "/private/x"), false);
  assert.equal(isPathAllowed(r, "/private/x", "AEOeyeBot/1.0"), false);
  // unknown bot → * group
  assert.equal(isPathAllowed(r, "/admin/x", "SomeBot"), false);
  assert.equal(isPathAllowed(r, "/admin/public/x", "SomeBot"), true, "longest match (allow) wins");
  assert.equal(isPathAllowed(r, "/tmpfoo", "SomeBot"), false, "rules are prefix matches");
  assert.equal(isPathAllowed(r, "/Tmp", "SomeBot"), true, "matching is case-sensitive");
  assert.equal(isPathAllowed(r, "/", "SomeBot"), true);
  // Googlebot group exists but has no rules → everything allowed
  assert.equal(isPathAllowed(r, "/admin/x", "Googlebot"), true);
});

test("wildcards and end anchors", () => {
  const r = rules("User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?\nDisallow: /cgi-bin/*/print\n");
  assert.equal(isPathAllowed(r, "/a/b.pdf"), false);
  assert.equal(isPathAllowed(r, "/a/b.pdfx"), true);
  assert.equal(isPathAllowed(r, "/x?y=1"), false);
  assert.equal(isPathAllowed(r, "/x"), true);
  assert.equal(isPathAllowed(r, "/cgi-bin/foo/print"), false);
  assert.equal(isPathAllowed(r, "/cgi-bin/foo/view"), true);
});

test("disallowAll detects site-wide blocks for * or Googlebot only", () => {
  assert.equal(parseRobots("User-agent: *\nDisallow: /").disallowAll, true);
  assert.equal(parseRobots("User-agent: Googlebot\nDisallow: /").disallowAll, true);
  assert.equal(parseRobots("User-agent: Bingbot\nDisallow: /").disallowAll, false);
  assert.equal(parseRobots("User-agent: *\nDisallow: /\nAllow: /").disallowAll, false, "same length → allow wins");
  assert.equal(parseRobots("User-agent: *\nDisallow: /*").disallowAll, true);
  assert.equal(parseRobots("User-agent: *\nDisallow:").disallowAll, false, "empty disallow means allow all");
});

test("edge cases: missing robots, rules before any agent, missing leading slash, CRLF", () => {
  assert.equal(isPathAllowed(emptyRobots(404), "/anything"), true);
  const orphan = parseRobots("Disallow: /\nUser-agent: *\nAllow: /");
  assert.equal(orphan.groups.length, 1);
  assert.deepEqual(orphan.groups[0].disallow, []);
  const slashless = rules("User-agent: *\r\nDisallow: admin\r\n");
  assert.deepEqual(slashless.groups[0].disallow, ["/admin"]);
  assert.equal(isPathAllowed(slashless, "/admin/x", "x"), false);
  const withComments = rules("User-agent: * # everyone\nDisallow: /secret # hush\n");
  assert.equal(isPathAllowed(withComments, "/secret/a", "x"), false);
  assert.equal(isPathAllowed(withComments, "/public", "x"), true);
});

test("a new user-agent after rules starts a new group", () => {
  const r = parseRobots("User-agent: a\nDisallow: /a\nUser-agent: b\nDisallow: /b\n");
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[0].agents, ["a"]);
  assert.deepEqual(r.groups[1].agents, ["b"]);
});

/* ---------- V2:robots-parser 匹配语义 + 扩展字段 ---------- */

import { AI_CRAWLERS, agentToken, crawlDelayFor, isPathAllowedFor, looksLikeHtml } from "../robots";

test("V2: product tokens match exactly (case-insensitive, version stripped) — Googlebot-Image is not Googlebot", () => {
  const r = rules("User-agent: Googlebot\nDisallow: /g\nUser-agent: Googlebot-Image\nDisallow: /img\nUser-agent: *\nDisallow: /all\n");
  assert.equal(isPathAllowed(r, "/g", "Googlebot"), false);
  assert.equal(isPathAllowed(r, "/g", "googlebot/2.1"), false);
  assert.equal(isPathAllowed(r, "/g", "Googlebot-Image"), true, "own group, /g is not in it");
  assert.equal(isPathAllowed(r, "/img", "Googlebot-Image"), false);
  assert.equal(isPathAllowed(r, "/all", "Googlebot"), true, "a bot with its own group never falls back to *");
  assert.equal(isPathAllowed(r, "/all", "Bingbot"), false);
  assert.equal(agentToken("Mozilla/5.0 (compatible; AEOeyeBot/1.0; +https://aeoeye.com/bot)"), "aeoeyebot");
  assert.equal(isPathAllowed(rules("User-agent: AEOeyeBot\nDisallow: /x\n"), "/x", "Mozilla/5.0 (compatible; AEOeyeBot/1.0; +https://aeoeye.com/bot)"), false);
});

test("V2: Google matching corner cases — Allow wins ties, $ anchors, * mid-pattern, percent-encoding, query strings", () => {
  const r = rules(["User-agent: *", "Disallow: /fish", "Allow: /fish", "Disallow: /*.php$", "Allow: /shop/*/sale", "Disallow: /shop/", "Disallow: /*?sort=", "Disallow: /caf%C3%A9"].join("\n"));
  assert.equal(isPathAllowed(r, "/fish", "x"), true, "same length → Allow wins");
  assert.equal(isPathAllowed(r, "/fishheads", "x"), true);
  assert.equal(isPathAllowed(r, "/index.php", "x"), false);
  assert.equal(isPathAllowed(r, "/index.php?x=1", "x"), true, "$ anchors the full path+query");
  assert.equal(isPathAllowed(r, "/shop/shoes/sale", "x"), true, "longer Allow beats shorter Disallow");
  assert.equal(isPathAllowed(r, "/shop/shoes", "x"), false);
  assert.equal(isPathAllowed(r, "/list?sort=price", "x"), false);
  assert.equal(isPathAllowed(r, "/list?page=2", "x"), true);
  assert.equal(isPathAllowed(r, "/café", "x"), false, "unicode path is matched against the percent-encoded rule");
  assert.equal(isPathAllowed(r, "/caf%C3%A9", "x"), false);
});

test("V2: extended fields — crawlDelay for our UA, googlebotDisallowAll, aiCrawlers, hasSitemapDirective, raw, isHtml", () => {
  const p = parseRobots(FIXTURE);
  assert.equal(p.crawlDelay, null, "the * group's Crawl-delay does not apply: AEOeyeBot has its own group");
  assert.equal(p.googlebotDisallowAll, false);
  assert.equal(p.hasSitemapDirective, true);
  assert.equal(p.isHtml, false);
  assert.equal(p.raw, FIXTURE);
  // v4:Applebot 没有自己的组时按 Googlebot 的组走(Apple 官方规则);FIXTURE 里 Googlebot 组放行一切 → allow
  assert.deepEqual(p.aiCrawlers, { ...Object.fromEntries(Object.keys(AI_CRAWLERS).map((k) => [k, "unspecified"])), Applebot: "allow" });

  const q = parseRobots("User-agent: *\nCrawl-delay: 3\nDisallow: /\nUser-agent: Googlebot\nAllow: /\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /private\n");
  assert.equal(q.crawlDelay, 3, "falls back to * when we have no group");
  assert.equal(q.disallowAll, true, "* is blocked");
  assert.equal(q.googlebotDisallowAll, false, "Googlebot's own group allows everything");
  const ai = q.aiCrawlers ?? {};
  assert.equal(ai.GPTBot, "disallow");
  assert.equal(ai.CCBot, "disallow");
  assert.equal(ai.ClaudeBot, "allow", "own group, only /private blocked");
  assert.equal(ai.PerplexityBot, "disallow", "no own group and * blocks everything");
  assert.equal(ai["Google-Extended"], "disallow");
  assert.equal(q.hasSitemapDirective, false);

  const g = parseRobots("User-agent: Googlebot\nDisallow: /\nUser-agent: *\nAllow: /\n");
  assert.equal(g.googlebotDisallowAll, true);
  assert.equal(g.disallowAll, true);

  const full = rules("User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /\n");
  assert.equal(isPathAllowedFor(full, "/", "Googlebot"), true);
  assert.equal(isPathAllowedFor(full, "/", "AEOeyeBot"), false);
  assert.equal(crawlDelayFor({ ...rules("User-agent: *\nCrawl-delay: 2\nUser-agent: Bingbot\nCrawl-delay: 7\n") }, "Bingbot"), 7);
  assert.equal(crawlDelayFor({ ...rules("User-agent: *\nCrawl-delay: 2\n") }, "Bingbot"), 2);
  assert.equal(crawlDelayFor(emptyRobots(404)), null);

  assert.equal(looksLikeHtml("<!DOCTYPE html><html>"), true);
  assert.equal(looksLikeHtml("﻿  <html lang=en>"), true);
  assert.equal(looksLikeHtml("User-agent: *"), false);
  assert.equal(parseRobots("<html><body>404</body></html>").isHtml, true);
});

/* ---------- v4:AI 爬虫按用途分组(检索类计分 / 训练类只作证据) ---------- */

import { AI_RETRIEVAL_BOTS, AI_TRAINING_BOTS } from "../robots";

test("v4: AI crawler lists — 8 retrieval + 6 training bots, disjoint, exactly the keys of AI_CRAWLERS; the v2 six keep their order", () => {
  assert.deepEqual(
    [...AI_RETRIEVAL_BOTS],
    ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "Bingbot", "Applebot"]
  );
  // ClaudeBot 是 Anthropic 的训练爬虫;Claude 的检索 / 引用走 Claude-SearchBot 与 Claude-User
  assert.deepEqual([...AI_TRAINING_BOTS], ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Applebot-Extended", "Bytespider"]);
  assert.ok(!AI_RETRIEVAL_BOTS.some((b) => AI_TRAINING_BOTS.includes(b)), "a bot is either retrieval or training, never both");
  assert.deepEqual(Object.keys(AI_CRAWLERS).sort(), [...AI_RETRIEVAL_BOTS, ...AI_TRAINING_BOTS].sort(), "every listed bot gets a verdict, nothing else");
  assert.deepEqual(Object.keys(AI_CRAWLERS).slice(0, 6), ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "OAI-SearchBot", "CCBot"]);
  for (const [name, token] of Object.entries(AI_CRAWLERS)) assert.equal(token, name.toLowerCase(), "robots product token = lower-cased name");
  assert.ok(Object.isFrozen(AI_RETRIEVAL_BOTS) && Object.isFrozen(AI_TRAINING_BOTS), "shared lists cannot be mutated by a caller");
});

test("v4: parseRobots gives every retrieval and training bot a verdict (own group → allow/disallow; none → * fallback)", () => {
  const p = parseRobots(
    [
      "User-agent: *",
      "Disallow: /admin",
      "",
      "User-agent: GPTBot",
      "User-agent: CCBot",
      "User-agent: Bytespider",
      "Disallow: /",
      "",
      "User-agent: ChatGPT-User",
      "User-agent: Claude-SearchBot",
      "Allow: /",
      "",
      "User-agent: PerplexityBot",
      "Disallow: /",
      "",
      "User-agent: Bingbot",
      "Disallow: /private",
    ].join("\n")
  );
  const ai = p.aiCrawlers ?? {};
  for (const bot of [...AI_RETRIEVAL_BOTS, ...AI_TRAINING_BOTS]) assert.ok(bot in ai, `${bot} has a verdict`);
  assert.deepEqual(ai, {
    GPTBot: "disallow",
    ClaudeBot: "unspecified",
    PerplexityBot: "disallow",
    "Google-Extended": "unspecified",
    "OAI-SearchBot": "unspecified",
    CCBot: "disallow",
    "ChatGPT-User": "allow",
    "Perplexity-User": "unspecified",
    "Claude-SearchBot": "allow",
    "Claude-User": "unspecified",
    Bingbot: "allow",
    Applebot: "unspecified",
    "Applebot-Extended": "unspecified",
    Bytespider: "disallow",
  });

  // * 整站封锁时,没有自己组的机器人一律 disallow;有组的照自己的组
  const blocked = parseRobots("User-agent: *\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /\n").aiCrawlers ?? {};
  assert.equal(blocked["OAI-SearchBot"], "allow");
  assert.equal(blocked["Perplexity-User"], "disallow");
  assert.equal(blocked.Bytespider, "disallow");
  assert.equal(Object.keys(blocked).length, 14);
});

test("v4: Applebot follows Googlebot's group when it has none of its own (Apple's documented rule); Applebot-Extended does not", () => {
  // 只放行 Google 的站:Applebot 实际可以抓(跟 Googlebot),不能误报成被封
  const onlyGoogle = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n").aiCrawlers ?? {};
  assert.equal(onlyGoogle.Applebot, "allow");
  assert.equal(onlyGoogle["Applebot-Extended"], "disallow", "the control token has no Googlebot fallback: * applies");
  assert.equal(onlyGoogle.Bingbot, "disallow");

  const googleBlocked = parseRobots("User-agent: Googlebot\nDisallow: /\n").aiCrawlers ?? {};
  assert.equal(googleBlocked.Applebot, "disallow");
  assert.equal(googleBlocked.Bingbot, "unspecified");

  // Applebot 自己的组优先于回退
  const own = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: Applebot\nAllow: /\n").aiCrawlers ?? {};
  assert.equal(own.Applebot, "allow");

  // 没有 Googlebot 组时照常回退到 *
  assert.equal(parseRobots("User-agent: *\nDisallow: /\n").aiCrawlers?.Applebot, "disallow");
  assert.equal(parseRobots("User-agent: *\nDisallow: /tmp\n").aiCrawlers?.Applebot, "unspecified");
});
