"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, AlertCircle, Check, Pause, Clock } from "lucide-react";
import { startUpgradeMachine, type UpgradeReply } from "./upgrade-machine";

/* ============================================================
   付费解锁后的生成页 —— 与 components/report/upgrade-runner.tsx 同构。

   付款后不再让用户翻免费版:他买的是 40 页抓取 + 桌面 PSI + 站外三模块,
   先看到旧报告只会以为"买了个寂寞"。整页只有进度,生成完一次性刷出完整报告。

   POST / 轮询 / 等待供应商的状态机在 upgrade-machine.ts(复审 C34);这里只管画:
   - 等待供应商时冻结按秒推进的估算进度与阶段(后端此刻什么都没在跑,不许继续打勾),
     当前阶段换成暂停图标,并显示下一次自动重试的倒计时;
   - reload 每份报告只允许一次(sessionStorage 键),防止"后端说 done、页面回来仍要求升级"时刷成频闪灯。
   ============================================================ */

const STAGES = [
  { at: 0, label: "Re-crawling up to 40 pages" },
  { at: 15, label: "Authority & backlinks (DataForSEO)" },
  { at: 35, label: "Search visibility & ranked keywords" },
  { at: 50, label: "Competitor overlap" },
  { at: 65, label: "PageSpeed Insights — desktop" },
  { at: 80, label: "Comparing your pages with the page-one results" },
  { at: 105, label: "Computing your SEO Ranking Score and roadmap" },
];
/**
 * 典型总时长(秒)。前六个模块并行、各自 60s 超时,通常 90s 内结束;v3 之后还要抓排名前列的页面做对比
 * (≤3 个查询 × 5 页,单独 60s 预算),合计约 2 分钟。进度条封顶 95%
 */
const TYPICAL = 120;

const PROVIDER_NOTICE =
  "Our ranking-data provider is temporarily unavailable. We'll retry automatically — your payment is safe.";

