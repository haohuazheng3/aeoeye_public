import test from "node:test";
import assert from "node:assert/strict";

/* 客户端错误判定的离线测试:用最小的 window / location / sessionStorage / navigator / document 桩,
   不需要浏览器。重点锁住 2026-10-01 的修正:第三方(Clerk)分块失败不再触发整页重载,
   离开页面时的中断与自动化浏览器的报错不进收件箱。 */

type Listener = () => void;
const listeners: Record<string, Listener[]> = {};
let reloads = 0;
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = {
  addEventListener: (t: string, fn: Listener) => { (listeners[t] ||= []).push(fn); },
  location: { reload: () => { reloads++; } },
};
g.location = { origin: "https://aeoeye.com" };
g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
Object.defineProperty(globalThis, "navigator", { value: { webdriver: false }, configurable: true, writable: true });
g.document = { visibilityState: "visible" };

const load = () => import("../client-errors");
const fire = (t: string) => (listeners[t] || []).forEach((fn) => fn());
const reset = () => { reloads = 0; store.clear(); fire("pageshow"); (g.document as { visibilityState: string }).visibilityState = "visible"; (navigator as { webdriver: boolean }).webdriver = false; };

const OWN = { name: "ChunkLoadError", message: "Loading chunk 6455 failed.\n(error: https://aeoeye.com/_next/static/chunks/6455-7f134f970e009a4d.js)" };
const CLERK = { name: "ChunkLoadError", message: "Loading chunk 9573 failed.\n(error: https://clerk.aeoeye.com/npm/@clerk/clerk-js@5.128.0/dist/ui-common_clerk.browser_70f75e_5.128.0.js)" };

test("own /_next/ chunk failure reloads once, then respects the cooldown", async () => {
  const m = await load(); reset();
  assert.equal(m.recoverFromStaleChunk(OWN), true);
  assert.equal(reloads, 1);
  assert.equal(m.recoverFromStaleChunk(OWN), false, "cooldown blocks a reload loop");
  assert.equal(reloads, 1);
});

test("third-party (Clerk) chunk failure never reloads the page", async () => {
  const m = await load(); reset();
  assert.equal(m.isOwnChunk(CLERK.message), false);
  assert.equal(m.recoverFromStaleChunk(CLERK), false);
  assert.equal(reloads, 0);
});

test("no reload and no report while the page is leaving", async () => {
  const m = await load(); reset();
  fire("beforeunload");
  assert.equal(m.pageIsLeaving(), true);
  assert.equal(m.recoverFromStaleChunk(OWN), false);
  assert.equal(m.shouldReportClientError("TypeError", "Failed to fetch"), false);
  // 真正的代码错误照样上报
  assert.equal(m.shouldReportClientError("TypeError", "Cannot read properties of undefined"), true);
  fire("pageshow");
  assert.equal(m.pageIsLeaving(), false);
});

test("automated browsers are not reported", async () => {
  const m = await load(); reset();
  (navigator as { webdriver: boolean }).webdriver = true;
  assert.equal(m.shouldReportClientError("Error", 'Function "autoconsentSendMessage" is not exposed'), false);
});

test("network-level failures are classified as transient", async () => {
  const m = await load();
  for (const msg of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) assert.equal(m.isTransientClientError("TypeError", msg), true, msg);
  assert.equal(m.isTransientClientError("TypeError", "x is not a function"), false);
});

test("chunkUrlOf extracts the failing URL; a message without one is treated as our own", async () => {
  const m = await load();
  assert.equal(m.chunkUrlOf(OWN.message), "https://aeoeye.com/_next/static/chunks/6455-7f134f970e009a4d.js");
  assert.equal(m.isOwnChunk("Loading CSS chunk 12 failed."), true);
});
