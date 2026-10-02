import Link from "next/link";
import { Info } from "lucide-react";
import type { RankingFramework } from "@/lib/seo-audit/types";
import { RankingPillarCard } from "./ranking-pillar-card";
import { RankingBasis, relevanceNotes, sentence } from "./ranking-basis";
import { RerunLink } from "./rerun-link";
import { CONFIDENCE_ORDER, CONFIDENCE_UI, ConfidenceBadge, orderPillars } from "./ranking-meta";

/* ============================================================
   SEO Ranking Score 板块(付费完整版,报告头部之后的第一块)。

   总分大环在 ScoreHero 里(付费且排名分可用时,头部大环就是排名分),
   这里不再放第二个大环 —— 两个大号数字上下挨着,买家分不清哪个才是结论(集成方 2026-10-01)。
   结构:标题行(名称 · 5 个支柱 · 25 个小维度 + 一句话说明 + How we score)
   → 五张支柱卡 → 可信度图例 → "What we compared against" 依据块。
   ============================================================ */

export function RankingSection({ ranking }: { ranking: RankingFramework }) {
  const pillars = orderPillars(ranking.pillars);
  const subCount = pillars.reduce((n, p) => n + p.subs.length, 0);
  // 封顶说明已在头部大环下方;没封顶时的口径说明(例如某支柱没测到)放在标题行下
  const note = !ranking.overall.capped ? ranking.overall.note : "";
  // 总分口径类说明(封顶原因、哪些小维度没测到…)单列在板块末尾;已在依据块里出现过的对比说明不重复
  const shown = new Set(relevanceNotes(ranking));
  const scoreNotes = [
    ...new Set((ranking.notes ?? []).map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x && !shown.has(x))),
  ];

  return (
    <section id="ranking" aria-labelledby="ranking-title" className="min-w-0 scroll-mt-28 space-y-5">
      <div className="min-w-0">
        <h2 id="ranking-title" className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          SEO Ranking Score · {pillars.length} pillars · {subCount} sub-scores
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink/45">
          How well your pages can compete for Google rankings, scored from your pages, your links and the pages that
          rank today.{" "}
          <Link href="/seo-audit/how-we-score#ranking-score" className="whitespace-nowrap font-medium text-iris hover:underline">
            How we score
          </Link>
        </p>
        {note && <p className="mt-1 text-xs leading-relaxed text-ink/40">{note}</p>}
      </div>

      {/* 五张卡:桌面 3 + 2(第二排两张各占一半宽,不留空位);平板两列时最后一张(技术基础)占满一行 */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {pillars.map((p, i) => (
          <div
            key={p.id}
            className={`min-w-0 ${i < 3 ? "lg:col-span-2" : "lg:col-span-3"} ${i === pillars.length - 1 && pillars.length % 2 === 1 ? "sm:col-span-2 lg:col-span-3" : ""}`}
          >
            <RankingPillarCard pillar={p} />
          </div>
        ))}
      </div>

      <p className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[11px] leading-relaxed text-ink/45">
        {CONFIDENCE_ORDER.map((c) => (
          <span key={c} className="inline-flex min-w-0 items-center gap-1.5">
            <ConfidenceBadge confidence={c} />
            <span className="min-w-0">{CONFIDENCE_UI[c].hint}</span>
          </span>
        ))}
      </p>

      <RankingBasis ranking={ranking} />

      {scoreNotes.length > 0 && (
        <div className="surface p-4 sm:p-5">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">
            <Info className="h-3.5 w-3.5" aria-hidden="true" /> Notes on this score
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink/55">
            {scoreNotes.map((x) => (
              <li key={x} className="break-words">
                {sentence(x)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * 已解锁但没有排名分(这个板块上线前的旧报告,或本次模块失败):一条小提示 + 重跑。
 * 付费报告的重跑只补缺失的模块,所以重跑就是"把它算出来"的路,不需要另开入口。
 */
export function RankingUnavailable({ id, url }: { id: string; url: string }) {
  return (
    <div className="surface flex items-start gap-3 p-4 sm:p-5" role="status">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-iris" aria-hidden="true" />
      <div className="min-w-0 text-sm leading-relaxed text-ink/65">
        <p>Ranking score unavailable for this report — re-run to compute it.</p>
        <p className="mt-1.5 text-xs">
          <RerunLink id={id} url={url} unlocked />
        </p>
      </div>
    </div>
  );
}
