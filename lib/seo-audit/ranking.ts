/* ============================================================
   SEO Ranking Score(v2:7 个支柱 · 40 个小维度 · 站点类型自适应权重)—— 付费完整版的总分

   为什么是纯函数:规格 §0 要求"同一站点多次运行结果一致、每一分都能追溯到证据",
   所以这里不做任何 I/O、不调大模型,也不读 Date.now()(调用方没给 input.now 时才退回当前时间)。
   输入全是已经拿到的数据:抓取页的内容信号(parse.ts → page.content)、PSI、站内检查与
   7 维分数、DataForSEO 外链 / 排名、相关性分析(relevance.ts)、站外声誉(reputation.ts)、
   站长授权的 Search Console 数据(gsc.ts)。

   结构:
   - buildRankingContext:把"可读页、内容页、品牌、首页"这些多个小维度共用的口径一次算好,
     各小维度不各算一遍,口径才不会悄悄打架;
   - 40 个小维度各有一个导出的纯函数(可单测),公式逐字对应规格 §4(v1 公式 + v2 新增 / 改动);
   - detectSiteProfile:按页面特征判站点类型(网店 / 本地商家 / YMYL / 默认),决定支柱权重;
   - computeRanking 只做加权、null 重新归一、技术门槛封顶与拼装。

   文案约定(付费客户读的是创始人 / 市场负责人,不是 SEO):
   summary ≥70 写达标句、<70 写白话问题句、null 写 "Not measured: <原因>";
   evidence 1–4 条带真实数字与示例路径;fixes 1–3 条具体可做的事,≥90 分不给修法。
   规格:docs/design/seo-ranking-score-spec.md §4 与 "v2(2026-10-02)" 段
   ============================================================ */

import {
  PILLAR_IDS,
  RANKING_PILLARS,
  RANKING_SUBS,
  SITE_PROFILE_SUB_WEIGHTS,
  SITE_PROFILE_WEIGHTS,
  type AuthorityResult,
  type CompetitorPageSignals,
  type CrawledPage,
  type DimensionId,
  type DimensionScore,
  type GscData,
  type PageContentSignals,
  type PageFormat,
  type PillarId,
  type PillarScore,
  type PsiResult,
  type RankedKeyword,
  type RankingFramework,
  type RelevanceAnalysis,
  type RelevancePair,
  type ReputationAnalysis,
  type SearchIntent,
  type SeoAuditResult,
  type SeoCheck,
  type SignalConfidence,
  type SiteProbe,
  type SiteProfile,
  type SiteProfileId,
  type SubScore,
  type VisibilityResult,
} from "./types";
import { GATE_OVERALL_CAP, SEVERITY_RANK, gradeFor } from "./score";
import { checkTitle } from "./checks/titles";
import { clusters, hostOf, isHtml200, isToolPath, listPaths, minhashSimilarity, pageTypeOf, parseDate, pathOf, urlKey } from "./checks/helpers";
// 一个意图一页 / 网店判定都要"页面形态",必须与相关性分析同一个分类器,否则两处对同一页的判断会打架
import { classifyFormat } from "./relevance";
// AI 爬虫名单只有一份(robots.ts):探针按它逐个出判定,这里按它计分,两边不会对不上
import { AI_RETRIEVAL_BOTS, AI_TRAINING_BOTS } from "./robots";

/** 规格 §1 的输入契约 + v2 追加(声誉、Search Console、sitemap 全量 URL、用户目标词) */
export interface RankingInput {
  domain: string;
  pages: CrawledPage[];
  probe: SiteProbe;
  psi: { mobile: PsiResult | null; desktop: PsiResult | null };
  checks: SeoCheck[];
  dimensions: DimensionScore[];
  technical: { score: number; grade: "A" | "B" | "C" | "D" | "F"; blockers: string[] };
  authority: AuthorityResult | null;
  visibility: VisibilityResult | null;
  relevance: RelevanceAnalysis | null;
  /** v2:站外声誉(没跑为 null → authority.reputation 不测) */
  reputation: ReputationAnalysis | null;
  /** v2:站长授权的 Search Console 数据(没接入为 null → behavior.ctr 不测,自蚕食 / 动量退回估计) */
  gsc: GscData | null;
  /** v2:sitemap 里的页面 URL(≤2000;authority.focus 的考察集合) */
  sitemapUrls?: string[];
  /**
   * v2:没有 sitemapUrls 时改用上次存下的 sitemap 统计(basis.sitemapFocus)。接入 / 断开 Search Console 时
   * 从已存结果重算(recomputeRankingFromResult),拿不到 sitemap 原始 URL,靠它让结果可复现。
   */
  sitemapFocus?: { considered: number; offTopic: number; examples: string[] };
  /** v2:用户自填的目标关键词(规范化后,≤3) */
  targetKeywords?: string[];
  now?: Date;
}

type Grade = "A" | "B" | "C" | "D" | "F";

/* ============================================================
   常量
   ============================================================ */

/** 内容页的最低主体词数(规格 §4) */
export const CONTENT_MIN_WORDS = 300;
/** 内容页的页面类型:首页、定价、法律、联系页都不算(它们的任务不是回答问题) */
const CONTENT_TYPES = new Set<string>(["article", "product", "other", "listing"]);
/** 与站内 onpage.near-duplicate 同一个阈值,两处对"近重复"的判断不能打架 */
const NEAR_DUP_SIM = 0.8;
const SUB_META = new Map(RANKING_SUBS.map((s) => [s.id, s]));
const SUB_ORDER = new Map(RANKING_SUBS.map((s, i) => [s.id, i]));
const DAY_MS = 86_400_000;

/** 技术支柱的 7 个小维度 ↔ 现有 7 个站内维度(规格 §4 技术基础) */
export const TECHNICAL_SUB_DIMENSIONS: Readonly<Record<string, DimensionId>> = {
  "technical.crawl": "crawlability",
  "technical.onpage": "onpage",
  "technical.cwv": "performance",
  "technical.mobile": "mobile",
  "technical.https": "security",
  "technical.structure": "architecture",
  "technical.schema": "structured",
};

/* ============================================================
   小工具
   ============================================================ */

/** 0–100 取整;顺手把 -0 归成 0(deepStrictEqual 会区分 -0 与 0) */
function clampScore(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const r = Math.round(Math.min(100, Math.max(0, x)));
  return r === 0 ? 0 : r;
}

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function ratio(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

/** 0-1 → 整数百分比 */
function pct01(x: number): number {
  return Math.round(x * 100);
}

function pctOf(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/** 千分位整数(不用 toLocaleString:避免依赖运行环境的 ICU,保证确定性) */
function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmt1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** 证据里引用别处的长句时截断,保持一行能读完 */
function clip(s: string, max = 220): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * 按句子截断:站内检查的修法常是"做法。Verify: …"两三句,硬截会断在半个词上。
 * 超长时退到 max 之前最后一个句号 / 分号处;前面没有合适的断点(不到 max 的 40%)才硬截。
 */
function clipSentence(s: string, max = 240): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  return cut >= max * 0.4 ? head.slice(0, cut) : clip(t, max);
}

/** 本模块的句子不带句末句号(与 UI 列表风格一致);复用别处的句子时去掉一个句末句号 */
function trimDot(s: string): string {
  return (s ?? "").trim().replace(/\.$/, "");
}

function quoteQuery(q: string): string {
  return `"${clip(q, 70)}"`;
}

function paths(urls: string[], n = 3): string {
  return listPaths(urls, n);
}

function contentOf(p: CrawledPage): PageContentSignals {
  return p.content as PageContentSignals;
}

/** 有限数字才算"有数据";0 也是数据(与 num() 不同:num 把缺失当 0,这里要分清"没有"与"是 0") */
function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * 按搜索量加权时每个词的权重:规格 difficulty 写明"量为 null 记 1";量为 0 同样按 1 计 ——
 * 否则一组全是 0 量的词权重之和为 0,平均值无从算起。striking / zeroclick 沿用同一口径。
 */
function volWeight(v: number | null | undefined): number {
  return finite(v) && v > 0 ? v : 1;
}

function weightedMean(rows: { w: number; v: number }[]): number {
  const w = rows.reduce((s, r) => s + r.w, 0);
  return w > 0 ? rows.reduce((s, r) => s + r.w * r.v, 0) / w : 0;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sign(n: number): string {
  return n > 0 ? "+" : n < 0 ? "−" : "";
}

/** ["a", "b", "c"] → "a, b and c" */
function listJoin(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** 裸主机:小写、去协议 / 路径 / 端口 / www.(域名比较用) */
function bareHost(s: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** 本站域名(含子域名:blog.example.com 也是 example.com 的) */
function isOwnDomain(d: string, domain: string): boolean {
  const h = bareHost(d);
  const own = bareHost(domain);
  return !!own && !!h && (h === own || h.endsWith(`.${own}`));
}

/** 只要路径部分(不含查询串),小写 */
function pathOnly(url: string): string {
  return pathOf(url).split("?")[0].toLowerCase();
}

/** 本站 DataForSEO Domain Rank(0–1000);外链数据缺失 / noData / 没给 rank → null */
function ownDomainRank(input: RankingInput): number | null {
  const a = input.authority;
  if (!a || a.noData) return null;
  return finite(a.rank) ? a.rank : null;
}

/* ============================================================
   品牌与主题分词
   ============================================================ */

/** 公司后缀不算品牌的一部分("Acme Inc" 与 "Acme" 是同一个品牌) */
const LEGAL_SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pty)\b\.?/g;
/** 二级公共后缀(co.uk / com.au …)下品牌标签在倒数第三段(与 dataforseo.ts 的口径一致) */
const SECOND_LEVEL_SUFFIX = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

/** 注册域的品牌标签:aeoeye.com → aeoeye;example.co.uk → example */
export function domainLabel(domain: string): string {
  const host = (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 3 && SECOND_LEVEL_SUFFIX.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? "");
}

/** 品牌名归一:小写、去公司后缀、去空格与符号("AEO eye, Inc." → "aeoeye") */
export function brandKey(name: string): string {
  return (name ?? "").toLowerCase().replace(LEGAL_SUFFIX, " ").replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 相同,或一方包含另一方("acme" ⊂ "acmeanalytics");短于 3 个字符只认完全相同,防误配 */
function keysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
}

/**
 * 主题词停用表:功能词 + 标题里高频但不代表主题的词(best / guide / tips / tools …)。
 * 主题簇和"标题承诺"都靠共享主题词判断,这些词留着会把毫不相干的页归到一起。
 */
const TOPIC_STOP = new Set([
  "the", "and", "for", "with", "your", "you", "our", "are", "can", "how", "what", "why", "when", "where", "who", "which",
  "best", "top", "guide", "ultimate", "complete", "tip", "way", "step", "list", "free", "online", "new", "versus",
  "review", "example", "thing", "need", "know", "everything", "about", "into", "from", "this", "that", "these", "those",
  "doe", "does", "should", "will", "get", "use", "using", "used", "make", "more", "most", "really", "simple", "easy",
  "quick", "beginner", "introduction", "intro", "overview", "explained", "update", "updated", "year", "month", "not",
  "all", "any", "its", "than", "then", "there", "their", "them", "they", "was", "were", "has", "have", "had", "been",
  "also", "just", "only", "very", "much", "many", "some", "such", "each", "other", "over", "under", "after", "before",
  "between", "without", "within", "out", "per", "via", "here", "now", "today", "part", "page", "home", "blog", "post",
  "article", "learn", "read", "checklist", "template", "tool", "software", "app", "platform", "solution", "service",
  "company", "inc", "llc", "ltd", "official", "welcome", "start", "started", "getting", "work", "works", "vs", "faq",
]);

/** 极简词干:复数归单数(audits → audit,strategies → strategy);ss / us / is 结尾不动 */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** 主题词集合:小写、按非字母数字切分、去停用词 / 纯数字 / 品牌词、简单词干化 */
export function topicTokens(text: string, brandWords: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || TOPIC_STOP.has(raw) || brandWords.has(raw)) continue;
    const s = stem(raw);
    if (s.length < 3 || TOPIC_STOP.has(s) || brandWords.has(s)) continue;
    out.add(s);
  }
  return out;
}

/** 去掉标题里的品牌后缀("How to fix X — Acme" → "How to fix X"),品牌词不算主题 */
export function titleCore(p: CrawledPage): string {
  const t = (p.title ?? "").trim();
  const tb = p.content?.titleBrand?.trim();
  if (tb) {
    const idx = t.lastIndexOf(tb);
    if (idx > 0) {
      const head = t.slice(0, idx).replace(/[\s|\-—–·:]+$/u, "").trim();
      if (head) return head;
    }
  }
  return t;
}

export interface BrandInfo {
  /** 注册域标签(aeoeye.com → aeoeye) */
  label: string;
  /** 页面上最常见的品牌名(Organization / og:site_name / 标题后缀);没有为 null */
  name: string | null;
  /** 归一化品牌键 */
  key: string | null;
  /** 品牌名与域名主体相符 */
  matchesDomain: boolean;
  /** 带有与主品牌一致的品牌信号的页 / 没有的页(只看有内容信号的可读页) */
  consistentPages: string[];
  inconsistentPages: string[];
  /** 主题分析里要剔除的品牌词 */
  words: Set<string>;
  /** 判定"品牌关键词"用的紧凑串(关键词去空格后包含它即品牌词) */
  keywordTokens: string[];
}

function brandInfoOf(domain: string, pages: CrawledPage[]): BrandInfo {
  const label = domainLabel(domain);
  const counts = new Map<string, { n: number; raw: string }>();
  const perPage: string[][] = [];
  for (const p of pages) {
    const c = contentOf(p);
    const keys: string[] = [];
    for (const raw of [c.orgName, c.siteName, c.titleBrand]) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const k = brandKey(raw);
      if (k.length < 2 || keys.includes(k)) continue;
      keys.push(k);
      const cur = counts.get(k);
      if (cur) cur.n += 1;
      else counts.set(k, { n: 1, raw: raw.trim() });
    }
    perPage.push(keys);
  }
  // 主品牌 = 出现页数最多的品牌键;并列时优先与域名相符的,再按字母序(确定性)
  let best: string | null = null;
  for (const [k, v] of Array.from(counts.entries())) {
    if (best === null) {
      best = k;
      continue;
    }
    const b = counts.get(best)!;
    const kd = keysMatch(k, label);
    const bd = keysMatch(best, label);
    if (v.n > b.n || (v.n === b.n && kd && !bd) || (v.n === b.n && kd === bd && k < best)) best = k;
  }
  const consistentPages: string[] = [];
  const inconsistentPages: string[] = [];
  pages.forEach((p, i) => {
    if (best !== null && perPage[i].some((k) => keysMatch(k, best as string))) consistentPages.push(p.url);
    else inconsistentPages.push(p.url);
  });
  const matchesDomain = best !== null && keysMatch(best, label);
  const name = best !== null ? counts.get(best)!.raw : null;
  // 只剔除"就是品牌本身"的词:品牌 "AEO Eye" 里的 "aeo" 是主题词,剔掉会毁掉 AEO 话题簇
  const words = new Set<string>();
  if (label.length >= 2) words.add(label);
  if (best) words.add(best);
  for (const w of (name ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w && (w === label || w === best)) words.add(w);
  const keywordTokens = uniq([label.length >= 3 ? label : "", best && best.length >= 4 && matchesDomain ? best : ""].filter(Boolean));
  return { label, name, key: best, matchesDomain, consistentPages, inconsistentPages, words, keywordTokens };
}

/** 品牌关键词:去掉空格与符号后包含品牌串("aeo eye pricing" 也算) */
function isBrandKeyword(keyword: string, tokens: string[]): boolean {
  const compact = (keyword ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return tokens.some((t) => compact.includes(t));
}

/* ============================================================
   上下文:多个小维度共用的口径一次算好
   ============================================================ */

export interface RankingContext {
  input: RankingInput;
  now: Date;
  /** 读得出内容的页(HTML 且 200) */
  readable: CrawledPage[];
  /** 可读且有内容信号的页 */
  signalPages: CrawledPage[];
  /** 内容类型页(article / product / other / listing),剔除 JS 空壳与工具路径;薄内容占比的分母 */
  typedPages: CrawledPage[];
  /** 内容页 = typedPages 中主体词数 ≥ 300 */
  contentPages: CrawledPage[];
  /** 内容页里的文章页(FAQ 占比的分母) */
  articlePages: CrawledPage[];
  pairs: RelevancePair[];
  brand: BrandInfo;
  /** 入口页(probe.entryUrl),找不到再取 pageType = home 的页;都没有为 null */
  home: CrawledPage | null;
}

/** 内容页判定(规格 §4):类型 ∈ {article, product, other, listing} 且主体 ≥ 300 词;JS 空壳与登录 / 购物车之类工具页不算 */
export function isContentPage(p: CrawledPage): boolean {
  return isHtml200(p) && !!p.content && CONTENT_TYPES.has(pageTypeOf(p)) && p.jsShell !== true && !isToolPath(p.url) && num(p.content.mainWords) >= CONTENT_MIN_WORDS;
}

export function buildRankingContext(input: RankingInput): RankingContext {
  const now = input.now ?? new Date();
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const readable = pages.filter(isHtml200);
  const signalPages = readable.filter((p) => !!p.content);
  const typedPages = signalPages.filter((p) => CONTENT_TYPES.has(pageTypeOf(p)) && p.jsShell !== true && !isToolPath(p.url));
  const contentPages = typedPages.filter((p) => num(contentOf(p).mainWords) >= CONTENT_MIN_WORDS);
  const articlePages = contentPages.filter((p) => pageTypeOf(p) === "article");
  const pairs = Array.isArray(input.relevance?.pairs) ? (input.relevance as RelevanceAnalysis).pairs : [];
  const entry = input.probe?.entryUrl ? findPage(readable, input.probe.entryUrl) : null;
  const home = entry ?? readable.find((p) => pageTypeOf(p) === "home") ?? null;
  return { input, now, readable, signalPages, typedPages, contentPages, articlePages, pairs, brand: brandInfoOf(input.domain, signalPages), home };
}

/* ============================================================
   SubScore 组装:分数决定 summary 用哪一句,并保证条数约束
   ============================================================ */

interface SubDraft {
  /** 原始分(未取整);null = 没测 */
  score: number;
  /** score ≥ 70 时的达标句 */
  good: string;
  /** score < 70 时的问题句 */
  bad: string;
  evidence: string[];
  fixes: string[];
  /** 数据来源改变可信度时覆盖 RANKING_SUBS 的默认值(例:自蚕食有 Search Console 时是 measured,否则 estimated) */
  confidence?: SignalConfidence;
}

/** 每个小维度的兜底修法:分数 <90 却没写出具体修法时用它,保证"<90 至少一条" */
const DEFAULT_FIX: Record<string, string> = {
  "relevance.intent": "Give each target query the page format that already ranks for it — a list, a comparison, a how-to or a product page",
  "relevance.coverage": "Compare your page with the top 5 results for its main query and add the subtopics most of them cover",
  "relevance.gain": "Add something the top results don't have: your own test results, real numbers, a worked example or your own screenshots",
  "relevance.alignment": "Use the exact words people search in the title and H1, and answer the question in the first two sentences",
  "quality.experience": "Add what you actually did: the setup you tested, the numbers you saw, a screenshot from your own account",
  "quality.data": "Back key claims with your own numbers or a link to the primary source (official docs, the study, the government page)",
  "quality.authorship": "Show who wrote each article (a byline that links to an author page) and who runs the company (About and Contact pages)",
  "quality.freshness": "Review your most important pages, refresh facts and screenshots, then update dateModified",
  "quality.scaled": "Merge or rewrite pages that repeat each other, and give every page something only you can add",
  "authority.editorial": "Earn links inside articles: offer data, quotes or a useful tool to writers who cover your topic",
  "authority.breadth": "Publish one asset worth linking to — original data, a free tool or a template — and pitch it to sites your buyers read",
  "authority.clusters": "Give each main topic a hub page that links to 3+ related articles, and have those articles link back",
  "authority.internal": "Link your homepage, pricing and best-ranking pages from the main navigation or footer",
  "authority.entity": "Use one brand name everywhere (title suffix, og:site_name, Organization schema) and link your official profiles with sameAs",
  "behavior.realuser": "Fix the slowest Core Web Vital first — see the Performance section for the exact elements",
  "behavior.task": "Answer the main question in the first two sentences and end every page with a clear next step",
  "behavior.readability": "Use shorter sentences and paragraphs, a subheading every 200–300 words, and lists for steps and options",
  "behavior.promise": "Make every title describe exactly what the page delivers — the topic, the number and the tone",
  // v2 新增的 15 个
  "relevance.cannibalization": "Give each search one page: merge pages that target the same topic and 301-redirect the weaker one",
  "quality.sources": "Fix broken outbound links, refresh old statistics and link the source for every key fact",
  "authority.linkprofile": "Earn links to the pages that rank (not just the homepage) with natural, mostly brand-name anchor text",
  "authority.focus": "Keep new pages inside your core topics, and merge or retire pages that have nothing to do with them",
  "authority.reputation": "Collect reviews on the review sites your buyers check and get mentioned on independent sites",
  "winnability.serpweakness": "Go after queries where forum threads, stale or thin pages hold top-5 spots",
  "winnability.difficulty": "Target queries whose difficulty matches your site's authority, then move up as you earn links",
  "winnability.gap": "Pick queries where the ranking sites have about as much authority as yours, and earn links to the pages you want to rank",
  "winnability.striking": "Push keywords ranking 4–15 into the top 3: refresh the page, add missing subtopics and link to it internally",
  "winnability.momentum": "Refresh the pages that lost the most traffic first: update facts, add missing subtopics and improve titles",
  "aisearch.overview": "Answer each target question in 2–3 plain sentences near the top of the page so AI Overviews can quote you",
  "aisearch.crawlers": "Allow AI search crawlers in robots.txt and serve your main content in the HTML, without needing JavaScript",
  "aisearch.citability": "Open pages with a short direct answer, phrase subheadings as questions and add specific numbers",
  "aisearch.zeroclick": "Favour queries where results are mostly plain links, and win the featured snippet where one shows",
  "behavior.ctr": "Rewrite titles and meta descriptions of pages that rank well but earn few clicks",
};

function measured(id: string, d: SubDraft): SubScore {
  const meta = SUB_META.get(id)!;
  const score = clampScore(d.score);
  const evidence = uniq(d.evidence.map((e) => trimDot(e)).filter(Boolean)).slice(0, 4);
  if (!evidence.length) evidence.push(`Score ${score}/100 from the pages we analysed`);
  let fixes = uniq(d.fixes.map((f) => trimDot(f)).filter(Boolean)).slice(0, 3);
  if (score >= 90) fixes = [];
  else if (!fixes.length) fixes = [DEFAULT_FIX[id] ?? "Review the evidence above and fix the weakest page first"];
  return {
    id,
    pillar: meta.pillar,
    label: meta.label,
    score,
    weight: meta.weight,
    confidence: d.confidence ?? meta.confidence,
    summary: trimDot(score >= 70 ? d.good : d.bad),
    evidence,
    fixes,
  };
}

/** 没测 ≠ 0 分:score 为 null,不进加权;summary 明说原因,evidence 至少一条 */
function notMeasured(id: string, reason: string, opts: { evidence?: string[]; fixes?: string[]; confidence?: SignalConfidence } = {}): SubScore {
  const meta = SUB_META.get(id)!;
  const why = trimDot(reason);
  const evidence = uniq((opts.evidence ?? []).map((e) => trimDot(e)).filter(Boolean)).slice(0, 4);
  if (!evidence.length) evidence.push(why.charAt(0).toUpperCase() + why.slice(1));
  return {
    id,
    pillar: meta.pillar,
    label: meta.label,
    score: null,
    weight: meta.weight,
    confidence: opts.confidence ?? meta.confidence,
    summary: `Not measured: ${why}`,
    evidence,
    fixes: uniq((opts.fixes ?? []).map((f) => trimDot(f)).filter(Boolean)).slice(0, 3),
  };
}

/* ---------- 共用的"没测"原因 ---------- */

function relevanceGap(ctx: RankingContext): { reason: string; evidence: string[] } | null {
  const r = ctx.input.relevance;
  if (!r) return { reason: "the search-query comparison did not run for this report", evidence: [] };
  if (!ctx.pairs.length) {
    const notes = (r.notes ?? []).filter((n) => typeof n === "string" && n.trim()).slice(0, 2);
    return { reason: "no search queries could be matched to your pages", evidence: notes.map((n) => clip(n)) };
  }
  return null;
}

function contentGap(ctx: RankingContext): string {
  if (!ctx.readable.length) return "we could not read any pages on the site";
  if (!ctx.signalPages.length) return "page content signals were not collected for this report — re-run it to compute them";
  return `none of the ${plural(ctx.readable.length, "page")} we read has ${CONTENT_MIN_WORDS}+ words of main text (homepage, pricing, legal and contact pages don't count)`;
}

const CONTENT_GAP_FIX = `Publish in-depth pages (${CONTENT_MIN_WORDS}+ words) that answer the questions your buyers search for`;

function authorityGap(a: AuthorityResult | null): string | null {
  if (!a) return "backlink data was not available for this report";
  if (a.noData) return "DataForSEO has no backlink data for this domain yet";
  return null;
}

/* ============================================================
   相关性 / 搜索意图(default 25;小维度权重见 RANKING_SUBS)
   ============================================================ */

const FORMAT_NAME: Record<PageFormat, string> = {
  definition: "a definition page",
  "how-to": "a how-to guide",
  comparison: "a comparison",
  listicle: "a list of options",
  product: "a product page",
  pricing: "a pricing page",
  local: "a local business page",
  homepage: "the homepage",
  article: "an article",
  other: "a general page",
};

const FORMAT_PLURAL: Record<PageFormat, string> = {
  definition: "definition pages",
  "how-to": "how-to guides",
  comparison: "comparisons",
  listicle: "lists of options",
  product: "product pages",
  pricing: "pricing pages",
  local: "local business pages",
  homepage: "homepages",
  article: "articles",
  other: "general pages",
};

const FORMAT_ADVICE: Record<PageFormat, string> = {
  comparison: "a side-by-side comparison (a table of the options, who each one fits, and a clear verdict)",
  listicle: "a ranked list of options with a one-line verdict for each",
  "how-to": "numbered, step-by-step instructions",
  definition: "a one-sentence definition up top, followed by examples",
  product: "a product page with the price, key features and a clear sign-up or buy button",
  pricing: "a pricing page that shows plans, prices and what each plan includes",
  local: "a location page with address, phone number, opening hours and a map",
  homepage: "your homepage",
  article: "an in-depth article",
  other: "a page built around that exact question",
};

/** 规格 §3.8 的可接受形态(修法里取第一个作为建议形态) */
const INTENT_FORMATS: Record<SearchIntent, PageFormat[]> = {
  informational: ["definition", "how-to", "listicle", "article"],
  commercial: ["comparison", "listicle", "product", "pricing", "article"],
  transactional: ["product", "pricing", "homepage"],
  navigational: ["homepage", "product", "pricing"],
  local: ["local", "homepage"],
};

const INTENT_WANTS: Record<SearchIntent, string> = {
  informational: "want an answer or an explanation",
  commercial: "are comparing options before they buy",
  transactional: "are ready to buy or sign up",
  navigational: "are looking for your site",
  local: "want a business near them",
};

function formatName(f: PageFormat | null | undefined): string {
  return f && FORMAT_NAME[f] ? FORMAT_NAME[f] : FORMAT_NAME.other;
}

/** relevance.intent(25)= 100 × 匹配对数 / 有判定的对数;无对 → null */
export function scoreRelevanceIntent(ctx: RankingContext): SubScore {
  const id = "relevance.intent";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const judged = ctx.pairs.filter((p) => typeof p.intentMatch === "boolean");
  if (!judged.length) return notMeasured(id, "we could not tell which page format fits the queries we checked");
  const matched = judged.filter((p) => p.intentMatch === true);
  const missed = judged.filter((p) => p.intentMatch === false);
  const line = (p: RelevancePair) =>
    `${quoteQuery(p.query)} (${p.intent} intent) → ${pathOf(p.url)} is ${formatName(p.pageFormat)}${p.serpFormat ? `; the top results are mostly ${FORMAT_PLURAL[p.serpFormat] ?? "general pages"}` : ""} — ${p.intentMatch ? "match" : "mismatch"}`;
  const fixes = missed.map((p) => {
    const target: PageFormat = p.serpFormat ?? (INTENT_FORMATS[p.intent] ?? ["article"])[0];
    if (target === "homepage") return `Make your homepage the page for ${quoteQuery(p.query)}: say it in the homepage title and H1, and link to the homepage with those words`;
    return `Turn ${pathOf(p.url)} into ${FORMAT_ADVICE[target] ?? FORMAT_ADVICE.other} — people searching ${quoteQuery(p.query)} ${INTENT_WANTS[p.intent] ?? "want something specific"}${p.serpFormat ? ", and that is the format Google ranks for it" : ""}`;
  });
  return measured(id, {
    score: (100 * matched.length) / judged.length,
    good:
      judged.length === 1
        ? "The query we checked lands on the kind of page Google ranks for it"
        : matched.length === judged.length
          ? `All ${judged.length} queries we checked land on the kind of page Google ranks for them`
          : `${matched.length} of ${judged.length} queries land on the kind of page Google ranks for them`,
    bad: `${missed.length} of ${judged.length} ${judged.length === 1 ? "query lands" : "queries land"} on the wrong kind of page for what searchers want`,
    evidence: [...missed, ...matched].map(line),
    fixes,
  });
}

/** relevance.coverage(25)= min(100, 平均 coverage / 0.7 × 100);无 coverage → null */
export function scoreRelevanceCoverage(ctx: RankingContext): SubScore {
  const id = "relevance.coverage";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const withCov = ctx.pairs.filter((p) => typeof p.coverage === "number" && Number.isFinite(p.coverage));
  if (!withCov.length) {
    return notMeasured(id, "we could not compare your pages with enough top-ranking pages — we need at least 3 subtopics shared by 2 or more of them");
  }
  const avg = mean(withCov.map((p) => Math.min(1, Math.max(0, p.coverage as number))));
  const sorted = [...withCov].sort((a, b) => (a.coverage as number) - (b.coverage as number));
  return measured(id, {
    score: Math.min(100, (avg / 0.7) * 100),
    good: `Your pages cover ${pct01(avg)}% of the subtopics the top-ranking pages have in common`,
    bad: `Your pages cover only ${pct01(avg)}% of the subtopics the top-ranking pages have in common`,
    evidence: sorted.map((p) => {
      const missing = (p.missingTopics ?? []).slice(0, 3);
      return `${quoteQuery(p.query)} → ${pathOf(p.url)} covers ${pct01(p.coverage as number)}% of the shared subtopics${missing.length ? `; missing: ${missing.join(", ")}` : ""}`;
    }),
    fixes: sorted
      .filter((p) => (p.missingTopics ?? []).length > 0)
      .map((p) => `Add sections on ${(p.missingTopics ?? []).slice(0, 3).join(", ")} to ${pathOf(p.url)} — most of the top results for ${quoteQuery(p.query)} cover them`),
  });
}

type GainInputs = { uniqueTopics: number; extraNumbers: number; extraTables: number; ownImages: number; experienceMarkers: number };

/** 规格 §4 relevance.gain 的每对公式;withTopics=false 时去掉"独有子话题"项(没有竞品就无所谓独有),上限自然是 60 */
export function gainPoints(g: GainInputs, withTopics = true): number {
  const topics = withTopics ? Math.min(Math.max(0, num(g.uniqueTopics)), 5) * 8 : 0;
  const numbers = num(g.extraNumbers) >= 5 ? 20 : num(g.extraNumbers) >= 1 ? 10 : 0;
  const tables = num(g.extraTables) >= 1 ? 15 : 0;
  const images = num(g.ownImages) >= 2 ? 15 : num(g.ownImages) >= 1 ? 8 : 0;
  const exp = num(g.experienceMarkers) >= 2 ? 10 : 0;
  return Math.min(100, topics + numbers + tables + images + exp);
}

function findPage(pages: CrawledPage[], url: string): CrawledPage | null {
  const k = urlKey(url);
  return pages.find((p) => urlKey(p.url) === k || (!!p.finalUrl && urlKey(p.finalUrl) === k)) ?? null;
}

/**
 * relevance.gain(20):有竞品时每对按公式取平均;一个竞品都没抓到时只用本页信号估计(上限 60),
 * summary 写明"未与排名页对比"。只有部分对有竞品时只平均有竞品的对 —— 两种口径混着平均,
 * 会让"没做对比"的对把真实对比的结果往 60 拉。
 */
export function scoreRelevanceGain(ctx: RankingContext): SubScore {
  const id = "relevance.gain";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const compared = ctx.pairs.filter((p) => (p.competitors ?? []).some((c) => c.fetched));
  if (compared.length) {
    const rows = compared.map((p) => {
      const g = p.gainSignals ?? { uniqueTopics: 0, extraNumbers: 0, extraTables: 0, ownImages: 0, experienceMarkers: 0 };
      const u = num(g.uniqueTopics) || (p.uniqueTopics ?? []).length;
      return { p, g: { ...g, uniqueTopics: u }, pts: gainPoints({ ...g, uniqueTopics: u }) };
    });
    const avgU = mean(rows.map((r) => r.g.uniqueTopics));
    const weakest = [...rows].sort((a, b) => a.pts - b.pts)[0];
    const fixes: string[] = [];
    if (avgU < 2) fixes.push(`Add a section none of the top results have — your own test results, a real customer example, or a mistake you see buyers make (start with ${pathOf(weakest.p.url)})`);
    if (rows.some((r) => num(r.g.extraNumbers) < 5)) fixes.push("Add concrete numbers the others don't give: prices, timings, sample sizes, results you measured yourself");
    if (rows.some((r) => num(r.g.extraTables) < 1)) fixes.push("Add a summary or comparison table so readers can check the key facts at a glance");
    if (rows.some((r) => num(r.g.ownImages) < 2)) fixes.push("Replace stock photos with your own screenshots, charts or photos");
    if (rows.some((r) => num(r.g.experienceMarkers) < 2)) fixes.push("Say what you did yourself: what you tested, for how long, and what happened");
    return measured(id, {
      score: mean(rows.map((r) => r.pts)),
      good: "Your pages add things the top results don't have: unique subtopics, extra data or your own images",
      bad: "Your pages mostly repeat what already ranks — they add little the top results don't have",
      evidence: rows.map(({ p, g }) => {
        const n = (p.competitors ?? []).filter((c) => c.fetched).length;
        const topics = (p.uniqueTopics ?? []).slice(0, 2);
        const uniqueText = g.uniqueTopics > 0 ? `${plural(g.uniqueTopics, "subtopic")} none of them cover${topics.length ? ` (${topics.join(", ")})` : ""}` : "no subtopic the others lack";
        return `${pathOf(p.url)} vs the top ${n} for ${quoteQuery(p.query)}: ${uniqueText}, ${num(g.extraNumbers) >= 1 ? `+${plural(num(g.extraNumbers), "data point")}` : "no extra data points"}, ${num(g.extraTables) >= 1 ? `+${plural(num(g.extraTables), "table")}` : "no extra tables"}, ${plural(num(g.ownImages), "own image")}`;
      }),
      fixes,
    });
  }
  // 没有可比的竞品:只用本页信号估计(数据点 / 表格 / 自有图片 / 一手经验),"独有子话题"项不计 → 上限 60
  const rows = ctx.pairs.map((p) => {
    const page = findPage(ctx.input.pages ?? [], p.url);
    const c = page?.content;
    const g: GainInputs = c
      ? { uniqueTopics: 0, extraNumbers: num(c.numberCount), extraTables: num(c.tableCount), ownImages: num(c.imagesSelfHosted), experienceMarkers: num(c.experienceMarkers) }
      : {
          uniqueTopics: 0,
          extraNumbers: num(p.gainSignals?.extraNumbers),
          extraTables: num(p.gainSignals?.extraTables),
          ownImages: num(p.gainSignals?.ownImages),
          experienceMarkers: num(p.gainSignals?.experienceMarkers),
        };
    const signs = (g.extraNumbers >= 1 ? 1 : 0) + (g.extraTables >= 1 ? 1 : 0) + (g.ownImages >= 1 ? 1 : 0) + (g.experienceMarkers >= 2 ? 1 : 0);
    return { p, g, signs, pts: gainPoints(g, false) };
  });
  const avgSigns = Math.round(mean(rows.map((r) => r.signs)));
  const fixes: string[] = [];
  if (rows.some((r) => r.g.extraNumbers < 5)) fixes.push("Add concrete numbers: prices, timings, sample sizes, results you measured yourself");
  if (rows.some((r) => r.g.extraTables < 1)) fixes.push("Add a summary or comparison table so readers can check the key facts at a glance");
  if (rows.some((r) => r.g.ownImages < 2)) fixes.push("Replace stock photos with your own screenshots, charts or photos");
  if (rows.some((r) => r.g.experienceMarkers < 2)) fixes.push("Say what you did yourself: what you tested, for how long, and what happened");
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: `Your pages show ${avgSigns} of 4 signs of original value (estimated — not compared with ranking pages)`,
    bad: `Your pages show ${avgSigns} of 4 signs of original value — estimated from your pages alone, not compared with ranking pages, so capped at 60`,
    evidence: [
      "Not compared with ranking pages: no competitor page could be fetched, so unique subtopics could not be counted",
      ...rows.map(
        ({ p, g }) =>
          `${pathOf(p.url)} (for ${quoteQuery(p.query)}): ${plural(g.extraNumbers, "data point")}, ${plural(g.extraTables, "table")}, ${plural(g.ownImages, "own image")}, ${plural(g.experienceMarkers, "first-hand mention")}`,
      ),
    ],
    fixes,
  });
}

