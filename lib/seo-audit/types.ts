/* ============================================================
   SEO Audit —— 共享类型(所有模块只依赖这个文件,互不 import 实现)

   产品定位:与 AI 可见度审计并列的第二个产品面。免费层零边际成本
   (自建抓取 + Google PageSpeed Insights),付费层($10 一次性)才调 DataForSEO。
   ============================================================ */

export type SeoPlan = "free" | "full";
export type CheckStatus = "pass" | "warn" | "fail" | "info" | "na";
export type Severity = "critical" | "high" | "medium" | "low";
export type Effort = "low" | "medium" | "high";

/** 8 个站内维度(免费)+ 3 个站外维度(付费,单独计分,不并入站内总分) */
export type DimensionId =
  | "crawlability"
  | "onpage"
  | "performance"
  | "mobile"
  | "structured"
  | "security"
  | "architecture"
  | "authority"
  | "visibility"
  | "competitors";

export const ONSITE_DIMENSIONS: DimensionId[] = [
  "crawlability",
  "onpage",
  "performance",
  "mobile",
  "structured",
  "security",
  "architecture",
];
export const PAID_DIMENSIONS: DimensionId[] = ["authority", "visibility", "competitors"];

export interface DimensionMeta {
  id: DimensionId;
  label: string;
  short: string;
  /** 站内总分权重(站外维度为 0:它们单独展示) */
  weight: number;
  paid: boolean;
  blurb: string;
}

export const DIMENSIONS: Record<DimensionId, DimensionMeta> = {
  crawlability: { id: "crawlability", label: "Crawlability & Indexing", short: "Crawl", weight: 25, paid: false, blurb: "Can Google reach, crawl and index the pages that matter? Robots, sitemaps, canonicals, redirects and blockers." },
  onpage: { id: "onpage", label: "On-Page & Content", short: "On-page", weight: 20, paid: false, blurb: "Titles, descriptions, headings, alt text, thin and duplicate content across the pages we crawled." },
  performance: { id: "performance", label: "Performance", short: "Speed", weight: 15, paid: false, blurb: "Core Web Vitals from real Chrome users (CrUX p75), with Lighthouse as the diagnostic layer." },
  mobile: { id: "mobile", label: "Mobile Usability", short: "Mobile", weight: 10, paid: false, blurb: "Viewport, tap targets, font sizes, image sizing and mobile/desktop content parity." },
  structured: { id: "structured", label: "Structured Data & Social", short: "Schema", weight: 10, paid: false, blurb: "JSON-LD validity and required fields per Google's docs, Open Graph, Twitter cards and favicon." },
  security: { id: "security", label: "HTTPS & Trust", short: "Trust", weight: 10, paid: false, blurb: "HTTPS everywhere, certificate health, mixed content and the trust pages every site needs." },
  architecture: { id: "architecture", label: "Architecture & Internal Links", short: "Links", weight: 10, paid: false, blurb: "Click depth, internal link counts, broken links, orphan signals and navigation consistency." },
  authority: { id: "authority", label: "Authority & Backlinks", short: "Authority", weight: 0, paid: true, blurb: "Referring domains, link quality, anchors and spam signals (DataForSEO)." },
  visibility: { id: "visibility", label: "Search Visibility", short: "Rankings", weight: 0, paid: true, blurb: "Organic keywords, estimated traffic, position buckets and quick wins (DataForSEO)." },
  competitors: { id: "competitors", label: "Competitors", short: "Rivals", weight: 0, paid: true, blurb: "Who ranks for the same keywords, and how far ahead they are (DataForSEO)." },
};

/** 单条检查项 —— 报告里每一行"问题"都是它 */
export interface SeoCheck {
  id: string;
  dimension: DimensionId;
  title: string;
  status: CheckStatus;
  severity: Severity;
  /** 维度内相对权重(1-5),pass 得满分、warn 得一半、fail 得 0、na/info 不计 */
  weight: number;
  /** 具体证据:值、页面、数量。免费版除 top 3 外会被隐藏 */
  evidence: string[];
  /** 受影响页面 URL(付费版展示) */
  affected: string[];
  /** 具体修法(付费版展示;top 3 免费可见) */
  fix: string;
  effort: Effort;
  /** 官方文档链接(Google Search Central / web.dev / MDN) */
  docs?: string;
  /** 免费视图里是否已被隐藏细节 */
  locked?: boolean;
  /** 致命项(门):fail 时封顶总分 —— 入口非 200 / 入口 noindex / robots 全禁 / 无 https / 证书过期 */
  gate?: boolean;
  /** 中性名称(不随状态变化,例如 "Image dimensions");title 才是随状态变化的那句话:
   *  pass → 达标表述("Images declare width and height"),fail/warn → 问题表述("Images are missing width and height") */
  name?: string;
  /** 页面级检查:受影响页数与样本(免费视图只留 ≤1 个样本 URL) */
  scope?: "site" | "page";
  affectedCount?: number;
  sample?: string[];
}

export interface DimensionScore {
  id: DimensionId;
  label: string;
  /** 0-100;付费维度未解锁时为 null */
  score: number | null;
  weight: number;
  pass: number;
  warn: number;
  fail: number;
  na: number;
  locked: boolean;
  /** 一句话结论 */
  summary: string;
}

export interface Heading {
  level: number;
  text: string;
}

