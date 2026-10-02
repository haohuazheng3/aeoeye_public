import { Check, Info, X } from "lucide-react";
import type { CompetitorPageSignals, RankingFramework, RelevancePair, SearchIntent } from "@/lib/seo-audit/types";
import { shortUrl } from "./check-ui";
import { formatLabel, intentLabel } from "./ranking-meta";

/* ============================================================
   "What we compared against" —— 排名分的依据:分析了哪些查询、每个查询对应本站哪一页、
   排名第几、搜索量多少;做了 SERP 对比的查询再列出前几名的页面(形态 / 字数)、
   本页覆盖了它们共有子话题的百分之几、缺了哪些、独有哪些。
   相关性支柱的分数全是从这里来的 —— 给数字不给依据,用户无从核对。
   ============================================================ */

interface QueryRow {
  query: string;
  url: string;
  position: number | null;
  volume: number | null;
  intent: SearchIntent;
  pair: RelevancePair | null;
}

/**
 * basis.queries 是计分用的查询清单;relevance.pairs 带对比明细。以前者为准逐条配对
 * (先按 查询 + URL,再退回只按查询),配过的 pair 不重复使用。basis 为空而 pairs 不空时直接用 pairs。
 */
function queryRows(r: RankingFramework): QueryRow[] {
  const pairs = r.relevance?.pairs ?? [];
  const base =
    r.basis?.queries?.length > 0
      ? r.basis.queries
      : pairs.map((p) => ({ query: p.query, url: p.url, position: p.position, volume: p.volume, intent: p.intent }));
  const used = new Set<RelevancePair>();
  return base.map((q) => {
    const pair =
      pairs.find((p) => !used.has(p) && p.query === q.query && p.url === q.url) ??
      pairs.find((p) => !used.has(p) && p.query === q.query) ??
      null;
    if (pair) used.add(pair);
    return { ...q, pair };
  });
}

