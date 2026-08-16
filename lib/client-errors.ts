/**
 * 客户端错误的共同判定与自愈 —— 被 ErrorReporter、app/error.tsx、
 * app/global-error.tsx 共用。抽出来是因为它们各写一套时已经出过事:
 * global-error 硬编码 level:"error",把部署换版产生的 chunk 噪音记成严重错误,
 * 把 /api/health 拖成 degraded。判定只能有一处定义。
 */

/**
 * 瞬时且无害的客户端错误。最典型的是**部署换版**:用户开着老页面,
 * 我们发了新版,老 chunk 的哈希文件名在 CDN 上已不存在 —— 下一次跳转就 404。
 * 这不是代码 bug,重新加载就好;它不该占错误收件箱,也不该拉低健康状态。
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
    s.includes("script error")
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

const RELOAD_GUARD_KEY = "aeoeye:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * 旧 chunk 拿不到时自动重载一次,把"Something went wrong"死胡同变成无感恢复。
 * 冷却期内不再重载 —— 万一某次失败不是换版引起的(比如用户断网),
 * 连续重载会变成刷屏死循环,那比原来的报错页更糟。
 *
 * @returns 是否已触发重载(true 时调用方不必再渲染错误界面)
 */
export function recoverFromStaleChunk(error: { name?: string; message?: string } | null | undefined): boolean {
  if (typeof window === "undefined" || !error) return false;
  if (!isStaleChunkError(error.name || "", error.message || "")) return false;
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