export interface CrawledPage {
  url: string;
  finalUrl: string;
  status: number;
  redirects: number;
  contentType: string;
  bytes: number;
  fetchedMs: number;
  /** 点击深度(入口页 0) */
  depth: number;
  title: string;
  description: string;
  h1s: string[];
  headings: Heading[];
  wordCount: number;
  textToHtml: number;
  canonical: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  lang: string | null;
  viewport: string | null;
  images: { total: number; missingAlt: number };
  internalLinks: number;
  externalLinks: number;
  /** 抓到的站内链接(去重、绝对 URL) —— 供 BFS 与内链分析 */
  links: string[];
  genericAnchors: number;
  jsonLdTypes: string[];
  jsonLdErrors: number;
  og: Record<string, string>;
  twitter: Record<string, string>;
  hreflang: { lang: string; href: string }[];
  mixedContent: number;
  hasBreadcrumbSchema: boolean;
  hasFavicon: boolean;
  /** 页面级问题摘要(供页面表) */
  issues: string[];
  /* ---- v2 追加(评审后):没有数据时保持默认值,检查逻辑要能容忍缺省 ---- */
  /** 首字节时间(ms),来自我们自己的抓取 */
  ttfbMs?: number | null;
  /** HTTP Last-Modified 或 JSON-LD dateModified,ISO 字符串 */
  lastModified?: string | null;
  metaRefresh?: boolean;
  /** script 字节占 HTML 字节比例 */
  scriptShare?: number;
  /** 原始 HTML 是空壳(挂载点无文本且可见词 < 100)—— JS 渲染依赖信号 */
  jsShell?: boolean;
  robotsNoindex?: boolean;
  robotsNofollow?: boolean;
  nofollowInternal?: number;
  uniqueInternalLinks?: number;
  /** 导航区(nav/header/footer)里的内链数 */
  navLinks?: number;
  imagesMissingDims?: number;
  /** ≤20 张图片的绝对 URL(供大图抽样) */
  imageUrls?: string[];
  /** ≤30 条外链(供失效外链抽样) */
  outboundLinks?: string[];
  /** 页面类型启发式:薄内容只对 article 生效 */
  pageType?: PageType;
  /** 主体文本 5-gram 的 minhash 签名(64 个),供近重复检测 */
  minhash?: number[];
  /** 主体文本前 400 字符(供 headline/title 一致性等轻量判断) */
  textSample?: string;
  /** v3:内容质量与用户信号(parse.ts 计算;只存计数 / 比例 / 短文本,不存全文) */
  content?: PageContentSignals;
}

export type PageType = "home" | "product" | "pricing" | "legal" | "contact" | "article" | "listing" | "other";

export type VariantKind =
  | "http-apex"
  | "http-www"
  | "https-apex"
  | "https-www"
  | "trailing-slash"
  | "index-html"
  | "uppercase"
  | "utm";

export interface UrlVariant {
  url: string;
  status: number | null;
  location: string | null;
  chain: string[];
  error?: string;
  kind?: VariantKind;
  /** 逐跳状态码(301/302/307/308) */
  hops?: number[];
  finalUrl?: string;
  metaRefresh?: boolean;
  /** 该变体页面的 canonical(仅 200 时) */
  canonical?: string | null;
}

export interface SitemapInfo {
  url: string;
  status: number | null;
  valid: boolean;
  isIndex: boolean;
  urlCount: number;
  lastmodShare: number;
  newestLastmod: string | null;
  children: string[];
  error?: string;
}

export interface SiteProbe {
  input: string;
  entryUrl: string;
  origin: string;
  host: string;
  variants: UrlVariant[];
  robots: {
    url: string;
    status: number | null;
    found: boolean;
    disallowAll: boolean;
    blocksEntry: boolean;
    sitemaps: string[];
    bytes: number;
    error?: string;
  };
  sitemaps: SitemapInfo[];
  soft404: { probeUrl: string; status: number | null; isSoft404: boolean };
  headers: {
    hsts: string | null;
    csp: string | null;
    xContentTypeOptions: string | null;
    xFrameOptions: string | null;
    referrerPolicy: string | null;
    server: string | null;
    xRobotsTag: string | null;
  };
  /* ---- v2 追加:两道前置门 + 更多探针(hardening 阶段填充,可选) ---- */
  /** WAF / 挑战页 / 403 拦截:检测到就不出分 */
  blocked?: { detected: boolean; kind: "waf" | "challenge" | "forbidden" | "rate-limited" | "tls" | null; evidence: string };
  /** 入口页依赖 JS 渲染(原始 HTML 空壳) */
  jsDependent?: boolean;
  tls?: { validTo: string | null; daysLeft: number | null; issuer: string | null; coversWww: boolean | null; error: string | null };
  /** 移动/桌面 UA 抓入口页的内容一致性 */
  parity?: {
    mobileWords: number; desktopWords: number;
    mobileH1: string; desktopH1: string;
    mobileLinks: number; desktopLinks: number;
    mobileJsonLd: number; desktopJsonLd: number;
  } | null;
  robotsMeta?: {
    contentType: string | null;
    isHtml: boolean;
    googlebotDisallowAll: boolean;
    blocksResources: string[];
    crawlDelay: number | null;
    aiCrawlers: Record<string, "allow" | "disallow" | "unspecified">;
    hasSitemapDirective: boolean;
  };
  /** sitemap 抽样 ≤20 条的可收录性 */
  sitemapSample?: { url: string; status: number | null; noindex: boolean; canonical: string | null; sameHost: boolean }[];
  /** 已抓页面 canonical 指向的外部目标(去重 ≤10)的可达性 */
  canonicalTargets?: { url: string; status: number | null; finalUrl: string | null; noindex: boolean }[];
  brokenInternal?: { from: string; to: string; status: number | null }[];
  brokenOutbound?: { from: string; to: string; status: number | null }[];
  /** v4:外链失效探针实际检查了多少条外链(brokenOutbound 的分母) */
  outboundChecked?: number;
  largeImages?: { url: string; bytes: number }[];
  ogImage?: { url: string; status: number | null; bytes: number | null; contentType: string | null } | null;
  crawlTtfb?: { p50: number | null; p90: number | null; slowest: { url: string; ms: number }[] };
  /** 入口请求没拿到 HTTP 响应时的原因(复审 C20:TLS 失败不是"防火墙拦截",要走 sec.https / sec.tls 的 gate) */
  entryError?: { kind: "tls" | "dns" | "timeout" | "refused" | "other"; message: string } | null;
  /** www ↔ 裸域的另一个主机(复审 C21:子域名站点没有 www.<子域>,不能因此扣分) */
  altHost?: { host: string; exists: boolean | null; error?: string } | null;
  /** 抓取覆盖:导航 BFS 页数 + sitemap 分层抽样页数 */
  coverage?: { navPages: number; sitemapPages: number; skippedByRobots: number; stoppedEarly: string | null };
}