function int(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** 句末补句号:relevance 的 note 带句号、ranking 的 note 不带,同屏两种写法会显得粗糙 */
export function sentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** 对比过程的说明(去重、去空) */
export function relevanceNotes(r: RankingFramework): string[] {
  return [...new Set((r.relevance?.notes ?? []).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
}

function plural(n: number, one: string, many: string): string {
  return `${int(n)} ${n === 1 ? one : many}`;
}

export function RankingBasis({ ranking }: { ranking: RankingFramework }) {
  const rows = queryRows(ranking);
  const compared = ranking.basis?.competitorsCompared ?? 0;
  const pages = ranking.basis?.pagesAnalyzed ?? 0;
  const content = ranking.basis?.contentPages ?? 0;
  // 只放对比过程的说明(哪个竞品没抓到、为什么用页面主题代替排名词…);总分口径类的 ranking.notes 在板块末尾单列
  const notes = relevanceNotes(ranking);

  const headline =
    rows.length === 0
      ? "No search queries were analysed on this run"
      : compared > 0
        ? `${plural(rows.length, "search query", "search queries")} · ${plural(compared, "top-ranking page", "top-ranking pages")} read side by side`
        : `${plural(rows.length, "search query", "search queries")}, scored against your own pages`;

  return (
    <section aria-labelledby="ranking-basis-title" className="card min-w-0 p-6 sm:p-8">
      <div className="relative z-10 min-w-0">
        <p className="eyebrow">What we compared against</p>
        <h3 id="ranking-basis-title" className="mt-1.5 font-display text-lg font-semibold tracking-tight sm:text-xl">
          {headline}
        </h3>
        {pages > 0 && (
          <p className="mt-1 text-sm text-ink/45">
            Scored from {plural(pages, "crawled page", "crawled pages")}
            {content > 0 ? `, ${int(content)} of them content pages` : ""}.
          </p>
        )}

        {rows.length > 0 && (
          <div className="mt-5 space-y-4">
            {rows.map((r, i) => (
              <QueryBlock key={`${i}-${r.query}`} row={r} />
            ))}
          </div>
        )}

        {notes.length > 0 && (
          <div className="mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-ink/45">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <ul className="min-w-0 space-y-1">
              {notes.map((x) => (
                <li key={x} className="break-words">
                  {sentence(x)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function QueryBlock({ row }: { row: QueryRow }) {
  const pair = row.pair;
  const topicQuery = pair?.source === "page-topic";
  return (
    <div className="surface min-w-0 p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <p className="break-words font-display text-[15px] font-semibold leading-snug text-ink">&ldquo;{row.query}&rdquo;</p>
          {row.url && (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={row.url}
              className="mt-1 block truncate font-mono text-[12px] text-ink/50 hover:text-ink"
            >
              {shortUrl(row.url, 64)}
            </a>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink/55">
          <span className="inline-flex items-center rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-[11px] font-semibold text-ink/60">
            {intentLabel(row.intent)}
          </span>
          {typeof row.position === "number" ? (
            <span className="font-semibold tabular-nums text-ink/70" title="Your Google position (US) for this query">
              #{int(row.position)}
            </span>
          ) : (
            <span className="text-ink/45">{topicQuery ? "From the page's topic" : "Not ranking"}</span>
          )}
          {typeof row.volume === "number" && <span className="tabular-nums">{int(row.volume)}/mo</span>}
        </div>
      </div>
      {pair && pair.competitors.length > 0 && <Comparison pair={pair} />}
    </div>
  );
}

function Comparison({ pair }: { pair: RelevancePair }) {
  const competitors = [...pair.competitors].sort((a, b) => a.position - b.position);
  const coverage = typeof pair.coverage === "number" ? `${Math.round(pair.coverage * 100)}%` : "—";
  return (
    <div className="mt-4 min-w-0 border-t border-ink/[0.06] pt-4">
      <dl className="flex flex-wrap gap-x-6 gap-y-2.5 text-xs">
        <Fact
          label="Coverage"
          value={coverage}
          hint={pair.coverage === null ? "too few subtopics shared by the top results to compare" : "of the subtopics the top results share"}
        />
        <Fact label="Your page" value={formatLabel(pair.pageFormat)} />
        {pair.serpFormat && <Fact label="Top results" value={formatLabel(pair.serpFormat)} />}
        {pair.intentMatch !== null && (
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/40">Intent</dt>
            <dd
              className={`mt-0.5 inline-flex items-center gap-1 text-sm font-medium ${pair.intentMatch ? "text-mint-deep" : "text-coral-deep"}`}
            >
              {pair.intentMatch ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
              {pair.intentMatch ? "Format fits" : "Format mismatch"}
            </dd>
          </div>
        )}
      </dl>

      <ol className="mt-3 divide-y divide-ink/[0.05]" aria-label={`Top results for ${pair.query}`}>
        {competitors.map((c) => (
          <CompetitorRow key={`${c.position}-${c.url}`} c={c} />
        ))}
      </ol>

      {pair.missingTopics.length > 0 && <Topics label="Missing from your page" topics={pair.missingTopics} tone="missing" />}
      {pair.uniqueTopics.length > 0 && <Topics label="Only on your page" topics={pair.uniqueTopics} tone="unique" />}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/40">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">
        <span className="tabular-nums">{value}</span>
        {hint && <span className="ml-1.5 text-xs font-normal text-ink/45">{hint}</span>}
      </dd>
    </div>
  );
}

function CompetitorRow({ c }: { c: CompetitorPageSignals }) {
  return (
    <li className="flex min-w-0 items-start gap-3 py-2.5">
      <span className="w-7 shrink-0 pt-px text-xs font-semibold tabular-nums text-ink/40">#{int(c.position)}</span>
      <div className="min-w-0 flex-1">
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="block break-words text-sm font-medium leading-snug text-ink hover:text-iris"
        >
          {c.title || c.domain}
        </a>
        <p className="mt-0.5 truncate font-mono text-[11px] text-ink/45" title={c.url}>
          {shortUrl(c.url, 56)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {c.fetched ? (
          <>
            <span className="inline-flex items-center rounded-full bg-ink/[0.05] px-2 py-0.5 text-[11px] font-semibold text-ink/60">
              {formatLabel(c.format)}
            </span>
            {c.wordCount > 0 && <span className="text-[11px] tabular-nums text-ink/40">{int(c.wordCount)} words</span>}
          </>
        ) : (
          <span className="text-[11px] text-ink/40" title={c.error || undefined}>
            Not fetched
          </span>
        )}
      </div>
    </li>
  );
}

function Topics({ label, topics, tone }: { label: string; topics: string[]; tone: "missing" | "unique" }) {
  // 缺失 = coral 浅底(缺席语义),独有 = mint 浅底(正向语义);只用极淡的底色,不抢模块
  const chip = tone === "missing" ? "bg-coral/[0.07] text-coral-deep" : "bg-mint/10 text-mint-deep";
  return (
    <div className="mt-3.5 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/40">{label}</p>
      <ul className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
        {topics.map((t, i) => (
          <li key={`${i}-${t}`} className={`max-w-full break-words rounded-full px-2.5 py-1 text-xs ${chip}`}>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
