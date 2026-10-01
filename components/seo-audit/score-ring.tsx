/* ============================================================
   分数环 —— 从 components/report/foundation.tsx 的私有 ScoreRing/scoreTone 复制而来。

   为什么复制而不是 export:foundation.tsx 整体是 "use client",导出会把它的
   客户端边界带进这里所有服务端组件;而分数环本身是纯 SVG,没有任何状态,
   放成独立文件后服务端、客户端两边都能直接用。配色三档与全站一致:
   ≥70 mint / ≥40 amber / <40 coral,null 灰。
   ============================================================ */

export function scoreTone(score: number | null): { ring: string; text: string } {
  if (score === null) return { ring: "stroke-ink/15", text: "text-ink/35" };
  if (score >= 70) return { ring: "stroke-mint", text: "text-mint-deep" };
  if (score >= 40) return { ring: "stroke-amber-500", text: "text-amber-700" };
  return { ring: "stroke-coral", text: "text-coral-deep" };
}

/**
 * size 是像素边长;默认 68 与地基层小环同款,报告头部用 128 的大环。
 * 所有几何量按 68 等比缩放,大小环看起来是同一族。
 */
export function ScoreRing({ score, size = 68, label }: { score: number | null; size?: number; label?: string }) {
  const k = size / 68;
  const r = 26 * k;
  const stroke = 5 * k;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const tone = scoreTone(score);
  const textClass = size >= 110 ? "text-4xl" : size >= 90 ? "text-2xl" : "text-lg";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label ?? `Score ${score ?? "unavailable"}`}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} className="fill-none stroke-ink/[0.07]" strokeWidth={stroke} />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className={`fill-none ${tone.ring}`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-display font-semibold tabular-nums ${textClass} ${tone.text}`}>
          {score === null ? "—" : score}
        </span>
      </div>
    </div>
  );
}