export interface PsiAudit {
  id: string;
  title: string;
  score: number | null;
  displayValue: string;
  description: string;
}

export interface PsiResult {
  strategy: "mobile" | "desktop";
  fetchedUrl: string;
  scores: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
  lab: {
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    fcpMs: number | null;
    speedIndexMs: number | null;
    ttiMs: number | null;
    serverResponseMs: number | null;
    totalBytes: number | null;
  };
  field: { lcp: string | null; inp: string | null; cls: string | null; overall: string | null } | null;
  audits: PsiAudit[];
  error?: string;
  /** v2:CrUX p75 数值(页面级优先,退回 origin 级),评分以此为准 */
  fieldMetrics?: { lcpMs: number | null; inpMs: number | null; cls: number | null; ttfbMs: number | null; source: "page" | "origin" | null } | null;
  /** Lighthouse 抓取时间(报告里注明"lab, single run") */
  fetchTime?: string | null;
}

export interface AuthorityResult {
  rank: number | null;
  backlinks: number;
  referringDomains: number;
  referringMainDomains: number;
  referringIps: number;
  nofollowShare: number;
  spamScore: number | null;
  brokenBacklinks: number;
  brokenPages: number;
  firstSeen: string | null;
  tld: Record<string, number>;
  linkTypes: Record<string, number>;
  anchors: { anchor: string; backlinks: number; referringDomains: number }[];
  score: number;
  /** v2:近 90 天按月新增/丢失引荐域 */
  timeseries?: { month: string; newReferringDomains: number; lostReferringDomains: number }[];
  /** DataForSEO 没有这个域名的数据(≠ 0 分) */
  noData?: boolean;
  /** v3:引荐链接在对方页面里的语义位置分布(article / main / section / header / footer / aside / nav / ""=未知) */
  semanticLocations?: Record<string, number>;
  /** v3:引荐来源的平台类型分布(blogs / news / cms / organization / ecommerce / message-boards / unknown …) */
  platformTypes?: Record<string, number>;
}

export interface RankedKeyword {
  keyword: string;
  position: number;
  volume: number | null;
  etv: number | null;
  url: string | null;
  intent: string | null;
  cpc: number | null;
  /* ---- v4:ranked_keywords 的返回里本来就有、之前丢掉的字段(零新增成本) ---- */
  /** 关键词难度 0–100(keyword_properties.keyword_difficulty) */
  kd?: number | null;
  /** 该词 SERP 里出现的元素类型(ai_overview / featured_snippet / paid / people_also_ask / video / local_pack …) */
  serpItemTypes?: string[];
  /** 该词前 10 名的平均主域权威(avg_backlinks_info.main_domain_rank,0–1000) */
  avgTopDomainRank?: number | null;
  avgTopReferringDomains?: number | null;
  /** 本站排名页的名次变化(serp_item.rank_changes) */
  rankChange?: { previous: number | null; isNew: boolean; isUp: boolean; isDown: boolean } | null;
  /** 本站排名页自己的页级外链(serp_item.backlinks_info / rank_info) */
  pageReferringDomains?: number | null;
  pageRank?: number | null;
  /** 搜索量趋势(%,keyword_info.search_volume_trend) */
  volumeTrend?: { quarterly: number | null; yearly: number | null } | null;
  /** 本站拥有该词的精选摘要 */
  isFeaturedSnippet?: boolean;
}

export interface VisibilityResult {
  organicKeywords: number;
  etv: number;
  positions: { pos1: number; pos2_3: number; pos4_10: number; pos11_20: number; pos21_50: number; pos51_100: number };
  movement: { isNew: number; isUp: number; isDown: number; isLost: number };
  topKeywords: RankedKeyword[];
  quickWins: RankedKeyword[];
  score: number;
  /** v2 */
  brandKeywords?: number;
  nonBrandKeywords?: number;
  /** 排名词的 SERP 里含 AI Overview 的占比(0-1) */
  aiOverviewShare?: number | null;
  /** site: 查询估算收录量 vs sitemap 条数 */
  indexEstimate?: { googleResults: number | null; sitemapUrls: number | null; ratio: number | null };
  noData?: boolean;
}

