/* ============================================================
   检查项标题表 —— 每条检查:中性名 + 达标句 + 问题句(复审契约第 7 条)

   为什么集中成一张表:
   - 报告里标题是买家读到的第一句话。旧标题都是"要求式"("Images declare width and
     height"),fail 时读起来像在夸你;改成随状态变化:fail/warn 显示问题句
     ("Images are missing width and height"),pass/na 显示达标句。
   - 7 个站内维度文件 + dataforseo.ts 的付费检查都从这里取,措辞口径才统一;
     check id 是唯一键,tests/titles.test.ts 会核对每个产出的 id 都在表里、
     fail/warn 的标题就是这里的问题句。
   - 问题句写给"不懂 SEO 的创始人":白话、≤70 字符,术语只放括号里。
   - info 大多是"只展示不计分"的项,达标句写成中性描述;少数 info 表示
     "没找到 / 无法确认"(面包屑、SPA 的 404),用 info 专属句,免得把
     "没有"说成"有"。
   只依赖 ../types,引擎与 UI 都不 import 这里以外的东西。
   ============================================================ */

import type { CheckStatus } from "../types";

export interface CheckTitle {
  /** 中性名称,不随状态变化(例如 "Image dimensions") */
  name: string;
  /** 达标表述:pass / na 显示它;info 没有专属句时也用它 */
  pass: string;
  /** 问题表述:fail / warn 显示它 —— 白话、≤70 字符 */
  issue: string;
  /** info 表示"没找到 / 无法确认"时的中性表述;缺省回落到 pass */
  info?: string;
}

