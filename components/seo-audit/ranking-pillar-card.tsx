"use client";

import { Target } from "lucide-react";
import type { PillarScore, SubScore } from "@/lib/seo-audit/types";
import { Lightbox, MoreAffordance, useLightbox } from "@/components/report/lightbox";
import { ScoreRing } from "./score-ring";
import { RankingSubRow } from "./ranking-sub-row";
import { ConfidenceBadge, PILLAR_ICON, PillarName, ScoreBar, scoreValue, subMeasures } from "./ranking-meta";

/* ============================================================
   一个支柱 = 一张可点开的卡(与 DimensionCard 同一套交互)。
   折叠态:图标 + 支柱名 + 作用一句 + 分数环 + 每个小维度一行(名称 / 分数条 / 可信度);
   灯箱:每个小维度的结论句、证据、修法 —— 长内容只进灯箱,折叠态保持短(站长 2026-08-10)。
   这里只渲染 RankingFramework 里的现成字段,不在前端做任何计分。
   ============================================================ */

export function RankingPillarCard({ pillar }: { pillar: PillarScore }) {
  const [open, show, hide] = useLightbox();
  const Icon = PILLAR_ICON[pillar.id] ?? Target;
  const score = scoreValue(pillar.score);
  const n = pillar.subs.length;

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="card group flex h-full w-full min-w-0 flex-col p-5 text-left transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-float-lg sm:p-6"
      >
        <div className="relative z-10 flex w-full min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Icon className="h-4 w-4 text-iris" aria-hidden="true" />
              <p className="mt-2 break-words font-display text-[15px] font-semibold leading-snug text-ink sm:text-base">
                <PillarName label={pillar.label} />
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink/45">{pillar.role}</p>
            </div>
            <ScoreRing score={score} label={`${pillar.label} score ${score ?? "not measured"}`} />
          </div>
          <div className="mt-4 border-t border-ink/[0.06] pt-3.5">
            {pillar.subs.map((s) => (
              <RankingSubRow key={s.id} sub={s} />
            ))}
          </div>
          {/* mt-auto:同一行的卡片被栅格拉成等高时,提示条贴底对齐 */}
          <div className="mt-auto">
            {/* U+2011 不换行连字符:窄卡片里 "sub-" / "scores" 被拆到两行很难看 */}
            <MoreAffordance label={n === 1 ? "Evidence and fixes" : `Evidence and fixes for ${n} sub\u2011scores`} />
          </div>
        </div>
      </button>

      <Lightbox open={open} onClose={hide} eyebrow={pillar.label} title={pillar.summary || pillar.role}>
        <PillarDetail pillar={pillar} />
      </Lightbox>
    </>
  );
}

/** 灯箱正文。单独导出:无状态、可直接服务端渲染,方便核对标记 */
export function PillarDetail({ pillar }: { pillar: PillarScore }) {
  const score = scoreValue(pillar.score);
  return (
    <div>
      <div className="mb-5 flex items-center gap-4 rounded-2xl bg-ink/[0.03] p-4">
        <ScoreRing score={score} label={`${pillar.label} score ${score ?? "not measured"}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {score === null ? "Not measured" : `${score}/100`}
            {pillar.grade && score !== null ? ` · Grade ${pillar.grade}` : ""} · {pillar.weight}% of the SEO Ranking Score
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink/45">{pillar.role}</p>
        </div>
      </div>
      {pillar.id === "technical" && (
        <p className="mb-5 text-sm leading-relaxed text-ink/60">
          This is your Technical SEO score — the same number, not a second opinion. Every check behind these seven
          sub-scores is in the Technical foundation section of this report.
        </p>
      )}
      <div>
        {pillar.subs.map((s) => (
          <SubDetail key={s.id} sub={s} />
        ))}
        {pillar.subs.length === 0 && <p className="text-sm text-ink/45">No sub-scores were computed for this pillar.</p>}
      </div>
    </div>
  );
}

function SubDetail({ sub }: { sub: SubScore }) {
  const v = scoreValue(sub.score);
  const how = subMeasures(sub.id);
  return (
    <section className="border-t border-ink/[0.06] py-5 first:border-0 first:pt-0 last:pb-0" aria-label={sub.label}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 break-words font-display text-[15px] font-semibold leading-snug text-ink">{sub.label}</h4>
        {v === null ? (
          <span className="shrink-0 pt-0.5 text-xs font-medium text-ink/40">Not measured</span>
        ) : (
          <span className="shrink-0 font-display text-lg font-semibold leading-none tabular-nums text-ink">{v}</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <ScoreBar score={v} />
        <ConfidenceBadge confidence={sub.confidence} />
      </div>
      {sub.summary && <p className="mt-3 text-sm leading-relaxed text-ink/75">{sub.summary}</p>}
      {sub.evidence.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm leading-relaxed text-ink/60">
          {sub.evidence.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink/30" />
              <span className="min-w-0 break-words">{e}</span>
            </li>
          ))}
        </ul>
      )}
      {sub.fixes.length > 0 && (
        <div className="mt-3 rounded-2xl bg-iris/[0.06] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-iris">How to fix</p>
          {sub.fixes.length === 1 ? (
            <p className="mt-1 text-sm leading-relaxed text-ink/75">{sub.fixes[0]}</p>
          ) : (
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink/75 marker:text-iris/60">
              {sub.fixes.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {how && (
        <p className="mt-3 text-xs leading-relaxed text-ink/40">
          <span className="font-medium text-ink/50">How it&rsquo;s scored ({sub.weight}% of this pillar):</span> {how}
        </p>
      )}
    </section>
  );
}
