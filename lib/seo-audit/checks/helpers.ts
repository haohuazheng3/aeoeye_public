/* ============================================================
   SEO Audit —— 检查项共享工具

   为什么单独抽一层:7 个维度文件都要做同样的事(按受影响页占比定状态、
   写"Across N crawled pages …"这句证据、截样本、找页面类型),
   放一起才能保证所有检查的口径完全一致,评分层(score.ts)才有可比性。
   只依赖 ../types,不 import 任何引擎实现(引擎由其他人并行编写)。
   ============================================================ */

import type {
  CheckStatus,
  CrawledPage,
  DimensionId,
  Effort,
  PageType,
  PsiResult,
  SeoCheck,
  Severity,
  SiteProbe,
  UrlVariant,
} from "../types";
import { checkName, checkTitle } from "./titles";

/** 检查上下文 —— 与规格 §1 的签名逐字一致,index.ts 会 re-export */
export interface CheckContext {
  probe: SiteProbe;
  pages: CrawledPage[];
  entry: CrawledPage | null;
  psi: { mobile: PsiResult | null; desktop: PsiResult | null };
  sitemapSample: string[];
}

/** V2-1:权重由严重度派生(critical 4 · high 3 · medium 2 · low 1) */
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** 页面级检查的默认阈值:0% pass;≤20% warn;>20% fail(V2-1) */
export const PAGE_SHARE_WARN_MAX = 0.2;

/* ------------------------------------------------------------
   官方文档链接表 —— 只放 Google Search Central / web.dev / MDN
   (少数 Lighthouse 审计只在 developer.chrome.com 有官方页)
   ------------------------------------------------------------ */
export const DOCS = {
  crawlers: "https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers",
  robotsIntro: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  robotsCreate: "https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt",
  robotsMeta: "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag",
  blockIndexing: "https://developers.google.com/search/docs/crawling-indexing/block-indexing",
  sitemaps: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
  sitemapsLarge: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps",
  canonical: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  redirects: "https://developers.google.com/search/docs/crawling-indexing/301-redirects",
  httpErrors: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors",
  soft404: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors",
  hreflang: "https://developers.google.com/search/docs/specialty/international/localized-versions",
  javascript: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
  titleLink: "https://developers.google.com/search/docs/appearance/title-link",
  snippet: "https://developers.google.com/search/docs/appearance/snippet",
  starterGuide: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
  helpfulContent: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
  images: "https://developers.google.com/search/docs/appearance/google-images",
  urlStructure: "https://developers.google.com/search/docs/crawling-indexing/url-structure",
  outboundLinks: "https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links",
  crawlableLinks: "https://developers.google.com/search/docs/crawling-indexing/links-crawlable",
  crawlBudget: "https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget",
  mobileFirst: "https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing",
  structuredIntro: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
  organization: "https://developers.google.com/search/docs/appearance/structured-data/organization",
  breadcrumb: "https://developers.google.com/search/docs/appearance/structured-data/breadcrumb",
  article: "https://developers.google.com/search/docs/appearance/structured-data/article",
  product: "https://developers.google.com/search/docs/appearance/structured-data/product",
  faq: "https://developers.google.com/search/docs/appearance/structured-data/faqpage",
  favicon: "https://developers.google.com/search/docs/appearance/favicon-in-search",
  vitals: "https://web.dev/articles/vitals",
  lcp: "https://web.dev/articles/lcp",
  inp: "https://web.dev/articles/inp",
  cls: "https://web.dev/articles/cls",
  ttfb: "https://web.dev/articles/ttfb",
  optimizeLcp: "https://web.dev/articles/optimize-lcp",
  optimizeCls: "https://web.dev/articles/optimize-cls",
  optimizeTtfb: "https://web.dev/articles/optimize-ttfb",
  httpCache: "https://web.dev/articles/http-cache",
  textCompression: "https://web.dev/articles/reduce-network-payloads-using-text-compression",
  imageFormats: "https://web.dev/articles/choose-the-right-image-format",
  removeUnusedCode: "https://web.dev/articles/remove-unused-code",
  renderBlocking: "https://web.dev/articles/critical-rendering-path/render-blocking-css",
  lighthouseScoring: "https://developer.chrome.com/docs/lighthouse/performance/performance-scoring",
  fontSize: "https://developer.chrome.com/docs/lighthouse/seo/font-size",
  tapTargets: "https://developer.chrome.com/docs/lighthouse/seo/tap-targets",
  accessibility: "https://web.dev/learn/accessibility",
  viewportMeta: "https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag",
  langAttr: "https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang",
  whyHttps: "https://web.dev/articles/why-https-matters",
  mixedContent: "https://web.dev/articles/what-is-mixed-content",
  tls: "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",
  hsts: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security",
  csp: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP",
  securityHeaders: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options",
  openGraph: "https://ogp.me/",
  twitterCards: "https://developer.x.com/en/docs/x-for-websites/cards/overview/markup",
} as const;

