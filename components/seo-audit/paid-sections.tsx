import { Info, ArrowUpRight, Lock } from "lucide-react";
import type {
  AuthorityResult,
  CompetitorsResult,
  CrawledPage,
  DimensionId,
  RoadmapItem,
  SeoAuditResult,
  SeoCheck,
  VisibilityResult,
} from "@/lib/seo-audit/types";
import { DIMENSIONS, PAID_DIMENSIONS } from "@/lib/seo-audit/types";
import { LockedSection } from "@/components/report/unlock";
import { ScoreRing } from "./score-ring";
import { PageTable } from "./page-table";
import { DIMENSION_ICON } from "./dimension-meta";
import { CheckDetail, SeverityChip, StatusIcon, UNLOCK_UNAVAILABLE, shortUrl, sortChecks } from "./check-ui";
import { roadmapCounts } from "./locked-meta";

/* ============================================================
   付费模块区:Authority / Rankings / Competitors / Roadmap / Pages table。

   三种状态,每个模块各自判断:
   - 未解锁 → LockedSection(product="seo_report"),说明文案用**这份报告的真实计数**,
     children 只放骨架 —— 服务端 toPublicView 已把付费字段清空,这里没有任何真数据可泄露;
   - 已解锁但 DataForSEO 没有这个域名的数据(noData)→ 指导卡,绝不显示 0 分;
   - 已解锁且有数据 → 真实表格。
   ============================================================ */

const UNLOCK_CTA = "Unlock full report · $10";

/**
 * 锁定模块。供应商就绪 → 共用的 LockedSection(带 $10 按钮);不就绪 → 同一块模糊骨架 + 锁 + 标题说明,
 * 但按钮换成不可用说明(复审 C28:页面上 5 张锁定卡各有一颗直达 Stripe 的按钮,只撤解锁卡那一颗等于没撤)。
 * LockedSection 与 $29 报告共用、内部无条件渲染按钮,所以不可用态在这里就地画,不去改共享组件。
 */
