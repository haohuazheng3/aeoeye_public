import type { SubScore } from "@/lib/seo-audit/types";
import { ConfidenceBadge, ScoreBar, scoreValue, subLabel } from "./ranking-meta";

/* ============================================================
   一行小维度:名称 + 分数,下面是分数条 + 可信度徽章。
   支柱卡片里用它;灯箱里每个小维度的头部也是同一套视觉,两处长得一样。
   null = 没测到:条只留轨道,分数位写 "Not measured" —— 绝不画成 0 分(规格 §0)。
   用 div 而不是 li:它放在可点的 <button> 卡片里,列表语义在按钮里会被读屏压平,徒增嵌套。
   ============================================================ */

export function RankingSubRow({ sub }: { sub: Pick<SubScore, "label" | "score" | "confidence"> & { id?: string } }) {
  const v = scoreValue(sub.score);
  return (
    <div className="min-w-0 py-2 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words text-[13px] leading-snug text-ink/75">{subLabel(sub)}</span>
        {v === null ? (
          <span className="shrink-0 text-[11px] font-medium text-ink/40">Not measured</span>
        ) : (
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{v}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <ScoreBar score={v} />
        <ConfidenceBadge confidence={sub.confidence} />
      </div>
    </div>
  );
}