/** 规格 §4 relevance.alignment 的每对公式:40 × 标题对齐 + 30 × H1 对齐 + 30 × 答案前置 */
export function alignmentPoints(p: Pick<RelevancePair, "titleAlignment" | "h1Alignment" | "answerEarly">): number {
  const t = Math.min(1, Math.max(0, num(p.titleAlignment)));
  const h = Math.min(1, Math.max(0, num(p.h1Alignment)));
  return 40 * t + 30 * h + (p.answerEarly ? 30 : 0);
}

/** relevance.alignment(15):每对 40 × titleAlignment + 30 × h1Alignment + 30 × answerEarly,取平均 */
export function scoreRelevanceAlignment(ctx: RankingContext): SubScore {
  const id = "relevance.alignment";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const rows = ctx.pairs.map((p) => ({ p, pts: alignmentPoints(p) })).sort((a, b) => a.pts - b.pts);
  const fixes: string[] = [];
  for (const { p } of rows) {
    if (num(p.titleAlignment) < 1 || num(p.h1Alignment) < 1) fixes.push(`Use the words ${quoteQuery(p.query)} in the title and H1 of ${pathOf(p.url)}`);
    if (!p.answerEarly) fixes.push(`Answer ${quoteQuery(p.query)} in the first two sentences of ${pathOf(p.url)}, before any background`);
  }
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: "Titles and H1s use the words people search for, and pages answer early",
    bad: "Titles, H1s or opening lines don't use the words people search for",
    evidence: rows.map(
      ({ p }) =>
        `${quoteQuery(p.query)} → ${pathOf(p.url)}: title covers ${pct01(Math.min(1, num(p.titleAlignment)))}% of the query's key words, H1 ${pct01(Math.min(1, num(p.h1Alignment)))}%, answered in the first 150 words: ${p.answerEarly ? "yes" : "no"}`,
    ),
    fixes,
  });
}

/* ---------- relevance.cannibalization(15)—— 一个意图一页(规格 v2 §4) ---------- */

/** 两个内容页标题主题词 Jaccard ≥ 0.6 且页面形态相同 → 在抢同一个搜索 */
const CANNIBAL_JACCARD = 0.6;
/** Search Console:query 曝光 ≥ 20,且 ≥ 2 个页面各占该 query ≥ 10% 曝光 → 同组 */
const GSC_SPLIT_MIN_IMPRESSIONS = 20;
const GSC_SPLIT_MIN_SHARE = 0.1;
/** 落在组里的内容页占 30% 即 0 分 */
const CANNIBAL_ZERO_SHARE = 0.3;
/**
 * 关键词规范化只去虚词:"best crm" 与 "crm" 是两种意图(比较 vs 导航),不能因为 best 是"标题高频词"就并成一个;
 * 去掉的只是不改变意图的功能词,于是 "seo audits" ≡ "seo audit" ≡ "audit for seo"。
 */
const KEYWORD_FUNCTION_WORDS = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "and", "or", "with", "at", "by", "from", "is", "are"]);

/** 关键词的规范化词集(小写、去虚词、复数词干、去重排序后拼成串) */
export function keywordKey(keyword: string): string {
  const toks = (keyword ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !KEYWORD_FUNCTION_WORDS.has(t))
    .map(stem);
  return uniq(toks).sort().join(" ");
}

function setJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((x) => {
    if (b.has(x)) inter += 1;
  });
  return inter / (a.size + b.size - inter);
}

interface OverlapGroup {
  /** gsc = Search Console 实测;keyword = 排名词;title = 标题主题 + 形态 */
  kind: "gsc" | "keyword" | "title";
  urls: string[];
  /** 这组在抢的搜索(查询原文,或标题共有的主题词),修法里引用 */
  label: string;
  text: string;
}

/**
 * relevance.cannibalization(15):三种证据各自成组 —— ① 内容页两两之间标题主题词 Jaccard ≥ 0.6 且形态相同;
 * ② 排名词规范化后词集相同却落在不同 URL;③ 有 Search Console 时,同一 query 下 ≥2 个页面各占 ≥10% 曝光(query 曝光 ≥20)。
 * share = 落在组里的内容页 / 内容页数;分 = 100 − min(100, share / 0.3 × 100)。
 * 可信度:接了 Search Console 就是 measured(真实曝光数据参与了判定),否则 estimated。
 * 少于 2 个内容页时没有"两页互抢"可言 → null。
 */
export function scoreRelevanceCannibalization(ctx: RankingContext): SubScore {
  const id = "relevance.cannibalization";
  const gsc = ctx.input.gsc ?? null;
  const confidence: SignalConfidence = gsc ? "measured" : "estimated";
  const pages = ctx.contentPages;
  if (pages.length < 2) {
    return notMeasured(
      id,
      pages.length ? `only 1 content page (${pathOf(pages[0].url)}), so no two pages can compete for the same search` : contentGap(ctx),
      { confidence, fixes: !pages.length && ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] },
    );
  }
  const n = pages.length;
  const index = new Map<string, number>();
  pages.forEach((p, i) => {
    index.set(urlKey(p.url), i);
    if (p.finalUrl) index.set(urlKey(p.finalUrl), i);
  });
  const groups: OverlapGroup[] = [];

  // ① 标题主题 + 形态:两两相似的页用并查集连成组(A~B、B~C 时三页一组)
  const toks = pages.map((p) => topicTokens(titleCore(p), ctx.brand.words));
  const formats = pages.map((p) => classifyFormat(p));
  const links: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (formats[i] === formats[j] && setJaccard(toks[i], toks[j]) >= CANNIBAL_JACCARD) links.push([i, j]);
    }
  }
  for (const g of clusters(n, links)) {
    const urls = g.map((i) => pages[i].url);
    const shared = Array.from(toks[g[0]]).filter((t) => toks[g[1]].has(t));
    groups.push({
      kind: "title",
      urls,
      label: quoteQuery(shared.slice(0, 4).join(" ") || titleCore(pages[g[0]])),
      text: `${paths(urls, 3)} target the same topic${shared.length ? ` ("${shared.slice(0, 4).join(" ")}")` : ""} with the same format (${FORMAT_PLURAL[formats[g[0]]] ?? "general pages"})`,
    });
  }

  // ② 排名词:规范化词集相同、URL 不同(含同一个词两个页面都在排名)。
  //    品牌词不算:品牌词同时排首页、关于页是站点链接的正常形态,不是两页互抢
  const isBrand = (q: string) => isBrandKeyword(q, ctx.brand.keywordTokens);
  const vis = ctx.input.visibility;
  if (vis && !vis.noData) {
    const byKey = new Map<string, { keyword: string; url: string }[]>();
    for (const k of vis.topKeywords ?? []) {
      if (!k?.url || !k.keyword || isBrand(k.keyword)) continue;
      const key = keywordKey(k.keyword);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), { keyword: k.keyword, url: k.url }]);
    }
    for (const key of Array.from(byKey.keys()).sort()) {
      const distinct = new Map<string, { keyword: string; url: string }>();
      for (const r of byKey.get(key) ?? []) if (!distinct.has(urlKey(r.url))) distinct.set(urlKey(r.url), r);
      if (distinct.size < 2) continue;
      const rows = Array.from(distinct.values());
      const sameWords = rows.every((r) => r.keyword.trim().toLowerCase() === rows[0].keyword.trim().toLowerCase());
      groups.push({
        kind: "keyword",
        urls: rows.map((r) => r.url),
        label: quoteQuery(rows[0].keyword),
        text: sameWords
          ? `Google ranks ${paths(rows.map((r) => r.url), 3)} for the same search, ${quoteQuery(rows[0].keyword)}`
          : `Google ranks ${rows
              .slice(0, 3)
              .map((r) => `${pathOf(r.url)} for ${quoteQuery(r.keyword)}`)
              .join(" and ")} — the same search worded differently`,
      });
    }
  }

  // ③ Search Console 实测:同一 query 的曝光被多个页面瓜分
  if (gsc) {
    const brandQueries = new Set((gsc.queries ?? []).filter((q) => q?.brand === true).map((q) => q.query));
    for (const c of gsc.cannibalized ?? []) {
      const total = num(c?.impressions);
      if (!c?.query || total < GSC_SPLIT_MIN_IMPRESSIONS || brandQueries.has(c.query) || isBrand(c.query)) continue;
      const big = (c.pages ?? [])
        .filter((pg) => !!pg?.page && num(pg.impressions) >= GSC_SPLIT_MIN_SHARE * total)
        .sort((a, b) => num(b.impressions) - num(a.impressions) || a.page.localeCompare(b.page));
      if (big.length < 2) continue;
      groups.push({
        kind: "gsc",
        urls: big.map((pg) => pg.page),
        label: quoteQuery(c.query),
        text: `Search Console: impressions for ${quoteQuery(c.query)} are split between ${big
          .slice(0, 3)
          .map((pg) => `${pathOf(pg.page)} (${pctOf(num(pg.impressions), total)}%)`)
          .join(" and ")}`,
      });
    }
  }

  // 只数内容页:组里另一方可以是首页或没抓到的页,但分母是内容页(规格)。一个内容页都不涉及的组(例:首页 vs 定价页)
  // 不影响分数,也就不进证据与修法 —— 否则会出现"没有页互抢"的结论配着一条互抢证据
  const involved = new Set<number>();
  const relevant = groups.filter((g) => g.urls.some((u) => index.has(urlKey(u))));
  for (const g of relevant) {
    for (const u of g.urls) {
      const i = index.get(urlKey(u));
      if (i !== undefined) involved.add(i);
    }
  }
  const share = involved.size / n;
  const ordered = [...relevant.filter((g) => g.kind === "gsc"), ...relevant.filter((g) => g.kind === "keyword"), ...relevant.filter((g) => g.kind === "title")];
  const evidence = [
    involved.size
      ? `${involved.size} of ${n} content pages (${pctOf(involved.size, n)}%) compete with another page for the same search`
      : `None of your ${n} content pages compete with another page for the same search`,
    ...ordered.slice(0, 3).map((g) => g.text),
  ];
  if (!gsc) evidence.push("Estimated from your titles and ranking keywords — connect Search Console to see which searches really split between pages");
  const fixes: string[] = [];
  const first = ordered.find((g) => g.urls.length >= 2);
  if (first) {
    // 两边都是内容页才建议合并;另一方是首页 / 定价页之类时,合并会毁掉那一页 —— 改成"选一页来排、另一页链过去"
    const keep = first.urls.find((u) => index.has(urlKey(u))) ?? first.urls[0];
    const other = first.urls.find((u) => urlKey(u) !== urlKey(keep)) ?? first.urls[1];
    fixes.push(
      first.urls.every((u) => index.has(urlKey(u)))
        ? `Merge ${pathOf(other)} into ${pathOf(keep)} and 301-redirect it, or rewrite one of them to answer a different question`
        : `Pick one page to rank for ${first.label}: keep it on ${pathOf(keep)} and have ${pathOf(other)} link there with that phrase instead of covering the same search`,
    );
  }
  if (ordered.length) fixes.push("Point internal links for each search at the one page you want to rank, using the search phrase as the link text");
  if (!gsc) fixes.push("Connect Search Console to confirm which searches are split between pages");
  return measured(id, {
    score: 100 - Math.min(100, (share / CANNIBAL_ZERO_SHARE) * 100),
    good:
      involved.size === 0
        ? `Each topic has one clear page — none of your ${n} content pages compete for the same search`
        : `Only ${involved.size} of ${n} content pages overlap with another page — most searches have one clear page`,
    bad: `${involved.size} of ${n} content pages compete with another page for the same search, so Google has to choose between them`,
    evidence,
    fixes,
    confidence,
  });
}

/* ============================================================
   内容质量 E-E-A-T(default 20)
   ============================================================ */

/** 规格 §4 quality.experience 的每页公式:min(经验词, 3)/3 × 70 + (自有图片 ≥1 ? 30 : 0) */
export function experiencePoints(c: PageContentSignals): number {
  return (Math.min(num(c.experienceMarkers), 3) / 3) * 70 + (num(c.imagesSelfHosted) >= 1 ? 30 : 0);
}

/** quality.experience(22):内容页平均;无内容页 → null */
export function scoreQualityExperience(ctx: RankingContext): SubScore {
  const id = "quality.experience";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const withExp = pages.filter((p) => num(contentOf(p).experienceMarkers) >= 1);
  const withOwn = pages.filter((p) => num(contentOf(p).imagesSelfHosted) >= 1);
  const stockOnly = pages.filter((p) => num(contentOf(p).imagesSelfHosted) === 0 && num(contentOf(p).imagesStock) > 0);
  const empty = pages.filter((p) => experiencePoints(contentOf(p)) === 0);
  const ranked = [...pages].sort((a, b) => experiencePoints(contentOf(a)) - experiencePoints(contentOf(b)));
  const evidence = [
    `First-person testing language found on ${withExp.length} of ${n} content pages${withExp.length ? ` (${paths(withExp.map((p) => p.url))})` : ""}`,
    `Your own images (screenshots or photos hosted on your site) on ${withOwn.length} of ${n} content pages${stockOnly.length ? `; ${stockOnly.length} use only stock photos (${paths(stockOnly.map((p) => p.url), 2)})` : ""}`,
  ];
  if (empty.length) evidence.push(`No first-hand language and no own images: ${paths(empty.map((p) => p.url))}`);
  const fixes = [`Add what you actually did: the setup you tested, the numbers you saw, a screenshot from your own account — start with ${paths(ranked.map((p) => p.url), 2)}`];
  if (stockOnly.length) fixes.push(`Replace stock photos with your own screenshots or photos on ${paths(stockOnly.map((p) => p.url), 2)}`);
  fixes.push('Add a short "How we tested" note to reviews and guides: what you tried, for how long, and what changed');
  return measured(id, {
    score: mean(pages.map((p) => experiencePoints(contentOf(p)))),
    good: withExp.length === n ? `All ${n} content pages show first-hand experience` : `${withExp.length} of ${n} content pages show first-hand experience`,
    bad: withExp.length === 0 ? `None of your ${n} content pages show first-hand experience` : `Only ${withExp.length} of ${n} content pages show first-hand experience`,
    evidence,
    fixes,
  });
}

function authoritativePer1k(c: PageContentSignals): number {
  return num(c.mainWords) > 0 ? (num(c.authoritativeOutlinks) / num(c.mainWords)) * 1000 : 0;
}

/** 规格 §4 quality.data 的每页公式:原始数据 40 + 表格 20 + 每千词权威外链(≥2→40,≥1→25,>0→10) */
export function dataPoints(c: PageContentSignals): number {
  const per1k = authoritativePer1k(c);
  const sources = per1k >= 2 ? 40 : per1k >= 1 ? 25 : per1k > 0 ? 10 : 0;
  return (Math.min(num(c.originalDataMarkers), 2) / 2) * 40 + (num(c.tableCount) >= 1 ? 20 : 0) + sources;
}