export interface CompetitorRow {
  domain: string;
  intersections: number;
  avgPosition: number | null;
  etv: number | null;
  organicKeywords: number | null;
}

export interface CompetitorsResult {
  items: CompetitorRow[];
  score: number;
  noData?: boolean;
}

export type RoadmapBucket = "this_week" | "this_month" | "later";

export interface RoadmapItem {
  checkId: string;
  title: string;
  bucket: RoadmapBucket;
  impact: number;
  effort: Effort;
  pagesAffected: number;
  fix: string;
}

export interface SeoAuditResult {
  version: 1;
  plan: SeoPlan;
  input: string;
  entryUrl: string;
  domain: string;
  generatedAt: string;
  durationMs: number;
  overall: { score: number; grade: "A" | "B" | "C" | "D" | "F" };
  dimensions: DimensionScore[];
  checks: SeoCheck[];
  /** 免费视图里被清空(只留 meta.pagesCrawled) */
  pages: CrawledPage[];
  probe: SiteProbe;
  psi: { mobile: PsiResult | null; desktop: PsiResult | null };
  /** 免费可见的 3 条最严重问题(check id) */
  topIssues: string[];
  roadmap: RoadmapItem[] | null;
  authority: AuthorityResult | null;
  visibility: VisibilityResult | null;
  competitors: CompetitorsResult | null;
  cost: { dataforseoUsd: number; calls: number };
  /** v3:SEO Ranking Score(仅付费完整版;免费视图恒为 null) */
  ranking?: RankingFramework | null;
  /** v4:站外声誉(2 次 SERP;仅付费完整版) */
  reputation?: ReputationAnalysis | null;
  /** v4:Search Console 数据(站长授权后;仅已解锁报告;免费 / 撤销视图恒为 null) */
  gsc?: GscData | null;
  meta: {
    pagesCrawled: number;
    pagesRequested: number;
    crawlLimited: boolean;
    notes: string[];
    /** 免费视图:哪些内容被锁 */
    lockedSections: string[];
    /* ---- v2 ---- */
    /** complete = 正常出分;blocked = 被 WAF/挑战拦截,不出分;limited = JS 渲染依赖,内容类检查 na */
    outcome?: "complete" | "blocked" | "limited";
    /** 触发封顶的致命项 check id */
    blockers?: string[];
    /** 样本量与低置信维度 */
    confidence?: { pagesSampled: number; lowConfidence: DimensionId[]; unmeasured: DimensionId[] };
    /** 分数口径说明,例如 "Based on 6 of 7 dimensions" */
    scoreNote?: string;
    psiFetchTime?: string | null;
    /** 结果是从同域近期报告复制的(免费层缓存) */
    cachedFrom?: string | null;
  };
}

/** 后台跑批的阶段(报告页轮询展示) */
export type SeoAuditStage =
  | "queued"
  | "probing"
  | "crawling"
  | "pagespeed"
  /** 抓后补全:sitemap 抽样、断链、大图、canonical 目标(复审 C17:不能回退成 probing) */
  | "verifying"
  | "scoring"
  | "authority"
  | "visibility"
  | "competitors"
  | "done";

export interface SeoAuditProgress {
  stage: SeoAuditStage;
  /** 0-100 的经验进度 */
  percent: number;
  pagesCrawled?: number;
  startedAt?: string;
  updatedAt?: string;
  message?: string;
}

/** 报告的付费判定沿用现有 audits 的口径:unlocked && plan === "full" 才算"到手" */
export interface SeoAuditRow {
  id: string;
  input: string;
  url: string;
  domain: string;
  status: "pending" | "running" | "complete" | "failed";
  plan: SeoPlan;
  score: number | null;
  grade: string | null;
  result: SeoAuditResult | null;
  error: string | null;
  email: string | null;
  unlocked: boolean;
  userId: string | null;
  source: string | null;
  ipHash: string | null;
  costCents: number;
  createdAt: Date;
  completedAt: Date | null;
  unlockedAt: Date | null;
  /* ---- v2(可选,hardening 阶段落库) ---- */
  progress?: SeoAuditProgress | null;
  cachedFrom?: string | null;
  /** 付费升级的 CAS 状态机:idle | running | done | failed */
  upgradeState?: string | null;
  upgradeStartedAt?: Date | null;
  rerunCount?: number;
  paidRefreshCount?: number;
  /** v4:用户自填的目标关键词(≤3)与改动次数(≤3) */
  targetKeywords?: string[] | null;
  targetChanges?: number;
  /** v4:已绑定并验证的 Search Console 属性(sc-domain:… 或 URL 前缀);未接入为 null */
  gscProperty?: string | null;
}

export const SEO_REPORT_PRICE_CENTS = 1000;
/** 免费:导航 BFS 12 页 + sitemap 分层抽样 8 页;付费:25 + 15 */
export const FREE_CRAWL_PAGES = 20;
export const FULL_CRAWL_PAGES = 40;
export const FREE_NAV_PAGES = 12;
export const FULL_NAV_PAGES = 25;
/** 免费视图里完整展示证据与修法的检查上限(critical + high) */
export const FREE_FULL_DETAIL_MAX = 8;
export const SEO_BOT_UA = "Mozilla/5.0 (compatible; AEOeyeBot/1.0; +https://aeoeye.com/bot)";
/** 移动/桌面内容一致性探针用的移动端 UA —— 带 Mobile 标记让动态服务的站返回移动版,
 *  但仍明确标识 AEOeyeBot(复审 C39:不冒充 Googlebot 或真实浏览器,站长按 UA 屏蔽我们时必须生效) */
