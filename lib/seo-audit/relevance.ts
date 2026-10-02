/* ============================================================
   SEO Audit · 相关性 / 搜索意图(v3 SEO Ranking Score 的数据层)

   回答"这一页能不能排上这个查询"。不调用大模型:全部用可复现的规则 + 与该查询
   排名前 5 的真实页面逐项对比来量化(规格:docs/design/seo-ranking-score-spec.md §3)。

   流程:
     1. 选"查询 ↔ 本站页面"对:有排名词时取 DataForSEO 的排名词(非品牌词优先、搜索量降序、
        每个 URL 只取一个词,≤5 对);没有排名数据(noData / 新站)时退到"页面自身主题"
        (首页 + 入链最多的 2 个内容页,查询 = H1 或去品牌后的标题)。
     2. 每对算:意图(DataForSEO 优先,否则按模式)、页面形态、标题 / H1 对齐、答案是否前置。
     3. 前 3 对做 SERP 对比:fetchSerpTop 取前 10 条自然结果,排除本站,取前 5 个竞品页,
        用自家爬虫抓(先看该主机 robots.txt;safeFetch 的 SSRF 防线;8 秒 / 2 MB;并发 4;
        同主机间隔 250 ms,Crawl-delay ≤2 秒照做),H2/H3 规范化后比子话题覆盖、独有子话题、
        数据点 / 表格 / 自有图片 / 一手经验。
     4. 重跑(给了 reuse 且不是付费刷新)沿用上次的查询与竞品 URL:零 SERP 调用(每次都是真钱),
        竞品页重新抓 —— 页面会变,对比要用现在的页面。

   永不抛:任何失败都写进 notes;时间预算用完就停手,已完成的部分照常返回。
   ============================================================ */

import { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, safeFetch, type FetchResult, type SafeFetchOptions } from "./fetch";
import { detectBlock, fetchRobots, hasNonHtmlExtension, isHtmlResponse, MIN_HOST_INTERVAL_MS, politeIntervalFor, type Fetcher } from "./crawl";
import { clipText, pageTypeFor, parsePageDetailed } from "./parse";
import { DEFAULT_UA, emptyRobots, isPathAllowed, type RobotsRules } from "./robots";
import { dedupeKey, registrableDomain } from "./url";
import type { SerpOrganicItem } from "./dataforseo";
import type {
  CompetitorPageSignals,
  CrawledPage,
  PageFormat,
  RankedKeyword,
  RelevanceAnalysis,
  RelevancePair,
  SearchIntent,
  VisibilityResult,
} from "./types";

/* ---------- 契约 ---------- */

/** 取某个查询的自然结果(生产 = dataforseo.fetchSerpTop;测试注入假的) */
export type SerpFn = (keyword: string) => Promise<SerpOrganicItem[]>;

export interface RelevanceInput {
  domain: string;
  origin: string;
  host: string;
  pages: CrawledPage[];
  visibility: VisibilityResult | null;
  /** 重跑时复用上次的查询与竞品 URL,不再调 SERP */
  reuse?: RelevanceAnalysis | null;
  /** 付费刷新时为 true:不沿用 reuse,重新调 SERP */
  refreshSerp?: boolean;
  budgetMs: number;
  /** 默认 5 */
  maxPairs?: number;
  /** 默认 3 */
  maxSerpQueries?: number;
  /** 默认 5 */
  competitorsPerQuery?: number;
  /* ---- 测试注入用(生产代码不要传) ---- */
  /** 替代 safeFetch */
  fetcher?: Fetcher;
  /** 替代 fetchSerpTop(给了就不 import dataforseo,也不看 DataForSEO 是否配置) */
  serpFn?: SerpFn;
  /** 替代 parsePageDetailed(测试里用来固定内容信号) */
  parse?: typeof parsePageDetailed;
  /** 同主机请求间隔下限(默认 250 ms;测试设 0) */
  minIntervalMs?: number;
  /** 替代 Date.now(预算判定用的时钟;测试里用假时钟模拟"预算耗尽",不必真等) */
  now?: () => number;
}

/* ---------- 常量 ---------- */