/** quality.data(18):内容页平均 */
export function scoreQualityData(ctx: RankingContext): SubScore {
  const id = "quality.data";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const withData = pages.filter((p) => num(contentOf(p).originalDataMarkers) >= 1);
  const withTable = pages.filter((p) => num(contentOf(p).tableCount) >= 1);
  const noSources = pages.filter((p) => num(contentOf(p).authoritativeOutlinks) === 0);
  const avgPer1k = mean(pages.map((p) => authoritativePer1k(contentOf(p))));
  const fixes: string[] = [];
  if (noSources.length) fixes.push(`Link the primary source for each key claim — official docs, the study, the government page; ${noSources.length} of ${n} pages have no such link (${paths(noSources.map((p) => p.url), 2)})`);
  if (withData.length < n / 2) fixes.push("Publish one piece of original data — a small survey, a benchmark, numbers from your own product — and cite it across related pages");
  if (withTable.length < n / 2) fixes.push("Put key numbers and comparisons in a table so readers can check them at a glance");
  return measured(id, {
    score: mean(pages.map((p) => dataPoints(contentOf(p)))),
    good: "Your content pages back their claims with original data and sources readers can check",
    bad:
      withData.length === 0 && noSources.length === n
        ? "Your content pages make claims without original data or sources readers can check"
        : "Few of your content pages back their claims with original data or sources readers can check",
    evidence: [
      `Original-data language ("our survey", "we analyzed 1,200 …", "methodology") on ${withData.length} of ${n} content pages${withData.length ? ` (${paths(withData.map((p) => p.url))})` : ""}`,
      `Tables on ${withTable.length} of ${n} content pages`,
      `Links to authoritative sources (.gov, .edu, official docs, research, major news): ${fmt1(avgPer1k)} per 1,000 words on average; ${noSources.length ? `${noSources.length} of ${n} pages have none (${paths(noSources.map((p) => p.url))})` : "every content page cites at least one"}`,
    ],
    fixes,
  });
}

/**
 * YMYL 页(健康 / 金融 / 法律):规格只给了词表,没给"页"的门槛。偶尔提一句 tax / invest 的 SaaS 文章
 * 不该被当成理财内容,所以要求 ≥3 次命中且密度 ≥ 2 次 / 千词 —— 真正讲这类话题的页远超这个数。
 */
export function isYmylPage(c: PageContentSignals): boolean {
  const hits = num(c.ymylHits);
  return hits >= 3 && num(c.mainWords) > 0 && (hits / num(c.mainWords)) * 1000 >= 2;
}

/** 只认"路径以它结尾"的页:/company/careers、/support/how-to-x 这类深层页不是 About / Contact 页 */
const ABOUT_PATH = /\/(about|about-us|company|our-story|who-we-are|team|our-team)\/?$/i;
const CONTACT_PATH = /\/(contact|contact-us|get-in-touch|reach-us)\/?$/i;
const SUPPORT_PATH = /\/(support|help)\/?$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const PHONE_RE = /\+?\(?\d[\d\s().-]{7,18}\d/g;
const ADDRESS_RE = /\b\d{1,5}\s+(?:[A-Za-z][A-Za-z.'-]*\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|square|sq|suite|floor)\b|\b[A-Z]{2}\s\d{5}(?:-\d{4})?\b/i;

/** 文本里像电话的串:9–15 位数字,且不是 2024-10-01 这类日期 */
function hasPhone(text: string): boolean {
  for (const m of Array.from(text.matchAll(PHONE_RE))) {
    const s = m[0];
    if (/^\d{4}-\d{2}-\d{2}/.test(s.trim())) continue;
    const digits = s.replace(/\D/g, "").length;
    if (digits >= 9 && digits <= 15) return true;
  }
  return false;
}

/** About 页:抓到的页或站内链接里有 /about 一类路径(与 sec.trust-pages 同口径:链接到了也算) */
function aboutPage(ctx: RankingContext): { url: string; crawled: boolean } | null {
  const crawled = ctx.readable.find((p) => ABOUT_PATH.test(pathOf(p.url).split("?")[0]));
  if (crawled) return { url: crawled.url, crawled: true };
  for (const p of ctx.readable) for (const l of p.links ?? []) if (ABOUT_PATH.test(pathOf(l).split("?")[0])) return { url: l, crawled: false };
  return null;
}

/**
 * Contact 页上的邮箱 / 电话 / 地址。首选 content.contactDetails(解析时对整页判好,含页脚的 mailto: / tel: /
 * PostalAddress);旧数据没有它时退回读片段:textSample(正文前 400 字符)、首段、正文前 150 词、
 * meta description,外加 JSON-LD 里的 ContactPoint / PostalAddress 类型。页面上只有表单、没有任何联系方式时判为缺失。
 */
function contactInfo(ctx: RankingContext): { page: string | null; linkedOnly: boolean; found: string[] } {
  const bare = (u: string) => pathOf(u).split("?")[0];
  // 先找真正的 Contact 页,没有再退到 /support、/help 首页(很多 SaaS 把联系方式放在那里)
  const page = ctx.readable.find((p) => CONTACT_PATH.test(bare(p.url))) ?? ctx.readable.find((p) => SUPPORT_PATH.test(bare(p.url))) ?? null;
  if (!page) {
    let linked: string | null = null;
    for (const p of ctx.readable) {
      linked = (p.links ?? []).find((l) => CONTACT_PATH.test(bare(l))) ?? null;
      if (linked) break;
    }
    return { page: linked, linkedOnly: !!linked, found: [] };
  }
  const text = [page.textSample, page.content?.firstParagraph, page.content?.leadText, page.description].filter(Boolean).join(" \n ");
  const types = (page.jsonLdTypes ?? []).map((t) => t.toLowerCase());
  // 解析时整页(含页脚的 mailto: / tel: / PostalAddress)判好的联系方式优先;旧数据没有这个字段,退回读片段
  const details = page.content?.contactDetails;
  const found: string[] = [];
  if (details?.email || EMAIL_RE.test(text)) found.push("email");
  if (details?.phone || hasPhone(text)) found.push("phone");
  if (details?.address || ADDRESS_RE.test(text) || types.includes("postaladdress")) found.push("address");
  if (!found.length && types.includes("contactpoint")) found.push("contact details in structured data");
  return { page: page.url, linkedOnly: false, found };
}

/** quality.authorship(18)站点级:40 署名 + 15 作者 schema + 15 About + 15 带联系方式的 Contact + 15 sameAs≥2;YMYL ≥20% 且署名 <80% 再扣 15 */
export function scoreQualityAuthorship(ctx: RankingContext): SubScore {
  const id = "quality.authorship";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const byline = pages.filter((p) => contentOf(p).byline === true);
  const noByline = pages.filter((p) => contentOf(p).byline !== true);
  const schema = pages.filter((p) => contentOf(p).authorInSchema === true);
  const bylineShare = byline.length / n;
  const schemaShare = schema.length / n;
  const about = aboutPage(ctx);
  const contact = contactInfo(ctx);
  const contactOk = !!contact.page && !contact.linkedOnly && contact.found.length > 0;
  const maxSameAs = Math.max(0, ...ctx.signalPages.map((p) => num(contentOf(p).sameAsCount)));
  const sameAsOk = maxSameAs >= 2;
  const ymyl = pages.filter((p) => isYmylPage(contentOf(p)));
  const ymylShare = ymyl.length / n;
  const ymylPenalty = ymylShare >= 0.2 && bylineShare < 0.8;
  const raw = 40 * bylineShare + 15 * schemaShare + (about ? 15 : 0) + (contactOk ? 15 : 0) + (sameAsOk ? 15 : 0) - (ymylPenalty ? 15 : 0);
  const ymylClause = ymylPenalty ? " — and health, finance and legal topics are held to a stricter standard, so missing bylines cost extra" : "";
  const contactText = contactOk
    ? `found (${pathOf(contact.page as string)}, with ${contact.found.join(", ")})`
    : contact.page
      ? contact.linkedOnly
        ? `linked (${pathOf(contact.page)}) but not crawled, so its contact details could not be checked`
        : `found (${pathOf(contact.page)}) but no email, phone or address detected`
      : "not found";
  const evidence = [
    `Author byline on ${byline.length} of ${n} content pages; author named in structured data on ${schema.length} of ${n}`,
    `About page: ${about ? `${about.crawled ? "found" : "linked"} (${pathOf(about.url)})` : "not found"}; contact page with email, phone or address: ${contactText}`,
    `Organization schema lists ${plural(maxSameAs, "official profile link")} (sameAs) — 2 or more lets Google confirm who you are`,
  ];
  if (ymylShare >= 0.2) evidence.push(`${ymyl.length} of ${n} content pages (${pct01(ymylShare)}%) cover health, money or legal topics (e.g. ${paths(ymyl.map((p) => p.url), 2)}) — Google expects named, qualified authors there`);
  const fixes: string[] = [];
  if (noByline.length) fixes.push(`Add a visible author byline that links to an author page on every article — missing on ${paths(noByline.map((p) => p.url))}`);
  if (!about) fixes.push("Publish an About page that says who runs the company and why you're qualified, and link it in the footer");
  if (!contactOk) fixes.push(contact.page && !contact.linkedOnly ? `Show an email address, phone number or postal address on ${pathOf(contact.page)}, not just a form` : "Publish a Contact page with an email address, phone number or postal address, and link it in the footer");
  if (!sameAsOk) fixes.push("Add sameAs links to your official profiles (LinkedIn, X, Crunchbase, GitHub) in your Organization schema");
  if (schemaShare < 1) fixes.push("Add the author (name and profile URL) to each article's Article schema");
  return measured(id, {
    score: raw,
    good: `Readers can see who writes your content and who runs the site${ymylClause}`,
    bad: `Readers can't easily see who writes your content or who runs the site${ymylClause}`,
    evidence,
    fixes,
  });
}

function datesOf(c: PageContentSignals): Date[] {
  return [parseDate(c.dateModified), parseDate(c.datePublished)].filter((d): d is Date => d !== null);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** quality.freshness(12):60 × 近 365 天有日期的占比 + 20 × 有任何日期的占比 + 20 × (1 − 标题年份过期占比) */
export function scoreQualityFreshness(ctx: RankingContext): SubScore {
  const id = "quality.freshness";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const nowMs = ctx.now.getTime();
  // 未来日期允许 2 天时钟误差;更远的未来日期是坏数据,不算"最近更新"
  const isRecent = (d: Date) => d.getTime() <= nowMs + 2 * DAY_MS && nowMs - d.getTime() <= 365 * DAY_MS;
  const recent = pages.filter((p) => datesOf(contentOf(p)).some(isRecent));
  const dated = pages.filter((p) => datesOf(contentOf(p)).length > 0);
  const undated = pages.filter((p) => datesOf(contentOf(p)).length === 0);
  const year = ctx.now.getUTCFullYear();
  const staleTitle = pages.filter((p) => {
    const y = contentOf(p).titleYear;
    return typeof y === "number" && y < year - 1;
  });
  const oldest = dated
    .filter((p) => !recent.includes(p))
    .map((p) => ({ p, d: datesOf(contentOf(p)).reduce((a, b) => (a.getTime() >= b.getTime() ? a : b)) }))
    .sort((a, b) => a.d.getTime() - b.d.getTime() || a.p.url.localeCompare(b.p.url));
  const evidence = [
    `Published or updated in the last 365 days: ${recent.length} of ${n} content pages`,
    undated.length
      ? `No machine-readable date (datePublished / dateModified): ${undated.length} of ${n} pages (${paths(undated.map((p) => p.url))})`
      : "Every content page has a machine-readable publish or update date",
  ];
  if (staleTitle.length) evidence.push(`Outdated year in the title: ${staleTitle.slice(0, 3).map((p) => `${pathOf(p.url)} (${contentOf(p).titleYear})`).join(", ")}${staleTitle.length > 3 ? ` (+${staleTitle.length - 3} more)` : ""}`);
  if (oldest.length) evidence.push(`Oldest last update: ${pathOf(oldest[0].p.url)} (${isoDay(oldest[0].d)})`);
  const fixes: string[] = [];
  if (recent.length < n) fixes.push(`Review and update your most important pages first — refresh facts, prices and screenshots, then update dateModified${oldest.length ? ` (oldest: ${paths(oldest.map((o) => o.p.url), 2)})` : ""}`);
  if (undated.length) fixes.push(`Add datePublished and dateModified to every article (Article schema or article:modified_time) — ${undated.length} of ${n} pages have neither`);
  if (staleTitle.length) fixes.push(`Refresh ${paths(staleTitle.map((p) => p.url), 2)} and only then update the year in the title — an old year tells searchers the page is stale`);
  return measured(id, {
    score: 60 * ratio(recent.length, n) + 20 * ratio(dated.length, n) + 20 * (1 - ratio(staleTitle.length, n)),
    good: `${recent.length} of ${n} content pages were published or updated in the last 12 months`,
    bad:
      recent.length === 0
        ? dated.length === 0
          ? `None of your ${n} content pages show a publish or update date`
          : `None of your ${n} content pages show an update in the last 12 months`
        : `Only ${recent.length} of ${n} content pages show an update in the last 12 months`,
    evidence,
    fixes,
  });
}

/** 内容页之间的近重复(minhash ≥ 0.8):返回涉及的页与簇 */
function nearDuplicates(pages: CrawledPage[]): { urls: string[]; groups: string[][] } {
  const hashed = pages.filter((p) => Array.isArray(p.minhash) && p.minhash.length > 0);
  const pairs: [number, number][] = [];
  for (let i = 0; i < hashed.length; i += 1) {
    for (let j = i + 1; j < hashed.length; j += 1) {
      const s = minhashSimilarity(hashed[i].minhash, hashed[j].minhash);
      if (s !== null && s >= NEAR_DUP_SIM) pairs.push([i, j]);
    }
  }
  const groups = clusters(hashed.length, pairs).map((g) => g.map((i) => hashed[i].url));
  return { urls: groups.flat(), groups };
}

/** 同一天发布最多的那一天(并列取较早的日期,保证确定性) */
function publishBurst(pages: CrawledPage[]): { day: string; count: number } | null {
  const days = new Map<string, number>();
  for (const p of pages) {
    const d = parseDate(contentOf(p).datePublished);
    if (d) days.set(isoDay(d), (days.get(isoDay(d)) ?? 0) + 1);
  }
  let best: { day: string; count: number } | null = null;
  for (const day of Array.from(days.keys()).sort()) {
    const count = days.get(day) ?? 0;
    if (!best || count > best.count) best = { day, count };
  }
  return best;
}

/**
 * quality.scaled(18,分高 = 风险低):从 100 扣 —— 近重复占比 × 40;AI 套话每千词 ≥3 → −25、≥1.5 → −12;
 * ≥10 个内容页且 ≥40% 同一天发布 → −20;薄内容占比 × 20;≥80% 内容页零一手经验 → −10;下限 0。
 * 薄内容的分母是"内容类型页"(内容页本身按定义都 ≥300 词,拿它做分母永远是 0)。
 */
export function scoreQualityScaled(ctx: RankingContext): SubScore {
  const id = "quality.scaled";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const dup = nearDuplicates(pages);
  const dupShare = dup.urls.length / n;
  const aiHits = pages.reduce((s, p) => s + num(contentOf(p).aiPhraseHits), 0);
  const words = pages.reduce((s, p) => s + num(contentOf(p).mainWords), 0);
  const aiRate = words > 0 ? (aiHits / words) * 1000 : 0;
  const aiPenalty = aiRate >= 3 ? 25 : aiRate >= 1.5 ? 12 : 0;
  const burst = publishBurst(pages);
  const burstHit = n >= 10 && !!burst && burst.count / n >= 0.4;
  const thin = ctx.typedPages.filter((p) => num(contentOf(p).mainWords) < CONTENT_MIN_WORDS);
  const thinShare = ratio(thin.length, ctx.typedPages.length);
  const zeroExp = pages.filter((p) => num(contentOf(p).experienceMarkers) === 0);
  const zeroExpHit = zeroExp.length / n >= 0.8;
  const score = 100 - dupShare * 40 - aiPenalty - (burstHit ? 20 : 0) - thinShare * 20 - (zeroExpHit ? 10 : 0);
  const aiTop = [...pages]
    .filter((p) => num(contentOf(p).aiPhraseHits) > 0)
    .sort((a, b) => num(contentOf(b).aiPhraseHits) - num(contentOf(a).aiPhraseHits) || a.url.localeCompare(b.url));

  // 证据按扣分多少排序:读者先看到最要紧的那条
  const lines: { cost: number; text: string }[] = [
    {
      cost: dupShare * 40 + 0.01,
      text: `Near-duplicate content pages (text over 80% identical): ${dup.urls.length} of ${n}${dup.groups.length ? ` — e.g. ${paths(dup.groups[0], 3)}` : ""}`,
    },
    {
      cost: aiPenalty + 0.005,
      text: `Stock AI phrases ("delve", "in today's fast-paced world", "unlock the power"): ${fmt1(aiRate)} per 1,000 words${aiTop.length ? ` — most on ${paths(aiTop.map((p) => p.url), 2)}` : ""}`,
    },
  ];
  // 两三页同一天发布很正常,只有触发扣分或已经成片(≥3 页且 ≥25%)时才值得读者看
  if (burst && (burstHit || (burst.count >= 3 && burst.count / n >= 0.25))) {
    lines.push({ cost: burstHit ? 20 : 0, text: `${burst.count} of ${n} content pages (${pctOf(burst.count, n)}%) share the same publish date (${burst.day})` });
  }
  if (thin.length) lines.push({ cost: thinShare * 20, text: `Thin pages (under ${CONTENT_MIN_WORDS} words of main text): ${thin.length} of ${ctx.typedPages.length} (${paths(thin.map((p) => p.url))})` });
  if (zeroExp.length) lines.push({ cost: zeroExpHit ? 10 : 0, text: `No first-hand experience on ${zeroExp.length} of ${n} content pages (${pctOf(zeroExp.length, n)}%)` });
  lines.sort((a, b) => b.cost - a.cost);

  const fixes: string[] = [];
  if (dup.urls.length) fixes.push(`Merge near-duplicate pages into one stronger page and 301-redirect the rest (${paths(dup.groups[0] ?? dup.urls, 2)})`);
  if (aiPenalty) fixes.push("Edit out stock AI phrases and replace them with specifics only you know: numbers, examples, opinions");
  if (burstHit) fixes.push("Stop publishing in batches of look-alike pages; give each new page something only you can add before it goes live");
  if (thin.length) fixes.push(`Expand or merge thin pages — ${paths(thin.map((p) => p.url), 2)} have under ${CONTENT_MIN_WORDS} words`);
  if (zeroExpHit) fixes.push("Add first-hand detail (what you tried, what happened) so pages don't read like generic rewrites");
  return measured(id, {
    score,
    good: "Low risk of looking mass-produced: few duplicates, little AI boilerplate, no thin page batches",
    bad: "Parts of your content look mass-produced — the pattern Google's scaled-content spam policy targets",
    evidence: lines.map((l) => l.text),
    fixes,
  });
}

/* ---------- quality.sources(12)—— 引用是否还有效(规格 v2 §4) ---------- */

/** 外链失效探针至少测过这么多条,失效占比才有统计意义 */
const MIN_OUTBOUND_CHECKED = 5;
/** 正文里提到的最新年份 ≤ 今年 − 3 → 数据大概率过时 */
const STALE_DATA_YEARS = 3;

/** 正文提到的最新年份(1990–2099);没有为 null */
function newestBodyYear(c: PageContentSignals): number | null {
  const ys = (c.bodyYears ?? []).filter((y) => finite(y) && y >= 1990 && y <= 2099);
  return ys.length ? Math.max(...ys) : null;
}

/** 规格 v2 §4 quality.sources 的三项分(某项没有分母为 null) */
export function sourcesTerms(x: { brokenShare: number | null; staleShare: number | null; unsourcedShare: number | null }): { broken: number | null; stale: number | null; unsourced: number | null } {
  return {
    broken: x.brokenShare === null ? null : 50 * (1 - Math.min(1, x.brokenShare / 0.2)),
    stale: x.staleShare === null ? null : 30 * (1 - x.staleShare),
    unsourced: x.unsourcedShare === null ? null : 20 * (1 - x.unsourcedShare),
  };
}

/**
 * quality.sources(12):失效外链 50 × (1 − min(1, 失效占比 / 0.2))(测过 ≥5 条才算)+ 过时数据 30 × (1 − 最新年份 ≤ 今年−3 的页占比)
 * (只在提到年份的内容页里算)+ 无来源 20 × (1 − 零外链内容页占比)。某项没有分母按其余项重新归一;三项都没有 → null。
 */
export function scoreQualitySources(ctx: RankingContext): SubScore {
  const id = "quality.sources";
  const probe = ctx.input.probe;
  const checked = num(probe?.outboundChecked);
  const broken = Array.isArray(probe?.brokenOutbound) ? probe.brokenOutbound.filter((b) => !!b && typeof b.to === "string") : [];
  const pages = ctx.contentPages;
  const n = pages.length;
  const cutoff = ctx.now.getUTCFullYear() - STALE_DATA_YEARS;

  const brokenShare = checked >= MIN_OUTBOUND_CHECKED ? Math.min(1, broken.length / checked) : null;
  const dated = pages
    .map((p) => ({ p, y: newestBodyYear(contentOf(p)) }))
    .filter((x): x is { p: CrawledPage; y: number } => x.y !== null);
  const stale = dated.filter((x) => x.y <= cutoff).sort((a, b) => a.y - b.y || a.p.url.localeCompare(b.p.url));
  const staleShare = dated.length ? stale.length / dated.length : null;
  const unsourced = pages.filter((p) => num(contentOf(p).outboundLinks) === 0);
  const unsourcedShare = n ? unsourced.length / n : null;

  const t = sourcesTerms({ brokenShare, staleShare, unsourcedShare });
  const terms = [
    { max: 50, pts: t.broken },
    { max: 30, pts: t.stale },
    { max: 20, pts: t.unsourced },
  ].filter((x): x is { max: number; pts: number } => x.pts !== null);
  if (!terms.length) {
    return notMeasured(id, `${contentGap(ctx)}, and ${checked ? `only ${plural(checked, "outbound link")} could be tested` : "no outbound links could be tested"} (we need ${MIN_OUTBOUND_CHECKED} or more)`);
  }
  const ex = broken[0];
  const evidence = [
    brokenShare !== null
      ? `Broken outbound links: ${broken.length} of ${checked} we tested (${pctOf(broken.length, checked)}%)${ex ? ` — e.g. ${pathOf(ex.from)} links to ${clip(ex.to, 80)} (${ex.status ? `HTTP ${ex.status}` : "no response"})` : ""}`
      : `Only ${plural(checked, "outbound link")} could be tested (we need ${MIN_OUTBOUND_CHECKED} or more), so broken links are not scored`,
    staleShare !== null
      ? `Pages where the newest year mentioned is ${cutoff} or earlier: ${stale.length} of ${dated.length} pages that mention a year${stale.length ? ` (e.g. ${pathOf(stale[0].p.url)} — newest ${stale[0].y})` : ""}`
      : "No content page mentions a year, so outdated statistics could not be checked",
  ];
  if (unsourcedShare !== null) evidence.push(`Content pages that link to no outside source: ${unsourced.length} of ${n}${unsourced.length ? ` (${paths(unsourced.map((p) => p.url))})` : ""}`);
  const losses = [
    { lost: t.broken === null ? 0 : 50 - t.broken, text: `${pctOf(broken.length, checked)}% of the outbound links we tested are broken` },
    { lost: t.stale === null ? 0 : 30 - t.stale, text: `${stale.length} of ${dated.length} pages that mention a year mention nothing newer than ${cutoff} — their data is likely out of date` },
    { lost: t.unsourced === null ? 0 : 20 - t.unsourced, text: `${unsourced.length} of ${n} content pages don't link to any source` },
  ].sort((a, b) => b.lost - a.lost);
  const fixes: string[] = [];
  if (ex) fixes.push(`Fix or remove ${plural(broken.length, "broken outbound link")} — start with ${pathOf(ex.from)} → ${clip(ex.to, 80)}`);
  if (stale.length) fixes.push(`Update the statistics on ${paths(stale.map((x) => x.p.url), 2)}: replace numbers from ${stale[0].y} or earlier with current ones and say when you checked`);
  if (unsourced.length) fixes.push(`Link the source for key facts on ${paths(unsourced.map((p) => p.url), 2)} — a page that cites nobody is harder to trust`);
  return measured(id, {
    score: (100 * terms.reduce((s, x) => s + x.pts, 0)) / terms.reduce((s, x) => s + x.max, 0),
    good: "Your citations hold up: few broken links, current data and sources on most pages",
    bad: losses[0].text,
    evidence,
    fixes,
  });
}

/* ============================================================
   权威、外链与声誉(default 20)
   ============================================================ */

const BODY_LOCATIONS = ["article", "main", "section"];
const CHROME_LOCATIONS = ["header", "footer", "aside", "nav"];
const GOOD_PLATFORMS = ["blogs", "news", "cms"];

function sumKeys(rec: Record<string, number> | undefined, keys: string[]): number {
  return keys.reduce((s, k) => s + num(rec?.[k]), 0);
}

function sumKnown(rec: Record<string, number> | undefined, unknown: string[]): number {
  return Object.keys(rec ?? {})
    .filter((k) => !unknown.includes(k))
    .reduce((s, k) => s + num(rec?.[k]), 0);
}

/**
 * authority.editorial(18):min(60, 正文位置占比 / 0.6 × 60) + min(40, 优质平台占比 / 0.6 × 40)。
 * 没有外链 → 0;authority 为 null / noData → null。DataForSEO 只回了其中一项分布时,
 * 用那一项按满分重新归一(与规格"缺项重新归一"同一原则),并在证据里写明。
 */
export function scoreAuthorityEditorial(ctx: RankingContext): SubScore {
  const id = "authority.editorial";
  const a = ctx.input.authority;
  const gap = authorityGap(a);
  if (gap || !a) return notMeasured(id, gap ?? "backlink data was not available for this report");
  if (num(a.backlinks) === 0 && num(a.referringDomains) === 0) {
    return measured(id, {
      score: 0,
      good: "",
      bad: "No backlinks found yet, so no editorial links either",
      evidence: ["0 backlinks and 0 referring domains in DataForSEO's index"],
      fixes: ["Earn your first editorial links: offer data, quotes or a free tool to writers who cover your topic", "Get listed on partner, integration and customer pages that link to you from their content"],
    });
  }
  const locs = a.semanticLocations;
  const plats = a.platformTypes;
  const knownLoc = sumKnown(locs, ["", "unknown"]);
  const bodyLoc = sumKeys(locs, BODY_LOCATIONS);
  const chromeLoc = sumKeys(locs, CHROME_LOCATIONS);
  const knownPlat = sumKnown(plats, ["", "unknown"]);
  const goodPlat = sumKeys(plats, GOOD_PLATFORMS);
  const locShare = knownLoc > 0 ? bodyLoc / knownLoc : null;
  const platShare = knownPlat > 0 ? goodPlat / knownPlat : null;
  if (locShare === null && platShare === null) return notMeasured(id, "DataForSEO did not report where your links sit on the page or what kind of sites they come from");
  const locPts = locShare === null ? 0 : Math.min(60, (locShare / 0.6) * 60);
  const platPts = platShare === null ? 0 : Math.min(40, (platShare / 0.6) * 40);
  const score = locShare !== null && platShare !== null ? locPts + platPts : locShare !== null ? (locPts / 60) * 100 : (platPts / 40) * 100;
  const topPlats = Object.entries(plats ?? {})
    .filter(([k, v]) => k && k !== "unknown" && num(v) > 0)
    .sort((x, y) => num(y[1]) - num(x[1]) || x[0].localeCompare(y[0]))
    .slice(0, 3)
    .map(([k, v]) => `${k} ${pctOf(num(v), knownPlat)}%`);
  const evidence = [
    locShare !== null
      ? `Link placement: ${pct01(locShare)}% inside article or main content, ${pctOf(chromeLoc, knownLoc)}% in headers, footers, sidebars or menus (${fmtInt(knownLoc)} links with a known position)`
      : "Link placement not reported by DataForSEO — scored on the type of linking sites only",
    platShare !== null
      ? `Linking sites: ${pct01(platShare)}% are blogs, news or publishing platforms${topPlats.length ? ` (top types: ${topPlats.join(", ")})` : ""}`
      : "Type of linking sites not reported by DataForSEO — scored on link placement only",
    `${fmtInt(num(a.referringDomains))} referring domains and ${fmtInt(num(a.backlinks))} backlinks in total`,
  ];
  const locWeak = locShare !== null && locShare < 0.6;
  const platWeak = platShare !== null && platShare < 0.6;
  const fixes: string[] = [];
  if (locWeak) fixes.push("Earn links inside articles: offer data, quotes or a useful tool to writers covering your topic — in-text links count far more than footer or directory links");
  if (platWeak) fixes.push("Pitch blogs, newsletters and trade publications your buyers read; skip directories and link exchanges");
  fixes.push("Turn unlinked mentions of your brand into links by asking the author to add one");
  return measured(id, {
    score,
    good: `${locShare !== null ? `${pct01(locShare)}% of your links sit inside page content` : `${pct01(platShare as number)}% of your links come from blogs, news or publishing sites`} — the kind of links Google weighs most`,
    // <70 时必有一项偏弱:位置偏弱优先说位置(它占 60 分),否则就是平台类型偏弱
    bad: locWeak
      ? "Most of your backlinks sit in footers, sidebars or directories rather than inside articles"
      : "Few of your backlinks come from blogs, news sites or publications — the kind Google weighs most",
    evidence,
    fixes,
  });
}

/** authority.breadth(18)= authority.score(与外链模块同一个数);null / noData → null */
export function scoreAuthorityBreadth(ctx: RankingContext): SubScore {
  const id = "authority.breadth";
  const a = ctx.input.authority;
  const gap = authorityGap(a);
  if (gap || !a) return notMeasured(id, gap ?? "backlink data was not available for this report");
  const rd = num(a.referringDomains);
  const rank = typeof a.rank === "number" && Number.isFinite(a.rank) ? a.rank : null;
  const evidence = [
    `${fmtInt(rd)} referring domains and ${fmtInt(num(a.backlinks))} backlinks (${pct01(Math.min(1, num(a.nofollowShare)))}% nofollow)`,
  ];
  if (rank !== null) evidence.push(`DataForSEO Domain Rank ${fmtInt(rank)} on a 0–1,000 scale`);
  if (typeof a.spamScore === "number") evidence.push(`Spam score ${fmtInt(a.spamScore)}/100${a.spamScore > 30 ? " — high, which lowers this score" : ""}`);
  const ts = a.timeseries ?? [];
  if (ts.length) {
    const gained = ts.reduce((s, t) => s + num(t.newReferringDomains), 0);
    const lost = ts.reduce((s, t) => s + num(t.lostReferringDomains), 0);
    evidence.push(`Last 90 days: ${fmtInt(gained)} new vs ${fmtInt(lost)} lost referring domains`);
  }
  if (num(a.brokenBacklinks) > 0) evidence.push(`${fmtInt(num(a.brokenBacklinks))} backlinks point to pages on your site that no longer exist`);
  const fixes: string[] = [];
  if (num(a.brokenBacklinks) > 0) fixes.push(`Recover ${fmtInt(num(a.brokenBacklinks))} broken backlinks by 301-redirecting the dead URLs they point to`);
  fixes.push("Publish one asset worth linking to — original data, a free tool or a template — and pitch it to sites your buyers read");
  fixes.push("Get listed where buyers compare options: \"best X\" roundups, partner pages, podcasts and integration directories");
  if (typeof a.spamScore === "number" && a.spamScore > 30) fixes.push("Review the spammiest linking domains and disavow the ones you didn't ask for");
  return measured(id, {
    score: num(a.score),
    good: `${num(a.score) >= 85 ? "Strong" : "Solid"} link profile: ${fmtInt(rd)} referring domains${rank !== null ? ` and a Domain Rank of ${fmtInt(rank)}` : ""}`,
    bad: rd < 10 ? `Very few sites link to you: ${plural(rd, "referring domain")}` : `Your link authority trails stronger sites: ${fmtInt(rd)} referring domains${rank !== null ? `, Domain Rank ${fmtInt(rank)}` : ""}`,
    evidence,
    fixes,
  });
}

function linkKeySets(pages: CrawledPage[]): Set<string>[] {
  return pages.map((p) => new Set((p.links ?? []).map((l) => urlKey(l))));
}

/**
 * 主题簇:≥3 个内容页共享同一个主题词(标题去品牌后缀 + H1,去停用词与品牌词),
 * 且在这些页之间沿站内链接(任一方向)连通。按词分组再找连通块 —— 这样一个簇里的页
 * 一定讨论同一个主题,不会因为 A-B 共享"seo"、B-C 共享"audit"就被串成一串。
 */
export function findTopicClusters(pages: CrawledPage[], brandWords: ReadonlySet<string> = new Set()): { token: string; urls: string[] }[] {
  const keyIndex = new Map<string, number>();
  pages.forEach((p, i) => {
    keyIndex.set(urlKey(p.url), i);
    if (p.finalUrl) keyIndex.set(urlKey(p.finalUrl), i);
  });
  const adj: Set<number>[] = pages.map(() => new Set<number>());
  pages.forEach((p, i) => {
    for (const l of p.links ?? []) {
      const j = keyIndex.get(urlKey(l));
      if (j !== undefined && j !== i) {
        adj[i].add(j);
        adj[j].add(i);
      }
    }
  });
  const byToken = new Map<string, number[]>();
  pages.forEach((p, i) => {
    const toks = topicTokens(`${titleCore(p)} ${(p.h1s ?? []).join(" ")}`, brandWords);
    for (const t of Array.from(toks)) byToken.set(t, [...(byToken.get(t) ?? []), i]);
  });
  const out: { token: string; urls: string[] }[] = [];
  for (const token of Array.from(byToken.keys()).sort()) {
    const members = byToken.get(token) ?? [];
    if (members.length < 3) continue;
    const inGroup = new Set(members);
    const seen = new Set<number>();
    for (const start of members) {
      if (seen.has(start)) continue;
      const comp: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const x = stack.pop() as number;
        comp.push(x);
        for (const y of Array.from(adj[x])) {
          if (inGroup.has(y) && !seen.has(y)) {
            seen.add(y);
            stack.push(y);
          }
        }
      }
      if (comp.length >= 3) out.push({ token, urls: comp.sort((a, b) => a - b).map((i) => pages[i].url) });
    }
  }
  return out;
}

/** authority.clusters(10)= min(100, 落在簇里的内容页占比 / 0.6 × 100);内容页 <5 → null */
export function scoreAuthorityClusters(ctx: RankingContext): SubScore {
  const id = "authority.clusters";
  const pages = ctx.contentPages;
  if (pages.length < 5) {
    return notMeasured(
      id,
      pages.length ? `fewer than 5 content pages (found ${pages.length}), too few to form topic clusters` : contentGap(ctx),
      { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] },
    );
  }
  const n = pages.length;
  const found = findTopicClusters(pages, ctx.brand.words);
  const clustered = new Set(found.flatMap((c) => c.urls));
  const standalone = pages.filter((p) => !clustered.has(p.url));
  const s = clustered.size / n;
  // 证据里同一组页只列一次(它们可能同时共享好几个主题词),大簇优先
  const shown: { token: string; urls: string[] }[] = [];
  for (const c of [...found].sort((a, b) => b.urls.length - a.urls.length || a.token.localeCompare(b.token))) {
    const sig = c.urls.join("|");
    if (shown.some((x) => x.urls.join("|") === sig)) continue;
    shown.push(c);
    if (shown.length === 3) break;
  }
  const evidence = shown.map((c) => `Cluster "${c.token}": ${c.urls.length} linked pages (${paths(c.urls)})`);
  evidence.push(`Standalone content pages (no linked pages on the same topic): ${standalone.length} of ${n}${standalone.length ? ` (${paths(standalone.map((p) => p.url))})` : ""}`);
  return measured(id, {
    score: Math.min(100, (s / 0.6) * 100),
    good: `${pct01(s)}% of your content pages sit in topic clusters that link to each other`,
    bad: clustered.size === 0 ? "None of your content pages form a topic cluster — each one stands alone" : `Only ${pct01(s)}% of your content pages belong to a topic cluster — most stand alone`,
    evidence,
    fixes: [
      `Give each main topic a hub page that links to 3+ related articles, and have those articles link back — start with ${paths(standalone.map((p) => p.url), 2)}`,
      'Add a "Related reading" block at the end of each article linking to 2–3 pages on the same topic',
      "Use the topic's main word in the title of every page in the cluster so the grouping is obvious to readers and Google",
    ],
  });
}

interface CorePage {
  page: CrawledPage;
  role: string;
}

/** 核心页 = 首页 + pricing / product 页 + 排名词对应 URL(在抓取集合里的) */
function corePages(ctx: RankingContext): CorePage[] {
  const out = new Map<string, CorePage>();
  const add = (page: CrawledPage, role: string) => {
    const k = urlKey(page.url);
    if (!out.has(k)) out.set(k, { page, role });
  };
  if (ctx.home) add(ctx.home, "homepage");
  for (const p of ctx.readable) {
    const t = pageTypeOf(p);
    if (t === "pricing") add(p, "pricing page");
    else if (t === "product") add(p, "product page");
  }
  const vis = ctx.input.visibility;
  if (vis && !vis.noData) {
    for (const kw of vis.topKeywords ?? []) {
      if (!kw?.url) continue;
      const p = findPage(ctx.readable, kw.url);
      if (p) add(p, `ranks for ${quoteQuery(kw.keyword)}`);
    }
  }
  return Array.from(out.values());
}

/** 规格 §4 authority.internal 的分档:链到它的已抓页占比 ≥50% → 100,≥20% → 70,≥5% → 40,其余 10 */
export function inboundPoints(share: number): number {
  return share >= 0.5 ? 100 : share >= 0.2 ? 70 : share >= 0.05 ? 40 : 10;
}

/** authority.internal(10):每个核心页按入链页占比给分,取平均 */
export function scoreAuthorityInternal(ctx: RankingContext): SubScore {
  const id = "authority.internal";
  if (ctx.readable.length < 2) return notMeasured(id, `we need at least 2 crawled pages to measure internal links (found ${ctx.readable.length})`);
  const core = corePages(ctx);
  if (!core.length) return notMeasured(id, "we could not identify your homepage, pricing, product or ranking pages among the crawled pages");
  const sets = linkKeySets(ctx.readable);
  const others = ctx.readable.length - 1;
  const rows = core
    .map(({ page, role }) => {
      const keys = uniq([urlKey(page.url), page.finalUrl ? urlKey(page.finalUrl) : ""].filter(Boolean));
      let inbound = 0;
      ctx.readable.forEach((p, i) => {
        if (p === page) return;
        if (keys.some((k) => sets[i].has(k))) inbound += 1;
      });
      const s = inbound / others;
      return { page, role, inbound, s, pts: inboundPoints(s) };
    })
    .sort((a, b) => a.s - b.s || a.page.url.localeCompare(b.page.url));
  const weak = rows.filter((r) => r.s < 0.2);
  const fixes = weak.map((r) =>
    r.role === "homepage" || r.role === "pricing page"
      ? `Link ${pathOf(r.page.url)} (${r.role}) from your main navigation or footer so every page passes authority to it`
      : r.role.startsWith("ranks for")
        ? `Link ${pathOf(r.page.url)} from 3–5 related pages, using the words people search (it ${r.role})`
        : `Link ${pathOf(r.page.url)} (${r.role}) from related articles and your main navigation`,
  );
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: `Your key pages (homepage, pricing, product and ranking pages) are linked from most of the site`,
    bad: `Some key pages get few internal links: ${paths(weak.map((r) => r.page.url), 3) || paths(rows.map((r) => r.page.url), 2)}`,
    evidence: rows.map((r) => `${pathOf(r.page.url)} (${r.role}) is linked from ${r.inbound} of ${others} other crawled pages (${pct01(r.s)}%)`),
    fixes,
  });
}

