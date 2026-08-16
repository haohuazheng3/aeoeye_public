"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, AlertCircle, Check, Mail } from "lucide-react";

/**
 * 付费解锁后的**全屏生成页**。
 *
 * 站长 2026-08-10:付款后不要再让用户翻旧的免费版报告 —— 那份只有 3 题、
 * 一个引擎,他刚花钱买的是另一份东西,先看到旧的只会以为"我买了个寂寞"。
 * 所以这段时间整页只有进度,生成完一次性展示完整报告。
 *
 * 两条腿并行,因为生成要跑几分钟、POST 很可能被网关掐断:
 *   1. POST 触发生成(长请求,超时不代表失败);
 *   2. GET 只读轮询状态 —— 只要后端写完了就刷新页面。
 */

/** 阶段清单。时间是**经验估计**,不是后端真进度 —— 文案上不许说成"已完成 X" */
const STAGES = [
  { at: 0, label: "Writing 10 buyer questions" },
  { at: 25, label: "Asking ChatGPT, Claude, Gemini, Google AI & Perplexity" },
  { at: 105, label: "Judging every answer with our most capable model" },
  { at: 150, label: "Auditing your site across 5 technical layers" },
  { at: 195, label: "Building your fix roadmap" },
];
/** 典型总时长(秒)。进度条封顶 95%,真完成才到 100 —— 不假装比实际更快 */
const TYPICAL = 230;

export function UpgradeRunner({ auditId, brand }: { auditId: string; brand?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);
  const stopped = useRef(false);
  const tries = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /**
   * 自动 reload 全局只允许一次(每份报告),这是**防频闪的硬保险**。
   * 后端说 done、reload 回来页面却仍要求升级 —— 再刷一百次也不会变,
   * 只会把报告页刷成频闪灯(2026-08-10 真发生过)。
   */
  const reloadOnce = useCallback(() => {
    const key = `aeoeye:upgraded:${auditId}`;
    try {
      if (sessionStorage.getItem(key)) {
        setFailed("Your full report is taking longer than usual. Refresh in a minute — nothing is lost.");
        return;
      }
      sessionStorage.setItem(key, "1");
    } catch {
      /* 隐私模式下 sessionStorage 可能抛错 —— 那就退回原来的行为,刷一次 */
    }
    window.location.reload();
  }, [auditId]);

  const poll = useCallback(async () => {
    if (stopped.current) return;
    try {
      const res = await fetch(`/api/audit/${auditId}/upgrade`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data.done) {
        stopped.current = true;
        reloadOnce();
        return;
      }
    } catch {
      /* 轮询失败无所谓,下一轮再来 */
    }
    if (stopped.current) return;
    // 上限 ≈7 分钟。函数被平台掐掉时结果不落库,后端永远不会 done ——
    // 无上限轮询就成了永远转圈的加载态。
    if (++tries.current >= 42) {
      stopped.current = true;
      setFailed("This is taking longer than usual. Your payment is safe — hit Try again, or come back in a few minutes.");
      return;
    }
    setTimeout(poll, 10000);
  }, [auditId, reloadOnce]);

  const run = useCallback(async () => {
    setFailed(null);
    stopped.current = false;
    tries.current = 0;
    try {
      sessionStorage.removeItem(`aeoeye:upgraded:${auditId}`);
    } catch {
      /* 隐私模式:忽略 */
    }
    setTimeout(poll, 8000); // 轮询独立于 POST,POST 断了也能收尾
    try {
      const res = await fetch(`/api/audit/${auditId}/upgrade`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.done) {
        stopped.current = true;
        reloadOnce();
        return;
      }
      if (data.running) return; // 另一请求在生成,交给轮询
      // 只有明确的业务错误(余额/配置类)才提示;网络与超时一律交给轮询继续等
      if (data.error) setFailed(data.error);
    } catch {
      /* 长请求被掐断很常见 —— 不判失败,让轮询决定 */
    }
  }, [auditId, poll, reloadOnce]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    return () => {
      stopped.current = true;
    };
  }, [run]);

  const pct = Math.min(95, Math.round((elapsed / TYPICAL) * 100));
  const currentIdx = STAGES.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div className="container-tight flex min-h-[70vh] items-center py-12 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <div className="card p-7 sm:p-9">
          <div className="relative z-10">
            <p className="eyebrow">Payment confirmed</p>
            <h1 className="mt-2.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {failed ? "Still finishing your report" : "Building your full report"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink/55">
              {failed ? (
                failed
              ) : (
                <>
                  10 buyer questions across 5 AI engines{brand ? ` for ${brand}` : ""}, plus the 5-layer site audit.
                  This usually takes <span className="font-semibold text-ink/75">2–4 minutes</span>.
                </>
              )}
            </p>

            {!failed && (
              <>
                <div className="mt-7">
                  <div className="flex items-baseline justify-between text-xs text-ink/45">
                    <span className="font-medium text-ink/60">{STAGES[currentIdx]?.label}</span>
                    <span className="tabular-nums">
                      {mins}:{String(secs).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-1000 ease-out"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </div>

                <ul className="mt-6 space-y-2.5">
                  {STAGES.map((s, i) => {
                    const done = i < currentIdx;
                    const active = i === currentIdx;
                    return (
                      <li key={s.label} className="flex items-center gap-2.5 text-sm">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                            done ? "bg-mint/15 text-mint-deep" : active ? "bg-iris/10 text-iris" : "bg-ink/[0.05]"
                          }`}
                        >
                          {done ? (
                            <Check className="h-3 w-3" />
                          ) : active ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : null}
                        </span>
                        <span className={done ? "text-ink/45" : active ? "font-medium text-ink" : "text-ink/35"}>
                          {s.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {/* 进度是按经验时间推进的,不是后端真进度 —— 说清楚,别让它看着像精确读数 */}
                <p className="mt-6 text-xs leading-relaxed text-ink/35">
                  Progress is estimated from typical run times, not a live server readout. Keep this tab open — the page
                  refreshes itself the moment your report is ready.
                </p>
              </>
            )}

            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-ink/[0.06] pt-5">
              {failed ? (
                <button onClick={run} className="btn-primary">
                  <RefreshCw className="h-4 w-4" /> Try again
                </button>
              ) : null}
              <p className="flex items-center gap-2 text-xs text-ink/45">
                {failed ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                ) : (
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                )}
                The PDF is emailed to the address you used at checkout — you can close this tab.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