export const SEO_BOT_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 (compatible; AEOeyeBot/1.0; +https://aeoeye.com/bot)";
/** 付费模块(站外三项) */
export type PaidModuleId = "authority" | "visibility" | "competitors";
/** 与站内 gradeFor 一致的等级刻度(A≥85 B≥70 C≥55 D≥40),避免同一品牌两份报告等级打架 */
export const SEO_GRADE_SCALE: { grade: "A" | "B" | "C" | "D" | "F"; min: number }[] = [
  { grade: "A", min: 85 },
  { grade: "B", min: 70 },
  { grade: "C", min: 55 },
  { grade: "D", min: 40 },
  { grade: "F", min: 0 },
];


/* ============================================================
   v3 · SEO Ranking Score —— 付费完整版的新总分(2026-10-01 站长指令)

   5 个大维度(支柱),每个下设若干小维度,各自 0-100 分并附证据与修法。
   全部用可复现的规则 + 已付费拿到的数据计算,不调用大模型:同一站点多次运行结果一致,
   每一分都能追溯到证据。规格:docs/design/seo-ranking-score-spec.md
   ============================================================ */

/** 每页的内容质量与用户信号(parse.ts 计算;只存计数、比例与短文本) */
export interface PageContentSignals {
  /** 主体文本词数(去掉 nav / header / footer / aside / script / style) */
  mainWords: number;
  sentences: number;
  paragraphs: number;
  /** Flesch Reading Ease(只对英文页计算,其他语言 null) */
  fleschReadingEase: number | null;
  avgSentenceWords: number;
  avgParagraphWords: number;
  h2Count: number;
  h3Count: number;
  listCount: number;
  orderedListCount: number;
  listItemCount: number;
  tableCount: number;
  /** 正文里的数据点(带单位 / 百分号 / 货币的数字,以及 ≥2 位的数字;不含年份) */
  numberCount: number;
  /** 一手经验表述命中数(we tested / I tried / in our experience / hands-on / we measured …) */
  experienceMarkers: number;
  /** 原始数据表述命中数(our survey / our study / we analyzed N / sample of N / methodology …) */
  originalDataMarkers: number;
  /** AI 套话命中数(delve / in today's fast-paced / unlock the power / game-changer …) */
  aiPhraseHits: number;
  /** 指向权威来源的外链数(.gov / .edu / 官方文档 / 学术 / 维基百科 / 主流媒体) */
  authoritativeOutlinks: number;
  outboundLinks: number;
  /** 正文图片:自托管 vs 图库(pexels / unsplash / shutterstock / istock / getty / adobe stock …) */
  imagesSelfHosted: number;
  imagesStock: number;
  /** 署名 */
  byline: boolean;
  authorName: string | null;
  /** 作者页链接(站内) */
  authorLink: string | null;
  authorInSchema: boolean;
  /** JSON-LD datePublished / dateModified、article:*_time、<time datetime>(ISO 日期) */
  datePublished: string | null;
  dateModified: string | null;
  /** 标题里的年份(如 "Best X in 2023");没有为 null */
  titleYear: number | null;
  /** 正文前 150 词(小写、去标点) */
  leadText: string;
  /** 首段(≤300 字符) */
  firstParagraph: string;
  /** 页面上有 FAQ(FAQPage schema 或 FAQ 标题) */
  hasFaq: boolean;
  /** 正文后半段指向站内其他页的"下一步"链接数 */
  nextStepLinks: number;
  /** 标题党信号命中数 */
  clickbaitHits: number;
  /** 标题承诺的数量("10 ways" → 10);没有承诺为 null */
  titleNumber: number | null;
  /** YMYL 话题命中数(健康 / 金融 / 法律词表) */
  ymylHits: number;
  /** 实体信号 */
  orgName: string | null;
  siteName: string | null;
  titleBrand: string | null;
  sameAsCount: number;
  /** 弹窗 / 遮罩类元素线索 */
  interstitialHints: number;
  /**
   * 整页(含页脚)能找到的联系方式:mailto: / 可见邮箱、tel: / 电话号码、PostalAddress / <address>。
   * 给 quality.authorship 判"Contact 页有没有真实联系方式"用 —— 内容信号不存全文,只能在解析时就判好。
   * 可选:这个字段加得比其余信号晚,旧数据里没有。
   */
  contactDetails?: { email: boolean; phone: boolean; address: boolean };
  /**
   * v4:问句式 H2/H3 数量 —— 以 ? 结尾,或以 what/how/why/when/where/which/who/can/does/do/is/are/should 开头
   * (但 "What we do / How it works" 这类疑问词后紧跟 we/us/our/it 的营销栏目标题不算)。可引用性用
   */
  questionHeadings?: number;
  /** v4:正文里提到的年份(1990–2099,去重升序,≤12 个)—— 判"过时数据"用;相对"今年"的判断在计分时做 */
  bodyYears?: number[];
}

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational" | "local";
export type PageFormat = "definition" | "how-to" | "comparison" | "listicle" | "product" | "pricing" | "local" | "homepage" | "article" | "other";

/** 竞品页(某查询的排名前几名)的可比信号 */
export interface CompetitorPageSignals {
  url: string;
  domain: string;
  position: number;
  title: string;
  h1: string;
  wordCount: number;
  format: PageFormat;
  /** 规范化后的 H2/H3(≤40) */
  headings: string[];
  numbers: number;
  tables: number;
  orderedLists: number;
  images: number;
  fetched: boolean;
  error?: string;
  /* ---- v4 ---- */
  /** 竞品主域权威(backlinks/bulk_ranks,0–1000);没查到为 null */
  domainRank?: number | null;
  /** 竞品页的最后更新日期(ISO 日期;来自其 content 信号) */
  dateModified?: string | null;
  /** UGC / 论坛类域名(reddit / quora / stackexchange …)或 SERP 标为 discussions_and_forums */
  ugc?: boolean;
  /** S13 弱位标记:forum / stale / thin / off-intent / low-authority */
  weakSpots?: string[];
}

/** 一个"查询 ↔ 本站页面"对 */
export interface RelevancePair {
  query: string;
  /** target = 用户自填目标词;ranking = 来自 DataForSEO 排名词;page-topic = 没有排名数据时取页面标题的主题 */
  source: "target" | "ranking" | "page-topic";
  volume: number | null;
  position: number | null;
  intent: SearchIntent;
  intentSource: "dataforseo" | "pattern";
  url: string;
  pageFormat: PageFormat;
  /** 排名前几名的主流形态;没做 SERP 对比为 null */
  serpFormat: PageFormat | null;
  intentMatch: boolean | null;
  /** 0-1:查询核心词在 title / H1 里的覆盖 */
  titleAlignment: number;
  h1Alignment: number;
  /** 查询核心词出现在正文前 150 词 */
  answerEarly: boolean;
  /** 0-1:竞品共有子话题被本页覆盖的比例;没做对比为 null */
  coverage: number | null;
  coveredTopics: string[];
  missingTopics: string[];
  /** 本页有、竞品都没有的子话题 */
  uniqueTopics: string[];
  gainSignals: { uniqueTopics: number; extraNumbers: number; extraTables: number; ownImages: number; experienceMarkers: number };
  competitors: CompetitorPageSignals[];
  /* ---- v4:难度 / SERP 版面 / AI 摘要(来自 Labs 数据与 advanced SERP) ---- */
  kd?: number | null;
  /** Labs 记录的该词 SERP 元素类型 */
  serpItemTypes?: string[];
  /** 本次 live SERP 实际出现的元素类型 */
  serpFeatures?: string[];
  aiOverview?: { present: boolean; loaded: boolean; cited: boolean; references: { domain: string; url: string }[] } | null;
  featuredSnippet?: { domain: string; url: string; own: boolean } | null;
  /** People also ask 问题(≤6) */
  paa?: string[];
  avgTopDomainRank?: number | null;
  rankChange?: { previous: number | null; isNew: boolean; isUp: boolean; isDown: boolean } | null;
  volumeTrend?: { quarterly: number | null; yearly: number | null } | null;
}

export interface RelevanceAnalysis {
  /** ≤8 对,其中 ≤6 对做了 SERP 竞品对比 */
  pairs: RelevancePair[];
  serpCalls: number;
  competitorPagesFetched: number;
  notes: string[];
  /** v4:keyword_overview + bulk_ranks 的调用次数 */
  otherCalls?: number;
  /** v4:本次分析用到的用户目标词(规范化后) */
  targetKeywords?: string[];
}

/* ---------- v4:advanced SERP 快照 / 关键词概览 / 站外声誉 / Search Console ---------- */

export interface SerpSnapshot {
  organic: { url: string; domain: string; position: number; title: string }[];
  /** SERP 里出现的元素类型 */
  itemTypes: string[];
  aiOverview: { present: boolean; loaded: boolean; references: { domain: string; url: string }[] } | null;
  featuredSnippet: { domain: string; url: string } | null;
  /** People also ask 问题(≤6) */
  paa: string[];
  knowledgeGraph: boolean;
  /** 自然结果里带评分的条目(品牌声誉用) */
  ratings: { domain: string; url: string; value: number; votes: number | null }[];
}

export interface KeywordOverview {
  keyword: string;
  volume: number | null;
  kd: number | null;
  intent: string | null;
  serpItemTypes: string[];
  avgTopDomainRank: number | null;
  volumeTrend: { quarterly: number | null; yearly: number | null } | null;
}

/** 站外声誉(reputation.ts;2 次 SERP:品牌词、品牌词 + reviews) */
export interface ReputationAnalysis {
  brandName: string;
  brandQuery: string;
  reviewsQuery: string;
  serpCalls: number;
  /** 品牌词第 1 名是本站;品牌词无法判定(结果为空)为 null */
  ownsBrandSerp: boolean | null;
  brandTop3: boolean;
  knowledgePanel: boolean;
  reviewPlatforms: { domain: string; title: string; rating: { value: number; votes: number | null } | null }[];
  /** 品牌词前 10 里非本站、非社交、非评价平台的独立域名数 */
  independentDomains: number;
  forumMentions: number;
  negativeSignals: number;
  notes: string[];
}

export interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** 该 query 下有曝光的页面数 */
  pages: number;
  brand: boolean;
}

