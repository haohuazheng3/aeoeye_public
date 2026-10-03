/* ============================================================
   Search Console 接入(SEO Ranking Score v2 §3.6 + 集成方 2026-10-02 安全修订)—— 纯离线测试(不联网、不碰数据库)
   覆盖:凭据(专用 GSC_SERVICE_ACCOUNT_B64 优先、token 按账号缓存)、JWT 只申请 webmasters.readonly、
   token 缓存复用与过期刷新、错误信息脱敏、4xx 不重试 / 5xx 重试一次、属性匹配、时间窗、品牌词、自蚕食阈值、
   零点击页、pullGscData 的 5 个请求体;站点控制权证明(token 格式、<head> meta 识别、DNS TXT、首页抓取规则);
   绑定协议的纯决策与 GET 视图(邮箱 / token 只在 pending、verified 下发);以及用内存端口跑通的整条流程
   (两项证明缺一不可、两个用户各自证明都通过、过期、重新同步只看访问权、断开、运行中不写)。
   运行:npm run test:seo
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";

// @/lib/env 在 import 时校验并冻结环境变量 —— 必须在任何动态 import 之前放好。
// DATABASE_URL 无条件指向解析不了的主机(.invalid 是 RFC 2606 保留域名):这里一行 SQL 都不该发出去。
// 服务账号无条件换成测试时现生成的假钥匙:shell 里导出了真凭据也绝不会被用到;专用变量无条件清空。
process.env.DATABASE_URL = "postgres://test:test@db.invalid:5432/test";
process.env.CRON_SECRET ||= "test-secret";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const FAKE_EMAIL = "aeoeye-gsc@test-project.iam.gserviceaccount.com";
const DEDICATED_EMAIL = "aeoeye-search-console@customer-project.iam.gserviceaccount.com";
function keyB64(clientEmail: string): string {
  return Buffer.from(
    JSON.stringify({
      type: "service_account",
      project_id: "test-project",
      private_key_id: "kid-123",
      private_key: PRIVATE_PEM,
      client_email: clientEmail,
      token_uri: "https://oauth2.googleapis.com/token",
    })
  ).toString("base64");
}
process.env.GOOGLE_SERVICE_ACCOUNT_B64 = keyB64(FAKE_EMAIL);
process.env.GSC_SERVICE_ACCOUNT_B64 = "";

import type { GscSite, SearchAnalyticsRow } from "../../google/search-console";
import type { ClaimFacts } from "../gsc";
import type { GscClaimRecord, GscPorts, GscReportSnapshot } from "../gsc-repo";
import type { GscData, RankingFramework, SeoAuditResult } from "../types";

const READONLY = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DAY = 86_400_000;

async function sc() {
  return import("../../google/search-console");
}
async function gsc() {
  return import("../gsc");
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

function decodeJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown>; unsigned: string; sig: Buffer } {
  const [h, p, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
    unsigned: `${h}.${p}`,
    sig: Buffer.from(s, "base64url"),
  };
}

interface Call {
  url: string;
  init?: RequestInit;
  body?: string;
}

function mockFetch(handler: (url: string, body: string | undefined, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, init, body });
    return handler(url, body, calls);
  };
  return { fetchImpl, calls };
}

const tokenOk = (token = "ya29.test-token-1", expiresIn = 3599) => jsonResponse({ access_token: token, expires_in: expiresIn, token_type: "Bearer" });

function row(keys: string[], clicks: number, impressions: number, position = 10): SearchAnalyticsRow {
  return { keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

/* ============================================================
   凭据 / JWT / token
   ============================================================ */

test("service account email comes from the decoded key (fallback GOOGLE_SERVICE_ACCOUNT_B64)", async () => {
  const { serviceAccountEmail, gscConfigured, gscCredentialSource } = await sc();
  assert.equal(gscCredentialSource(), "GOOGLE_SERVICE_ACCOUNT_B64");
  assert.equal(serviceAccountEmail(), FAKE_EMAIL);
  assert.equal(gscConfigured(), true);
});

test("GSC_SERVICE_ACCOUNT_B64 takes precedence, tokens are cached per account, and a broken dedicated key never falls back", async () => {
  const { serviceAccountEmail, gscConfigured, gscCredentialSource, gscToken, resetSearchConsoleCache } = await sc();
  resetSearchConsoleCache();
  const issuedFor: string[] = [];
  const { fetchImpl } = mockFetch((_url, body) => {
    const { payload } = decodeJwt(new URLSearchParams(body).get("assertion") ?? "");
    issuedFor.push(String(payload.iss));
    assert.equal(payload.scope, READONLY);
    return tokenOk(`ya29.for-${String(payload.iss).split("@")[0]}`);
  });
  try {
    process.env.GSC_SERVICE_ACCOUNT_B64 = keyB64(DEDICATED_EMAIL);
    assert.equal(gscCredentialSource(), "GSC_SERVICE_ACCOUNT_B64");
    assert.equal(serviceAccountEmail(), DEDICATED_EMAIL);
    assert.equal(await gscToken({ fetchImpl }), "ya29.for-aeoeye-search-console");
    assert.equal(await gscToken({ fetchImpl }), "ya29.for-aeoeye-search-console", "cached");

    // 专用变量撤掉 → 退回运维账号,而且绝不复用专用账号换来的 token
    process.env.GSC_SERVICE_ACCOUNT_B64 = "";
    assert.equal(serviceAccountEmail(), FAKE_EMAIL);
    assert.equal(await gscToken({ fetchImpl }), "ya29.for-aeoeye-gsc");
    assert.deepEqual(issuedFor, [DEDICATED_EMAIL, FAKE_EMAIL]);

    // 专用变量设了但是坏的:不静默退回运维账号(那会把运维账号的邮箱发给客户)
    process.env.GSC_SERVICE_ACCOUNT_B64 = "definitely-not-a-key";
    assert.equal(gscCredentialSource(), "GSC_SERVICE_ACCOUNT_B64");
    assert.equal(serviceAccountEmail(), null);
    assert.equal(gscConfigured(), false);
  } finally {
    process.env.GSC_SERVICE_ACCOUNT_B64 = "";
    resetSearchConsoleCache();
  }
  assert.equal(serviceAccountEmail(), FAKE_EMAIL);
});

test("JWT assertion is RS256, signed by the key, and asks for webmasters.readonly only", async () => {
  const { buildJwtAssertion, GSC_SCOPE } = await sc();
  assert.equal(GSC_SCOPE, READONLY);
  const jwt = buildJwtAssertion({ clientEmail: FAKE_EMAIL, privateKey: PRIVATE_PEM, tokenUri: TOKEN_URL, keyId: "kid-123" }, 1_790_000_000);
  const { header, payload, unsigned, sig } = decodeJwt(jwt);
  assert.deepEqual(header, { alg: "RS256", typ: "JWT", kid: "kid-123" });
  assert.equal(payload.scope, READONLY);
  assert.ok(!String(payload.scope).includes(" "), "exactly one scope");
  assert.equal(payload.iss, FAKE_EMAIL);
  assert.equal(payload.aud, TOKEN_URL);
  assert.equal(payload.iat, 1_790_000_000);
  assert.equal(Number(payload.exp) - Number(payload.iat), 3600);
  assert.equal(cryptoVerify("RSA-SHA256", Buffer.from(unsigned), publicKey, sig), true);
});

test("gscToken exchanges a readonly JWT, then reuses the cached token until a minute before expiry", async () => {
  const { gscToken, resetSearchConsoleCache } = await sc();
  resetSearchConsoleCache();
  let issued = 0;
  const { fetchImpl, calls } = mockFetch((url) => {
    assert.equal(url, TOKEN_URL);
    issued += 1;
    return tokenOk(`ya29.token-${issued}`, 3600);
  });
  let clock = 1_790_000_000_000;
  const now = () => clock;

  const t1 = await gscToken({ fetchImpl, now });
  assert.equal(t1, "ya29.token-1");
  assert.equal(calls.length, 1);
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const { payload, unsigned, sig } = decodeJwt(form.get("assertion") ?? "");
  assert.equal(payload.scope, READONLY);
  assert.equal(payload.iss, FAKE_EMAIL);
  assert.equal(cryptoVerify("RSA-SHA256", Buffer.from(unsigned), publicKey, sig), true);
  assert.equal(calls[0].init?.method, "POST");

  // 58 分钟后仍复用(过期前 1 分钟才换)
  clock += 58 * 60_000;
  assert.equal(await gscToken({ fetchImpl, now }), "ya29.token-1");
  assert.equal(calls.length, 1);

  // 进入最后 1 分钟 → 换新
  clock += 90_000;
  assert.equal(await gscToken({ fetchImpl, now }), "ya29.token-2");
  assert.equal(calls.length, 2);
  resetSearchConsoleCache();
});