/* ------------------------------------------------------------
   构造器
   ------------------------------------------------------------ */
/** 标题不在这里传:由 titles.ts 按 id + 最终状态生成(复审契约第 7 条),各维度文件只管判定 */
export interface CheckDraft {
  id: string;
  dimension: DimensionId;
  status: CheckStatus;
  severity: Severity;
  evidence?: string[];
  fix?: string;
  effort?: Effort;
  docs?: string;
  affected?: string[];
  gate?: boolean;
  scope?: "site" | "page";
  affectedCount?: number;
  sample?: string[];
  weight?: number;
}

/** 统一补默认值:weight 由 severity 派生、sample 由 affected 截 3、scope 默认 site;
 *  name / title 查标题表 —— title 必须在状态定下来之后才算,fail 与 pass 是两句不同的话 */
export function check(d: CheckDraft): SeoCheck {
  const affected = d.affected ?? [];
  const out: SeoCheck = {
    id: d.id,
    dimension: d.dimension,
    title: checkTitle(d.id, d.status),
    name: checkName(d.id),
    status: d.status,
    severity: d.severity,
    weight: d.weight ?? SEVERITY_WEIGHT[d.severity],
    evidence: d.evidence ?? [],
    affected,
    fix: d.fix ?? "",
    effort: d.effort ?? "medium",
    scope: d.scope ?? "site",
    affectedCount: d.affectedCount ?? affected.length,
    sample: d.sample ?? affected.slice(0, 3),
  };
  if (d.docs) out.docs = d.docs;
  if (d.gate) out.gate = true;
  return out;
}

/** 数据缺失 → na,不惩罚;note 解释为什么没测(免费视图会锁,但付费能看到) */
export function na(
  id: string,
  dimension: DimensionId,
  severity: Severity,
  note: string,
  extra: Partial<Pick<CheckDraft, "docs" | "gate" | "scope" | "fix" | "effort">> = {},
): SeoCheck {
  return check({ id, dimension, severity, status: "na", evidence: [note], ...extra });
}

/* ------------------------------------------------------------
   数值与 URL 小工具
   ------------------------------------------------------------ */
export function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** p90 等分位(最近秩法) */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}