export interface GscPageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Search Console 数据(只在已解锁报告里出现;免费 / 撤销视图恒为 null) */
export interface GscData {
  property: string;
  fetchedAt: string;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number } | null;
  /** 按曝光降序 ≤100 */
  queries: GscQueryRow[];
  /** 按曝光降序 ≤100 */
  pages: GscPageRow[];
  /** 自蚕食:同一 query 下 ≥2 个页面各占 ≥10% 曝光(≤30 条) */
  cannibalized: { query: string; impressions: number; pages: { page: string; clicks: number; impressions: number }[] }[];
  /** 有曝光但 0 点击的页面数 / 有曝光的页面数 */
  zeroClickPages: { count: number; total: number };
  notes: string[];
}

export type PillarId = "relevance" | "quality" | "authority" | "winnability" | "aisearch" | "behavior" | "technical";
export type SiteProfileId = "default" | "ecommerce" | "local" | "ymyl";

/** 站点类型(ranking.ts detectSiteProfile):决定支柱权重;UI 显示 "Scored as: …" */
export interface SiteProfile {
  id: SiteProfileId;
  label: string;
  /** 一句话:为什么判成这种站 */
  reason: string;
  weights: Record<PillarId, number>;
}
/** measured = 直接数据;estimated = 基于页面文本的规则估计;proxy = 用页面特征代理 Google 不公开的行为数据 */
export type SignalConfidence = "measured" | "estimated" | "proxy";