/** 规格 §4 authority.entity 的品牌需求分档:≥1000 → 40,≥100 → 25,>0 → 10,0 → 0 */
export function brandDemandPoints(volume: number): number {
  return volume >= 1000 ? 40 : volume >= 100 ? 25 : volume > 0 ? 10 : 0;
}

/** authority.entity(8):实体一致 40 + sameAs≥2 20 + 品牌需求 40;visibility 无数据时品牌需求不计,按 60 满额重新归一 */
export function scoreAuthorityEntity(ctx: RankingContext): SubScore {
  const id = "authority.entity";
  const pages = ctx.signalPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx));
  const b = ctx.brand;
  const n = pages.length;
  const consistentShare = b.consistentPages.length / n;
  const entityOk = consistentShare >= 0.8 && b.matchesDomain;
  const maxSameAs = Math.max(0, ...pages.map((p) => num(contentOf(p).sameAsCount)));
  const sameAsOk = maxSameAs >= 2;
  const vis = ctx.input.visibility;
  const visOk = !!vis && !vis.noData;
  const brandKws = visOk ? (vis.topKeywords ?? []).filter((k) => !!k && isBrandKeyword(k.keyword, b.keywordTokens)) : [];
  const volume = brandKws.reduce((s, k) => s + num(k.volume), 0);
  const demandPts = visOk ? brandDemandPoints(volume) : 0;
  const base = (entityOk ? 40 : 0) + (sameAsOk ? 20 : 0);
  const score = visOk ? base + demandPts : (base / 60) * 100;
  const name = b.name ?? b.label;
  const evidence = [
    b.name
      ? `Brand name "${b.name}" appears on ${b.consistentPages.length} of ${n} pages (Organization schema, og:site_name or title suffix)${b.matchesDomain ? "" : ` — it doesn't match the domain ${ctx.input.domain}`}`
      : `No brand name found in Organization schema, og:site_name or title suffixes on any of the ${n} pages`,
    `Organization schema lists ${plural(maxSameAs, "official profile link")} (sameAs)`,
    visOk
      ? `Brand searches: about ${fmtInt(volume)} a month across ${plural(brandKws.length, "brand keyword")}${brandKws.length ? ` (e.g. ${quoteQuery([...brandKws].sort((x, y) => num(y.volume) - num(x.volume) || x.keyword.localeCompare(y.keyword))[0].keyword)})` : ""}`
      : "Brand search demand not measured (no ranking data) — scored on the other two signals",
  ];
  // 问题句挑丢分最多的那一项来说;"实体不一致"要分清是"页面之间不一致"还是"与域名对不上"
  const consistent = consistentShare >= 0.8;
  const entityText = !b.name
    ? "Your pages don't state a brand name Google can tie them to"
    : consistent
      ? `Your brand name "${b.name}" doesn't match your domain ${ctx.input.domain}, so Google may not connect the two`
      : `Your brand name isn't used consistently enough for Google to tie every page to "${b.name}"`;
  const losses: { pts: number; text: string }[] = [
    { pts: entityOk ? 0 : 40, text: entityText },
    { pts: visOk ? 40 - demandPts : 0, text: `Few people search for "${name}" by name yet` },
    { pts: sameAsOk ? 0 : 20, text: "Google can't confirm your brand: no official profiles are linked from your Organization schema" },
  ].sort((x, y) => y.pts - x.pts);
  const fixes: string[] = [];
  if (!entityOk && (!b.name || !consistent)) fixes.push(`Use the same brand name in the title suffix, og:site_name and Organization schema on every page${b.inconsistentPages.length ? ` — it is missing or different on ${paths(b.inconsistentPages, 2)}` : ""}`);
  if (!entityOk && b.name && consistent) fixes.push(`Tie the name to the domain: put "${b.name}" and ${ctx.input.domain} together in your Organization schema (name, alternateName, url) and on your About page`);
  if (!sameAsOk) fixes.push("Add sameAs links to your LinkedIn, X, Crunchbase or GitHub profiles in your Organization schema");
  if (visOk && demandPts < 40) fixes.push("Build brand demand: show up where buyers already are (communities, podcasts, partner newsletters) so they search for you by name");
  return measured(id, {
    score,
    good: `Google can tie your pages to one clear brand: "${name}"`,
    bad: losses[0].text,
    evidence,
    fixes,
  });
}

/* ---------- authority.linkprofile(10)—— 链接质量细项(规格 v2 §4) ---------- */

/**
 * 通用锚文本("click here"、"website"、空锚 / 纯符号)既不是品牌也不是关键词 —— 不算"过度优化"的候选,
 * 但留在分母里(它们也是锚文本分布的一部分)。
 */
const GENERIC_ANCHOR =
  /^(?:click here|here|this|this link|link|website|web site|site|homepage|home page|home|read more|learn more|more|more info|source|visit|visit site|visit website|go|continue|this article|this post|this page|official site|official website|view|details|download|[\W_]*)$/i;
/** 裸 URL / 域名锚("example.com"、"https://…")天然是品牌类,不是关键词 */
const URL_ANCHOR = /^(?:https?:\/\/|www\.)|^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i;

type AnchorKind = "brand" | "url" | "generic" | "keyword";

function anchorKind(anchor: string, ctx: RankingContext): AnchorKind {
  const a = (anchor ?? "").trim();
  if (!a || GENERIC_ANCHOR.test(a)) return "generic";
  if (URL_ANCHOR.test(a)) return "url";
  const tokens = uniq([...ctx.brand.keywordTokens, ctx.brand.key && ctx.brand.key.length >= 4 ? ctx.brand.key : ""].filter(Boolean));
  return isBrandKeyword(a, tokens) ? "brand" : "keyword";
}

/** 规格 §4 的锚文本分档:非品牌最大锚文本占比 ≤ 0.4 → 30,≤ 0.6 → 15,否则 0 */
export function anchorPoints(topShare: number): number {
  return topShare <= 0.4 ? 30 : topShare <= 0.6 ? 15 : 0;
}

/**
 * authority.linkprofile(10):增速 40 × 新增 / (新增 + 丢失)(近 90 天引荐域)+ 锚文本 30 / 15 / 0
 * + 深链 30 × 有自己外链的排名页占比(非首页)。没有数据的项不计,按可用项重新归一;三项都没有 → null。
 * 锚文本占比按引荐域计(一个站的全站页脚链接不该把占比冲到 90%);DataForSEO 没给引荐域时退回按外链数。
 */
export function scoreAuthorityLinkProfile(ctx: RankingContext): SubScore {
  const id = "authority.linkprofile";
  const a = ctx.input.authority;
  const aOk = !!a && !a.noData;
  const vis = ctx.input.visibility;
  const visOk = !!vis && !vis.noData;

  // ① 增速
  const ts = aOk ? (a.timeseries ?? []) : [];
  const gained = ts.reduce((s, x) => s + num(x?.newReferringDomains), 0);
  const lost = ts.reduce((s, x) => s + num(x?.lostReferringDomains), 0);
  const growth = gained + lost > 0 ? gained / (gained + lost) : null;

  // ② 锚文本
  const anchors = aOk ? (a.anchors ?? []).filter((x) => !!x && typeof x.anchor === "string") : [];
  const byRd = anchors.reduce((s, x) => s + num(x.referringDomains), 0) > 0;
  const metric = (x: { backlinks: number; referringDomains: number }) => (byRd ? num(x.referringDomains) : num(x.backlinks));
  const total = anchors.reduce((s, x) => s + metric(x), 0);
  const kinds = anchors.map((x) => ({ x, kind: anchorKind(x.anchor, ctx) }));
  const keywordAnchors = kinds
    .filter((k) => k.kind === "keyword")
    .map((k) => k.x)
    .sort((p, q) => metric(q) - metric(p) || p.anchor.localeCompare(q.anchor));
  const topShare = total > 0 ? (keywordAnchors.length ? metric(keywordAnchors[0]) / total : 0) : null;
  const brandShare = total > 0 ? kinds.filter((k) => k.kind === "brand" || k.kind === "url").reduce((s, k) => s + metric(k.x), 0) / total : 0;

  // ③ 深链:排名 URL(非首页)里有自己外链的占比;同一 URL 多个词时取最大值,没给数的 URL 不进分母
  const byUrl = new Map<string, { url: string; rd: number | null }>();
  if (visOk) {
    const homeKey = ctx.home ? urlKey(ctx.home.url) : null;
    for (const k of vis.topKeywords ?? []) {
      if (!k?.url || pathOnly(k.url) === "/" || urlKey(k.url) === homeKey) continue;
      const key = urlKey(k.url);
      const rd = finite(k.pageReferringDomains) ? k.pageReferringDomains : null;
      const prev = byUrl.get(key);
      if (!prev) byUrl.set(key, { url: k.url, rd });
      else if (rd !== null && (prev.rd === null || rd > prev.rd)) prev.rd = rd;
    }
  }
  const known = Array.from(byUrl.values()).filter((x): x is { url: string; rd: number } => x.rd !== null);
  const withLinks = known.filter((x) => x.rd >= 1);
  const without = known.filter((x) => x.rd < 1);
  const deep = known.length ? withLinks.length / known.length : null;

  const terms = [
    { max: 40, pts: growth === null ? null : 40 * growth },
    { max: 30, pts: topShare === null ? null : anchorPoints(topShare) },
    { max: 30, pts: deep === null ? null : 30 * deep },
  ];
  const avail = terms.filter((x): x is { max: number; pts: number } => x.pts !== null);
  if (!avail.length) {
    return notMeasured(
      id,
      !aOk && !visOk
        ? (authorityGap(a) ?? "backlink data was not available for this report")
        : "DataForSEO reported no link growth, anchor text or links to your ranking pages for this domain",
    );
  }
  const top = keywordAnchors[0];
  const unit = byRd ? "linking domains" : "backlinks";
  const evidence = [
    growth !== null
      ? `Last 90 days: ${fmtInt(gained)} new vs ${fmtInt(lost)} lost referring domains — ${pct01(growth)}% of the movement is growth`
      : "Link growth not reported for the last 90 days — scored on the other signals",
    topShare !== null
      ? top
        ? `Most-used keyword anchor: "${clip(top.anchor, 60)}" on ${pct01(topShare)}% of ${unit}; brand and URL anchors make up ${pct01(brandShare)}%`
        : `No keyword-rich anchor among your top ${plural(anchors.length, "anchor")} — brand and URL anchors make up ${pct01(brandShare)}%`
      : "Anchor text not reported — scored on the other signals",
    deep !== null
      ? `Ranking pages (other than the homepage) with backlinks of their own: ${withLinks.length} of ${known.length}${without.length ? ` — none for ${paths(without.map((x) => x.url), 2)}` : ""}`
      : "No page-level link data for your ranking pages — scored on the other signals",
  ];
  // 每一项丢分都配一条修法,按丢分多少排序:问题句与第一条修法说的是同一件事
  const losses = [
    {
      lost: growth === null ? 0 : 40 - 40 * growth,
      text: `Link growth is weak: ${fmtInt(gained)} new vs ${fmtInt(lost)} lost referring domains in the last 90 days`,
      fix:
        growth !== null && growth < 0.6
          ? `You gained ${fmtInt(gained)} and lost ${fmtInt(lost)} referring domains in 90 days — check which links disappeared and ask those sites to restore or update them`
          : "Keep new linking sites coming: pitch one useful resource a month to sites that already link to pages like yours",
    },
    {
      lost: topShare === null ? 0 : 30 - anchorPoints(topShare),
      text: `One keyword anchor${top ? ` ("${clip(top.anchor, 40)}")` : ""} dominates your backlinks — a pattern Google treats as manipulative`,
      fix: top && topShare !== null ? `Diversify anchor text: "${clip(top.anchor, 40)}" makes up ${pct01(topShare)}% of your ${unit} — ask for your brand name or a natural phrase in new links` : "",
    },
    {
      lost: deep === null ? 0 : 30 - 30 * deep,
      text: `${without.length} of ${known.length} ranking pages have no backlinks of their own — links point only at your homepage`,
      fix: without.length ? `Earn links to the pages that rank, not just the homepage — ${paths(without.map((x) => x.url), 2)} have none` : "",
    },
  ].sort((x, y) => y.lost - x.lost);
  return measured(id, {
    score: (100 * avail.reduce((s, x) => s + x.pts, 0)) / avail.reduce((s, x) => s + x.max, 0),
    good: "A healthy link profile: steady growth, natural anchor text and links to inner pages",
    bad: losses[0].text,
    evidence,
    fixes: losses.filter((x) => x.lost > 0.5 && x.fix).map((x) => x.fix),
  });
}

/* ---------- authority.focus(12)—— 主题聚焦(规格 v2 §4) ---------- */

/** 分页 / 标签 / 作者 / 分类页不是内容,不考察 */
const FOCUS_SKIP_PATH = /\/(?:tags?|authors?|category|categories|page)(?:\/|$)|[?&]page=\d+/i;
const LEGAL_PATH = /\/(?:privacy|terms|tos|legal|cookies?|imprint|impressum|disclaimer|gdpr|refund|accessibility)(?:[-_./]|$)/i;
/**
 * 公司 / 功能性栏目(联系、关于、团队、招聘、定价、帮助)与 pageTypeOf 的 contact / pricing 同口径:
 * 它们不是"内容",谈不上跑题;不排除的话 /contact-us、/careers/engineer 都会被算成跑题页。
 */
const UTILITY_PATH = /^\/(?:contact|contact-us|about|about-us|team|our-team|support|help|careers?|jobs?|pricing|plans|price)(?:[/?]|$)/i;
const NON_PAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|pdf|xml|txt|csv|zip|gz|mp4|mp3|webm|css|js|json)$/i;
/** sitemap 只看前 2000 条(与 run.ts 传入的上限一致) */
const SITEMAP_FOCUS_MAX = 2000;
/** 核心词汇少于 5 个词时不足以判断"主题",不出分 */
const FOCUS_MIN_CORE = 5;
/** 跑题页占一半即 0 分 */
const FOCUS_ZERO_SHARE = 0.5;
/** sitemap 跑题示例最多留 5 个(证据也只列 5 个) */
const FOCUS_EXAMPLES = 5;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** sitemap URL 的 slug 主题词;slug 少于 2 个词、分页 / 标签 / 作者 / 法律 / 公司功能页 / 非页面文件 → null(不考察) */
export function slugTopic(url: string, brandWords: ReadonlySet<string> = new Set()): Set<string> | null {
  const full = pathOf(url);
  const bare = full.split("?")[0];
  if (FOCUS_SKIP_PATH.test(full) || LEGAL_PATH.test(bare) || UTILITY_PATH.test(bare) || NON_PAGE_EXT.test(bare) || isToolPath(url)) return null;
  const last = bare.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  const words = safeDecode(last)
    .replace(/\.(?:html?|php|aspx?)$/i, "")
    .split(/[-_+.\s]+/)
    .filter(Boolean);
  if (words.length < 2) return null;
  const toks = topicTokens(words.join(" "), brandWords);
  return toks.size ? toks : null;
}