const DEFAULT_MAX_PAIRS = 5;
export const DEFAULT_MAX_SERP = 3;
export const DEFAULT_COMPETITORS = 5;
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
/** 排名 URL 不在抓取集合里时单独抓的上限(失败会顺延到下一个词,这里防止一路抓下去) */
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
   选对(规格 §3.1)
   ============================================================ */

interface CompetitorRef {
  url: string;
  domain: string;
  position: number;
  title: string;
}

interface Candidate {
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
 * 有排名数据:非品牌词优先、搜索量降序(同量按名次、再按字母,保证可复现),每个 URL 只取第一个词。
 * 排名 URL 必须是本站(含子域);不在抓取集合里的留给 resolveTargets 单独抓。
 */
function rankingCandidates(vis: VisibilityResult | null, domain: string, brands: string[], index: Map<string, CrawledPage>): Candidate[] {
  if (!vis || vis.noData || !Array.isArray(vis.topKeywords)) return [];
  const usable = vis.topKeywords.filter(
    (k): k is RankedKeyword & { url: string } => !!k && typeof k.keyword === "string" && !!k.keyword.trim() && typeof k.url === "string" && isOwnHost(hostOf(k.url), domain)
  );
  const sorted = [...usable].sort(
    (a, b) =>
      Number(isBrandQuery(a.keyword, brands)) - Number(isBrandQuery(b.keyword, brands)) ||
      (b.volume ?? 0) - (a.volume ?? 0) ||
      (a.position ?? 999) - (b.position ?? 999) ||
      a.keyword.localeCompare(b.keyword)
  );
  const seenUrls = new Set<string>();
  const seenQueries = new Set<string>();
  const out: Candidate[] = [];
  for (const k of sorted) {
    const key = dedupeKey(k.url);
    const query = normalizeQuery(k.keyword);
    if (!query || seenUrls.has(key) || seenQueries.has(query)) continue;
    seenUrls.add(key);
    seenQueries.add(query);
    const fromDfs = dfsIntent(k.intent);
    const pattern = classifyIntent(query, brands);
    out.push({
      query,
      source: "ranking",
      volume: typeof k.volume === "number" ? k.volume : null,
      position: typeof k.position === "number" ? k.position : null,
      intent: fromDfs ?? pattern.intent,
      intentSource: fromDfs ? "dataforseo" : "pattern",
      intentGuessed: !fromDfs && !pattern.matched,
      url: k.url,
      page: index.get(key) ?? null,
      reuseRefs: null,
    });
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

/** 没有排名数据:首页 + 入链最多的 2 个内容页(同入链按主体词数、再按 URL,保证可复现) */
function pageTopicCandidates(pages: CrawledPage[], brands: string[]): Candidate[] {
  const ok = pages.filter((p) => unusableReason(p) === null && !p.robotsNoindex);
  const home = ok.find((p) => p.depth === 0) ?? ok.find((p) => p.pageType === "home") ?? ok.find((p) => isRootPath(p)) ?? null;
  const inbound = inboundCounter(pages);
  const words = (p: CrawledPage) => p.content?.mainWords ?? p.wordCount;
  const content = ok
    .filter((p) => p !== home && p.pageType !== "home" && !isRootPath(p) && isContentPage(p))
    .sort((a, b) => inbound(b) - inbound(a) || words(b) - words(a) || a.url.localeCompare(b.url));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (p: CrawledPage): boolean => {
    const q = topicPhrase(p, brands);
    if (!q || seen.has(q)) return false;
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
    });
    return true;
  };
  if (home) add(home);
  let added = 0;
  for (const p of content) {
    if (added >= 2) break;
    if (add(p)) added += 1;
  }
  return out;
}

/** reuse 来自数据库 jsonb:逐字段校验,形状不对的对直接丢掉 */
function reuseCandidates(reuse: RelevanceAnalysis, brands: string[], domain: string, index: Map<string, CrawledPage>): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(reuse?.pairs) ? reuse.pairs : []) {
    if (!p || typeof p.query !== "string" || typeof p.url !== "string" || !p.query.trim()) continue;
    const query = normalizeQuery(p.query);
    if (seen.has(query)) continue;
    seen.add(query);
    const intent = (SEARCH_INTENTS as string[]).includes(p.intent) ? p.intent : classifyIntent(query, brands).intent;
    const intentSource = p.intentSource === "dataforseo" ? "dataforseo" : "pattern";
    const refs = Array.isArray(p.competitors)
      ? p.competitors
          .filter((c) => !!c && typeof c.url === "string" && !isOwnHost(hostOf(c.url), domain))
          .map((c) => ({
            url: c.url,
            domain: typeof c.domain === "string" && c.domain ? c.domain : registrableDomain(hostOf(c.url)),
            position: typeof c.position === "number" && Number.isFinite(c.position) ? c.position : 0,
            title: typeof c.title === "string" ? c.title : "",
          }))
      : [];
    out.push({
      query,
      source: p.source === "ranking" ? "ranking" : "page-topic",
      volume: typeof p.volume === "number" ? p.volume : null,
      position: typeof p.position === "number" ? p.position : null,
      intent,
      intentSource,
      intentGuessed: intentSource === "pattern" && !classifyIntent(query, brands).matched,
      url: p.url,
      page: index.get(dedupeKey(p.url)) ?? null,
      reuseRefs: refs.length ? refs : null,
    });
  }
  return out;
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

