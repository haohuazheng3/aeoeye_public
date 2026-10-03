"use client";

import { ArrowDown, Target } from "lucide-react";
import type { PillarScore, SubScore } from "@/lib/seo-audit/types";
import { Lightbox, MoreAffordance, useLightbox } from "@/components/report/lightbox";
import { ScoreRing } from "./score-ring";
import { RankingSubRow } from "./ranking-sub-row";
import { ConfidenceBadge, PILLAR_ICON, PillarName, ScoreBar, scoreValue, subMeasures, weightLabel, pillarLabel, pillarRole, subLabel } from "./ranking-meta";

/* ============================================================
   一个支柱 = 一张可点开的卡(与 DimensionCard 同一套交互)。
   折叠态:图标 + 权重 + 支柱名 + 分数环,作用一句占满整宽,再列每个小维度一行(名称 / 分数条 / 可信度);
   灯箱:每个小维度的结论句、证据、修法 —— 长内容只进灯箱,折叠态保持短(站长 2026-08-10)。
   v2:桌面第二排是 4 张 span-3 的窄卡(约 250px),作用句若和分数环挤在同一列会被压成四五行,
   所以放到头部下方占满卡宽。这里只渲染 RankingFramework 里的现成字段,不在前端做任何计分。
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
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-iris" aria-hidden="true" />
                {/* 权重随站点类型变(Scored as …),卡上直接写本次用的数,不让人去灯箱里找 */}
                {weightLabel(pillar.weight) && (
                  <span className="text-[11px] font-semibold tabular-nums text-ink/40">{weightLabel(pillar.weight)} of score</span>
                )}
              </p>
              <p className="mt-2 break-words font-display text-[15px] font-semibold leading-snug text-ink sm:text-base">
                <PillarName label={pillarLabel(pillar)} />
              </p>
            </div>
            <ScoreRing score={score} label={`${pillarLabel(pillar)} score ${score ?? "not measured"}`} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/45">{pillarRole(pillar)}</p>
          <div className="mt-4 border-t border-ink/[0.06] pt-3.5">
            {pillar.subs.map((s) => (
              <RankingSubRow key={s.id} sub={s} />
            ))}
          </div>
          {/* mt-auto:同一行的卡片被栅格拉成等高时,提示条贴底对齐 */}
          <div className="mt-auto">
            {/* U+2011 不换行连字符:窄卡片里 "sub-" / "scores" 被拆到两行很难看 */}
            <MoreAffordance label={n === 1 ? "Evidence and fixes" : `Evidence and fixes for ${n} sub‑scores`} />
          </div>
        </div>
      </button>

      <Lightbox open={open} onClose={hide} eyebrow={pillarLabel(pillar)} title={pillar.summary || pillarRole(pillar)}>
        <PillarDetail pillar={pillar} onNavigate={hide} />
      </Lightbox>
    </>
  );
}

/**
 * 灯箱正文。单独导出:无状态、可直接服务端渲染,方便核对标记。
 * onNavigate:灯箱里的站内锚点(例如"去连接 Search Console")点击时先关掉灯箱,否则遮罩还盖在目标上。
 */
export function PillarDetail({ pillar, onNavigate }: { pillar: PillarScore; onNavigate?: () => void }) {
  const score = scoreValue(pillar.score);
  return (
    <div>
      <div className="mb-5 flex items-center gap-4 rounded-2xl bg-ink/[0.03] p-4">
        <ScoreRing score={score} label={`${pillarLabel(pillar)} score ${score ?? "not measured"}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {score === null ? "Not measured" : `${score}/100`}
            {pillar.grade && score !== null ? ` · Grade ${pillar.grade}` : ""}
            {weightLabel(pillar.weight) ? ` · ${weightLabel(pillar.weight)} of the SEO Ranking Score` : ""}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink/45">{pillarRole(pillar)}</p>
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
          <SubDetail key={s.id} sub={s} onNavigate={onNavigate} />
        ))}
        {pillar.subs.length === 0 && <p className="text-sm text-ink/45">No sub-scores were computed for this pillar.</p>}
      </div>
    </div>
  );
}

/** 只有接了 Search Console 才能测的小维度:没测到时给一个直达连接卡的入口(卡在排名板块里,id=search-console) */
const NEEDS_GSC = new Set(["behavior.ctr"]);

function SubDetail({ sub, onNavigate }: { sub: SubScore; onNavigate?: () => void }) {
  const v = scoreValue(sub.score);
  const how = subMeasures(sub.id);
  const evidence = Array.isArray(sub.evidence) ? sub.evidence : [];
  const fixes = Array.isArray(sub.fixes) ? sub.fixes : [];
  return (
    <section className="border-t border-ink/[0.06] py-5 first:border-0 first:pt-0 last:pb-0" aria-label={subLabel(sub)}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 break-words font-display text-[15px] font-semibold leading-snug text-ink">{subLabel(sub)}</h4>
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
      {v === null && NEEDS_GSC.has(sub.id) && (
        <a
          href="#search-console"
          onClick={(e) => {
            if (!onNavigate) return;
            // 先关灯箱(它锁着 body 滚动),等它卸载后再滚到连接卡;直接跳锚点会被遮罩挡住
            e.preventDefault();
            onNavigate();
            setTimeout(() => document.getElementById("search-console")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
          }}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-iris hover:underline"
        >
          Connect Search Console to measure it <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
      {evidence.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm leading-relaxed text-ink/60">
          {evidence.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink/30" />
              <span className="min-w-0 break-words">{e}</span>
            </li>
          ))}
        </ul>
      )}
      {fixes.length > 0 && (
        <div className="mt-3 rounded-2xl bg-iris/[0.06] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-iris">How to fix</p>
          {fixes.length === 1 ? (
            <p className="mt-1 text-sm leading-relaxed text-ink/75">{fixes[0]}</p>
          ) : (
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink/75 marker:text-iris/60">
              {fixes.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {how && (
        <p className="mt-3 text-xs leading-relaxed text-ink/40">
          <span className="font-medium text-ink/50">
            How it&rsquo;s scored{weightLabel(sub.weight) ? ` (${weightLabel(sub.weight)} of this pillar)` : ""}:
          </span>{" "}
          {how}
        </p>
      )}
    </section>
  );
}
