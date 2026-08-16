"use client";

import { useEffect } from "react";
import { isTransientClientError, recoverFromStaleChunk } from "@/lib/client-errors";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      const payload = JSON.stringify({
        name: error?.name || "GlobalError",
        message: (error?.message || "render crash").slice(0, 2000),
        stack: (error?.stack || "").slice(0, 6000),
        route: typeof location !== "undefined" ? location.pathname : "",
        // 曾经这里硬编码 "error",于是每次发版留下的 chunk 噪音都被记成严重错误、
        // 把 /api/health 拖成 degraded(实测 8 条未处理里 3 条就是这么来的)。
        level: isTransientClientError(error?.name || "", error?.message || "") ? "warn" : "error",
      });
      navigator.sendBeacon?.("/api/errors", new Blob([payload], { type: "application/json" }));
    } catch {
      /* 绝不二次抛错 */
    }
    recoverFromStaleChunk(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ marginTop: "0.5rem", color: "#555" }}>Please try again.</p>
        <button
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            padding: "0.6rem 1.2rem",
            borderRadius: "0.6rem",
            background: "#6D5BF6",
            color: "white",
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
