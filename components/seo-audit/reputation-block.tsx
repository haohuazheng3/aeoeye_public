import { Info, MessagesSquare, Star } from "lucide-react";
import type { ReputationAnalysis } from "@/lib/seo-audit/types";

/* ============================================================
   站外声誉块(规格 v2 §3.5;authority.reputation 小维度的依据)。
   数据来自两次 Google 搜索(品牌词、品牌词 + reviews):品牌词第一名是不是本站、有没有知识面板、
   评价平台(带评分)、独立站点提及、论坛讨论、负面标题。只渲染 result.reputation 的现成字段;
   null = 这次没跑(旧报告或模块失败)—— 明说"没分析",绝不画成 0。
   无状态、无 hooks:服务端渲染,手机上 2 列事实格 + 评价平台列表,不横向溢出。
   ============================================================ */

function int(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function headline(r: ReputationAnalysis): string {
  const brand = r.brandName || r.brandQuery;
  if (r.ownsBrandSerp === true) return `Your site ranks first for “${brand}”`;
  if (r.ownsBrandSerp === false && r.brandTop3) return `Your site is in the top 3 for “${brand}”, not first`;
  if (r.ownsBrandSerp === false) return `Other sites outrank you for “${brand}”`;
  return `What Google shows for “${brand}”`;
}

export function ReputationBlock({ reputation }: { reputation: ReputationAnalysis | null | undefined }) {
  const r = reputation ?? null;
  return (
    <section id="reputation" aria-labelledby="reputation-title" className="card min-w-0 scroll-mt-28 p-6 sm:p-7">
      <div className="relative z-10 min-w-0">
        <p className="eyebrow flex items-center gap-2">
          <Star className="h-3.5 w-3.5" aria-hidden="true" /> Brand reputation
        </p>
        {!r ? (
          <>
            <h3 id="reputation-title" className="mt-1.5 font-display text-lg font-semibold tracking-tight sm:text-xl">
              Not analysed on this run
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/55">
              We look up your brand on Google — who ranks for your name, which review sites show up and what they say.
              This report doesn&rsquo;t include that check, so the Off-site reputation sub-score is not measured.
            </p>
          </>
        ) : (
          <Analysed r={r} />
        )}
      </div>
    </section>
  );
}

function Analysed({ r }: { r: ReputationAnalysis }) {
  const platforms = Array.isArray(r.reviewPlatforms) ? r.reviewPlatforms : [];
  const notes = [...new Set((Array.isArray(r.notes) ? r.notes : []).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
  const brandSearch =
    r.ownsBrandSerp === true ? "#1" : r.ownsBrandSerp === false ? (r.brandTop3 ? "Top 3" : "Below top 3") : "Couldn't tell";
  const negative = Math.max(0, r.negativeSignals ?? 0);

  return (
    <>
      <h3 id="reputation-title" className="mt-1.5 break-words font-display text-lg font-semibold tracking-tight sm:text-xl">
        {headline(r)}
      </h3>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Your brand search" value={brandSearch} tone={r.ownsBrandSerp === true ? "good" : r.ownsBrandSerp === false && !r.brandTop3 ? "bad" : "plain"} />
        <Fact label="Knowledge panel" value={r.knowledgePanel ? "Shown" : "None"} tone={r.knowledgePanel ? "good" : "plain"} />
        <Fact label="Review sites" value={int(platforms.length)} hint="in the top results" />
        <Fact label="Independent sites" value={int(r.independentDomains ?? 0)} hint="mention you on page one" />
        <Fact label="Forum threads" value={int(r.forumMentions ?? 0)} hint="Reddit, Quora, HN…" />
        <Fact label="Negative results" value={int(negative)} hint="scam, complaints, lawsuit…" tone={negative > 0 ? "bad" : "plain"} />
      </dl>

      {platforms.length > 0 && (
        <div className="mt-4 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/40">Review platforms</p>
          <ul className="mt-1.5 divide-y divide-ink/[0.05]">
            {platforms.map((p, i) => (
              <li key={`${i}-${p.domain}`} className="flex min-w-0 items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{p.domain}</p>
                  {p.title && <p className="truncate text-xs text-ink/45" title={p.title}>{p.title}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {p.rating && Number.isFinite(p.rating.value) ? (
                    <>
                      <p className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-ink">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                        {p.rating.value.toFixed(1)}
                      </p>
                      {typeof p.rating.votes === "number" && p.rating.votes > 0 && (
                        <p className="text-[11px] tabular-nums text-ink/40">
                          {int(p.rating.votes)} review{p.rating.votes === 1 ? "" : "s"}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-[11px] text-ink/40">No rating shown</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(r.forumMentions ?? 0) > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink/50">
          <MessagesSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/35" aria-hidden="true" />
          Forum threads are listed as evidence only — they don&rsquo;t change the score.
        </p>
      )}

      {notes.length > 0 && (
        <div className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink/45">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <ul className="min-w-0 space-y-1">
            {notes.map((n) => (
              <li key={n} className="break-words">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.brandQuery && (
        <p className="mt-4 text-[11px] leading-relaxed text-ink/40">
          Based on Google results (US, English) for &ldquo;{r.brandQuery}&rdquo;
          {r.reviewsQuery ? <> and &ldquo;{r.reviewsQuery}&rdquo;</> : null}.
        </p>
      )}
    </>
  );
}

function Fact({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad" | "plain";
}) {
  const color = tone === "good" ? "text-mint-deep" : tone === "bad" ? "text-coral-deep" : "text-ink";
  return (
    <div className="surface min-w-0 p-3">
      <dt className="text-[11px] font-semibold text-ink/50">{label}</dt>
      <dd className={`mt-0.5 font-display text-lg font-semibold tabular-nums ${color}`}>{value}</dd>
      {hint && <dd className="text-[11px] leading-snug text-ink/40">{hint}</dd>}
    </div>
  );
}
