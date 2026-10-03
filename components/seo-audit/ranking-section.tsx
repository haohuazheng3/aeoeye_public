import Link from "next/link";
import { Info } from "lucide-react";
import type { GscData, RankingFramework, ReputationAnalysis } from "@/lib/seo-audit/types";
import { RankingPillarCard } from "./ranking-pillar-card";
import { RankingBasis, relevanceNotes, sentence } from "./ranking-basis";
import { RerunLink } from "./rerun-link";
import { ProfileChip } from "./profile-chip";
import { ReputationBlock } from "./reputation-block";
import { SearchConsoleCard } from "./search-console-card";
import { CONFIDENCE_ORDER, CONFIDENCE_UI, ConfidenceBadge, orderPillars, pillarGridItemClass, profileLabel } from "./ranking-meta";

/* ============================================================
   SEO Ranking Score 板块(付费完整版,报告头部之后的第一块)。

   总分大环在 ScoreHero 里(付费且排名分可用时,头部大环就是排名分),
   这里不再放第二个大环 —— 两个大号数字上下挨着,买家分不清哪个才是结论(集成方 2026-10-01)。
   结构(v2):标题行(名称 · N 个支柱 · M 个小维度 + "Scored as: 站点类型" 胶囊 + How we score)
   → 七张支柱卡(桌面 3 + 4,12 列栅格)→ 可信度图例
   → 站外声誉 ∥ Search Console 连接卡(两张短卡并排:一个是证据、一个是动作,放在长长的依据块之前,不被埋掉)
   → "What we compared against" 依据块(含目标词编辑器)→ 总分口径说明。
   数字全部取自 RankingFramework 本身(支柱数、小维度数、权重),旧报告(v1 五支柱)照样正确显示。
   ============================================================ */

export function RankingSection({
  ranking,
  auditId,
  domain,
  reputation = null,
  gsc = null,
}: {
  ranking: RankingFramework;
  auditId: string;
  domain: string;
  reputation?: ReputationAnalysis | null;
  gsc?: GscData | null;
}) {
  const pillars = orderPillars(ranking.pillars);
  const subCount = pillars.reduce((n, p) => n + (Array.isArray(p.subs) ? p.subs.length : 0), 0);
  // 封顶说明已在头部大环下方;没封顶时的口径说明(例如某支柱没测到)放在标题行下
  const note = !ranking.overall.capped ? ranking.overall.note : "";
  // 总分口径类说明(封顶原因、哪些小维度没测到…)单列在板块末尾;已在依据块里出现过的对比说明不重复
  const shown = new Set(relevanceNotes(ranking));
  const scoreNotes = [
    ...new Set((ranking.notes ?? []).map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x && !shown.has(x))),
  ];
  // v1 报告没有站点类型:不显示胶囊(它当时用的是另一套权重,链到现行权重表会误导)
  const profile = ranking.profile ?? null;
  const profileName = profileLabel(profile);

  return (
    <section id="ranking" aria-labelledby="ranking-title" className="min-w-0 scroll-mt-28 space-y-5">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="ranking-title" className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            SEO Ranking Score · {pillars.length} pillars · {subCount} sub-scores
          </h2>
          {profile && profileName && <ProfileChip label={profileName} reason={profile.reason || ""} />}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-ink/45">
          How well your pages can compete for Google rankings, scored from your pages, your links and the pages that
          rank today.{" "}
          <Link href="/seo-audit/how-we-score#ranking-score" className="whitespace-nowrap font-medium text-iris hover:underline">
            How we score
          </Link>
        </p>
        {note && <p className="mt-1 text-xs leading-relaxed text-ink/40">{note}</p>}
      </div>

      {/* 七张卡:桌面 12 列 —— 第一排 3 × span-4,第二排 4 × span-3(不留空位);平板两列时最后一张占满一行;手机单列 */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        {pillars.map((p, i) => (
          <div key={p.id} className={pillarGridItemClass(i, pillars.length)}>
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

      {/* 声誉与 Search Console 是 v2 才有的数据;v1 旧报告照样渲染(声誉显示"没分析",GSC 照样可连) */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ReputationBlock reputation={reputation} />
        <SearchConsoleCard auditId={auditId} domain={domain} gsc={gsc} />
      </div>

      <RankingBasis ranking={ranking} auditId={auditId} />

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