test("concurrent gscToken calls share one in-flight token request", async () => {
  const { gscToken, resetSearchConsoleCache } = await sc();
  resetSearchConsoleCache();
  const { fetchImpl, calls } = mockFetch(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return tokenOk("ya29.shared");
  });
  const tokens = await Promise.all([gscToken({ fetchImpl }), gscToken({ fetchImpl }), gscToken({ fetchImpl })]);
  assert.deepEqual(tokens, ["ya29.shared", "ya29.shared", "ya29.shared"]);
  assert.equal(calls.length, 1);
  resetSearchConsoleCache();
});

test("token errors are clear and never contain the assertion or the private key", async () => {
  const { gscToken, resetSearchConsoleCache, GscError } = await sc();
  resetSearchConsoleCache();
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400));
  await assert.rejects(gscToken({ fetchImpl }), (e: unknown) => {
    assert.ok(e instanceof GscError);
    assert.equal(e.code, "bad_request");
    assert.match(e.message, /HTTP 400/);
    assert.match(e.message, /invalid_grant/);
    assert.ok(!e.message.includes("eyJ"), "no JWT in the message");
    assert.ok(!e.message.includes("PRIVATE KEY"), "no key in the message");
    return true;
  });
  assert.equal(calls.length, 1, "4xx is never retried");
  // 失败不会卡住在途标记:下一次调用重新请求
  const ok = mockFetch(() => tokenOk("ya29.after-failure"));
  assert.equal(await gscToken({ fetchImpl: ok.fetchImpl }), "ya29.after-failure");
  resetSearchConsoleCache();
});

/* ============================================================
   API 调用:脱敏、重试、属性校验
   ============================================================ */

