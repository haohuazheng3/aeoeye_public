"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import type { SeoAuditStage } from "@/lib/seo-audit/types";
import { FREE_CRAWL_PAGES, FULL_CRAWL_PAGES } from "@/lib/seo-audit/types";
import { SeoAuditForm } from "./seo-audit-form";
import { advanceStage, isPaidStage, rowState, stageRows, stageStatus } from "./progress-stages";

/* ============================================================
   运行中的阶段页 —— 报告页在 status ≠ complete 时整页只渲染这个。

   进度来自后端真实 progress(每 3s 轮询 GET /api/seo-audit/[id]),不是经验估算。
   完成或失败都交给 router.refresh():服务端组件重新渲染出报告或失败态,这里不自己拼两套 UI。
   阶段顺序、单调推进与每行的状态都在 progress-stages.ts(复审 C17/C33)。
   ============================================================ */

const POLL_MS = 3000;
/** 运行侧的共享 deadline 是 250s;轮到 5 分钟还没完成就明确告诉用户,不再无声转圈 */
const MAX_POLLS = 100;

type Poll = {
  status?: "pending" | "running" | "complete" | "failed";
  error?: string | null;
  progress?: { stage?: SeoAuditStage; percent?: number; pagesCrawled?: number; message?: string } | null;
};

export function SeoProgress({
  id,
  domain,
  full = false,
}: {
  id: string;
  domain?: string;
  /** 完整版运行(已解锁报告的重跑):40 页、桌面 PSI、站外模块 —— 文案与付费阶段行只对它显示 */
  full?: boolean;
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState<SeoAuditStage>("queued");
  /** 兜底:页面没传 full、后端却发来了付费阶段 —— 照样把付费行显示出来,别让它没有归属 */
  const [sawPaid, setSawPaid] = useState(false);
  const [pages, setPages] = useState(0);
  const [message, setMessage] = useState("");
  const [stalled, setStalled] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const polls = useRef(0);
  const stopped = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/seo-audit/${id}`, { cache: "no-store" });
        if (res.status === 404) {
          setFailed("This audit no longer exists. Start a new one below.");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as Poll;
        const next = data.progress?.stage;
        // 单调:只前进不后退;更靠前的或未知的阶段直接忽略
        if (next) {
          setStage((prev) => advanceStage(prev, next));
          if (isPaidStage(next)) setSawPaid(true);
        }
        if (typeof data.progress?.pagesCrawled === "number") setPages(data.progress.pagesCrawled);
        if (data.progress?.message) setMessage(data.progress.message);
        if (data.status === "complete") {
          stopped.current = true;
          router.refresh();
          return;
        }
        if (data.status === "failed") {
          stopped.current = true;
          // 服务端会渲染失败态;refresh 之前先把原因摆出来,避免 refresh 慢时用户看着空转
          setFailed(data.error || "We couldn't finish this audit.");
          router.refresh();
          return;
        }
      } catch {
        /* 一次轮询失败无所谓,下一轮再来 */
      }
      if (++polls.current >= MAX_POLLS) {
        setStalled(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, router]);

  const paid = full || sawPaid;
  const rows = stageRows(paid);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const maxPages = full ? FULL_CRAWL_PAGES : FREE_CRAWL_PAGES;

  return (
    <div className="container-tight flex min-h-[70vh] items-center py-12 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <div className="card p-7 sm:p-9">
          <div className="relative z-10">
            <p className="eyebrow">SEO audit</p>
            <h1 className="mt-2.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {failed ? "We couldn't finish this audit" : stalled ? "Still working on it" : `Auditing ${domain ?? "your site"}`}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink/55">
              {failed ? (
                failed
              ) : stalled ? (
                "This run is taking longer than usual. The site may be slow to respond. Refresh in a minute — if it failed, you'll see why and can re-run."
              ) : full ? (
                <>
                  We re-crawl up to {maxPages} pages, check robots and sitemaps, and run PageSpeed Insights on mobile and
                  desktop. This usually takes <span className="font-semibold text-ink/75">2–3 minutes</span>.
                </>
              ) : (
                <>
                  We crawl up to {maxPages} pages, check robots and sitemaps, and run PageSpeed Insights. This usually takes{" "}
                  <span className="font-semibold text-ink/75">60–90 seconds</span>.
                </>
              )}
            </p>

            {!failed && (
              <>
                <div className="mt-7 flex items-baseline justify-between text-xs text-ink/45">
                  <span className="font-medium text-ink/60">
                    {stageStatus(stage, paid)}
                    {stage === "crawling" && pages > 0 ? ` · ${pages} pages` : ""}
                  </span>
                  <span className="tabular-nums">
                    {mins}:{String(secs).padStart(2, "0")}
                  </span>
                </div>
                <ul className="mt-4 space-y-2.5" aria-live="polite">
                  {rows.map((s) => {
                    const state = rowState(s, stage);
                    const done = state === "done";
                    const active = state === "active";
                    return (
                      <li key={s.id} className="flex items-center gap-2.5 text-sm">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                            done ? "bg-mint/15 text-mint-deep" : active ? "bg-iris/10 text-iris" : "bg-ink/[0.05]"
                          }`}
                        >
                          {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        </span>
                        <span className={done ? "text-ink/45" : active ? "font-medium text-ink" : "text-ink/35"}>
                          {s.label}
                          {s.id === "crawling" && (done || active) && pages > 0 ? (
                            <span className="text-ink/40"> · {pages} fetched</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {message && <p className="mt-4 text-xs text-ink/45">{message}</p>}
                <p className="mt-6 text-xs leading-relaxed text-ink/35">
                  Keep this tab open — the page refreshes itself the moment the report is ready. The run continues on our
                  side even if you leave.
                </p>
              </>
            )}

            {(failed || stalled) && (
              <div className="mt-6 border-t border-ink/[0.06] pt-5">
                {stalled && !failed && (
                  <button onClick={() => router.refresh()} className="btn-ghost mb-4 px-4 py-2 text-sm">
                    <RefreshCw className="h-4 w-4" /> Refresh now
                  </button>
                )}
                <p className="mb-2 flex items-center gap-2 text-xs text-ink/50">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Start a new audit
                </p>
                <SeoAuditForm source="seo-progress-retry" variant="inline" cta="Run again" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