/** 链到某页的已抓页数(不含自己) */
function inboundCount(ctx: RankingContext, page: CrawledPage, sets: Set<string>[]): number {
  const keys = uniq([urlKey(page.url), page.finalUrl ? urlKey(page.finalUrl) : ""].filter(Boolean));
  let n = 0;
  ctx.readable.forEach((q, i) => {
    if (q !== page && keys.some((k) => sets[i].has(k))) n += 1;
  });
  return n;
}

/**
 * 核心词汇 = 首页 title + H1 + description 的主题词 ∪ 点击深度 1 的内容页标题主题词 ∪ 入链最多的 5 个内容页标题主题词
 * (去品牌 / 停用词,词干化)。按出现次数降序返回,供证据展示。
 */
export function coreVocabulary(ctx: RankingContext): Map<string, number> {
  const bw = ctx.brand.words;
  const core = new Map<string, number>();
  const add = (toks: Set<string>) => toks.forEach((t) => core.set(t, (core.get(t) ?? 0) + 1));
  const home = ctx.home;
  if (home) add(topicTokens(`${titleCore(home)} ${(home.h1s ?? []).join(" ")} ${home.description ?? ""}`, bw));
  for (const p of ctx.contentPages) if (p.depth === 1) add(topicTokens(titleCore(p), bw));
  const sets = linkKeySets(ctx.readable);
  // 一条入链都没有的页谈不上"入链最多",不拿它定义核心主题(否则只是按 URL 字母序挑了 5 页)
  const ranked = ctx.contentPages
    .map((p) => ({ p, n: inboundCount(ctx, p, sets) }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n || x.p.url.localeCompare(y.p.url));
  for (const { p } of ranked.slice(0, 5)) add(topicTokens(titleCore(p), bw));
  return core;
}

function overlapsCore(toks: Set<string>, core: Map<string, number>): boolean {
  return Array.from(toks).some((t) => core.has(t));
}

/** 已抓内容页按标题 + H1 的主题词参与考察(没有主题词的页无从判断,跳过) */
function crawledFocusItems(ctx: RankingContext): { url: string; toks: Set<string> }[] {
  return ctx.contentPages
    .map((p) => ({ url: p.url, toks: topicTokens(`${titleCore(p)} ${(p.h1s ?? []).join(" ")}`, ctx.brand.words) }))
    .filter((x) => x.toks.size > 0);
}

export type SitemapFocus = NonNullable<RankingFramework["basis"]["sitemapFocus"]>;

/**
 * 主题聚焦里 sitemap 那一部分:考察了多少条、跑题多少条、跑题示例(≤5 个路径)。
 * - 给了 sitemapUrls:当场按 slug 判(已抓到的页不重复计,内容页按标题判、非内容页不判);
 * - 没给 sitemapUrls 但给了 sitemapFocus(接入 / 断开 Search Console 时从已存结果重算):原样采用存下的计数 ——
 *   sitemap 缓存只在抓取那次进程里有,重算时拿不到 URL,存计数才能让重算结果与原结果逐字相同;
 * - 都没有 → null(只看已抓内容页)。
 */
export function sitemapFocusOf(ctx: RankingContext, core: Map<string, number> = coreVocabulary(ctx)): SitemapFocus | null {
  const urls = ctx.input.sitemapUrls;
  if (Array.isArray(urls)) {
    const crawled = new Set<string>();
    for (const p of ctx.readable) {
      crawled.add(urlKey(p.url));
      if (p.finalUrl) crawled.add(urlKey(p.finalUrl));
    }
    const seen = new Set<string>();
    let considered = 0;
    let offTopic = 0;
    const examples: string[] = [];
    for (const u of urls.slice(0, SITEMAP_FOCUS_MAX)) {
      if (typeof u !== "string" || !isOwnDomain(hostOf(u), ctx.input.domain)) continue;
      const key = urlKey(u);
      if (crawled.has(key) || seen.has(key)) continue;
      seen.add(key);
      const toks = slugTopic(u, ctx.brand.words);
      if (!toks) continue;
      considered += 1;
      if (!overlapsCore(toks, core)) {
        offTopic += 1;
        if (examples.length < FOCUS_EXAMPLES) examples.push(pathOf(u));
      }
    }
    return { considered, offTopic, examples };
  }
  const stored = ctx.input.sitemapFocus;
  if (stored && finite(stored.considered) && finite(stored.offTopic)) {
    const considered = Math.max(0, Math.round(stored.considered));
    return {
      considered,
      offTopic: Math.min(considered, Math.max(0, Math.round(stored.offTopic))),
      examples: (Array.isArray(stored.examples) ? stored.examples : []).filter((x): x is string => typeof x === "string" && !!x).slice(0, FOCUS_EXAMPLES),
    };
  }
  return null;
}

/** "/a, /b, /c (+4 more)":前几个示例 + 总数(sitemap 只存了 5 个示例,所以总数单独给) */
function examplePaths(shownFrom: string[], total: number, n: number): string {
  const shown = shownFrom.slice(0, n);
  const rest = total - shown.length;
  return rest > 0 ? `${shown.join(", ")} (+${rest} more)` : shown.join(", ");
}

/**
 * authority.focus(12):考察集合 = 已抓内容页(标题 + H1 主题词)+ sitemap 里的其余 URL(slug 主题词,≥2 个词,
 * 排除标签 / 作者 / 分页 / 法律 / 公司功能页);跑题 = 与核心词汇零重合。分 = 100 × (1 − min(1, 跑题占比 / 0.5))。
 * 核心词汇少于 5 个词 → null。有 Search Console 时证据另列"近 28 天有曝光却 0 点击的页数"。
 */
export function scoreAuthorityFocus(ctx: RankingContext): SubScore {
  const id = "authority.focus";
  const core = coreVocabulary(ctx);
  if (core.size < FOCUS_MIN_CORE) {
    return notMeasured(id, `your homepage and main pages name too few topic words (${core.size}) to tell what the site is about`, {
      fixes: ["Say what you do in plain words in your homepage title, H1 and meta description"],
    });
  }
  const crawled = crawledFocusItems(ctx);
  const sm = sitemapFocusOf(ctx, core);
  const total = crawled.length + (sm?.considered ?? 0);
  if (!total) return notMeasured(id, "no content pages or sitemap URLs could be checked against your core topics");
  const crawledOff = crawled.filter((x) => !overlapsCore(x.toks, core));
  const offTotal = crawledOff.length + (sm?.offTopic ?? 0);
  const share = offTotal / total;
  // 示例:先列已抓的跑题页,再列 sitemap 里的
  const offPaths = [...crawledOff.map((x) => pathOf(x.url)), ...(sm?.examples ?? [])];
  const coreTop = Array.from(core.entries())
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, 8)
    .map(([t]) => t);
  const evidence = [
    `Core topics (from your homepage and most-linked pages): ${coreTop.join(", ")}`,
    `Off-topic: ${offTotal} of ${total} pages share no topic word with them (${plural(crawled.length, "crawled content page")} + ${fmtInt(sm?.considered ?? 0)} more from your sitemap)`,
  ];
  if (offTotal) evidence.push(`Off-topic examples: ${examplePaths(offPaths, offTotal, FOCUS_EXAMPLES)}`);
  const zc = ctx.input.gsc?.zeroClickPages;
  if (zc && num(zc.total) > 0) evidence.push(`Search Console: ${fmtInt(num(zc.count))} of ${fmtInt(num(zc.total))} pages with impressions got no clicks in the last 28 days`);
  const fixes: string[] = [];
  if (offTotal) fixes.push(`Merge, redirect or retire pages unrelated to your core topics — e.g. ${examplePaths(offPaths, offTotal, 3)}`);
  fixes.push(`Plan new content inside your core topics (${coreTop.slice(0, 3).join(", ")}) so every page strengthens the same subject`);
  if (zc && num(zc.count) > 0) fixes.push("Review pages that get impressions but no clicks in Search Console: improve the on-topic ones and retire the rest");
  return measured(id, {
    score: 100 * (1 - Math.min(1, share / FOCUS_ZERO_SHARE)),
    good: offTotal === 0 ? "Every page we checked stays on your core topics" : `Only ${pctOf(offTotal, total)}% of pages stray from your core topics — the site reads as one clear subject`,
    bad: `${offTotal} of ${total} pages (${pctOf(offTotal, total)}%) are off your core topics, which blurs what Google thinks the site is about`,
    evidence,
    fixes,
  });
}

/* ---------- authority.reputation(14;本地商家 25)—— 站外声誉(规格 v2 §4) ---------- */

/** 评价平台的平均分:按评价数加权(评价数缺失按 1 计);没有任何评分为 null */
function averageRating(platforms: ReputationAnalysis["reviewPlatforms"]): number | null {
  const rated = (platforms ?? []).filter((p) => !!p?.rating && finite(p.rating.value));
  if (!rated.length) return null;
  return weightedMean(rated.map((p) => ({ w: volWeight(p.rating?.votes), v: (p.rating as { value: number }).value })));
}

/**
 * 规格 v2 §4 authority.reputation:品牌 SERP(第 1 → 25,前 3 → 15;知识面板 +10;ownsBrandSerp 为 null → 该项不计)
 * + 评价平台(≥2 → 30,1 → 15;平均分 ≥4.0 → 15,≥3.5 → 8)+ 独立提及(≥4 → 20,≥2 → 10)− 每个负面标题 10(上限 20)。
 * 品牌 SERP 项不计时其余两项(满分 65)按 100 重新归一,再扣负面;夹到 0–100。
 */
export function reputationScore(r: ReputationAnalysis): number {
  const serp = r.ownsBrandSerp === null || r.ownsBrandSerp === undefined ? null : (r.ownsBrandSerp ? 25 : r.brandTop3 ? 15 : 0) + (r.knowledgePanel ? 10 : 0);
  const platforms = uniq((r.reviewPlatforms ?? []).map((p) => bareHost(p?.domain ?? "")).filter(Boolean)).length;
  const rating = averageRating(r.reviewPlatforms);
  const reviews = (platforms >= 2 ? 30 : platforms === 1 ? 15 : 0) + (rating === null ? 0 : rating >= 4 ? 15 : rating >= 3.5 ? 8 : 0);
  const independent = num(r.independentDomains) >= 4 ? 20 : num(r.independentDomains) >= 2 ? 10 : 0;
  const penalty = Math.min(20, 10 * Math.max(0, num(r.negativeSignals)));
  const max = (serp === null ? 0 : 35) + 45 + 20;
  return Math.min(100, Math.max(0, (100 * ((serp ?? 0) + reviews + independent)) / max - penalty));
}

/** authority.reputation:reputation 没跑(null)→ null */
export function scoreAuthorityReputation(ctx: RankingContext): SubScore {
  const id = "authority.reputation";
  const r = ctx.input.reputation ?? null;
  if (!r) return notMeasured(id, "the brand reputation check did not run for this report");
  const brand = (r.brandName || ctx.brand.name || ctx.brand.label || ctx.input.domain).trim();
  const brandQuery = r.brandQuery || brand;
  const reviewsQuery = r.reviewsQuery || `${brand} reviews`;
  const owns = r.ownsBrandSerp === null || r.ownsBrandSerp === undefined ? null : r.ownsBrandSerp;
  const platforms = (r.reviewPlatforms ?? []).filter((p) => !!p?.domain);
  const platformCount = uniq(platforms.map((p) => bareHost(p.domain))).length;
  const rating = averageRating(platforms);
  const indep = Math.max(0, num(r.independentDomains));
  const negative = Math.max(0, num(r.negativeSignals));
  const forums = Math.max(0, num(r.forumMentions));
  const score = reputationScore(r);

  const platformText = (p: (typeof platforms)[number]) =>
    `${bareHost(p.domain)}${p.rating && finite(p.rating.value) ? ` ${fmt1(p.rating.value)}★${finite(p.rating.votes) ? ` (${plural(p.rating.votes, "review")})` : ""}` : ""}`;
  const evidence = [
    owns === null
      ? `Searching ${quoteQuery(brandQuery)} returned no results we could judge`
      : `Searching ${quoteQuery(brandQuery)}: ${owns ? "your site is #1" : r.brandTop3 ? "your site is in the top 3 but not #1" : "your site is not in the top 3"}${r.knowledgePanel ? ", with a knowledge panel" : ", no knowledge panel"}`,
    platformCount
      ? `Review sites for ${quoteQuery(reviewsQuery)}: ${platforms.slice(0, 3).map(platformText).join(", ")}${rating !== null ? ` — average ${fmt1(rating)}★` : ""}`
      : `No review platform (G2, Capterra, Trustpilot, Google Maps, Yelp …) shows up for ${quoteQuery(reviewsQuery)}`,
    `${plural(indep, "independent site")} in the top 10 for ${quoteQuery(brandQuery)}${forums ? `, plus ${plural(forums, "forum thread")} (Reddit, Quora …)` : ""}`,
  ];
  if (negative) evidence.push(`${plural(negative, "result")} for your brand mention scams, complaints or lawsuits`);
  const serpPts = owns === null ? null : (owns ? 25 : r.brandTop3 ? 15 : 0) + (r.knowledgePanel ? 10 : 0);
  const reviewPts = (platformCount >= 2 ? 30 : platformCount === 1 ? 15 : 0) + (rating === null ? 0 : rating >= 4 ? 15 : rating >= 3.5 ? 8 : 0);
  // 问题句挑丢分最多的一项;并列时负面结果优先(买家最先看到它),其后按品牌 SERP → 评价 → 独立提及
  const losses = [
    { lost: Math.min(20, 10 * negative), rank: 0, text: `Searches for ${quoteQuery(brand)} surface complaints or scam warnings` },
    { lost: serpPts === null ? 0 : 35 - serpPts, rank: 1, text: `Your site isn't the top result when people search for ${quoteQuery(brandQuery)}` },
    {
      lost: 45 - reviewPts,
      rank: 2,
      text: platformCount
        ? `Buyers searching ${quoteQuery(reviewsQuery)} find few reviews of you${rating !== null && rating < 4 ? ` (average ${fmt1(rating)}★)` : ""}`
        : `Buyers searching ${quoteQuery(reviewsQuery)} find no reviews of you`,
    },
    { lost: 20 - (indep >= 4 ? 20 : indep >= 2 ? 10 : 0), rank: 3, text: `Few independent sites mention ${quoteQuery(brand)} — only ${plural(indep, "site")} besides yours and the review platforms` },
  ].sort((x, y) => y.lost - x.lost || x.rank - y.rank);
  const fixes: string[] = [];
  if (negative) fixes.push("Reply publicly to the complaints that show up for your brand and resolve them — buyers read those results first");
  if (owns === false) fixes.push(`Make your site the top result for ${quoteQuery(brand)}: use the exact brand name in your homepage title and Organization schema, and link your official profiles`);
  if (platformCount < 2) fixes.push(`Collect reviews on ${platformCount ? "one more" : "two"} review site${platformCount ? "" : "s"} your buyers check — G2 or Capterra for software, Google Business Profile or Yelp for local services, Trustpilot for stores`);
  else if (rating !== null && rating < 4) fixes.push(`Lift your ${fmt1(rating)}★ average: reply to every negative review and ask happy customers to leave one`);
  if (indep < 4) fixes.push("Get mentioned on independent sites — guest articles, podcasts, partner pages and \"best X\" roundups your buyers read");
  return measured(id, {
    score,
    good: owns === true ? `People searching for ${quoteQuery(brand)} find you first and see independent reviews` : `Reviews and independent mentions vouch for ${quoteQuery(brand)}`,
    bad: losses[0].text,
    evidence,
    fixes,
  });
}

/* ============================================================
   可赢性(default 10)—— 选的战场打不打得赢(规格 v2 §4)
   ============================================================ */

/** S13 弱位:竞品页超过 18 个月没更新 / 主体 < 500 词 / 域名权威 < 100 */
const STALE_COMPETITOR_MONTHS = 18;
const THIN_COMPETITOR_WORDS = 500;
const LOW_AUTHORITY_RANK = 100;
/** 一个查询至少要能评估前 5 名里的 3 个,弱位数才有意义 */
const MIN_KNOWN_RESULTS = 3;

/** 弱位标记的固定顺序(UI 的弱位标签与证据里都按它排,同一份报告每次读出来一样) */
const WEAK_SPOT_ORDER = ["forum", "stale", "thin", "off-intent", "low-authority"];

function orderWeakSpots(flags: string[]): string[] {
  const rank = (f: string) => {
    const i = WEAK_SPOT_ORDER.indexOf(f);
    return i === -1 ? WEAK_SPOT_ORDER.length : i;
  };
  // Array.prototype.sort 是稳定排序:未知标记保持原来的相对顺序,排在已知标记之后
  return [...flags].sort((a, b) => rank(a) - rank(b));
}

const WEAK_SPOT_TEXT: Record<string, string> = {
  forum: "forum or user-generated page",
  stale: "not updated in 18+ months",
  thin: "thin page",
  "off-intent": "doesn't match the search",
  "low-authority": "low-authority site",
};

function monthsAgo(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()));
}

/**
 * 一个竞品结果的弱位标记:relevance.ts 给的 weakSpots,再叠加本站权威规则("domainRank ≤ 本站 rank" → low-authority)。
 * 旧数据(v3 相关性分析没有 weakSpots)按规格同一套规则就地补算能补的几项;off-intent 需要查询语境,旧数据不补。
 */
export function competitorWeakSpots(c: CompetitorPageSignals, ownRank: number | null, now: Date): string[] {
  const flags: string[] = Array.isArray(c.weakSpots) ? c.weakSpots.filter((f) => typeof f === "string" && !!f) : [];
  const add = (f: string) => {
    if (!flags.includes(f)) flags.push(f);
  };
  if (!Array.isArray(c.weakSpots)) {
    if (c.ugc === true) add("forum");
    const d = parseDate(c.dateModified ?? null);
    if (d && d.getTime() < monthsAgo(now, STALE_COMPETITOR_MONTHS).getTime()) add("stale");
    if (c.fetched && num(c.wordCount) < THIN_COMPETITOR_WORDS) add("thin");
    if (finite(c.domainRank) && c.domainRank < LOW_AUTHORITY_RANK) add("low-authority");
  }
  if (ownRank !== null && finite(c.domainRank) && c.domainRank <= ownRank) add("low-authority");
  return orderWeakSpots(flags);
}

/** 规格 §4 serpweakness 的分档:前 5 里带标记的结果数 0 → 20,1 → 50,2 → 80,≥3 → 100 */
export function weakSpotPoints(weak: number): number {
  return weak <= 0 ? 20 : weak === 1 ? 50 : weak === 2 ? 80 : 100;
}

/** "已知结果" = relevance.ts 评估过(有 weakSpots)或抓到了页面 */
function isKnownResult(c: CompetitorPageSignals): boolean {
  return Array.isArray(c.weakSpots) || c.fetched === true;
}

/**
 * 输出用的相关性分析:input.relevance 的副本,每个"已知结果"的竞品带上合并后的弱位(relevance.ts 的标记 +
 * "≤ 本站 rank"规则,固定顺序)—— UI 的弱位标签与 serpweakness 的证据读的是同一组标记,不会对不上。
 * 不改 input;没评估过的竞品原样保留(写个空数组会让它在重算时变成"已知结果",分数就不可复现了)。
 */
export function relevanceWithWeakSpots(rel: RelevanceAnalysis | null, ownRank: number | null, now: Date): RelevanceAnalysis | null {
  if (!rel) return null;
  if (!Array.isArray(rel.pairs)) return { ...rel };
  return {
    ...rel,
    pairs: rel.pairs.map((p) =>
      p && Array.isArray(p.competitors)
        ? { ...p, competitors: p.competitors.map((c) => (c && typeof c === "object" && isKnownResult(c) ? { ...c, weakSpots: competitorWeakSpots(c, ownRank, now) } : c)) }
        : p,
    ),
  };
}

function weakSpotLabel(c: CompetitorPageSignals, flags: string[]): string {
  return flags.map((f) => (f === "low-authority" && finite(c.domainRank) ? `low-authority site, rank ${fmtInt(c.domainRank)}` : (WEAK_SPOT_TEXT[f] ?? f))).join(", ");
}

/**
 * winnability.serpweakness(30):每个查询取前 5 名,数带 ≥1 个弱位标记的结果(forum / stale / thin / off-intent / low-authority);
 * 0 → 20、1 → 50、2 → 80、≥3 → 100,取平均。少于 3 个已知结果的查询不进平均;一个都没有 → null。
 */
export function scoreWinnabilitySerpWeakness(ctx: RankingContext): SubScore {
  const id = "winnability.serpweakness";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const own = ownDomainRank(ctx.input);
  const rows = ctx.pairs
    .map((p) => {
      const top = [...(p.competitors ?? [])]
        .filter((c) => !!c && typeof c === "object")
        .sort((a, b) => num(a.position) - num(b.position))
        .slice(0, 5);
      const known = top.filter(isKnownResult);
      const weak = known.map((c) => ({ c, flags: competitorWeakSpots(c, own, ctx.now) })).filter((x) => x.flags.length > 0);
      return { p, known: known.length, weak, pts: weakSpotPoints(weak.length) };
    })
    .filter((r) => r.known >= MIN_KNOWN_RESULTS);
  if (!rows.length) {
    return notMeasured(id, `we could not assess at least ${MIN_KNOWN_RESULTS} of the top 5 results for any of your queries`, {
      evidence: ctx.pairs.slice(0, 2).map((p) => `${quoteQuery(p.query)}: ${(p.competitors ?? []).filter(isKnownResult).length} of the top results could be assessed`),
    });
  }
  const sorted = [...rows].sort((a, b) => b.weak.length - a.weak.length || a.p.query.localeCompare(b.p.query));
  const avgWeak = mean(rows.map((r) => r.weak.length));
  const evidence = sorted.map(
    (r) =>
      `${quoteQuery(r.p.query)}: ${r.weak.length} of the top ${r.known} ${r.weak.length === 1 ? "is" : "are"} beatable${r.weak.length ? ` — ${r.weak
        .slice(0, 3)
        .map((x) => `${x.c.domain} (${weakSpotLabel(x.c, x.flags)})`)
        .join("; ")}` : ""}`,
  );
  const fixes: string[] = [];
  const best = sorted.find((r) => r.weak.length >= 2);
  if (best) fixes.push(`Go after ${quoteQuery(best.p.query)} first: ${best.weak.length} of the top 5 are weak — a thorough, up-to-date page can take one of those spots`);
  for (const r of sorted.filter((x) => x.weak.length <= 1).slice(0, 2)) {
    fixes.push(`For ${quoteQuery(r.p.query)} the top 5 are strong sites — target a narrower version of it (a specific use case, audience or location) where weaker pages rank`);
  }
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: `The top 5 for your queries include beatable pages — ${fmt1(avgWeak)} weak result${avgWeak === 1 ? "" : "s"} per query on average`,
    bad: "The top 5 results for your queries are hard to displace — few forum threads, stale, thin or low-authority pages among them",
    evidence,
    fixes,
  });
}

/** 规格 §4 difficulty 的分档:有本站强度时按 kd − 强度(≤10 → 100,≤25 → 70,≤40 → 40,其余 10);没有时按绝对 KD(≤30 / ≤45 / ≤60) */
export function difficultyPoints(kd: number, strength: number | null): number {
  if (strength === null) return kd <= 30 ? 100 : kd <= 45 ? 70 : kd <= 60 ? 40 : 10;
  return kd <= strength + 10 ? 100 : kd <= strength + 25 ? 70 : kd <= strength + 40 ? 40 : 10;
}

const DIFFICULTY_VERDICT: Record<number, string> = { 100: "within reach", 70: "a stretch", 40: "hard", 10: "out of reach for now" };

/**
 * winnability.difficulty(25):本站强度 = min(100, Domain Rank / 8);每对按 KD 与强度的差分档,按搜索量加权平均(量缺失记 1)。
 * 没有 Domain Rank 时按绝对 KD 分档,summary 注明;没有任何 KD → null。
 */
export function scoreWinnabilityDifficulty(ctx: RankingContext): SubScore {
  const id = "winnability.difficulty";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const rows = ctx.pairs.filter((p) => finite(p.kd)).map((p) => ({ p, kd: p.kd as number, w: volWeight(p.volume) }));
  if (!rows.length) {
    // kd 为 null = 这一版查了但 DataForSEO 没有难度数据;字段不存在 = 旧报告
    return notMeasured(
      id,
      ctx.pairs.some((p) => p.kd !== undefined)
        ? "DataForSEO has no keyword difficulty for the queries we analysed"
        : "this report predates keyword difficulty data — re-run it to measure",
    );
  }
  const rank = ownDomainRank(ctx.input);
  const strength = rank === null ? null : Math.min(100, rank / 8);
  const scored = rows.map((r) => ({ ...r, pts: difficultyPoints(r.kd, strength) })).sort((a, b) => a.pts - b.pts || b.kd - a.kd || a.p.query.localeCompare(b.p.query));
  const absolute = strength === null ? " (judged on absolute difficulty — no Domain Rank available)" : "";
  const fit = strength === null ? "within reach" : "within reach for a site of your strength";
  const evidence = [
    strength !== null
      ? `Your strength: Domain Rank ${fmtInt(rank as number)} ≈ ${Math.round(strength)}/100 on the keyword-difficulty scale`
      : "No Domain Rank available, so queries are judged on absolute difficulty (30 or less is easy)",
    ...scored.map(
      (r) => `${quoteQuery(r.p.query)} — difficulty ${Math.round(r.kd)}/100${finite(r.p.volume) ? `, ${fmtInt(r.p.volume)} searches a month` : ""}: ${DIFFICULTY_VERDICT[r.pts] ?? "hard"}`,
    ),
  ];
  const fixes: string[] = [];
  for (const r of scored.filter((x) => x.pts <= 40).slice(0, 2)) {
    fixes.push(`${quoteQuery(r.p.query)} (difficulty ${Math.round(r.kd)}) is beyond your site's current strength — target a longer, more specific version first and come back once you have more links`);
  }
  if (scored.some((x) => x.pts < 100)) {
    fixes.push(strength !== null ? `Prioritise queries with difficulty under ${Math.round(strength + 10)} — that's where a site of your strength ranks fastest` : "Prioritise queries with difficulty of 30 or less while you build authority");
  }
  return measured(id, {
    score: weightedMean(scored.map((r) => ({ w: r.w, v: r.pts }))),
    good: `Most of your queries are ${fit}${absolute}`,
    bad: strength === null ? `Several of your queries are too competitive to win quickly${absolute}` : "Several of your queries are harder than your site can win today",
    evidence,
    fixes,
  });
}