test("API errors are scrubbed of tokens, 403 maps to forbidden and quota-403 to rate_limited", async () => {
  const { searchAnalyticsQuery, resetSearchConsoleCache, GscError } = await sc();
  resetSearchConsoleCache();
  const { fetchImpl, calls } = mockFetch((url) => {
    if (url === TOKEN_URL) return tokenOk("ya29.secret-token-xyz");
    return jsonResponse({ error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have sufficient permission for site 'sc-domain:example.com'. Bearer ya29.secret-token-xyz" } }, 403);
  });
  await assert.rejects(searchAnalyticsQuery("sc-domain:example.com", { startDate: "2026-09-01", endDate: "2026-09-28" }, { fetchImpl }), (e: unknown) => {
    assert.ok(e instanceof GscError);
    assert.equal(e.code, "forbidden");
    assert.equal(e.status, 403);
    assert.match(e.message, /sufficient permission/);
    assert.ok(!e.message.includes("ya29.secret-token-xyz"), "token scrubbed");
    return true;
  });
  assert.equal(calls.filter((c) => c.url !== TOKEN_URL).length, 1, "403 is not retried");
  assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, "Bearer ya29.secret-token-xyz");

  const quota = mockFetch((url) =>
    url === TOKEN_URL ? tokenOk() : jsonResponse({ error: { code: 403, message: "Search Analytics load quota exceeded." } }, 403)
  );
  resetSearchConsoleCache();
  await assert.rejects(searchAnalyticsQuery("sc-domain:example.com", { startDate: "2026-09-01", endDate: "2026-09-28" }, { fetchImpl: quota.fetchImpl }), (e: unknown) => {
    assert.ok(e instanceof GscError);
    assert.equal(e.code, "rate_limited");
    return true;
  });
  resetSearchConsoleCache();
});

test("5xx is retried exactly once; 429 is not retried", async () => {
  const { searchAnalyticsQuery, resetSearchConsoleCache, GscError } = await sc();
  resetSearchConsoleCache();
  let apiCalls = 0;
  const flaky = mockFetch((url) => {
    if (url === TOKEN_URL) return tokenOk();
    apiCalls += 1;
    return apiCalls === 1 ? jsonResponse({ error: { message: "backend error" } }, 503) : jsonResponse({ rows: [{ keys: [], clicks: 3, impressions: 40, ctr: 0.075, position: 7.5 }] });
  });
  const rows = await searchAnalyticsQuery("sc-domain:example.com", { startDate: "2026-09-01", endDate: "2026-09-28" }, { fetchImpl: flaky.fetchImpl });
  assert.equal(apiCalls, 2);
  assert.deepEqual(rows, [{ keys: [], clicks: 3, impressions: 40, ctr: 0.075, position: 7.5 }]);

  let limited = 0;
  const throttled = mockFetch((url) => {
    if (url === TOKEN_URL) return tokenOk();
    limited += 1;
    return jsonResponse({ error: { message: "Too many requests" } }, 429);
  });
  await assert.rejects(searchAnalyticsQuery("sc-domain:example.com", { startDate: "2026-09-01", endDate: "2026-09-28" }, { fetchImpl: throttled.fetchImpl }), (e: unknown) => {
    assert.ok(e instanceof GscError);
    assert.equal(e.code, "rate_limited");
    return true;
  });
  assert.equal(limited, 1);
  resetSearchConsoleCache();
});

test("listSites parses siteEntry and tolerates an account with no properties", async () => {
  const { listSites, resetSearchConsoleCache } = await sc();
  resetSearchConsoleCache();
  const { fetchImpl, calls } = mockFetch((url) =>
    url === TOKEN_URL
      ? tokenOk()
      : jsonResponse({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteRestrictedUser" }, { permissionLevel: "siteOwner" }] })
  );
  assert.deepEqual(await listSites({ fetchImpl }), [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteRestrictedUser" }]);
  assert.equal(calls[1].url, "https://www.googleapis.com/webmasters/v3/sites");
  const empty = mockFetch((url) => (url === TOKEN_URL ? tokenOk() : jsonResponse({})));
  assert.deepEqual(await listSites({ fetchImpl: empty.fetchImpl }), []);
  resetSearchConsoleCache();
});

test("searchAnalyticsQuery refuses malformed properties before touching the network", async () => {
  const { searchAnalyticsQuery, isValidProperty, GscError } = await sc();
  assert.equal(isValidProperty("sc-domain:example.com"), true);
  assert.equal(isValidProperty("https://www.example.com/"), true);
  assert.equal(isValidProperty("https://example.com/blog/"), true);
  assert.equal(isValidProperty("example.com"), false);
  assert.equal(isValidProperty("https://example.com"), false);
  const { fetchImpl, calls } = mockFetch(() => tokenOk());
  await assert.rejects(searchAnalyticsQuery("example.com", { startDate: "2026-09-01", endDate: "2026-09-28" }, { fetchImpl }), GscError);
  assert.equal(calls.length, 0);
});

/* ============================================================
   属性匹配
   ============================================================ */

test("matchProperty prefers the sc-domain property, then URL-prefix on the apex or www host", async () => {
  const { matchProperty } = await gsc();
  const site = (siteUrl: string, permissionLevel = "siteRestrictedUser") => ({ siteUrl, permissionLevel });

  assert.equal(
    matchProperty("example.com", [site("https://www.example.com/"), site("sc-domain:example.com"), site("https://example.com/")]),
    "sc-domain:example.com"
  );
  // 没有域名属性 → URL 前缀;默认偏好裸域,给了入口主机就偏好它
  assert.equal(matchProperty("example.com", [site("https://www.example.com/"), site("https://example.com/")]), "https://example.com/");
  assert.equal(
    matchProperty("example.com", [site("https://www.example.com/"), site("https://example.com/")], { preferHost: "www.example.com" }),
    "https://www.example.com/"
  );
  assert.equal(matchProperty("www.example.com", [site("https://www.example.com/")]), "https://www.example.com/");
  // https 优先于 http,根目录优先于子目录
  assert.equal(matchProperty("example.com", [site("http://example.com/"), site("https://example.com/")]), "https://example.com/");
  assert.equal(matchProperty("example.com", [site("https://example.com/blog/"), site("http://example.com/")]), "https://example.com/blog/");
  // 不相干 / 仿冒 / 父域 / 子域属性一律不匹配
  assert.equal(
    matchProperty("example.com", [
      site("https://notexample.com/"),
      site("https://example.com.evil.net/"),
      site("sc-domain:sub.example.com"),
      site("https://blog.example.com/"),
      site("sc-domain:example.co"),
    ]),
    null
  );
  assert.equal(matchProperty("blog.example.com", [site("sc-domain:example.com")]), null);
  // siteUnverifiedUser = 列表里有但没有访问权
  assert.equal(matchProperty("example.com", [site("sc-domain:example.com", "siteUnverifiedUser")]), null);
  assert.equal(
    matchProperty("example.com", [site("sc-domain:example.com", "siteUnverifiedUser"), site("https://example.com/", "siteFullUser")]),
    "https://example.com/"
  );
  assert.equal(matchProperty("", [site("sc-domain:example.com")]), null);
  assert.equal(matchProperty("Example.COM", [site("sc-domain:example.com")]), "sc-domain:example.com");
});

/* ============================================================
   时间窗与品牌词
   ============================================================ */

test("gscRanges: 28 days ending 3 days ago (Pacific calendar) vs the 28 days before", async () => {
  const { gscRanges } = await gsc();
  const r = gscRanges(new Date("2026-10-02T12:00:00Z")); // 05:00 PT,PT 日期 10-02
  assert.deepEqual(r.range, { from: "2026-09-02", to: "2026-09-29" });
  assert.deepEqual(r.previousRange, { from: "2026-08-05", to: "2026-09-01" });
  const span = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY + 1;
  assert.equal(span(r.range.from, r.range.to), 28);
  assert.equal(span(r.previousRange.from, r.previousRange.to), 28);
  assert.equal((Date.parse(r.range.from) - Date.parse(r.previousRange.to)) / DAY, 1, "periods are adjacent");
  // 03:00 UTC 在太平洋时间还是前一天
  assert.deepEqual(gscRanges(new Date("2026-10-02T03:00:00Z")).range, { from: "2026-09-01", to: "2026-09-28" });
});

test("brand label and brand-query detection", async () => {
  const { gscBrandLabel, isBrandQuery } = await gsc();
  assert.equal(gscBrandLabel("aeoeye.com"), "aeoeye");
  assert.equal(gscBrandLabel("www.my-brand.co.uk"), "my-brand");
  assert.equal(gscBrandLabel("hp.com"), "hp");
  assert.equal(isBrandQuery("aeoeye pricing", "aeoeye"), true);
  assert.equal(isBrandQuery("aeo eye review", "aeoeye"), true);
  assert.equal(isBrandQuery("my brand login", "my-brand"), true);
  assert.equal(isBrandQuery("my-brand.co.uk", "my-brand"), true);
  assert.equal(isBrandQuery("best aeo tools", "aeoeye"), false);
  // 短标签只认整词
  assert.equal(isBrandQuery("hp laptop support", "hp"), true);
  assert.equal(isBrandQuery("php hosting", "hp"), false);
  assert.equal(isBrandQuery("anything", ""), false);
});

/* ============================================================
   汇总
   ============================================================ */

const NOW = new Date("2026-10-02T12:00:00Z");
const D = "acme-tools.com";
const P = (path: string) => `https://acme-tools.com${path}`;

function sampleRaw() {
  return {
    totals: [row([], 7, 1000, 12.34)],
    previousTotals: [] as SearchAnalyticsRow[],
    queries: [
      row(["acme tools pricing"], 5, 300, 1.2),
      row(["best crm for startups"], 2, 500, 8.4),
      row(["crm comparison"], 0, 120, 14),
      row(["what is a crm"], 0, 40, 30),
      row(["crm for agencies"], 0, 100, 22),
      row(["no impressions"], 0, 0, 0),
    ],
    pages: [
      row([P("/blog/best-crm")], 2, 300, 4),
      row([P("/crm-guide")], 0, 150, 9),
      row([P("/crm-guide#faq")], 1, 50, 5),
      row([P("/compare")], 0, 110, 14),
      row([P("/pricing")], 5, 200, 1.2),
    ],
    queryPages: [
      row(["best crm for startups", P("/blog/best-crm")], 2, 300),
      row(["best crm for startups", P("/crm-guide")], 0, 150),
      row(["best crm for startups", P("/crm-guide#:~:text=best")], 0, 20),
      row(["best crm for startups", P("/")], 0, 30),
      row(["crm comparison", P("/compare")], 0, 110),
      row(["crm comparison", P("/blog/crm-vs")], 0, 10),
      row(["what is a crm", P("/a")], 0, 10),
      row(["what is a crm", P("/b")], 0, 9),
      row(["acme tools pricing", P("/pricing")], 5, 200),
      row(["acme tools pricing", P("/")], 0, 100),
      row(["crm for agencies", P("/x")], 0, 90),
      row(["crm for agencies", P("/y")], 0, 10),
    ],
  };
}

test("summarizeGsc: cannibalisation needs ≥2 pages with ≥10% each on a non-brand query with ≥20 impressions", async () => {
  const { summarizeGsc } = await gsc();
  const data = summarizeGsc({ property: "sc-domain:acme-tools.com", domain: D, now: NOW, raw: sampleRaw() });
  assert.deepEqual(data.cannibalized, [
    {
      query: "best crm for startups",
      impressions: 500,
      // #片段 并入同一页(150 + 20);首页只占 6%,不算
      pages: [
        { page: P("/blog/best-crm"), clicks: 2, impressions: 300 },
        { page: P("/crm-guide"), clicks: 0, impressions: 170 },
      ],
    },
    // 恰好 10% 算(含边界)
    { query: "crm for agencies", impressions: 100, pages: [{ page: P("/x"), clicks: 0, impressions: 90 }, { page: P("/y"), clicks: 0, impressions: 10 }] },
  ]);
  // crm comparison:第二页 10/120 < 10% → 不算;what is a crm:总曝光 19 < 20 → 不算;品牌词 → 不算(sitelinks)
  assert.ok(!data.cannibalized.some((g) => ["crm comparison", "what is a crm", "acme tools pricing"].includes(g.query)));
});

test("summarizeGsc: queries by impressions with brand flags and page counts; pages merged and sorted; zero-click pages", async () => {
  const { summarizeGsc } = await gsc();
  const data = summarizeGsc({ property: "sc-domain:acme-tools.com", domain: D, now: NOW, raw: sampleRaw() });
  assert.deepEqual(
    data.queries.map((q) => [q.query, q.impressions, q.brand, q.pages]),
    [
      ["best crm for startups", 500, false, 3],
      ["acme tools pricing", 300, true, 2],
      ["crm comparison", 120, false, 2],
      ["crm for agencies", 100, false, 2],
      ["what is a crm", 40, false, 2],
    ]
  );
  assert.equal(data.queries[0].ctr, 0.004);
  assert.equal(data.queries[0].position, 8.4);
  // /crm-guide 与 /crm-guide#faq 合并:曝光 200,点击 1,名次按曝光加权 (9×150 + 5×50) / 200 = 8
  assert.deepEqual(
    data.pages.map((p) => [p.page, p.clicks, p.impressions, p.position]),
    [
      [P("/blog/best-crm"), 2, 300, 4],
      [P("/pricing"), 5, 200, 1.2],
      [P("/crm-guide"), 1, 200, 8],
      [P("/compare"), 0, 110, 14],
    ]
  );
  assert.equal(data.pages[2].ctr, 0.005);
  assert.deepEqual(data.zeroClickPages, { count: 1, total: 4 });
  assert.deepEqual(data.totals, { clicks: 7, impressions: 1000, ctr: 0.007, position: 12.3 });
  assert.equal(data.previous, null);
  assert.deepEqual(data.range, { from: "2026-09-02", to: "2026-09-29" });
  assert.deepEqual(data.previousRange, { from: "2026-08-05", to: "2026-09-01" });
  assert.equal(data.property, "sc-domain:acme-tools.com");
  assert.equal(data.fetchedAt, NOW.toISOString());
  assert.ok(data.notes.some((n) => n.includes("2026-08-05")), "explains the missing previous period");
});

test("summarizeGsc caps queries at 100, pages at 100 and cannibalised groups at 30; notes empty data", async () => {
  const { summarizeGsc } = await gsc();
  const queries = Array.from({ length: 150 }, (_, i) => row([`query ${i}`], 0, 1000 - i));
  const pages = Array.from({ length: 140 }, (_, i) => row([P(`/p${i}`)], i % 2, 500 - i));
  const queryPages = Array.from({ length: 40 }, (_, i) => [row([`topic ${i}`, P(`/a${i}`)], 0, 60 + i), row([`topic ${i}`, P(`/b${i}`)], 0, 40)]).flat();
  const data = summarizeGsc({
    property: "https://acme-tools.com/",
    domain: D,
    now: NOW,
    raw: { totals: [row([], 0, 0, 0)], previousTotals: [row([], 1, 50, 20)], queries, pages, queryPages },
  });
  assert.equal(data.queries.length, 100);
  assert.equal(data.queries[0].query, "query 0");
  assert.equal(data.pages.length, 100);
  assert.deepEqual(data.zeroClickPages, { count: 70, total: 140 });
  assert.equal(data.cannibalized.length, 30);
  assert.equal(data.cannibalized[0].query, "topic 39", "largest groups first");
  assert.deepEqual(data.previous, { clicks: 1, impressions: 50, ctr: 0.02, position: 20 });
  assert.ok(data.notes.some((n) => n.includes("no Google Search impressions")));

  const failed = summarizeGsc({
    property: "https://acme-tools.com/",
    domain: D,
    now: NOW,
    raw: { totals: [], previousTotals: null, queries: [], pages: [], queryPages: null },
  });
  assert.deepEqual(failed.cannibalized, []);
  assert.deepEqual(failed.totals, { clicks: 0, impressions: 0, ctr: 0, position: 0 });
  assert.equal(failed.previous, null);
  assert.ok(failed.notes.some((n) => n.includes("query-by-page breakdown could not be loaded")));
});

test("summarizeGsc explains when Google's anonymised queries hide most clicks", async () => {
  const { summarizeGsc } = await gsc();
  const data = summarizeGsc({
    property: "sc-domain:acme-tools.com",
    domain: D,
    now: NOW,
    raw: { totals: [row([], 100, 5000, 9)], previousTotals: [row([], 80, 4000, 10)], queries: [row(["crm"], 40, 900)], pages: [], queryPages: [] },
  });
  assert.ok(data.notes.some((n) => n.includes("40% of your clicks")));
});

/* ============================================================
   pullGscData:5 个只读请求
   ============================================================ */

test("pullGscData sends five read-only queries for the right windows and summarises them", async () => {
  const { pullGscData, GSC_QUERY_ROW_LIMIT, GSC_PAGE_ROW_LIMIT, GSC_QUERY_PAGE_ROW_LIMIT } = await gsc();
  const { resetSearchConsoleCache } = await sc();
  resetSearchConsoleCache();
  const raw = sampleRaw();
  const seen: Record<string, unknown>[] = [];
  const { fetchImpl, calls } = mockFetch((url, body) => {
    if (url === TOKEN_URL) return tokenOk("ya29.pull");
    assert.equal(url, "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aacme-tools.com/searchAnalytics/query");
    const b = JSON.parse(body ?? "{}") as { startDate: string; endDate: string; dimensions?: string[]; type?: string; rowLimit?: number };
    seen.push(b);
    assert.equal(b.type, "web");
    const dims = (b.dimensions ?? []).join(",");
    if (!dims) return jsonResponse({ rows: b.startDate === "2026-09-02" ? raw.totals : [row([], 4, 800, 15)] });
    if (dims === "query") return jsonResponse({ rows: raw.queries });
    if (dims === "page") return jsonResponse({ rows: raw.pages });
    if (dims === "query,page") return jsonResponse({ rows: raw.queryPages });
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  });

  const data = await pullGscData("sc-domain:acme-tools.com", D, { now: NOW, fetchImpl });
  assert.equal(calls.filter((c) => c.url === TOKEN_URL).length, 1, "one token for five parallel queries");
  assert.equal(seen.length, 5);
  const byDims = (dims: string) => seen.filter((b) => ((b.dimensions as string[] | undefined) ?? []).join(",") === dims);
  assert.deepEqual(
    byDims("").map((b) => [b.startDate, b.endDate]).sort(),
    [
      ["2026-08-05", "2026-09-01"],
      ["2026-09-02", "2026-09-29"],
    ]
  );
  assert.deepEqual(byDims("query").map((b) => [b.startDate, b.endDate, b.rowLimit]), [["2026-09-02", "2026-09-29", GSC_QUERY_ROW_LIMIT]]);
  assert.deepEqual(byDims("page").map((b) => b.rowLimit), [GSC_PAGE_ROW_LIMIT]);
  assert.deepEqual(byDims("query,page").map((b) => b.rowLimit), [GSC_QUERY_PAGE_ROW_LIMIT]);
  for (const c of calls.filter((x) => x.url !== TOKEN_URL)) {
    assert.equal((c.init?.headers as Record<string, string>).Authorization, "Bearer ya29.pull");
    assert.equal(c.init?.method, "POST");
  }

  assert.deepEqual(data.totals, { clicks: 7, impressions: 1000, ctr: 0.007, position: 12.3 });
  assert.deepEqual(data.previous, { clicks: 4, impressions: 800, ctr: 0.005, position: 15 });
  assert.equal(data.queries.length, 5);
  assert.equal(data.cannibalized.length, 2);
  resetSearchConsoleCache();
});

test("pullGscData degrades on optional data and throws on core data", async () => {
  const { pullGscData } = await gsc();
  const { resetSearchConsoleCache, GscError } = await sc();
  resetSearchConsoleCache();
  const optionalDown = mockFetch((url, body) => {
    if (url === TOKEN_URL) return tokenOk();
    const b = JSON.parse(body ?? "{}") as { startDate: string; dimensions?: string[] };
    const dims = (b.dimensions ?? []).join(",");
    if (dims === "query,page") return jsonResponse({ error: { message: "Bad request" } }, 400);
    if (!dims && b.startDate === "2026-08-05") return jsonResponse({ error: { message: "Bad request" } }, 400);
    return jsonResponse({ rows: dims ? [row(dims === "query" ? ["crm"] : [P("/")], 1, 30)] : [row([], 1, 30)] });
  });
  const data = await pullGscData("sc-domain:acme-tools.com", D, { now: NOW, fetchImpl: optionalDown.fetchImpl });
  assert.equal(data.previous, null);
  assert.deepEqual(data.cannibalized, []);
  assert.ok(data.notes.some((n) => n.includes("could not be loaded")));
  assert.equal(data.queries[0].query, "crm");

  resetSearchConsoleCache();
  const coreDown = mockFetch((url, body) => {
    if (url === TOKEN_URL) return tokenOk();
    const dims = ((JSON.parse(body ?? "{}") as { dimensions?: string[] }).dimensions ?? []).join(",");
    if (dims === "query") return jsonResponse({ error: { code: 403, message: "User does not have sufficient permission" } }, 403);
    return jsonResponse({ rows: [] });
  });
  await assert.rejects(pullGscData("sc-domain:acme-tools.com", D, { now: NOW, fetchImpl: coreDown.fetchImpl }), (e: unknown) => {
    assert.ok(e instanceof GscError);
    assert.equal(e.code, "forbidden");
    return true;
  });
  resetSearchConsoleCache();
});

/* ============================================================
   站点控制权证明:token、<head> meta、DNS TXT、首页抓取规则
   ============================================================ */

const TOKEN = "aeo-AbCdEf012345_-xY";
const OTHER_TOKEN = "aeo-ZZZZZZZZZZZZZZZZ";
const SA = "aeoeye-search-console@customer-project.iam.gserviceaccount.com";

function page(head: string, body = "<p>Hello</p>"): string {
  return `<!doctype html><html><head><title>Acme</title>${head}</head><body>${body}</body></html>`;
}

test("site tokens are 'aeo-' + 16 base64url chars, unique, with the exact meta tag and DNS strings", async () => {
  const { newSiteToken, isSiteToken, siteTokenMetaTag, siteTokenDnsTxt } = await gsc();
  const tokens = new Set(Array.from({ length: 500 }, () => newSiteToken()));
  assert.equal(tokens.size, 500, "no collisions");
  for (const t of tokens) assert.match(t, /^aeo-[A-Za-z0-9_-]{16}$/);
  assert.equal(isSiteToken(TOKEN), true);
  assert.equal(isSiteToken("aeo-short"), false);
  assert.equal(isSiteToken(`${TOKEN}x`), false);
  assert.equal(isSiteToken(TOKEN.replace("aeo-", "abc-")), false);
  assert.equal(isSiteToken(null), false);
  assert.equal(siteTokenMetaTag(TOKEN), `<meta name="aeoeye-site-verification" content="${TOKEN}">`);
  assert.equal(siteTokenDnsTxt(TOKEN), `aeoeye-site-verification=${TOKEN}`);
});

test("meta tag in <head> is found in any attribute order, quoting style, name case, or self-closing form", async () => {
  const { htmlHasSiteToken } = await gsc();
  const accepted = [
    `<meta name="aeoeye-site-verification" content="${TOKEN}">`,
    `<meta content="${TOKEN}" name="aeoeye-site-verification">`,
    `<meta name='aeoeye-site-verification' content='${TOKEN}'>`,
    `<meta name=aeoeye-site-verification content=${TOKEN}>`,
    `<META NAME="AEOeye-Site-Verification" CONTENT="${TOKEN}" />`,
    `<meta\n  data-note="a>b" name="aeoeye-site-verification"\n  content=" ${TOKEN} ">`,
    `<meta name="aeoeye-site-verification" content="aeo&#45;${TOKEN.slice(4)}">`,
  ];
  for (const tag of accepted) assert.equal(htmlHasSiteToken(page(tag), TOKEN), true, tag);
  // 没有 </head> / <body> 的片段:整段都算 head
  assert.equal(htmlHasSiteToken(`<meta name="aeoeye-site-verification" content="${TOKEN}">`, TOKEN), true);
});

test("meta tag is NOT accepted from the body, plain text, comments, scripts, titles, or with the wrong token", async () => {
  const { htmlHasSiteToken } = await gsc();
  const tag = `<meta name="aeoeye-site-verification" content="${TOKEN}">`;
  const rejected = [
    page("", tag), // <body> 里的 meta
    page("", `<p>Our verification code is ${TOKEN}</p>`), // 正文文字
    page("", `<p>aeoeye-site-verification=${TOKEN}</p>`),
    page(`<!-- ${tag} -->`), // 注释
    page(`<script>var s = '${tag}';</script>`), // 脚本里的字符串
    page(`<noscript>${tag}</noscript>`),
    `<html><head><title>${tag}</title></head><body></body></html>`, // <title> 是纯文本
    page(`<meta name="aeoeye-site-verification" content="${OTHER_TOKEN}">`), // 别人的 token
    page(`<meta name="aeoeye-site-verification" content="${TOKEN.toUpperCase()}">`), // token 区分大小写
    page(`<meta name="aeoeye-site-verification" content="${TOKEN} extra">`),
    page(`<meta name="aeoeye-site-verification-2" content="${TOKEN}">`),
    page(`<meta property="aeoeye-site-verification" content="${TOKEN}">`),
    page(`<meta name="description" name="aeoeye-site-verification" content="${TOKEN}">`), // 重复属性以第一个为准
    "",
  ];
  for (const html of rejected) assert.equal(htmlHasSiteToken(html, TOKEN), false, html);
  assert.equal(htmlHasSiteToken(page(tag), "not-a-token"), false);
});

test("DNS TXT: chunked records joined, prefix case-insensitive, token exact; lookups use the registrable domain", async () => {
  const { dnsHasSiteToken, txtRecordsHaveToken } = await gsc();
  assert.equal(txtRecordsHaveToken([["v=spf1 -all"], [`aeoeye-site-verification=${TOKEN}`]], TOKEN), true);
  assert.equal(txtRecordsHaveToken([["aeoeye-site-verification=aeo-", TOKEN.slice(4)]], TOKEN), true, "255-char chunks are joined");
  assert.equal(txtRecordsHaveToken([[`AEOEYE-Site-Verification=${TOKEN}`]], TOKEN), true);
  assert.equal(txtRecordsHaveToken([[`aeoeye-site-verification=${OTHER_TOKEN}`]], TOKEN), false);
  assert.equal(txtRecordsHaveToken([[`aeoeye-site-verification=${TOKEN.toUpperCase()}`]], TOKEN), false);
  assert.equal(txtRecordsHaveToken([[`google-site-verification=${TOKEN}`]], TOKEN), false);
  assert.equal(txtRecordsHaveToken([[TOKEN]], TOKEN), false);

  const asked: string[] = [];
  const found = await dnsHasSiteToken("www.acme.com", TOKEN, {
    resolveTxt: async (host) => {
      asked.push(host);
      return [[`aeoeye-site-verification=${TOKEN}`]];
    },
  });
  assert.deepEqual(found, { found: true, detail: "TXT record found on acme.com" });
  assert.deepEqual(asked, ["acme.com"]);

  const none = await dnsHasSiteToken("acme.com", TOKEN, {
    resolveTxt: async () => {
      throw Object.assign(new Error("queryTxt ENODATA acme.com"), { code: "ENODATA" });
    },
  });
  assert.deepEqual(none, { found: false, detail: "no TXT records on acme.com" });
  const slow = await dnsHasSiteToken("acme.com", TOKEN, { resolveTxt: () => new Promise<string[][]>(() => {}), timeoutMs: 30 });
  assert.deepEqual(slow, { found: false, detail: "DNS lookup for acme.com timed out" });
});

test("homepage check uses the root of the entry host (never the entry path), falls back www↔apex, must stay on the domain", async () => {
  const { homepageCandidates, homepageHasSiteToken } = await gsc();
  assert.deepEqual(homepageCandidates("https://www.acme.com/go?to=https://evil.net/", "acme.com"), ["https://www.acme.com/", "https://acme.com/"]);
  assert.deepEqual(homepageCandidates("http://acme.com/pricing", "acme.com"), ["http://acme.com/", "http://www.acme.com/"]);
  assert.deepEqual(homepageCandidates("https://evil.net/", "acme.com"), ["https://acme.com/", "https://www.acme.com/"]);

  const tag = `<meta name="aeoeye-site-verification" content="${TOKEN}">`;
  const fetched: string[] = [];
  const ok = await homepageHasSiteToken(
    { domain: "acme.com", entryUrl: "https://acme.com/pricing", token: TOKEN },
    {
      fetchPage: async (url) => {
        fetched.push(url);
        return url === "https://acme.com/" ? { status: 403, finalUrl: url, body: "" } : { status: 200, finalUrl: "https://en.acme.com/", body: page(tag) };
      },
    }
  );
  assert.deepEqual(fetched, ["https://acme.com/", "https://www.acme.com/"]);
  assert.deepEqual([ok.found, ok.url], [true, "https://en.acme.com/"], "subdomains of the claimed domain are fine");

  // 首页跳去别的站(哪怕那边放了正确的标签)不算 —— 否则开放跳转就能替别人"证明"
  const offsite = await homepageHasSiteToken(
    { domain: "acme.com", entryUrl: "https://acme.com/", token: TOKEN },
    { fetchPage: async () => ({ status: 200, finalUrl: "https://acme.com.evil.net/landing", body: page(tag) }) }
  );
  assert.equal(offsite.found, false);
  assert.match(offsite.detail, /redirects away from acme\.com/);

  const bodyOnly = await homepageHasSiteToken(
    { domain: "acme.com", entryUrl: "https://acme.com/", token: TOKEN },
    { fetchPage: async (url) => ({ status: 200, finalUrl: url, body: page("", `<p>${TOKEN}</p>`) }) }
  );
  assert.equal(bodyOnly.found, false);
  const down = await homepageHasSiteToken(
    { domain: "acme.com", entryUrl: "https://acme.com/", token: TOKEN },
    { fetchPage: async (url) => ({ status: 0, finalUrl: url, body: "", error: "Timed out after 8000ms" }) }
  );
  assert.equal(down.found, false);
  assert.match(down.detail, /Timed out after 8000ms/);
});

test("checkSiteControl: the meta tag OR the DNS record is enough; with neither it says where it looked", async () => {
  const { checkSiteControl } = await gsc();
  const args = { domain: "acme.com", entryUrl: "https://acme.com/", token: TOKEN };
  const noTxt = async (): Promise<string[][]> => {
    throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
  };
  const withMeta = await checkSiteControl(args, {
    fetchPage: async (url) => ({ status: 200, finalUrl: url, body: page(`<meta name="aeoeye-site-verification" content="${TOKEN}">`) }),
    resolveTxt: noTxt,
  });
  assert.deepEqual([withMeta.found, withMeta.via], [true, "meta"]);
  const withDns = await checkSiteControl(args, {
    fetchPage: async (url) => ({ status: 200, finalUrl: url, body: page("") }),
    resolveTxt: async () => [[`aeoeye-site-verification=${TOKEN}`]],
  });
  assert.deepEqual([withDns.found, withDns.via], [true, "dns"]);
  const neither = await checkSiteControl(args, { fetchPage: async (url) => ({ status: 200, finalUrl: url, body: page("") }), resolveTxt: noTxt });
  assert.equal(neither.found, false);
  assert.match(neither.detail, /not in the <head> of https:\/\/www\.acme\.com\//);
  assert.match(neither.detail, /no TXT records on acme\.com/);
  assert.equal((await checkSiteControl({ ...args, token: "bogus" })).found, false);
});

/* ============================================================
   绑定协议(纯决策)与 GET 视图
   ============================================================ */

const T = new Date("2026-10-02T12:00:00Z");
const ago = (days: number) => new Date(T.getTime() - days * DAY);
function claim(over: Partial<ClaimFacts>): ClaimFacts {
  return { id: "c1", userId: "u1", auditId: "a1", status: "pending", createdAt: ago(0.01), verifiedAt: null, token: TOKEN, ...over };
}

test("decideVerification: a pending claim needs BOTH the site token and property access; re-sync needs access only", async () => {
  const { decideVerification } = await gsc();
  assert.deepEqual(decideVerification({ kind: "prove", siteProof: true, hasAccess: true }), { action: "verify" });
  assert.deepEqual(decideVerification({ kind: "prove", siteProof: false, hasAccess: true }), { action: "refuse", code: "token_not_found" });
  assert.deepEqual(decideVerification({ kind: "prove", siteProof: true, hasAccess: false }), { action: "refuse", code: "no_property_access" });
  assert.deepEqual(decideVerification({ kind: "prove", siteProof: false, hasAccess: false }), { action: "refuse", code: "token_not_found" });
  assert.deepEqual(decideVerification({ kind: "resync", siteProof: false, hasAccess: true }), { action: "verify" }, "the tag is not re-checked");
  assert.deepEqual(decideVerification({ kind: "resync", siteProof: true, hasAccess: false }), { action: "revoke" });
});

test("verificationTarget / decideIntent / claimStateFor: pending → prove, verified → re-sync, 7-day expiry, stable token", async () => {
  const { verificationTarget, decideIntent, claimStateFor, GSC_INTENT_TTL_MS } = await gsc();
  const target = (claims: ClaimFacts[]) => verificationTarget({ auditId: "a1", ownClaims: claims, now: T });
  assert.deepEqual(target([claim({})]), { kind: "prove", claimId: "c1" });
  assert.deepEqual(target([claim({ status: "verified", verifiedAt: ago(1) })]), { kind: "resync", claimId: "c1" });
  assert.deepEqual(target([]), { kind: "refuse", code: "no_intent" });
  assert.deepEqual(target([claim({ auditId: "a2" })]), { kind: "refuse", code: "no_intent" }, "claims on other reports don't count");
  assert.deepEqual(target([claim({ createdAt: new Date(T.getTime() - GSC_INTENT_TTL_MS - 60_000) })]), { kind: "refuse", code: "expired" });
  assert.deepEqual(target([claim({ status: "revoked" })]), { kind: "refuse", code: "no_intent" });
  assert.deepEqual(target([claim({ token: null })]), { kind: "refuse", code: "no_intent" }, "a pending row without a token is unusable");

  // 连点两次 Connect 并发建了两行:取最早那条有效 pending —— 两次响应、GET 与 Verify 看到同一个 token
  const twins = [claim({ id: "late", createdAt: ago(0.001) }), claim({ id: "early", createdAt: ago(0.002) })];
  assert.deepEqual(target(twins), { kind: "prove", claimId: "early" });
  assert.deepEqual(decideIntent({ auditId: "a1", ownClaims: twins, now: T }), { action: "reuse", claimId: "early", state: "pending" });
  assert.deepEqual(decideIntent({ auditId: "a1", ownClaims: [claim({ status: "verified", verifiedAt: ago(3) })], now: T }), {
    action: "reuse",
    claimId: "c1",
    state: "verified",
  });
  assert.deepEqual(decideIntent({ auditId: "a1", ownClaims: [claim({ createdAt: ago(8) })], now: T }), { action: "create" });
  assert.deepEqual(decideIntent({ auditId: "a1", ownClaims: [], now: T }), { action: "create" });

  assert.equal(claimStateFor([], "a1", T), "none");
  assert.equal(claimStateFor([claim({})], "a1", T), "pending");
  assert.equal(claimStateFor([claim({ createdAt: ago(8) })], "a1", T), "none", "expired request");
  assert.equal(claimStateFor([claim({ status: "verified", verifiedAt: ago(1) })], "a1", T), "verified");
  assert.equal(claimStateFor([claim({ status: "revoked", verifiedAt: ago(1) })], "a1", T), "revoked", "was connected, then removed");
  assert.equal(claimStateFor([claim({ status: "revoked" })], "a1", T), "none", "a cancelled request was never connected");
  assert.equal(claimStateFor([claim({ status: "conflict" })], "a1", T), "none", "legacy rows are inert");
});

test("GET view: email, token, meta tag and DNS record are exposed only for the owner's pending / verified claim", async () => {
  const { gscStatusView, GSC_INTENT_TTL_MS } = await gsc();
  const base = {
    auditId: "a1",
    unlocked: true,
    ownerUserId: "u1" as string | null,
    viewerUserId: "u1" as string | null,
    configured: true,
    serviceAccountEmail: SA,
    gscProperty: null as string | null,
    ownClaims: [] as ClaimFacts[],
    now: T,
  };
  type View = ReturnType<typeof gscStatusView>;
  const hidden = (v: View) => [v.serviceAccountEmail, v.token, v.metaTag, v.dnsTxt, v.expiresAt].every((x) => x === null);

  const none = gscStatusView(base);
  assert.deepEqual([none.state, none.canConnect, none.signedIn], ["none", true, true]);
  assert.ok(hidden(none), "no email before Connect");

  const pending = gscStatusView({ ...base, ownClaims: [claim({})] });
  assert.equal(pending.state, "pending");
  assert.deepEqual([pending.serviceAccountEmail, pending.token, pending.metaTag, pending.dnsTxt], [
    SA,
    TOKEN,
    `<meta name="aeoeye-site-verification" content="${TOKEN}">`,
    `aeoeye-site-verification=${TOKEN}`,
  ]);
  assert.equal(pending.expiresAt, new Date(ago(0.01).getTime() + GSC_INTENT_TTL_MS).toISOString());

  const verified = gscStatusView({ ...base, gscProperty: "sc-domain:acme.com", ownClaims: [claim({ status: "verified", verifiedAt: ago(1) })] });
  assert.deepEqual([verified.state, verified.connected, verified.property, verified.token, verified.expiresAt], [
    "verified",
    true,
    "sc-domain:acme.com",
    TOKEN,
    null,
  ]);
  assert.equal(verified.serviceAccountEmail, SA);

  for (const v of [
    gscStatusView({ ...base, ownClaims: [claim({ status: "revoked", verifiedAt: ago(1) })] }), // revoked
    gscStatusView({ ...base, ownClaims: [claim({ createdAt: ago(8) })] }), // expired
    gscStatusView({ ...base, viewerUserId: null, ownClaims: [claim({})] }), // signed out
    gscStatusView({ ...base, viewerUserId: "u2", ownClaims: [claim({ userId: "u2" })] }), // not the owner
    gscStatusView({ ...base, unlocked: false, ownClaims: [claim({})] }), // locked / refunded
    gscStatusView({ ...base, configured: false, ownClaims: [claim({})] }), // not configured
  ]) {
    assert.ok(hidden(v), JSON.stringify(v));
  }
  const signedOut = gscStatusView({ ...base, viewerUserId: null });
  assert.deepEqual([signedOut.signedIn, signedOut.canConnect, signedOut.reason], [false, false, "Sign in to connect Search Console."]);
  const locked = gscStatusView({ ...base, unlocked: false, gscProperty: "sc-domain:acme.com" });
  assert.deepEqual([locked.connected, locked.property, locked.reason], [false, null, "Unlock the full report to connect Search Console."]);
  assert.equal(gscStatusView({ ...base, ownerUserId: null }).canConnect, true, "an anonymously bought report can be claimed");
  const visitor = gscStatusView({ ...base, viewerUserId: "u2", gscProperty: "sc-domain:acme.com" });
  assert.deepEqual([visitor.connected, visitor.canConnect, visitor.state, visitor.reason], [
    true,
    false,
    "none",
    "Only the account that owns this report can connect Search Console.",
  ]);
});

/* ============================================================
   整条流程(内存端口:没有数据库、没有网络;站点证明走真实的 checkSiteControl,只注入首页与 DNS)
   ============================================================ */

const GEN = "2026-10-01T10:00:00.000Z";

function fakeResult(): SeoAuditResult {
  return { version: 1, plan: "full", domain: "acme.com", generatedAt: GEN, ranking: { version: 2, basis: { gscConnected: false } }, gsc: null } as unknown as SeoAuditResult;
}

function fakeGsc(property: string): GscData {
  return {
    property,
    fetchedAt: T.toISOString(),
    range: { from: "2026-09-02", to: "2026-09-29" },
    previousRange: { from: "2026-08-05", to: "2026-09-01" },
    totals: { clicks: 10, impressions: 500, ctr: 0.02, position: 9 },
    previous: null,
    queries: [],
    pages: [],
    cannibalized: [],
    zeroClickPages: { count: 0, total: 0 },
    notes: [],
  };
}

interface World {
  now: Date;
  claims: GscClaimRecord[];
  reports: Map<string, GscReportSnapshot>;
  sites: GscSite[];
  homepages: Map<string, { status: number; body: string; finalUrl?: string }>;
  txt: Map<string, string[][]>;
  recomputed: { gsc: GscData | null; now?: Date }[];
  pulls: string[];
  patches: number;
  failMarkVerified: boolean;
}

async function makeWorld() {
  const { checkSiteControl, newSiteToken } = await gsc();
  const w: World = { now: T, claims: [], reports: new Map(), sites: [], homepages: new Map(), txt: new Map(), recomputed: [], pulls: [], patches: 0, failMarkVerified: false };
  let seq = 0;
  const ports: GscPorts = {
    now: () => w.now,
    serviceAccountEmail: () => SA,
    newId: () => `claim-${++seq}`,
    newToken: newSiteToken,
    async ownClaims(auditId, userId) {
      return w.claims
        .filter((c) => c.auditId === auditId && c.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((c) => ({ ...c }));
    },
    async verifiedClaimsOnAudit(auditId) {
      return w.claims.filter((c) => c.auditId === auditId && c.status === "verified").map((c) => ({ ...c }));
    },
    async insertClaim(c) {
      w.claims.push({ ...c, status: "pending", property: null, verifiedAt: null, lastSyncedAt: null });
    },
    async markVerified(id, property, at) {
      const c = w.claims.find((x) => x.id === id);
      if (w.failMarkVerified || !c || (c.status !== "pending" && c.status !== "verified")) return false;
      Object.assign(c, { status: "verified", property, verifiedAt: c.verifiedAt ?? at, lastSyncedAt: at });
      return true;
    },
    async markRevoked(ids) {
      for (const c of w.claims) if (ids.includes(c.id) && (c.status === "pending" || c.status === "verified")) c.status = "revoked";
    },
    async readReport(id) {
      const r = w.reports.get(id);
      return r ? structuredClone(r) : null;
    },
    async patchReport(id, patch, property, expectGeneratedAt) {
      const r = w.reports.get(id);
      if (!r || !r.result || r.status !== "complete" || (r.result.generatedAt ?? null) !== expectGeneratedAt) return false;
      r.result = { ...r.result, ...patch } as SeoAuditResult;
      r.gscProperty = property;
      w.patches += 1;
      return true;
    },
    async setGscProperty(id, property) {
      const r = w.reports.get(id);
      if (r) r.gscProperty = property;
    },
    async listSites() {
      return w.sites.map((s) => ({ ...s }));
    },
    async pull(property) {
      w.pulls.push(property);
      return fakeGsc(property);
    },
    siteControl: (args) =>
      checkSiteControl(args, {
        fetchPage: async (url) => {
          const h = w.homepages.get(url);
          return h ? { status: h.status, finalUrl: h.finalUrl ?? url, body: h.body } : { status: 404, finalUrl: url, body: "" };
        },
        resolveTxt: async (host) => {
          const r = w.txt.get(host);
          if (!r) throw Object.assign(new Error(`queryTxt ENODATA ${host}`), { code: "ENODATA" });
          return r;
        },
      }),
    async recompute(_result, overrides) {
      w.recomputed.push(overrides);
      return { version: 2, basis: { gscConnected: !!overrides.gsc } } as unknown as RankingFramework;
    },
    async warn() {},
  };
  const addReport = (id: string, over: Partial<GscReportSnapshot> = {}) =>
    w.reports.set(id, { id, url: "https://acme.com/", domain: "acme.com", status: "complete", gscProperty: null, result: fakeResult(), ...over });
  const putMeta = (token: string) =>
    w.homepages.set("https://acme.com/", { status: 200, body: page(`<meta name="aeoeye-site-verification" content="${token}">`) });
  const shareProperty = () => (w.sites = [{ siteUrl: "sc-domain:acme.com", permissionLevel: "siteRestrictedUser" }]);
  return { w, ports, addReport, putMeta, shareProperty };
}

function rankingConnected(r: GscReportSnapshot | undefined): boolean | undefined {
  return (r?.result?.ranking as unknown as { basis?: { gscConnected?: boolean } } | undefined)?.basis?.gscConnected;
}

test("flow: Connect issues a token (idempotent); Verify needs the tag/DNS AND property access and writes nothing until both pass", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("a1");
  const intent = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  assert.equal(intent.ok, true);
  assert.equal(intent.state, "pending");
  assert.match(intent.token ?? "", /^aeo-[A-Za-z0-9_-]{16}$/);
  assert.equal(intent.serviceAccountEmail, SA);
  assert.equal(intent.metaTag, `<meta name="aeoeye-site-verification" content="${intent.token}">`);
  assert.equal(intent.dnsTxt, `aeoeye-site-verification=${intent.token}`);
  const again = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  assert.equal(again.token, intent.token, "Connect twice → same token");
  assert.equal(w.claims.length, 1);

  const verify = () => repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  // ① 两样都没有
  let r = await verify();
  assert.equal(!r.ok && r.code, "token_not_found");
  assert.deepEqual(!r.ok && r.checks, { siteToken: false, searchConsoleAccess: false });
  assert.match(!r.ok ? r.error : "", /verification tag/);
  assert.match(!r.ok ? r.error : "", new RegExp(SA.replace(/[.]/g, "\\.")));
  // ② 只有属性访问权(例如别人早就把属性共享给了我们)
  shareProperty();
  r = await verify();
  assert.equal(!r.ok && r.code, "token_not_found");
  assert.deepEqual(!r.ok && r.checks, { siteToken: false, searchConsoleAccess: true });
  // ③ 只有 token
  w.sites = [];
  putMeta(intent.token as string);
  r = await verify();
  assert.equal(!r.ok && r.code, "no_property_access");
  assert.deepEqual(!r.ok && r.checks, { siteToken: true, searchConsoleAccess: false });
  assert.equal(r.state, "pending");
  assert.equal(w.pulls.length + w.patches, 0, "nothing pulled or written before both proofs pass");
  assert.equal(w.claims[0].status, "pending");
  // ④ 两样都有
  shareProperty();
  r = await verify();
  assert.equal(r.ok, true);
  assert.equal(r.state, "verified");
  assert.equal(r.ok && r.property, "sc-domain:acme.com");
  assert.equal(r.ok && r.scoresUpdated, true);
  const report = w.reports.get("a1");
  assert.equal(report?.gscProperty, "sc-domain:acme.com");
  assert.equal(report?.result?.gsc?.property, "sc-domain:acme.com");
  assert.equal(rankingConnected(report), true, "scores recalculated with the Search Console data");
  assert.deepEqual(w.recomputed.at(-1)?.now, new Date(GEN), "recalculated as of the report's own generatedAt");
  assert.equal(w.claims[0].status, "verified");
});

test("flow: two different users who each prove control are both verified (owner via meta tag, agency via DNS)", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("owner-report");
  addReport("agency-report", { url: "https://www.acme.com/services" });
  shareProperty();
  const a = await repo.intentWith(ports, { auditId: "owner-report", userId: "owner", domain: "acme.com" });
  const b = await repo.intentWith(ports, { auditId: "agency-report", userId: "agency", domain: "acme.com" });
  assert.notEqual(a.token, b.token);
  putMeta(a.token as string);
  w.txt.set("acme.com", [[`aeoeye-site-verification=${b.token}`]]);
  const ra = await repo.verifyWith(ports, { auditId: "owner-report", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  const rb = await repo.verifyWith(ports, { auditId: "agency-report", userId: "agency", domain: "acme.com", entryUrl: "https://www.acme.com/services" });
  assert.deepEqual([ra.ok, rb.ok], [true, true]);
  assert.deepEqual(w.claims.map((c) => `${c.userId}:${c.status}`).sort(), ["agency:verified", "owner:verified"]);
  assert.equal(w.reports.get("owner-report")?.gscProperty, "sc-domain:acme.com");
  assert.equal(w.reports.get("agency-report")?.gscProperty, "sc-domain:acme.com");

  // 第三个人:属性对服务账号可见,但他放不了自己的 token —— 进不来,他的报告里什么都没有
  addReport("stranger-report");
  await repo.intentWith(ports, { auditId: "stranger-report", userId: "stranger", domain: "acme.com" });
  const rc = await repo.verifyWith(ports, { auditId: "stranger-report", userId: "stranger", domain: "acme.com", entryUrl: "https://acme.com/" });
  assert.equal(!rc.ok && rc.code, "token_not_found");
  assert.equal(w.reports.get("stranger-report")?.gscProperty, null);
  assert.equal(w.reports.get("stranger-report")?.result?.gsc ?? null, null);
});

test("flow: an unverified request expires after 7 days; Connect then issues a fresh token", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("a1");
  shareProperty();
  const first = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  putMeta(first.token as string);
  w.now = new Date(T.getTime() + 8 * DAY);
  const r = await repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  assert.deepEqual([r.ok, !r.ok && r.code, r.state], [false, "expired", "none"]);
  assert.equal(w.patches, 0);
  const second = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  assert.equal(second.state, "pending");
  assert.notEqual(second.token, first.token);
});

test("flow: re-sync keeps a verified claim without re-checking the tag; once the property is gone it is revoked and the data removed", async () => {
  const repo = await import("../gsc-repo");
  const gscMod = await gsc();
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("a1");
  shareProperty();
  const intent = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  putMeta(intent.token as string);
  const verify = () => repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  assert.equal((await verify()).ok, true);

  // 站长验证完删掉了 meta 标签(常态):重新同步照样成功
  w.homepages.clear();
  const resync = await verify();
  assert.deepEqual([resync.ok, resync.state], [true, "verified"]);
  assert.equal(w.pulls.length, 2);

  // 站长在 GSC 里移除了服务账号:撤销、数据撤出、分数按无 GSC 重算
  w.sites = [];
  const lost = await verify();
  assert.deepEqual([lost.ok, !lost.ok && lost.code, lost.state], [false, "no_property_access", "revoked"]);
  assert.equal(w.claims[0].status, "revoked");
  const report = w.reports.get("a1");
  assert.equal(report?.gscProperty, null);
  assert.equal(report?.result?.gsc ?? null, null);
  assert.equal(rankingConnected(report), false);
  assert.equal(gscMod.claimStateFor(await ports.ownClaims("a1", "owner"), "a1", w.now), "revoked");
});

test("flow: re-sync never needs the token, even for a verified row that has none", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, shareProperty } = await makeWorld();
  addReport("a1");
  shareProperty();
  w.claims.push({ id: "legacy", domain: "acme.com", userId: "owner", auditId: "a1", status: "verified", property: "sc-domain:acme.com", token: null, createdAt: ago(40), verifiedAt: ago(40), lastSyncedAt: null });
  const r = await repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  assert.deepEqual([r.ok, r.state], [true, "verified"]);
  assert.equal(r.token, undefined, "no token to show");
  assert.equal(w.reports.get("a1")?.gscProperty, "sc-domain:acme.com");
});

test("flow: disconnect removes the data and recalculates scores; cancelling a pending request leaves state none", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("a1");
  shareProperty();
  const intent = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  putMeta(intent.token as string);
  await repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  const off = await repo.disconnectWith(ports, { auditId: "a1", userId: "owner" });
  assert.deepEqual([off.ok, off.state, off.ok && off.scoresUpdated], [true, "revoked", true]);
  assert.equal(off.serviceAccountEmail, undefined, "no credentials outside pending / verified");
  const report = w.reports.get("a1");
  assert.equal(report?.gscProperty, null);
  assert.equal(report?.result?.gsc ?? null, null);
  assert.equal(rankingConnected(report), false);

  addReport("a2");
  await repo.intentWith(ports, { auditId: "a2", userId: "owner", domain: "acme.com" });
  const cancel = await repo.disconnectWith(ports, { auditId: "a2", userId: "owner" });
  assert.deepEqual([cancel.ok, cancel.state, cancel.ok && cancel.message], [true, "none", "Connection request cancelled."]);
});

test("flow: a report with a run in flight is never written; the claim stays pending and Verify works afterwards", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("a1", { status: "running" });
  shareProperty();
  const intent = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  putMeta(intent.token as string);
  const verify = () => repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  const busy = await verify();
  assert.deepEqual([busy.ok, !busy.ok && busy.code, busy.state], [false, "report_busy", "pending"]);
  assert.equal(w.patches, 0);
  assert.equal(w.claims[0].status, "pending");
  (w.reports.get("a1") as GscReportSnapshot).status = "complete";
  assert.equal((await verify()).ok, true);
});

test("flow: if the request is cancelled while Verify runs, the data just written is rolled back", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("a1");
  shareProperty();
  const intent = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  putMeta(intent.token as string);
  w.failMarkVerified = true;
  const r = await repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });
  assert.deepEqual([r.ok, !r.ok && r.code], [false, "no_intent"]);
  const report = w.reports.get("a1");
  assert.equal(report?.gscProperty, null);
  assert.equal(report?.result?.gsc ?? null, null);
});

