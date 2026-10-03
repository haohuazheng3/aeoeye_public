/* ============================================================
   SEO Audit · 相关性 / 搜索意图(SEO Ranking Score 的数据层;v2 规格 2026-10-02)

   回答"这一页能不能排上这个查询、这一仗打不打得赢"。不调用大模型:全部用可复现的规则 + 与该查询
   排名前 5 的真实页面逐项对比来量化(规格:docs/design/seo-ranking-score-spec.md §3 与 v2 §3.4)。

   流程:
     1. 选"查询 ↔ 本站页面"对(≤8):先是用户自填的目标词(≤3,source = "target";排名词里有同词就用它的
        URL,否则取标题 / H1 / 开头与之最贴合的页,一个都不贴合就退到首页并写明"没有页面在针对这个词");
        再是排名词(非品牌词优先、搜索量降序、每个 URL 一个);不足 3 对时补"页面自身主题"
        (首页 + 入链最多的内容页,查询 = H1 或去品牌后的标题)。
     2. 目标词(排名数据里没有的)与页面主题词过一次 keyword_overview:量 / 难度 / 意图 / SERP 元素;
        排名词的这些数据 ranked_keywords 本来就带了,不再花钱。
     3. 前 6 对做 SERP 对比(advanced:同价,多拿 AI 摘要 / 精选摘要 / PAA;只有 Labs 显示有 AI 摘要的词
        才多花 $0.002 加载摘要正文),排除本站,取前 5 个竞品页,用自家爬虫抓(先看该主机 robots.txt;
        safeFetch 的 SSRF 防线;8 秒 / 2 MB;并发 4;同主机间隔 250 ms,Crawl-delay ≤2 秒照做),
        H2/H3 规范化后比子话题覆盖、独有子话题、数据点 / 表格 / 自有图片 / 一手经验。
     4. 竞品域名(去重 ≤30)调一次 bulk_ranks 拿主域权威,并给每个竞品标 S13 弱位
        (论坛帖 / 过时 / 薄内容 / 答非所问 / 低权威)—— 可赢性支柱的原料。
     5. 重跑(给了 reuse 且不是付费刷新)沿用上次的查询、竞品 URL、SERP 版面与竞品权威:零 SERP(每次都是真钱),
        只有新加的目标词例外(SERP + 一次 keyword_overview,其竞品里上次没出现过的主域再补一次 bulk_ranks);
        用户删掉的目标词不再分析。
        竞品页重新抓 —— 页面会变,对比要用现在的页面。

   永不抛:任何失败都写进 notes;时间预算用完就停手,已完成的部分照常返回。
   ============================================================ */

import { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, safeFetch, type FetchResult, type SafeFetchOptions } from "./fetch";
import { detectBlock, fetchRobots, hasNonHtmlExtension, isHtmlResponse, MIN_HOST_INTERVAL_MS, politeIntervalFor, type Fetcher } from "./crawl";
import { clipText, pageTypeFor, parsePageDetailed } from "./parse";
import { DEFAULT_UA, emptyRobots, isPathAllowed, type RobotsRules } from "./robots";
import { dedupeKey, registrableDomain } from "./url";
import type {
  CompetitorPageSignals,
  CrawledPage,
  KeywordOverview,
  PageContentSignals,
  PageFormat,
  RankedKeyword,
  RelevanceAnalysis,
  RelevancePair,
  SearchIntent,
  SerpSnapshot,
  VisibilityResult,
} from "./types";

/* ---------- 契约 ---------- */

/** 取某个查询的 advanced SERP(生产 = dataforseo.fetchSerpAdvanced;测试注入假的) */
export type SerpFn = (keyword: string, opts?: { loadAiOverview?: boolean }) => Promise<SerpSnapshot>;
/** 一次 Labs keyword_overview(≤10 个词;生产 = dataforseo.fetchKeywordOverview) */
export type KeywordOverviewFn = (keywords: string[]) => Promise<KeywordOverview[]>;
/** 一次 backlinks/bulk_ranks(≤30 个主域,结果按传入的字符串为键;生产 = dataforseo.fetchBulkRanks) */
export type BulkRanksFn = (domains: string[]) => Promise<Record<string, number | null>>;

export interface RelevanceInput {
  domain: string;
  origin: string;
  host: string;
  pages: CrawledPage[];
  visibility: VisibilityResult | null;
  /** 重跑时复用上次的查询、竞品 URL 与 SERP 版面,不再调 SERP(新加的目标词除外) */
  reuse?: RelevanceAnalysis | null;
  /** 付费刷新时为 true:不沿用 reuse,重新调 SERP */
  refreshSerp?: boolean;
  budgetMs: number;
  /** v4:用户自填的目标词(≤3;集成方已规范化,这里再防御性地规范一次)。重跑时不在其中的旧目标词对会被丢掉 */
  targetKeywords?: string[];
  /** 默认 8 */
  maxPairs?: number;
  /** 默认 6 */
  maxSerpQueries?: number;
  /** 默认 5 */
  competitorsPerQuery?: number;
  /* ---- 测试注入用(生产代码不要传) ---- */
  /** 替代 safeFetch */
  fetcher?: Fetcher;
  /**
   * 替代 fetchSerpAdvanced。三个 DataForSEO 注入(serpFn / keywordOverviewFn / bulkRanksFn)给了任意一个,
   * 就不再 import dataforseo:没注入的那几个一律视为不可用 —— 测试绝不会漏网去打付费接口。
   */
  serpFn?: SerpFn;
  /** 替代 fetchKeywordOverview */
  keywordOverviewFn?: KeywordOverviewFn;
  /** 替代 fetchBulkRanks */
  bulkRanksFn?: BulkRanksFn;
  /** 替代 parsePageDetailed(测试里用来固定内容信号) */
  parse?: typeof parsePageDetailed;
  /** 同主机请求间隔下限(默认 250 ms;测试设 0) */
  minIntervalMs?: number;
  /** 替代 Date.now(预算判定与"过时"判定用的时钟;测试里用假时钟模拟"预算耗尽",不必真等) */
  now?: () => number;
}

/* ---------- 常量 ---------- */

/** v2:≤8 对(目标词 ≤3 + 排名词 + 页面主题词) */
export const DEFAULT_MAX_PAIRS = 8;
/** v2:前 6 对做 SERP 对比(/bot 页按 DEFAULT_MAX_SERP × DEFAULT_COMPETITORS 公开竞品页抓取上限) */
export const DEFAULT_MAX_SERP = 6;
export const DEFAULT_COMPETITORS = 5;
/** 不足这个数的对时补页面主题词(规格 v2 §3.4) */
const MIN_PAIRS = 3;
const MAX_TARGET_KEYWORDS = 3;
const MAX_TARGET_CHARS = 80;
/** keyword_overview 一次最多 10 个词(规格 v2 §3.3) */
const OVERVIEW_MAX_KEYWORDS = 10;
/** bulk_ranks 一次最多 30 个主域(规格 v2 §3.4) */
const BULK_RANKS_MAX_DOMAINS = 30;
/** keyword_overview / bulk_ranks 发出前至少要剩的时间:剩得更少就不花这笔钱 */
const MIN_OTHER_CALL_MS = 3_000;
/** 关键词概览最多等多久:它后面还排着 SERP 与竞品抓取 */
const OVERVIEW_WAIT_MS = 20_000;
/** S13 弱位阈值(规格 v2 §4 winnability.serpweakness) */
const STALE_MONTHS = 18;
const THIN_WORDS = 500;
const LOW_AUTHORITY_RANK = 100;
const OFF_INTENT_OVERLAP = 1 / 3;
/** SERP 快照各数组的上限(落库的是 jsonb,不能无界) */
const MAX_SERP_TYPES = 40;
const MAX_AI_REFERENCES = 10;
const MAX_PAA = 6;
const MAX_RATINGS = 20;
const MAX_URL_CHARS = 2_000;
/** SERP 取 1 页(10 条):DataForSEO 按页计费 */
const SERP_DEPTH = 10;
/** 与 /bot 页公开的单页上限同源(fetch.ts 的默认值:8 秒、2 MB) */
const PAGE_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
const PAGE_MAX_BYTES = DEFAULT_MAX_BYTES;
/** 与 /bot 页 "At most 4 requests in flight" 一致 */
export const CONCURRENCY = 4;
/** 剩余时间不够一次像样的请求就不再发 —— 发了也只会超时,还占对方一个连接 */
const MIN_FETCH_MS = 1_000;
/**
 * 剩余时间不到这个数就不开 SERP:live SERP 本身要几秒,拿回来后还得有时间抓竞品页,
 * 否则这笔钱花了却换不来任何对比。
 */
const MIN_SERP_BUDGET_MS = 10_000;
/** 排名 URL(含目标词对上的排名页)不在抓取集合里时单独抓的上限(失败会顺延到下一个词,这里防止一路抓下去) */
export const MAX_TARGET_FETCHES = 8;
const MAX_HEADINGS_PER_PAGE = 40;
const MAX_TOPICS = 10;
const MAX_QUERY_WORDS = 8;
const MAX_QUERY_CHARS = 120;
const CONTENT_MIN_WORDS = 300;
/** 两个标题的词集合 Jaccard ≥ 0.5 视为同一子话题(规格 §3.5) */
const SAME_TOPIC_JACCARD = 0.5;
/** 竞品共有子话题少于 3 个时样本太少,coverage 记 null(规格 §3.6) */
const MIN_SHARED_TOPICS = 3;
const BUDGET_SKIP = "Skipped: time budget reached";

/* ============================================================
   文本工具:分词、停用词、复数词干、Jaccard
   ============================================================ */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "of", "in", "on", "at", "to", "for", "from", "by", "with",
  "without", "about", "into", "onto", "over", "under", "after", "before", "between", "through", "during", "per", "via",
  "vs", "versus", "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "doing", "done", "have",
  "has", "had", "having", "will", "would", "shall", "should", "can", "could", "may", "might", "must", "it", "its", "this",
  "that", "these", "those", "there", "here", "what", "whats", "which", "who", "whom", "whose", "why", "how", "hows", "when",
  "where", "i", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "yours", "youre", "he", "him", "his", "she",
  "her", "hers", "they", "them", "their", "theirs", "as", "if", "than", "then", "also", "just", "very", "too", "more",
  "most", "much", "many", "any", "all", "each", "every", "some", "such", "own", "same", "other", "others", "not", "no",
  "only", "up", "down", "out", "off", "again", "further", "once", "dont", "doesnt", "isnt", "arent", "cant", "wont",
  "didnt", "lets", "really", "even", "still", "like",
  // URL 碎片:"aeoeye.com" 拆出来的 com 不是话题词
  "com", "www", "net", "org", "io", "co", "http", "https",
]);

/** 不做复数词干的词(news ≠ new,saas ≠ saa) */
const STEM_EXCEPTIONS = new Set(["news", "series", "species", "ios", "macos", "windows", "less", "mass", "always", "saas", "paas", "iaas"]);

