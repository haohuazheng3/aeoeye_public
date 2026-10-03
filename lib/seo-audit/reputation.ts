/* ============================================================
   SEO Audit · 站外声誉(v4;SEO Ranking Score 里 authority.reputation 的数据层)

   回答"Google 上别人怎么说这个品牌"。2 次 advanced SERP(同价 $0.002/次;不加载 AI 摘要,用不上):
   ① 品牌词本身 ② 品牌词 + reviews(规格 docs/design/seo-ranking-score-spec.md v2 §3.5)。
   不调用大模型,也不抓任何第三方页面 —— 只读 SERP 上已经有的东西:谁排第一、有没有知识面板、
   评价平台与评分、独立报道、论坛讨论、负面标题。

   品牌名:站内实体信号(Organization 名 / og:site_name / 标题品牌段)里与域名主体相符的那个,按出现页数多数决
   (与 ranking.ts 同一口径:domainLabel / brandKey);一个都对不上就用域名主体(aeoeye.com → aeoeye)。
   为什么必须与域名相符:og:site_name = "Blog" 这类通用名拿去搜,结果与这个站毫无关系。

   "是不是在说这个品牌":评价平台、论坛、负面标题、独立报道都要求标题或 URL 里出现品牌名 ——
   小品牌搜 "X reviews",Google 常常回一堆别家的评测页;把它们算成这个站的声誉,分数就是假的。

   永不抛;≤2 次 SERP;时间预算内做不完写 notes。
   ============================================================ */

import { brandKey, domainLabel } from "./ranking";
import { mainDomain, normalizeSerpSnapshot } from "./relevance";
import { dedupeKey, registrableDomain } from "./url";
import type { CrawledPage, ReputationAnalysis, SerpSnapshot } from "./types";

/* ---------- 契约 ---------- */

/** 取某个查询的 advanced SERP(生产 = dataforseo.fetchSerpAdvanced;测试注入假的) */
export type ReputationSerpFn = (keyword: string, opts?: { loadAiOverview?: boolean }) => Promise<SerpSnapshot>;

export interface ReputationInput {
  domain: string;
  pages: CrawledPage[];
  budgetMs: number;
  /** 测试注入:替代 fetchSerpAdvanced(给了就不 import dataforseo,也不看 DataForSEO 是否配置) */
  serpFn?: ReputationSerpFn;
  /** 测试注入:替代 Date.now(预算判定用的时钟) */
  now?: () => number;
}

/* ---------- 常量 ---------- */

/** SERP 取 1 页(10 条):DataForSEO 按页计费 */
const SERP_DEPTH = 10;
/** 剩余时间不到这个数就不调:live SERP 本身要几秒,发出去等不到结果等于白花钱 */
const MIN_SERP_BUDGET_MS = 5_000;
const BRAND_TOP = 3;
const INDEPENDENT_TOP = 10;
const MAX_REVIEW_PLATFORMS = 10;
const MAX_TITLE_CHARS = 200;
/** 品牌名过长多半是整句标语,不是名字 */
const MAX_BRAND_CHARS = 60;

/** 负面标题(规格:scam / complaint(s) / lawsuit / ripoff / fraud,含常见词形) */
const NEGATIVE_TITLE = /\b(?:scam(?:s|mer|mers|med)?|complaints?|lawsuits?|rip[- ]?offs?|fraud(?:s|ulent)?)\b/i;

/** 公司后缀不是品牌名的一部分("Acme, Inc." 搜 "Acme") */
const LEGAL_TAIL = /[\s,]+(?:inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pty)\.?$/i;

const hostIn = (host: string, list: readonly string[]): boolean => list.some((d) => host === d || host.endsWith(`.${d}`));
const byLabel = (label: string) => (host: string) => domainLabel(host) === label;
const byDomain = (d: string) => (host: string) => host === d || host.endsWith(`.${d}`);

/**
 * 评价平台(规格名单)。按注册域主体认(uk.trustpilot.com、capterra.co.uk 也算);
 * Google 地图只认 /maps 路径或 maps.google.*;Gartner 只认 Peer Insights(/reviews)。
 */