export function SeoUpgradeRunner({ auditId, domain }: { auditId: string; domain?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  /** 每次 +1 就整轮重来(Try again);effect 清理时 stop() 让上一轮的计时器和在途回调全部作废 */
  const [attempt, setAttempt] = useState(0);
  /** 秒表回调里要读"此刻是否在等供应商" —— state 在 interval 闭包里是旧值,所以另存一份 ref */
  const waitingRef = useRef(false);

  // 秒表:等待供应商期间冻结(进度条与阶段都由 elapsed 推导),只刷新"下次重试"倒计时
  useEffect(() => {
    const t = setInterval(() => {
      if (waitingRef.current) setTick((n) => n + 1);
      else setElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /**
   * 自动 reload 每份报告只允许一次。键只在用户点 Try again 时清掉 ——
   * 挂载时就清的话,"后端说 done、页面回来仍渲染生成页"会变成无限刷新,防频闪保险形同虚设。
   */
  const reloadOnce = useCallback(() => {
    const key = `aeoeye:seo-upgraded:${auditId}`;
    try {
      if (sessionStorage.getItem(key)) {
        setFailed("Your full report is taking longer than usual. Refresh in a minute — nothing is lost.");
        return;
      }
      sessionStorage.setItem(key, "1");
    } catch {
      /* 隐私模式下 sessionStorage 可能抛错 —— 退回原行为,刷一次 */
    }
    window.location.reload();
  }, [auditId]);

  useEffect(() => {
    waitingRef.current = false;
    const machine = startUpgradeMachine({
      post: async () => {
        const res = await fetch(`/api/seo-audit/${auditId}/upgrade`, { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as UpgradeReply;
        return { status: res.status, data };
      },
      get: async () => {
        const res = await fetch(`/api/seo-audit/${auditId}/upgrade`, { cache: "no-store" });
        return (await res.json().catch(() => ({}))) as UpgradeReply;
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout> | undefined),
      now: () => Date.now(),
      onWaiting: (v) => {
        waitingRef.current = v;
        setWaiting(v);
      },
      onNextRetryAt: setNextRetryAt,
      onFailed: setFailed,
      onRunStarted: () => setElapsed(0),
      onDone: reloadOnce,
    });
    return () => machine.stop();
  }, [auditId, attempt, reloadOnce]);

  const tryAgain = () => {
    try {
      sessionStorage.removeItem(`aeoeye:seo-upgraded:${auditId}`);
    } catch {
      /* 隐私模式:忽略 */
    }
    waitingRef.current = false;
    setWaiting(false);
    setNextRetryAt(null);
    setFailed(null);
    setElapsed(0);
    setAttempt((n) => n + 1);
  };

  const pct = Math.min(95, Math.round((elapsed / TYPICAL) * 100));
  const currentIdx = STAGES.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  // 只在客户端的等待态里算(SSR 首帧 waiting=false,不会走到 Date.now())
  const retryIn = waiting && nextRetryAt !== null ? Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000)) : null;

  return (
    <div className="container-tight flex min-h-[70vh] items-center py-12 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <div className="card p-7 sm:p-9">
          <div className="relative z-10">
            <p className="eyebrow">Payment confirmed</p>
            <h1 className="mt-2.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {failed ? "Still finishing your report" : "Building your full SEO report"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink/55">
              {failed ? (
                failed
              ) : (
                <>
                  40-page crawl, desktop PageSpeed, authority, rankings, competitors and your SEO Ranking Score
                  {domain ? ` for ${domain}` : ""}. This usually takes <span className="font-semibold text-ink/75">about 2 minutes</span>.
                </>
              )}
            </p>

            {!failed && (
              <>
                <div className="mt-7">
                  <div className="flex items-baseline justify-between gap-3 text-xs text-ink/45">
                    <span className="font-medium text-ink/60">
                      {waiting ? "Paused — waiting for our data provider" : STAGES[currentIdx]?.label}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {waiting
                        ? retryIn !== null
                          ? `Next try in ${retryIn}s`
                          : "Retrying…"
                        : `${mins}:${String(secs).padStart(2, "0")}`}
                    </span>
                  </div>
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-1000 ease-out ${
                        waiting ? "opacity-40" : ""
                      }`}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </div>

                <ul className="mt-6 space-y-2.5">
                  {STAGES.map((s, i) => {
                    const done = i < currentIdx;
                    const active = i === currentIdx;
                    const running = active && !waiting;
                    const paused = active && waiting;
                    return (
                      <li key={s.label} className="flex items-center gap-2.5 text-sm">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                            done
                              ? "bg-mint/15 text-mint-deep"
                              : running
                                ? "bg-iris/10 text-iris"
                                : paused
                                  ? "bg-ink/[0.06] text-ink/45"
                                  : "bg-ink/[0.05]"
                          }`}
                        >
                          {done ? (
                            <Check className="h-3 w-3" />
                          ) : running ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : paused ? (
                            <Pause className="h-3 w-3" />
                          ) : null}
                        </span>
                        <span
                          className={done ? "text-ink/45" : running ? "font-medium text-ink" : paused ? "text-ink/55" : "text-ink/35"}
                        >
                          {s.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {waiting && (
                  <p
                    className="mt-5 flex items-start gap-2 rounded-2xl bg-ink/[0.03] p-3.5 text-xs leading-relaxed text-ink/65"
                    role="status"
                  >
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-iris" /> {PROVIDER_NOTICE}
                  </p>
                )}

                <p className="mt-6 text-xs leading-relaxed text-ink/35">
                  {waiting
                    ? "Retries run from this page once a minute. If you close it, your report link keeps working — opening it again picks up from here."
                    : "Progress is estimated from typical run times, not a live server readout. Keep this tab open — the page refreshes itself the moment your report is ready."}
                </p>
              </>
            )}

            {failed && (
              <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-ink/[0.06] pt-5">
                <button onClick={tryAgain} className="btn-primary">
                  <RefreshCw className="h-4 w-4" /> Try again
                </button>
                <p className="flex items-center gap-2 text-xs text-ink/45">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" /> Your report link stays valid — you can come
                  back to it any time.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
