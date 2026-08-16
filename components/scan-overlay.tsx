"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Reading your brand & category…",
  "Generating the questions real buyers ask AI…",
  "Asking the AI assistants — blind…",
  "Checking if AI search can even find you…",
  "Checking who gets recommended instead…",
  "Measuring your rank & sentiment…",
  "Scoring your AI visibility…",
  "Compiling your report…",
];

export function ScanOverlay({ brand, onCancel }: { brand: string; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [pct, setPct] = useState(4);

  useEffect(() => {
    const stepTimer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4200);
    const pctTimer = setInterval(() => setPct((p) => (p < 95 ? p + Math.max(0.4, (95 - p) * 0.04) : p)), 350);
    return () => {
      clearInterval(stepTimer);
      clearInterval(pctTimer);
    };
  }, []);

  return (
    // 浅色蒸汽磨砂遮罩:糊掉下方首页、透出全站雾气,与 BgAurora 同调
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-paper/70 px-5 backdrop-blur-2xl backdrop-saturate-150">
      {/* 悬浮玻璃模块 —— 与首页 card 同款,所有内容都收进这一个浮起的模块 */}
      <div className="card animate-fade-up w-full max-w-md p-8 text-center sm:p-10">
        <div className="relative z-10">
          {/* 扫描视觉:iris 虹膜(圆环 + 中心点,呼应 logo 母题)悬浮 + 呼吸光晕 —— 无黑,液态磨砂 */}
          <div className="relative mx-auto mb-7 flex h-24 w-24 items-center justify-center">
            <div
              className="absolute inset-0 animate-ping rounded-full bg-iris/20"
              style={{ animationDuration: "2.2s" }}
            />
            <div className="absolute inset-2 rounded-full bg-iris/15 blur-xl" />
            <svg
              viewBox="0 0 48 48"
              className="relative h-[4.5rem] w-[4.5rem] drop-shadow-[0_12px_26px_rgba(109,91,246,0.4)]"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="scan-iris" x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#8E80F8" />
                  <stop offset="1" stopColor="#6D5BF6" />
                </linearGradient>
              </defs>
              {/* 与 logo 同一星系母题(此处放大版 r=13):细轨道 + 大星球 + 骑在轨道线上的卫星 */}
              <circle cx="24" cy="24" r="15" stroke="url(#scan-iris)" strokeWidth="2.6" />
              <circle cx="24" cy="24" r="6.5" fill="url(#scan-iris)" />
              <circle cx="34.61" cy="13.39" r="3.3" fill="url(#scan-iris)" />
            </svg>
          </div>

          <p className="eyebrow mb-2">Auditing {brand || "your brand"}</p>
          <p className="min-h-[1.75rem] font-display text-xl font-semibold text-ink transition-all">
            {STEPS[step]}
          </p>

          {/* 进度条 —— 浅底 + 靛紫渐变,与首页样例报告条一致 */}
          <div className="mx-auto mt-6 h-2 w-full max-w-xs overflow-hidden rounded-full bg-ink/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {/* 免费审计只实时查 ChatGPT —— 不列未参与的引擎,避免误导 */}
          <p className="mt-3 text-sm text-ink/50">
            Usually <span className="font-semibold text-ink/75">under 2 minutes</span> — asking ChatGPT live.
          </p>

          <button
            onClick={onCancel}
            className="mt-8 text-xs font-medium text-ink/40 underline-offset-4 transition hover:text-ink/70 hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
