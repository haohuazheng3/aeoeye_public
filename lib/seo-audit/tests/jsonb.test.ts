import test from "node:test";
import assert from "node:assert/strict";
import type { SitemapInfo } from "../types";

// repo.ts → lib/db → lib/env 在导入时校验 DATABASE_URL:先放一个解析不了的测试地址(.invalid 是保留域名),
// 再动态导入 —— 这组测试是纯函数测试,绝不能碰真实库。
process.env.DATABASE_URL = "postgres://test:test@db.invalid:5432/test";
const load = async () => ({ ...(await import("../repo")), ...(await import("../run")) });

// 落库清洗:半个 emoji(孤立代理项)与 \u0000 会让 Postgres 拒收整份 jsonb
test("cleanText replaces lone surrogates and strips NUL, keeps valid pairs", async () => {
  const { cleanText } = await load();
  const emoji = "Launch 🚀";
  const cut = emoji.slice(0, emoji.length - 1); // 劈开代理对
  assert.equal(cleanText(cut), "Launch �");
  assert.equal(cleanText(emoji), emoji);
  assert.equal(cleanText("a\u0000b"), "ab");
  assert.equal(cleanText("\uDE80 tail"), "� tail"); // 孤立低代理项
});

test("jsonbSafe cleans nested values and keys, and survives a JSON round trip Postgres accepts", async () => {
  const { jsonbSafe } = await load();
  const dirty = { title: "🚀".slice(0, 1), og: { ["og:\uD83D"]: "x\u0000" }, list: ["ok", "\uDE80"], n: 3, nil: null };
  const clean = jsonbSafe(dirty);
  const json = JSON.stringify(clean);
  assert.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(json), "no escaped lone surrogates remain");
  assert.ok(!json.includes("\\u0000"), "no NUL escapes remain");
  assert.equal(clean.n, 3);
  assert.equal(clean.nil, null);
  assert.deepEqual(Object.keys(clean.og), ["og:�"]);
});

function sm(p: Partial<SitemapInfo>): SitemapInfo {
  return { url: "", status: 200, valid: true, isIndex: false, urlCount: 0, lastmodShare: 1, newestLastmod: null, children: [], ...p };
}

test("sitemapUrlCount counts leaves only and returns null when an index lists unfetched children", async () => {
  const { sitemapUrlCount } = await load();
  const complete = [sm({ url: "/i.xml", isIndex: true, urlCount: 60, children: ["/a.xml", "/b.xml"] }), sm({ url: "/a.xml", urlCount: 30 }), sm({ url: "/b.xml", urlCount: 30 })];
  assert.equal(sitemapUrlCount({ sitemaps: complete }), 60);
  const partial = [sm({ url: "/i.xml", isIndex: true, urlCount: 60, children: ["/a.xml", "/b.xml", "/c.xml"] }), sm({ url: "/a.xml", urlCount: 30 }), sm({ url: "/b.xml", urlCount: 30 })];
  assert.equal(sitemapUrlCount({ sitemaps: partial }), null);
});