/** 证据里只显示路径,读起来短;解析失败就原样返回 */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = `${u.pathname}${u.search}`;
    return p || "/";
  } catch {
    return url;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** "/a, /b, /c (+4 more)" */
export function listPaths(urls: string[], n = 5): string {
  const shown = urls.slice(0, n).map(pathOf);
  const rest = urls.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} (+${rest} more)` : shown.join(", ");
}

/**
 * 比较用的 URL 归一化:去 hash、去追踪参数、去 index.html、去尾斜杠、
 * 小写主机并把 www. 与裸域视为同一站(与 url.ts 的 isSameSite 口径一致)。
 * 协议保留 —— 需要忽略协议时用 urlKey()。
 */
export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, "");
    for (const k of Array.from(x.searchParams.keys())) {
      if (/^(utm_[a-z]+|fbclid|gclid|msclkid|ref|mc_cid|mc_eid)$/i.test(k)) x.searchParams.delete(k);
    }
    let path = x.pathname.replace(/\/index\.html?$/i, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    x.pathname = path || "/";
    x.search = x.searchParams.toString() ? `?${x.searchParams.toString()}` : "";
    return x.toString();
  } catch {
    return u.trim();
  }
}

/** 忽略协议的归一化键(自指 canonical、内链匹配都用它) */
export function urlKey(u: string): string {
  return normalizeUrl(u).replace(/^https?:\/\//i, "");
}

export function isAbsoluteUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

/** 工具类路径(登录/购物车/搜索/账户)本来就该 noindex,不算问题 */
export function isToolPath(url: string): boolean {
  const p = pathOf(url).toLowerCase();
  return /^\/(login|log-in|signin|sign-in|signup|sign-up|register|logout|cart|basket|checkout|search|account|my-account|dashboard|admin|wp-admin|wp-login\.php|user|users|profile|settings|auth|api|thank-you|thanks|unsubscribe|password|reset)(\/|$|\?)/.test(p);
}

export function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/* ------------------------------------------------------------
   页面筛选
   ------------------------------------------------------------ */
/** 200 且是 HTML(contentType 为空时视为 HTML)—— 只有这种页的内容才读得出来 */
export function isHtml200(p: CrawledPage): boolean {
  return p.status === 200 && (!p.contentType || /html/i.test(p.contentType));
}

/** 只拿真正能做站内分析的页 */
export function okPages(ctx: CheckContext): CrawledPage[] {
  return ctx.pages.filter(isHtml200);
}

export function hasNoindex(p: CrawledPage): boolean {
  if (typeof p.robotsNoindex === "boolean") return p.robotsNoindex;
  return /\bnoindex\b/i.test(p.robotsMeta ?? "") || /\bnoindex\b/i.test(p.xRobotsTag ?? "");
}

/** 被 WAF 拦下时,所有依赖抓取的检查都用这句 na 说明 */
export function blockedNote(ctx: CheckContext): string | null {
  const b = ctx.probe.blocked;
  if (!b || !b.detected) return null;
  // 旧数据兜底:早期 crawl.ts 把证书失败记成 blocked.kind="tls"。证书坏了是站点自己的问题
  // (所有访客和 Googlebot 都过不去),绝不能再让人"把 AEOeyeBot 加白"(复审 C20)
  if (b.kind === "tls") return `Not measured: the HTTPS certificate check failed before we could read the site (${b.evidence || "certificate error"}). Fix the certificate and re-run.`;
  return `Not measured: our crawler was blocked (${b.kind ?? "unknown"}) before it could read the site. Allow AEOeyeBot and re-run.`;
}

/**
 * 能读出内容的入口页。ctx.entry 只是"深度 0 的那一页":入口回 500、或证书握手失败(status 0)时
 * 它照样在。直接拿它判 viewport / lang / OG,会把"根本没读到"报成"缺 viewport"——
 * 复审 C20 让证书坏掉的站照常出分后,这类误报会成片出现,所以内容类入口检查一律先过这一关。
 */
export function usableEntry(ctx: CheckContext): CrawledPage | null {
  const e = ctx.entry;
  return e && isHtml200(e) ? e : null;
}

/** 入口页读不出内容时的 na 说明:被拦 → blockedNote;否则写清是哪种失败,不笼统说"没测" */
export function entryNaNote(ctx: CheckContext): string {
  const blocked = blockedNote(ctx);
  if (blocked) return blocked;
  const where = ctx.probe.entryUrl;
  const err = ctx.probe.entryError;
  if (err) return `Not measured: ${where} did not load (${err.kind === "tls" ? "certificate error" : err.kind}: ${err.message}).`;
  const e = ctx.entry;
  if (e && e.status !== 200) return `Not measured: ${where} returned ${e.status ? `HTTP ${e.status}` : "no response"}, so its content could not be read.`;
  if (e) return `Not measured: ${where} is not an HTML page (${e.contentType || "unknown content type"}).`;
  return "Not measured: the entry page could not be fetched.";
}

/* ------------------------------------------------------------
   证书 / TLS(复审 C20 · 契约第 4 条)
   ------------------------------------------------------------ */
/** 证书类错误:浏览器会弹整页警告的那类(过期、主机名不符、自签、链不全、吊销)。
 *  DNS 失败 / 拒连 / 超时 属于"连不上",由可达性判断,不算证书问题。 */
const CERT_ERROR = /expired|not[ _]yet[ _]valid|hostname mismatch|self[- _]signed|incomplete chain|revoked|unable to verify|certificate|CERT_|ERR_TLS_|UNABLE_TO|DEPTH_ZERO|HOSTNAME_MISMATCH/i;
/** 过期 / 尚未生效 —— 只有这两种归 sec.tls.expired,其余证书错误归 sec.https */
const EXPIRY_ERROR = /expired|not[ _]yet[ _]valid/i;

export interface TlsFailure {
  /** 报告里原样展示的错误串(入口请求的错误优先 —— 那是访客真正撞上的) */
  message: string;
  /** 过期或尚未生效(错误串说的,或证书日期已过) */
  expired: boolean;
}

/**
 * 站点的 HTTPS 是否在证书环节失败:
 *  - probe.entryError.kind === "tls":入口请求在握手时就失败了(crawl.ts 判定);
 *  - probe.blocked.kind === "tls":旧版 crawl.ts 的记法(兜底,无论 detected 真假);
 *  - probe.tls.error 是证书类错误(tls.ts 的独立握手)。
 * 都没有 → null。
 */
export function tlsFailure(probe: SiteProbe): TlsFailure | null {
  const msgs: string[] = [];
  if (probe.entryError?.kind === "tls") msgs.push(probe.entryError.message || "TLS handshake failed");
  if (probe.blocked?.kind === "tls") msgs.push(probe.blocked.evidence || "TLS handshake failed");
  const certErr = probe.tls?.error && CERT_ERROR.test(probe.tls.error) ? probe.tls.error : null;
  if (certErr) msgs.push(`certificate check: ${certErr}`);
  if (!msgs.length) return null;
  const unique = uniq(msgs);
  const daysLeft = probe.tls?.daysLeft;
  return {
    message: unique.join("; "),
    expired: unique.some((m) => EXPIRY_ERROR.test(m)) || (typeof daysLeft === "number" && daysLeft <= 0),
  };
}

/* ------------------------------------------------------------
   www ↔ 裸域的另一主机(复审 C21 · 契约第 5 条)
   ------------------------------------------------------------ */
/** 另一主机 DNS 根本不存在(blog.example.com 没有 www.blog.example.com)→ 返回它的主机名,否则 null */
export function missingAltHost(probe: SiteProbe): string | null {
  const a = probe.altHost;
  return a && a.exists === false && a.host ? a.host.toLowerCase().replace(/\.$/, "") : null;
}

/** 去掉"不存在的另一主机"的变体:没有这个主机不是问题,不能因为它没响应就扣分 */
export function realVariants(probe: SiteProbe): UrlVariant[] {
  const alt = missingAltHost(probe);
  const vs = probe.variants ?? [];
  return alt ? vs.filter((v) => hostOf(v.url) !== alt) : vs;
}

/* ------------------------------------------------------------
   页面级检查(V2-1):按受影响页占比定状态
   ------------------------------------------------------------ */
export function shareStatus(affected: number, total: number, thresholds?: { pass?: number; warn?: number }): CheckStatus {
  if (!total) return "na";
  const share = affected / total;
  const passMax = thresholds?.pass ?? 0;
  const warnMax = thresholds?.warn ?? PAGE_SHARE_WARN_MAX;
  // 加一点点 epsilon:4/20 = 0.2 这种边界在浮点下要稳定落在 warn
  if (share <= passMax + 1e-9) return "pass";
  if (share <= warnMax + 1e-9) return "warn";
  return "fail";
}

export interface PageCheckOpts {
  id: string;
  dimension: DimensionId;
  severity: Severity;
  /** 分母:参与本项判断的页面 URL(不是全部抓取页,例如"只看 article 页") */
  universe: string[];
  /** 分子:受影响页面 URL */
  affected: string[];
  /** 证据谓语,例如 "are missing a <title>" —— 会拼成 "Across 20 crawled pages, 3 (15%) are missing a <title>: /a, /b" */
  what: string;
  fix: string;
  docs?: string;
  effort?: Effort;
  thresholds?: { pass?: number; warn?: number };
  /** 追加证据行(放在样本量那句之后) */
  extra?: string[];
  /** 分母的单位描述,默认 "crawled pages" */
  unit?: string;
  /** 少数检查规格写死了状态(例如 hreflang 只 warn 不 fail) */
  forceStatus?: CheckStatus;
  gate?: boolean;
  /** 数据完全缺失时的 na 说明 */
  naNote?: string;
}

export function pageCheck(o: PageCheckOpts): SeoCheck {
  const total = o.universe.length;
  const unit = o.unit ?? "crawled pages";
  if (total === 0) {
    return na(o.id, o.dimension, o.severity, o.naNote ?? `Not measured: no ${unit} were available for this check.`, {
      docs: o.docs,
      scope: "page",
      gate: o.gate,
    });
  }
  const affected = uniq(o.affected);
  const n = affected.length;
  let status = shareStatus(n, total, o.thresholds);
  if (o.forceStatus && n > 0) status = o.forceStatus;
  const first =
    n === 0
      ? `Across ${total} ${unit}, none ${o.what}.`
      : `Across ${total} ${unit}, ${n} (${pct(n, total)}%) ${o.what}: ${listPaths(affected)}.`;
  return check({
    id: o.id,
    dimension: o.dimension,
    status,
    severity: o.severity,
    evidence: [first, ...(o.extra ?? [])],
    fix: o.fix,
    docs: o.docs,
    effort: o.effort,
    affected,
    scope: "page",
    affectedCount: n,
    sample: affected.slice(0, 3),
    gate: o.gate,
  });
}

/* ------------------------------------------------------------
   页面类型启发式 —— 薄内容/Article schema/Product schema 只对相应类型生效
   ------------------------------------------------------------ */
export function pageTypeOf(p: CrawledPage): PageType {
  if (p.pageType) return p.pageType;
  const path = pathOf(p.url).toLowerCase().split("?")[0];
  const types = (p.jsonLdTypes ?? []).map((t) => t.toLowerCase());
  if (path === "/" || path === "") return "home";
  if (/\/(privacy|terms|tos|legal|cookie|cookies|imprint|impressum|disclaimer|gdpr|refund)/.test(path)) return "legal";
  if (/\/(contact|contact-us|about|about-us|team|support|careers)(\/|$)/.test(path)) return "contact";
  if (/\/(pricing|plans|price)(\/|$)/.test(path)) return "pricing";
  if (types.some((t) => t === "product" || t.endsWith("product"))) return "product";
  if (/\/(product|products|shop|store|item|items|p)\/[^/]+/.test(path)) return "product";
  if (types.some((t) => /^(article|blogposting|newsarticle|techarticle|scholarlyarticle|report)$/.test(t))) return "article";
  // 注意不含 /docs/:文档页按 TechArticle 另算,不该被要求 Article schema
  if (/\/(blog|news|articles?|posts?|guides?|insights|resources|learn|stories|journal)\/[^/]+/.test(path)) return "article";
  if (/\/(blog|news|articles|posts|guides|resources|category|categories|tag|tags|topics)\/?$/.test(path)) return "listing";
  // 路径不带 /blog/ 的文章:只认"很长 + 至少两层路径 + 有完整小标题结构",
  // 否则 600 词的功能页/文档页会被当成文章去查薄内容和 Article schema。
  const segs = path.split("/").filter(Boolean).length;
  if (p.wordCount >= 1000 && segs >= 2 && (p.h1s?.length ?? 0) >= 1 && (p.headings ?? []).filter((h) => h.level === 2).length >= 3) return "article";
  return "other";
}

/* ------------------------------------------------------------
   文本相似度
   ------------------------------------------------------------ */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "your", "our", "is", "at", "by", "from",
  "vs", "how", "what", "why", "best", "guide", "free", "online", "com", "www", "http", "https",
]);

/** 分词成集合:小写、去标点、去停用词、去 1 字词 */
export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of (s ?? "").toLowerCase().split(/[^a-z0-9]+/i)) {
    if (t.length >= 2 && !STOP.has(t)) out.add(t);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  a.forEach((x) => {
    if (b.has(x)) inter += 1;
  });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 两串文本的 token Jaccard(headline vs title 之类) */
export function textSimilarity(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}

/** minhash 签名相同槽位占比 ≈ Jaccard;签名缺失或长度不一致 → null */
export function minhashSimilarity(a: number[] | undefined, b: number[] | undefined): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let same = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
  return same / a.length;
}

/** URL 最后一段路径的分词(slug) */
export function slugTokens(url: string): Set<string> {
  const path = pathOf(url).split("?")[0].replace(/\/+$/, "");
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return tokenize(last.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " "));
}

/* ------------------------------------------------------------
   聚簇(近重复用):并查集
   ------------------------------------------------------------ */
export function clusters(n: number, pairs: [number, number][]): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const [a, b] of pairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
}

/** 解析日期;无效返回 null */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysSince(d: Date, now = new Date()): number {
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/** PSI audit 查找(缺失 → null) */
export function findAudit(psi: PsiResult | null | undefined, id: string) {
  if (!psi || !Array.isArray(psi.audits)) return null;
  return psi.audits.find((a) => a.id === id) ?? null;
}

export function fmtKb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${round1(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
