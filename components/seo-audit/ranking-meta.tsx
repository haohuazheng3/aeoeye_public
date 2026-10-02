import { Target, BadgeCheck, Trophy, MousePointerClick, Wrench } from "lucide-react";
import {
  DIMENSIONS,
  RANKING_SUBS,
  type DimensionId,
  type PageFormat,
  type PillarId,
  type PillarScore,
  type RankingFramework,
  type SearchIntent,
  type SignalConfidence,
} from "@/lib/seo-audit/types";

/* ============================================================
   SEO Ranking Score 的公共视觉语言与文案(报告页、落地页、方法论页共用)。

   与 dimension-meta.tsx 同一思路:图标、配色、标签只在这里定义一次,
   报告卡片、灯箱、锁定预告、how-we-score 才不会各说各话。
   "每个小维度测什么"的说明逐条对应规格 docs/design/seo-ranking-score-spec.md §4 ——
   计分规则改了,这里必须同步改,否则方法论页公开的口径和真实分数对不上。
   ============================================================ */

/** 支柱固定展示顺序:与规格 §4 一致(权重高的在前,技术门槛殿后) */
export const PILLAR_ORDER: PillarId[] = ["relevance", "quality", "authority", "behavior", "technical"];

/** 每个支柱一个图标 —— 五张卡先在视觉上分得开(与 DIMENSION_ICON 同思路) */
export const PILLAR_ICON: Record<PillarId, typeof Target> = {
  relevance: Target,
  quality: BadgeCheck,
  authority: Trophy,
  behavior: MousePointerClick,
  technical: Wrench,
};

/**
 * 可信度标签(规格 §0:UI 必须显示)。配色守设计基因的"色彩精简":
 * measured 中性墨色、estimated 品牌 iris、proxy 只有描边 —— 不引入第四种颜色。
 */
export const CONFIDENCE_UI: Record<SignalConfidence, { label: string; hint: string; chip: string }> = {
  measured: {
    label: "Measured",
    hint: "read directly from data",
    chip: "bg-ink/[0.06] text-ink/60",
  },
  estimated: {
    label: "Estimated",
    hint: "rule-based estimate from page text",
    chip: "bg-iris/[0.08] text-iris",
  },
  proxy: {
    label: "Proxy",
    hint: "page traits standing in for behaviour data Google doesn't share",
    chip: "text-ink/50 ring-1 ring-inset ring-ink/15",
  },
};

export const CONFIDENCE_ORDER: SignalConfidence[] = ["measured", "estimated", "proxy"];