export interface SubScore {
  /** 例:"quality.experience" */
  id: string;
  pillar: PillarId;
  label: string;
  /** 0-100;拿不到数据为 null(不进加权) */
  score: number | null;
  weight: number;
  confidence: SignalConfidence;
  /** 一句话结论(随分数高低写成达标句或问题句) */
  summary: string;
  evidence: string[];
  fixes: string[];
}

export interface PillarScore {
  id: PillarId;
  label: string;
  role: string;
  weight: number;
  score: number | null;
  grade: "A" | "B" | "C" | "D" | "F" | null;
  summary: string;
  subs: SubScore[];
}

export interface RankingFramework {
  /** 1 = 5 支柱 25 小维度(2026-10-01);2 = 7 支柱 40 小维度 + 站点类型权重(2026-10-02) */
  version: 1 | 2;
  overall: { score: number; grade: "A" | "B" | "C" | "D" | "F"; capped: boolean; note: string };
  pillars: PillarScore[];
  basis: {
    pagesAnalyzed: number;
    contentPages: number;
    queries: { query: string; url: string; position: number | null; volume: number | null; intent: SearchIntent; source?: "target" | "ranking" | "page-topic" }[];
    competitorsCompared: number;
    /** v4 */
    targetKeywords?: string[];
    gscConnected?: boolean;
    /** v4:主题聚焦用到的 sitemap 统计(接入 / 断开 Search Console 时不重抓也能确定性地重算) */
    sitemapFocus?: { considered: number; offTopic: number; examples: string[] };
  };
  /** 查询 / 竞品对比明细(付费可见) */
  relevance: RelevanceAnalysis | null;
  /** v4:站点类型与本次使用的支柱权重 */
  profile?: SiteProfile;
  notes: string[];
}

/** 支柱定义:标签、作用、默认权重(default 站点类型;其他类型见 SITE_PROFILE_WEIGHTS) */
export const RANKING_PILLARS: Record<PillarId, { label: string; role: string; weight: number }> = {
  relevance: { label: "Relevance & search intent", role: "Decides whether you can rank at all", weight: 25 },
  quality: { label: "Content quality (E-E-A-T)", role: "Decides whether rankings survive core updates", weight: 20 },
  authority: { label: "Authority, links & reputation", role: "Decides who wins among similar pages", weight: 20 },
  winnability: { label: "Winnability", role: "Decides whether these are fights you can win", weight: 10 },
  aisearch: { label: "AI search & clicks", role: "Decides whether a ranking still earns the visit", weight: 10 },
  behavior: { label: "User satisfaction", role: "Validates the result — measured with Search Console, estimated without it", weight: 10 },
  technical: { label: "Technical foundation", role: "The threshold — failing it voids everything else", weight: 5 },
};

export const PILLAR_IDS: readonly PillarId[] = ["relevance", "quality", "authority", "winnability", "aisearch", "behavior", "technical"];

/** 站点类型 → 支柱权重(每列合计 100;规格 v2 §1) */
export const SITE_PROFILE_WEIGHTS: Record<SiteProfileId, { label: string; weights: Record<PillarId, number> }> = {
  default: {
    label: "Business, SaaS or publisher site",
    weights: { relevance: 25, quality: 20, authority: 20, winnability: 10, aisearch: 10, behavior: 10, technical: 5 },
  },
  ecommerce: {
    label: "Online store",
    weights: { relevance: 25, quality: 15, authority: 20, winnability: 10, aisearch: 5, behavior: 10, technical: 15 },
  },
  local: {
    label: "Local business",
    weights: { relevance: 20, quality: 15, authority: 25, winnability: 10, aisearch: 5, behavior: 10, technical: 15 },
  },
  ymyl: {
    label: "Health, finance or legal site",
    weights: { relevance: 20, quality: 30, authority: 20, winnability: 10, aisearch: 5, behavior: 10, technical: 5 },
  },
};

/** 站点类型对个别小维度权重的覆盖(其余小维度按比例压缩):本地商家的站外评价占大头 */
export const SITE_PROFILE_SUB_WEIGHTS: Partial<Record<SiteProfileId, Record<string, number>>> = {
  local: { "authority.reputation": 25 },
};