/** 默认 SERP 来源:按需 import dataforseo.ts(它在导入期校验 env;纯函数测试不该被它拖累) */
async function serpProvider(input: RelevanceInput): Promise<{ fn: SerpFn | null; why: string | null }> {
  if (input.serpFn) return { fn: input.serpFn, why: null };
  try {
    const dfs = await import("./dataforseo");
    if (!dfs.dfsEnabled()) return { fn: null, why: "DataForSEO is not configured on the server" };
    return { fn: (kw: string) => dfs.fetchSerpTop(kw, { depth: SERP_DEPTH }), why: null };
  } catch (e) {
    return { fn: null, why: errText(e) };
  }
}

/** SERP 结果 → 竞品:排除本站(含子域),按 URL 去重,按名次取前 perQuery 个(规格 §3.4) */
function competitorRefs(items: SerpOrganicItem[], domain: string, perQuery: number): CompetitorRef[] {
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
    },
    topics,
  };
}

function buildPair(d: Draft, fetchedByKey: Map<string, FetchedPage>, notes: string[]): RelevancePair {
  const signals: CompetitorPageSignals[] = [];
  const fetchedSignals: CompetitorPageSignals[] = [];
  const fetchedTopics: Topic[][] = [];
  for (const ref of d.refs ?? []) {
    const { signals: s, topics } = competitorSignals(ref, fetchedByKey.get(dedupeKey(ref.url)));
    signals.push(s);
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
  const own = d.page.content;
  // 没有竞品时基准记 0(= 本页绝对数):计分端据 competitors 里有没有 fetched 来区分口径(规格 §4 relevance.gain)
  const baseline = (xs: number[]) => (xs.length ? median(xs) : 0);
  return {
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
}

/* ============================================================
   主流程
   ============================================================ */

/**
 * 相关性分析(规格 §3)。永不抛:失败写 notes,预算内做不完的部分跳过并注明。
 * 成本:每次最多 maxSerpQueries 次 SERP 调用(fetchSerpTop 逐笔记账);reuse 且不刷新时为 0。
 */
export async function analyzeRelevance(input: RelevanceInput): Promise<RelevanceAnalysis> {
  const out: RelevanceAnalysis = { pairs: [], serpCalls: 0, competitorPagesFetched: 0, notes: [] };
  try {
    await runAnalysis(input, out);
  } catch (e) {
    // 只有代码缺陷会走到这里:已完成的对照常返回,原因写进 notes(契约:永不抛)
    out.notes.push(`The comparison with top-ranking pages stopped early: ${errText(e)}`);
  }
  return out;
}

async function runAnalysis(input: RelevanceInput, out: RelevanceAnalysis): Promise<void> {
  const notes = out.notes;
  const clock = input.now ?? Date.now;
  const deadline = clock() + Math.max(0, Number(input.budgetMs) || 0);
  const pages = Array.isArray(input.pages) ? input.pages.filter((p) => !!p && typeof p.url === "string") : [];
  const domain = registrableDomain(input.domain || input.host || "");
  const brands = brandTokensFor(domain, pages);
  const maxPairs = clampInt(input.maxPairs, DEFAULT_MAX_PAIRS, 1, 10);
  const maxSerp = clampInt(input.maxSerpQueries, DEFAULT_MAX_SERP, 0, 5);
  const perQuery = clampInt(input.competitorsPerQuery, DEFAULT_COMPETITORS, 1, 10);
  const net = makeNet(input, deadline);
  const index = indexPages(pages);
  const siteTemplate = templateHeadings(pages);
  // 沿用模式:给了 reuse 且不是付费刷新 —— 这一次绝不调 SERP(成本保证,与 reuse 里有没有对无关)
  const reuseMode = !!input.reuse && !input.refreshSerp;

  if (!pages.length) {
    notes.push("No crawled pages were available, so no page could be compared with search results.");
    return;
  }

  /* ---- 1. 选对 + 定位目标页 ---- */
  let drafts: Draft[] = [];
  if (reuseMode && input.reuse) {
    const reused = reuseCandidates(input.reuse, brands, domain, index);
    drafts = await resolveTargets(reused, maxPairs, net, input, domain, brands, siteTemplate, notes);
    if (drafts.length) {
      const refsCount = drafts.reduce((n, d) => n + (d.reuseRefs?.length ?? 0), 0);
      notes.push(
        `Re-run: reused ${drafts.length} ${drafts.length === 1 ? "query" : "queries"} and ${refsCount} competitor URL${refsCount === 1 ? "" : "s"} from the first paid run; search results were not queried again (competitor pages were re-fetched).`
      );
    }
  }
  if (!drafts.length) {
    const ranking = rankingCandidates(input.visibility, domain, brands, index);
    if (ranking.length) drafts = await resolveTargets(ranking, maxPairs, net, input, domain, brands, siteTemplate, notes);
    if (!drafts.length) {
      notes.push(pageTopicReason(input.visibility, domain, ranking.length > 0));
      drafts = await resolveTargets(pageTopicCandidates(pages, brands), maxPairs, net, input, domain, brands, siteTemplate, notes);
    }
  }
  if (!drafts.length) {
    notes.push("No crawled page had a clear topic to test against search results (no usable homepage or content page with a heading).");
    return;
  }

  /* ---- 2. 竞品:沿用上次的 URL,或调 SERP(前 maxSerp 对) ---- */
  const serpDrafts = drafts.slice(0, maxSerp);
  if (reuseMode) {
    for (const d of serpDrafts) d.refs = d.reuseRefs ? d.reuseRefs.slice(0, perQuery) : null;
    if (!input.reuse?.pairs?.length || serpDrafts.every((d) => d.refs === null)) {
      notes.push("Search results are only queried on the first paid run and on paid refreshes, so this re-run has no competitor comparison.");
    }
  } else if (serpDrafts.length) {
    await loadSerp(serpDrafts, input, out, { deadline, now: clock }, domain, perQuery, notes);
  }

  /* ---- 3. 抓竞品页(全部唯一 URL 一起排队:并发 4,先到的对先抓) ---- */
  const jobs = new Map<string, Promise<FetchedPage>>();
  for (const d of drafts) {
    for (const ref of d.refs ?? []) {
      const key = dedupeKey(ref.url);
      if (!jobs.has(key)) jobs.set(key, fetchPage(net, ref.url, { strictRobots: true, parseHost: null, ownDomain: domain }));
    }
  }
  const fetchedByKey = new Map<string, FetchedPage>();
  await Promise.all([...jobs.entries()].map(async ([key, job]) => fetchedByKey.set(key, await job)));
  out.competitorPagesFetched = [...fetchedByKey.values()].filter((f) => f.page !== null).length;
  noteCompetitorFailures([...jobs.keys()].map((k) => fetchedByKey.get(k) as FetchedPage), notes);

  /* ---- 4. 每对的对比 ---- */
  out.pairs = drafts.map((d) => buildPair(d, fetchedByKey, notes));

  const missingSignals =
    drafts.filter((d) => d.page.content === undefined).length + [...fetchedByKey.values()].filter((f) => f.page && f.page.content === undefined).length;
  if (missingSignals > 0) {
    notes.push(
      `Content signals were unavailable for ${missingSignals} analysed page${missingSignals === 1 ? "" : "s"}; information gain and answer-first checks for them use reduced data.`
    );
  }
}

function pageTopicReason(vis: VisibilityResult | null, domain: string, hadRankingCandidates: boolean): string {
  const tail = "so each query below is the main topic of the page itself (the homepage and the two most-linked content pages).";
  if (hadRankingCandidates) return `None of the ranking pages on ${domain} could be analysed, ${tail}`;
  if (!vis) return `Ranking data was not available for this report, ${tail}`;
  if (vis.noData) return `DataForSEO has no ranking keywords for ${domain} yet, ${tail}`;
  return `None of the ranking keywords pointed at a page on ${domain}, ${tail}`;
}

/**
 * 候选 → 目标页。在抓取集合里的直接用;不在的单独抓一次(robots 照爬虫口径)。
 * 抓不到的跳过并注明,顺延到下一个候选,直到凑满 maxPairs 或候选用完。
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
      batch.map(async (c): Promise<{ page: CrawledPage | null; note: string | null }> => {
        const what = c.source === "ranking" ? "ranking page" : "page";
        if (c.page) {
          const why = unusableReason(c.page);
          if (why) return { page: null, note: `The ${what} ${c.url} for "${c.query}" could not be analysed (${why}); that query was skipped.` };
          return { page: c.page, note: null };
        }
        if (fetches >= MAX_TARGET_FETCHES) return { page: null, note: null };
        fetches += 1;
        const r = await fetchPage(net, c.url, { strictRobots: false, parseHost: input.host || domain, ownDomain: null });
        if (!r.page) {
          const why = r.outcome === "budget" ? "time budget reached" : r.error ?? "not fetched";
          return { page: null, note: `The ${what} ${c.url} for "${c.query}" is not in the crawl and could not be fetched (${why}); that query was skipped.` };
        }
        const why = unusableReason(r.page);
        if (why) return { page: null, note: `The ${what} ${c.url} for "${c.query}" could not be analysed (${why}); that query was skipped.` };
        return { page: r.page, note: null };
      })
    );
    results.forEach((r, k) => {
      if (r.note) notes.push(r.note);
      if (!r.page) return;
      const c = batch[k];
      out.push({ ...c, page: r.page, format: classifyFormat(r.page), topics: pageTopics(r.page, siteTemplate), align: alignmentFor(c.query, brands, r.page), refs: null });
    });
  }
  return out;
}

/** 前 maxSerp 对并行取 SERP;每个调用都限在 deadline 内,notes 按对的顺序写 */
async function loadSerp(
  drafts: Draft[],
  input: RelevanceInput,
  out: RelevanceAnalysis,
  time: { deadline: number; now: () => number },
  domain: string,
  perQuery: number,
  notes: string[]
): Promise<void> {
  if (time.deadline - time.now() < MIN_SERP_BUDGET_MS) {
    notes.push("There was not enough time left in this run to look up the top-ranking pages, so no competitor comparison was made; re-run to compute it.");
    return;
  }
  const serp = await serpProvider(input);
  if (!serp.fn) {
    notes.push(`Top-ranking pages could not be looked up (${serp.why ?? "search data unavailable"}), so no competitor comparison was made.`);
    return;
  }
  const fn = serp.fn;
  const perDraft = await Promise.all(
    drafts.map(async (d) => {
      out.serpCalls += 1;
      // 先发出请求再限时:等待上限按"发出之后"的剩余时间算;同步抛错也收成失败结果
      let call: Promise<SerpOrganicItem[]>;
      try {
        call = Promise.resolve(fn(d.query));
      } catch (e) {
        call = Promise.reject(e);
      }
      const r = await withinDeadline(call, time.deadline, time.now);
      if (!r.ok) {
        return r.timedOut
          ? `The time budget ran out while loading the top results for "${d.query}"; that query is scored without competitor comparison.`
          : `The top results for "${d.query}" could not be loaded (${errText(r.error)}); that query is scored without competitor comparison.`;
      }
      d.refs = competitorRefs(r.value, domain, perQuery);
      return d.refs.length ? null : `No other site ranked for "${d.query}" in the results we received, so there was nothing to compare against.`;
    })
  );
  for (const note of perDraft) if (note) notes.push(note);
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
