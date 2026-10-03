import { Target, BadgeCheck, Trophy, Swords, Sparkles, MousePointerClick, Wrench } from "lucide-react";
import {
  DIMENSIONS,
  PILLAR_IDS,
  RANKING_PILLARS,
  RANKING_SUBS,
  SITE_PROFILE_SUB_WEIGHTS,
  SITE_PROFILE_WEIGHTS,
  type DimensionId,
  type PageFormat,
  type PillarId,
  type PillarScore,
  type RankingFramework,
  type SearchIntent,
  type SignalConfidence,
  type SiteProfile,
  type SiteProfileId,
} from "@/lib/seo-audit/types";

/* ============================================================
   SEO Ranking Score 的公共视觉语言与文案(报告页、落地页、方法论页共用)。

   与 dimension-meta.tsx 同一思路:图标、配色、标签只在这里定义一次,
   报告卡片、灯箱、锁定预告、how-we-score 才不会各说各话。
   "每个小维度测什么"的说明逐条对应规格 docs/design/seo-ranking-score-spec.md §4(v1)与 v2 §4 ——
   计分规则改了,这里必须同步改,否则方法论页公开的口径和真实分数对不上。

   ⚠️ 这个文件会被客户端组件(ranking-pillar-card)引入,整份进浏览器包:
   只许依赖 types.ts 的常量,不许 import relevance.ts / lib/site 这类服务端模块。
   ============================================================ */

/** 支柱固定展示顺序 = 类型层的 PILLAR_IDS(权重高的在前,技术门槛殿后);只在一处定义,别处不再手写 */
export const PILLAR_ORDER: readonly PillarId[] = PILLAR_IDS;

/** 每个支柱一个图标 —— 七张卡先在视觉上分得开(与 DIMENSION_ICON 同思路) */
export const PILLAR_ICON: Record<PillarId, typeof Target> = {
  relevance: Target,
  quality: BadgeCheck,
  authority: Trophy,
  winnability: Swords,
  aisearch: Sparkles,
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

/**
 * 权重显示:"25%" / "15.7%"(本地商家的小维度权重被覆盖后按比例压缩,会带小数);
 * 非数字返回空串(调用处据此整段不渲染)。
 */
export function weightLabel(w: number | null | undefined): string {
  if (typeof w !== "number" || !Number.isFinite(w)) return "";
  // ranking.ts 压缩后的权重保留 1 位小数,并且就用这组数算分 —— 原样显示到 1 位,与算分口径一致
  const v = Math.round(w * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
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
 * 查询来源(v4):用户自填的目标词排在最前,买家一眼认出"这是我填的那个词"。
 * 配色同可信度徽章的三档:iris 实底 / 墨色浅底 / 只有描边 —— 不引入新颜色。
 */
export type QuerySource = "target" | "ranking" | "page-topic";
export const QUERY_SOURCE_UI: Record<QuerySource, { label: string; hint: string; chip: string }> = {
  target: { label: "Your keyword", hint: "A target keyword you added to this report", chip: "bg-iris/[0.08] text-iris" },
  ranking: { label: "Ranking", hint: "A keyword this site already ranks for (DataForSEO)", chip: "bg-ink/[0.05] text-ink/60" },
  "page-topic": {
    label: "Page topic",
    hint: "No ranking data for this page, so we used its own topic as the query",
    chip: "text-ink/50 ring-1 ring-inset ring-ink/15",
  },
};

export function querySourceUi(s: string | null | undefined) {
  return s && s in QUERY_SOURCE_UI ? QUERY_SOURCE_UI[s as QuerySource] : null;
}

/**
 * 竞品弱位(S13,规格 v2 §4 winnability.serpweakness)。弱位 = 你的机会,
 * 所以用 mint 浅底(正向语义)而不是警示色;陌生值原样显示,不丢。
 */
export const WEAK_SPOT_UI: Record<string, { label: string; hint: string }> = {
  forum: { label: "Forum", hint: "A forum or user-generated page — a dedicated page can outrank it" },
  stale: { label: "Stale", hint: "Not updated in the last 18 months" },
  thin: { label: "Thin", hint: "Under 500 words of main content" },
  "off-intent": { label: "Off-intent", hint: "Its title or format doesn't match what the query asks for" },
  "low-authority": { label: "Low authority", hint: "Domain rank under 100, or no higher than yours" },
};

export function weakSpotUi(w: string): { label: string; hint: string } {
  return WEAK_SPOT_UI[w] ?? { label: w, hint: w };
}

/**
 * 支柱名:"Content quality (E-E-A-T)" 在窄卡片里会在连字符处断成 "(E-E-" / "A-T)"。
 * 括号段整体不换行,前半段照常换行。名称来自 RANKING_PILLARS,所有展示处共用这一个组件。
 */
/**
 * 展示用的名称一律按 id 取当前常量(RANKING_PILLARS / RANKING_SUBS),不用落库结果里的文字:
 * 标签是计分那一刻写进 result 的,改名(例:2026-10-02 把 "AI search & click opportunity" 缩成 "AI search & clicks")
 * 之后旧报告也要显示新名字;陌生 id(更新的结果、手工改过的行)退回结果里的原文。
 */
export function pillarLabel(p: { id: string; label: string }): string {
  return (RANKING_PILLARS as Record<string, { label: string }>)[p.id]?.label ?? p.label;
}
export function pillarRole(p: { id: string; role: string }): string {
  return (RANKING_PILLARS as Record<string, { role: string }>)[p.id]?.role ?? p.role;
}
const SUB_LABEL = new Map(RANKING_SUBS.map((x) => [x.id, x.label]));
export function subLabel(x: { id?: string; label: string }): string {
  return (x.id && SUB_LABEL.get(x.id)) || x.label;
}

export function PillarName({ label }: { label: string }) {
  const i = label.lastIndexOf(" (");
  if (i <= 0 || !label.endsWith(")")) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)} <span className="whitespace-nowrap">{label.slice(i + 1)}</span>
    </>
  );
}