export function ConfidenceBadge({ confidence }: { confidence: SignalConfidence }) {
  // 防御:落库数据来自引擎,但旧版本 / 手工修过的行可能带陌生值 —— 退回 estimated,不让整页崩
  const ui = CONFIDENCE_UI[confidence] ?? CONFIDENCE_UI.estimated;
  return (
    <span
      title={`${ui.label}: ${ui.hint}`}
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ${ui.chip}`}
    >
      {ui.label}
    </span>
  );
}

/** 分数条配色:与 ScoreRing 三档一致(≥70 mint / ≥40 amber / <40 coral);没测到只留轨道 */
export function barTone(score: number | null): string {
  if (score === null) return "bg-transparent";
  if (score >= 70) return "bg-mint";
  if (score >= 40) return "bg-amber-500";
  return "bg-coral";
}

/** 0-100 取整;非数字 → null(没测到 ≠ 0 分,规格 §0) */
export function scoreValue(score: number | null | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** 横向分数条。null 时只有轨道 —— 画成 0 长度的彩条会被读成"0 分" */
export function ScoreBar({ score }: { score: number | null }) {
  const v = scoreValue(score);
  return (
    <span className="relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/[0.07]" aria-hidden="true">
      {v !== null && v > 0 && <span className={`absolute inset-y-0 left-0 rounded-full ${barTone(v)}`} style={{ width: `${v}%` }} />}
    </span>
  );
}

export const FORMAT_LABEL: Record<PageFormat, string> = {
  definition: "Definition",
  "how-to": "How-to guide",
  comparison: "Comparison",
  listicle: "List",
  product: "Product page",
  pricing: "Pricing page",
  local: "Local page",
  homepage: "Homepage",
  article: "Article",
  other: "Other",
};

export const INTENT_LABEL: Record<SearchIntent, string> = {
  informational: "Informational",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
  local: "Local",
};

export function formatLabel(f: PageFormat | null | undefined): string {
  return (f && FORMAT_LABEL[f]) || "Other";
}

export function intentLabel(i: SearchIntent | null | undefined): string {
  return (i && INTENT_LABEL[i]) || "Unknown";
}

/**
 * 支柱名:"Content quality (E-E-A-T)" 在窄卡片里会在连字符处断成 "(E-E-" / "A-T)"。
 * 括号段整体不换行,前半段照常换行。名称来自 RANKING_PILLARS,所有展示处共用这一个组件。
 */
export function PillarName({ label }: { label: string }) {
  const i = label.lastIndexOf(" (");
  if (i <= 0 || !label.endsWith(")")) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)} <span className="whitespace-nowrap">{label.slice(i + 1)}</span>
    </>
  );
}

/** 技术支柱的 7 个小维度 = 免费技术分的 7 个站内维度(规格 §4 的映射,一一对应) */
export const TECH_SUB_DIMENSION: Record<string, DimensionId> = {
  "technical.crawl": "crawlability",
  "technical.onpage": "onpage",
  "technical.cwv": "performance",
  "technical.mobile": "mobile",
  "technical.https": "security",
  "technical.structure": "architecture",
  "technical.schema": "structured",
};

/** 每个小维度测什么、怎么给分(公开口径;数字逐条取自规格 §4) */
const SUB_MEASURES: Record<string, string> = {
  "relevance.intent":
    "Whether each page's format fits its query's intent — a comparison for a “vs” query, a how-to for “how to…” — and, where we compared, the format the top results use. Score = share of query–page pairs that fit.",
  "relevance.coverage":
    "The subtopics (H2/H3) that at least two of the top 5 results share, and how many of them your page covers. Covering 70% of them scores 100.",
  "relevance.gain":
    "What your page adds that the top results don't: subtopics none of them cover, more data points, more tables, your own images, first-hand experience. Without competitor pages it is estimated from your page alone and capped at 60.",
  "relevance.alignment":
    "Whether the query's core words appear in your title (40 points) and H1 (30), and at least half of them in the first 150 words (30).",
  "quality.experience":
    "Per content page: first-hand phrases such as “we tested” or “in our experience” (up to 3, for 70 points) and at least one self-hosted, non-stock image (30).",
  "quality.data":
    "Per content page: original-data phrases such as “our survey” or “sample of 500” (40), at least one table (20), and links to authoritative sources — .gov, .edu, official docs, research, major news — per 1,000 words (up to 40).",
  "quality.authorship":
    "Bylines on content pages (40), author schema (15), an About page (15), a Contact page with an email, phone or address (15), and Organization schema with 2+ sameAs profiles (15). When 20%+ of content pages cover health, money or legal topics, bylines on fewer than 80% of them cost 15 more.",
  "quality.freshness":
    "Content pages dated within the last 365 days (60), pages with any published or modified date (20), and titles without a year older than last year (20).",
  "quality.scaled":
    "Starts at 100 and deducts for near-duplicate pages, AI boilerplate phrases per 1,000 words, 40%+ of 10+ pages published on one day, thin pages under 300 words, and 80%+ of pages with no first-hand signal. Higher means lower risk.",
  "authority.editorial":
    "Of your backlinks: the share placed in body content (article, main, section) rather than navigation, headers or footers (60 points at 60%+), and the share from blogs, news sites and CMS-hosted publications (40 points at 60%+).",
  "authority.breadth":
    "The Authority & Backlinks score from DataForSEO: referring domains, domain rank, spam score and nofollow share.",
  "authority.clusters":
    "Share of content pages inside a topic cluster — 3+ pages that share a title or H1 topic word and link to each other. 60% scores 100. Needs 5+ content pages.",
  "authority.internal":
    "For your homepage, pricing and product pages and the pages you rank with: the share of crawled pages that link to each (50%+ scores 100, 20%+ 70, 5%+ 40).",
  "authority.entity":
    "One brand name across Organization schema, og:site_name and title suffixes that matches your domain (40), 2+ sameAs profiles (20), and search demand for your brand in your ranked keywords (40).",
  "behavior.realuser":
    "LCP, INP and CLS from the Chrome UX Report — real Chrome users, page-level where available, otherwise your whole origin. Good earns full credit, needs improvement half. Not measured without real-user data.",
  "behavior.task":
    "The answer within the first 150 words (40), a next-step link in the last third of content pages (30), FAQs on articles (15), and no pop-up or overlay markup (15).",
  "behavior.readability":
    "Flesch reading ease (up to 50), average paragraph length (up to 20), words per heading (15), and lists or tables on content pages (15).",
  "behavior.promise":
    "Starts at 100 and deducts for clickbait titles (up to 50), titles that promise a number the page doesn't deliver (up to 30), and titles whose topic doesn't show up early on the page (up to 20).",
};

export function subMeasures(id: string): string {
  const dim = TECH_SUB_DIMENSION[id];
  if (dim) return `The ${DIMENSIONS[dim].label} score from the free Technical SEO score. ${DIMENSIONS[dim].blurb}`;
  return SUB_MEASURES[id] ?? "";
}

export function subsOf(pillar: PillarId) {
  return RANKING_SUBS.filter((s) => s.pillar === pillar);
}

/** 按 PILLAR_ORDER 排序;陌生支柱放最后,不丢 */
export function orderPillars(pillars: PillarScore[]): PillarScore[] {
  const rank = (id: string) => {
    const i = PILLAR_ORDER.indexOf(id as PillarId);
    return i === -1 ? PILLAR_ORDER.length : i;
  };
  return [...pillars].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * "排名分可用"的唯一判据 —— 头部(换大环)和报告正文(渲染板块还是"不可用"提示)必须用同一个,
 * 否则会出现头部顶着排名分、正文却说"排名分不可用"的矛盾。旧报告没有这个字段;
 * 模块失败落成 null;形状不对(没有支柱、总分不是数)一律当不可用。
 */
export function usableRanking(r: RankingFramework | null | undefined): RankingFramework | null {
  if (!r || typeof r !== "object") return null;
  if (!Array.isArray(r.pillars) || r.pillars.length === 0) return null;
  if (!r.overall || scoreValue(r.overall.score) === null) return null;
  return r;
}
