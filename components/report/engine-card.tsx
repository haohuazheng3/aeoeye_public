import { Lock, Check, X, Minus, AlertCircle } from "lucide-react";
import type { EngineSummary } from "@/lib/engine/types";
import { VisibilityBar } from "./score-gauge";

export function EngineCard({ engine, unlocked }: { engine: EngineSummary; unlocked?: boolean }) {
  /**
   * 引擎跑了但一个字没回。**必须单独一档**:走下面的正常渲染会显示
   * "visibility 0 / 0 of N questions",读起来就是"这个 AI 完全不推荐你" ——
   * 那是把故障说成测量结果,是报告里最不能犯的错。
   */
  if (engine.status === "error") {
    return (
      <div className="relative flex flex-col justify-between overflow-hidden rounded-[1.75rem] border border-white/50 bg-white/30 p-5">
        <div className="absolute right-3 top-3 text-ink/25">
          <AlertCircle className="h-4 w-4" />
        </div>
        <div>
          <p className="font-display text-base font-semibold text-ink/60">{engine.label}</p>
          <p className="mt-1 text-xs text-ink/40">No answer returned</p>
        </div>
        <p className="mt-4 text-xs text-ink/40">
          {engine.note || "This engine didn't respond — it isn't counted in your score."}
        </p>
      </div>
    );
  }

  if (engine.status === "inactive") {
    // 生成中的形态不在这里 —— 付费生成期整页交给 UpgradeRunner,报告根本不渲染。
    // 未激活:不浮起(无 card 阴影/高光环)、更透更淡 —— 把注意力让给 live 卡。
    // ⚠️ 文案必须分免费/付费两套:已付过 $29 的人看到 "unlock / activate",
    // 会以为还要再买一次。对他们这就是"这条通道这轮没连上",与钱无关。
    return (
      <div className="relative flex flex-col justify-between overflow-hidden rounded-[1.75rem] border border-white/40 bg-white/20 p-5">
        <div className="absolute right-3 top-3 text-ink/20">
          <Lock className="h-4 w-4" />
        </div>
        <div>
          <p className="font-display text-base font-semibold text-ink/45">{engine.label}</p>
          <p className="mt-1 text-xs text-ink/35">{unlocked ? "Not connected" : "In the full report"}</p>
        </div>
        <p className="mt-4 text-xs text-ink/35">
          {unlocked
            ? `We couldn't reach ${engine.label} on this run — it isn't counted in your score.`
            : `Unlock the full report to see how ${engine.label} answers.`}
        </p>
      </div>
    );
  }

  // 分数配色收敛:高=薄荷,低=珊瑚,中间用中性墨色(不引入琥珀,保持色彩精简)
  const tone =
    engine.visibilityScore >= 70 ? "text-mint-deep" : engine.visibilityScore >= 40 ? "text-ink" : "text-coral-deep";

  // live(已解锁)= 突出:墨色描边 + 加强浮影,与阶梯选中层同一语言
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="font-display text-base font-semibold">{engine.label}</p>
        {engine.live && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
            style={{ backgroundImage: "linear-gradient(180deg, #242a40, #0c0e16 62%)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-mint" /> Live
          </span>
        )}
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className={`font-display text-3xl font-semibold ${tone}`}>{engine.visibilityScore}</span>
        <span className="text-xs text-ink/45">visibility</span>
      </div>

      <div className="mt-4">
        <VisibilityBar value={engine.mentionRate} label="Mention rate" />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          {engine.questionsMentioned > 0 ? (
            <Check className="h-3.5 w-3.5 text-mint" />
          ) : (
            <X className="h-3.5 w-3.5 text-coral" />
          )}
          <span className="text-ink/60">
            {engine.questionsMentioned}/{engine.questionsAsked} questions
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {engine.avgRank ? <Minus className="h-3.5 w-3.5 text-ink/40" /> : <X className="h-3.5 w-3.5 text-coral" />}
          <span className="text-ink/60">{engine.avgRank ? `Avg rank #${engine.avgRank}` : "Unranked"}</span>
        </div>
      </dl>
    </div>
  );
}