/** 规格 §4 gap 的分档:本站 rank / 对手 rank ≥1 → 100,≥0.6 → 70,≥0.3 → 40,其余 10 */
export function gapPoints(ratio: number): number {
  return ratio >= 1 ? 100 : ratio >= 0.6 ? 70 : ratio >= 0.3 ? 40 : 10;
}

/**
 * winnability.gap(20):每对 ratio = 本站 Domain Rank / 该词前 10 名平均主域权威(缺则用前 5 竞品 domainRank 的中位数);
 * 分档取平均。缺本站 rank 或所有对都缺对手数据 → null。对手权威为 0 时比值视为 ≥1。
 */
export function scoreWinnabilityGap(ctx: RankingContext): SubScore {
  const id = "winnability.gap";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const rank = ownDomainRank(ctx.input);
  if (rank === null) return notMeasured(id, ctx.input.authority && !ctx.input.authority.noData ? "your Domain Rank was not reported" : (authorityGap(ctx.input.authority) ?? "your Domain Rank was not available"));
  const rows = ctx.pairs
    .map((p) => {
      const avg = finite(p.avgTopDomainRank) && p.avgTopDomainRank > 0 ? p.avgTopDomainRank : null;
      const comp = median(
        [...(p.competitors ?? [])]
          .sort((a, b) => num(a.position) - num(b.position))
          .slice(0, 5)
          .map((c) => c.domainRank)
          .filter((x): x is number => finite(x)),
      );
      const opp = avg ?? comp;
      if (opp === null) return null;
      const ratio = opp > 0 ? rank / opp : Number.POSITIVE_INFINITY;
      return { p, opp, source: avg !== null ? "top-10 average" : "median of the top 5 we checked", ratio, pts: gapPoints(ratio) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.ratio - b.ratio || a.p.query.localeCompare(b.p.query));
  if (!rows.length) return notMeasured(id, "we have no authority data for the sites ranking for your queries");
  const typical = median(rows.map((r) => r.opp)) ?? 0;
  const evidence = [
    `Your Domain Rank: ${fmtInt(rank)} (0–1,000 scale)`,
    ...rows.map((r) =>
      r.opp > 0
        ? `${quoteQuery(r.p.query)}: ranking sites ${fmtInt(r.opp)} (${r.source}) — you're at ${pct01(Math.min(r.ratio, 9.99))}% of that`
        : `${quoteQuery(r.p.query)}: the ranking sites have no measurable authority (${r.source})`,
    ),
  ];
  const fixes = rows
    .filter((r) => r.ratio < 1)
    .slice(0, 2)
    .map((r) =>
      r.ratio < 0.6
        ? `Close the gap on ${quoteQuery(r.p.query)}: sites ranking there sit at about ${fmtInt(r.opp)} vs your ${fmtInt(rank)} — earn links to ${pathOf(r.p.url)} itself, or pick a query where smaller sites rank`
        : `You're close on ${quoteQuery(r.p.query)} (${fmtInt(rank)} vs about ${fmtInt(r.opp)}) — a few links from relevant sites to ${pathOf(r.p.url)} can tip it`,
    );
  return measured(id, {
    score: mean(rows.map((r) => r.pts)),
    good: "Your site's authority holds up against the sites ranking for your queries",
    bad: `The sites ranking for your queries have ${rank <= 0 || typical / rank >= 2 ? "far " : ""}more authority than yours (Domain Rank ${fmtInt(rank)} vs about ${fmtInt(typical)})`,
    evidence,
    fixes,
  });
}

/** 规格 §4 striking 的名次分档:1–3 → 100,4–10 → 70,11–20 → 40,其余 10 */
export function strikingPoints(position: number): number {
  return position <= 3 ? 100 : position <= 10 ? 70 : position <= 20 ? 40 : 10;
}

/**
 * winnability.striking(10):非品牌排名词按搜索量加权(量缺失 / 0 记 1)的名次分;证据列 4–15 名、月量 ≥50 的词(≤5)。
 * 排名数据缺失 / noData → null;一个非品牌词都没有 → null(没有可推的词)。
 */
export function scoreWinnabilityStriking(ctx: RankingContext): SubScore {
  const id = "winnability.striking";
  const vis = ctx.input.visibility;
  if (!vis || vis.noData) return notMeasured(id, vis ? "DataForSEO has no ranking data for this domain yet" : "ranking data was not available for this report");
  const rows = (vis.topKeywords ?? []).filter((k): k is RankedKeyword => !!k && !!k.keyword && finite(k.position) && k.position >= 1 && !isBrandKeyword(k.keyword, ctx.brand.keywordTokens));
  if (!rows.length) {
    return notMeasured(id, "you don't rank for any non-brand keywords yet", {
      fixes: ["Publish pages that answer the specific questions your buyers search — not just your brand name"],
    });
  }
  const n = rows.length;
  const top3 = rows.filter((k) => k.position <= 3).length;
  const page1 = rows.filter((k) => k.position >= 4 && k.position <= 10).length;
  const page2 = rows.filter((k) => k.position >= 11 && k.position <= 20).length;
  const striking = rows
    .filter((k) => k.position >= 4 && k.position <= 15 && num(k.volume) >= 50)
    .sort((a, b) => num(b.volume) - num(a.volume) || a.position - b.position || a.keyword.localeCompare(b.keyword))
    .slice(0, 5);
  const score = weightedMean(rows.map((k) => ({ w: volWeight(k.volume), v: strikingPoints(k.position) })));
  const evidence = [
    `${top3} of ${plural(n, "non-brand keyword")} rank in the top 3, ${page1} at 4–10 and ${page2} on page two (11–20)`,
    striking.length
      ? `Close to the top: ${striking.map((k) => `${quoteQuery(k.keyword)} (#${k.position}, ${fmtInt(num(k.volume))}/mo)`).join(", ")}`
      : "No keyword with 50+ monthly searches sits at positions 4–15",
  ];
  const fixes = striking
    .slice(0, 2)
    .map((k) => `Push ${quoteQuery(k.keyword)} (#${k.position}, ${fmtInt(num(k.volume))} searches a month) into the top 3: refresh ${k.url ? pathOf(k.url) : "the ranking page"}, add the subtopics the top 3 cover and link to it from related pages`);
  if (rows.some((k) => k.position >= 4 && k.position <= 10)) fixes.push("Rewrite titles and descriptions of pages ranking 4–10 so more searchers pick them");
  return measured(id, {
    score,
    good: score >= 90 ? "Your non-brand keywords mostly rank in the top 3" : "Most of your non-brand search volume ranks on page one",
    bad: "Most of your non-brand search volume ranks below the top 10, where few people click",
    evidence,
    fixes,
  });
}

/** 规格 §4 momentum(有 GSC):clamp(50 + 点击变化% / 40 × 50) */
export function momentumFromChange(changePct: number): number {
  return clampScore(50 + (changePct / 40) * 50);
}

/**
 * winnability.momentum(15):有 Search Console(且两期有点击)时按近 28 天 vs 前 28 天点击变化(measured);
 * 否则用 DataForSEO 排名词升降 (new + up − down − lost) / 合计 → 50 + 50 × 比值(estimated);合计 0 → null。
 */
/** 动量用 Search Console 时的最低样本:两期点击合计 / 两期曝光合计 */
export const MOMENTUM_MIN_CLICKS = 20;
export const MOMENTUM_MIN_IMPRESSIONS = 200;

export function scoreWinnabilityMomentum(ctx: RankingContext): SubScore {
  const id = "winnability.momentum";
  const gsc = ctx.input.gsc ?? null;
  const vis = ctx.input.visibility;
  const visOk = !!vis && !vis.noData;
  // 证据另列:排名词里 rankChange 的升降数
  const changes = visOk ? (vis.topKeywords ?? []).map((k) => k?.rankChange).filter((c): c is NonNullable<RankedKeyword["rankChange"]> => !!c) : [];
  const changeLine = changes.length
    ? `Your top ${plural(changes.length, "keyword")} with rank history: ${changes.filter((c) => c.isUp).length} moved up, ${changes.filter((c) => c.isDown).length} moved down, ${changes.filter((c) => c.isNew).length} new`
    : "";
  // 样本门槛(站长 2026-10-02):"2 次点击 vs 0 次"不是增长,是噪音。两期点击合计 ≥ 20 才用点击;
  // 不够就看曝光(合计 ≥ 200,曝光比点击多一个数量级,小站也够样本);再不够才退回排名升降
  const clicksCur = num(gsc?.totals?.clicks);
  const clicksPrev = num(gsc?.previous?.clicks);
  const imprCur = num(gsc?.totals?.impressions);
  const imprPrev = num(gsc?.previous?.impressions);
  const metric: { name: "clicks" | "impressions"; cur: number; prev: number } | null =
    gsc && gsc.previous
      ? clicksCur + clicksPrev >= MOMENTUM_MIN_CLICKS
        ? { name: "clicks", cur: clicksCur, prev: clicksPrev }
        : imprCur + imprPrev >= MOMENTUM_MIN_IMPRESSIONS
          ? { name: "impressions", cur: imprCur, prev: imprPrev }
          : null
      : null;
  if (gsc && metric) {
    const { name, cur, prev } = metric;
    const Name = name === "clicks" ? "Clicks" : "Impressions";
    const change = prev > 0 ? ((cur - prev) / prev) * 100 : 100;
    const score = momentumFromChange(change);
    const changeText = prev > 0 ? `${sign(change)}${Math.abs(Math.round(change))}%` : "up from zero";
    const smallSample = name === "impressions" ? ` (clicks are too few to compare — ${fmtInt(clicksCur)} vs ${fmtInt(clicksPrev)} — so this uses impressions)` : "";
    return measured(id, {
      score,
      good: prev > 0 ? `${Name} from Google are growing: ${changeText} vs the previous 28 days` : `${Name} from Google are growing: ${fmtInt(cur)} in the last 28 days, up from none before`,
      bad:
        change < 0
          ? `${Name} from Google fell ${Math.abs(Math.round(change))}% vs the previous 28 days`
          : change < 2
            ? `${Name} from Google are flat (${changeText} vs the previous 28 days)`
            : `${Name} from Google are growing only slowly (${changeText} vs the previous 28 days)`,
      evidence: [
        `Search Console ${name}: ${fmtInt(cur)} in the last 28 days vs ${fmtInt(prev)} in the 28 days before (${changeText})${smallSample}`,
        name === "clicks"
          ? `Impressions: ${fmtInt(imprCur)} vs ${fmtInt(imprPrev)}; average position ${fmt1(num(gsc.totals.position))} vs ${fmt1(num(gsc.previous?.position))}`
          : `Average position ${fmt1(num(gsc.totals.position))} vs ${fmt1(num(gsc.previous?.position))}`,
        changeLine,
      ],
      // 16% 以下(< 70 分)是下滑或持平:先救掉点击的页;16–32%(70–89 分)是在涨但还能更快:放大正在涨的页
      fixes:
        change < 16
          ? [
              "Open Search Console → Pages, compare the last 28 days with the previous period and refresh the pages that lost the most clicks first",
              "Update facts, add missing subtopics and improve the titles of pages that slipped, then request indexing again",
            ]
          : ["Keep the growth going: find the queries gaining impressions in Search Console and strengthen those pages with fresher content and internal links"],
      confidence: "measured",
    });
  }
  const mv = visOk ? vis.movement : null;
  const total = mv ? num(mv.isNew) + num(mv.isUp) + num(mv.isDown) + num(mv.isLost) : 0;
  // 走到这里就没用上 Search Console 的点击数据(没接,或两期都没有点击):可信度一律 estimated
  if (!mv || total <= 0) {
    return notMeasured(
      id,
      gsc ? "Search Console has too little traffic to compare periods, and no keyword movement was reported" : visOk ? "no keyword movement was reported for this domain" : "neither Search Console data nor ranking history was available",
      { confidence: "estimated", fixes: gsc ? [] : ["Connect Search Console to measure momentum from your real clicks"] },
    );
  }
  const r = (num(mv.isNew) + num(mv.isUp) - num(mv.isDown) - num(mv.isLost)) / total;
  const fixes: string[] = [];
  if (r < 0.4) fixes.push("Refresh the pages behind falling keywords first: update facts, add missing subtopics and tighten titles");
  if (!gsc) fixes.push("Connect Search Console to measure momentum from your real clicks instead of estimated rankings");
  return measured(id, {
    score: 50 + 50 * r,
    good: "More of your keywords are rising or new than falling",
    bad: r < 0 ? "More of your keywords are falling or dropping out than rising" : r < 0.05 ? "Your rankings are flat — about as many keywords fall as rise" : "Only slightly more of your keywords are rising than falling",
    evidence: [
      `Keyword movement (DataForSEO): ${fmtInt(num(mv.isNew))} new and ${fmtInt(num(mv.isUp))} up vs ${fmtInt(num(mv.isDown))} down and ${fmtInt(num(mv.isLost))} lost`,
      changeLine,
      gsc ? "Search Console shows no clicks in either period, so keyword movement is used instead" : "Estimated from ranking changes — connect Search Console to measure real clicks",
    ],
    fixes,
    confidence: "estimated",
  });
}

/* ============================================================
   AI 搜索与点击机会(default 10)—— 排上去还有没有点击(规格 v2 §4)
   ============================================================ */

/** 拦掉某个检索类机器人等于退出哪个产品的答案(修法里说人话);名单本身来自 robots.ts 的 AI_RETRIEVAL_BOTS */
const BOT_PRODUCT: Record<string, string> = {
  "oai-searchbot": "ChatGPT search",
  "chatgpt-user": "ChatGPT",
  perplexitybot: "Perplexity",
  "perplexity-user": "Perplexity",
  "claude-searchbot": "Claude",
  "claude-user": "Claude",
  bingbot: "Bing and Copilot (and ChatGPT search, which leans on Bing)",
  applebot: "Siri and Apple Intelligence",
};

/** aisearch.overview(30):AI 摘要出现且加载到引用来源的查询里,本站被引用的占比;没有查询出现 AI 摘要 → null */
export function scoreAiSearchOverview(ctx: RankingContext): SubScore {
  const id = "aisearch.overview";
  const gap = relevanceGap(ctx);
  if (gap) return notMeasured(id, gap.reason, { evidence: gap.evidence });
  const share = ctx.input.visibility && !ctx.input.visibility.noData && finite(ctx.input.visibility.aiOverviewShare) ? ctx.input.visibility.aiOverviewShare : null;
  const shareLine = share !== null ? `${pct01(Math.min(1, share))}% of your ranking keywords show an AI Overview (DataForSEO)` : "";
  const withAio = ctx.pairs.filter((p) => !!p.aiOverview && p.aiOverview.present === true);
  if (!withAio.length) {
    const anyLive = ctx.pairs.some((p) => p.aiOverview !== undefined || Array.isArray(p.serpFeatures));
    return notMeasured(id, anyLive ? "none of the analysed queries show an AI Overview" : "no live search results were checked for this report's queries", {
      evidence: [shareLine || `Checked ${plural(ctx.pairs.length, "query", "queries")} — none shows an AI Overview`],
    });
  }
  const judged = withAio.filter((p) => p.aiOverview?.loaded === true);
  if (!judged.length) {
    return notMeasured(id, `AI Overviews appear on ${withAio.length} of your queries, but their sources could not be loaded`, { evidence: [shareLine].filter(Boolean) });
  }
  const cited = (p: RelevancePair) => p.aiOverview?.cited === true || (p.aiOverview?.references ?? []).some((r) => isOwnDomain(r?.domain ?? "", ctx.input.domain));
  const yes = judged.filter(cited);
  const no = judged.filter((p) => !cited(p));
  const sourcesOf = (p: RelevancePair) =>
    uniq((p.aiOverview?.references ?? []).map((r) => bareHost(r?.domain ?? "")).filter((d) => d && !isOwnDomain(d, ctx.input.domain))).slice(0, 3);
  const evidence = [
    `AI Overview on ${withAio.length} of ${plural(ctx.pairs.length, "query", "queries")} we checked; you're cited in ${yes.length} of the ${judged.length} whose sources we could load`,
    ...[...no, ...yes].slice(0, 2).map((p) => {
      const others = sourcesOf(p);
      return `${quoteQuery(p.query)}: ${cited(p) ? "cites you" : "doesn't cite you"}${others.length ? ` — ${cited(p) ? "also cites" : "cites"} ${others.join(", ")}` : ""}`;
    }),
  ];
  if (shareLine) evidence.push(shareLine);
  const fixes: string[] = [];
  for (const p of no.slice(0, 2)) {
    fixes.push(`Get cited in the AI Overview for ${quoteQuery(p.query)}: answer it in 2–3 plain sentences near the top of ${pathOf(p.url)}, with a number or a source, using the question's own words`);
  }
  const studied = no.length ? sourcesOf(no[0]) : [];
  if (studied.length) fixes.push(`Study the pages AI Overviews quote instead (${studied.join(", ")}): short definitions, lists and tables are the easiest to cite`);
  return measured(id, {
    score: (100 * yes.length) / judged.length,
    good: judged.length === 1 ? "The AI Overview on your query cites you" : `You're cited in ${yes.length} of ${judged.length} AI Overviews on your queries`,
    bad:
      judged.length === 1
        ? "The AI Overview on your query doesn't cite you"
        : yes.length === 0
          ? `None of the ${judged.length} AI Overviews on your queries cite you`
          : `You're cited in only ${yes.length} of ${judged.length} AI Overviews on your queries`,
    evidence,
    fixes,
  });
}

type BotVerdict = "allow" | "disallow" | "unspecified";

/** robots.txt 明确不存在(4xx):一切允许。抓取失败(超时 / 5xx / 网络错误)不算"不存在" —— 那是不知道 */
function robotsMissing(probe: SiteProbe): boolean {
  const r = probe.robots;
  return !!r && r.found === false && !r.error && finite(r.status) && r.status >= 400 && r.status < 500;
}

/** 某个机器人在 robots.txt 里的判定;robots.txt 不存在 = 全部允许;探针里没有这个机器人的键(旧报告)= 没测 → null */
function botVerdict(probe: SiteProbe, bot: string): BotVerdict | null {
  if (robotsMissing(probe)) return "unspecified";
  const rec = probe.robotsMeta?.aiCrawlers ?? {};
  const hit = Object.keys(rec).find((k) => k.toLowerCase() === bot.toLowerCase());
  const v = hit ? rec[hit] : undefined;
  return v === "allow" || v === "disallow" || v === "unspecified" ? v : null;
}

/**
 * aisearch.crawlers(20):检索类 AI 爬虫(robots.ts AI_RETRIEVAL_BOTS)allow / unspecified 的占比 × 70
 * + (入口页不是 JS 空壳 ? 30 : 0)。训练类(AI_TRAINING_BOTS)只作证据 —— 让不让 AI 公司拿内容训练是商业选择,
 * 与能不能被 AI 搜索引用无关,不计分。
 * 旧报告的探针只给了部分机器人的判定:没有键的机器人不进分母;一个检索类判定都没有 → 爬虫项不计,
 * 只用 JS 空壳项按满分重新归一;JS 空壳也无从判断(没读到入口页、探针没记)→ null。
 */
export function scoreAiSearchCrawlers(ctx: RankingContext): SubScore {
  const id = "aisearch.crawlers";
  const probe = ctx.input.probe;
  if (!probe) return notMeasured(id, "the site probe did not run for this report");
  const noRobots = robotsMissing(probe);
  const retrieval = AI_RETRIEVAL_BOTS.map((bot) => ({ bot, v: botVerdict(probe, bot) })).filter((x): x is { bot: string; v: BotVerdict } => x.v !== null);
  const blocked = retrieval.filter((x) => x.v === "disallow");
  const allowedN = retrieval.length - blocked.length;
  const crawlerPts = retrieval.length ? (allowedN / retrieval.length) * 70 : null;
  const jsKnown = typeof probe.jsDependent === "boolean" || !!ctx.home;
  const shell = probe.jsDependent === true || ctx.home?.jsShell === true;
  const jsPts = jsKnown ? (shell ? 0 : 30) : null;
  if (crawlerPts === null && jsPts === null) return notMeasured(id, "we could not read the AI crawler rules in your robots.txt or your homepage");
  const training = AI_TRAINING_BOTS.map((bot) => ({ bot, v: botVerdict(probe, bot) })).filter((x) => x.v !== null);
  const tBlocked = training.filter((x) => x.v === "disallow");
  const evidence = [
    noRobots
      ? "No robots.txt, so every AI crawler is allowed by default"
      : crawlerPts === null
        ? "We could not read AI crawler rules from your robots.txt — scored on JavaScript rendering only"
        : `AI search crawlers allowed: ${allowedN} of ${retrieval.length}${blocked.length ? ` — blocked: ${blocked.map((x) => x.bot).join(", ")}` : ""}`,
    jsPts === null
      ? "We could not read your homepage, so JavaScript rendering was not checked"
      : shell
        ? "Your homepage needs JavaScript to show its content — most AI crawlers don't run JavaScript, so they see an empty page"
        : "Your homepage content is in the raw HTML, readable without JavaScript",
  ];
  if (training.length) {
    evidence.push(
      `Training crawlers (${training.map((x) => x.bot).join(", ")}): ${tBlocked.length} blocked, ${training.length - tBlocked.length} allowed — a business choice that doesn't affect AI search, so it isn't scored`,
    );
  }
  const products = uniq(blocked.map((x) => BOT_PRODUCT[x.bot.toLowerCase()]).filter(Boolean));
  const fixes: string[] = [];
  if (blocked.length) fixes.push(`Allow ${listJoin(blocked.map((x) => x.bot))} in robots.txt — blocking ${blocked.length === 1 ? "it" : "them"} keeps you out of answers in ${listJoin(products) || "AI search"}`);
  if (shell) fixes.push("Render your main content on the server (or pre-render it) so crawlers that don't run JavaScript can read it");
  const max = (crawlerPts === null ? 0 : 70) + (jsPts === null ? 0 : 30);
  return measured(id, {
    score: (100 * ((crawlerPts ?? 0) + (jsPts ?? 0))) / max,
    good: crawlerPts === null ? "AI crawlers can read your pages without running JavaScript" : `AI search crawlers can reach and read your pages (${allowedN} of ${retrieval.length} allowed)`,
    bad: blocked.length
      ? `Your robots.txt blocks ${blocked.length} AI search crawler${blocked.length === 1 ? "" : "s"} (${blocked.map((x) => x.bot).join(", ")}), so ${blocked.length === 1 ? "that assistant" : "those assistants"} can't cite you`
      : "AI crawlers can get in, but your content needs JavaScript to appear, so they see an empty page",
    evidence,
    fixes,
  });
}

/** types.ts:PageContentSignals.firstParagraph 只存前 300 字符;存满说明原段落更长 */
const FIRST_PARAGRAPH_CAP = 300;
const CITABLE_SCHEMA = new Set(["article", "newsarticle", "blogposting", "faqpage", "howto", "product"]);

export interface CitabilityParts {
  /** 首段 ≤60 词且含 ≥50% 标题核心词 */
  opening: boolean;
  /** 问句式小标题 ≥2 或有 FAQ */
  questions: boolean;
  /** 每千词数据点 */
  dataPer1k: number;
  /** 有列表或表格 */
  structured: boolean;
  /** Article / NewsArticle / BlogPosting / FAQPage / HowTo / Product 结构化数据 */
  schema: boolean;
  /** 有署名且有日期 */
  signed: boolean;
  points: number;
}

/**
 * 规格 v2 §4 aisearch.citability 的每页公式:首段直接回答 25 + 问句小标题或 FAQ 20 + 每千词数据点 ≥5 → 20(≥2 → 10)
 * + 列表 / 表格 15 + 可引用的结构化数据 10 + 署名 + 日期 10。
 * 首段存满 300 字符时原段落一定更长(60 词大约 330–360 字符),按"不是简短首段"处理 —— 截断后的前 50 来个词不能冒充短答案。
 */
export function citabilityParts(p: CrawledPage, brandWords: ReadonlySet<string> = new Set()): CitabilityParts {
  const c = contentOf(p);
  const fp = (c.firstParagraph ?? "").replace(/\s+/g, " ").trim();
  const words = fp ? fp.split(" ").length : 0;
  const want = topicTokens(titleCore(p), brandWords);
  const have = topicTokens(fp, brandWords);
  let hit = 0;
  want.forEach((t) => {
    if (have.has(t)) hit += 1;
  });
  const opening = !!fp && fp.length < FIRST_PARAGRAPH_CAP && words <= 60 && want.size > 0 && hit / want.size >= 0.5;
  const questions = num(c.questionHeadings) >= 2 || c.hasFaq === true;
  const dataPer1k = num(c.mainWords) > 0 ? (num(c.numberCount) / num(c.mainWords)) * 1000 : 0;
  const structured = num(c.listCount) > 0 || num(c.tableCount) > 0;
  const schema = (p.jsonLdTypes ?? []).some((t) => CITABLE_SCHEMA.has(String(t).toLowerCase()));
  const signed = c.byline === true && !!(c.datePublished || c.dateModified);
  const points = (opening ? 25 : 0) + (questions ? 20 : 0) + (dataPer1k >= 5 ? 20 : dataPer1k >= 2 ? 10 : 0) + (structured ? 15 : 0) + (schema ? 10 : 0) + (signed ? 10 : 0);
  return { opening, questions, dataPer1k, structured, schema, signed, points };
}

/** aisearch.citability(25):内容页平均;无内容页 → null */
export function scoreAiSearchCitability(ctx: RankingContext): SubScore {
  const id = "aisearch.citability";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const rows = pages.map((p) => ({ p, c: citabilityParts(p, ctx.brand.words) }));
  const count = (f: (x: CitabilityParts) => boolean) => rows.filter((r) => f(r.c));
  const opening = count((x) => x.opening);
  const questions = count((x) => x.questions);
  const data = count((x) => x.dataPer1k >= 5);
  const structured = count((x) => x.structured);
  const schema = count((x) => x.schema);
  const signed = count((x) => x.signed);
  const missing = (list: typeof rows) => rows.filter((r) => !list.includes(r)).map((r) => r.p.url);
  const evidence = [
    `Short, direct opening answer (60 words or fewer, using the title's words): ${opening.length} of ${n} content pages`,
    `Question-style subheadings (2+) or an FAQ: ${questions.length} of ${n}`,
    `5+ data points per 1,000 words: ${data.length} of ${n}; lists or tables: ${structured.length} of ${n}`,
    `Article, FAQ, HowTo or Product structured data: ${schema.length} of ${n}; byline plus date: ${signed.length} of ${n}`,
  ];
  // 丢分最多的部分先说、先修
  const parts = [
    { lost: 25 * (n - opening.length), text: "Most pages don't open with a short, direct answer an AI can quote", fix: `Open each page with a 1–2 sentence answer (under 60 words) that repeats the title's key words — missing on ${paths(missing(opening), 2)}` },
    { lost: 20 * (n - questions.length), text: "Few pages phrase subheadings as the questions people ask", fix: "" },
    { lost: 20 * (n - data.length), text: "Pages have few specific numbers for AI answers to quote", fix: "Add specific numbers — prices, timings, percentages, sample sizes; AI answers quote figures" },
    { lost: 15 * (n - structured.length), text: "Few pages use lists or tables, which AI answers lift most easily", fix: `Turn steps, options and specs into lists or a table on ${paths(missing(structured), 2)}` },
    { lost: 10 * (n - schema.length), text: "Most pages lack Article, FAQ, HowTo or Product structured data", fix: "Add Article (or FAQPage / HowTo / Product) structured data with the author and dates" },
    { lost: 10 * (n - signed.length), text: "Most pages don't show who wrote them and when", fix: "Show a byline and a publish or update date on every article" },
  ];
  const paa = uniq(ctx.pairs.flatMap((p) => p.paa ?? []).filter((q) => typeof q === "string" && q.trim())).slice(0, 2);
  parts[1].fix = paa.length
    ? `Use the questions searchers also ask as subheadings and answer each right below — e.g. ${paa.map((q) => quoteQuery(q)).join(", ")}`
    : "Phrase 2–3 subheadings as the questions people ask and answer each right below";
  const ordered = parts.filter((x) => x.lost > 0).sort((a, b) => b.lost - a.lost);
  return measured(id, {
    score: mean(rows.map((r) => r.c.points)),
    good: "Your content is easy for AI answers to quote: direct openings, question headings and specific data",
    bad: ordered[0]?.text ?? "Your pages are hard for AI answers to quote",
    evidence,
    fixes: ordered.map((x) => x.fix),
  });
}

/** 规格 v2 §4 zeroclick 的吸收权重(同组只算一次:paid / shopping、local_pack / map) */
const ABSORBERS: { types: string[]; w: number; name: string }[] = [
  { types: ["ai_overview"], w: 0.35, name: "AI Overview" },
  { types: ["featured_snippet"], w: 0.2, name: "featured snippet" },
  { types: ["answer_box"], w: 0.2, name: "answer box" },
  { types: ["paid", "shopping"], w: 0.15, name: "ads or shopping" },
  { types: ["local_pack", "map"], w: 0.15, name: "map pack" },
  { types: ["knowledge_graph"], w: 0.1, name: "knowledge panel" },
  { types: ["video"], w: 0.05, name: "videos" },
  { types: ["people_also_ask"], w: 0.05, name: "People also ask" },
  { types: ["top_stories"], w: 0.05, name: "Top stories" },
];
const MAX_ABSORPTION = 0.85;

/** 一个词的 SERP 元素吸收掉的点击比例:min(0.85, Σ 权重);本站拥有的精选摘要不算被抢 */
export function absorption(types: Iterable<string>, ownSnippet = false): number {
  const set = new Set(Array.from(types, (t) => String(t).toLowerCase()));
  let sum = 0;
  for (const a of ABSORBERS) {
    if (!a.types.some((t) => set.has(t))) continue;
    if (a.types[0] === "featured_snippet" && ownSnippet) continue;
    sum += a.w;
  }
  return Math.min(MAX_ABSORPTION, sum);
}

function absorberNames(types: Set<string>, ownSnippet: boolean): string[] {
  return ABSORBERS.filter((a) => a.types.some((t) => types.has(t)) && !(a.types[0] === "featured_snippet" && ownSnippet)).map((a) => a.name);
}

/**
 * aisearch.zeroclick(25):非品牌排名词(serpItemTypes)按搜索量加权的平均吸收,分 = 100 × (1 − 平均吸收);
 * 分析对的 live SERP 元素并入(同一词取并集)。品牌词不算 —— 品牌词的知识面板、站点链接本来就是你自己的,不是被抢走的点击。
 * "本站拥有精选摘要"只认 live SERP(pair.featuredSnippet.own):RankedKeyword.isFeaturedSnippet 已被 DataForSEO 弃用、恒为 false。
 * 元素清单为空([] = 供应商没给)或字段不存在(旧报告)都算这个词没有数据;一个有数据的词都没有 → null。
 */
export function scoreAiSearchZeroClick(ctx: RankingContext): SubScore {
  const id = "aisearch.zeroclick";
  const rows = new Map<string, { keyword: string; volume: number | null; types: Set<string>; own: boolean }>();
  let fieldSeen = false;
  const upsert = (keyword: string, volume: number | null | undefined, lists: (string[] | undefined)[], own: boolean) => {
    if (!keyword || isBrandKeyword(keyword, ctx.brand.keywordTokens)) return;
    const key = keyword.trim().toLowerCase();
    const row = rows.get(key) ?? { keyword: keyword.trim(), volume: null, types: new Set<string>(), own: false };
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      fieldSeen = true;
      for (const t of list) if (typeof t === "string" && t) row.types.add(t.toLowerCase());
    }
    if (row.volume === null && finite(volume)) row.volume = volume;
    row.own = row.own || own;
    rows.set(key, row);
  };
  const vis = ctx.input.visibility;
  if (vis && !vis.noData) for (const k of vis.topKeywords ?? []) if (k?.keyword) upsert(k.keyword, k.volume, [k.serpItemTypes], false);
  for (const p of ctx.pairs) upsert(p.query, p.volume, [p.serpItemTypes, p.serpFeatures], p.featuredSnippet?.own === true);
  const withData = Array.from(rows.values()).filter((r) => r.types.size > 0);
  if (!withData.length) {
    return notMeasured(
      id,
      !rows.size
        ? "no non-brand keywords were available to check"
        : fieldSeen
          ? "DataForSEO had no search-feature data for your non-brand keywords"
          : "this report predates search-feature data — re-run it to measure",
    );
  }
  const scored = withData.map((r) => ({ r, abs: absorption(r.types, r.own), w: volWeight(r.volume) }));
  const avg = weightedMean(scored.map((x) => ({ w: x.w, v: x.abs })));
  const n = withData.length;
  const has = (t: string) => withData.filter((r) => r.types.has(t));
  const aio = has("ai_overview");
  const othersSnippet = withData.filter((r) => r.types.has("featured_snippet") && !r.own);
  const ads = withData.filter((r) => r.types.has("paid") || r.types.has("shopping"));
  const worst = [...scored].sort((a, b) => b.abs * b.w - a.abs * a.w || a.r.keyword.localeCompare(b.r.keyword))[0];
  const cleanest = [...scored].sort((a, b) => a.abs - b.abs || b.w - a.w || a.r.keyword.localeCompare(b.r.keyword))[0];
  const evidence = [
    `Search features take about ${pct01(avg)}% of the clicks across ${plural(n, "non-brand keyword")} (weighted by search volume)`,
    `AI Overview on ${aio.length} of ${n}; featured snippet held by another site on ${othersSnippet.length}; ads or shopping results on ${ads.length}`,
  ];
  if (worst && worst.abs > 0) evidence.push(`Most crowded: ${quoteQuery(worst.r.keyword)} (${absorberNames(worst.r.types, worst.r.own).join(", ")}) — about ${pct01(worst.abs)}% of clicks go to features, not links`);
  const fixes: string[] = [];
  if (cleanest && cleanest.abs < 0.2) fixes.push(`Favour queries where results are mostly plain links — ${quoteQuery(cleanest.r.keyword)} still sends most clicks to the listed pages`);
  if (othersSnippet.length) fixes.push(`Win the featured snippet for ${quoteQuery(othersSnippet[0].keyword)}: answer it in 40–60 words right under a heading that matches the query`);
  if (aio.length) fixes.push(`On AI Overview queries like ${quoteQuery(aio[0].keyword)}, aim to be a cited source: a short, direct answer near the top, backed by a number or a source`);
  return measured(id, {
    score: 100 * (1 - avg),
    good: `Your keywords still send clicks: search features take only about ${pct01(avg)}% of them`,
    bad: `Search features (AI Overviews, snippets, ads) take about ${pct01(avg)}% of the clicks on your keywords`,
    evidence,
    fixes,
  });
}

/* ============================================================
   用户满意信号(default 10)
   ============================================================ */

type Band = "good" | "ni" | "poor";
const CWV_LIMITS = {
  lcp: { good: 2500, ni: 4000 },
  inp: { good: 200, ni: 500 },
  cls: { good: 0.1, ni: 0.25 },
} as const;
const BAND_TEXT: Record<Band, string> = { good: "good", ni: "needs improvement", poor: "poor" };

function bandOf(v: number, t: { good: number; ni: number }): Band {
  return v <= t.good ? "good" : v <= t.ni ? "ni" : "poor";
}

function bandOfCategory(c: string | null | undefined): Band | null {
  const s = (c ?? "").toUpperCase();
  if (s === "FAST" || s === "GOOD") return "good";
  if (s === "AVERAGE" || s === "NEEDS_IMPROVEMENT") return "ni";
  if (s === "SLOW" || s === "POOR") return "poor";
  return null;
}

interface CwvRow {
  key: "lcp" | "inp" | "cls";
  name: string;
  value: string | null;
  band: Band;
}

/** 真实用户数据:移动端优先(Google 按移动端索引),没有再看桌面端;fieldMetrics 缺失时退回旧版 field 分档 */
function realUserRows(psi: RankingInput["psi"]): { rows: CwvRow[]; source: string } | null {
  const candidates: [PsiResult | null, string][] = [
    [psi?.mobile ?? null, "mobile"],
    [psi?.desktop ?? null, "desktop"],
  ];
  for (const [r, strategy] of candidates) {
    if (!r || r.error) continue;
    const rows: CwvRow[] = [];
    const fm = r.fieldMetrics;
    const add = (key: CwvRow["key"], name: string, v: number | null | undefined, fmt: (x: number) => string, cat: string | null | undefined) => {
      if (typeof v === "number" && Number.isFinite(v)) rows.push({ key, name, value: fmt(v), band: bandOf(v, CWV_LIMITS[key]) });
      else {
        const b = bandOfCategory(cat);
        if (b) rows.push({ key, name, value: null, band: b });
      }
    };
    add("lcp", "Largest Contentful Paint (loading)", fm?.lcpMs, (x) => `${fmt1(x / 1000)} s`, r.field?.lcp);
    add("inp", "Interaction to Next Paint (responsiveness)", fm?.inpMs, (x) => `${Math.round(x)} ms`, r.field?.inp);
    add("cls", "Cumulative Layout Shift (visual stability)", fm?.cls, (x) => `${Math.round(x * 100) / 100}`, r.field?.cls);
    if (rows.length) return { rows, source: `${fm?.source ? `${fm.source}-level ` : ""}Chrome UX Report data (real users, ${strategy})` };
  }
  return null;
}

const BAND_RANK: Record<Band, number> = { poor: 0, ni: 1, good: 2 };

const CWV_GOAL: Record<CwvRow["key"], string> = { lcp: "good ≤ 2.5 s", inp: "good ≤ 200 ms", cls: "good ≤ 0.1" };
const CWV_FIX: Record<CwvRow["key"], string> = {
  lcp: "Speed up the main image or headline: serve it from your own domain in a modern format, don't lazy-load it, and cut render-blocking CSS (target ≤ 2.5 s)",
  inp: "Make taps and clicks respond faster: break up long JavaScript tasks and defer third-party scripts (target ≤ 200 ms)",
  cls: "Stop the layout from jumping: give images, ads and embeds fixed dimensions and reserve space for banners (target ≤ 0.1)",
};

/** behavior.realuser(25):LCP / INP / CLS 各 good → 33.3、needs improvement → 16.7、poor → 0;没有真实用户数据 → null */
export function scoreBehaviorRealUser(ctx: RankingContext): SubScore {
  const id = "behavior.realuser";
  const ru = realUserRows(ctx.input.psi);
  if (!ru) {
    return notMeasured(id, "Google has no real-user data (Chrome UX Report) for this site yet — it needs more Chrome traffic", {
      evidence: ["No page-level or origin-level Chrome UX Report data in PageSpeed Insights; lab scores are in the Performance section instead"],
    });
  }
  const pts: number[] = ru.rows.map((r) => (r.band === "good" ? 1 : r.band === "ni" ? 0.5 : 0));
  // 稳定排序:同档时保持 LCP → INP → CLS 的顺序
  const worst = [...ru.rows].sort((a, b) => BAND_RANK[a.band] - BAND_RANK[b.band])[0];
  const detail = ru.rows.map((r) => `${r.key.toUpperCase()} ${r.value ?? BAND_TEXT[r.band]}`).join(", ");
  return measured(id, {
    score: (100 * pts.reduce((a, b) => a + b, 0)) / ru.rows.length,
    // 70–89 分时有一项不在 good 档:说"大多",不把"需改进"说成"很好"
    good: `Real Chrome users ${ru.rows.every((r) => r.band === "good") ? "get" : "mostly get"} a fast, stable experience (${detail})`,
    bad: `Real Chrome users see ${worst.key === "lcp" ? "slow loading" : worst.key === "inp" ? "slow responses to taps and clicks" : "a jumpy layout"}: ${worst.name.replace(/\s*\(.*\)$/, "")} is ${worst.value ? `${worst.value} (${BAND_TEXT[worst.band]})` : BAND_TEXT[worst.band]}`,
    evidence: [
      ...ru.rows.map((r) => `${r.name}: ${r.value ? `${r.value} at the 75th percentile — ` : ""}${BAND_TEXT[r.band]} (${CWV_GOAL[r.key]})`),
      `Source: ${ru.source}`,
    ],
    fixes: ru.rows.filter((r) => r.band !== "good").map((r) => CWV_FIX[r.key]),
  });
}

/* ---------- behavior.ctr(25)—— 真实点击率 vs 预期(仅 Search Console;规格 v2 §4) ---------- */

/**
 * 按名次的预期点击率(Backlinko 2023 CTR 研究;方法论页注明来源)。第 1–10 名逐位给值,>10 名 1.0%;
 * 平均名次是小数(如 3.4),相邻两位之间线性插值,10–11 名之间插到 1.0% —— 不在 10.01 名处断崖。
 */
export const CTR_CURVE: readonly number[] = [0.276, 0.158, 0.11, 0.084, 0.063, 0.049, 0.039, 0.033, 0.027, 0.024];
export const CTR_BEYOND_10 = 0.01;
/** 曝光少于 50 的 query 点击率噪声太大,不算 */
const CTR_MIN_IMPRESSIONS = 50;

export function expectedCtr(position: number): number {
  if (!finite(position) || position <= 1) return CTR_CURVE[0];
  if (position >= 11) return CTR_BEYOND_10;
  const lo = Math.floor(position);
  const at = (p: number) => (p <= 10 ? CTR_CURVE[p - 1] : CTR_BEYOND_10);
  return at(lo) + (at(lo + 1) - at(lo)) * (position - lo);
}

/** 规格 v2 §4:min(100, 85 × 实际点击 / 预期点击) */
export function ctrPoints(ratio: number): number {
  return Math.min(100, 85 * Math.max(0, ratio));
}

/**
 * behavior.ctr(25):非品牌、曝光 ≥50 的 query,ratio = Σ 点击 / Σ(预期点击率 × 曝光);分 = min(100, 85 × ratio)。
 * 证据列"丢掉的点击"最多的 3 个 query(曝光高、点击率又低的,改标题与描述收益最大)。没有 Search Console → null。
 */
export function scoreBehaviorCtr(ctx: RankingContext): SubScore {
  const id = "behavior.ctr";
  const gsc = ctx.input.gsc ?? null;
  if (!gsc) {
    return notMeasured(id, "connect Search Console", {
      evidence: ["Click-through rates come only from your own Search Console data, which isn't connected to this report"],
      fixes: ["Connect Search Console from this report to compare your real click-through rate with what your positions should earn"],
    });
  }
  const rows = (gsc.queries ?? [])
    .filter((q) => !!q && !q.brand && num(q.impressions) >= CTR_MIN_IMPRESSIONS && finite(q.position) && q.position > 0)
    .map((q) => {
      const exp = expectedCtr(q.position);
      const expClicks = exp * num(q.impressions);
      return { q, exp, expClicks, missed: expClicks - num(q.clicks) };
    });
  if (!rows.length) return notMeasured(id, `no non-brand query had ${CTR_MIN_IMPRESSIONS} or more impressions in the last 28 days`);
  const clicks = rows.reduce((s, r) => s + num(r.q.clicks), 0);
  const expected = rows.reduce((s, r) => s + r.expClicks, 0);
  const ratio = expected > 0 ? clicks / expected : 0;
  const worst = [...rows].filter((r) => r.missed > 0).sort((a, b) => b.missed - a.missed || a.q.query.localeCompare(b.q.query));
  const ctrOf = (r: (typeof rows)[number]) => (num(r.q.impressions) > 0 ? num(r.q.clicks) / num(r.q.impressions) : 0);
  const evidence = [
    `${plural(rows.length, "non-brand query", "non-brand queries")} with ${CTR_MIN_IMPRESSIONS}+ impressions earned ${fmtInt(clicks)} clicks vs about ${fmtInt(expected)} expected for their positions (${pct01(ratio)}% of expected)`,
    ...worst
      .slice(0, 3)
      .map((r) => `${quoteQuery(r.q.query)}: ${fmtInt(num(r.q.impressions))} impressions at position ${fmt1(r.q.position)}, ${fmt1(ctrOf(r) * 100)}% click-through vs ${fmt1(r.exp * 100)}% expected`),
  ];
  const fixes = worst
    .slice(0, 2)
    .map((r) => `Rewrite the title and meta description of the page ranking for ${quoteQuery(r.q.query)} — it shows ${fmtInt(num(r.q.impressions))} times in 28 days but earns ${fmtInt(num(r.q.clicks))} clicks`);
  if (worst.length) fixes.push("Put the searcher's words and a concrete benefit (a number, a price, a free tool) in titles that rank but don't get clicked");
  return measured(id, {
    score: ctrPoints(ratio),
    good: `Your pages earn ${pct01(ratio)}% of the clicks their positions should get`,
    bad: `Your pages earn only ${pct01(ratio)}% of the clicks their positions should get — titles and snippets aren't winning the click`,
    evidence,
    fixes,
  });
}

/**
 * behavior.task(20):40 × 答案前置占比(相关性分析的对)+ 30 × 内容页有下一步链接的占比
 * + 15 × 文章页有 FAQ 的占比 + 15 × 无弹窗遮罩。
 * 某项没有分母(没有查询对 / 没有文章页)时按其余项重新归一,不把"没测"当 0。
 * 弹窗一项按"无弹窗线索的内容页占比"计:全站弹窗时与规格的 0/1 一致,只有个别页有零星线索时不至于一票否决。
 */
export function scoreBehaviorTask(ctx: RankingContext): SubScore {
  const id = "behavior.task";
  const pages = ctx.contentPages;
  const popupBase = pages.length ? pages : ctx.signalPages;
  const answered = ctx.pairs.filter((p) => p.answerEarly);
  const nextStep = pages.filter((p) => num(contentOf(p).nextStepLinks) > 0);
  const noNext = pages.filter((p) => num(contentOf(p).nextStepLinks) === 0);
  const faq = ctx.articlePages.filter((p) => contentOf(p).hasFaq === true);
  const popups = popupBase.filter((p) => num(contentOf(p).interstitialHints) > 0);
  const terms: { w: number; v: number | null; loss: string }[] = [
    { w: 40, v: ctx.pairs.length ? answered.length / ctx.pairs.length : null, loss: "Pages make visitors dig for the answer before they get it" },
    { w: 30, v: pages.length ? nextStep.length / pages.length : null, loss: "Most pages end in a dead end — no next step after the main text" },
    { w: 15, v: ctx.articlePages.length ? faq.length / ctx.articlePages.length : null, loss: "Articles leave follow-up questions unanswered — no FAQ sections" },
    { w: 15, v: popupBase.length ? 1 - popups.length / popupBase.length : null, loss: "Pop-ups or overlays get in the way of the content" },
  ];
  const avail = terms.filter((t) => t.v !== null);
  if (!avail.length) return notMeasured(id, ctx.input.relevance ? contentGap(ctx) : "neither search-query pairs nor content pages were available to check");
  const wsum = avail.reduce((s, t) => s + t.w, 0);
  const score = (100 * avail.reduce((s, t) => s + t.w * (t.v as number), 0)) / wsum;
  const worst = [...avail].sort((a, b) => b.w * (1 - (b.v as number)) - a.w * (1 - (a.v as number)))[0];
  const evidence: string[] = [];
  evidence.push(ctx.pairs.length ? `The main query is answered in the first 150 words on ${answered.length} of ${ctx.pairs.length} pages we checked against search queries` : "Answer-first not measured (no search queries were matched to pages) — scored on the other signals");
  if (pages.length) evidence.push(`A next-step link (related page, product or call to action) after the main text on ${nextStep.length} of ${pages.length} content pages${noNext.length ? ` — missing on ${paths(noNext.map((p) => p.url))}` : ""}`);
  if (ctx.articlePages.length) evidence.push(`FAQ section on ${faq.length} of ${ctx.articlePages.length} articles`);
  if (popupBase.length) evidence.push(`Pop-up or overlay elements found on ${popups.length} of ${popupBase.length} pages${popups.length ? ` (${paths(popups.map((p) => p.url), 2)})` : ""}`);
  const fixes: string[] = [];
  const unanswered = ctx.pairs.filter((p) => !p.answerEarly);
  if (unanswered.length) fixes.push(`Answer the main question in the first two sentences — ${unanswered.slice(0, 2).map((p) => `${pathOf(p.url)} for ${quoteQuery(p.query)}`).join(", ")}`);
  if (noNext.length) fixes.push(`End every content page with a next step — a related guide, a product page or a clear call to action (missing on ${paths(noNext.map((p) => p.url), 2)})`);
  if (ctx.articlePages.length && faq.length < ctx.articlePages.length) fixes.push("Add a short FAQ to articles that answers the follow-up questions people ask next");
  if (popups.length) fixes.push(`Remove or delay pop-ups that cover the content on load (${paths(popups.map((p) => p.url), 2)})`);
  return measured(id, {
    score,
    good: "Pages get to the point and give readers a clear next step",
    bad: worst.loss,
    evidence,
    fixes,
  });
}

/** Flesch 分档:≥60 → 50,≥40 → 35,≥30 → 20,其余 10 */
export function fleschPoints(avg: number | null): number {
  if (avg === null) return 35;
  return avg >= 60 ? 50 : avg >= 40 ? 35 : avg >= 30 ? 20 : 10;
}

/** behavior.readability(15):Flesch 50 + 段落长度 20 + 每个小标题对应词数 15 + 有列表 / 表格的占比 15 */
export function scoreBehaviorReadability(ctx: RankingContext): SubScore {
  const id = "behavior.readability";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const fl = pages.map((p) => contentOf(p).fleschReadingEase).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const avgFlesch = fl.length ? mean(fl) : null;
  const paras = pages.map((p) => num(contentOf(p).avgParagraphWords)).filter((x) => x > 0);
  const avgPara = paras.length ? mean(paras) : null;
  const wph = mean(pages.map((p) => num(contentOf(p).mainWords) / Math.max(1, num(contentOf(p).h2Count) + num(contentOf(p).h3Count))));
  const scannable = pages.filter((p) => num(contentOf(p).listCount) > 0 || num(contentOf(p).tableCount) > 0);
  const noLists = pages.filter((p) => !scannable.includes(p));
  const fPts = fleschPoints(avgFlesch);
  // 段落长度没数据时按中档 10 计(与 Flesch 缺失按 35 计同一原则:没测不罚也不奖)
  const pPts = avgPara === null ? 10 : avgPara <= 80 ? 20 : avgPara <= 120 ? 10 : 0;
  const hPts = wph <= 300 ? 15 : 0;
  const lPts = 15 * (scannable.length / n);
  const hardest = pages
    .filter((p) => typeof contentOf(p).fleschReadingEase === "number")
    .sort((a, b) => num(contentOf(a).fleschReadingEase) - num(contentOf(b).fleschReadingEase) || a.url.localeCompare(b.url));
  const losses = [
    { lost: 50 - fPts, text: "Your content is hard to read: long sentences and complex words" },
    { lost: 20 - pPts, text: "Long paragraphs make your pages hard to scan" },
    { lost: 15 - hPts, text: "Long stretches without subheadings make your pages hard to scan" },
    { lost: 15 - lPts, text: "Few lists or tables, so readers can't skim your pages" },
  ].sort((a, b) => b.lost - a.lost);
  const fixes: string[] = [];
  if (avgFlesch !== null && avgFlesch < 60) fixes.push(`Shorten sentences (under 20 words) and swap jargon for plain words — hardest to read: ${paths(hardest.map((p) => p.url), 2)}`);
  if (avgPara !== null && avgPara > 80) fixes.push("Break paragraphs into 2–4 sentences each");
  if (wph > 300) fixes.push("Add a descriptive subheading every 200–300 words");
  if (noLists.length) fixes.push(`Turn steps, options and specs into bullet lists or a table on ${paths(noLists.map((p) => p.url), 2)}`);
  return measured(id, {
    score: fPts + pPts + hPts + lPts,
    good: "Your content is easy to read and easy to scan",
    bad: losses[0].text,
    evidence: [
      avgFlesch !== null
        ? `Average reading ease (Flesch score) ${Math.round(avgFlesch)} across ${fl.length} pages — 60+ reads as plain English, under 30 is very hard`
        : "Reading ease not measured (pages aren't in English) — counted as average",
      avgPara !== null ? `Average paragraph: ${Math.round(avgPara)} words (aim for 80 or fewer)` : "Paragraph length not measured — counted as average",
      `Average ${fmtInt(wph)} words per subheading (aim for 300 or fewer)`,
      `Bullet lists or tables on ${scannable.length} of ${n} content pages`,
    ],
    fixes,
  });
}

/** 标题承诺的数量有没有兑现:H2 / H3 / 列表项里任一个达到承诺的数就算兑现(多给不算违约) */
export function deliveredCount(c: PageContentSignals): number {
  return Math.max(num(c.h2Count), num(c.h3Count), num(c.listItemCount));
}

/** 标题主题词在正文前 150 词与小标题里的覆盖率;标题没有主题词时为 null(不判) */
function titleTopicCoverage(p: CrawledPage, brandWords: ReadonlySet<string>): number | null {
  const want = topicTokens(titleCore(p), brandWords);
  if (!want.size) return null;
  const have = topicTokens(`${p.content?.leadText ?? ""} ${(p.headings ?? []).map((h) => h.text).join(" ")} ${(p.h1s ?? []).join(" ")}`, brandWords);
  let hit = 0;
  want.forEach((t) => {
    if (have.has(t)) hit += 1;
  });
  return hit / want.size;
}

/** behavior.promise(15):100 − 标题党页占比 × 50 − 数字不兑现占比 × 30 − 标题主题不在开头与小标题里的占比 × 20 */
export function scoreBehaviorPromise(ctx: RankingContext): SubScore {
  const id = "behavior.promise";
  const pages = ctx.contentPages;
  if (!pages.length) return notMeasured(id, contentGap(ctx), { fixes: ctx.signalPages.length ? [CONTENT_GAP_FIX] : [] });
  const n = pages.length;
  const bait = pages.filter((p) => num(contentOf(p).clickbaitHits) >= 2);
  const numberMiss = pages.filter((p) => {
    const t = contentOf(p).titleNumber;
    return typeof t === "number" && t >= 2 && deliveredCount(contentOf(p)) < t;
  });
  const offTopic = pages.filter((p) => {
    const cov = titleTopicCoverage(p, ctx.brand.words);
    return cov !== null && cov < 0.5;
  });
  const fixes: string[] = [];
  if (bait.length) fixes.push(`Rewrite clickbait titles to say plainly what the page covers: ${paths(bait.map((p) => p.url), 2)}`);
  for (const p of numberMiss.slice(0, 2)) fixes.push(`Make the number in the title match the page: ${pathOf(p.url)} promises ${contentOf(p).titleNumber} but has ${deliveredCount(contentOf(p))} sections or list items`);
  if (offTopic.length) fixes.push(`Open ${paths(offTopic.map((p) => p.url), 2)} with the topic the title promises, and use it in a subheading`);
  return measured(id, {
    score: 100 - (bait.length / n) * 50 - (numberMiss.length / n) * 30 - (offTopic.length / n) * 20,
    good: "Your titles promise what the pages deliver",
    bad: "Some titles promise more than the page delivers",
    evidence: [
      `Clickbait wording (2+ signals like "shocking", "!" or ALL CAPS): ${bait.length} of ${n} titles${bait.length ? ` (${paths(bait.map((p) => p.url), 2)})` : ""}`,
      `Titles promising a number the page doesn't deliver: ${numberMiss.length} of ${n}${numberMiss.length ? ` — ${pathOf(numberMiss[0].url)} promises ${contentOf(numberMiss[0]).titleNumber}, the page has ${deliveredCount(contentOf(numberMiss[0]))} sections or list items` : ""}`,
      `Titles whose topic doesn't show up in the opening or the subheadings: ${offTopic.length} of ${n}${offTopic.length ? ` (${paths(offTopic.map((p) => p.url), 2)})` : ""}`,
    ],
    fixes,
  });
}

/* ============================================================
   技术基础(default 5):与免费版 Technical SEO 同一套数字
   ============================================================ */

function issueOrder(c: SeoCheck): number {
  return (c.gate && c.status === "fail" ? 1000 : 0) + (c.status === "fail" ? 100 : 0) + (SEVERITY_RANK[c.severity] ?? 0) * 10;
}

/** technical.*:小维度分 = 对应站内维度分;证据与修法取该维度失败 / 待改进的检查 */
export function scoreTechnicalSub(ctx: RankingContext, id: string): SubScore {
  const dimId = TECHNICAL_SUB_DIMENSIONS[id];
  const meta = SUB_META.get(id);
  if (!dimId || !meta) throw new Error(`Unknown technical sub-score: ${id}`);
  const d = (ctx.input.dimensions ?? []).find((x) => x.id === dimId);
  const checks = (ctx.input.checks ?? []).filter((c) => c.dimension === dimId);
  const issues = checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .sort((a, b) => issueOrder(b) - issueOrder(a) || num(b.affectedCount) - num(a.affectedCount) || a.id.localeCompare(b.id));
  if (!d || typeof d.score !== "number") {
    const why = !d ? "this area was not scored in the technical audit" : d.summary && !/^insufficient data$/i.test(d.summary.trim()) ? d.summary : "too few of its checks could run on this site";
    return notMeasured(id, why.charAt(0).toLowerCase() + why.slice(1));
  }
  const fail = checks.filter((c) => c.status === "fail").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const pass = checks.filter((c) => c.status === "pass").length;
  const total = fail + warn + pass;
  const gate = issues.find((c) => c.gate && c.status === "fail");
  const evidence = issues.length
    ? issues.map((c) => clipSentence(`${c.title}${c.evidence?.[0] ? ` — ${trimDot(c.evidence[0])}` : ""}`, 240))
    : [`All ${total} measured checks pass`];
  const problems = [fail ? plural(fail, "failing check") : "", warn ? `${fmtInt(warn)} to improve` : ""].filter(Boolean).join(", ");
  return measured(id, {
    score: d.score,
    good: issues.length ? `${meta.label}: ${pass} of ${total} checks pass` : `${meta.label}: all ${total} checks pass`,
    bad: gate ? `${meta.label} is capped by a critical issue: ${checkTitle(gate.id, "fail")}` : `${meta.label} needs work: ${problems || "several checks are weak"}`,
    evidence,
    fixes: issues.filter((c) => c.fix).map((c) => clipSentence(trimDot(c.fix), 260)),
  });
}

/* ============================================================
   站点类型(规格 v2 §1):决定支柱权重
   ============================================================ */

/** schema.org LocalBusiness 及其常见子类型(小写比较;jsonLdTypes 含嵌套类型) */
const LOCAL_BUSINESS_TYPES = new Set([
  "localbusiness", "animalshelter", "automotivebusiness", "autobodyshop", "autodealer", "autopartsstore", "autorental", "autorepair",
  "autowash", "gasstation", "motorcycledealer", "motorcyclerepair", "childcare", "dentist", "drycleaningorlaundry", "emergencyservice",
  "hospital", "employmentagency", "entertainmentbusiness", "amusementpark", "artgallery", "casino", "comedyclub", "movietheater",
  "nightclub", "financialservice", "accountingservice", "bankorcreditunion", "insuranceagency", "foodestablishment", "bakery",
  "barorpub", "brewery", "cafeorcoffeeshop", "distillery", "fastfoodrestaurant", "icecreamshop", "restaurant", "winery",
  "healthandbeautybusiness", "beautysalon", "dayspa", "hairsalon", "healthclub", "nailsalon", "tattooparlor",
  "homeandconstructionbusiness", "electrician", "generalcontractor", "hvacbusiness", "housepainter", "locksmith", "movingcompany",
  "plumber", "roofingcontractor", "legalservice", "attorney", "notary", "lodgingbusiness", "bedandbreakfast", "campground",
  "hostel", "hotel", "motel", "resort", "vacationrental", "medicalbusiness", "medicalclinic", "optician", "pharmacy", "physician",
  "physiotherapy", "professionalservice", "realestateagent", "recyclingcenter", "selfstorage", "shoppingcenter",
  "sportsactivitylocation", "bowlingalley", "exercisegym", "golfcourse", "sportsclub", "store", "bikestore", "bookstore",
  "clothingstore", "computerstore", "conveniencestore", "departmentstore", "electronicsstore", "florist", "furniturestore",
  "gardenstore", "grocerystore", "hardwarestore", "hobbyshop", "homegoodsstore", "jewelrystore", "liquorstore", "mobilephonestore",
  "musicstore", "petstore", "shoestore", "sportinggoodsstore", "tireshop", "toystore", "travelagency", "veterinarycare",
]);
const PRODUCT_SCHEMA = new Set(["product", "productgroup", "productmodel", "individualproduct", "someproducts"]);
const OFFER_SCHEMA = new Set(["offer", "aggregateoffer"]);
/**
 * SaaS 常把 SoftwareApplication + Offer 放进全站布局(那是软件定价,不是在卖货):Offer 只在页面上没有软件类类型时
 * 才算商品信号,否则每个 SaaS 都会被判成网店。Product 类型照规格直接算。
 */
const SOFTWARE_SCHEMA = new Set(["softwareapplication", "webapplication", "mobileapplication", "videogame"]);
/** 规格:路径含 /product(s)/、/shop/、/collections/、/cart */
const SHOP_PATH = /\/(?:products?|shop|collections)\/|\/cart(?:\/|$)/i;
/** 购物车 / 结账入口(网店的硬信号;SaaS 的 /product/ 功能页没有它) */
const CART_PATH = /\/(?:cart|basket|bag|checkout)(?:\/|$|\?)/i;
/** overall.note 里"Scored as …"的说法 */
const PROFILE_PHRASE: Record<SiteProfileId, string> = {
  default: "a business, SaaS or publisher site",
  ecommerce: "an online store",
  local: "a local business",
  ymyl: "a health, finance or legal site",
};

function lowerTypes(p: CrawledPage): string[] {
  return (p.jsonLdTypes ?? []).map((t) => String(t).toLowerCase());
}

/** 页面上第一个 LocalBusiness 系类型(原样大小写,供 reason 展示);没有为 null */
function localBusinessType(p: CrawledPage): string | null {
  return (p.jsonLdTypes ?? []).find((t) => LOCAL_BUSINESS_TYPES.has(String(t).toLowerCase())) ?? null;
}

function hasCommerceSchema(p: CrawledPage): boolean {
  const t = lowerTypes(p);
  if (t.some((x) => PRODUCT_SCHEMA.has(x))) return true;
  return t.some((x) => OFFER_SCHEMA.has(x)) && !t.some((x) => SOFTWARE_SCHEMA.has(x));
}

/**
 * 站点类型(规格 v2 §1,可复现;多个命中按 ymyl > local > ecommerce > default):
 * - ymyl:YMYL 内容页(isYmylPage)占内容页 ≥ 30%;
 * - local:入口页或 ≥2 个可读页有 LocalBusiness 系 schema;或首页同时有地址与电话且 ≥30% 可读页有电话;
 * - ecommerce:Product / Offer schema 出现在 ≥20% 可读页或 ≥5 页;或 classifyFormat = product 的页 ≥20%;
 *   或路径含 /product(s)/、/shop/、/collections/、/cart 的页 ≥20%;
 * - 其余 default(SaaS / 企业站 / 内容站)。
 * 返回的 weights 是 SITE_PROFILE_WEIGHTS 的副本(调用方改它不会污染常量)。
 */
export function detectSiteProfile(ctx: RankingContext): SiteProfile {
  const make = (id: SiteProfileId, reason: string): SiteProfile => ({
    id,
    label: SITE_PROFILE_WEIGHTS[id].label,
    reason: trimDot(reason),
    weights: { ...SITE_PROFILE_WEIGHTS[id].weights },
  });
  const cp = ctx.contentPages;
  const ymyl = cp.filter((p) => isYmylPage(contentOf(p)));
  if (cp.length && ymyl.length / cp.length >= 0.3) {
    return make("ymyl", `${ymyl.length} of ${cp.length} content pages (${pctOf(ymyl.length, cp.length)}%) cover health, money or legal topics, which Google holds to a stricter standard`);
  }
  const pages = ctx.readable;
  const n = pages.length;
  const homeType = ctx.home ? localBusinessType(ctx.home) : null;
  if (homeType) return make("local", `Your homepage is marked up as a local business (${homeType} structured data)`);
  const localPages = pages.filter((p) => localBusinessType(p) !== null);
  if (localPages.length >= 2) {
    return make("local", `${localPages.length} pages are marked up as a local business (${localBusinessType(localPages[0])} structured data on ${paths(localPages.map((p) => p.url), 2)})`);
  }
  // 只认 LocalBusiness 系结构化数据(站长 2026-10-02):"首页有地址 + 多数页面有电话"会把页脚写着公司地址与
  // 客服电话的 SaaS 判成本地商家 —— 头部写着 "Scored as: Local business" 比少给本地商家一点权重更伤信任
  if (n) {
    const schema = pages.filter(hasCommerceSchema).length;
    if (schema >= 5 || schema / n >= 0.2) return make("ecommerce", `${schema} of ${n} pages we read carry product or offer structured data`);
    // SaaS 也常有 /product/ 功能页:没有商品结构化数据时,还要看到购物车 / 结账入口才算网店
    const sells = schema > 0 || pages.some((p) => (p.links ?? []).some((l) => CART_PATH.test(pathOnly(l))));
    if (sells) {
      const products = pages.filter((p) => classifyFormat(p) === "product").length;
      if (products / n >= 0.2) return make("ecommerce", `${products} of ${n} pages we read are product pages, and the site has a cart or checkout`);
      const shop = pages.filter((p) => SHOP_PATH.test(pathOnly(p.url))).length;
      if (shop / n >= 0.2) return make("ecommerce", `${shop} of ${n} pages we read sit under /products/, /shop/ or /collections/, and the site has a cart or checkout`);
    }
  }
  return make("default", "No strong signs of an online store, a local business or a health, finance or legal site, so the standard weights apply");
}

/**
 * 站点类型对个别小维度权重的覆盖(SITE_PROFILE_SUB_WEIGHTS;例:本地商家的 authority.reputation = 25):
 * 被覆盖的小维度取新权重,同支柱其余小维度按原比例压缩,支柱内权重合计不变;压缩后的权重保留 1 位小数,
 * 支柱分就用这组展示出来的权重计算(UI 上看到的权重与算分用的是同一组数)。
 */
export function applyProfileSubWeights(subs: SubScore[], profileId: SiteProfileId): SubScore[] {
  const over = SITE_PROFILE_SUB_WEIGHTS[profileId];
  if (!over || !Object.keys(over).length) return subs;
  const out = subs.map((s) => ({ ...s }));
  for (const pillar of PILLAR_IDS) {
    const mine = out.filter((s) => s.pillar === pillar);
    const hit = mine.filter((s) => finite(over[s.id]));
    if (!hit.length) continue;
    const total = mine.reduce((n, s) => n + s.weight, 0);
    const fixed = hit.reduce((n, s) => n + over[s.id], 0);
    const rest = mine.filter((s) => !finite(over[s.id]));
    const restTotal = rest.reduce((n, s) => n + s.weight, 0);
    const scale = restTotal > 0 ? Math.max(0, total - fixed) / restTotal : 0;
    for (const s of hit) s.weight = over[s.id];
    for (const s of rest) s.weight = Math.round(s.weight * scale * 10) / 10;
  }
  return out;
}

/* ============================================================
   拼装
   ============================================================ */

/** id → 小维度打分函数(测试与集成方都可以按 id 单独调用) */
export const SUB_SCORERS: Readonly<Record<string, (ctx: RankingContext) => SubScore>> = {
  "relevance.intent": scoreRelevanceIntent,
  "relevance.coverage": scoreRelevanceCoverage,
  "relevance.gain": scoreRelevanceGain,
  "relevance.alignment": scoreRelevanceAlignment,
  "relevance.cannibalization": scoreRelevanceCannibalization,
  "quality.experience": scoreQualityExperience,
  "quality.data": scoreQualityData,
  "quality.authorship": scoreQualityAuthorship,
  "quality.freshness": scoreQualityFreshness,
  "quality.scaled": scoreQualityScaled,
  "quality.sources": scoreQualitySources,
  "authority.editorial": scoreAuthorityEditorial,
  "authority.breadth": scoreAuthorityBreadth,
  "authority.linkprofile": scoreAuthorityLinkProfile,
  "authority.clusters": scoreAuthorityClusters,
  "authority.focus": scoreAuthorityFocus,
  "authority.internal": scoreAuthorityInternal,
  "authority.entity": scoreAuthorityEntity,
  "authority.reputation": scoreAuthorityReputation,
  "winnability.serpweakness": scoreWinnabilitySerpWeakness,
  "winnability.difficulty": scoreWinnabilityDifficulty,
  "winnability.gap": scoreWinnabilityGap,
  "winnability.striking": scoreWinnabilityStriking,
  "winnability.momentum": scoreWinnabilityMomentum,
  "aisearch.overview": scoreAiSearchOverview,
  "aisearch.crawlers": scoreAiSearchCrawlers,
  "aisearch.citability": scoreAiSearchCitability,
  "aisearch.zeroclick": scoreAiSearchZeroClick,
  "behavior.realuser": scoreBehaviorRealUser,
  "behavior.ctr": scoreBehaviorCtr,
  "behavior.task": scoreBehaviorTask,
  "behavior.readability": scoreBehaviorReadability,
  "behavior.promise": scoreBehaviorPromise,
  ...Object.fromEntries(Object.keys(TECHNICAL_SUB_DIMENSIONS).map((id) => [id, (ctx: RankingContext) => scoreTechnicalSub(ctx, id)])),
};

/** 支柱分 = 有分小维度按权重加权平均(null 不进分母);全是 null → null */
/**
 * 支柱分 = 有分小维度按权重加权平均(null 不进分母)。至少要有 MIN_MEASURED_SUBS 个小维度测到才算分
 * (站长 2026-10-02):只剩一个小维度时,那一个数会被放大成整个支柱的结论 —— 例如对比没跑成时,
 * 相关性支柱会只由"一个意图一页"撑着,常常是 100。技术支柱不走这里(直接取免费技术分)。
 */
export const MIN_MEASURED_SUBS = 2;

export function weightedPillarScore(subs: SubScore[]): number | null {
  const scored = subs.filter((s) => typeof s.score === "number");
  const w = scored.reduce((n, s) => n + s.weight, 0);
  if (scored.length < MIN_MEASURED_SUBS || w <= 0) return null;
  return clampScore(scored.reduce((n, s) => n + s.weight * (s.score as number), 0) / w);
}

function pillarSummary(id: PillarId, score: number | null, subs: SubScore[], ctx: RankingContext): string {
  if (id === "technical") {
    const capped = (ctx.input.technical?.blockers ?? []).length > 0;
    return capped
      ? `Same as your Technical SEO score (${score}/100) — a critical technical issue caps it and the overall score`
      : `Same as your Technical SEO score: ${score}/100 across 7 technical areas`;
  }
  const done = subs.filter((s) => typeof s.score === "number");
  if (score === null || !done.length) {
    return done.length
      ? `Not measured: only ${done.length} of its ${subs.length} sub-scores had data — too little to score the pillar`
      : `Not measured: none of its ${subs.length} sub-scores had data for this site`;
  }
  const weakest = [...done].sort((a, b) => (a.score as number) - (b.score as number) || (SUB_ORDER.get(a.id) ?? 0) - (SUB_ORDER.get(b.id) ?? 0))[0];
  const tail = done.length < subs.length ? ` (${done.length} of ${subs.length} sub-scores measured)` : "";
  const top = (weakest.score as number) >= 85;
  // 两个新支柱用各自的"作用"来说话:可赢性回答"打不打得赢",AI 搜索回答"排上去还有没有点击"
  if (id === "winnability") {
    if (top) return `These look like fights you can win — every measured sub-score is 85 or higher${tail}`;
    if (score >= 70) return `Mostly winnable fights; the weakest spot is ${weakest.label} at ${weakest.score}/100${tail}`;
    return `Some of your target searches are hard to win today — mainly ${weakest.label} at ${weakest.score}/100${tail}`;
  }
  if (id === "aisearch") {
    if (top) return `Your rankings should still earn visits and AI citations — every measured sub-score is 85 or higher${tail}`;
    if (score >= 70) return `Rankings should still earn visits; the weakest spot is ${weakest.label} at ${weakest.score}/100${tail}`;
    return `AI answers and search features may take the visits your rankings would earn — mainly ${weakest.label} at ${weakest.score}/100${tail}`;
  }
  if (top) return `Strong across the board — every measured sub-score is 85 or higher${tail}`;
  if (score >= 70) return `Solid overall; the weakest spot is ${weakest.label} at ${weakest.score}/100${tail}`;
  return `Held back mainly by ${weakest.label} at ${weakest.score}/100${tail}`;
}

/**
 * 计算 SEO Ranking Score(规格 §4 + v2)。纯函数:同一输入永远得到同一输出,不修改输入。
 * 站点类型决定支柱权重(与个别小维度权重);总分 = Σ 支柱权重 × 支柱分 / Σ 有分支柱的权重;
 * 免费版有致命项时总分 ≤40、等级 F、capped(v1 规则不变)。
 */
export function computeRanking(input: RankingInput): RankingFramework {
  const ctx = buildRankingContext(input);
  const profile = detectSiteProfile(ctx);
  const subs = applyProfileSubWeights(
    RANKING_SUBS.map((m) => SUB_SCORERS[m.id](ctx)),
    profile.id,
  );

  const pillars: PillarScore[] = PILLAR_IDS.map((id) => {
    const meta = RANKING_PILLARS[id];
    const mine = subs.filter((s) => s.pillar === id);
    // 技术支柱直接取免费技术分(含致命项封顶),两处永远是同一个数字;等级也沿用免费版(封顶时是 F 而不是 40 分对应的 D)
    const score = id === "technical" ? clampScore(num(input.technical?.score)) : weightedPillarScore(mine);
    const grade: Grade | null = id === "technical" ? (input.technical?.grade ?? gradeFor(score as number)) : score === null ? null : gradeFor(score);
    return { id, label: meta.label, role: meta.role, weight: profile.weights[id], score, grade, summary: trimDot(pillarSummary(id, score, mine, ctx)), subs: mine };
  });

  const scored = pillars.filter((p) => typeof p.score === "number");
  const wsum = scored.reduce((n, p) => n + p.weight, 0);
  let score = wsum > 0 ? clampScore(scored.reduce((n, p) => n + p.weight * (p.score as number), 0) / wsum) : 0;
  let grade: Grade = gradeFor(score);
  const blockers = uniq((input.technical?.blockers ?? []).filter((b) => typeof b === "string" && b));
  const capped = blockers.length > 0;
  if (capped) {
    score = Math.min(score, GATE_OVERALL_CAP);
    grade = "F";
  }

  const nullSubs = subs.filter((s) => s.score === null);
  const blockerText = blockers.map((b) => checkTitle(b, "fail")).join("; ");
  const basedOn = nullSubs.length
    ? `Based on ${subs.length - nullSubs.length} of ${subs.length} sub-scores — ${nullSubs.length} could not be measured`
    : `Based on all ${subs.length} sub-scores`;
  const scoredAs = profile.id === "default" ? "" : `Scored as ${PROFILE_PHRASE[profile.id]}`;
  const note = capped
    ? `Capped at ${GATE_OVERALL_CAP} (grade F): fix the technical blockers first — ${blockerText}${scoredAs ? `. ${scoredAs}` : ""}`
    : scoredAs
      ? `${scoredAs}; ${basedOn.charAt(0).toLowerCase()}${basedOn.slice(1)}`
      : basedOn;

  const notes: string[] = [];
  if (capped) notes.push(`Overall score capped at ${GATE_OVERALL_CAP} because the technical audit found critical blockers: ${blockerText}. Fix the technical blockers first — nothing else counts while they stand`);
  for (const p of pillars) {
    if (p.score !== null) continue;
    const measuredSubs = p.subs.filter((x) => typeof x.score === "number").length;
    notes.push(
      measuredSubs
        ? `${p.label} is left out of the overall score: only ${measuredSubs} of its sub-scores could be measured (a pillar needs at least ${MIN_MEASURED_SUBS})`
        : `${p.label} is left out of the overall score: none of its sub-scores could be measured`
    );
  }
  for (const s of nullSubs) notes.push(`${s.label} — ${s.summary}`);
  const gain = subs.find((s) => s.id === "relevance.gain");
  if (gain && gain.score !== null && ctx.pairs.length && !ctx.pairs.some((p) => (p.competitors ?? []).some((c) => c.fetched))) {
    notes.push("Information gain is estimated from your own pages only: no competitor pages could be fetched, so it is capped at 60");
  }

  const fetchedCompetitors = new Set<string>();
  for (const p of ctx.pairs) for (const c of p.competitors ?? []) if (c.fetched && c.url) fetchedCompetitors.add(urlKey(c.url));
  const targets = Array.isArray(input.targetKeywords) ? input.targetKeywords : (input.relevance?.targetKeywords ?? []);
  const basis: RankingFramework["basis"] = {
    pagesAnalyzed: ctx.readable.length,
    contentPages: ctx.contentPages.length,
    queries: ctx.pairs.map((p) => ({ query: p.query, url: p.url, position: p.position ?? null, volume: p.volume ?? null, intent: p.intent, source: p.source ?? "ranking" })),
    competitorsCompared: fetchedCompetitors.size,
    targetKeywords: uniq(targets.filter((k): k is string => typeof k === "string" && !!k.trim()).map((k) => k.trim())),
    gscConnected: !!input.gsc,
  };
  // 主题聚焦的 sitemap 部分存进 basis:之后接入 / 断开 Search Console 时不重抓也能逐字复现这一分
  const sitemapFocus = sitemapFocusOf(ctx);
  if (sitemapFocus) basis.sitemapFocus = sitemapFocus;

  return {
    version: 2,
    overall: { score, grade, capped, note },
    pillars,
    basis,
    relevance: relevanceWithWeakSpots(input.relevance ?? null, ownDomainRank(input), ctx.now),
    profile,
    notes,
  };
}

/**
 * 只换 Search Console 数据、从已存的完整版结果重算 Ranking Score(接入 / 断开 Search Console 时立即刷新分数,不重抓)。
 * 纯函数:除 gsc / now 外,一切输入都取自 result 本身 —— 相关性对与目标词取自上次的 ranking,
 * 主题聚焦的 sitemap 部分取自 basis.sitemapFocus。没有 ranking 或不是完整版 → null。
 */
export function recomputeRankingFromResult(result: SeoAuditResult, overrides: { gsc: GscData | null; now?: Date }): RankingFramework | null {
  const prev = result?.ranking;
  if (!prev || result.plan !== "full") return null;
  return computeRanking({
    domain: result.domain,
    pages: Array.isArray(result.pages) ? result.pages : [],
    probe: result.probe,
    psi: result.psi ?? { mobile: null, desktop: null },
    checks: Array.isArray(result.checks) ? result.checks : [],
    dimensions: Array.isArray(result.dimensions) ? result.dimensions : [],
    technical: { score: result.overall.score, grade: result.overall.grade, blockers: result.meta?.blockers ?? [] },
    authority: result.authority ?? null,
    visibility: result.visibility ?? null,
    relevance: prev.relevance ?? null,
    reputation: result.reputation ?? null,
    gsc: overrides.gsc ?? null,
    sitemapFocus: prev.basis?.sitemapFocus,
    targetKeywords: prev.basis?.targetKeywords,
    now: overrides.now,
  });
}
