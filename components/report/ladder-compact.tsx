import type { VisibilityProbe } from "@/lib/engine/types";

const NAMES = ["Invisible", "Found, not picked", "Mentioned", "Top pick", "In AI's memory"];

/**
 * 紧凑版可见度阶梯 —— 完整报告里每个引擎都要有"How far AI recommends you",
 * 5 个引擎各放一条完整竖轨会把页面撑爆,所以横向 5 段 + 当前层名 + 一行证据。
 * 语义与竖轨版(visibility-ladder.tsx)完全一致,同一套 probe 数据。
 */
export function LadderCompact({ v, engineLabel }: { v: VisibilityProbe; engineLabel: string }) {
  // 存量/无记忆层证据的第 5 层保守降级 —— 与竖轨版同一条规则,两处不能打架
  const level =
    v.level === 5 && v.memoryQuestions == null && v.knowledgeMentionRate == null ? 4 : v.level;
  const rate = v.searchMentionRate ?? v.knowledgeMentionRate ?? 0;

  return (
    <div className="surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/40">
          How far {engineLabel} recommends you
        </p>
        <p className="text-xs text-ink/40">
          Level {level} <span className="text-ink/25">/ 5</span>
        </p>
      </div>

      <p className="mt-2.5 font-display text-lg font-semibold tracking-tight">{NAMES[level - 1]}</p>

      {/* 5 段轨道:已达到的段落用墨色渐变填充 */}
      <div className="mt-3 flex gap-1.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`h-1.5 flex-1 rounded-full ${n <= level ? "" : "bg-ink/[0.08]"}`}
            style={n <= level ? { backgroundImage: "linear-gradient(90deg, #242a40, #0c0e16)" } : undefined}
          />
        ))}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink/60">
        Named in <span className="font-semibold text-ink">{rate}%</span> of the questions
        {v.searchAvgRank != null ? <> · average position #{v.searchAvgRank}</> : null}
        {v.pickedInstead.length ? <> · leads with {v.pickedInstead.slice(0, 2).join(", ")}</> : null}
      </p>
    </div>
  );
}
