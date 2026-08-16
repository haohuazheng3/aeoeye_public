"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { recoverFromStaleChunk } from "@/lib/client-errors";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // 用户开着老页面时我们发了新版 ⇒ 老 chunk 在 CDN 上已不存在。
    // 这不是 bug,自动重载一次即可无感恢复(冷却期护栏防死循环)。
    recoverFromStaleChunk(error);
  }, [error]);

  return (
    <div className="container-tight flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center surface text-coral">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-ink/60">An unexpected error occurred. Try again, or head back home.</p>
      <div className="mt-6 flex gap-3">
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}
