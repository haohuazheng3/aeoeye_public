"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Sparkles, Loader2, ArrowRight, Check } from "lucide-react";

// 模块级:保证登录后自动续单全局只触发一次(报告页有多个解锁按钮)
let autoResumeFired = false;

/**
 * 发起完整报告解锁(Stripe checkout)。
 * 未登录时先跳转登录,登录后自动回到本页继续支付(?unlock=1 触发)。
 */
export function UnlockButton({
  auditId,
  product = "report",
  className = "btn-primary",
  children,
}: {
  auditId: string;
  /** 目前只有一个付费产品:$29 一次性完整报告(Pro 订阅已下线) */
  product?: "report";
  className?: string;
  children?: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 匿名可买:直接开 Stripe checkout,不再先查登录态、不再拦去登录。
  // 保留 401+requiresAuth 分支作为兜底:后端若因任何原因要求登录,仍能回来续单。
  const go = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const coupon = params.get("coupon") || undefined;
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, product, coupon }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.requiresAuth) {
        const back = `${window.location.pathname}?unlock=1${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ""}`;
        window.location.href = `/login?redirect=${encodeURIComponent(back)}`;
        return;
      }
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Couldn’t start checkout. Please try again.");
      setLoading(false);
    } catch {
      setError("Couldn’t start checkout. Please try again.");
      setLoading(false);
    }
  }, [auditId, product]);

  // 订阅登录后回到 ?unlock=1 → 自动继续支付(全局只触发一次)
  useEffect(() => {
    if (autoResumeFired) return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("unlock") === "1") {
      autoResumeFired = true;
      go();
    }
  }, [go]);

  return (
    <span className="inline-flex max-w-full flex-col items-center gap-2">
      <button onClick={go} disabled={loading} className={className}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {children || "Unlock full report"}
      </button>
      {error && <span role="alert" className="max-w-xs text-center text-xs font-medium text-coral-deep">{error}</span>}
    </span>
  );
}

/** 锁定区:模糊内容 + 覆盖解锁提示 */
export function LockedSection({
  auditId,
  title,
  blurb,
  children,
}: {
  auditId: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  // min-h 由容器给:覆盖层是 absolute inset-0,高度完全跟随 children。
  // children 矮(如 3 行竞品表)时图标+标题+说明+按钮会塞不下而溢出模块。
  return (
    <div className="relative min-h-[15rem] overflow-hidden rounded-[1.75rem] border border-white/60 sm:min-h-[13rem]">
      <div className="pointer-events-none select-none blur-[6px]" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-white/55 px-5 py-6 text-center backdrop-blur-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-iris/10 text-iris">
          <Lock className="h-4 w-4" />
        </div>
        <h3 className="font-display text-base font-semibold leading-snug sm:text-lg">{title}</h3>
        <p className="max-w-xs text-sm leading-snug text-ink/55 sm:max-w-sm">{blurb}</p>
        <UnlockButton auditId={auditId} className="btn-primary mt-1 shrink-0" />
      </div>
    </div>
  );
}

/**
 * 大型解锁横幅 —— 免费报告最重要的钩子。
 *
 * 结构上先给**三个可核对的数字**(引擎 ×5、题目 ×3.3、判卷换最强档),再列其余。
 * 数字比形容词有说服力,而且每一个都能在付费报告里当场验证 —— 吹不了。
 * ⚠️ 分析模型只说"最强档",不点名型号:模型会换代,承诺的是档位。
 */
export function UnlockBanner({ auditId, questionCount = 3 }: { auditId: string; questionCount?: number }) {
  const headline = [
    { n: "5", label: "AI engines", sub: "vs 1 now" },
    { n: "10", label: "buyer questions", sub: `vs ${questionCount} now` },
    { n: "5", label: "site audit layers", sub: "not in preview" },
  ];
  const perks = [
    "Claude, Gemini, Google AI & Perplexity — same questions, side by side",
    "Re-analysed end to end by our most capable model",
    "Real-user speed data + your backlink profile",
    "Full fix roadmap, prioritised — plus a PDF in your inbox",
  ];
  return (
    <div className="card p-8 sm:p-10">
      <div className="relative z-10 grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow">Unlock the full picture</p>
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            You’re seeing one engine’s answer.
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink/55">
            Buyers don’t all ask ChatGPT. The full report asks every major assistant the same questions — and tells you
            which one is costing you the most.
          </p>

          {/* 三个数字 —— 比任何形容词都快 */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            {headline.map((h) => (
              <div key={h.label} className="surface p-3.5 text-center sm:p-4">
                <p className="font-display text-2xl font-semibold text-ink sm:text-3xl">{h.n}</p>
                <p className="mt-0.5 text-[11px] font-medium leading-tight text-ink/60">{h.label}</p>
                <p className="mt-0.5 text-[10px] text-ink/35">{h.sub}</p>
              </div>
            ))}
          </div>

          <ul className="mt-5 space-y-2">
            {perks.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm text-ink/65">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-iris" /> {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <UnlockButton auditId={auditId} className="btn-primary w-full justify-center py-4 text-base" />
          <a href="/pricing" className="btn-ghost w-full justify-center py-4">
            Compare plans <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