/** 纯数字、序数、年代("2026"、"1st"、"1990s")—— 子话题比较时去掉(规格:去数字、去年份) */
const NUMERIC_TOKEN = /^\d+(?:st|nd|rd|th|s)?$/;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 小写、去撇号("google's" → googles)、按字母数字串切分 */
function tokenize(text: string): string[] {
  return ((text ?? "").toLowerCase().replace(/['’]/g, "").match(/[\p{L}\p{N}]+/gu) ?? []) as string[];
}

/** 只处理复数(规格 §3.5"词干化简单处理复数"):tools → tool,companies → company,boxes → box */
function stem(t: string): string {
  if (t.length <= 3 || STEM_EXCEPTIONS.has(t)) return t;
  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (/(?:xes|ches|shes|zzes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

function stemmedSet(text: string): Set<string> {
  return new Set(tokenize(text).map(stem));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function clampInt(v: number | undefined, dflt: number, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return clipText(collapse(msg), 200) || "unknown error";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return "/";
  }
}

/** 本站(含子域名:blog.example.com 也是 example.com 的页面) */
function isOwnHost(hostname: string, domain: string): boolean {
  const h = registrableDomain(hostname);
  return !!domain && (h === domain || h.endsWith(`.${domain}`));
}

/* ============================================================
   品牌词
   ============================================================ */

/** 二级公共后缀(co.uk / com.au …)下品牌标签在倒数第三段 —— 与 dataforseo.ts 同一口径 */
const SECOND_LEVEL_SUFFIX = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

function brandLabel(domain: string): string {
  const parts = registrableDomain(domain).split(".").filter(Boolean);
  if (parts.length >= 3 && SECOND_LEVEL_SUFFIX.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? "";
}

const compactOf = (s: string): string => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * 品牌词 = 域名主体(aeoeye.com → aeoeye)+ 首页实体名(Organization / og:site_name / 标题品牌段)
 * 去空格后的紧凑形式 —— 只收与域名主体相互包含的那些("Jobber" ↔ getjobber.com),
 * 否则 og:site_name = "Blog" 这类通用名会把所有含 blog 的查询都判成品牌词。
 * 不 import dataforseo.ts 的同名逻辑:那会把 @/lib/env 的导入期校验带进纯函数测试。
 */
function brandTokensFor(domain: string, pages: CrawledPage[]): string[] {
  const label = compactOf(brandLabel(domain));
  const out = new Set<string>();
  if (label.length >= 3) out.add(label);
  const home = pages.find((p) => p.depth === 0) ?? pages.find((p) => p.pageType === "home");
  const names = [home?.content?.orgName, home?.content?.siteName, home?.content?.titleBrand, home?.og?.["og:site_name"]];
  for (const n of names) {
    const c = compactOf(n ?? "");
    if (c.length < 3 || c.length > 40 || label.length < 3) continue;
    if (c === label || label.includes(c) || c.includes(label)) out.add(c);
  }
  return [...out];
}

function isBrandQuery(q: string, brands: string[]): boolean {
  const k = (q ?? "").toLowerCase();
  const compact = compactOf(k);
  return brands.some((b) => b.length >= 3 && (k.includes(b) || compact.includes(b)));
}

/** 去掉品牌词:单个 token 含品牌,或相邻 2–3 个 token 拼起来正好是品牌("aeo eye" → aeoeye) */
function dropBrandTokens(tokens: string[], brands: string[]): string[] {
  const valid = brands.map(compactOf).filter((b) => b.length >= 3);
  if (!valid.length) return tokens;
  const drop = new Array<boolean>(tokens.length).fill(false);
  for (let i = 0; i < tokens.length; i += 1) {
    if (drop[i]) continue;
    for (let n = 3; n >= 1; n -= 1) {
      if (i + n > tokens.length) continue;
      const joined = tokens.slice(i, i + n).join("");
      const hit = n === 1 ? valid.some((b) => joined.includes(b)) : valid.includes(joined);
      if (hit) {
        for (let k = i; k < i + n; k += 1) drop[k] = true;
        break;
      }
    }
  }
  return tokens.filter((_, i) => !drop[i]);
}

/**
 * 查询核心词:去停用词、去品牌、复数词干、去重(规格 §3.9)。返回词干形式 ——
 * 与标题 / H1 / 正文前 150 词比较时两边都做同样的词干处理。
 */
export function coreTokens(query: string, brandTokens: string[]): string[] {
  const kept = dropBrandTokens(tokenize(query), brandTokens);
  const out: string[] = [];
  for (const t of kept) {
    if (STOPWORDS.has(t) || t.length < 2) continue;
    const s = stem(t);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/* ============================================================
   搜索意图(规格 §3.2)
   ============================================================ */

/** 美国人口前 50 的城市(2020 人口普查)+ nyc —— 查询里出现即按 local 处理 */
const US_CITIES = [
  "new york", "nyc", "los angeles", "chicago", "houston", "phoenix", "philadelphia", "san antonio", "san diego", "dallas",
  "jacksonville", "austin", "fort worth", "san jose", "columbus", "charlotte", "indianapolis", "san francisco", "seattle",
  "denver", "oklahoma city", "nashville", "washington", "el paso", "las vegas", "boston", "detroit", "portland",
  "louisville", "memphis", "baltimore", "milwaukee", "albuquerque", "tucson", "fresno", "sacramento", "mesa", "atlanta",
  "kansas city", "colorado springs", "omaha", "raleigh", "miami", "virginia beach", "long beach", "oakland",
  "minneapolis", "bakersfield", "tulsa", "tampa", "arlington",
];

// 在"空格包裹的规范化 token 串"上匹配,词边界就是空格
const COMMERCIAL_RE = / (?:vs|versus|best|top|review|reviews|alternative|alternatives|compare|comparison|comparisons|comparing) /;
const TRANSACTIONAL_RE = / (?:price|prices|pricing|cost|costs|buy|buying|coupon|coupons|discount|discounts|free trial) /;
const LOCAL_RE = new RegExp(` (?:near me|${US_CITIES.join("|")}) `);
const INFORMATIONAL_RE =
  / (?:what (?:is|are|does)|whats|how (?:to|do|does|can)|why|guide|guides|meaning|definition|define|tutorial|tutorials|explained) /;
/** 品牌词之外只剩这些修饰时仍算导航("aeoeye login") */
const NAV_MODIFIERS = new Set(["login", "log", "signin", "sign", "app", "website", "site", "official", "homepage", "home", "account", "dashboard"]);

/**
 * 按模式判意图。matched = 模式真的命中;false 表示是兜底猜的(含品牌 → navigational,否则 informational),
 * 这时意图匹配交给 SERP 的主流形态去判,没有 SERP 就不判(见 judgeIntent)。
 */
function classifyIntent(q: string, brands: string[]): { intent: SearchIntent; matched: boolean } {
  const text = ` ${tokenize(q).join(" ")} `;
  const branded = isBrandQuery(q, brands);
  if (branded && coreTokens(q, brands).every((t) => NAV_MODIFIERS.has(t))) return { intent: "navigational", matched: true };
  if (COMMERCIAL_RE.test(text)) return { intent: "commercial", matched: true };
  if (TRANSACTIONAL_RE.test(text)) return { intent: "transactional", matched: true };
  if (LOCAL_RE.test(text)) return { intent: "local", matched: true };
  if (INFORMATIONAL_RE.test(text)) return { intent: "informational", matched: true };
  return { intent: branded ? "navigational" : "informational", matched: false };
}

/** 规格 §3.2 的模式意图:vs/best/top/review/alternative/compare → commercial;price/cost/buy… → transactional;near me / 城市 → local;what is / how to / why / guide … → informational;只有品牌名 → navigational */
export function intentFromQuery(q: string, brandTokens: string[]): SearchIntent {
  return classifyIntent(q, brandTokens).intent;
}

const SEARCH_INTENTS: SearchIntent[] = ["informational", "commercial", "transactional", "navigational", "local"];

function dfsIntent(v: string | null | undefined): SearchIntent | null {
  const s = (v ?? "").trim().toLowerCase();
  return (SEARCH_INTENTS as string[]).includes(s) ? (s as SearchIntent) : null;
}

/* ============================================================
   页面形态(规格 §3.3)
   ============================================================ */

const VS_TITLE = /(?:^|\s)(?:vs\.?|versus)(?=\s|$)/i;
const COMPARE_TITLE = /\bcompar(?:e|es|ed|ing|ison|isons)\b/i;
const LIST_NOUNS =
  "best|top|ways?|tips?|tools?|examples?|ideas?|reasons?|things?|steps?|mistakes?|alternatives?|apps?|sites?|websites?|platforms?|software|strateg(?:y|ies)|tactics?|questions?|signs?|types?|trends?|myths?|hacks?|tricks?|methods?|options?|resources?|templates?|books?|courses?|plugins?|extensions?|companies|agencies|brands?|products?|places?|restaurants?|features?|benefits?|services?|providers?";
/** "Best X" / "Top 10 X" / "10 best X" / "7 proven ways …":数字限 1–3 位,年份("2026 trends")不算 */
const LISTICLE_TITLE = new RegExp(
  `^(?:the\\s+)?(?:\\d{1,3}\\+?\\s+)?(?:best|top)\\b|\\btop\\s+\\d{1,3}\\b|(?:^|[^\\d])\\d{1,3}\\+?\\s+(?:[a-z0-9-]+\\s+){0,2}(?:${LIST_NOUNS})\\b`,
  "i"
);
const HOW_TO_TITLE = /\bhow\s+to\b/i;
const DEFINITION_TITLE = /\bwhat\s+(?:is|are)\b|\bwhat['’]s\b|\bmeaning\b|\bdefinition\b/i;
/** "X is a …" 形式的首段;代词 / 介词开头的句子("This is the …"、"We are a …")不算 */
const DEFINITION_SUBJECT_STOP =
  /^(?:this|that|it|we|you|they|there|here|these|those|i|he|she|our|your|my|his|her|its|their|what|which|who|how|why|when|where|if|in|on|at|for|with|as|so|but|and|or|because|while|whether|today|now|every|each|all|some|most|many|no|one)\b/i;
const DEFINITION_LEAD =
  /^([^.!?:;]{2,80}?)\s+(?:is|are|refers to|means|describes)\s+(?:a|an|the|one|any|how|when|what|defined|used|simply|basically|essentially)\b/i;
const PRODUCT_TYPES = new Set(["product", "productgroup", "individualproduct", "productmodel"]);
const LOCAL_TYPES = new Set(
  [
    "LocalBusiness", "Restaurant", "FoodEstablishment", "Store", "AutoRepair", "AutomotiveBusiness", "Dentist", "MedicalBusiness",
    "MedicalClinic", "Physician", "LegalService", "Attorney", "RealEstateAgent", "HomeAndConstructionBusiness", "ProfessionalService",
    "LodgingBusiness", "Hotel", "HealthAndBeautyBusiness", "BeautySalon", "DaySpa", "FinancialService", "AccountingService",
    "InsuranceAgency", "EntertainmentBusiness", "SportsActivityLocation", "ChildCare", "DryCleaningOrLaundry", "EmploymentAgency",
    "TravelAgency", "Plumber", "Electrician", "Locksmith", "HVACBusiness", "RoofingContractor", "GeneralContractor",
    "MovingCompany", "BarOrPub", "CafeOrCoffeeShop", "Bakery", "FastFoodRestaurant", "Optician", "Pharmacy", "VeterinaryCare",
    "Notary", "SelfStorage", "ShoppingCenter", "HairSalon", "NailSalon", "GasStation", "ExerciseGym",
  ].map((t) => t.toLowerCase())
);
const US_PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;
const STREET_ADDRESS =
  /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway)\b/;

/** classifyFormat 只需要这些字段:SERP 结果(只有标题和 URL)也能按同一套规则估形态 */
export type FormatInput = Pick<CrawledPage, "url" | "title"> &
  Partial<Pick<CrawledPage, "finalUrl" | "h1s" | "headings" | "jsonLdTypes" | "pageType" | "content" | "textSample">>;

function isRootPath(page: FormatInput): boolean {
  return pathOf(page.finalUrl || page.url) === "/";
}

function isListicleTitle(title: string): boolean {
  return LISTICLE_TITLE.test(title);
}

function definitionSentence(firstParagraph: string): boolean {
  const s = collapse(firstParagraph ?? "");
  if (!s || DEFINITION_SUBJECT_STOP.test(s)) return false;
  const m = DEFINITION_LEAD.exec(s);
  return !!m && m[1].trim().split(/\s+/).length <= 8;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 首段形如 "X is …"(规格 §3.3)。实测补充(2026-10-01 冒烟):内容信号里的 firstParagraph 常常是
 * 站点外壳("From Wikipedia, the free encyclopedia"、"Skip to main content"),于是再看开头有没有
 * "标题主题 … is / are / refers to / means + 冠词"—— 页面在开头给自己的主题下定义,就是定义页:
 *  · textSample(主体文本前 400 字符,保留标点):主题与系动词在同一句里,中间可以隔一段同位语
 *    ("Generative engine optimization (GEO), also known as …, is the practice …"),但不能隔着
 *    which / that / who(那是从句修饰,"… audit, which is the fastest way" 不是定义);
 *  · leadText(前 150 词,无标点):主题后至多隔 2 个词就是系动词(缩写 "seo is the …")。
 */
function looksLikeDefinition(page: FormatInput): boolean {
  if (definitionSentence(page.content?.firstParagraph ?? "")) return true;
  const topic = tokenize(longestTitleSegment(page.title || page.h1s?.[0] || "")).slice(0, 6);
  if (!topic.length) return false;
  const sample = collapse(page.textSample ?? "");
  if (sample) {
    const re = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${topic.map(escapeRe).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])([^.!?]{0,160}?)\\s(?:is|are|refers to|means|describes)\\s+(?:a|an|the|one|any)\\b`,
      "iu"
    );
    const m = re.exec(sample);
    if (m && !/\b(?:which|that|who|whom|whose|where|when|while|if)\b/i.test(m[1])) return true;
  }
  const lead = page.content?.leadText;
  if (!lead) return false;
  const leadRe = new RegExp(`(?:^| )${topic.map(escapeRe).join(" ")}(?: [\\p{L}\\p{N}]+){0,2} (?:is|are|refers to|means|describes) (?:a|an|the|one|any)(?: |$)`, "u");
  return leadRe.test(tokenize(lead).slice(0, 60).join(" "));
}

/** 标题按 " | " " · " " — " " – " " - " ": " 切段(品牌后缀、栏目名通常在这些分隔符之后) */
function titleSegments(title: string): string[] {
  return collapse(title ?? "")
    .split(/\s+[|\-–—·]\s+|\s*[|·]\s*|:\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 最长的一段("Search engine optimization - Wikipedia" → 前者) */
function longestTitleSegment(title: string): string {
  return [...titleSegments(title)].sort((a, b) => b.length - a.length)[0] ?? "";
}

function looksLocal(page: FormatInput): boolean {
  const text = `${page.textSample ?? ""} ${page.content?.firstParagraph ?? ""}`;
  return US_PHONE.test(text) && STREET_ADDRESS.test(text);
}

/**
 * 页面形态(规格 §3.3 的规则与形态全部照用):vs / 对比表 → comparison;best / top N / N 个 … 或
 * (≥8 个列表项且 ≥5 个 H2)→ listicle;how to 或(有序列表且 ≥3 个 H2)→ how-to;what is / meaning /
 * definition 或首段 "X is …" → definition;pricing 页 → pricing;Product schema → product;
 * LocalBusiness schema 或地址 + 电话 → local;路径 "/" → homepage;文章页 → article;其余 other。
 *
 * 偏离规格的地方是**先后顺序**(为什么):规格把"列表项 / 有序列表 + H2 个数"这类结构信号排在
 * 定价 / 产品 / 首页之前。实测(2026-10-01 冒烟)它们误判得很厉害:维基百科条目的参考文献是一个
 * 上百项的有序列表 → 被判成 listicle / how-to;SaaS 首页的 "How it works" 编号步骤 → how-to,
 * 导航词就永远"意图不匹配"。所以按信号强弱分两轮:
 *   强信号(标题、开头下定义、URL / schema)按规格顺序先判;
 *   弱信号(列表结构)只在强信号都没中时才判,排在 homepage 之后、article 之前。
 * "开头下定义"同样不作用于首页 / 定价页 / 产品页("AEOeye is a …" 是品牌介绍,不是定义页)。
 * 内容信号(page.content)缺失时,结构类规则整条跳过;开头定义只剩 textSample 一条路可判。
 */
export function classifyFormat(page: FormatInput): PageFormat {
  const title = collapse(page.title || page.h1s?.[0] || "");
  const c = page.content;
  const types = (page.jsonLdTypes ?? []).map((t) => t.toLowerCase());
  const h2 = c?.h2Count ?? (page.headings ?? []).filter((h) => h.level === 2).length;
  const root = isRootPath(page);
  const editorial = !(root || page.pageType === "home" || page.pageType === "pricing" || page.pageType === "product");

  // 第一轮:强信号
  if (VS_TITLE.test(title) || ((c?.tableCount ?? 0) >= 1 && COMPARE_TITLE.test(title))) return "comparison";
  if (isListicleTitle(title)) return "listicle";
  if (HOW_TO_TITLE.test(title)) return "how-to";
  if (DEFINITION_TITLE.test(title) || (editorial && looksLikeDefinition(page))) return "definition";
  if (page.pageType === "pricing") return "pricing";
  if (page.pageType === "product" || types.some((t) => PRODUCT_TYPES.has(t))) return "product";
  if (types.some((t) => LOCAL_TYPES.has(t)) || looksLocal(page)) return "local";
  if (page.pageType === "home" || root) return "homepage";
  // 第二轮:弱信号(列表结构)
  if (c && c.listItemCount >= 8 && h2 >= 5) return "listicle";
  if (c && c.orderedListCount >= 1 && h2 >= 3) return "how-to";
  if (page.pageType === "article") return "article";
  return "other";
}

/** 形态的"兼容组"(规格 §3.8):同组即兼容 */
const FORMAT_GROUP: Record<PageFormat, string> = {
  comparison: "list",
  listicle: "list",
  product: "commerce",
  pricing: "commerce",
  homepage: "commerce",
  definition: "editorial",
  article: "editorial",
  "how-to": "editorial",
  local: "local",
  other: "other",
};

function compatible(a: PageFormat, b: PageFormat): boolean {
  return FORMAT_GROUP[a] === FORMAT_GROUP[b];
}

/** 规格 §3.8:各意图可接受的形态 */
const ACCEPTABLE: Record<SearchIntent, PageFormat[]> = {
  informational: ["definition", "how-to", "listicle", "article"],
  commercial: ["comparison", "listicle", "product", "pricing", "article"],
  transactional: ["product", "pricing", "homepage"],
  navigational: ["homepage", "product", "pricing"],
  local: ["local", "homepage"],
};

/**
 * 意图匹配。规格:形态在该意图的可接受列表里,且有 serpFormat 时还要与之兼容。
 * 两处补充(为什么):
 *  · serpFormat = "other"(排名页大多认不出形态)不算证据 —— 拿"认不出"去要求兼容,只会把目标页误判成不匹配;
 *  · 意图是兜底猜的(模式没命中)时,不拿猜的意图去卡可接受列表,只看与 SERP 主流形态是否兼容
 *    (Google 对这个查询给什么形态,本身就是意图的最好证据);没有 SERP 证据就不判(null,不进分母)。
 */
function judgeIntent(intent: SearchIntent, guessed: boolean, pageFormat: PageFormat, serpFormat: PageFormat | null): boolean | null {
  const serpEvidence = serpFormat !== null && serpFormat !== "other";
  if (guessed) return serpEvidence ? compatible(pageFormat, serpFormat as PageFormat) : null;
  const ok = ACCEPTABLE[intent].includes(pageFormat);
  return serpEvidence ? ok && compatible(pageFormat, serpFormat as PageFormat) : ok;
}

/**
 * SERP 主流形态:先按兼容组计票、组内再按形态计票,平票取名次更靠前的。
 * 少于 2 个抓到的竞品不下结论(一个样本谈不上"主流")。
 */
function dominantFormat(fetched: CompetitorPageSignals[]): PageFormat | null {
  if (fetched.length < 2) return null;
  const pick = <K extends string>(items: CompetitorPageSignals[], keyOf: (s: CompetitorPageSignals) => K): K => {
    const tally = new Map<K, { n: number; best: number }>();
    for (const s of items) {
      const k = keyOf(s);
      const t = tally.get(k) ?? { n: 0, best: Number.POSITIVE_INFINITY };
      t.n += 1;
      t.best = Math.min(t.best, s.position);
      tally.set(k, t);
    }
    return [...tally.entries()].sort((a, b) => b[1].n - a[1].n || a[1].best - b[1].best)[0][0];
  };
  const group = pick(fetched, (s) => FORMAT_GROUP[s.format]);
  return pick(
    fetched.filter((s) => FORMAT_GROUP[s.format] === group),
    (s) => s.format
  );
}

/* ============================================================
   子话题(规格 §3.5–3.7)
   ============================================================ */

interface Topic {
  /** 展示用原文(折叠空白、≤120 字符) */
  label: string;
  /** 规范化后的词干集合 */
  tokens: string[];
}

function headingTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of tokenize(text)) {
    if (STOPWORDS.has(raw) || NUMERIC_TOKEN.test(raw) || raw.length < 2) continue;
    const t = stem(raw);
    if (t.length < 2 || STOPWORDS.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/** 规格 §3.5 的标题规范化:小写、去标点、去停用词与数字、去年份、复数词干;返回空格连接的词干串 */
export function normalizeHeading(h: string): string {
  return headingTokens(h).join(" ");
}

/** 两个标题(原文或已规范化均可)是不是同一个子话题:词集合 Jaccard ≥ 0.5 */
export function sameTopic(a: string, b: string): boolean {
  return jaccard(headingTokens(a), headingTokens(b)) >= SAME_TOPIC_JACCARD;
}

/**
 * 模板化的栏目标题不是子话题:"Conclusion"、"Related posts"、"Leave a reply"、页脚的 "Company"、
 * 维基百科的 "See also" / "External links"、文档站侧栏的 "Tools" ……(parse.ts 的 headings 不区分正文与
 * 页眉页脚)。不滤掉的话,每个博客都有的 "Conclusion" 会成为"竞品共有子话题",目标页没有就被记成"缺失话题"。
 * (偏离规格的补充:规格只说 H2/H3 规范化,没提这层过滤。本站自己的模板标题另有按出现频率的过滤,见 templateHeadings。)
 */
const BOILERPLATE_HEADINGS = new Set(
  [
    "conclusion", "conclusions", "final thoughts", "final words", "wrapping up", "wrap up", "summary", "in summary",
    "in conclusion", "introduction", "intro", "overview", "table of contents", "contents", "on this page", "in this article",
    "related posts", "related articles", "related reading", "related resources", "related content", "related", "recent posts",
    "popular posts", "latest posts", "more posts", "more articles", "read more", "read next", "keep reading",
    "you may also like", "you might also like", "share", "share this", "share this article", "share this post", "comments",
    "leave a reply", "leave a comment", "post a comment", "subscribe", "subscribe to our newsletter", "newsletter",
    "join our newsletter", "sign up", "get started", "get in touch", "contact", "contact us", "about", "about us",
    "about the author", "author", "written by", "follow us", "connect with us", "categories", "tags", "archives", "search",
    "menu", "navigation", "quick links", "useful links", "company", "resources", "products", "solutions", "support", "legal",
    "community", "help", "faq", "faqs", "frequently asked questions", "key takeaways", "takeaways", "tl;dr", "sources",
    "references", "further reading", "footnotes", "cookie settings", "cookies", "privacy", "terms",
    // 维基百科 / 文档站 / 页脚常见的外壳标题(2026-10-01 冒烟实测)
    "see also", "external links", "notes", "bibliography", "citations", "tools", "free tools", "page tools", "personal tools",
    "navigation menu", "main menu", "namespaces", "views", "languages", "in other projects", "print export", "appearance",
    "general", "actions", "more", "explore", "learn", "get support", "documentation", "developers", "careers", "press",
    "partners", "social", "stay connected", "stay in touch",
  ]
    .map(normalizeHeading)
    .filter(Boolean)
);

function topicOf(text: string): Topic | null {
  const label = clipText(collapse(text ?? ""), 120);
  const tokens = headingTokens(label);
  if (!tokens.length || BOILERPLATE_HEADINGS.has(tokens.join(" "))) return null;
  return { label, tokens };
}

/** 页内去重:同一页上两个说同一件事的标题只算一个子话题 */
function dedupeTopics(topics: Topic[]): Topic[] {
  const out: Topic[] = [];
  for (const t of topics) {
    if (out.some((o) => jaccard(o.tokens, t.tokens) >= SAME_TOPIC_JACCARD)) continue;
    out.push(t);
    if (out.length >= MAX_HEADINGS_PER_PAGE) break;
  }
  return out;
}

/** 一页的子话题 = H2 / H3(≤40,去栏目模板、去本站模板标题、页内去重) */
function pageTopics(page: Pick<CrawledPage, "headings">, siteTemplate?: Set<string>): Topic[] {
  const raw: Topic[] = [];
  for (const h of page.headings ?? []) {
    if (h.level !== 2 && h.level !== 3) continue;
    const t = topicOf(h.text);
    if (t && !siteTemplate?.has(t.tokens.join(" "))) raw.push(t);
  }
  return dedupeTopics(raw);
}

/**
 * 本站的模板标题:同一个 H2/H3 出现在 ≥40%(且 ≥3 个)已抓页面上 —— 页脚栏目("Free tools"、"Learn")、
 * 每页都有的 CTA 横幅。它们不是任何一页自己的子话题;不去掉的话会被记成"独有子话题",虚抬信息增益。
 * 竞品每个站只抓一页,没法这样统计,只能靠 BOILERPLATE_HEADINGS。
 */
function templateHeadings(pages: CrawledPage[]): Set<string> {
  const ok = pages.filter((p) => unusableReason(p) === null);
  if (ok.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const p of ok) {
    const seen = new Set<string>();
    for (const h of p.headings ?? []) {
      if (h.level !== 2 && h.level !== 3) continue;
      const key = normalizeHeading(h.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const min = Math.max(3, Math.ceil(ok.length * 0.4));
  return new Set([...counts].filter(([, n]) => n >= min).map(([k]) => k));
}

export interface CoverageResult {
  /** 覆盖的竞品共有子话题 / 共有子话题总数;共有 < 3 个时为 null */
  coverage: number | null;
  /** 竞品共有子话题数(出现在 ≥2 个竞品里) */
  shared: number;
  /** ≤10,按出现竞品数降序 */
  covered: string[];
  /** ≤10,按出现竞品数降序 */
  missing: string[];
  /** 本页有、所有竞品都没有的子话题(≤10);没有竞品时为空 —— 无从比较不等于独有 */
  unique: string[];
  /** 独有子话题总数(不截断) */
  uniqueCount: number;
}

/**
 * 竞品子话题聚类:按名次顺序逐个标题找"代表标题"与之 Jaccard ≥ 0.5 的簇,找不到就自立一簇。
 * 只和簇的第一个标题比(不做传递合并),避免 A≈B、B≈C 把不相干的 A 和 C 串到一起。
 * 判"覆盖"时放宽到簇里任一成员 —— 竞品之间措辞不同,本页只要和其中一种说法对得上就算讲到了。
 */
function coverageFromTopics(target: Topic[], competitors: Topic[][]): CoverageResult {
  const clusters: { label: string; rep: string[]; members: string[][]; comps: Set<number>; order: number }[] = [];
  competitors.forEach((list, ci) => {
    for (const topic of list) {
      const hit = clusters.find((cl) => jaccard(cl.rep, topic.tokens) >= SAME_TOPIC_JACCARD);
      if (hit) {
        hit.members.push(topic.tokens);
        hit.comps.add(ci);
      } else {
        clusters.push({ label: topic.label, rep: topic.tokens, members: [topic.tokens], comps: new Set([ci]), order: clusters.length });
      }
    }
  });
  const shared = clusters.filter((c) => c.comps.size >= 2).sort((a, b) => b.comps.size - a.comps.size || a.order - b.order);
  const isCovered = (c: (typeof clusters)[number]) => target.some((t) => c.members.some((m) => jaccard(t.tokens, m) >= SAME_TOPIC_JACCARD));
  const covered = shared.filter(isCovered);
  const missing = shared.filter((c) => !isCovered(c));
  const allCompetitorTopics = competitors.flat();
  const unique =
    competitors.length === 0 ? [] : target.filter((t) => !allCompetitorTopics.some((m) => jaccard(t.tokens, m.tokens) >= SAME_TOPIC_JACCARD));
  return {
    coverage: shared.length >= MIN_SHARED_TOPICS ? round(covered.length / shared.length, 3) : null,
    shared: shared.length,
    covered: covered.slice(0, MAX_TOPICS).map((c) => c.label),
    missing: missing.slice(0, MAX_TOPICS).map((c) => c.label),
    unique: unique.slice(0, MAX_TOPICS).map((t) => t.label),
    uniqueCount: unique.length,
  };
}

/**
 * 语义覆盖(纯函数,供测试与复核):target = 本页 H2/H3 文本,competitors = 每个已抓到竞品的 H2/H3 文本。
 * 文本先规范化、去栏目模板、页内去重,再按规格 §3.5–3.7 计算。
 */
export function computeCoverage(target: string[], competitors: string[][]): CoverageResult {
  const toTopics = (list: string[]) => dedupeTopics(list.map(topicOf).filter((t): t is Topic => t !== null));
  return coverageFromTopics(toTopics(target), competitors.map(toTopics));
}

/* ============================================================
   对齐(规格 §3.9)
   ============================================================ */

function alignmentFor(query: string, brands: string[], page: CrawledPage): { title: number; h1: number; answerEarly: boolean } {
  // 纯品牌查询去掉品牌后什么都不剩:这时就看品牌名本身是否出现在标题 / H1 / 开头
  let core = coreTokens(query, brands);
  if (!core.length) core = coreTokens(query, []);
  if (!core.length) return { title: 0, h1: 0, answerEarly: false };
  const title = stemmedSet(page.title ?? "");
  const h1 = stemmedSet(page.h1s?.[0] ?? "");
  // 内容信号缺失时退到 textSample(主体文本前 400 字符,约 60–70 词):比 150 词短,判定只会更严,不会放水
  const lead = stemmedSet(page.content?.leadText ?? page.textSample ?? "");
  const hits = (s: Set<string>) => core.filter((t) => s.has(t)).length;
  return {
    title: round(hits(title) / core.length, 2),
    h1: round(hits(h1) / core.length, 2),
    // "核心词 ≥ 一半出现在 leadText"
    answerEarly: hits(lead) * 2 >= core.length,
  };
}

/* ============================================================
   选对(规格 §3.1 + v2 §3.4):用户目标词 → 排名词 → 不足 3 对时补页面主题词
   ============================================================ */

interface CompetitorRef {
  url: string;
  domain: string;
  position: number;
  title: string;
  /** 沿用模式:上次 bulk_ranks 查到的主域权威(重跑不再花钱查);undefined = 上次没有这项数据 */
  rank?: number | null;
}

/** 一次 live SERP 的版面:元素类型、AI 摘要(含是否引用本站)、精选摘要(含是否本站)、PAA */
interface SerpExtras {
  serpFeatures: string[];
  aiOverview: NonNullable<RelevancePair["aiOverview"]>;
  featuredSnippet: NonNullable<RelevancePair["featuredSnippet"]> | null;
  paa: string[];
}

type RankChange = NonNullable<RelevancePair["rankChange"]>;
type VolumeTrend = NonNullable<RelevancePair["volumeTrend"]>;

/** 这一对的 Labs 数据(难度、SERP 元素、前 10 平均权威、名次变化、量趋势);undefined = 没有这项数据 */
interface LabsFields {
  kd?: number | null;
  serpItemTypes?: string[];
  avgTopDomainRank?: number | null;
  rankChange?: RankChange | null;
  volumeTrend?: VolumeTrend | null;
}

interface Candidate extends LabsFields {
  query: string;
  source: RelevancePair["source"];
  volume: number | null;
  position: number | null;
  intent: SearchIntent;
  intentSource: RelevancePair["intentSource"];
  /** 意图是兜底猜的(模式没命中、也没有 DataForSEO 意图) */
  intentGuessed: boolean;
  url: string;
  /** 抓取集合里的对应页;null = 需要单独抓 */
  page: CrawledPage | null;
  /** reuse 路径:上一份的竞品 URL(null = 上次这一对没做 SERP 对比) */
  reuseRefs: CompetitorRef[] | null;
  /**
   * 竞品从哪来 —— 每次 SERP 都是真钱,所以选对时就定死:
   *   live  = 这次调 SERP(首次付费 / 付费刷新;重跑时只有新加的目标词);
   *   reuse = 沿用上次的竞品 URL 与 SERP 版面(零 SERP);
   *   none  = 重跑时新补进来的对,不调 SERP。
   */
  serpMode: "live" | "reuse" | "none";
  /** 目标词(排名数据里没有)与页面主题词:先过一次 keyword_overview 拿量 / 难度 / 意图 / SERP 元素 */
  needsOverview: boolean;
  /** 目标词没有任何页面在针对、退到了首页:这个 URL 不"占位"(首页自己的排名词照样分析) */
  fallbackPage: boolean;
  /** 目标词的排名页抓不到 / 用不了时的备选页(内容最匹配的已抓页面);没有为 null */
  alt: CrawledPage | null;
  /** 沿用模式:上次 live SERP 的版面 */
  serpExtras: SerpExtras | null;
}

function isHtmlPage(p: CrawledPage): boolean {
  return /html/.test(p.contentType ?? "") || !!p.title;
}

/** 页面能不能拿来分析;能 → null,不能 → 原因(进 notes) */
function unusableReason(p: CrawledPage): string | null {
  if (p.status < 200 || p.status >= 300) return p.status ? `HTTP ${p.status}` : "no response";
  if (!isHtmlPage(p)) return "not an HTML page";
  if (p.jsShell) return "content is rendered client-side";
  if ((p.content?.mainWords ?? p.wordCount) <= 0) return "no readable text";
  return null;
}

function indexPages(pages: CrawledPage[]): Map<string, CrawledPage> {
  const index = new Map<string, CrawledPage>();
  // 同一个键先到先得,但 2xx 页优先于跳转前的失败记录
  const put = (key: string, p: CrawledPage) => {
    const cur = index.get(key);
    if (!cur || (unusableReason(cur) !== null && unusableReason(p) === null)) index.set(key, p);
  };
  for (const p of pages) {
    if (!p || typeof p.url !== "string") continue;
    put(dedupeKey(p.url), p);
    if (p.finalUrl && p.finalUrl !== p.url) put(dedupeKey(p.finalUrl), p);
  }
  return index;
}

function normalizeQuery(q: string): string {
  return clipText(collapse(String(q ?? "").toLowerCase()), MAX_QUERY_CHARS);
}

/**
 * 用户目标词:小写、折叠空白、≤80 字符、去重、≤3。集成方(repo.normalizeTargetKeywords)已按同一口径
 * 规范化过;这里再防一道 —— 数据来自 jsonb,而且下面要拿它和上一份的查询逐字比对。
 */
function normalizeTargets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const q = clipText(collapse(r.toLowerCase()), MAX_TARGET_CHARS).trim();
    if (q.length < 2 || out.includes(q)) continue;
    out.push(q);
    if (out.length >= MAX_TARGET_KEYWORDS) break;
  }
  return out;
}

/* ---------- Labs 字段的防御性读取(来自 DataForSEO 或数据库 jsonb,形状都不能信) ---------- */

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 字符串数组:去空、去重、截断;不是数组 → [] */
function stringList(v: unknown, max: number, maxChars = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = clipText(collapse(x), maxChars);
    if (!s || out.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function trendOf(v: unknown): VolumeTrend | null {
  if (!v || typeof v !== "object") return null;
  const t = v as { quarterly?: unknown; yearly?: unknown };
  const quarterly = finiteOrNull(t.quarterly);
  const yearly = finiteOrNull(t.yearly);
  return quarterly === null && yearly === null ? null : { quarterly, yearly };
}

function rankChangeOf(v: unknown): RankChange | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { previous?: unknown; isNew?: unknown; isUp?: unknown; isDown?: unknown };
  return { previous: finiteOrNull(r.previous), isNew: r.isNew === true, isUp: r.isUp === true, isDown: r.isDown === true };
}

/** 排名词 / 上一份的对里带的 Labs 字段。v3 数据没有这些字段 → 保持 undefined(= 不知道,不是 0) */
function labsFrom(src: object): LabsFields {
  const s = src as { kd?: unknown; serpItemTypes?: unknown; avgTopDomainRank?: unknown; rankChange?: unknown; volumeTrend?: unknown };
  const out: LabsFields = {};
  if (s.kd !== undefined) out.kd = finiteOrNull(s.kd);
  if (s.serpItemTypes !== undefined) out.serpItemTypes = stringList(s.serpItemTypes, MAX_SERP_TYPES, 60);
  if (s.avgTopDomainRank !== undefined) out.avgTopDomainRank = finiteOrNull(s.avgTopDomainRank);
  if (s.rankChange !== undefined) out.rankChange = rankChangeOf(s.rankChange);
  if (s.volumeTrend !== undefined) out.volumeTrend = trendOf(s.volumeTrend);
  return out;
}

/** 本站的排名词:有词、有 URL、URL 在本站(含子域) */
type OwnRanked = RankedKeyword & { url: string };

function ownRankedKeywords(vis: VisibilityResult | null, domain: string): OwnRanked[] {
  if (!vis || vis.noData || !Array.isArray(vis.topKeywords)) return [];
  return vis.topKeywords.filter(
    (k): k is OwnRanked => !!k && typeof k.keyword === "string" && !!k.keyword.trim() && typeof k.url === "string" && isOwnHost(hostOf(k.url), domain)
  );
}

/** 排名词 → 候选(排名词本身,或与之同词的用户目标词:量 / 名次 / 意图 / Labs 字段都取自排名数据,零新增成本) */
function fromRanked(k: OwnRanked, query: string, source: Candidate["source"], brands: string[], index: Map<string, CrawledPage>): Candidate {
  const fromDfs = dfsIntent(k.intent);
  const pattern = classifyIntent(query, brands);
  return {
    query,
    source,
    volume: finiteOrNull(k.volume),
    position: finiteOrNull(k.position),
    intent: fromDfs ?? pattern.intent,
    intentSource: fromDfs ? "dataforseo" : "pattern",
    intentGuessed: !fromDfs && !pattern.matched,
    url: k.url,
    page: index.get(dedupeKey(k.url)) ?? null,
    reuseRefs: null,
    serpMode: "live",
    needsOverview: false,
    fallbackPage: false,
    alt: null,
    serpExtras: null,
    ...labsFrom(k),
  };
}

/**
 * 排名词:非品牌词优先、搜索量降序(同量按名次、再按字母,保证可复现),每个 URL 只取第一个词;
 * 排名 URL 不在抓取集合里的留给 resolveTargets 单独抓。
 * v4:用户目标词已用掉的词与 URL 不再重复占对 —— 同一页换个近义词再比一次,SERP 几乎一样,白花一次钱。
 */
function rankingCandidates(
  ranked: OwnRanked[],
  brands: string[],
  index: Map<string, CrawledPage>,
  skipQueries: Set<string>,
  claimedUrls: Set<string>
): Candidate[] {
  const sorted = [...ranked].sort(
    (a, b) =>
      Number(isBrandQuery(a.keyword, brands)) - Number(isBrandQuery(b.keyword, brands)) ||
      (b.volume ?? 0) - (a.volume ?? 0) ||
      (a.position ?? 999) - (b.position ?? 999) ||
      a.keyword.localeCompare(b.keyword)
  );
  const seenUrls = new Set(claimedUrls);
  const seenQueries = new Set(skipQueries);
  const out: Candidate[] = [];
  for (const k of sorted) {
    const key = dedupeKey(k.url);
    const query = normalizeQuery(k.keyword);
    if (!query || seenUrls.has(key) || seenQueries.has(query)) continue;
    seenUrls.add(key);
    seenQueries.add(query);
    out.push(fromRanked(k, query, "ranking", brands, index));
  }
  return out;
}

const CONTENT_PAGE_TYPES = new Set(["article", "product", "other", "listing"]);

/** 内容页(与计分口径一致):article / product / other / listing,主体 ≥300 词 */
function isContentPage(p: CrawledPage): boolean {
  return CONTENT_PAGE_TYPES.has(p.pageType ?? "other") && (p.content?.mainWords ?? p.wordCount) >= CONTENT_MIN_WORDS;
}

/** 标题去品牌段:按 | · — – - : 切段,丢掉"含品牌且 ≤3 个词"的段,取最长的一段 */
function titleTopic(title: string, brands: string[]): string {
  const segs = titleSegments(title);
  const nonBrand = segs.filter((s) => !(isBrandQuery(s, brands) && s.split(/\s+/).length <= 3));
  return [...(nonBrand.length ? nonBrand : segs)].sort((a, b) => b.length - a.length)[0] ?? "";
}

/** 主题短语:小写、去标点、去品牌词、≤8 个词("&" 读作 and) */
function queryFromText(text: string, brands: string[]): string | null {
  const kept = dropBrandTokens(tokenize((text ?? "").replace(/&/g, " and ")), brands);
  const q = kept.slice(0, MAX_QUERY_WORDS).join(" ").trim();
  return q ? clipText(q, MAX_QUERY_CHARS) : null;
}

/** H1 优先;H1 只剩 <2 个核心词("Welcome"、纯品牌)就看去品牌后的标题,两者取核心词多的那个 */
function topicPhrase(page: CrawledPage, brands: string[]): string | null {
  let best: { q: string; core: number } | null = null;
  for (const raw of [page.h1s?.[0] ?? "", titleTopic(page.title, brands)]) {
    const q = queryFromText(raw, brands);
    if (!q) continue;
    const core = coreTokens(q, brands).length;
    if (core >= 2) return q;
    if (core >= 1 && (!best || core > best.core)) best = { q, core };
  }
  return best?.q ?? null;
}

/** 站内入链数:有多少个(别的)已抓页面链到它 */
function inboundCounter(pages: CrawledPage[]): (p: CrawledPage) => number {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const self = dedupeKey(p.finalUrl || p.url);
    const seen = new Set<string>();
    for (const l of p.links ?? []) {
      const k = dedupeKey(l);
      if (k === self || seen.has(k)) continue;
      seen.add(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return (p) => Math.max(counts.get(dedupeKey(p.url)) ?? 0, p.finalUrl ? counts.get(dedupeKey(p.finalUrl)) ?? 0 : 0);
}

function homeOf(pages: CrawledPage[]): CrawledPage | null {
  return pages.find((p) => p.depth === 0) ?? pages.find((p) => p.pageType === "home") ?? pages.find((p) => isRootPath(p)) ?? null;
}

/** 已被别的对用掉的 URL(含跳转后的地址) */
function urlKeysOf(drafts: { url: string; page: CrawledPage | null }[]): Set<string> {
  const out = new Set<string>();
  for (const d of drafts) {
    out.add(dedupeKey(d.url));
    if (d.page?.finalUrl) out.add(dedupeKey(d.page.finalUrl));
  }
  return out;
}

/**
 * 页面主题候选:首页 + 入链最多的内容页(同入链按主体词数、再按 URL,保证可复现),至多 max 个;
 * 已被目标词 / 排名词用掉的页面与查询跳过。没有排名数据时 max = 3,即 v1 的"首页 + 入链最多的 2 个内容页"。
 */
function pageTopicCandidates(pages: CrawledPage[], brands: string[], exclude: { urls: Set<string>; queries: Set<string> }, max: number): Candidate[] {
  const ok = pages.filter((p) => unusableReason(p) === null && !p.robotsNoindex);
  const home = homeOf(ok);
  const inbound = inboundCounter(pages);
  const words = (p: CrawledPage) => p.content?.mainWords ?? p.wordCount;
  const content = ok
    .filter((p) => p !== home && p.pageType !== "home" && !isRootPath(p) && isContentPage(p))
    .sort((a, b) => inbound(b) - inbound(a) || words(b) - words(a) || a.url.localeCompare(b.url));
  const out: Candidate[] = [];
  const seen = new Set(exclude.queries);
  const add = (p: CrawledPage): void => {
    if (out.length >= max) return;
    if (exclude.urls.has(dedupeKey(p.url)) || (p.finalUrl && exclude.urls.has(dedupeKey(p.finalUrl)))) return;
    const q = topicPhrase(p, brands);
    if (!q || seen.has(q)) return;
    seen.add(q);
    const pattern = classifyIntent(q, brands);
    out.push({
      query: q,
      source: "page-topic",
      volume: null,
      position: null,
      intent: pattern.intent,
      intentSource: "pattern",
      intentGuessed: !pattern.matched,
      url: p.url,
      page: p,
      reuseRefs: null,
      serpMode: "live",
      needsOverview: true,
      fallbackPage: false,
      alt: null,
      serpExtras: null,
    });
  };
  if (home) add(home);
  for (const p of content) add(p);
  return out;
}

/* ---------- 用户目标词(v2 §3.4) ---------- */

/** "同词":规范化后完全相同;否则词干后的词集合相同。不去品牌 —— "acme pricing" 与 "pricing" 不是同一个词 */
function sameKeyword(a: string, b: string): boolean {
  if (a === b) return true;
  const A = coreTokens(a, []);
  const B = coreTokens(b, []);
  return A.length > 0 && A.length === B.length && A.every((t) => B.includes(t));
}

/**
 * 目标词的目标页(排名数据里没有这个词时):title / H1 / leadText 与该词核心词重合最多的页。
 * 重合数相同再按"标题里有几个 → H1 里有几个 → 层级浅 → 入链多 → URL"排,保证可复现;全为 0 → null。
 */
function bestPageFor(query: string, pool: CrawledPage[], brands: string[], inbound: (p: CrawledPage) => number): CrawledPage | null {
  let core = coreTokens(query, brands);
  if (!core.length) core = coreTokens(query, []);
  if (!core.length) return null;
  let best: { page: CrawledPage; key: number[] } | null = null;
  for (const p of pool) {
    const title = stemmedSet(p.title ?? "");
    const h1 = stemmedSet(p.h1s?.[0] ?? "");
    const lead = stemmedSet(p.content?.leadText ?? p.textSample ?? "");
    const union = core.filter((t) => title.has(t) || h1.has(t) || lead.has(t)).length;
    if (!union) continue;
    const key = [union, core.filter((t) => title.has(t)).length, core.filter((t) => h1.has(t)).length, -(p.depth ?? 0), inbound(p)];
    const cmp = best ? compareKeys(key, best.key) : 1;
    if (!best || cmp > 0 || (cmp === 0 && p.url.localeCompare(best.page.url) < 0)) best = { page: p, key };
  }
  return best?.page ?? null;
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 用户目标词 → 候选(source = "target",顺序 = 用户给的顺序)。目标页(规格 v2 §3.4):
 *   排名词里有同词 → 用它的 URL(量 / 名次 / 难度等都取排名数据,不再查 keyword_overview);
 *   否则取 title / H1 / 开头与核心词重合最多的已抓页面;
 *   全为 0 → 首页,并在 note 里写明"没有页面在针对这个词"。
 * 法律页、noindex 页不当目标页:它们本来就不是用来排名的。
 */
function targetCandidates(
  targets: string[],
  ranked: OwnRanked[],
  pages: CrawledPage[],
  index: Map<string, CrawledPage>,
  brands: string[],
  domain: string,
  notes: string[]
): Candidate[] {
  if (!targets.length) return [];
  const pool = pages.filter((p) => unusableReason(p) === null && !p.robotsNoindex && p.pageType !== "legal");
  const home = homeOf(pool);
  const inbound = inboundCounter(pages);
  const out: Candidate[] = [];
  for (const t of targets) {
    const hits = ranked.filter((k) => sameKeyword(normalizeQuery(k.keyword), t));
    if (hits.length) {
      const k = [...hits].sort(
        (a, b) =>
          Number(normalizeQuery(b.keyword) === t) - Number(normalizeQuery(a.keyword) === t) ||
          (a.position ?? 999) - (b.position ?? 999) ||
          (b.volume ?? 0) - (a.volume ?? 0) ||
          a.url.localeCompare(b.url)
      )[0];
      const c = fromRanked(k, t, "target", brands, index);
      // 排名页万一抓不到 / 用不了,退到内容最匹配的已抓页面:用户点名要看的词不能就这么消失
      c.alt = bestPageFor(t, pool, brands, inbound) ?? home;
      out.push(c);
      continue;
    }
    const pattern = classifyIntent(t, brands);
    const base = {
      query: t,
      source: "target" as const,
      volume: null,
      position: null,
      intent: pattern.intent,
      intentSource: "pattern" as const,
      intentGuessed: !pattern.matched,
      reuseRefs: null,
      serpMode: "live" as const,
      needsOverview: true,
      alt: null,
      serpExtras: null,
    };
    const page = bestPageFor(t, pool, brands, inbound);
    if (page) {
      out.push({ ...base, url: page.url, page, fallbackPage: false });
    } else if (home) {
      notes.push(
        `No page on ${domain || "this site"} targets "${t}" yet — none has those words in its title, H1 or opening text — so the homepage was compared against the search results for it.`
      );
      out.push({ ...base, url: home.url, page: home, fallbackPage: true });
    } else {
      notes.push(`"${t}" could not be analysed: no crawled page could be matched to it.`);
    }
  }
  return out;
}

/**
 * reuse 来自数据库 jsonb:逐字段校验,形状不对的对直接丢掉。
 * v4(集成方约定):上一份里 source = "target" 但已不在当前目标词里的对 → 丢掉(用户删了这个词);
 * 上一份的排名 / 页面主题对与当前目标词同词 → 改记为 target(沿用它的 SERP,不再花钱)。
 * 上一份的 SERP 版面、Labs 字段、竞品主域权威一并沿用;v3 数据没有 Labs 字段时按这次的排名数据补(免费)。
 */
function reuseCandidates(
  reuse: RelevanceAnalysis,
  brands: string[],
  domain: string,
  index: Map<string, CrawledPage>,
  ranked: OwnRanked[],
  targets: Set<string>
): { candidates: Candidate[]; dropped: string[] } {
  const out: Candidate[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(reuse?.pairs) ? reuse.pairs : []) {
    if (!p || typeof p.query !== "string" || typeof p.url !== "string" || !p.query.trim()) continue;
    const query = normalizeQuery(p.query);
    if (seen.has(query)) continue;
    seen.add(query);
    const isTarget = targets.has(query);
    if (p.source === "target" && !isTarget) {
      dropped.push(query);
      continue;
    }
    const intent = (SEARCH_INTENTS as string[]).includes(p.intent) ? p.intent : classifyIntent(query, brands).intent;
    const intentSource = p.intentSource === "dataforseo" ? "dataforseo" : "pattern";
    const refs: CompetitorRef[] = Array.isArray(p.competitors)
      ? p.competitors
          .filter((c) => !!c && typeof c.url === "string" && !isOwnHost(hostOf(c.url), domain))
          .map((c) => {
            const ref: CompetitorRef = {
              url: c.url,
              domain: typeof c.domain === "string" && c.domain ? c.domain : registrableDomain(hostOf(c.url)),
              position: typeof c.position === "number" && Number.isFinite(c.position) ? c.position : 0,
              title: typeof c.title === "string" ? c.title : "",
            };
            if (c.domainRank !== undefined) ref.rank = finiteOrNull(c.domainRank);
            return ref;
          })
      : [];
    let labs = labsFrom(p);
    if (labs.kd === undefined && labs.serpItemTypes === undefined) {
      const k = ranked.find((r) => normalizeQuery(r.keyword) === query);
      if (k) labs = labsFrom(k);
    }
    out.push({
      query,
      source: isTarget ? "target" : p.source === "ranking" ? "ranking" : "page-topic",
      volume: finiteOrNull(p.volume),
      position: finiteOrNull(p.position),
      intent,
      intentSource,
      intentGuessed: intentSource === "pattern" && !classifyIntent(query, brands).matched,
      url: p.url,
      page: index.get(dedupeKey(p.url)) ?? null,
      reuseRefs: refs.length ? refs : null,
      serpMode: "reuse",
      needsOverview: false,
      fallbackPage: false,
      alt: null,
      serpExtras: extrasFromReuse(p, domain),
      ...labs,
    });
  }
  return { candidates: out, dropped };
}

/* ============================================================
   网络:并发 4、同主机间隔、robots.txt、预算
   ============================================================ */

type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** 信号量:释放时把名额直接交给排队者(先减再唤醒会被插队,瞬时超过 n) */
function makeLimiter(n: number): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < n) active += 1;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

interface RobotsVerdict {
  rules: RobotsRules;
  /** robots.txt 读不到(网络错误 / 5xx / 429)的原因;读到了或 4xx 为 null */
  unavailable: string | null;
  /** 预算已尽,连 robots.txt 都没发 */
  budget: boolean;
}

interface Net {
  fetcher: Fetcher;
  parse: typeof parsePageDetailed;
  now: () => number;
  deadline: number;
  baseInterval: number;
  /** 同主机的下一个可用时刻(令牌桶) */
  hostNext: Map<string, number>;
  /** 读到 robots 之后该主机的间隔(含 Crawl-delay,≤2 秒) */
  hostInterval: Map<string, number>;
  robots: Map<string, Promise<RobotsVerdict>>;
  /** 被限流 / 挑战 / WAF 拦过的主机:同一次分析里不再打扰 */
  blocked: Map<string, string>;
  /** 同主机请求串行(上一个请求结束才发下一个):429 / 挑战页之后不会还有一个请求已经在路上 */
  hostLocks: Map<string, Promise<void>>;
  limit: Limiter;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function syntheticResult(url: string, error: string): FetchResult {
  return { url, finalUrl: url, status: 0, headers: new Headers(), body: "", bytes: 0, ms: 0, chain: [], contentType: "", error };
}

function makeNet(input: RelevanceInput, deadline: number): Net {
  return {
    fetcher: input.fetcher ?? safeFetch,
    parse: input.parse ?? parsePageDetailed,
    now: input.now ?? Date.now,
    deadline,
    baseInterval: Math.max(0, input.minIntervalMs ?? MIN_HOST_INTERVAL_MS),
    hostNext: new Map(),
    hostInterval: new Map(),
    robots: new Map(),
    blocked: new Map(),
    hostLocks: new Map(),
    limit: makeLimiter(CONCURRENCY),
  };
}

/** 同主机互斥:排在上一个请求之后;先拿主机锁再拿全局名额,排队的请求不占并发名额 */
async function withHostLock<T>(net: Net, host: string, fn: () => Promise<T>): Promise<T> {
  const prev = net.hostLocks.get(host) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => mine);
  net.hostLocks.set(host, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (net.hostLocks.get(host) === tail) net.hostLocks.delete(host);
  }
}

const HOST_BLOCKED = "blocked an earlier request";
const HARD_BLOCKS = new Set(["rate-limited", "challenge", "waf"]);

/**
 * 礼貌请求:同主机串行 → 占一个并发名额 → 等同主机的间隔 → 发请求(超时不超过剩余预算)。
 * 拦截判定(429 / 挑战页 / WAF)在释放主机锁之前记下,排在后面的同主机请求一定看得到,不会再发。
 * 同主机令牌桶是本模块自己的:crawl.ts 的那一份没有导出;相关性分析在抓取结束之后才跑,
 * 两份桶不会同时打同一个主机。注入的 fetcher 若抛错,当作 status 0 返回(safeFetch 本身不抛)。
 */
async function politeGet(net: Net, url: string, opts: SafeFetchOptions = {}): Promise<FetchResult> {
  const host = hostOf(url);
  return withHostLock(net, host, () =>
    net.limit(async () => {
      const blockedBy = net.blocked.get(host);
      if (blockedBy) return syntheticResult(url, `Skipped: ${host} ${HOST_BLOCKED} (${blockedBy})`);
      const interval = net.hostInterval.get(host) ?? net.baseInterval;
      const now = net.now();
      const slot = Math.max(now, net.hostNext.get(host) ?? 0);
      if (net.deadline - slot < MIN_FETCH_MS) return syntheticResult(url, BUDGET_SKIP);
      net.hostNext.set(host, slot + interval);
      if (slot > now) await sleep(slot - now);
      const timeoutMs = Math.max(1, Math.min(opts.timeoutMs ?? PAGE_TIMEOUT_MS, net.deadline - net.now()));
      let res: FetchResult;
      try {
        res = await net.fetcher(url, { ...opts, timeoutMs });
      } catch (e) {
        return syntheticResult(url, errText(e));
      }
      const block = detectBlock(res);
      if (block?.kind && HARD_BLOCKS.has(block.kind)) net.blocked.set(host, block.evidence);
      return res;
    })
  );
}

/** 每个 origin 只取一次 robots.txt;读到后按 Crawl-delay 调整该主机的间隔 */
function robotsFor(net: Net, origin: string): Promise<RobotsVerdict> {
  let p = net.robots.get(origin);
  if (!p) {
    p = (async (): Promise<RobotsVerdict> => {
      const rules = await fetchRobots(origin, (u, o) => politeGet(net, u, o));
      if (rules.error === BUDGET_SKIP) return { rules, unavailable: null, budget: true };
      net.hostInterval.set(hostOf(origin), politeIntervalFor(rules, net.baseInterval).intervalMs);
      const status = rules.status ?? 0;
      const unavailable = status === 0 ? rules.error ?? "no response" : status >= 500 || status === 429 ? `HTTP ${status}` : null;
      return { rules, unavailable, budget: false };
    })().catch((e: unknown) => ({ rules: emptyRobots(null, errText(e)), unavailable: errText(e), budget: false }));
    net.robots.set(origin, p);
  }
  return p;
}

type FetchOutcome = "ok" | "robots" | "budget" | "blocked" | "error";

interface FetchedPage {
  page: CrawledPage | null;
  error: string | null;
  outcome: FetchOutcome;
}

/**
 * 抓一页并解析。strictRobots(竞品站):robots.txt 读不到(网络错误 / 5xx / 429)按 RFC 9309 视为全站禁止 ——
 * 别人的站没请我们来,宁可少比一个;被审计的站(排名 URL 不在抓取集合里时)沿用爬虫口径:读不到 = 没有规则。
 * 遇到 429 / 挑战页 / WAF 立即放弃该主机(与 /bot 页的承诺一致);普通 401/403 只记这一页。
 */
async function fetchPage(net: Net, url: string, opts: { strictRobots: boolean; parseHost: string | null; ownDomain: string | null }): Promise<FetchedPage> {
  const fail = (outcome: FetchOutcome, error: string): FetchedPage => ({ page: null, error: clipText(error, 200), outcome });
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return fail("error", "Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return fail("error", `Unsupported URL scheme ${u.protocol}`);
  if (hasNonHtmlExtension(u.href)) return fail("error", "Not an HTML page (file download)");
  const host = u.hostname.toLowerCase();
  const blockedBy = net.blocked.get(host);
  if (blockedBy) return fail("blocked", `Skipped: ${host} ${HOST_BLOCKED} (${blockedBy})`);
  if (net.deadline - net.now() < MIN_FETCH_MS) return fail("budget", BUDGET_SKIP);

  const verdict = await robotsFor(net, u.origin);
  if (verdict.budget) return fail("budget", BUDGET_SKIP);
  if (opts.strictRobots && verdict.unavailable) {
    // 有 HTTP 状态(5xx / 429)= 站点在但 robots 读不到;没有状态 = 根本连不上,归到抓取错误
    return verdict.rules.status
      ? fail("robots", `robots.txt could not be read (${verdict.unavailable}); skipped to stay polite`)
      : fail("error", `Could not connect (${verdict.unavailable})`);
  }
  if (!isPathAllowed(verdict.rules, `${u.pathname}${u.search}`, DEFAULT_UA)) return fail("robots", "Disallowed for AEOeyeBot by robots.txt");

  const res = await politeGet(net, u.href, { method: "GET", maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS });
  if (res.status === 0 && res.error === BUDGET_SKIP) return fail("budget", BUDGET_SKIP);
  if (res.status === 0 && res.error?.includes(HOST_BLOCKED)) return fail("blocked", res.error);
  // 429 / 挑战页 / WAF 已在 politeGet 里记下主机;普通 401/403 只影响这一页
  const block = detectBlock(res);
  if (block) return fail("blocked", block.evidence);
  if (res.status === 0) return fail("error", res.error ?? "No response");
  if (res.status < 200 || res.status >= 300) return fail("error", `HTTP ${res.status}`);
  if (!isHtmlResponse(res)) return fail("error", `Not an HTML page (${res.contentType || "unknown content-type"})`);
  const finalHost = hostOf(res.finalUrl) || host;
  if (opts.ownDomain && isOwnHost(finalHost, opts.ownDomain)) return fail("error", "Redirects to your own site");
  let page: CrawledPage;
  try {
    page = net.parse(res.body, res, 1, opts.parseHost ?? finalHost).page;
  } catch (e) {
    return fail("error", `Could not parse the page (${errText(e)})`);
  }
  if (page.jsShell) return fail("error", "Content is rendered client-side (JavaScript shell), so it cannot be compared");
  return { page, error: null, outcome: "ok" };
}

/** 把一个 Promise 限在 deadline 之内;超时只是不再等它(SERP 请求已发出,迟到的结果丢弃) */
async function withinDeadline<T>(
  p: Promise<T>,
  deadline: number,
  now: () => number
): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error: unknown }> {
  const guarded = p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, timedOut: false, error })
  );
  const ms = deadline - now();
  if (ms <= 0) return { ok: false, timedOut: true, error: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; timedOut: true; error: null }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true, error: null }), ms);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ============================================================
   DataForSEO:SERP / 关键词概览 / 竞品主域权威
   ============================================================ */

type Dfs = typeof import("./dataforseo");

interface Provided<F> {
  fn: F | null;
  why: string | null;
}

interface Providers {
  serp: () => Promise<Provided<SerpFn>>;
  overview: () => Promise<Provided<KeywordOverviewFn>>;
  ranks: () => Promise<Provided<BulkRanksFn>>;
}

/**
 * 默认来源:按需 import dataforseo.ts(它在导入期校验 env;纯函数测试不该被它拖累),三个端点共用一次 import。
 * 只要注入了任意一个(= 测试),其余没注入的一律当"不可用" —— 绝不因为测试漏注入一个函数就去打真实的付费接口。
 */
function makeProviders(input: RelevanceInput): Providers {
  const injected = !!(input.serpFn || input.keywordOverviewFn || input.bulkRanksFn);
  let loading: Promise<{ dfs: Dfs | null; why: string | null }> | null = null;
  const load = (): Promise<{ dfs: Dfs | null; why: string | null }> => {
    if (!loading) {
      loading = (async () => {
        try {
          const dfs = await import("./dataforseo");
          return dfs.dfsEnabled() ? { dfs, why: null } : { dfs: null, why: "DataForSEO is not configured on the server" };
        } catch (e) {
          return { dfs: null, why: errText(e) };
        }
      })();
    }
    return loading;
  };
  async function pick<F>(given: F | undefined, make: (dfs: Dfs) => F): Promise<Provided<F>> {
    if (given) return { fn: given, why: null };
    if (injected) return { fn: null, why: "not available in this environment" };
    const { dfs, why } = await load();
    return dfs ? { fn: make(dfs), why: null } : { fn: null, why };
  }
  return {
    serp: () =>
      pick<SerpFn>(input.serpFn, (dfs) => (kw, opts) => dfs.fetchSerpAdvanced(kw, { depth: SERP_DEPTH, loadAiOverview: opts?.loadAiOverview === true })),
    overview: () => pick<KeywordOverviewFn>(input.keywordOverviewFn, (dfs) => (kws) => dfs.fetchKeywordOverview(kws)),
    ranks: () => pick<BulkRanksFn>(input.bulkRanksFn, (dfs) => (ds) => dfs.fetchBulkRanks(ds)),
  };
}

/** 同步抛错也收成 rejected promise,统一走 withinDeadline 的失败分支 */
function invoke<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
}

/* ---------- SERP 快照的防御性规范化(reputation.ts 复用) ---------- */

function httpUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > MAX_URL_CHARS) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

function domainOf(domain: unknown, url: string): string {
  return typeof domain === "string" && domain.trim() ? registrableDomain(domain) : registrableDomain(hostOf(url));
}

function linkOf(v: unknown): { domain: string; url: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { domain?: unknown; url?: unknown };
  const url = httpUrl(o.url);
  return url ? { domain: domainOf(o.domain, url), url } : null;
}

function linkList(v: unknown, max: number): { domain: string; url: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { domain: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const l = linkOf(x);
    if (!l || seen.has(l.url)) continue;
    seen.add(l.url);
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

function organicList(v: unknown): SerpSnapshot["organic"] {
  if (!Array.isArray(v)) return [];
  const out: SerpSnapshot["organic"] = [];
  v.forEach((x, i) => {
    if (!x || typeof x !== "object") return;
    const o = x as { url?: unknown; domain?: unknown; position?: unknown; title?: unknown };
    const url = httpUrl(o.url);
    if (!url) return;
    const position = typeof o.position === "number" && Number.isFinite(o.position) && o.position > 0 ? o.position : i + 1;
    out.push({ url, domain: domainOf(o.domain, url), position, title: typeof o.title === "string" ? clipText(collapse(o.title), 300) : "" });
  });
  return out;
}

function ratingList(v: unknown): SerpSnapshot["ratings"] {
  if (!Array.isArray(v)) return [];
  const out: SerpSnapshot["ratings"] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as { url?: unknown; domain?: unknown; value?: unknown; votes?: unknown };
    const url = httpUrl(o.url);
    const value = finiteOrNull(o.value);
    if (!url || value === null || value < 0) continue;
    const votes = finiteOrNull(o.votes);
    out.push({ domain: domainOf(o.domain, url), url, value, votes: votes !== null && votes >= 0 ? Math.round(votes) : null });
    if (out.length >= MAX_RATINGS) break;
  }
  return out;
}

/**
 * 任何来源的 SERP 结果 → 完整的 SerpSnapshot:缺字段退到空值、脏条目丢掉、数组截断。
 * 生产来源 dataforseo.fetchSerpAdvanced 已经解析过,这里是第二道防线 —— 测试桩、旧形状(v3 的自然结果数组)
 * 与数据库里沿用的上一份版面都走同一个入口,下游不必到处判空。
 */
export function normalizeSerpSnapshot(raw: unknown): SerpSnapshot {
  const out: SerpSnapshot = { organic: [], itemTypes: [], aiOverview: null, featuredSnippet: null, paa: [], knowledgeGraph: false, ratings: [] };
  if (Array.isArray(raw)) {
    out.organic = organicList(raw);
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  out.organic = organicList(r.organic);
  out.itemTypes = stringList(r.itemTypes, MAX_SERP_TYPES, 60);
  if (r.aiOverview && typeof r.aiOverview === "object") {
    const a = r.aiOverview as { present?: unknown; loaded?: unknown; references?: unknown };
    out.aiOverview = { present: a.present !== false, loaded: a.loaded === true, references: linkList(a.references, MAX_AI_REFERENCES) };
  }
  out.featuredSnippet = linkOf(r.featuredSnippet);
  out.paa = stringList(r.paa, MAX_PAA);
  out.knowledgeGraph = r.knowledgeGraph === true;
  out.ratings = ratingList(r.ratings);
  return out;
}

/* ---------- 主域与 UGC ---------- */

/**
 * 托管平台:子域是各自独立的站(foo.blogspot.com),不能归并到平台主域 —— 否则拿到平台本身的高权威,
 * "小站"被当成"强站",S13 的低权威弱位就漏了。与 dataforseo.ts fetchBulkRanks 的归并口径逐条一致
 * (那边按这个规则查 bulk_ranks,这边按同一规则去重、对键)。
 */
const HOSTING_SUFFIXES = [
  "blogspot.com", "wordpress.com", "github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "herokuapp.com",
  "wixsite.com", "weebly.com", "substack.com", "tumblr.com", "hashnode.dev", "webflow.io", "notion.site",
];

/**
 * 主域(竞品权威按主域查,与 ranked_keywords 的 avg_backlinks_info.main_domain_rank 同口径):
 * blog.hubspot.com → hubspot.com;news.bbc.co.uk → bbc.co.uk;foo.blogspot.com 保留;IP 原样返回。
 * 接受主机名或完整 URL。
 */
export function mainDomain(hostOrUrl: string): string {
  const raw = String(hostOrUrl ?? "").trim();
  const host = registrableDomain(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? hostOf(raw) : raw.replace(/[/?#].*$/, "").replace(/:\d+$/, ""));
  if (!host || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return host;
  const parts = host.split(".").filter(Boolean);
  const n = parts.length;
  if (n <= 2) return parts.join(".");
  const suffix = HOSTING_SUFFIXES.find((s) => host.endsWith(`.${s}`));
  if (suffix) return parts.slice(-(suffix.split(".").length + 1)).join(".");
  if (SECOND_LEVEL_SUFFIX.has(parts[n - 2]) && parts[n - 1].length === 2) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

/**
 * UGC / 论坛类结果(S13 的"论坛帖"弱位)。规格名单(reddit, quora, stackexchange, stackoverflow, medium, linkedin,
 * facebook, pinterest, tumblr, wikihow, answers.com, github.com/discussions)+ 同类平台(问答网络、社交、托管博客),
 * 再加论坛软件的典型形状:forum. / community. 等子域、/forum/ /threads/ /discussions/ 路径、Discourse 的 /t/slug/123、
 * 问答站的 /questions/123、phpBB / vBulletin 的 viewtopic.php / showthread.php。
 * SERP 里的 discussions_and_forums 元素不带逐条结果(SerpSnapshot 只有元素类型),无法逐条对上 ——
 * 它出现在 pair.serpFeatures 里,计分端可以当查询级信号用。
 */
const UGC_DOMAINS = [
  "reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "superuser.com", "serverfault.com", "askubuntu.com",
  "mathoverflow.net", "medium.com", "linkedin.com", "facebook.com", "pinterest.com", "tumblr.com", "wikihow.com", "answers.com",
  "news.ycombinator.com", "x.com", "twitter.com", "instagram.com", "tiktok.com", "youtube.com", "substack.com", "blogspot.com",
  "wordpress.com", "dev.to", "hubpages.com", "fandom.com",
];
const FORUM_SUBDOMAIN = /^(?:forum|forums|community|communities|discuss|discussion|discussions|answers|boards)\./;
const FORUM_PATH = /\/(?:forums?|threads?|discussions?)(?:\/|$)|\/(?:showthread|viewtopic)\.php|\/t\/[^/]+\/\d+(?:\/|$)|\/questions\/\d+(?:\/|$)/;

export function isUgcUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = registrableDomain(u.hostname);
  const path = u.pathname.toLowerCase();
  if (UGC_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  // GitHub 只有讨论区与 issue 是 UGC;仓库主页、文档不是
  if (host === "github.com") return /\/discussions(?:\/|$)/.test(path) || /^\/[^/]+\/[^/]+\/issues\/\d+/.test(path);
  // 子域形状只认真正的子域:discuss.io 这种公司主域不是论坛
  if (host.split(".").length >= 3 && FORUM_SUBDOMAIN.test(host)) return true;
  return FORUM_PATH.test(path);
}

/** SERP 结果 → 竞品:排除本站(含子域),按 URL 去重,按名次取前 perQuery 个(规格 §3.4) */
function competitorRefs(items: SerpSnapshot["organic"], domain: string, perQuery: number): CompetitorRef[] {
  const out: CompetitorRef[] = [];
  const seen = new Set<string>();
  const sorted = [...(Array.isArray(items) ? items : [])]
    .filter((it) => !!it && typeof it.url === "string")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const it of sorted) {
    let u: URL;
    try {
      u = new URL(it.url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (isOwnHost(u.hostname, domain)) continue;
    const key = dedupeKey(u.href);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: u.href, domain: registrableDomain(u.hostname), position: it.position, title: typeof it.title === "string" ? it.title : "" });
    if (out.length >= perQuery) break;
  }
  return out;
}

/* ---------- SERP 版面(AI 摘要 / 精选摘要 / PAA) ---------- */

function ownLink(l: { domain: string; url: string }, domain: string): boolean {
  return isOwnHost(hostOf(l.url) || l.domain, domain);
}

function extrasFromSnapshot(snap: SerpSnapshot, domain: string): SerpExtras {
  const ai = snap.aiOverview;
  const references = ai ? ai.references : [];
  return {
    serpFeatures: snap.itemTypes,
    aiOverview: {
      present: ai ? ai.present : snap.itemTypes.includes("ai_overview"),
      loaded: !!ai && ai.loaded,
      // 被引 = 本站(含子域)出现在摘要的引用里;没加载的摘要引用未知,记 false,计分端只看 present && loaded 的
      cited: references.some((r) => ownLink(r, domain)),
      references,
    },
    featuredSnippet: snap.featuredSnippet ? { ...snap.featuredSnippet, own: ownLink(snap.featuredSnippet, domain) } : null,
    paa: snap.paa,
  };
}

/** 上一份的 SERP 版面(jsonb):走同一个规范化入口,cited / own 按本站域名重新判;上次没做 live SERP → null */
function extrasFromReuse(p: RelevancePair, domain: string): SerpExtras | null {
  if (!Array.isArray(p.serpFeatures)) return null;
  return extrasFromSnapshot(
    normalizeSerpSnapshot({ itemTypes: p.serpFeatures, aiOverview: p.aiOverview ?? null, featuredSnippet: p.featuredSnippet ?? null, paa: p.paa }),
    domain
  );
}

/* ============================================================
   单对的组装
   ============================================================ */

interface Draft extends Candidate {
  page: CrawledPage;
  format: PageFormat;
  topics: Topic[];
  align: ReturnType<typeof alignmentFor>;
  /** 这一对要比的竞品;null = 没做 SERP 对比 */
  refs: CompetitorRef[] | null;
  /** 这次要调 live SERP(占一个 maxSerp 名额) */
  wantsSerp: boolean;
}

/** ISO 日期(YYYY-MM-DD);解析不了或年份离谱 → null */
function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  return y >= 1990 && y <= 2100 ? d.toISOString().slice(0, 10) : null;
}

/** 竞品页最后一次已知更新:dateModified 与 datePublished 取较晚的(只有发布日期就用发布日期) */
function lastUpdated(c: PageContentSignals | undefined): string | null {
  const days = [isoDay(c?.dateModified), isoDay(c?.datePublished)].filter((d): d is string => !!d).sort();
  return days.length ? days[days.length - 1] : null;
}

function competitorSignals(ref: CompetitorRef, fetched: FetchedPage | undefined): { signals: CompetitorPageSignals; topics: Topic[] | null } {
  const page = fetched?.page ?? null;
  if (!page) {
    // 没抓到的竞品:形态只能按 SERP 标题 + URL 估(不参与 serpFormat 计票)
    const format = classifyFormat({ url: ref.url, title: ref.title, pageType: pageTypeFor(ref.url, []) });
    return {
      signals: {
        url: ref.url,
        domain: ref.domain,
        position: ref.position,
        title: clipText(collapse(ref.title), 200),
        h1: "",
        wordCount: 0,
        format,
        headings: [],
        numbers: 0,
        tables: 0,
        orderedLists: 0,
        images: 0,
        fetched: false,
        error: clipText(fetched?.error ?? "Not fetched", 200),
        dateModified: null,
        ugc: isUgcUrl(ref.url),
      },
      topics: null,
    };
  }
  const c = page.content;
  const topics = pageTopics(page);
  return {
    signals: {
      url: ref.url,
      domain: ref.domain,
      position: ref.position,
      title: clipText(collapse(page.title || ref.title), 200),
      h1: clipText(collapse(page.h1s?.[0] ?? ""), 200),
      wordCount: c?.mainWords ?? page.wordCount,
      format: classifyFormat(page),
      headings: topics.slice(0, MAX_HEADINGS_PER_PAGE).map((t) => t.tokens.join(" ")),
      numbers: c?.numberCount ?? 0,
      tables: c?.tableCount ?? 0,
      orderedLists: c?.orderedListCount ?? 0,
      images: c ? c.imagesSelfHosted + c.imagesStock : page.images?.total ?? 0,
      fetched: true,
      dateModified: lastUpdated(c),
      ugc: isUgcUrl(ref.url) || (!!page.finalUrl && isUgcUrl(page.finalUrl)),
    },
    topics,
  };
}

interface PairContext {
  brands: string[];
  /** 日期早于这个时刻算"过时"(18 个月前) */
  staleBefore: number;
  /** 主域 → 权威(bulk_ranks;沿用模式是上一份的值) */
  ranks: Map<string, number | null>;
}

function rankOf(ranks: Map<string, number | null>, ref: CompetitorRef): number | null {
  const v = ranks.get(mainDomain(hostOf(ref.url) || ref.domain));
  return v === undefined ? ref.rank ?? null : v;
}

/** 查询核心词在标题里的覆盖(0–1):SERP 标题与页面标题取较高的 —— Google 常改写标题,哪个对得上都算切题 */
function titleOverlap(core: string[], titles: string[]): number {
  if (!core.length) return 1;
  let best = 0;
  for (const t of titles) {
    const set = stemmedSet(t ?? "");
    best = Math.max(best, core.filter((c) => set.has(c)).length / core.length);
  }
  return best;
}

/**
 * S13 弱位(规格 v2 §4 winnability.serpweakness),顺序固定:
 *   forum         —— UGC / 论坛帖(isUgcUrl);
 *   stale         —— 最后更新(dateModified,没有就 datePublished)早于 18 个月;没日期不标;
 *   thin          —— 抓到了且主体 < 500 词;
 *   off-intent    —— 标题与查询核心词重合 < 1/3,或(抓到的)形态与主流形态不兼容("other" 是认不出形态,不算证据);
 *   low-authority —— 主域权威非空且 < 100。"≤ 本站 rank" 那一半要本站外链数据,这里拿不到,由 ranking.ts 补判。
 */
function weakSpotsFor(s: CompetitorPageSignals, ref: CompetitorRef, core: string[], serpFormat: PageFormat | null, staleBefore: number): string[] {
  const out: string[] = [];
  if (s.ugc) out.push("forum");
  const updated = s.dateModified ? Date.parse(s.dateModified) : NaN;
  if (Number.isFinite(updated) && updated < staleBefore) out.push("stale");
  if (s.fetched && s.wordCount < THIN_WORDS) out.push("thin");
  const offTitle = titleOverlap(core, [ref.title, s.title]) < OFF_INTENT_OVERLAP;
  const offFormat = s.fetched && serpFormat !== null && serpFormat !== "other" && s.format !== "other" && !compatible(s.format, serpFormat);
  if (offTitle || offFormat) out.push("off-intent");
  if (typeof s.domainRank === "number" && s.domainRank < LOW_AUTHORITY_RANK) out.push("low-authority");
  return out;
}

function buildPair(d: Draft, fetchedByKey: Map<string, FetchedPage>, ctx: PairContext, notes: string[]): RelevancePair {
  const signals: CompetitorPageSignals[] = [];
  const refsOf: CompetitorRef[] = [];
  const fetchedSignals: CompetitorPageSignals[] = [];
  const fetchedTopics: Topic[][] = [];
  for (const ref of d.refs ?? []) {
    const { signals: s, topics } = competitorSignals(ref, fetchedByKey.get(dedupeKey(ref.url)));
    signals.push(s);
    refsOf.push(ref);
    if (s.fetched && topics) {
      fetchedSignals.push(s);
      fetchedTopics.push(topics);
    }
  }
  const compared = fetchedSignals.length > 0;
  const cov = compared ? coverageFromTopics(d.topics, fetchedTopics) : null;
  if (cov && fetchedSignals.length >= 2 && cov.coverage === null) {
    notes.push(
      cov.shared === 0
        ? `The top-ranking pages for "${d.query}" have no subtopics in common, so semantic coverage is not scored for that query.`
        : `Only ${cov.shared} subtopic${cov.shared === 1 ? " is" : "s are"} shared by the top-ranking pages for "${d.query}", too few to score semantic coverage for that query.`
    );
  }
  const serpFormat = dominantFormat(fetchedSignals);
  // v4:竞品主域权威 + S13 弱位(形态弱位要用主流形态,所以放在 serpFormat 之后)
  let core = coreTokens(d.query, ctx.brands);
  if (!core.length) core = coreTokens(d.query, []);
  signals.forEach((s, i) => {
    s.domainRank = rankOf(ctx.ranks, refsOf[i]);
    s.weakSpots = weakSpotsFor(s, refsOf[i], core, serpFormat, ctx.staleBefore);
  });
  const own = d.page.content;
  // 没有竞品时基准记 0(= 本页绝对数):计分端据 competitors 里有没有 fetched 来区分口径(规格 §4 relevance.gain)
  const baseline = (xs: number[]) => (xs.length ? median(xs) : 0);
  const pair: RelevancePair = {
    query: d.query,
    source: d.source,
    volume: d.volume,
    position: d.position,
    intent: d.intent,
    intentSource: d.intentSource,
    url: d.url,
    pageFormat: d.format,
    serpFormat,
    intentMatch: judgeIntent(d.intent, d.intentGuessed, d.format, serpFormat),
    titleAlignment: d.align.title,
    h1Alignment: d.align.h1,
    answerEarly: d.align.answerEarly,
    coverage: cov ? cov.coverage : null,
    coveredTopics: cov ? cov.covered : [],
    missingTopics: cov ? cov.missing : [],
    uniqueTopics: cov ? cov.unique : [],
    gainSignals: {
      uniqueTopics: cov ? cov.uniqueCount : 0,
      extraNumbers: Math.max(0, Math.round((own?.numberCount ?? 0) - baseline(fetchedSignals.map((s) => s.numbers)))),
      extraTables: Math.max(0, Math.round((own?.tableCount ?? 0) - baseline(fetchedSignals.map((s) => s.tables)))),
      ownImages: own?.imagesSelfHosted ?? 0,
      experienceMarkers: own?.experienceMarkers ?? 0,
    },
    competitors: signals,
  };
  // v4:Labs 字段(undefined = 没有这项数据,不写键);SERP 版面只在做过 live SERP(或沿用上一份)时写
  if (d.kd !== undefined) pair.kd = d.kd;
  if (d.serpItemTypes !== undefined) pair.serpItemTypes = d.serpItemTypes;
  if (d.avgTopDomainRank !== undefined) pair.avgTopDomainRank = d.avgTopDomainRank;
  if (d.rankChange !== undefined) pair.rankChange = d.rankChange;
  if (d.volumeTrend !== undefined) pair.volumeTrend = d.volumeTrend;
  if (d.serpExtras) {
    pair.serpFeatures = d.serpExtras.serpFeatures;
    pair.aiOverview = d.serpExtras.aiOverview;
    pair.featuredSnippet = d.serpExtras.featuredSnippet;
    pair.paa = d.serpExtras.paa;
  }
  return pair;
}

/* ============================================================
   主流程
   ============================================================ */

/**
 * 相关性分析(规格 §3 + v2 §3.4)。永不抛:失败写 notes,预算内做不完的部分跳过并注明。
 * 成本(每笔都由 dataforseo.ts 记账):SERP ≤ maxSerpQueries 次(Labs 显示有 AI 摘要的词多 $0.002)、
 * keyword_overview ≤1 次、bulk_ranks ≤1 次;重跑(reuse 且不刷新)只为新加的目标词调 SERP + ≤1 次 keyword_overview,
 * bulk_ranks 只为上一份没出现过的竞品主域调(≤1 次,没有就不调)。
 */
export async function analyzeRelevance(input: RelevanceInput): Promise<RelevanceAnalysis> {
  const out: RelevanceAnalysis = { pairs: [], serpCalls: 0, competitorPagesFetched: 0, notes: [], otherCalls: 0, targetKeywords: [] };
  try {
    await runAnalysis(input, out);
  } catch (e) {
    // 只有代码缺陷会走到这里:已完成的对照常返回,原因写进 notes(契约:永不抛)
    out.notes.push(`The comparison with top-ranking pages stopped early: ${errText(e)}`);
  }
  return out;
}

interface Clock {
  deadline: number;
  now: () => number;
}

interface Selection {
  input: RelevanceInput;
  pages: CrawledPage[];
  domain: string;
  brands: string[];
  index: Map<string, CrawledPage>;
  ranked: OwnRanked[];
  targets: string[];
  reuseMode: boolean;
  maxPairs: number;
  net: Net;
  siteTemplate: Set<string>;
  notes: string[];
}

async function runAnalysis(input: RelevanceInput, out: RelevanceAnalysis): Promise<void> {
  const notes = out.notes;
  const clock = input.now ?? Date.now;
  const time: Clock = { deadline: clock() + Math.max(0, Number(input.budgetMs) || 0), now: clock };
  const pages = Array.isArray(input.pages) ? input.pages.filter((p) => !!p && typeof p.url === "string") : [];
  const domain = registrableDomain(input.domain || input.host || "");
  const brands = brandTokensFor(domain, pages);
  const maxPairs = clampInt(input.maxPairs, DEFAULT_MAX_PAIRS, 1, 10);
  const maxSerp = clampInt(input.maxSerpQueries, DEFAULT_MAX_SERP, 0, 10);
  const perQuery = clampInt(input.competitorsPerQuery, DEFAULT_COMPETITORS, 1, 10);
  // 沿用模式:给了 reuse 且不是付费刷新 —— 只有新加的目标词调 SERP(成本保证,与 reuse 里有没有对无关)
  const reuseMode = !!input.reuse && !input.refreshSerp;
  const targets = normalizeTargets(input.targetKeywords);
  out.targetKeywords = targets;

  if (!pages.length) {
    notes.push("No crawled pages were available, so no page could be compared with search results.");
    return;
  }
  const net = makeNet(input, time.deadline);
  const providers = makeProviders(input);

  /* ---- 1. 选对 + 定位目标页 ---- */
  const drafts = await selectDrafts({
    input,
    pages,
    domain,
    brands,
    index: indexPages(pages),
    ranked: ownRankedKeywords(input.visibility, domain),
    targets,
    reuseMode,
    maxPairs,
    net,
    siteTemplate: templateHeadings(pages),
    notes,
  });
  if (!drafts.length) {
    notes.push("No crawled page had a clear topic to test against search results (no usable homepage or content page with a heading).");
    return;
  }

  /* ---- 2. 竞品来源:按对的顺序占 maxSerp 个名额(live SERP 或沿用上次的竞品 URL) ---- */
  // 名额同时是竞品页抓取量的上限(/bot 页公开的 DEFAULT_MAX_SERP × DEFAULT_COMPETITORS),沿用的对也占名额
  let slots = maxSerp;
  for (const d of drafts) {
    if (slots <= 0) break;
    if (d.serpMode === "live") {
      d.wantsSerp = true;
      slots -= 1;
    } else if (d.serpMode === "reuse" && d.reuseRefs) {
      d.refs = d.reuseRefs.slice(0, perQuery);
      slots -= 1;
    }
  }
  if (reuseMode && drafts.every((d) => !d.wantsSerp && d.refs === null)) {
    notes.push("Search results are only queried on the first paid run and on paid refreshes, so this re-run has no competitor comparison.");
  }

  /* ---- 3. 关键词概览(≤1 次)∥ SERP:每对只等自己需要的数据 ---- */
  const overview = loadOverview(
    drafts.filter((d) => d.needsOverview),
    providers,
    out,
    time
  );
  const serpNotes = await loadSerp(
    drafts.filter((d) => d.wantsSerp),
    overview,
    providers,
    out,
    time,
    domain,
    perQuery
  );
  // notes 按固定顺序写(概览 → SERP),与哪个调用先回来无关,同一站点两次运行的 notes 一致
  notes.push(...(await overview), ...serpNotes);

  /* ---- 4. 抓竞品页(全部唯一 URL 一起排队:并发 4)∥ 竞品主域权威(≤1 次 bulk_ranks;沿用模式用上一份的值) ---- */
  const jobs = new Map<string, Promise<FetchedPage>>();
  for (const d of drafts) {
    for (const ref of d.refs ?? []) {
      const key = dedupeKey(ref.url);
      if (!jobs.has(key)) jobs.set(key, fetchPage(net, ref.url, { strictRobots: true, parseHost: null, ownDomain: domain }));
    }
  }
  // 沿用模式:上一份查过的主域直接用(含查过但没有数据的 null,免得每次重跑都为同一个域名再花钱),
  // 只为上一份从没出现过的主域(通常是新加目标词的竞品)调一次;一个都没有就不调(集成方决定,2026-10-02)
  const ranksJob = loadRanks(drafts, providers, out, time, reuseMode ? carriedRanks(drafts) : new Map<string, number | null>());
  const fetchedByKey = new Map<string, FetchedPage>();
  const [, ranks] = await Promise.all([Promise.all([...jobs.entries()].map(async ([key, job]) => fetchedByKey.set(key, await job))), ranksJob]);
  out.competitorPagesFetched = [...fetchedByKey.values()].filter((f) => f.page !== null).length;
  noteCompetitorFailures([...jobs.keys()].map((k) => fetchedByKey.get(k) as FetchedPage), notes);
  notes.push(...ranks.notes);

  /* ---- 5. 每对的对比 ---- */
  const ctx: PairContext = { brands, staleBefore: monthsBefore(clock(), STALE_MONTHS), ranks: ranks.ranks };
  out.pairs = drafts.map((d) => buildPair(d, fetchedByKey, ctx, notes));

  const missingSignals =
    drafts.filter((d) => d.page.content === undefined).length + [...fetchedByKey.values()].filter((f) => f.page && f.page.content === undefined).length;
  if (missingSignals > 0) {
    notes.push(
      `Content signals were unavailable for ${missingSignals} analysed page${missingSignals === 1 ? "" : "s"}; information gain and answer-first checks for them use reduced data.`
    );
  }
}

function monthsBefore(ms: number, months: number): number {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

function listQuoted(items: string[], max = 5): string {
  const q = items.slice(0, max).map((s) => `"${s}"`);
  const more = items.length - q.length;
  if (more > 0) return `${q.join(", ")} and ${more} more`;
  return q.length <= 1 ? q.join("") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}

/**
 * 选对。重跑(沿用模式):用户目标词按当前顺序在前(沿用的或新加的),其余沿用的对保持上次的顺序;
 * 首次付费 / 付费刷新(或沿用的对一个都用不上):目标词 → 排名词 → 不足 3 对时补页面主题词。
 * 重跑不补页面主题词:同一份报告两次运行比的是同一批查询,分数才可比。
 */
async function selectDrafts(s: Selection): Promise<Draft[]> {
  const { input, notes } = s;
  const resolve = (cands: Candidate[], max: number) => resolveTargets(cands, max, s.net, input, s.domain, s.brands, s.siteTemplate, notes);

  if (s.reuseMode && input.reuse) {
    const { candidates: reused, dropped } = reuseCandidates(input.reuse, s.brands, s.domain, s.index, s.ranked, new Set(s.targets));
    if (dropped.length) {
      notes.push(
        `${dropped.length === 1 ? "The target keyword" : "The target keywords"} ${listQuoted(dropped)} ${dropped.length === 1 ? "was" : "were"} removed, so ${
          dropped.length === 1 ? "its comparison is" : "their comparisons are"
        } no longer shown.`
      );
    }
    if (reused.length) {
      const have = new Set(reused.map((c) => c.query));
      const fresh = targetCandidates(
        s.targets.filter((t) => !have.has(t)),
        s.ranked,
        s.pages,
        s.index,
        s.brands,
        s.domain,
        notes
      );
      const byQuery = new Map<string, Candidate>();
      for (const c of [...reused, ...fresh]) if (!byQuery.has(c.query)) byQuery.set(c.query, c);
      const ordered = [...s.targets.map((t) => byQuery.get(t)).filter((c): c is Candidate => !!c), ...reused.filter((c) => c.source !== "target")];
      const drafts = await resolve(ordered, s.maxPairs);
      if (drafts.length) {
        noteRerun(drafts, notes);
        return drafts;
      }
    }
  }

  const targets = targetCandidates(s.targets, s.ranked, s.pages, s.index, s.brands, s.domain, notes);
  // 退到首页的目标词不"占"首页:首页自己的排名词照样分析
  const claimed = new Set(targets.filter((c) => !c.fallbackPage).map((c) => dedupeKey(c.url)));
  const ranking = rankingCandidates(s.ranked, s.brands, s.index, new Set(s.targets), claimed);
  // 沿用模式退到这里(上一份没有可用的对):目标词照"新词"调 SERP,其余一律不调
  if (s.reuseMode) for (const c of ranking) c.serpMode = "none";
  let drafts = await resolve([...targets, ...ranking], s.maxPairs);
  const want = Math.min(MIN_PAIRS, s.maxPairs);
  if (drafts.length < want) {
    const fill = pageTopicCandidates(s.pages, s.brands, { urls: urlKeysOf(drafts), queries: new Set(drafts.map((d) => d.query)) }, want - drafts.length);
    if (s.reuseMode) {
      for (const c of fill) {
        c.serpMode = "none";
        c.needsOverview = false;
      }
    }
    const more = await resolve(fill, want - drafts.length);
    if (more.length) notes.push(pageTopicReason(input.visibility, s.domain, { candidates: ranking.length, ownKeywords: s.ranked.length }, drafts));
    drafts = drafts.concat(more);
  }
  return drafts;
}

function noteRerun(drafts: Draft[], notes: string[]): void {
  const reused = drafts.filter((d) => d.serpMode === "reuse");
  const refs = reused.reduce((n, d) => n + (d.reuseRefs?.length ?? 0), 0);
  const fresh = drafts.filter((d) => d.serpMode === "live").length;
  const what = fresh
    ? `search results were looked up again only for ${fresh} new target keyword${fresh === 1 ? "" : "s"}`
    : "search results were not queried again";
  notes.push(
    `Re-run: reused ${reused.length} ${reused.length === 1 ? "query" : "queries"} and ${refs} competitor URL${refs === 1 ? "" : "s"} from the first paid run; ${what} (competitor pages were re-fetched).`
  );
}

function pageTopicReason(vis: VisibilityResult | null, domain: string, ranking: { candidates: number; ownKeywords: number }, existing: Draft[]): string {
  const tail = existing.length
    ? "so the main topic of the homepage or the most-linked content pages was added to reach three queries."
    : "so each query below is the main topic of the page itself (the homepage and the two most-linked content pages).";
  const rankingUsed = existing.filter((d) => d.source === "ranking").length;
  if (rankingUsed) return `Only ${rankingUsed} ranking keyword${rankingUsed === 1 ? "" : "s"} on ${domain} could be analysed, ${tail}`;
  if (ranking.candidates > 0) return `None of the ranking pages on ${domain} could be analysed, ${tail}`;
  if (ranking.ownKeywords > 0) return `The ranking keywords on ${domain} point at the pages already analysed for your target keywords, ${tail}`;
  if (!vis) return `Ranking data was not available for this report, ${tail}`;
  if (vis.noData) return `DataForSEO has no ranking keywords for ${domain} yet, ${tail}`;
  return `None of the ranking keywords pointed at a page on ${domain}, ${tail}`;
}

/**
 * 候选 → 目标页。在抓取集合里的直接用;不在的单独抓一次(robots 照爬虫口径)。
 * 抓不到 / 用不了:目标词有备选页就用备选页(并注明),否则跳过并注明,顺延到下一个候选,直到凑满 maxPairs 或候选用完。
 */
async function resolveTargets(
  cands: Candidate[],
  maxPairs: number,
  net: Net,
  input: RelevanceInput,
  domain: string,
  brands: string[],
  siteTemplate: Set<string>,
  notes: string[]
): Promise<Draft[]> {
  const out: Draft[] = [];
  let i = 0;
  let fetches = 0;
  while (out.length < maxPairs && i < cands.length) {
    const batch = cands.slice(i, i + (maxPairs - out.length));
    i += batch.length;
    // 批内并行,结果与 notes 按候选顺序收,保证可复现
    const results = await Promise.all(
      batch.map(async (c): Promise<{ page: CrawledPage | null; alt: boolean; note: string | null }> => {
        const what = c.source === "ranking" ? "ranking page" : "page";
        let problem: string;
        if (c.page) {
          const why = unusableReason(c.page);
          if (!why) return { page: c.page, alt: false, note: null };
          problem = `could not be analysed (${why})`;
        } else if (fetches >= MAX_TARGET_FETCHES) {
          if (!c.alt) return { page: null, alt: false, note: null };
          problem = `was not fetched (the limit of ${MAX_TARGET_FETCHES} extra page fetches was reached)`;
        } else {
          fetches += 1;
          const r = await fetchPage(net, c.url, { strictRobots: false, parseHost: input.host || domain, ownDomain: null });
          if (!r.page) {
            problem = `is not in the crawl and could not be fetched (${r.outcome === "budget" ? "time budget reached" : r.error ?? "not fetched"})`;
          } else {
            const why = unusableReason(r.page);
            if (!why) return { page: r.page, alt: false, note: null };
            problem = `could not be analysed (${why})`;
          }
        }
        const head = `The ${what} ${c.url} for "${c.query}" ${problem}`;
        if (c.alt && unusableReason(c.alt) === null && dedupeKey(c.alt.url) !== dedupeKey(c.url)) {
          return { page: c.alt, alt: true, note: `${head}, so the closest matching crawled page ${c.alt.url} was compared instead.` };
        }
        return { page: null, alt: false, note: `${head}; that query was skipped.` };
      })
    );
    results.forEach((r, k) => {
      if (r.note) notes.push(r.note);
      if (!r.page) return;
      const c = batch[k];
      const draft: Draft = {
        ...c,
        page: r.page,
        format: classifyFormat(r.page),
        topics: pageTopics(r.page, siteTemplate),
        align: alignmentFor(c.query, brands, r.page),
        refs: null,
        wantsSerp: false,
      };
      if (r.alt) {
        // 换了页:名次与名次变化属于原来那个排名 URL,搬到备选页上就是错的;量 / 难度是词的属性,照留
        draft.url = r.page.url;
        draft.position = null;
        delete draft.rankChange;
      }
      out.push(draft);
    });
  }
  return out;
}

/**
 * 关键词概览(≤1 次,规格 v2 §3.4):目标词(排名数据里没有的)与页面主题词的量 / 难度 / 意图 / SERP 元素 /
 * 前 10 平均权威 / 量趋势。数据库里没有的词 volume = kd = null,并写 "No search demand recorded for …"。
 * 失败只写 note;返回的 notes 由调用方按固定顺序写入。永不 reject(SERP 会等它)。
 */
async function loadOverview(drafts: Draft[], providers: Providers, out: RelevanceAnalysis, time: Clock): Promise<string[]> {
  try {
    const queries = [...new Set(drafts.map((d) => d.query))].slice(0, OVERVIEW_MAX_KEYWORDS);
    if (!queries.length) return [];
    const label = `${queries.length} ${queries.length === 1 ? "query" : "queries"}`;
    if (time.deadline - time.now() < MIN_OTHER_CALL_MS) return [`There was not enough time left to look up search volume and difficulty for ${label}.`];
    const p = await providers.overview();
    if (!p.fn) return [`Search volume and difficulty for ${label} could not be looked up (${p.why ?? "keyword data unavailable"}).`];
    const fn = p.fn;
    out.otherCalls = (out.otherCalls ?? 0) + 1;
    // 概览之后还要调 SERP:等它的时间封顶,迟到的结果丢弃(钱已花,但不能拖垮整个对比)
    const r = await withinDeadline(
      invoke(() => fn(queries)),
      Math.min(time.deadline, time.now() + OVERVIEW_WAIT_MS),
      time.now
    );
    if (!r.ok) {
      return [
        r.timedOut
          ? `Search volume and difficulty for ${label} took too long to load and were skipped.`
          : `Search volume and difficulty for ${label} could not be loaded (${errText(r.error)}).`,
      ];
    }
    const byQuery = new Map<string, KeywordOverview>();
    for (const o of Array.isArray(r.value) ? r.value : []) {
      if (!o || typeof o.keyword !== "string") continue;
      const k = normalizeQuery(o.keyword);
      if (!byQuery.has(k)) byQuery.set(k, o);
    }
    const noDemand: string[] = [];
    for (const d of drafts) {
      if (!queries.includes(d.query)) continue;
      applyOverview(d, byQuery.get(d.query) ?? null);
      if (!d.volume && !noDemand.includes(d.query)) noDemand.push(d.query);
    }
    return noDemand.length
      ? [`No search demand recorded for ${listQuoted(noDemand)} (DataForSEO has no search volume for ${noDemand.length === 1 ? "it" : "them"}).`]
      : [];
  } catch (e) {
    return [`Search volume and difficulty could not be loaded (${errText(e)}).`];
  }
}

/** 概览 → 这一对:数据库里没有这个词 → 量 / 难度 / 平均权威 / 趋势为 null、SERP 元素为 [](= 查过、没有) */
function applyOverview(d: Draft, o: KeywordOverview | null): void {
  d.volume = o ? finiteOrNull(o.volume) : null;
  d.kd = o ? finiteOrNull(o.kd) : null;
  d.serpItemTypes = o ? stringList(o.serpItemTypes, MAX_SERP_TYPES, 60) : [];
  d.avgTopDomainRank = o ? finiteOrNull(o.avgTopDomainRank) : null;
  d.volumeTrend = o ? trendOf(o.volumeTrend) : null;
  const fromDfs = o ? dfsIntent(o.intent) : null;
  if (fromDfs) {
    d.intent = fromDfs;
    d.intentSource = "dataforseo";
    d.intentGuessed = false;
  }
}

/**
 * 占了名额的对并行取 SERP(advanced)。目标词 / 页面主题词先等概览:它决定这次要不要多花 $0.002 加载 AI 摘要
 * (只在 Labs 数据的 serpItemTypes 含 "ai_overview" 时加载)。每个调用都限在 deadline 内;返回的 notes 按对的顺序。
 */
async function loadSerp(
  drafts: Draft[],
  overview: Promise<unknown>,
  providers: Providers,
  out: RelevanceAnalysis,
  time: Clock,
  domain: string,
  perQuery: number
): Promise<string[]> {
  if (!drafts.length) return [];
  if (time.deadline - time.now() < MIN_SERP_BUDGET_MS) {
    return ["There was not enough time left in this run to look up the top-ranking pages, so no competitor comparison was made; re-run to compute it."];
  }
  const serp = await providers.serp();
  if (!serp.fn) return [`Top-ranking pages could not be looked up (${serp.why ?? "search data unavailable"}), so no competitor comparison was made.`];
  const fn = serp.fn;
  const perDraft = await Promise.all(
    drafts.map(async (d): Promise<string | null> => {
      if (d.needsOverview) await overview;
      // 等概览可能用掉了时间:SERP 发出去之后还要有时间抓竞品,否则这笔钱换不来任何对比
      if (time.deadline - time.now() < MIN_SERP_BUDGET_MS) {
        return `There was not enough time left to look up the top results for "${d.query}"; that query is scored without competitor comparison.`;
      }
      const loadAiOverview = (d.serpItemTypes ?? []).includes("ai_overview");
      out.serpCalls += 1;
      // 先发出请求再限时:等待上限按"发出之后"的剩余时间算;同步抛错也收成失败结果
      const r = await withinDeadline(
        invoke(() => fn(d.query, { loadAiOverview })),
        time.deadline,
        time.now
      );
      if (!r.ok) {
        return r.timedOut
          ? `The time budget ran out while loading the top results for "${d.query}"; that query is scored without competitor comparison.`
          : `The top results for "${d.query}" could not be loaded (${errText(r.error)}); that query is scored without competitor comparison.`;
      }
      const snap = normalizeSerpSnapshot(r.value);
      d.refs = competitorRefs(snap.organic, domain, perQuery);
      d.serpExtras = extrasFromSnapshot(snap, domain);
      return d.refs.length ? null : `No other site ranked for "${d.query}" in the results we received, so there was nothing to compare against.`;
    })
  );
  return perDraft.filter((n): n is string => !!n);
}

/**
 * 竞品主域权威:这次要比的竞品主域去重(按对的顺序、名次顺序)取前 30 个,调一次 bulk_ranks(规格 v2 §3.4)。
 * known = 已经知道的主域(沿用模式下是上一份的值):不再查,直接并进结果;要查的一个都没有就不调。
 * 与抓竞品页并行 —— 它只依赖 SERP 给出的 URL,不依赖页面内容。永不 reject。
 */
async function loadRanks(
  drafts: Draft[],
  providers: Providers,
  out: RelevanceAnalysis,
  time: Clock,
  known: Map<string, number | null>
): Promise<{ ranks: Map<string, number | null>; notes: string[] }> {
  const ranks = new Map<string, number | null>(known);
  const notes: string[] = [];
  try {
    const domains: string[] = [];
    for (const d of drafts) {
      for (const ref of d.refs ?? []) {
        const m = mainDomain(hostOf(ref.url) || ref.domain);
        // 只发像样的主机名(含字母与点):一个坏目标会让供应商把整单拒掉
        if (m && /[a-z]/.test(m) && m.includes(".") && !known.has(m) && !domains.includes(m)) domains.push(m);
      }
    }
    if (!domains.length) return { ranks, notes };
    const asked = domains.slice(0, BULK_RANKS_MAX_DOMAINS);
    if (asked.length < domains.length) notes.push(`Domain authority was looked up for the first ${asked.length} of ${domains.length} competing sites.`);
    if (time.deadline - time.now() < MIN_OTHER_CALL_MS) {
      notes.push("There was not enough time left to look up the domain authority of the competing sites.");
      return { ranks, notes };
    }
    const p = await providers.ranks();
    if (!p.fn) {
      notes.push(`The domain authority of the competing sites could not be looked up (${p.why ?? "link data unavailable"}).`);
      return { ranks, notes };
    }
    const fn = p.fn;
    out.otherCalls = (out.otherCalls ?? 0) + 1;
    const r = await withinDeadline(
      invoke(() => fn(asked)),
      time.deadline,
      time.now
    );
    if (!r.ok) {
      notes.push(
        r.timedOut
          ? "The time budget ran out while loading the domain authority of the competing sites."
          : `The domain authority of the competing sites could not be loaded (${errText(r.error)}).`
      );
      return { ranks, notes };
    }
    const res = (r.value && typeof r.value === "object" ? r.value : {}) as Record<string, unknown>;
    for (const m of asked) ranks.set(m, finiteOrNull(res[m]));
  } catch (e) {
    notes.push(`The domain authority of the competing sites could not be loaded (${errText(e)}).`);
  }
  return { ranks, notes };
}

/**
 * 沿用模式:上一份查到的竞品主域权威(新加目标词的竞品若是同一主域也直接用上)。
 * 上一份里有这个字段就算"查过"(null = 查过但没有数据);v3 数据没有这个字段,那些主域会在这次补查一次。
 */
function carriedRanks(drafts: Draft[]): Map<string, number | null> {
  const ranks = new Map<string, number | null>();
  for (const d of drafts) {
    for (const ref of d.reuseRefs ?? []) {
      if (ref.rank === undefined) continue;
      const m = mainDomain(hostOf(ref.url) || ref.domain);
      if (m && (!ranks.has(m) || ranks.get(m) === null)) ranks.set(m, ref.rank);
    }
  }
  return ranks;
}

/** 竞品抓取失败按原因汇总成至多 3 条 note(robots / 预算 / 其他) */
function noteCompetitorFailures(results: FetchedPage[], notes: string[]): void {
  const robots = results.filter((r) => r.outcome === "robots").length;
  const budget = results.filter((r) => r.outcome === "budget").length;
  const other = results.filter((r) => r.outcome === "blocked" || r.outcome === "error");
  if (robots) notes.push(`${robots} competitor page${robots === 1 ? " was" : "s were"} not fetched because robots.txt disallows AEOeyeBot (or could not be read).`);
  if (budget) notes.push(`${budget} competitor page${budget === 1 ? " was" : "s were"} skipped because the time budget ran out; comparisons use the pages that were fetched.`);
  if (other.length) {
    const reasons = [...new Set(other.map((r) => r.error ?? "error"))].slice(0, 3).join("; ");
    notes.push(`${other.length} competitor page${other.length === 1 ? "" : "s"} could not be fetched (${reasons}).`);
  }
}
