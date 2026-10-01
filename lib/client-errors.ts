/**
 * 客户端错误的共同判定与自愈 —— 被 ErrorReporter、app/error.tsx、
 * app/global-error.tsx 共用。抽出来是因为它们各写一套时已经出过事:
 * global-error 硬编码 level:"error",把部署换版产生的 chunk 噪音记成严重错误,
 * 把 /api/health 拖成 degraded。判定只能有一处定义。
 */

/**
 * 瞬时且无害的客户端错误。最典型的是**部署换版**:用户开着老页面,
 * 我们发了新版,老 chunk 的哈希文件名在 CDN 上已不存在 —— 下一次跳转就 404。
 * 网络层的失败(断网、访客离开页面时浏览器中断请求)同理,不是代码 bug。
 * 它们不该占错误收件箱的 error 级,也不该拉低健康状态。
 */
export function isTransientClientError(name: string, message: string): boolean {
  const s = `${name} ${message}`.toLowerCase();
  return (
    s.includes("chunkloaderror") ||
    s.includes("loading chunk") ||
    s.includes("loading css chunk") ||
    s.includes("failed to fetch dynamically imported module") ||
    s.includes("importing a module script failed") ||
    s.includes("resizeobserver loop") ||
    s.trim() === "script error." ||
    s.includes("script error") ||
    // 浏览器各家对"请求没发出去 / 被中断"的说法(Chrome / Safari / Firefox)
    s.includes("failed to fetch") ||
    s.includes("load failed") ||
    s.includes("networkerror when attempting to fetch resource") ||
    s.includes("the network connection was lost")
  );
}

/** 只有换版类(chunk 取不到)才值得自动重载;ResizeObserver 那类重载也没用 */
function isStaleChunkError(name: string, message: string): boolean {
  const s = `${name} ${message}`.toLowerCase();
  return (
    s.includes("chunkloaderror") ||
    s.includes("loading chunk") ||
    s.includes("loading css chunk") ||
    s.includes("failed to fetch dynamically imported module") ||
    s.includes("importing a module script failed")
  );
}

/** webpack 的 ChunkLoadError 形如 "Loading chunk 9573 failed.\n(error: https://…/x.js)";取出那个地址 */
export function chunkUrlOf(message: string): string | null {
  const m = message.match(/\(error:\s*(https?:\/\/[^\s)]+)\)/i) || message.match(/(https?:\/\/\S+?\.(?:m?js|css))(?:[?#]\S*)?(?=$|[\s)])/i);
  return m ? m[1] : null;
}

/**
 * 失败的分块是不是**我们自己发布的**(同源 /_next/)—— 只有它们会因为换版而 404。
 *
 * 2026-10-01 FlowGlance / 错误收件箱复盘:Clerk 登录 SDK 自己的懒加载分块(clerk.aeoeye.com/npm/@clerk/…)
 * 也抛同名的 ChunkLoadError,多半是访客两秒内离开页面、下载被浏览器中断。以前它也命中"换版自愈",
 * 结果把正在读文章的访客整页刷新一遍。第三方分块重载也拿不回来,不该碰。
 * 消息里没带地址时(多见于 CSS chunk)按自家处理,保持原行为。
 */
export function isOwnChunk(message: string, origin: string = typeof location !== "undefined" ? location.origin : ""): boolean {
  const url = chunkUrlOf(message);
  if (!url) return true;
  try {
    const u = new URL(url);
    return (!origin || u.origin === origin) && u.pathname.startsWith("/_next/");
  } catch {
    return false;
  }
}

/* ---------- 页面是否正在离开 ----------
   访客点链接 / 关标签 / 返回时,浏览器会中断还在下载的脚本和请求,随之抛出
   ChunkLoadError、Failed to fetch。这时既不该上报(不是 bug),更不能 reload ——
   reload 会抢在导航前面,把访客留在原页面。beforeunload 之后给 3 秒窗口(导航被取消时自动失效),
   页面被隐藏同样视为离开。 */
let leavingUntil = 0;
let leaveListenersOn = false;

function ensureLeaveListeners(): void {
  if (leaveListenersOn || typeof window === "undefined") return;
  leaveListenersOn = true;
  const mark = () => {
    leavingUntil = Date.now() + 3_000;
  };
  window.addEventListener("beforeunload", mark);
  window.addEventListener("pagehide", mark);
  // 从 bfcache 回来:页面又活了
  window.addEventListener("pageshow", () => {
    leavingUntil = 0;
  });
}

export function pageIsLeaving(): boolean {
  ensureLeaveListeners();
  if (Date.now() < leavingUntil) return true;
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** 自动化浏览器(Playwright / Puppeteer / Selenium 默认都会置 navigator.webdriver) */
export function isAutomatedBrowser(): boolean {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}

/**
 * 这条报错值不值得进错误收件箱:
 * - 自动化浏览器跑出来的不收(2026-09-19 一个 Playwright 爬虫留下 14 条 autoconsent 报错);
 * - 离开页面时被中断的瞬时错误不收(不是 bug,只会淹没真问题)。
 */
export function shouldReportClientError(name: string, message: string): boolean {
  if (isAutomatedBrowser()) return false;
  if (pageIsLeaving() && isTransientClientError(name, message)) return false;
  return true;
}

const RELOAD_GUARD_KEY = "aeoeye:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * 旧 chunk 拿不到时自动重载一次,把"Something went wrong"死胡同变成无感恢复。
 * 冷却期内不再重载 —— 万一某次失败不是换版引起的(比如用户断网),
 * 连续重载会变成刷屏死循环,那比原来的报错页更糟。
 * 只对**自家** /_next/ 分块、且页面没在离开时生效(见 isOwnChunk / pageIsLeaving)。
 *
 * @returns 是否已触发重载(true 时调用方不必再渲染错误界面)
 */
export function recoverFromStaleChunk(error: { name?: string; message?: string } | null | undefined): boolean {
  if (typeof window === "undefined" || !error) return false;
  if (!isStaleChunkError(error.name || "", error.message || "")) return false;
  if (!isOwnChunk(error.message || "")) return false;
  if (pageIsLeaving()) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // 隐私模式下 sessionStorage 可能抛错。没有护栏就不敢自动重载,
    // 宁可让用户看到报错页并手动点一下,也不冒死循环的风险。
    return false;
  }
  window.location.reload();
  return true;
}