test("refreshWith: pulls fresh data; switches to another accessible property; property gone → revoked; no binding → leftovers removed", async () => {
  const repo = await import("../gsc-repo");
  const { w, ports, addReport, putMeta, shareProperty } = await makeWorld();
  addReport("a1");
  shareProperty();
  const intent = await repo.intentWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com" });
  putMeta(intent.token as string);
  await repo.verifyWith(ports, { auditId: "a1", userId: "owner", domain: "acme.com", entryUrl: "https://acme.com/" });

  const fresh = await repo.refreshWith(ports, "a1");
  assert.deepEqual([fresh.status, fresh.status === "ok" && fresh.applied], ["ok", true]);

  // 域名属性删了、URL 前缀属性还在:换过去,不撤销
  w.sites = [{ siteUrl: "https://acme.com/", permissionLevel: "siteFullUser" }];
  const switched = await repo.refreshWith(ports, "a1");
  assert.equal(switched.status, "ok");
  assert.equal(w.reports.get("a1")?.gscProperty, "https://acme.com/");
  assert.equal(w.claims[0].property, "https://acme.com/");

  w.sites = [];
  assert.deepEqual(await repo.refreshWith(ports, "a1"), { status: "revoked" });
  assert.equal(w.claims[0].status, "revoked");
  assert.equal(w.reports.get("a1")?.gscProperty, null);
  assert.equal(w.reports.get("a1")?.result?.gsc ?? null, null);
  assert.deepEqual(await repo.refreshWith(ports, "a1"), { status: "none" });

  // gsc_property 还挂着但没有任何 verified 绑定(人工处理过):残留数据撤掉
  addReport("a2", { gscProperty: "sc-domain:acme.com", result: { ...fakeResult(), gsc: fakeGsc("sc-domain:acme.com") } as SeoAuditResult });
  assert.deepEqual(await repo.refreshWith(ports, "a2"), { status: "none" });
  assert.equal(w.reports.get("a2")?.gscProperty, null);
  assert.equal(w.reports.get("a2")?.result?.gsc ?? null, null);
});