const REVIEW_PLATFORMS: { domain: string; match: (host: string, path: string) => boolean }[] = [
  { domain: "trustpilot.com", match: byLabel("trustpilot") },
  { domain: "g2.com", match: byDomain("g2.com") },
  { domain: "capterra.com", match: byLabel("capterra") },
  { domain: "getapp.com", match: byLabel("getapp") },
  { domain: "softwareadvice.com", match: byLabel("softwareadvice") },
  { domain: "yelp.com", match: byLabel("yelp") },
  { domain: "bbb.org", match: byDomain("bbb.org") },
  { domain: "sitejabber.com", match: byLabel("sitejabber") },
  { domain: "producthunt.com", match: byLabel("producthunt") },
  { domain: "glassdoor.com", match: byLabel("glassdoor") },
  { domain: "google.com/maps", match: (h, p) => (domainLabel(h) === "google" && /^\/maps(?:\/|$)/.test(p)) || h.startsWith("maps.google.") },
  { domain: "tripadvisor.com", match: byLabel("tripadvisor") },
  { domain: "clutch.co", match: byDomain("clutch.co") },
  { domain: "gartner.com", match: (h, p) => byDomain("gartner.com")(h) && /^\/(?:reviews|peer-insights)(?:\/|$)/.test(p) },
  { domain: "appsumo.com", match: byLabel("appsumo") },
  { domain: "reviews.io", match: byDomain("reviews.io") },
  { domain: "consumeraffairs.com", match: byLabel("consumeraffairs") },
];

/** 论坛讨论(规格:reddit / quora / hn / stackexchange;stackoverflow 是同一网络) */
const FORUM_HOSTS = ["reddit.com", "quora.com", "news.ycombinator.com", "stackexchange.com", "stackoverflow.com"] as const;

/**
 * 社交与档案类站点:品牌自己开的账号 / 应用商店页 / 工商档案,不是"别人在报道你"。
 * (规格写"非社交";这里把同性质的档案站一并排除 —— 自己填的 Crunchbase 页不算独立报道。)
 */
const PROFILE_HOSTS = [
  "facebook.com", "twitter.com", "x.com", "linkedin.com", "instagram.com", "youtube.com", "tiktok.com", "pinterest.com",
  "threads.net", "github.com", "medium.com", "crunchbase.com", "wellfound.com", "angel.co", "apps.apple.com",
  "play.google.com", "chromewebstore.google.com",
] as const;

/* ---------- 小工具 ---------- */

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, " ").trim().slice(0, 200) || "unknown error";
}

function hostOf(url: string): string {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "/";
  }
}

/** 小写、去掉一切非字母数字 —— 品牌名与标题 / URL 比对用("AEO eye" ↔ aeoeye.com) */
const compact = (s: string): string => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** 输入可能带协议 / 路径 / 端口 / www.:统一成裸域 */
function cleanDomain(input: unknown): string {
  const s = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
  return registrableDomain(s);
}

function clip(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** 同步抛错也收成 rejected promise */
function invoke<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
}

/** 把一个 Promise 限在 deadline 之内;超时只是不再等它(请求已发出,迟到的结果丢弃) */
async function settleBy<T>(p: Promise<T>, deadline: number, now: () => number): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error: unknown }> {
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
   品牌名
   ============================================================ */

/** 品牌键与域名主体相符:相同,或一方包含另一方(≥3 个字符才认包含,防误配)—— 与 ranking.ts 同一口径 */
function keysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
}

/** 展示用的品牌名:折叠空白、去公司后缀与尾部标点("Acme Analytics, Inc." → "Acme Analytics") */
function displayName(raw: string): string {
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i += 1) s = s.replace(LEGAL_TAIL, "").trim();
  return s.replace(/[\s,.;:|·\-–—]+$/u, "").trim();
}

/**
 * 声誉检索用的品牌名:各页 content.orgName / siteName / titleBrand 里与域名主体相符的品牌键,按出现页数多数决
 * (并列时与域名主体完全相同的优先,再按字母序,保证可复现);拼写取该键最常见的写法。
 * 一个都对不上 → 域名主体(fromSite = false)。
 */
