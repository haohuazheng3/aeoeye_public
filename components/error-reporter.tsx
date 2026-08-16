"use client";

import { useEffect } from "react";
import { isTransientClientError, recoverFromStaleChunk } from "@/lib/client-errors";

/**
 * 客户端错误上报(E26):捕获 window.onerror 与未处理的 Promise 拒绝,
 * 上报到 /api/errors 入错误收件箱。用 sendBeacon 优先(不阻塞、卸载时也可送达),
 * 失败回退 fetch keepalive。绝不影响页面本身。
 *
 * 判定"哪些是无害噪音"与错误边界共用 lib/client-errors —— 各写一套时
 * global-error 那份漏了降级,把换版噪音记成严重错误、把健康拖成 degraded。
 */
export function ErrorReporter() {
  useEffect(() => {
    const noisy = isTransientClientError;

    function report(name: string, message: string, stack?: string) {
      try {
        const payload = JSON.stringify({
          name: name || "Error",
          message: (message || "").slice(0, 2000),
          stack: (stack || "").slice(0, 6000),
          route: location.pathname,
          level: noisy(name, message) ? "warn" : "error",
        });
        const sent =
          typeof navigator !== "undefined" &&
          navigator.sendBeacon?.("/api/errors", new Blob([payload], { type: "application/json" }));
        if (!sent) {
          fetch("/api/errors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* 上报失败静默,绝不二次抛错 */
      }
    }

    const onError = (e: ErrorEvent) => {
      report(e.error?.name || "Error", e.message || "window.onerror", e.error?.stack);
      // 换版导致的 chunk 404:先上报再自动重载,用户不必看到坏掉的页面
      recoverFromStaleChunk({ name: e.error?.name, message: e.message });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string; stack?: string } | undefined;
      report(r?.name || "UnhandledRejection", String(r?.message ?? r ?? "unhandledrejection"), r?.stack);
      recoverFromStaleChunk({ name: r?.name, message: String(r?.message ?? r ?? "") });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