export const CHECK_TITLES: Readonly<Record<string, CheckTitle>> = {
  /* ---------------- Crawlability & Indexing ---------------- */
  "crawl.blocked": { name: "Crawler access", pass: "Your site lets our crawler in", issue: "Your firewall blocked our crawler" },
  "crawl.js-dependent": { name: "Content without JavaScript", pass: "Page content is visible without JavaScript", issue: "Page content only appears after JavaScript runs" },
  "crawl.robots.exists": { name: "robots.txt file", pass: "robots.txt is in place and readable", issue: "robots.txt is missing or can't be read properly" },
  "crawl.robots.blocks-site": { name: "robots.txt blocking", pass: "robots.txt lets Google crawl your site", issue: "robots.txt blocks Google from crawling your site" },
  "crawl.robots.resources": { name: "CSS & JavaScript access", pass: "Google can load your CSS and JavaScript", issue: "robots.txt blocks the CSS or JavaScript Google needs" },
  "crawl.robots.sitemap-directive": { name: "Sitemap link in robots.txt", pass: "robots.txt points crawlers to your sitemap", issue: "robots.txt doesn't point crawlers to your sitemap" },
  "crawl.robots.ai-crawlers": { name: "AI crawler access", pass: "Your robots.txt rules for AI crawlers", issue: "robots.txt blocks AI crawlers" },
  "crawl.sitemap.found": { name: "XML sitemap", pass: "Your site has an XML sitemap", issue: "No XML sitemap found" },
  "crawl.sitemap.valid": { name: "Sitemap format", pass: "Sitemap files are valid and within size limits", issue: "Sitemap files are broken or too large" },
  "crawl.sitemap.sample": { name: "Sitemap URL quality", pass: "Sitemap lists only pages Google can index", issue: "Sitemap lists pages Google can't index" },
  "crawl.sitemap.lastmod": { name: "Sitemap update dates", pass: "Sitemap tells Google when pages changed", issue: "Sitemap doesn't say when pages were last updated" },
  "crawl.freshness": { name: "Content freshness", pass: "Most content has been updated in the last year", issue: "Most pages haven't been updated in over a year" },
  "crawl.entry.status": { name: "Homepage status", pass: "Homepage loads normally (HTTP 200)", issue: "Homepage returns an error or redirects" },
  "crawl.entry.indexable": { name: "Homepage indexing", pass: "Google is allowed to index your homepage", issue: "Homepage is blocked from Google" },
  "crawl.pages.noindex": { name: "Page indexing", pass: "Your pages are open to Google's index", issue: "Some pages are hidden from Google by noindex" },
  "crawl.noindex-robots-conflict": { name: "noindex vs robots.txt", pass: "No conflict between noindex and robots.txt", issue: "robots.txt stops Google from seeing your noindex tags" },
  "crawl.canonical.entry": { name: "Homepage canonical", pass: "Homepage declares itself as the main version", issue: "Homepage's canonical tag is missing or wrong" },
  "crawl.canonical.pages": { name: "Page canonicals", pass: "Pages declare their main version correctly", issue: "Some pages have a missing or wrong canonical tag" },
  "crawl.https.redirect": { name: "HTTP to HTTPS redirect", pass: "http:// visitors are sent to https://", issue: "http:// doesn't redirect permanently to https://" },
  "crawl.host.canonical": { name: "www vs non-www", pass: "www and non-www lead to one site", issue: "www and non-www aren't merged into one site" },
  "crawl.url-variants": { name: "Duplicate URL variants", pass: "URL variants point back to the main page", issue: "Duplicate versions of your page URLs are live" },
  "crawl.redirect.chains": { name: "Redirect chains", pass: "Redirects go straight to the final page", issue: "Redirects are slow or take extra hops" },
  "crawl.soft404": { name: "404 handling", pass: "Missing pages return an error code, not a page", issue: "Missing pages don't return a 404 error", info: "Missing pages load your app instead of a 404" },
  "crawl.pages.errors": { name: "Page errors", pass: "All crawled pages load without errors", issue: "Some pages return errors" },
  "crawl.links.broken": { name: "Broken internal links", pass: "Internal links all work", issue: "Some internal links lead to dead pages" },
  "crawl.links.to-redirects": { name: "Links to redirects", pass: "Internal links point straight to final URLs", issue: "Internal links point to old, redirected URLs" },
  "crawl.hreflang": { name: "Language versions (hreflang)", pass: "Language versions are linked correctly", issue: "Language version tags (hreflang) are incomplete" },

  /* ---------------- On-Page & Content ---------------- */
  "onpage.title.present": { name: "Page titles", pass: "Every page has a title", issue: "Some pages have no title" },
  "onpage.title.length": { name: "Title length", pass: "Titles are a good length (20–60 characters)", issue: "Some titles are too short or too long" },
  "onpage.title.unique": { name: "Duplicate titles", pass: "Every page has its own title", issue: "Several pages share the same title" },
  "onpage.title.h1-slug-overlap": { name: "Title, heading and URL match", pass: "Titles, headings and URLs describe the same topic", issue: "Titles don't match the page heading or URL" },
  "onpage.description.present": { name: "Meta descriptions", pass: "Every page has a meta description", issue: "Some pages have no meta description" },
  "onpage.description.length": { name: "Description length", pass: "Meta descriptions fit in search results", issue: "Some meta descriptions get cut off in search results" },
  "onpage.description.unique": { name: "Duplicate descriptions", pass: "Every page has its own meta description", issue: "Several pages share the same meta description" },
  "onpage.h1.missing": { name: "Main heading (H1)", pass: "Every page has a main heading (H1)", issue: "Some pages have no main heading (H1)" },
  "onpage.h1.multiple": { name: "Single H1", pass: "Each page has a single main heading", issue: "Some pages have more than one main heading (H1)" },
  "onpage.headings.order": { name: "Heading structure", pass: "Headings follow a logical order", issue: "Headings skip levels (e.g. H1 straight to H3)" },
  "onpage.images.alt": { name: "Image alt text", pass: "Images have alt text", issue: "Images are missing alt text" },
  "onpage.thin": { name: "Thin content", pass: "Articles have enough content", issue: "Some articles are too thin (under 200 words)", info: "Some non-article pages are short (not scored)" },
  "onpage.near-duplicate": { name: "Near-duplicate pages", pass: "Every page has distinct content", issue: "Some pages are near-copies of each other" },
  "onpage.url.hygiene": { name: "URL format", pass: "URLs are short, lowercase and clean", issue: "Some URLs are messy (uppercase, underscores, too long)" },
  "onpage.lang": { name: "Page language", pass: "Homepage declares its language", issue: "Homepage doesn't declare its language" },
  "onpage.robots-nofollow": { name: "Nofollow internal links", pass: "Internal links pass ranking value", issue: "Many internal links are marked nofollow" },

  /* ---------------- Performance ---------------- */
  "perf.cwv.lcp": { name: "Largest Contentful Paint (LCP)", pass: "Main content loads fast (LCP)", issue: "Main content loads slowly (LCP)" },
  "perf.cwv.inp": { name: "Interaction to Next Paint (INP)", pass: "Page responds quickly to taps and clicks (INP)", issue: "Page is slow to respond to taps and clicks (INP)" },
  "perf.cwv.cls": { name: "Cumulative Layout Shift (CLS)", pass: "Layout stays stable while loading (CLS)", issue: "Page layout jumps around while loading (CLS)" },
  "perf.cwv.ttfb": { name: "Time to First Byte (TTFB)", pass: "Server responds quickly (TTFB)", issue: "Server is slow to respond (TTFB)" },
  "perf.lighthouse-score": { name: "Lighthouse score", pass: "Lighthouse performance score (for reference)", issue: "Lighthouse performance score is low" },
  "perf.crawl-ttfb": { name: "Server response across pages", pass: "Pages respond quickly across the site", issue: "Some pages are slow to respond" },
  "perf.lcp-element": { name: "LCP element loading", pass: "Main hero element loads efficiently", issue: "Main hero element loads inefficiently" },
  "perf.weight": { name: "Page weight", pass: "Page download size is reasonable", issue: "Pages are heavy to download" },
  "perf.render-blocking": { name: "Render-blocking files", pass: "Nothing delays the page from appearing", issue: "CSS or scripts delay the page from appearing" },
  "perf.compression": { name: "Text compression", pass: "Text files are compressed", issue: "Text files are sent uncompressed" },
  "perf.cache": { name: "Browser caching", pass: "Static files are cached by browsers", issue: "Static files aren't cached long enough" },
  "perf.images": { name: "Image optimisation", pass: "Images are optimised", issue: "Images are larger than they need to be" },
  "perf.unused-js": { name: "Unused JavaScript", pass: "Little unused JavaScript is loaded", issue: "Pages load a lot of unused JavaScript" },

  /* ---------------- Mobile Usability ---------------- */
  "mobile.viewport": { name: "Mobile viewport", pass: "Homepage is set up for mobile screens", issue: "Homepage isn't set up for mobile screens" },
  "mobile.font-size": { name: "Mobile font size", pass: "Text is readable on phones", issue: "Text is too small to read on phones" },
  "mobile.tap-targets": { name: "Tap targets", pass: "Buttons and links are easy to tap", issue: "Buttons and links are too small or too close" },
  "mobile.parity": { name: "Mobile vs desktop content", pass: "Phones get the same content as desktop", issue: "Phones get less content than desktop" },
  "mobile.images.dims": { name: "Image dimensions", pass: "Images declare width and height", issue: "Images are missing width and height" },
  "mobile.images.large": { name: "Image file size", pass: "No oversized images (over 200 KB)", issue: "Some images are too large (over 200 KB)" },
  "mobile.accessibility": { name: "Accessibility score", pass: "Lighthouse accessibility score (for reference)", issue: "Lighthouse accessibility score is low" },

  /* ---------------- Structured Data & Social ---------------- */
  "schema.jsonld.valid": { name: "Structured data (JSON-LD)", pass: "Structured data is present and valid", issue: "Structured data is missing or broken" },
  "schema.organization": { name: "Organization markup", pass: "Homepage identifies your business to Google", issue: "Homepage doesn't identify your business to Google" },
  "schema.website": { name: "WebSite markup", pass: "Homepage tells Google your site's name", issue: "Homepage doesn't tell Google your site's name" },
  "schema.breadcrumb": { name: "Breadcrumb markup", pass: "Pages have breadcrumb markup", issue: "Pages have no breadcrumb markup", info: "No breadcrumb markup yet (optional)" },
  "schema.article": { name: "Article markup", pass: "Articles are marked up as articles", issue: "Articles aren't marked up for Google" },
  "schema.product": { name: "Product markup", pass: "Product pages are marked up for Google", issue: "Product pages aren't marked up for Google" },
  "schema.deprecated": { name: "Retired rich results", pass: "FAQ and How-to markup (no longer shown by Google)", issue: "Pages rely on retired FAQ / How-to rich results" },
  "schema.og": { name: "Social sharing tags (Open Graph)", pass: "Shared links show a title, description and image", issue: "Shared links lack a proper title, description or image" },
  "schema.twitter": { name: "X/Twitter card", pass: "Links shared on X show a rich card", issue: "Links shared on X don't show a rich card" },
  "schema.favicon": { name: "Favicon", pass: "Site has a favicon", issue: "Site has no favicon" },

  /* ---------------- HTTPS & Trust ---------------- */
  "sec.https": { name: "HTTPS", pass: "Your site is served securely over HTTPS", issue: "Your site isn't served securely over HTTPS" },
  "sec.tls.expired": { name: "Certificate expiry", pass: "Security certificate has not expired", issue: "Security certificate is expired or not yet valid" },
  "sec.tls.expiring": { name: "Certificate renewal", pass: "Security certificate isn't about to expire", issue: "Security certificate expires within 30 days" },
  "sec.tls.www": { name: "Certificate coverage", pass: "Certificate covers both www and non-www", issue: "Certificate doesn't cover both www and non-www" },
  "sec.https.variants": { name: "HTTPS everywhere", pass: "Every version of your address ends up on HTTPS", issue: "Some versions of your address don't end up on HTTPS" },
  "sec.mixed-content": { name: "Mixed content", pass: "Secure pages load only secure files", issue: "Secure pages load insecure http:// files" },
  "sec.hsts": { name: "HSTS", pass: "Browsers are told to always use HTTPS", issue: "Browsers aren't told to always use HTTPS (HSTS)" },
  "sec.trust-pages": { name: "Trust pages", pass: "Privacy, terms and contact pages are linked", issue: "Privacy, terms or contact pages are missing" },
  "sec.headers": { name: "Security headers", pass: "Security headers (for reference, not scored)", issue: "Security headers are missing" },

  /* ---------------- Architecture & Internal Links ---------------- */
  "arch.depth": { name: "Click depth", pass: "Pages are within 3 clicks of the homepage", issue: "Some pages are buried more than 3 clicks deep" },
  "arch.internal-links.min": { name: "Internal links per page", pass: "Every page links to at least 3 others", issue: "Some pages are dead ends with under 3 links" },
  "arch.internal-links.bloat": { name: "Too many links", pass: "Pages keep internal links to a sensible number", issue: "Some pages have over 150 internal links" },
  "arch.generic-anchors": { name: "Link text", pass: "Link text describes where links go", issue: 'Too many links say "click here" or "read more"' },
  "arch.orphans": { name: "Orphan pages", pass: "Most sitemap pages are linked from your site", issue: "Many sitemap pages aren't linked from your site" },
  "arch.breadcrumbs": { name: "Breadcrumb navigation", pass: "Pages show a breadcrumb trail", issue: "Pages have no breadcrumb trail", info: "No breadcrumb trail yet (optional)" },
  "arch.url-depth": { name: "URL depth", pass: "Most URL paths are short", issue: "Many URLs are nested too deep" },
  "arch.nav-consistency": { name: "Consistent navigation", pass: "Navigation is the same on every page", issue: "Navigation changes from page to page" },

  /* ---------------- Authority & Backlinks(付费) ---------------- */
  "auth.referring-domains": { name: "Referring domains", pass: "Plenty of other sites link to you", issue: "Too few other sites link to you" },
  "auth.rank": { name: "Domain rank", pass: "Your domain has meaningful link authority", issue: "Your domain has little link authority" },
  "auth.spam-score": { name: "Backlink spam score", pass: "Your backlinks look clean", issue: "Many of your backlinks look spammy" },
  "auth.nofollow-share": { name: "Nofollow backlinks", pass: "Nofollow backlinks are a healthy share", issue: "Most backlinks are nofollow and pass no ranking value" },
  "auth.broken": { name: "Broken backlinks", pass: "Backlinks point to live pages", issue: "Some backlinks point to pages that no longer exist" },
  "auth.anchors": { name: "Anchor text diversity", pass: "Link anchor text looks natural", issue: "One keyword dominates your link anchor text" },
  "auth.trend": { name: "Referring-domain trend", pass: "Linking sites are holding steady or growing", issue: "You're losing linking sites faster than gaining them" },

  /* ---------------- Search Visibility(付费) ---------------- */
  "vis.keywords": { name: "Ranking keywords", pass: "You rank for a broad set of keywords", issue: "You rank for very few keywords" },
  "vis.top10": { name: "Top-10 rankings", pass: "Many keywords rank on Google's first page", issue: "Few keywords reach Google's first page" },
  "vis.etv": { name: "Estimated organic traffic", pass: "Google sends you meaningful traffic", issue: "Google sends you little traffic" },
  "vis.quick-wins": { name: "Quick-win keywords", pass: "Keywords within reach of the top 3", issue: "Keywords stuck just below the top results" },
  "vis.movement": { name: "Ranking movement", pass: "New keywords keep pace with lost ones", issue: "You're losing more keywords than you gain" },
  "vis.index-ratio": { name: "Indexed pages vs sitemap", pass: "Google shows most of your sitemap pages", issue: "Many sitemap pages aren't in Google's index" },
  "vis.brand-share": { name: "Brand vs non-brand keywords", pass: "Brand vs non-brand share of your rankings", issue: "Most rankings come from people searching your name" },
  "vis.ai-overview-share": { name: "AI Overview exposure", pass: "How often your keywords trigger an AI Overview", issue: "AI Overviews push your results down the page" },

  /* ---------------- Competitors(付费) ---------------- */
  "comp.gap": { name: "Traffic gap", pass: "You're in the same league as your top competitor", issue: "Your top competitor gets far more search traffic" },
  "comp.list": { name: "Top competitors", pass: "Sites competing with you in Google", issue: "Competitors outrank you for your keywords" },
};

/** 随状态变化的标题:fail/warn → 问题句;info → info 专属句(没有则达标句);pass/na → 达标句。
 *  表里没有的 id(不该发生,titles.test.ts 会拦)退回 id 本身,至少不显示空标题。 */
export function checkTitle(id: string, status: CheckStatus): string {
  const t = CHECK_TITLES[id];
  if (!t) return id;
  if (status === "fail" || status === "warn") return t.issue;
  if (status === "info") return t.info ?? t.pass;
  return t.pass;
}

/** 中性名称(不随状态变化) */
export function checkName(id: string): string {
  return CHECK_TITLES[id]?.name ?? id;
}
