"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * 第一方事件埋点(E24):pageview(路由变化)+ 关键交互点击。
 * 带会话/访客标识与来源(首触)归因。/admin-dashboard 的数据地基。
 * 绝不影响页面本身;埋点失败静默。
 */

function rid(n = 16): string {
  try {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  } catch {
    return Math.random().toString(36).slice(2, 2 + n);
  }
}

function visitorId(): string | undefined {
  try {
    let v = localStorage.getItem("aeo_vid");
    if (!v) {
      v = rid(16);
      localStorage.setItem("aeo_vid", v);
    }
    return v;
  } catch {
    return undefined;
  }
}

function sessionId(): string | undefined {
  try {
    let s = sessionStorage.getItem("aeo_sid");
    if (!s) {
      s = rid(16);
      sessionStorage.setItem("aeo_sid", s);
      // 首触来源归因(整个会话固定)
      const p = new URLSearchParams(location.search);
      const src = p.get("utm_source") || p.get("ref") || (document.referrer ? new URL(document.referrer).hostname : "") || "direct";
      sessionStorage.setItem("aeo_src", src);
    }
    return s;
  } catch {
    return undefined;
  }
}

function source(): string | undefined {
  try {
    return sessionStorage.getItem("aeo_src") || undefined;
  } catch {
    return undefined;
  }
}

function send(type: string, extra?: Record<string, unknown>) {
  try {
    const payload = JSON.stringify({
      type,
      path: location.pathname,
      referrer: document.referrer || undefined,
      source: source(),
      sessionId: sessionId(),
      visitorId: visitorId(),
      ...extra,
    });
    const ok =
      typeof navigator !== "undefined" &&
      navigator.sendBeacon?.("/api/events", new Blob([payload], { type: "application/json" }));
    if (!ok) {
      fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* 静默 */
  }
}

export function EventTracker() {
  const pathname = usePathname();
  const last = useRef<string>("");

  // pageview
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    send("pageview");
  }, [pathname]);

  // 关键交互:链接/按钮点击(带标签,便于模块热度统计)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement)?.closest?.("a,button") as HTMLElement | null;
      if (!el) return;
      const label = (el.getAttribute("data-ev") || el.textContent || "").trim().slice(0, 80);
      const href = el.getAttribute("href") || undefined;
      send("click", { meta: { label, href, tag: el.tagName.toLowerCase() } });
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