/**
 * 支柱卡栅格(报告与落地页共用):桌面 12 列 —— 第一排 ⌊n/2⌋ 张、第二排其余(7 个支柱 = 3 × span-4 + 4 × span-3,
 * 不留空位);平板两列时总数为奇数则最后一张占满一行;手机单列。
 * 旧报告(v1 只有 5 个支柱)同样适用:2 × span-6 + 3 × span-4。Tailwind 只认字面类名,所以用查表而不是拼字符串。
 */
const LG_SPAN: Record<number, string> = {
  1: "lg:col-span-12",
  2: "lg:col-span-6",
  3: "lg:col-span-4",
  4: "lg:col-span-3",
};

export function pillarGridItemClass(i: number, n: number): string {
  const first = n <= 3 ? n : Math.floor(n / 2);
  const rest = n - first;
  // 超出两排能排下的数量(>8)就退回每排 3 张
  const perRow = first > 4 || rest > 4 ? 3 : i < first ? first : rest;
  const lg = LG_SPAN[perRow] ?? "lg:col-span-4";
  const smFull = n % 2 === 1 && i === n - 1 ? "sm:col-span-2" : "";
  return `min-w-0 ${lg} ${smFull}`.trim();
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

/**
 * 预期点击率曲线(behavior.ctr 的基准;规格 v2 §4)。百分比,按名次插值,10 名之后统一 1.0%。
 * ⚠️ 必须与 lib/seo-audit/ranking.ts 里的曲线一致 —— 方法论页公开的就是这张表。
 */
export const EXPECTED_CTR: { position: string; ctr: number }[] = [
  { position: "1", ctr: 27.6 },
  { position: "2", ctr: 15.8 },
  { position: "3", ctr: 11.0 },
  { position: "4", ctr: 8.4 },
  { position: "5", ctr: 6.3 },
  { position: "6", ctr: 4.9 },
  { position: "7", ctr: 3.9 },
  { position: "8", ctr: 3.3 },
  { position: "9", ctr: 2.7 },
  { position: "10", ctr: 2.4 },
  { position: "11+", ctr: 1.0 },
];

export const CTR_SOURCE = {
  label: "Backlinko's 2023 study of Google organic click-through rates",
  url: "https://backlinko.com/google-ctr-stats",
};

/** 每个小维度测什么、怎么给分(公开口径;数字逐条取自规格 §4 与 v2 §4) */
const SUB_MEASURES: Record<string, string> = {
  /* ---- Relevance & search intent ---- */
  "relevance.intent":
    "Whether each page's format fits its query's intent — a comparison for a “vs” query, a how-to for “how to…” — and, where we compared, the format the top results use. Score = the share of query–page pairs that fit.",
  "relevance.coverage":
    "The subtopics (H2/H3) that at least two of the top 5 results share, and how many of them your page covers. Covering 70% of them scores 100; fewer than 3 shared subtopics and it isn't measured.",
  "relevance.gain":
    "Per query, what your page adds that the top results don't: 8 points per subtopic none of them cover (up to 5), 20 for 5+ more data points than their median (10 for 1+), 15 for an extra table, 15 for 2+ of your own images (8 for one) and 10 for 2+ first-hand phrases. Without competitor pages it is estimated from your page alone and capped at 60.",
  "relevance.alignment":
    "Per query: the share of its core words in your title (40 points) and H1 (30), plus 30 when at least half of them appear in the first 150 words.",
  "relevance.cannibalization":
    "Pages competing for the same intent: content pages whose title topic words overlap 60%+ and share a format, URLs ranking for the same keyword, and — with Search Console — queries where 2+ pages each take 10%+ of the impressions. The score falls from 100 to 0 as the share of content pages caught in such a group rises from 0 to 30%.",

  /* ---- Content quality (E-E-A-T) ---- */
  "quality.experience":
    "Per content page: first-hand phrases such as “we tested” or “in our experience” (up to 3, for 70 points) and at least one self-hosted, non-stock image (30).",
  "quality.data":
    "Per content page: original-data phrases such as “our survey” or “sample of 500” (2 earn the full 40 points), at least one table (20), and links to authoritative sources — .gov, .edu, official docs, research, major news — per 1,000 words (2+ → 40, 1+ → 25, any → 10).",
  "quality.authorship":
    "Bylines on content pages (40), author schema (15), an About page (15), a Contact page with an email, phone or address (15), and Organization schema with 2+ sameAs profiles (15). When 20%+ of content pages cover health, money or legal topics, bylines on fewer than 80% of them cost 15 more.",
  "quality.freshness":
    "Content pages dated within the last 365 days (60), pages with any published or modified date (20), and titles without a year older than last year (20).",
  "quality.scaled":
    "Starts at 100 and deducts for near-duplicate content pages (up to 40, by share), AI boilerplate phrases (25 at 3+ per 1,000 words, 12 at 1.5+), 40%+ of 10+ pages published on one day (20), thin pages under 300 words (up to 20, by share) and 80%+ of pages with no first-hand signal (10). Higher means lower risk.",
  "quality.sources":
    "Whether your citations still hold up: dead links among the outbound links we tested (50 points, 0 at 20% dead; needs 5+ tested), content pages whose newest year mentioned is 3+ years old (30, by share), and content pages with no outbound link at all (20, by share). A part with nothing to measure is dropped and the rest re-weighted.",

  /* ---- Authority, links & reputation ---- */
  "authority.editorial":
    "Of your backlinks: the share placed in body content (article, main, section) rather than navigation, headers or footers (60 points at 60%+), and the share from blogs, news sites and CMS-hosted publications (40 points at 60%+).",
  "authority.breadth":
    "The Authority & Backlinks score from DataForSEO: referring domains, domain rank, spam score and nofollow share.",
  "authority.linkprofile":
    "Link growth — new ÷ (new + lost) referring domains over the last 90 days (40 points) — anchor text not dominated by one non-brand phrase (30 at 40% or less, 15 at 60% or less), and the share of your ranking pages, homepage aside, with backlinks of their own (30). A part without data is dropped and the rest re-weighted.",
  "authority.clusters":
    "Share of content pages inside a topic cluster — 3+ pages that share a title or H1 topic word and link to each other. 60% scores 100. Needs 5+ content pages.",
  "authority.focus":
    "Your core vocabulary — topic words from the homepage title, H1 and description, your top-level pages and your 5 most-linked content pages — checked against every crawled content page and up to 2,000 sitemap URLs (by slug). A page sharing no word with it is off-topic; 50% off-topic scores 0. Needs 5+ core words.",
  "authority.internal":
    "For your homepage, pricing and product pages and the pages you rank with: the share of crawled pages that link to each (50%+ scores 100, 20%+ 70, 5%+ 40).",
  "authority.entity":
    "One brand name across Organization schema, og:site_name and title suffixes that matches your domain (40), 2+ sameAs profiles (20), and search demand for your brand among your ranked keywords (40 at 1,000+ searches a month, 25 at 100+, 10 at any).",
  "authority.reputation":
    "Two Google searches — your brand, and your brand plus “reviews”: you rank #1 for your brand (25; top 3: 15), a knowledge panel (10), review platforms in the results (30 for 2+, 15 for one) and their rating (15 at 4.0+, 8 at 3.5+), independent sites mentioning you (20 for 4+, 10 for 2+), minus 10 per result titled scam, complaint, lawsuit, ripoff or fraud (up to 20).",

  /* ---- Winnability ---- */
  "winnability.serpweakness":
    "Per query, how many of the top 5 results have a weak spot: forum or user-generated, stale (not updated in 18 months), thin (under 500 words), off-intent (title shares under a third of the query's words, or the wrong format) or low authority (domain rank under 100, or no higher than yours). 0 weak results scores 20, 1 → 50, 2 → 80, 3+ → 100. Needs a query with 3+ known results.",
  "winnability.difficulty":
    "Keyword difficulty (0–100) against your strength — your domain rank ÷ 8, capped at 100: KD within 10 points of it scores 100, within 25 → 70, within 40 → 40, beyond → 10, weighted by search volume. Without a domain rank, absolute KD: up to 30 scores 100, up to 45 → 70, up to 60 → 40, higher → 10.",
  "winnability.gap":
    "Your domain rank against the average domain rank of each query's top 10 (or the median of the top 5 we checked): at or above it scores 100, 60%+ of it → 70, 30%+ → 40, lower → 10.",
  "winnability.striking":
    "Your non-brand ranked keywords by position, weighted by search volume: 1–3 scores 100, 4–10 → 70, 11–20 → 40, lower → 10. Keywords at 4–15 with 50+ searches a month are listed as the nearest wins.",
  "winnability.momentum":
    "With Search Console: clicks in the last 28 days against the 28 before — flat scores 50, +40% or better 100, −40% or worse 0. Without it: ranked keywords that are new or moving up, minus those moving down or lost, as a share of all of them (50 ± 50).",

  /* ---- AI search & click opportunity ---- */
  "aisearch.overview":
    "For each analysed query whose Google results show an AI Overview we could read: 100 if it cites your site, 0 if not, averaged. Not measured when none of the queries shows one.",
  "aisearch.crawlers":
    "The share of AI search and assistant crawlers your robots.txt lets in — OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, ClaudeBot, Claude-SearchBot, Claude-User, Bingbot, Applebot — for 70 points, and HTML that isn't an empty JavaScript shell (30). Training-only crawlers such as GPTBot and Google-Extended are listed, not scored: blocking them is a business choice.",
  "aisearch.citability":
    "Per content page: an opening paragraph of 60 words or fewer carrying half the title's topic words (25), 2+ question-style headings or an FAQ (20), data points per 1,000 words (20 at 5+, 10 at 2+), lists or tables (15), Article, FAQ, HowTo or Product schema (10), and a byline with a date (10).",
  "aisearch.zeroclick":
    "How much of the click your keywords' result pages leave for organic results, weighted by search volume. Each feature takes a share — AI Overview 35%, featured snippet 20% (none if it's yours), answer box 20%, ads or shopping 15%, local pack 15%, knowledge panel 10%, video, People also ask and top stories 5% each — capped at 85%. Score = 100 × (1 − the average share taken).",

  /* ---- User satisfaction signals ---- */
  "behavior.realuser":
    "LCP, INP and CLS from the Chrome UX Report — real Chrome users, page-level where available, otherwise your whole origin. Good earns full credit, needs improvement half. Not measured without real-user data.",
  "behavior.ctr":
    "Search Console only: clicks on your non-brand queries with 50+ impressions against the clicks expected at their average position (27.6% at #1, 15.8% at #2, 11.0% at #3 … 2.4% at #10, 1.0% beyond). Matching the curve scores 85; beating it by about 18% scores 100.",
  "behavior.task":
    "The answer within the first 150 words (40), a next-step link in the last third of content pages (30), FAQs on articles (15), and no pop-up or overlay markup (15).",
  "behavior.readability":
    "Flesch reading ease (60+ → 50, 40+ → 35, 30+ → 20, lower → 10; 35 when the page isn't in English), paragraphs averaging 80 words or fewer (20; 120 or fewer → 10), 300 words or fewer per heading (15), and lists or tables on content pages (15, by share).",
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

/* ---------------- 站点类型(v2 §1) ---------------- */

/**
 * Search Console 的隐私说明(连接前就要让人看到;报告凭链接公开,规格 v2 §0)。
 * 连接卡与方法论页共用这一句 —— 放在共享模块里,服务端页面才拿得到字符串本身。
 */
export const GSC_PRIVACY_LINE = "Anyone with this report link can see the Search Console data shown here.";

/**
 * 方法论页的站点类型权重表锚点。放在这里而不是 profile-chip.tsx:那是 "use client" 模块,
 * 服务端组件从客户端模块 import 的非组件值拿到的是客户端引用,不是字符串。
 */
export const PROFILES_HREF = "/seo-audit/how-we-score#ranking-profiles";

/** 方法论页权重表的列顺序 */
export const PROFILE_ORDER: SiteProfileId[] = ["default", "ecommerce", "local", "ymyl"];

/** 判型规则的公开口径(ranking.ts detectSiteProfile;多个命中按 ymyl > local > ecommerce > default) */
export const PROFILE_RULE: Record<SiteProfileId, string> = {
  ymyl: "30%+ of content pages cover health, money or legal topics (the same word lists as the authorship rule).",
  local:
    "LocalBusiness-type schema on the entry page or on 2+ pages, or an address and phone number on the homepage with a phone number on 30%+ of pages.",
  ecommerce:
    "Product or Offer schema on 20%+ of readable pages (or on 5+ pages), product-format pages making up 20%+, or 20%+ of URLs under /product(s)/, /shop/, /collections/ or /cart.",
  default: "Everything else — SaaS, business and publisher sites.",
};

/** 类型名:优先用报告里落库的 label,其次类型层常量;都没有返回 null(v1 报告没有 profile) */
export function profileLabel(p: Pick<SiteProfile, "id" | "label"> | null | undefined): string | null {
  if (!p) return null;
  const label = typeof p.label === "string" ? p.label.trim() : "";
  if (label) return label;
  return SITE_PROFILE_WEIGHTS[p.id]?.label ?? null;
}

/** 一个支柱在各站点类型下的权重区间,例:"15–30%";各类型相同则只给一个数 */
export function pillarWeightRange(p: PillarId): string {
  const ws = PROFILE_ORDER.map((id) => SITE_PROFILE_WEIGHTS[id].weights[p]);
  const lo = Math.min(...ws);
  const hi = Math.max(...ws);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

/** 小维度权重覆盖(目前只有本地商家的站外声誉):[{ profile, weight }] */
export function subWeightOverrides(subId: string): { profile: SiteProfileId; label: string; weight: number }[] {
  const out: { profile: SiteProfileId; label: string; weight: number }[] = [];
  for (const id of PROFILE_ORDER) {
    const w = SITE_PROFILE_SUB_WEIGHTS[id]?.[subId];
    if (typeof w === "number") out.push({ profile: id, label: SITE_PROFILE_WEIGHTS[id].label, weight: w });
  }
  return out;
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