export function reputationBrand(domain: string, pages: CrawledPage[]): { name: string; fromSite: boolean } {
  const label = domainLabel(domain);
  const tally = new Map<string, { pages: number; spellings: Map<string, number> }>();
  for (const p of Array.isArray(pages) ? pages : []) {
    const c = p?.content;
    if (!c) continue;
    const seen = new Set<string>();
    for (const raw of [c.orgName, c.siteName, c.titleBrand]) {
      if (typeof raw !== "string") continue;
      const name = displayName(raw);
      const key = brandKey(name);
      if (key.length < 2 || name.length > MAX_BRAND_CHARS || !keysMatch(key, label)) continue;
      const t = tally.get(key) ?? { pages: 0, spellings: new Map<string, number>() };
      if (!seen.has(key)) {
        seen.add(key);
        t.pages += 1;
      }
      t.spellings.set(name, (t.spellings.get(name) ?? 0) + 1);
      tally.set(key, t);
    }
  }
  let best: { key: string; pages: number; spellings: Map<string, number> } | null = null;
  for (const [key, t] of Array.from(tally.entries())) {
    if (
      !best ||
      t.pages > best.pages ||
      (t.pages === best.pages && Number(key === label) > Number(best.key === label)) ||
      (t.pages === best.pages && Number(key === label) === Number(best.key === label) && key < best.key)
    ) {
      best = { key, ...t };
    }
  }
  if (!best) return { name: label, fromSite: false };
  const spelling = Array.from(best.spellings.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { name: spelling, fromSite: true };
}

/* ============================================================
   SERP 解读
   ============================================================ */

type Organic = SerpSnapshot["organic"][number];

function platformOf(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const path = pathOf(url);
  return REVIEW_PLATFORMS.find((p) => p.match(host, path))?.domain ?? null;
}

/** 标题或 URL 里出现品牌名(紧凑比对);品牌键太短(<3)时不做这道过滤,宁可放过也不误杀 */
function mentionsBrand(item: Organic, keys: string[]): boolean {
  if (!keys.length) return true;
  const hay = `${compact(item.title)} ${compact(item.url)}`;
  return keys.some((k) => hay.includes(k));
}

function ratingFor(item: Organic, snap: SerpSnapshot): { value: number; votes: number | null } | null {
  const key = dedupeKey(item.url);
  const r = snap.ratings.find((x) => dedupeKey(x.url) === key);
  return r ? { value: Math.round(r.value * 100) / 100, votes: r.votes } : null;
}

function byPosition(snap: SerpSnapshot | null): Organic[] {
  return snap ? [...snap.organic].sort((a, b) => a.position - b.position) : [];
}

/* ============================================================
   主流程
   ============================================================ */

async function serpProvider(input: ReputationInput): Promise<{ fn: ReputationSerpFn | null; why: string | null }> {
  if (input.serpFn) return { fn: input.serpFn, why: null };
  try {
    // 按需 import:dataforseo.ts 在导入期校验 env,纯函数测试不该被它拖累
    const dfs = await import("./dataforseo");
    if (!dfs.dfsEnabled()) return { fn: null, why: "DataForSEO is not configured on the server" };
    return { fn: (kw, opts) => dfs.fetchSerpAdvanced(kw, { depth: SERP_DEPTH, loadAiOverview: opts?.loadAiOverview === true }), why: null };
  } catch (e) {
    return { fn: null, why: errText(e) };
  }
}

/**
 * 站外声誉(规格 v2 §3.5)。永不抛:失败写 notes;≤2 次 SERP(逐笔由 dataforseo.ts 记账);预算不够就不调。
 */
export async function analyzeReputation(input: ReputationInput): Promise<ReputationAnalysis> {
  const domain = cleanDomain(input?.domain);
  let brand: { name: string; fromSite: boolean } = { name: domainLabel(domain), fromSite: false };
  try {
    brand = reputationBrand(domain, Array.isArray(input?.pages) ? input.pages : []);
  } catch {
    /* 页面数据形状不对:退到域名主体 */
  }
  const out: ReputationAnalysis = {
    brandName: brand.name,
    brandQuery: brand.name,
    reviewsQuery: brand.name ? `${brand.name} reviews` : "",
    serpCalls: 0,
    ownsBrandSerp: null,
    brandTop3: false,
    knowledgePanel: false,
    reviewPlatforms: [],
    independentDomains: 0,
    forumMentions: 0,
    negativeSignals: 0,
    notes: [],
  };
  try {
    await run(input, out, domain, brand.fromSite);
  } catch (e) {
    // 只有代码缺陷会走到这里:已得到的部分照常返回(契约:永不抛)
    out.notes.push(`The brand reputation check stopped early: ${errText(e)}`);
  }
  return out;
}

async function run(input: ReputationInput, out: ReputationAnalysis, domain: string, fromSite: boolean): Promise<void> {
  const notes = out.notes;
  if (!domain || !out.brandName) {
    notes.push("No domain was given, so brand reputation could not be checked.");
    return;
  }
  if (!fromSite) {
    notes.push(`No brand name matching ${domain} was found on the site, so the domain name "${out.brandName}" was searched as the brand.`);
  }
  const clock = input.now ?? Date.now;
  const deadline = clock() + Math.max(0, Number(input.budgetMs) || 0);
  if (deadline - clock() < MIN_SERP_BUDGET_MS) {
    notes.push("There was not enough time left in this run to check brand reputation; re-run to compute it.");
    return;
  }
  const serp = await serpProvider(input);
  if (!serp.fn) {
    notes.push(`Brand search results could not be looked up (${serp.why ?? "search data unavailable"}), so off-site reputation was not checked.`);
    return;
  }
  const fn = serp.fn;
  const search = async (q: string): Promise<{ snap: SerpSnapshot | null; note: string | null }> => {
    out.serpCalls += 1;
    const r = await settleBy(
      invoke(() => fn(q, { loadAiOverview: false })),
      deadline,
      clock
    );
    if (r.ok) return { snap: normalizeSerpSnapshot(r.value), note: null };
    return {
      snap: null,
      note: r.timedOut
        ? `The time budget ran out while searching Google for "${q}".`
        : `The Google results for "${q}" could not be loaded (${errText(r.error)}).`,
    };
  };
  // 两次并行发出;失败 note 按"品牌词 → reviews"的固定顺序写,与哪个先回来无关(同一站点两次运行的 notes 一致)
  const [brand, reviews] = await Promise.all([search(out.brandQuery), search(out.reviewsQuery)]);
  for (const n of [brand.note, reviews.note]) if (n) notes.push(n);
  interpret(out, domain, brand.snap, reviews.snap);
}

function interpret(out: ReputationAnalysis, domain: string, brandSnap: SerpSnapshot | null, reviewsSnap: SerpSnapshot | null): void {
  const notes = out.notes;
  const keys = Array.from(new Set([brandKey(out.brandName), brandKey(domainLabel(domain))])).filter((k) => k.length >= 3);
  const isOwn = (url: string): boolean => {
    const h = hostOf(url);
    return !!h && (h === domain || h.endsWith(`.${domain}`));
  };

  /* ① 品牌 SERP:谁排第一、前 3 有没有本站、知识面板、独立报道 */
  if (brandSnap) {
    const organic = byPosition(brandSnap);
    if (!organic.length) {
      notes.push(`Google returned no organic results for "${out.brandQuery}", so brand-search ownership could not be judged.`);
    } else {
      out.ownsBrandSerp = isOwn(organic[0].url);
      out.brandTop3 = organic.slice(0, BRAND_TOP).some((o) => isOwn(o.url));
      const independent = new Set<string>();
      for (const o of organic.slice(0, INDEPENDENT_TOP)) {
        const host = hostOf(o.url);
        if (!host || isOwn(o.url) || hostIn(host, PROFILE_HOSTS) || hostIn(host, FORUM_HOSTS) || platformOf(o.url)) continue;
        if (!mentionsBrand(o, keys)) continue;
        independent.add(mainDomain(host));
      }
      out.independentDomains = independent.size;
    }
    if (brandSnap.knowledgeGraph) {
      // 知识面板只有一个布尔值,看不到它描述的是谁:本站连前 3 都不在,多半是同名的别的实体
      if (out.brandTop3) out.knowledgePanel = true;
      else notes.push(`Google shows a knowledge panel for "${out.brandQuery}", but ${domain} is not in the top 3 results, so the panel most likely describes a different entity and was not counted.`);
    }
  }

  /* ② 两个 SERP 合起来(按 URL 去重):评价平台与评分、论坛讨论、负面标题 */
  const items: { item: Organic; snap: SerpSnapshot }[] = [];
  const seen = new Set<string>();
  for (const snap of [brandSnap, reviewsSnap]) {
    if (!snap) continue;
    for (const item of byPosition(snap)) {
      const k = dedupeKey(item.url);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ item, snap });
    }
  }
  let offBrand = 0;
  for (const { item, snap } of items) {
    if (isOwn(item.url)) continue;
    const host = hostOf(item.url);
    const mentions = mentionsBrand(item, keys);
    const platform = platformOf(item.url);
    if (platform) {
      if (!mentions) {
        offBrand += 1;
        continue;
      }
      const rating = ratingFor(item, snap);
      const existing = out.reviewPlatforms.find((p) => p.domain === platform);
      if (existing) {
        if (!existing.rating && rating) existing.rating = rating;
      } else if (out.reviewPlatforms.length < MAX_REVIEW_PLATFORMS) {
        out.reviewPlatforms.push({ domain: platform, title: clip(item.title, MAX_TITLE_CHARS), rating });
      }
    }
    if (!mentions) continue;
    if (hostIn(host, FORUM_HOSTS)) out.forumMentions += 1;
    if (NEGATIVE_TITLE.test(item.title)) out.negativeSignals += 1;
  }
  if (offBrand) {
    notes.push(
      `${offBrand} review-site result${offBrand === 1 ? " was" : "s were"} about other companies (no mention of "${out.brandName}") and ${offBrand === 1 ? "was" : "were"} not counted.`
    );
  }
}
