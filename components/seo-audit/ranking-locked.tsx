import { Check, Lock, Target } from "lucide-react";
import { RANKING_PILLARS, RANKING_SUBS, type PillarId } from "@/lib/seo-audit/types";
import { UnlockButton } from "@/components/report/unlock";
import { UNLOCK_UNAVAILABLE } from "./check-ui";
import { PILLAR_ICON, PILLAR_ORDER, PillarName, subsOf } from "./ranking-meta";

/* ============================================================
   免费视图里的 SEO Ranking Score 锁定预告。

   只用类型层的常量(RANKING_PILLARS / PILLAR_IDS / RANKING_SUBS)拼出来:支柱名、作用、小维度名 + 锁 ——
   免费视图的 result.ranking 恒为 null(toPublicView 不下发),这里也就没有任何分数可漏。
   唯一例外是技术支柱:它的 7 个小维度就是下面免费展示的 7 个站内维度分数,
   给它们挂锁等于说谎,所以标成 "Free" 并指向下方的 Technical foundation。
   DataForSEO 不可用(dfsReady=false)时不摆按钮,只说明暂不可售 —— 与其他锁定卡同一口径(复审 C28)。
   列表做成"每个支柱一行 + 小维度胶囊换行",390px 下也只占半屏多,不把免费的 Top issues 挤得太远。
   ============================================================ */

export function RankingLocked({ id, dfsReady = true }: { id: string; dfsReady?: boolean }) {
  const pillarCount = PILLAR_ORDER.length;
  const subCount = RANKING_SUBS.length;

  return (
    <section id="ranking" aria-labelledby="ranking-locked-title" className="card min-w-0 scroll-mt-28 p-6 sm:p-9">
      <div className="relative z-10 min-w-0">
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0 max-w-2xl">
            <p className="eyebrow flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Full report
            </p>
            <h2 id="ranking-locked-title" className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              SEO Ranking Score · {pillarCount} pillars · {subCount} sub-scores
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/55">
              Your Technical SEO score says whether Google can crawl and index you. This one scores whether your pages can
              win the ranking — checked against the pages that hold it today, AI Overviews and your brand&rsquo;s
              reputation included, with evidence and a fix for every sub-score.
            </p>
          </div>
          <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-start lg:items-end">
            {dfsReady ? (
              <>
                <UnlockButton auditId={id} product="seo_report" className="btn-primary w-full justify-center px-6 py-3.5 sm:w-auto">
                  Unlock the Ranking Score · $10
                </UnlockButton>
                <p className="text-center text-xs text-ink/45 sm:text-left lg:text-right">One-time. No account needed.</p>
              </>
            ) : (
              <div className="surface flex items-start gap-3 p-4">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" aria-hidden="true" />
                <p className="text-sm font-medium leading-relaxed text-ink/65">{UNLOCK_UNAVAILABLE}</p>
              </div>
            )}
          </div>
        </div>

        {/* 桌面 / 平板:每个支柱一行,右侧列出它的小维度(锁 / 免费) */}
        <div className="mt-7 hidden divide-y divide-ink/[0.06] sm:block">
          {PILLAR_ORDER.map((pid) => {
            const meta = RANKING_PILLARS[pid];
            const Icon = PILLAR_ICON[pid] ?? Target;
            const free = pid === "technical";
            return (
              <div
                key={pid}
                className="grid min-w-0 grid-cols-[minmax(0,15rem)_minmax(0,1fr)] gap-6 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-iris" aria-hidden="true" />
                    <span className="min-w-0 break-words">
                      <PillarName label={meta.label} />
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink/45">{meta.role}</p>
                </div>
                <div className="min-w-0">
                  <SubChips pid={pid} />
                  {free && (
                    <a href="#technical-foundation" className="mt-2 inline-block text-xs font-medium text-iris hover:underline">
                      Free — your Technical SEO score, in detail below
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 手机:每个支柱一行(名称 + 小维度数),全部小维度(v2 共 40 个)收进折叠区 ——
            完整展开在 390px 上要两屏多,会把下面免费的维度分挤得太远 */}
        <div className="mt-6 sm:hidden">
          <ul className="divide-y divide-ink/[0.06]">
            {PILLAR_ORDER.map((pid) => {
              const meta = RANKING_PILLARS[pid];
              const Icon = PILLAR_ICON[pid] ?? Target;
              const free = pid === "technical";
              const n = subsOf(pid).length;
              return (
                <li key={pid} className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-iris" aria-hidden="true" />
                    <span className="min-w-0 break-words">
                      <PillarName label={meta.label} />
                    </span>
                  </span>
                  {free ? (
                    <a href="#technical-foundation" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-mint-deep">
                      <Check className="h-3 w-3" aria-hidden="true" /> Free
                    </a>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink/45">
                      <Lock className="h-3 w-3" aria-hidden="true" /> {n}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-xs font-medium text-iris [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">See all {subCount} sub-scores</span>
              <span className="hidden group-open:inline">Hide sub-scores</span>
            </summary>
            <div className="mt-3 space-y-4">
              {PILLAR_ORDER.map((pid) => (
                <div key={pid} className="min-w-0">
                  <p className="text-xs font-semibold text-ink/70">
                    <PillarName label={RANKING_PILLARS[pid].label} />
                  </p>
                  <div className="mt-1.5">
                    <SubChips pid={pid} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

/** 一个支柱的小维度胶囊:锁定的挂锁,技术支柱(免费展示)打勾 */
function SubChips({ pid }: { pid: PillarId }) {
  const free = pid === "technical";
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5 sm:pt-0.5">
      {subsOf(pid).map((s) => (
        <li key={s.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-ink/[0.04] px-2.5 py-1 text-xs text-ink/60">
          {free ? (
            <Check className="h-3 w-3 shrink-0 text-mint" aria-hidden="true" />
          ) : (
            <Lock className="h-3 w-3 shrink-0 text-ink/35" aria-hidden="true" />
          )}
          <span className="min-w-0 break-words">{s.label}</span>
          <span className="sr-only">{free ? " (free, shown below)" : " (locked)"}</span>
        </li>
      ))}
    </ul>
  );
}
