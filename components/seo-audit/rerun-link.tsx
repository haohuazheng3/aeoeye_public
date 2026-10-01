"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";

/* ============================================================
   "Re-run" —— 报告头部的小动作。

   免费报告:POST /api/seo-audit { url, fresh: true } 新建一行(同域每小时 1 次强制重跑),
   成功后跳到新 id。付费报告:POST /api/seo-audit/[id]/rerun(30 天内不限次),
   完成后 refresh 当前页。两条路的限流错误都原样显示,不猜文案。
   匿名日配额用尽(401 requiresAuth)同样不静默跳登录:先显示原因,再给登录链接(复审 C32 同一口径)。
   ============================================================ */

export function RerunLink({ id, url, unlocked }: { id: string; url: string; unlocked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);

  async function rerun() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    setNeedsAuth(false);
    try {
      if (unlocked) {
        const res = await fetch(`/api/seo-audit/${id}/rerun`, { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && data.ok) {
          router.refresh();
          return;
        }
        setMsg(data.error || (res.status === 429 ? "Re-run limit reached for now." : "Couldn't start a re-run."));
      } else {
        const res = await fetch("/api/seo-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, source: "rerun", fresh: true }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; requiresAuth?: boolean };
        if ((res.status === 200 || res.status === 201) && data.id) {
          router.push(`/seo-audit/${data.id}`);
          return;
        }
        if (res.status === 401 && data.requiresAuth) {
          setNeedsAuth(true);
          setMsg(data.error || "You've used today's free audits from this network. Sign in to keep going.");
          return;
        }
        setMsg(
          data.error ||
            (res.status === 429 ? "One forced re-run per hour on the free tier — try again later." : "Couldn't start a re-run.")
        );
      }
    } catch {
      setMsg("Network hiccup — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={rerun}
        disabled={busy}
        className="inline-flex items-center gap-1 font-medium text-iris hover:underline disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Re-run
      </button>
      {msg && (
        <span role="alert" className="text-xs text-coral-deep">
          {msg}
        </span>
      )}
      {needsAuth && (
        <Link
          href={`/login?redirect=${encodeURIComponent(`/seo-audit/${id}`)}`}
          className="whitespace-nowrap text-xs font-semibold text-iris hover:underline"
        >
          Sign in to continue
        </Link>
      )}
    </span>
  );
}
