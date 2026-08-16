import { gradeFor } from "@/lib/utils";

function colorFor(score: number): { stroke: string; text: string } {
  if (score >= 70) return { stroke: "#16C79A", text: "text-mint-deep" };
  if (score >= 40) return { stroke: "#F6A93B", text: "text-amber-deep" };
  return { stroke: "#FF5A6E", text: "text-coral-deep" };
}

/** 半圆仪表盘 0-100 */
export function ScoreGauge({ score, size = 220 }: { score: number; size?: number }) {
  const grade = gradeFor(score);
  const { stroke, text } = colorFor(score);
  const r = 90;
  const cx = 110;
  const cy = 110;
  // 半圆:180°(从左到右),周长 = π * r
  const circ = Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = `${circ * pct} ${circ}`;

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size }}>
      <svg viewBox="0 0 220 130" width={size} height={(size * 130) / 220} aria-hidden="true">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#E7E5DD"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={stroke}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      </svg>
      <div className="absolute inset-x-0 top-[42%] flex flex-col items-center">
        <span className={`font-display text-5xl font-semibold ${text}`}>{score}</span>
        <span className="text-xs font-medium text-ink/45">out of 100</span>
      </div>
      <div className={`-mt-2 flex items-center gap-2 ${text}`}>
        <span className="font-display text-lg font-bold">Grade {grade}</span>
      </div>
    </div>
  );
}

/** 小型条形可见度指示 —— 统一靛紫渐变(与首页样例报告条一致),不引入多余色 */
export function VisibilityBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-ink/55">{label}</span>
          <span className="font-semibold text-ink">{value}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