/** 小维度定义(免费版锁定预告与方法论页也用它,所以放在类型层)。v2:40 个 */
export const RANKING_SUBS: { id: string; pillar: PillarId; label: string; weight: number; confidence: SignalConfidence }[] = [
  { id: "relevance.intent", pillar: "relevance", label: "Search intent match", weight: 25, confidence: "estimated" },
  { id: "relevance.coverage", pillar: "relevance", label: "Semantic coverage", weight: 25, confidence: "estimated" },
  { id: "relevance.gain", pillar: "relevance", label: "Information gain", weight: 20, confidence: "estimated" },
  { id: "relevance.alignment", pillar: "relevance", label: "Title, H1 & answer-first", weight: 15, confidence: "measured" },
  { id: "relevance.cannibalization", pillar: "relevance", label: "One page per intent", weight: 15, confidence: "estimated" },
  { id: "quality.experience", pillar: "quality", label: "First-hand experience", weight: 22, confidence: "estimated" },
  { id: "quality.data", pillar: "quality", label: "Original data & verifiable sources", weight: 18, confidence: "estimated" },
  { id: "quality.authorship", pillar: "quality", label: "Authorship & trust pages", weight: 18, confidence: "measured" },
  { id: "quality.freshness", pillar: "quality", label: "Freshness", weight: 12, confidence: "measured" },
  { id: "quality.scaled", pillar: "quality", label: "Scaled-content risk", weight: 18, confidence: "estimated" },
  { id: "quality.sources", pillar: "quality", label: "Citation health", weight: 12, confidence: "measured" },
  { id: "authority.editorial", pillar: "authority", label: "Editorial link quality", weight: 18, confidence: "measured" },
  { id: "authority.breadth", pillar: "authority", label: "Link authority & breadth", weight: 18, confidence: "measured" },
  { id: "authority.linkprofile", pillar: "authority", label: "Link profile health", weight: 10, confidence: "measured" },
  { id: "authority.clusters", pillar: "authority", label: "Topic clusters", weight: 10, confidence: "measured" },
  { id: "authority.focus", pillar: "authority", label: "Topical focus", weight: 12, confidence: "estimated" },
  { id: "authority.internal", pillar: "authority", label: "Internal links to core pages", weight: 10, confidence: "measured" },
  { id: "authority.entity", pillar: "authority", label: "Brand & entity signals", weight: 8, confidence: "estimated" },
  { id: "authority.reputation", pillar: "authority", label: "Off-site reputation", weight: 14, confidence: "measured" },
  { id: "winnability.serpweakness", pillar: "winnability", label: "Weak spots in the top 5", weight: 30, confidence: "measured" },
  { id: "winnability.difficulty", pillar: "winnability", label: "Difficulty fit", weight: 25, confidence: "measured" },
  { id: "winnability.gap", pillar: "winnability", label: "Authority gap vs. ranking sites", weight: 20, confidence: "measured" },
  { id: "winnability.striking", pillar: "winnability", label: "Striking-distance keywords", weight: 10, confidence: "measured" },
  { id: "winnability.momentum", pillar: "winnability", label: "Ranking momentum", weight: 15, confidence: "measured" },
  { id: "aisearch.overview", pillar: "aisearch", label: "AI Overview presence & citations", weight: 30, confidence: "measured" },
  { id: "aisearch.crawlers", pillar: "aisearch", label: "AI crawler access", weight: 20, confidence: "measured" },
  { id: "aisearch.citability", pillar: "aisearch", label: "Citability of your content", weight: 25, confidence: "estimated" },
  { id: "aisearch.zeroclick", pillar: "aisearch", label: "Click opportunity on your SERPs", weight: 25, confidence: "measured" },
  { id: "behavior.realuser", pillar: "behavior", label: "Real-user experience (Chrome data)", weight: 25, confidence: "measured" },
  { id: "behavior.ctr", pillar: "behavior", label: "Click-through vs. expected (Search Console)", weight: 25, confidence: "measured" },
  { id: "behavior.task", pillar: "behavior", label: "Task completion: answer-first & next step", weight: 20, confidence: "proxy" },
  { id: "behavior.readability", pillar: "behavior", label: "Readability & scannability", weight: 15, confidence: "proxy" },
  { id: "behavior.promise", pillar: "behavior", label: "Title promise integrity", weight: 15, confidence: "proxy" },
  // 技术支柱 = 免费版的 Technical SEO score:7 个小维度一一对应现有 7 个站内维度,权重相同,
  // 支柱分直接取免费技术分(含致命项封顶),两处永远是同一个数字。
  { id: "technical.crawl", pillar: "technical", label: "Crawl & index", weight: 25, confidence: "measured" },
  { id: "technical.onpage", pillar: "technical", label: "On-page basics", weight: 20, confidence: "measured" },
  { id: "technical.cwv", pillar: "technical", label: "Core Web Vitals", weight: 15, confidence: "measured" },
  { id: "technical.mobile", pillar: "technical", label: "Mobile usability", weight: 10, confidence: "measured" },
  { id: "technical.https", pillar: "technical", label: "HTTPS & trust", weight: 10, confidence: "measured" },
  { id: "technical.structure", pillar: "technical", label: "Site structure", weight: 10, confidence: "measured" },
  { id: "technical.schema", pillar: "technical", label: "Structured data", weight: 10, confidence: "measured" },
];