function SeoLockedSection({
  auditId,
  available,
  title,
  blurb,
  children,
}: {
  auditId: string;
  available: boolean;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  if (available) {
    return (
      <LockedSection auditId={auditId} product="seo_report" cta={UNLOCK_CTA} title={title} blurb={blurb}>
        {children}
      </LockedSection>
    );
  }
  return (
    <div className="relative min-h-[15rem] overflow-hidden rounded-[1.75rem] border border-white/60 sm:min-h-[13rem]">
      <div className="pointer-events-none select-none blur-[6px]" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-white/55 px-5 py-6 text-center backdrop-blur-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ink/[0.05] text-ink/40">
          <Lock className="h-4 w-4" />
        </div>
        <h3 className="font-display text-base font-semibold leading-snug sm:text-lg">{title}</h3>
        <p className="max-w-xs text-sm leading-snug text-ink/55 sm:max-w-sm">{blurb}</p>
        <p className="mt-1 text-sm font-medium text-ink/60">{UNLOCK_UNAVAILABLE}</p>
      </div>
    </div>
  );
}

function Skeleton({ rows = 4, cols = 2 }: { rows?: number; cols?: number }) {
  return (
    <div className={`grid gap-3 p-6 ${cols === 2 ? "sm:grid-cols-2" : ""}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-white/50 p-4">
          <div className="h-2.5 w-2/5 rounded-full bg-ink/[0.08]" />
          <div className="mt-3 space-y-1.5">
            <div className="h-2 w-full rounded-full bg-ink/[0.06]" />
            <div className="h-2 w-4/5 rounded-full bg-ink/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModuleHead({ dimId, sub, score }: { dimId: DimensionId; sub: string; score?: number | null }) {
  const meta = DIMENSIONS[dimId];
  const Icon = DIMENSION_ICON[dimId];
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 shrink-0 text-iris" />
          <span className="eyebrow">{meta.label}</span>
        </p>
        <h3 className="mt-1.5 font-display text-lg font-semibold tracking-tight sm:text-xl">{sub}</h3>
      </div>
      {typeof score === "number" && <ScoreRing score={score} label={`${meta.label} score ${score}`} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface p-3.5 sm:p-4">
      <p className="text-[11px] font-semibold text-ink/50">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink/40">{hint}</p>}
    </div>
  );
}

function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

/** 站外三维度的检查项(已解锁时展示在各模块底部) */
function ModuleChecks({ checks }: { checks: SeoCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="mt-5 border-t border-ink/[0.06] pt-2">
      {sortChecks(checks).map((c) => (
        <div key={c.id} className="border-t border-ink/[0.06] py-3.5 first:border-0">
          <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <p className="flex min-w-0 items-start gap-2 text-sm font-medium text-ink">
              <StatusIcon status={c.status} className="mt-0.5 h-4 w-4" />
              <span className="min-w-0 break-words">{c.title}</span>
            </p>
            {c.status !== "pass" && c.status !== "na" && <SeverityChip severity={c.severity} />}
          </div>
          {(c.evidence.length > 0 || c.fix) && <CheckDetail check={c} compact />}
        </div>
      ))}
    </div>
  );
}

/** DataForSEO 没数据:不给 0 分,给一条能立刻行动的路 */
function NoDataCard({ what }: { what: string }) {
  return (
    <div className="surface flex items-start gap-3 p-4 sm:p-5">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-iris" />
      <div className="text-sm leading-relaxed text-ink/65">
        <p className="font-medium text-ink">Not enough ranking data yet — here&rsquo;s what to do first</p>
        <p className="mt-1">
          Our data provider has no {what} for this domain, which usually means the site is new, very small, or barely
          indexed. That is a finding in itself, not a zero score.
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Fix every critical and high issue above so Google can index all your pages.</li>
          <li>Submit your sitemap in Google Search Console and check the Pages report for exclusions.</li>
          <li>Publish pages that answer the questions your buyers actually search, then re-run this report in 30 days.</li>
        </ol>
      </div>
    </div>
  );
}

function Unavailable({ label, notes }: { label: string; notes: string[] }) {
  const note = notes.find((x) => x.toLowerCase().includes(label.toLowerCase()));
  return (
    <div className="surface flex items-start gap-3 p-4 sm:p-5">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
      <p className="text-sm leading-relaxed text-ink/60">
        {note ?? `The ${label} module didn't return data on this run. Re-run the report to retry it — retries only fill in what's missing.`}
      </p>
    </div>
  );
}

/* ---------------- Authority ---------------- */

function AuthorityModule({ a, score, checks, notes }: { a: AuthorityResult | null; score: number | null; checks: SeoCheck[]; notes: string[] }) {
  if (!a) return <Unavailable label="Authority" notes={notes} />;
  if (a.noData) return <NoDataCard what="backlink data" />;
  const anchors = a.anchors.slice(0, 10);
  const trend = a.timeseries ?? [];
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Domain rank" value={n(a.rank)} hint="DataForSEO, 0–1000" />
        <Stat label="Referring domains" value={n(a.referringDomains)} hint={`${n(a.referringMainDomains)} main domains`} />
        <Stat label="Backlinks" value={n(a.backlinks)} hint={`${n(a.referringIps)} IPs`} />
        <Stat label="Spam score" value={n(a.spamScore)} hint="lower is better" />
        <Stat label="Nofollow share" value={pct(a.nofollowShare)} />
        <Stat label="Broken backlinks" value={n(a.brokenBacklinks)} hint={`${n(a.brokenPages)} broken pages`} />
      </div>
      {trend.length > 0 && (
        <div className="mt-5 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">Referring domains · last 90 days</p>
          <div className="mt-2.5">
            <PageTable
              minWidth={420}
              columns={[
                { key: "month", label: "Month" },
                { key: "new", label: "New", className: "tabular-nums" },
                { key: "lost", label: "Lost", className: "tabular-nums" },
              ]}
              rows={trend.map((t) => ({ month: t.month, new: n(t.newReferringDomains), lost: n(t.lostReferringDomains) }))}
            />
          </div>
        </div>
      )}
      {anchors.length > 0 && (
        <div className="mt-5 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">Top anchor texts</p>
          <div className="mt-2.5">
            <PageTable
              minWidth={480}
              columns={[
                { key: "anchor", label: "Anchor" },
                { key: "backlinks", label: "Backlinks", className: "tabular-nums" },
                { key: "domains", label: "Ref. domains", className: "tabular-nums" },
              ]}
              rows={anchors.map((x) => ({ anchor: x.anchor || "(empty)", backlinks: n(x.backlinks), domains: n(x.referringDomains) }))}
            />
          </div>
        </div>
      )}
      <ModuleChecks checks={checks} />
      {typeof score === "number" ? null : <p className="mt-3 text-xs text-ink/40">Module score unavailable.</p>}
    </>
  );
}

/* ---------------- Visibility ---------------- */

function KeywordTable({ rows, caption }: { rows: VisibilityResult["topKeywords"]; caption: string }) {
  return (
    <PageTable
      caption={caption}
      minWidth={640}
      columns={[
        { key: "keyword", label: "Keyword" },
        { key: "position", label: "Pos.", className: "tabular-nums" },
        { key: "volume", label: "Volume", className: "tabular-nums" },
        { key: "etv", label: "Est. traffic", className: "tabular-nums" },
        { key: "intent", label: "Intent" },
        { key: "url", label: "Ranking URL" },
      ]}
      rows={rows.map((k) => ({
        keyword: k.keyword,
        position: n(k.position),
        volume: n(k.volume),
        etv: n(k.etv),
        intent: k.intent ?? "—",
        url: k.url ? (
          <a href={k.url} target="_blank" rel="noopener noreferrer nofollow" className="font-mono text-[12px] text-ink/60 hover:text-ink">
            {shortUrl(k.url, 48)}
          </a>
        ) : (
          "—"
        ),
      }))}
    />
  );
}

function VisibilityModule({ v, checks, notes }: { v: VisibilityResult | null; checks: SeoCheck[]; notes: string[] }) {
  if (!v) return <Unavailable label="Search visibility" notes={notes} />;
  if (v.noData || v.organicKeywords === 0) return <NoDataCard what="ranked keywords" />;
  const p = v.positions;
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Organic keywords" value={n(v.organicKeywords)} hint="Google US, top 100" />
        <Stat label="Est. monthly traffic" value={n(v.etv)} hint="DataForSEO ETV" />
        <Stat label="Top 3" value={n(p.pos1 + p.pos2_3)} hint={`${n(p.pos1)} at #1`} />
        <Stat label="Top 10" value={n(p.pos1 + p.pos2_3 + p.pos4_10)} />
        <Stat label="Positions 11–20" value={n(p.pos11_20)} hint="closest to page 1" />
        <Stat label="Brand / non-brand" value={`${n(v.brandKeywords)} / ${n(v.nonBrandKeywords)}`} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/50">
        <span>New {n(v.movement.isNew)} · Up {n(v.movement.isUp)} · Down {n(v.movement.isDown)} · Lost {n(v.movement.isLost)}</span>
        {typeof v.aiOverviewShare === "number" && <span>AI Overview on {pct(v.aiOverviewShare)} of ranking SERPs</span>}
        {v.indexEstimate && v.indexEstimate.ratio !== null && (
          <span>
            Google shows ~{n(v.indexEstimate.googleResults)} indexed vs {n(v.indexEstimate.sitemapUrls)} sitemap URLs (
            {pct(v.indexEstimate.ratio)}, estimate)
          </span>
        )}
      </div>
      {v.quickWins.length > 0 && (
        <div className="mt-5 min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">
            <ArrowUpRight className="h-3.5 w-3.5 text-mint" /> Quick wins · positions 4–20 with real volume
          </p>
          <div className="mt-2.5">
            <KeywordTable rows={v.quickWins} caption="Quick-win keywords" />
          </div>
        </div>
      )}
      {v.topKeywords.length > 0 && (
        <div className="mt-5 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">Top keywords by estimated traffic</p>
          <div className="mt-2.5">
            <KeywordTable rows={v.topKeywords} caption="Top ranked keywords" />
          </div>
        </div>
      )}
      <ModuleChecks checks={checks} />
    </>
  );
}

/* ---------------- Competitors ---------------- */

function CompetitorsModule({ c, checks, notes }: { c: CompetitorsResult | null; checks: SeoCheck[]; notes: string[] }) {
  if (!c) return <Unavailable label="Competitors" notes={notes} />;
  if (c.noData || c.items.length === 0) return <NoDataCard what="competitor overlap" />;
  return (
    <>
      <div className="mt-5 min-w-0">
        <PageTable
          caption="Competing domains"
          minWidth={560}
          columns={[
            { key: "domain", label: "Domain" },
            { key: "intersections", label: "Shared keywords", className: "tabular-nums" },
            { key: "avg", label: "Avg. position", className: "tabular-nums" },
            { key: "etv", label: "Est. traffic", className: "tabular-nums" },
            { key: "kw", label: "Organic keywords", className: "tabular-nums" },
          ]}
          rows={c.items.slice(0, 5).map((r) => ({
            domain: r.domain,
            intersections: n(r.intersections),
            avg: n(r.avgPosition, 1),
            etv: n(r.etv),
            kw: n(r.organicKeywords),
          }))}
        />
      </div>
      <ModuleChecks checks={checks} />
    </>
  );
}

/* ---------------- Roadmap ---------------- */

const BUCKET: { id: RoadmapItem["bucket"]; label: string; sub: string }[] = [
  { id: "this_week", label: "This week", sub: "high impact, low effort" },
  { id: "this_month", label: "This month", sub: "high impact, more work" },
  { id: "later", label: "Later", sub: "polish once the above is done" },
];

function RoadmapCard({ item }: { item: RoadmapItem }) {
  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-ink">{item.title}</p>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink/45">impact {item.impact.toFixed(1)}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink/45">
        {item.pagesAffected > 0 ? `${item.pagesAffected} page${item.pagesAffected === 1 ? "" : "s"} · ` : ""}effort {item.effort}
      </p>
      {item.fix && <p className="mt-2 text-sm leading-relaxed text-ink/65">{item.fix}</p>}
    </div>
  );
}

function RoadmapModule({ items }: { items: RoadmapItem[] }) {
  if (!items.length) return <p className="mt-4 text-sm text-ink/45">Nothing to schedule — no failing or warning checks.</p>;
  return (
    <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-3">
      {BUCKET.map((b) => {
        const list = items.filter((i) => i.bucket === b.id);
        return (
          <div key={b.id} className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {b.label} <span className="text-ink/40">· {list.length}</span>
            </p>
            <p className="text-[11px] text-ink/45">{b.sub}</p>
            <div className="mt-3 space-y-3">
              {list.map((i) => (
                <RoadmapCard key={i.checkId} item={i} />
              ))}
              {list.length === 0 && <p className="text-xs text-ink/35">Nothing here.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Pages table ---------------- */

function PagesModule({ pages }: { pages: CrawledPage[] }) {
  return (
    <div className="mt-5 min-w-0">
      <PageTable
        caption="Crawled pages"
        minWidth={1100}
        columns={[
          { key: "url", label: "URL" },
          { key: "status", label: "Status", className: "tabular-nums" },
          { key: "title", label: "Title", className: "min-w-[180px]" },
          { key: "desc", label: "Description", className: "min-w-[180px]" },
          { key: "h1", label: "H1" },
          { key: "words", label: "Words", className: "tabular-nums" },
          { key: "canonical", label: "Canonical" },
          { key: "noindex", label: "Noindex" },
          { key: "links", label: "Int. links", className: "tabular-nums" },
          { key: "issues", label: "Issues", className: "min-w-[200px]" },
        ]}
        rows={pages.map((p) => ({
          url: (
            <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="font-mono text-[12px] hover:text-iris" title={p.url}>
              {shortUrl(p.url, 40)}
            </a>
          ),
          status: p.status,
          title: p.title ? `${p.title} (${p.title.length})` : <span className="text-coral-deep">missing</span>,
          desc: p.description ? `${p.description.slice(0, 90)}${p.description.length > 90 ? "…" : ""} (${p.description.length})` : (
            <span className="text-coral-deep">missing</span>
          ),
          h1: p.h1s.length === 1 ? p.h1s[0] : p.h1s.length === 0 ? <span className="text-coral-deep">none</span> : `${p.h1s.length} H1s`,
          words: n(p.wordCount),
          canonical: p.canonical ? (p.canonical.replace(/\/$/, "") === p.finalUrl.replace(/\/$/, "") ? "self" : shortUrl(p.canonical, 32)) : "—",
          noindex: p.robotsNoindex || /noindex/i.test(p.robotsMeta ?? "") || /noindex/i.test(p.xRobotsTag ?? "") ? <span className="text-coral-deep">yes</span> : "no",
          links: n(p.internalLinks),
          issues: p.issues.length ? p.issues.join(" · ") : <span className="text-mint-deep">none</span>,
        }))}
        empty="No pages were crawled."
      />
    </div>
  );
}

/* ---------------- Section ---------------- */

export function PaidSections({
  result,
  id,
  unlocked,
  dfsReady = true,
}: {
  result: SeoAuditResult;
  id: string;
  unlocked: boolean;
  /** false = DataForSEO 不可用:锁定模块不摆 $10 按钮 */
  dfsReady?: boolean;
}) {
  const pages = result.meta.pagesCrawled;
  const notes = result.meta.notes;
  const dimScore = (d: DimensionId) => result.dimensions.find((x) => x.id === d)?.score ?? null;
  const checksFor = (d: DimensionId) => result.checks.filter((c) => c.dimension === d);
  const counts = roadmapCounts(result.meta.lockedSections);
  const firstRoadmap = result.roadmap?.[0] ?? null;
  const roadmapTotal = counts ? counts.this_week + counts.this_month + counts.later : 0;
  const issues = result.checks.filter((c) => c.status === "fail" || c.status === "warn").length;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          {unlocked ? "Off-site signals, roadmap and page table" : "In the full report"}
        </h2>
        <p className="mt-1 text-sm text-ink/45">
          {unlocked
            ? "Authority, rankings and competitors come from DataForSEO; the roadmap and page table come from our crawl."
            : `Everything below is generated from this same crawl of ${pages} page${pages === 1 ? "" : "s"} — unlock once to see it all.`}
        </p>
      </div>

      {/* Roadmap */}
      <div className="card min-w-0 p-6 sm:p-8">
        <div className="relative z-10 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Fix roadmap</p>
              <h3 className="mt-1.5 font-display text-lg font-semibold tracking-tight sm:text-xl">
                {unlocked
                  ? "What to fix, in what order"
                  : counts
                    ? `${roadmapTotal} fixes: ${counts.this_week} this week · ${counts.this_month} this month · ${counts.later} later`
                    : `${issues} fixes, prioritised by impact and effort`}
              </h3>
            </div>
          </div>
          {unlocked ? (
            <RoadmapModule items={result.roadmap ?? []} />
          ) : (
            <>
              {firstRoadmap && (
                <div className="mt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/45">First on the list</p>
                  <div className="mt-2">
                    <RoadmapCard item={firstRoadmap} />
                  </div>
                </div>
              )}
              <div className="mt-4">
                <SeoLockedSection
                  auditId={id}
                  available={dfsReady}
                  title={roadmapTotal > 1 ? `${roadmapTotal - (firstRoadmap ? 1 : 0)} more fixes, bucketed by when` : "The full roadmap"}
                  blurb="Every failing and warning check ranked by impact × pages affected, with effort and the exact fix."
                >
                  <Skeleton rows={6} cols={2} />
                </SeoLockedSection>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pages table */}
      <div className="card min-w-0 p-6 sm:p-8">
        <div className="relative z-10 min-w-0">
          <p className="eyebrow">Page table</p>
          <h3 className="mt-1.5 font-display text-lg font-semibold tracking-tight sm:text-xl">
            {unlocked ? `${result.pages.length} crawled pages, side by side` : `All ${pages} crawled pages, side by side`}
          </h3>
          {unlocked ? (
            <PagesModule pages={result.pages} />
          ) : (
            <div className="mt-4">
              <SeoLockedSection
                auditId={id}
                available={dfsReady}
                title={`Title, description, H1, word count and problems for ${pages} page${pages === 1 ? "" : "s"}`}
                blurb="Status, canonical, noindex and internal-link count per page — the sheet you'd otherwise build by hand."
              >
                <Skeleton rows={4} cols={1} />
              </SeoLockedSection>
            </div>
          )}
        </div>
      </div>

      {/* Off-site modules */}
      {PAID_DIMENSIONS.map((d) => {
        const checks = checksFor(d);
        const score = dimScore(d);
        const sub =
          d === "authority"
            ? "Who links to you, and how healthy those links are"
            : d === "visibility"
              ? "What you already rank for, and what's within reach"
              : "Who wins the keywords you care about";
        const blurb =
          d === "authority"
            ? "Domain rank, referring domains, spam score, nofollow share, anchor profile and the 90-day new/lost trend."
            : d === "visibility"
              ? "Organic keyword count, estimated traffic, position buckets, brand vs non-brand split, quick wins at positions 4–20 and AI Overview share."
              : "The top 5 domains ranking for your keywords, shared keyword count, average position and traffic gap.";
        return (
          <div key={d} className="card min-w-0 p-6 sm:p-8">
            <div className="relative z-10 min-w-0">
              <ModuleHead dimId={d} sub={sub} score={unlocked ? score : undefined} />
              {unlocked ? (
                d === "authority" ? (
                  <AuthorityModule a={result.authority} score={score} checks={checks} notes={notes} />
                ) : d === "visibility" ? (
                  <VisibilityModule v={result.visibility} checks={checks} notes={notes} />
                ) : (
                  <CompetitorsModule c={result.competitors} checks={checks} notes={notes} />
                )
              ) : (
                <div className="mt-4">
                  <SeoLockedSection auditId={id} available={dfsReady} title={DIMENSIONS[d].label} blurb={blurb}>
                    <Skeleton rows={4} cols={2} />
                  </SeoLockedSection>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
