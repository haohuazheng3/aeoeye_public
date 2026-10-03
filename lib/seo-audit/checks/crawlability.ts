/* ============================================================
   Crawlability & Indexing(权重 25)—— 含两道前置门 + 4 个 gate 项

   这一维度是整份报告的地基:Google 抓不到、收不进,后面所有优化都白做。
   所以致命项(入口非 200 / 入口 noindex / robots 全禁)标 gate,
   score.ts 会据此把维度封顶 30、总分封顶 40。
   所有 v2 探针字段(probe.blocked / robotsMeta / sitemapSample …)都可能
   缺失 —— 缺了就 na 并说明,绝不把"没测"当"没问题"或"有问题"。
   ============================================================ */

import type { CrawledPage, SeoCheck, UrlVariant } from "../types";
import {
  check,
  na,
  pageCheck,
  okPages,
  hasNoindex,
  isToolPath,
  isAbsoluteUrl,
  urlKey,
  hostOf,
  pathOf,
  listPaths,
  pct,
  uniq,
  parseDate,
  daysSince,
  blockedNote,
  usableEntry,
  entryNaNote,
  tlsFailure,
  missingAltHost,
  realVariants,
  DOCS,
  type CheckContext,
} from "./helpers";

const D = "crawlability" as const;

/* ---------- 变体辅助 ---------- */
function variantKind(v: UrlVariant): string {
  if (v.kind) return v.kind;
  const https = /^https:\/\//i.test(v.url);
  const www = /^https?:\/\/www\./i.test(v.url);
  return `${https ? "https" : "http"}-${www ? "www" : "apex"}`;
}

function variantFinal(v: UrlVariant): string | null {
  if (v.finalUrl) return v.finalUrl;
  if (v.chain && v.chain.length > 1) return v.chain[v.chain.length - 1];
  if (v.location) return v.location;
  if (v.status === 200) return v.url;
  return null;
}

function variantHops(v: UrlVariant): number {
  if (Array.isArray(v.hops)) return v.hops.length;
  if (Array.isArray(v.chain) && v.chain.length > 0) return Math.max(0, v.chain.length - 1);
  return v.status !== null && v.status >= 300 && v.status < 400 ? 1 : 0;
}

function describeChain(v: UrlVariant): string {
  const hops = Array.isArray(v.hops) && v.hops.length ? ` [${v.hops.join(" → ")}]` : "";
  const chain = Array.isArray(v.chain) && v.chain.length > 1 ? v.chain.join(" → ") : `${v.url} → ${variantFinal(v) ?? "(no response)"}`;
  return `${chain}${hops}`;
}

/** 另一主机(www ↔ 裸域)DNS 不存在时补一句证据,说明它为什么没参与判定 */
function altHostLine(alt: string | null, dropped: number): string[] {
  return alt && dropped > 0 ? [`${alt} has no DNS record, so its ${dropped} variant(s) are left out — a host that does not exist needs no redirect.`] : [];
}

export function checkCrawlability(ctx: CheckContext): SeoCheck[] {
  const { probe, entry } = ctx;
  const pages = okPages(ctx);
  const blocked = blockedNote(ctx);
  // 内容类的入口判断只认"读得出内容"的入口(200 + HTML);入口失败时给出具体原因而不是假结论
  const e0 = usableEntry(ctx);
  const entryNa = entryNaNote(ctx);
  const tlsFail = tlsFailure(probe);
  const entryErr = probe.entryError ?? null;
  const out: SeoCheck[] = [];
  const r = probe.robots;
  const rm = probe.robotsMeta;
  const mainKey = urlKey(entry?.finalUrl || probe.entryUrl);

  /* ---------- crawl.blocked:门 0,WAF / 挑战页 ---------- */
  if (entryErr?.kind === "tls" || probe.blocked?.kind === "tls") {
    // 证书失败发生在发出任何 HTTP 请求之前,与防火墙无关;旧数据里记成 blocked.kind="tls" 的也走这里(复审 C20)
    out.push(na("crawl.blocked", D, "critical", `Not applicable: the connection to ${probe.entryUrl} failed at the certificate check (${tlsFail?.message ?? entryErr?.message ?? "TLS handshake failed"}). That is a certificate problem, not a firewall — see the HTTPS checks.`, { docs: DOCS.crawlers }));
  } else if (probe.blocked === undefined) {
    out.push(na("crawl.blocked", D, "critical", "Not measured: firewall / challenge-page detection did not run in this audit.", { docs: DOCS.crawlers }));
  } else if (probe.blocked.detected) {
    out.push(
      check({
        id: "crawl.blocked",
        dimension: D,
        status: "fail",
        severity: "critical",
        evidence: [
          `Our crawler was stopped before it could read ${probe.entryUrl} (${probe.blocked.kind ?? "unknown"}): ${probe.blocked.evidence || "no details"}.`,
          "Every check that depends on crawling is reported as not measured for this run.",
        ],
        fix: `Allow the user agent "AEOeyeBot/1.0 (+https://aeoeye.com/bot)" in your WAF / bot-management rules (Cloudflare, Vercel Firewall, Akamai, AWS WAF), then re-run the audit. Verify with: curl -A "Mozilla/5.0 (compatible; AEOeyeBot/1.0; +https://aeoeye.com/bot)" -I ${probe.entryUrl} — expect HTTP 200 and an HTML content-type, not 403 or a challenge page. Also confirm Googlebot is not caught by the same rule (Search Console → Settings → Crawl stats).`,
        effort: "low",
        docs: DOCS.crawlers,
      }),
    );
  } else if (entryErr) {
    // 入口根本没回响应(DNS / 超时 / 拒连):没法判断有没有防火墙,不能写"没被拦"
    out.push(na("crawl.blocked", D, "critical", `Not measured: ${probe.entryUrl} did not respond (${entryErr.kind}: ${entryErr.message}), so we could not tell whether a firewall is involved.`, { docs: DOCS.crawlers }));
  } else {
    out.push(
      check({
        id: "crawl.blocked",
        dimension: D,
        status: "pass",
        severity: "critical",
        evidence: [entry && entry.status ? `${probe.entryUrl} answered HTTP ${entry.status} — no firewall block, challenge page or 403.` : `No firewall block, challenge page or 403 was detected at ${probe.entryUrl}.`],
        fix: "",
        effort: "low",
        docs: DOCS.crawlers,
      }),
    );
  }

  /* ---------- crawl.js-dependent:门 1,JS 渲染依赖 ---------- */
  const jsDependent: boolean | undefined = blocked ? undefined : probe.jsDependent ?? e0?.jsShell;
  if (jsDependent === undefined) {
    out.push(na("crawl.js-dependent", D, "high", blocked ?? (e0 ? "Not measured: JavaScript-rendering dependency was not probed in this run." : entryNa), { docs: DOCS.javascript }));
  } else if (jsDependent) {
    out.push(
      check({
        id: "crawl.js-dependent",
        dimension: D,
        status: "warn",
        severity: "high",
        evidence: [
          `The raw HTML of ${probe.entryUrl} is a JavaScript shell: ${e0?.wordCount ?? 0} visible words and ${e0?.internalLinks ?? 0} internal links before scripts run${e0?.h1s?.length ? "" : ", no <h1>"}.`,
          "Checks that need the rendered page (headings, image alt text, word counts, near-duplicates) skip JavaScript-shell pages and are marked not measured when no other page is left; titles, descriptions and other <head> tags are still checked in the raw HTML.",
        ],
        fix: `Server-render or pre-render the main content, <title>, headings and internal links so they exist in the initial HTML (Next.js/Nuxt SSR, static export, or a prerender service). Verify with: curl -s ${probe.entryUrl} | grep -c "<h1" — expect at least 1, and "View source" should show your body text. Google can render JavaScript but queues it; GPTBot, ClaudeBot and PerplexityBot do not execute JavaScript at all.`,
        effort: "high",
        docs: DOCS.javascript,
      }),
    );
  } else {
    out.push(
      check({
        id: "crawl.js-dependent",
        dimension: D,
        status: "pass",
        severity: "high",
        evidence: [`The raw HTML of ${probe.entryUrl} already contains ${e0?.wordCount ?? 0} visible words and ${e0?.internalLinks ?? 0} internal links — no client-side rendering dependency.`],
        effort: "low",
        docs: DOCS.javascript,
      }),
    );
  }

  /* ---------- crawl.robots.exists ---------- */
  {
    const id = "crawl.robots.exists";
    const size = r.bytes ? `${Math.round(r.bytes / 1024)} KiB` : "0 B";
    if (r.status === null) {
      out.push(
        check({
          id, dimension: D, status: "fail", severity: "high",
          evidence: [`${r.url} could not be fetched (${r.error ?? "timeout or network error"}). Google treats an unreachable robots.txt (5xx / timeout) as "do not crawl anything on this site".`],
          fix: `Make ${r.url} return HTTP 200 (or 404 if you intentionally have none) within a few seconds. Verify with: curl -I ${r.url} — expect 200 and content-type text/plain.`,
          effort: "low", docs: DOCS.robotsIntro,
        }),
      );
    } else if (r.status >= 500) {
      out.push(
        check({
          id, dimension: D, status: "fail", severity: "high",
          evidence: [`${r.url} returned HTTP ${r.status}. Google treats a 5xx robots.txt as "do not crawl the site" until it recovers.`],
          fix: `Fix the server error on ${r.url} (serve a static file). Verify with: curl -I ${r.url} — expect HTTP 200.`,
          effort: "low", docs: DOCS.robotsIntro,
        }),
      );
    } else if (r.status === 404) {
      out.push(
        check({
          id, dimension: D, status: "warn", severity: "low",
          evidence: [`${r.url} returned HTTP 404. That is allowed (everything is crawlable) but you lose the Sitemap: hint and any AI-crawler policy.`],
          fix: `Add a robots.txt at ${r.url} with at least a Sitemap: line, e.g. "User-agent: *\nAllow: /\nSitemap: ${probe.origin}/sitemap.xml". Verify with: curl ${r.url}.`,
          effort: "low", docs: DOCS.robotsCreate,
        }),
      );
    } else if (r.status === 200 && rm?.isHtml === true) {
      out.push(
        check({
          id, dimension: D, status: "fail", severity: "low",
          evidence: [`${r.url} returned HTTP 200 but the body is HTML (content-type ${rm.contentType ?? "unknown"}) — a soft-200 page, not a robots file. Crawlers cannot parse it.`],
          fix: `Serve a real text/plain robots.txt at ${r.url}; on SPA hosts make sure the catch-all route does not swallow /robots.txt. Verify with: curl -s ${r.url} | head -3 — the first line should be "User-agent:".`,
          effort: "low", docs: DOCS.robotsCreate,
        }),
      );
    } else if (r.status === 200 && r.bytes > 500 * 1024) {
      out.push(
        check({
          id, dimension: D, status: "warn", severity: "low",
          evidence: [`${r.url} is ${size}; Google only reads the first 500 KiB of a robots.txt and ignores the rest.`],
          fix: "Trim robots.txt below 500 KiB (consolidate patterns with wildcards). Verify with: curl -sI robots.txt | grep -i content-length.",
          effort: "low", docs: DOCS.robotsIntro,
        }),
      );
    } else if (r.status === 200) {
      out.push(
        check({
          id, dimension: D, status: "pass", severity: "low",
          evidence: [`${r.url} returned HTTP 200 (${size}${rm?.contentType ? `, ${rm.contentType}` : ""}) with ${r.sitemaps.length} Sitemap: line(s).`],
          effort: "low", docs: DOCS.robotsIntro,
        }),
      );
    } else {
      out.push(
        check({
          id, dimension: D, status: "warn", severity: "low",
          evidence: [`${r.url} returned HTTP ${r.status}${r.error ? ` (${r.error})` : ""}. Google treats 3xx as following the redirect and other 4xx as "no restrictions", but a plain 200 is safer.`],
          fix: `Serve robots.txt directly with HTTP 200 at ${r.url}. Verify with: curl -I ${r.url}.`,
          effort: "low", docs: DOCS.robotsIntro,
        }),
      );
    }
  }

  /* ---------- crawl.robots.blocks-site(gate) ---------- */
  {
    const id = "crawl.robots.blocks-site";
    const gbAll = rm?.googlebotDisallowAll;
    const fix = `Open ${r.url} and remove the "Disallow: /" line (or the rule matching ${pathOf(probe.entryUrl)}) for User-agent: * and User-agent: Googlebot. Verify with Search Console → Settings → robots.txt report, or curl ${r.url} — no group that applies to Googlebot may contain "Disallow: /".`;
    if (!r.found) {
      out.push(check({ id, dimension: D, status: "pass", severity: "critical", gate: true, evidence: ["No robots.txt found, so nothing is blocked."], effort: "low", docs: DOCS.robotsIntro }));
    } else if (gbAll === true) {
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`${r.url} contains "Disallow: /" in a group that applies to Googlebot. Google will not crawl any page of ${probe.host}.`], fix, effort: "low", docs: DOCS.robotsIntro }));
    } else if (r.disallowAll) {
      if (gbAll === false) {
        out.push(check({ id, dimension: D, status: "info", severity: "critical", gate: true, evidence: [`${r.url} blocks all paths for "User-agent: *" (which stops AEOeyeBot) but a dedicated Googlebot group allows crawling. We could not crawl the site; Google can.`], fix: `If you want third-party SEO/AI crawlers to see the site, allow AEOeyeBot in ${r.url}. Otherwise no action is needed for Google.`, effort: "low", docs: DOCS.robotsIntro }));
      } else {
        out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`${r.url} contains "Disallow: /" for User-agent: * and no Googlebot group overrides it. Google will not crawl any page of ${probe.host}.`], fix, effort: "low", docs: DOCS.robotsIntro }));
      }
    } else if (r.blocksEntry) {
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`${r.url} disallows the entry path ${pathOf(probe.entryUrl)} for our crawler. Unless a Googlebot-specific group allows it, Google is blocked from your most important page too.`], fix, effort: "low", docs: DOCS.robotsIntro }));
    } else {
      out.push(check({ id, dimension: D, status: "pass", severity: "critical", gate: true, evidence: [`${r.url} allows the entry path ${pathOf(probe.entryUrl)} and contains no site-wide "Disallow: /".`], effort: "low", docs: DOCS.robotsIntro }));
    }
  }

  /* ---------- crawl.robots.resources ---------- */
  {
    const id = "crawl.robots.resources";
    if (!rm || !Array.isArray(rm.blocksResources)) {
      out.push(na(id, D, "high", blocked ?? "Not measured: robots.txt was not matched against the entry page's script and stylesheet URLs in this run.", { docs: DOCS.robotsIntro }));
    } else if (rm.blocksResources.length === 0) {
      out.push(check({ id, dimension: D, status: "pass", severity: "high", evidence: [`None of the same-host scripts and stylesheets on ${probe.entryUrl} are disallowed by robots.txt, so Google can render the page as users see it.`], effort: "low", docs: DOCS.robotsIntro }));
    } else {
      out.push(
        check({
          id, dimension: D, status: "fail", severity: "high",
          evidence: [`${rm.blocksResources.length} render-critical resource(s) on ${probe.entryUrl} are disallowed by robots.txt: ${rm.blocksResources.slice(0, 10).map(pathOf).join(", ")}.`, "Google renders pages to evaluate layout and mobile-friendliness; blocked CSS/JS makes the page look broken to Googlebot."],
          fix: `Remove the Disallow rules that match those paths in ${r.url} (typically /assets/, /_next/, /static/, /wp-includes/). Verify with Search Console → URL Inspection → Test live URL → "More info → Page resources": no resource should be listed as blocked.`,
          effort: "low", docs: DOCS.robotsIntro,
          affected: rm.blocksResources.slice(0, 10),
        }),
      );
    }
  }

  /* ---------- crawl.robots.sitemap-directive ---------- */
  {
    const id = "crawl.robots.sitemap-directive";
    const has = rm?.hasSitemapDirective ?? r.sitemaps.length > 0;
    if (!r.found) {
      out.push(check({ id, dimension: D, status: "warn", severity: "low", evidence: ["There is no robots.txt, so there is no Sitemap: directive for crawlers that do not know your sitemap URL."], fix: `Create ${r.url} with "Sitemap: ${probe.origin}/sitemap.xml". Verify with: curl ${r.url} | grep -i sitemap.`, effort: "low", docs: DOCS.sitemaps }));
    } else if (has) {
      out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`robots.txt declares ${r.sitemaps.length || 1} sitemap(s): ${r.sitemaps.slice(0, 3).join(", ") || "(directive present)"}.`], effort: "low", docs: DOCS.sitemaps }));
    } else {
      out.push(check({ id, dimension: D, status: "warn", severity: "low", evidence: [`${r.url} has no "Sitemap:" line. Google, Bing and AI crawlers that read robots.txt cannot discover your sitemap from it.`], fix: `Append "Sitemap: ${probe.origin}/sitemap.xml" (absolute URL) to ${r.url}. Verify with: curl ${r.url} | grep -i sitemap.`, effort: "low", docs: DOCS.sitemaps }));
    }
  }

  /* ---------- crawl.robots.ai-crawlers(info,交叉销售入口) ---------- */
  {
    const id = "crawl.robots.ai-crawlers";
    // 检索类(决定能不能被 AI 回答引用)与训练类(只决定进不进训练语料)要分开说 —— ClaudeBot / GPTBot 是训练爬虫,
    // 屏蔽它们不影响被 Claude / ChatGPT 引用;反过来屏蔽检索类才会让站点从 AI 回答里消失
    const crossSell = "Decide deliberately: to be cited in ChatGPT, Claude and Perplexity answers, allow their search crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User); GPTBot, ClaudeBot, Google-Extended and CCBot only control whether your content is used for AI training. Then run AEOeye's free AI visibility audit (https://aeoeye.com/) to see whether those assistants actually recommend your brand when buyers ask.";
    if (!rm || !rm.aiCrawlers) {
      out.push(na(id, D, "low", blocked ?? "Not measured: AI-crawler directives were not parsed in this run.", { docs: DOCS.crawlers, fix: crossSell }));
    } else {
      const entries = Object.entries(rm.aiCrawlers);
      const blockedBots = entries.filter(([, v]) => v === "disallow").map(([k]) => k);
      out.push(
        check({
          id, dimension: D, status: "info", severity: "low",
          evidence: [
            `robots.txt policy for AI crawlers: ${entries.map(([k, v]) => `${k}: ${v}`).join(" · ")}.`,
            blockedBots.length
              ? `${blockedBots.length} AI crawler(s) are blocked (${blockedBots.join(", ")}) — those assistants cannot fetch your pages to cite them.`
              : "No AI crawler is explicitly blocked; unspecified bots fall back to the User-agent: * rules.",
          ],
          fix: crossSell,
          effort: "low", docs: DOCS.crawlers,
        }),
      );
    }
  }

  /* ---------- crawl.sitemap.found / valid ---------- */
  // 索引行(isIndex)只是目录:sitemap.ts 把已读子文件的条数汇总写回索引行,而子文件行本身也在数组里。
  // 所以 URL 合计与 5 万上限只能看叶子文件,否则同一批 URL 算两遍,索引的汇总值还会被误报成
  // "单个文件超限"(复审 C18)。索引行只用于判定"站点有 sitemap"——纯索引站也算有。
  const sitemaps = probe.sitemaps ?? [];
  const usable = sitemaps.filter((s) => s.status === 200 && s.valid && (s.urlCount > 0 || s.isIndex));
  const leafUrls = (rows: typeof sitemaps) => rows.filter((s) => !s.isIndex).reduce((n, s) => n + s.urlCount, 0);
  {
    const id = "crawl.sitemap.found";
    if (usable.length) {
      const leaves = usable.filter((s) => !s.isIndex);
      const indexes = usable.filter((s) => s.isIndex);
      // 索引只展开前几个子文件:没读到的子文件要说出来,否则读者会把下界当成全站总数
      const read = new Set(sitemaps.map((s) => urlKey(s.url)));
      const unread = uniq(indexes.flatMap((s) => s.children ?? []).map(urlKey)).filter((k) => !read.has(k)).length;
      const found = [
        leaves.length ? `${leaves.length} sitemap file(s) listing ${leafUrls(leaves)} URLs` : null,
        indexes.length ? `${indexes.length} sitemap index file(s)` : null,
      ].filter(Boolean).join(" and ");
      out.push(
        check({
          id, dimension: D, status: "pass", severity: "high",
          evidence: [
            `Found ${found}: ${usable.slice(0, 3).map((s) => s.url).join(", ")}.`,
            ...(unread ? [`The sitemap index lists ${unread} more child sitemap(s) that were not read, so the real URL count is higher.`] : []),
          ],
          effort: "low", docs: DOCS.sitemaps,
        }),
      );
    } else {
      const tried = sitemaps.length ? sitemaps.slice(0, 4).map((s) => `${s.url} → ${s.status ?? "no response"}${s.error ? ` (${s.error})` : ""}`).join("; ") : `${probe.origin}/sitemap.xml and ${probe.origin}/sitemap_index.xml`;
      out.push(
        check({
          id, dimension: D, status: "fail", severity: "high",
          evidence: [`No usable XML sitemap. Tried: ${tried}.`, "Without a sitemap Google discovers pages only by following links, so deep or new pages are found late or never."],
          fix: `Generate an XML sitemap listing every indexable canonical URL (most frameworks and CMSs have a plugin; in Next.js use app/sitemap.ts), serve it at ${probe.origin}/sitemap.xml, reference it in robots.txt and submit it in Search Console → Sitemaps. Verify with: curl -s ${probe.origin}/sitemap.xml | head -5 — expect <urlset> or <sitemapindex>.`,
          effort: "low", docs: DOCS.sitemaps,
        }),
      );
    }
  }
  {
    const id = "crawl.sitemap.valid";
    const fetched = sitemaps.filter((s) => s.status === 200);
    if (sitemaps.length === 0 || fetched.length === 0) {
      out.push(na(id, D, "medium", "Not applicable: no sitemap file was fetched (see the sitemap check above).", { docs: DOCS.sitemaps }));
    } else {
      const invalid = fetched.filter((s) => !s.valid || (!s.isIndex && s.urlCount === 0));
      // 5 万条是"单个 urlset 文件"的上限;索引行的 urlCount 是子文件合计,不能拿来比
      const leaves = fetched.filter((s) => !s.isIndex);
      const huge = leaves.filter((s) => s.urlCount > 50_000);
      if (huge.length) {
        out.push(check({ id, dimension: D, status: "fail", severity: "medium", evidence: [`${huge.length} sitemap file(s) exceed the 50,000-URL limit: ${huge.map((s) => `${s.url} (${s.urlCount} URLs)`).join(", ")}. Google ignores entries past the limit.`], fix: "Split large sitemaps into files of ≤50,000 URLs / ≤50 MB uncompressed and list them in a sitemap index. Verify by re-submitting in Search Console → Sitemaps (status should be Success).", effort: "medium", docs: DOCS.sitemapsLarge, affected: huge.map((s) => s.url) }));
      } else if (invalid.length && invalid.length === fetched.length) {
        out.push(check({ id, dimension: D, status: "fail", severity: "medium", evidence: [`All ${fetched.length} fetched sitemap file(s) failed to parse or list zero URLs: ${invalid.map((s) => `${s.url}${s.error ? ` (${s.error})` : ""}`).join(", ")}.`], fix: "Serve well-formed XML (UTF-8, <urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">, absolute <loc> URLs). Verify with: xmllint --noout sitemap.xml and Search Console → Sitemaps.", effort: "low", docs: DOCS.sitemaps, affected: invalid.map((s) => s.url) }));
      } else if (invalid.length) {
        out.push(check({ id, dimension: D, status: "warn", severity: "medium", evidence: [`${invalid.length} of ${fetched.length} sitemap file(s) failed to parse or list zero URLs: ${invalid.map((s) => s.url).join(", ")}.`], fix: "Fix or remove the broken sitemap files and keep only valid ones in the index. Verify in Search Console → Sitemaps: every file should show Success with a URL count.", effort: "low", docs: DOCS.sitemaps, affected: invalid.map((s) => s.url) }));
      } else {
        const largest = leaves.length ? Math.max(...leaves.map((s) => s.urlCount)) : 0;
        out.push(check({ id, dimension: D, status: "pass", severity: "medium", evidence: [`${fetched.length} sitemap file(s) parsed successfully (${leafUrls(fetched)} URLs${leaves.length ? `; largest file ${largest} URLs` : ""}, limit 50,000 per file).`], effort: "low", docs: DOCS.sitemaps }));
      }
    }
  }

  /* ---------- crawl.sitemap.sample(page) ---------- */
  {
    const id = "crawl.sitemap.sample";
    const sample = probe.sitemapSample;
    if (!Array.isArray(sample)) {
      out.push(na(id, D, "high", blocked ?? "Not measured: sitemap URLs were not sampled for indexability in this run.", { docs: DOCS.sitemaps, scope: "page" }));
    } else {
      const bad = sample.filter((s) => s.status !== 200 || s.noindex || s.sameHost === false || (s.canonical && urlKey(s.canonical) !== urlKey(s.url)));
      const reasons = {
        non200: sample.filter((s) => s.status !== 200).length,
        noindex: sample.filter((s) => s.status === 200 && s.noindex).length,
        canon: sample.filter((s) => s.status === 200 && !s.noindex && s.canonical && urlKey(s.canonical) !== urlKey(s.url)).length,
        host: sample.filter((s) => s.sameHost === false).length,
      };
      out.push(
        pageCheck({
          id, dimension: D, severity: "high",
          universe: sample.map((s) => s.url),
          affected: bad.map((s) => s.url),
          unit: "sampled sitemap URLs",
          what: `are not indexable (${reasons.non200} non-200, ${reasons.noindex} noindex, ${reasons.canon} canonicalised elsewhere, ${reasons.host} on another host)`,
          fix: "A sitemap must list only canonical, 200, indexable URLs — anything else wastes crawl budget and makes Google distrust the file. Remove redirected, 404, noindex and non-canonical entries (or fix the pages). Verify in Search Console → Pages → \"Submitted URL … \" errors should drop to 0.",
          docs: DOCS.sitemaps, effort: "low",
          extra: bad.slice(0, 5).map((s) => `${pathOf(s.url)}: ${s.status === 200 ? (s.noindex ? "noindex" : s.sameHost === false ? "different host" : `canonical → ${s.canonical}`) : `HTTP ${s.status ?? "no response"}`}`),
          naNote: "Not applicable: the sitemap sample was empty.",
        }),
      );
    }
  }

  /* ---------- crawl.sitemap.lastmod ---------- */
  {
    const id = "crawl.sitemap.lastmod";
    const leaf = usable.filter((s) => !s.isIndex && s.urlCount > 0);
    if (!leaf.length) {
      out.push(na(id, D, "low", "Not applicable: no sitemap with URL entries was found.", { docs: DOCS.sitemaps }));
    } else {
      const total = leaf.reduce((n, s) => n + s.urlCount, 0);
      const withLm = leaf.reduce((n, s) => n + s.urlCount * (s.lastmodShare ?? 0), 0);
      const share = total ? withLm / total : 0;
      const status = share >= 0.8 ? "pass" : share >= 0.3 ? "warn" : "fail";
      out.push(
        check({
          id, dimension: D, status, severity: "low",
          evidence: [`${Math.round(share * 100)}% of ${total} sitemap URLs have a <lastmod> value (Google uses it to prioritise re-crawls when it is accurate).`],
          fix: status === "pass" ? "" : "Emit an accurate <lastmod> (ISO 8601, the real content change date — not the build time) for every URL. Verify with: curl -s sitemap.xml | grep -c '<lastmod>' — should equal the number of <url> entries.",
          effort: "low", docs: DOCS.sitemaps,
        }),
      );
    }
  }

  /* ---------- crawl.freshness ---------- */
  {
    const id = "crawl.freshness";
    const dated = pages
      .map((p) => ({ p, d: parseDate(p.lastModified) }))
      .filter((x): x is { p: CrawledPage; d: Date } => x.d !== null);
    const newestSitemap = sitemaps.map((s) => parseDate(s.newestLastmod)).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    if (!dated.length && !newestSitemap) {
      out.push(na(id, D, "low", blocked ?? "Not measured: no Last-Modified header, dateModified or sitemap lastmod was available for the crawled pages.", { docs: DOCS.helpfulContent }));
    } else if (dated.length) {
      const stale = dated.filter((x) => daysSince(x.d) > 365);
      const share = stale.length / dated.length;
      out.push(
        check({
          id, dimension: D, status: share > 0.5 ? "warn" : "pass", severity: "low",
          evidence: [
            `Across ${dated.length} crawled pages with a known modification date, ${stale.length} (${pct(stale.length, dated.length)}%) were last updated more than 365 days ago${stale.length ? `: ${listPaths(stale.map((x) => x.p.url))}` : ""}.`,
            newestSitemap ? `Newest sitemap lastmod: ${newestSitemap.toISOString().slice(0, 10)}.` : "No sitemap lastmod available.",
          ],
          fix: share > 0.5 ? "Review the stale pages: update facts, screenshots and dates, then bump dateModified / lastmod only when the content really changed. Verify by re-crawling — the share of pages older than 365 days should fall below 50%." : "",
          effort: "medium", docs: DOCS.helpfulContent,
          affected: stale.map((x) => x.p.url), scope: "page",
        }),
      );
    } else if (newestSitemap) {
      const age = daysSince(newestSitemap);
      out.push(check({ id, dimension: D, status: age > 365 ? "warn" : "pass", severity: "low", evidence: [`Newest sitemap lastmod is ${newestSitemap.toISOString().slice(0, 10)} (${age} days ago); pages exposed no modification dates.`], fix: age > 365 ? "Update your most important pages and reflect real change dates in lastmod. Verify: the newest lastmod should be within the last year." : "", effort: "medium", docs: DOCS.helpfulContent }));
    }
  }

  /* ---------- crawl.entry.status(gate) ---------- */
  {
    const id = "crawl.entry.status";
    // 没拿到 HTTP 响应时写清原因(证书 / DNS / 超时),证书问题给"先修证书"的修法,而不是笼统的"检查主机"
    const noResponse = entryErr ? `no response (${entryErr.kind === "tls" ? "certificate error" : entryErr.kind}: ${entryErr.message})` : "no response";
    const tlsFix = tlsFail ? `Fix the HTTPS certificate first (see HTTPS & Trust: ${tlsFail.message}) — browsers and Googlebot refuse to load ${probe.entryUrl} until it is valid. Verify with: curl -I ${probe.entryUrl} — expect HTTP 200 and no certificate error.` : null;
    if (!entry) {
      out.push(blocked ? na(id, D, "critical", blocked, { gate: true, docs: DOCS.httpErrors }) : check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`${probe.entryUrl} could not be fetched: ${entryErr ? noResponse : "no response or network error"}.`], fix: tlsFix ?? `Make ${probe.entryUrl} respond with HTTP 200 within 8 seconds. Verify with: curl -I ${probe.entryUrl}.`, effort: "medium", docs: DOCS.httpErrors }));
    } else if (entry.status === 200 && (entry.redirects ?? 0) === 0) {
      out.push(check({ id, dimension: D, status: "pass", severity: "critical", gate: true, evidence: [`GET ${entry.url} → HTTP 200 in ${entry.fetchedMs} ms, ${Math.round(entry.bytes / 1024)} KB of HTML.`], effort: "low", docs: DOCS.httpErrors }));
    } else if (entry.status === 200) {
      out.push(check({ id, dimension: D, status: "warn", severity: "critical", gate: true, evidence: [`GET ${entry.url} reached HTTP 200 only after ${entry.redirects} redirect(s) → ${entry.finalUrl}.`], fix: `Use the final URL (${entry.finalUrl}) everywhere: sitemap, canonical, internal links and Search Console property. Verify with: curl -I ${entry.url} — a single 301 to the final URL is fine, chains are not.`, effort: "low", docs: DOCS.redirects }));
    } else {
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`GET ${entry.url} → ${entry.status ? `HTTP ${entry.status}` : noResponse}${entry.redirects ? ` after ${entry.redirects} redirect(s) → ${entry.finalUrl}` : ""}. Google cannot index a page that does not return 200.`], fix: (!entry.status && tlsFix) || `Restore ${entry.url} to HTTP 200 (check hosting, DNS, redirects and error pages). Verify with: curl -I ${entry.url} — expect "HTTP/2 200".`, effort: "medium", docs: DOCS.httpErrors }));
    }
  }

  /* ---------- crawl.entry.indexable(gate) ---------- */
  {
    const id = "crawl.entry.indexable";
    // 入口没读到(非 200 / 证书失败)时不能写"没有 noindex"——那是没看,不是没有
    if (!e0) {
      out.push(na(id, D, "critical", entryNa, { gate: true, docs: DOCS.blockIndexing }));
    } else if (hasNoindex(e0)) {
      const src = /noindex/i.test(e0.xRobotsTag ?? "") ? `X-Robots-Tag header "${e0.xRobotsTag}"` : `<meta name="robots" content="${e0.robotsMeta ?? "noindex"}">`;
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`${e0.finalUrl} carries ${src}. Google will drop this page from its index.`], fix: `Remove the noindex directive from ${e0.finalUrl} (meta robots tag and/or X-Robots-Tag header; in Next.js check metadata.robots, in WordPress Settings → Reading → "Discourage search engines"). Verify with: curl -sI ${e0.finalUrl} | grep -i x-robots and view-source for <meta name="robots">, then Search Console → URL Inspection should say "URL is available to Google".`, effort: "low", docs: DOCS.blockIndexing }));
    } else {
      out.push(check({ id, dimension: D, status: "pass", severity: "critical", gate: true, evidence: [`${e0.finalUrl} has no noindex in <meta name="robots">${e0.robotsMeta ? ` (value: "${e0.robotsMeta}")` : ""} or X-Robots-Tag.`], effort: "low", docs: DOCS.blockIndexing }));
    }
  }

  /* ---------- crawl.pages.noindex(page) ---------- */
  {
    const universe = pages.filter((p) => !isToolPath(p.url));
    const affected = universe.filter(hasNoindex).map((p) => p.url);
    const sitemapNoindex = (probe.sitemapSample ?? []).filter((s) => s.noindex).map((s) => s.url);
    out.push(
      pageCheck({
        id: "crawl.pages.noindex", dimension: D, severity: "high",
        universe: universe.map((p) => p.url), affected,
        what: "carry a noindex directive (login/cart/search/account paths excluded)",
        fix: "Keep noindex only on utility pages. For every page listed here that should rank, remove the meta robots noindex / X-Robots-Tag; if it is intentionally hidden, also remove it from the sitemap and internal navigation. Verify with Search Console → Pages → \"Excluded by noindex tag\".",
        docs: DOCS.blockIndexing, effort: "low",
        forceStatus: sitemapNoindex.length ? "fail" : undefined,
        extra: sitemapNoindex.length ? [`${sitemapNoindex.length} sampled sitemap URL(s) are noindex — a direct contradiction (the sitemap says "index me", the page says "don't"): ${listPaths(sitemapNoindex)}.`] : [],
        naNote: blocked ?? "Not measured: no crawled pages.",
      }),
    );
  }

  /* ---------- crawl.noindex-robots-conflict ---------- */
  {
    const id = "crawl.noindex-robots-conflict";
    const noindexPages = pages.filter(hasNoindex);
    const robotsAll = r.disallowAll || rm?.googlebotDisallowAll === true;
    if (!pages.length) {
      out.push(na(id, D, "high", blocked ?? "Not measured: no crawled pages.", { docs: DOCS.blockIndexing }));
    } else if (noindexPages.length === 0) {
      out.push(check({ id, dimension: D, status: "pass", severity: "high", evidence: [`None of the ${pages.length} crawled pages uses noindex, so there is no directive that robots.txt could hide from Google.`], effort: "low", docs: DOCS.blockIndexing }));
    } else if (robotsAll || (entry && hasNoindex(entry) && r.blocksEntry)) {
      const urls = robotsAll ? noindexPages.map((p) => p.url) : [entry!.url];
      out.push(check({ id, dimension: D, status: "fail", severity: "high", evidence: [`${urls.length} noindex page(s) are also disallowed in robots.txt: ${listPaths(urls)}. Google cannot fetch the page, so it never sees the noindex and may keep the URL indexed from links alone.`], fix: "Pick one: to de-index, allow crawling in robots.txt and keep noindex until the pages drop out, then optionally block; to keep them crawlable, remove noindex. Verify with Search Console → URL Inspection: status should read \"Excluded by noindex\", not \"Blocked by robots.txt\".", effort: "low", docs: DOCS.blockIndexing, affected: urls, scope: "page" }));
    } else {
      out.push(check({ id, dimension: D, status: "pass", severity: "high", evidence: [`${noindexPages.length} noindex page(s) (${listPaths(noindexPages.map((p) => p.url))}) are crawlable, so Google can read the directive. (Only pages we could fetch are evaluated.)`], effort: "low", docs: DOCS.blockIndexing }));
    }
  }

  /* ---------- crawl.canonical.entry ---------- */
  const canonicalTargets = probe.canonicalTargets ?? [];
  const targetFor = (c: string) => canonicalTargets.find((t) => urlKey(t.url) === urlKey(c)) ?? null;
  {
    const id = "crawl.canonical.entry";
    if (!e0) {
      out.push(na(id, D, "medium", entryNa, { docs: DOCS.canonical }));
    } else {
      const c = e0.canonical;
      const self = e0.finalUrl;
      if (!c) {
        out.push(check({ id, dimension: D, status: "warn", severity: "medium", evidence: [`${self} has no <link rel="canonical">. With URL variants (www/apex, trailing slash, tracking parameters) Google has to guess which version to index.`], fix: `Add <link rel="canonical" href="${self}"> inside <head> (Next.js: metadata.alternates.canonical). Verify with: curl -s ${self} | grep -i 'rel="canonical"'.`, effort: "low", docs: DOCS.canonical }));
      } else if (!isAbsoluteUrl(c)) {
        out.push(check({ id, dimension: D, status: "fail", severity: "high", evidence: [`Canonical on ${self} is relative ("${c}"). Google recommends absolute URLs; relative canonicals are resolved differently by different crawlers.`], fix: `Change it to the absolute URL <link rel="canonical" href="${self}">. Verify in view-source.`, effort: "low", docs: DOCS.canonical }));
      } else if (/^http:\/\//i.test(c) && /^https:\/\//i.test(self)) {
        out.push(check({ id, dimension: D, status: "fail", severity: "high", evidence: [`Canonical on ${self} points to the http:// version (${c}). You are telling Google the insecure URL is the preferred one.`], fix: `Set the canonical to ${self} (https). Verify with: curl -s ${self} | grep -i canonical.`, effort: "low", docs: DOCS.canonical }));
      } else if (urlKey(c) === urlKey(self)) {
        out.push(check({ id, dimension: D, status: "pass", severity: "medium", evidence: [`${self} declares canonical ${c} (self-referencing, absolute, https).`], effort: "low", docs: DOCS.canonical }));
      } else {
        const t = targetFor(c);
        if (t && (t.status === null || t.status >= 300 || t.noindex)) {
          out.push(check({ id, dimension: D, status: "fail", severity: "high", evidence: [`Canonical on ${self} points to ${c}, which ${t.noindex ? "is noindex" : `returns HTTP ${t.status ?? "no response"}`}${t.finalUrl && t.finalUrl !== c ? ` (→ ${t.finalUrl})` : ""}. Google ignores canonicals that point to non-indexable targets and may pick any URL.`], fix: `Point the canonical at a URL that returns 200 and is indexable — usually ${self} itself. Verify with: curl -I ${c}.`, effort: "low", docs: DOCS.canonical }));
        } else {
          out.push(check({ id, dimension: D, status: "warn", severity: "medium", evidence: [`Canonical on ${self} points elsewhere: ${c}${t ? ` (target returns HTTP ${t.status})` : ""}. If that is not intentional, the entry page will not be indexed in its own right.`], fix: `If ${self} is the page you want ranked, set its canonical to itself. If the other URL is the real preferred version, redirect ${self} to it instead of relying on canonical alone. Verify in Search Console → URL Inspection → "Google-selected canonical".`, effort: "low", docs: DOCS.canonical }));
        }
      }
    }
  }

  /* ---------- crawl.canonical.pages(page) ---------- */
  {
    const missing = pages.filter((p) => !p.canonical);
    const badReasons: string[] = [];
    const bad = pages.filter((p) => {
      const c = p.canonical;
      if (!c) return false;
      if (!isAbsoluteUrl(c)) {
        badReasons.push(`${pathOf(p.url)}: relative canonical "${c}"`);
        return true;
      }
      if (/^http:\/\//i.test(c) && /^https:\/\//i.test(p.finalUrl)) {
        badReasons.push(`${pathOf(p.url)}: canonical points to http://`);
        return true;
      }
      if (urlKey(c) === urlKey(p.finalUrl)) return false;
      const t = targetFor(c);
      if (t && (t.status === null || t.status >= 300 || t.noindex)) {
        badReasons.push(`${pathOf(p.url)}: canonical → ${c} (${t.noindex ? "noindex" : `HTTP ${t.status ?? "no response"}`})`);
        return true;
      }
      return false;
    });
    const affected = uniq([...bad, ...missing].map((p) => p.url));
    out.push(
      pageCheck({
        id: "crawl.canonical.pages", dimension: D, severity: bad.length ? "high" : "medium",
        universe: pages.map((p) => p.url), affected,
        what: `have a missing or invalid canonical (${missing.length} missing, ${bad.length} pointing to a relative, http:// or non-indexable target)`,
        fix: "Give every indexable page one absolute, https, self-referencing <link rel=\"canonical\"> in <head> (only point elsewhere for true duplicates, and then to a 200, indexable URL). Verify with: curl -s <url> | grep -c 'rel=\"canonical\"' — expect exactly 1 per page.",
        docs: DOCS.canonical, effort: "low",
        forceStatus: bad.length ? "fail" : undefined,
        extra: badReasons.slice(0, 5),
        naNote: blocked ?? "Not measured: no crawled pages.",
      }),
    );
  }

  /* ---------- crawl.https.redirect ---------- */
  // 另一主机(www ↔ 裸域)DNS 不存在时,它的变体全部不算(复审 C21:blog.example.com 没有 www.blog.example.com
  // 不是站长的问题)。入口主机自己的 http 变体没响应仍照常判 warn。
  const altMissing = missingAltHost(probe);
  const variants = realVariants(probe);
  const droppedAlt = (probe.variants ?? []).length - variants.length;
  const byKind = (k: string) => variants.find((v) => variantKind(v) === k) ?? null;
  {
    const id = "crawl.https.redirect";
    const httpVars = variants.filter((v) => /^http:\/\//i.test(v.url));
    const droppedHttp = (probe.variants ?? []).filter((v) => /^http:\/\//i.test(v.url)).length - httpVars.length;
    if (!httpVars.length) {
      out.push(na(id, D, "high", "Not measured: the http:// variants were not probed in this run.", { docs: DOCS.whyHttps }));
    } else {
      type V = { v: UrlVariant; verdict: "pass" | "warn" | "fail"; why: string };
      const verdicts: V[] = httpVars.map((v) => {
        const final = variantFinal(v);
        const first = Array.isArray(v.hops) && v.hops.length ? v.hops[0] : v.status;
        if (v.status === null) return { v, verdict: "warn", why: `${v.url}: no response (${v.error ?? "unreachable"}) — acceptable only if port 80 is closed on purpose` };
        if (v.status === 200) return { v, verdict: "fail", why: `${v.url}: HTTP 200 without redirecting — the insecure version is a live duplicate` };
        if (!final || !/^https:\/\//i.test(final)) return { v, verdict: "fail", why: `${v.url}: ends at ${final ?? "nothing"} instead of https://` };
        if (first === 301 || first === 308) return { v, verdict: "pass", why: `${v.url} → ${first} → ${final}` };
        if (first === 302 || first === 307) return { v, verdict: "warn", why: `${v.url} → ${first} (temporary) → ${final}` };
        return { v, verdict: "warn", why: `${v.url} → HTTP ${v.status} → ${final ?? "?"}` };
      });
      const worst = verdicts.some((x) => x.verdict === "fail") ? "fail" : verdicts.some((x) => x.verdict === "warn") ? "warn" : "pass";
      const temp = verdicts.some((x) => /302|307/.test(x.why)) && worst === "warn";
      out.push(
        check({
          id, dimension: D, status: worst, severity: temp ? "low" : "high",
          evidence: [...verdicts.map((x) => x.why), ...altHostLine(altMissing, droppedHttp)],
          fix: worst === "pass" ? "" : `Redirect every http:// request with a 301 (or 308) to the same path on https://${probe.host} at the edge (Vercel/Netlify do this by default; on nginx: return 301 https://$host$request_uri;). Verify with: curl -I http://${probe.host}/ — expect "HTTP/1.1 301" and a Location: https://… header.`,
          effort: "low", docs: DOCS.whyHttps,
        }),
      );
    }
  }

  /* ---------- crawl.host.canonical ---------- */
  {
    const id = "crawl.host.canonical";
    const www = byKind("https-www");
    const apex = byKind("https-apex");
    if (altMissing) {
      out.push(na(id, D, "medium", `Not applicable: ${altMissing} does not exist (no DNS record), so ${probe.host} is the only host — there is no duplicate to merge.`, { docs: DOCS.canonical }));
    } else if (!www || !apex) {
      out.push(na(id, D, "medium", "Not measured: both https://www and https://apex variants are needed for this check.", { docs: DOCS.canonical }));
    } else if (www.status === null && apex.status === null) {
      // 两个 https 主机都没回响应(多半是证书失败):判不了"合没合并",不能报"两个站"
      out.push(na(id, D, "medium", `Not measured: neither ${www.url} nor ${apex.url} responded (${www.error ?? apex.error ?? "no response"}) — see the HTTPS checks.`, { docs: DOCS.canonical }));
    } else {
      const is200 = (v: UrlVariant) => v.status === 200;
      const is3xx = (v: UrlVariant) => v.status !== null && v.status >= 300 && v.status < 400;
      if (is200(www) && is200(apex)) {
        const same = www.canonical && apex.canonical && urlKey(www.canonical) === urlKey(apex.canonical);
        out.push(
          check({
            id, dimension: D, status: same ? "warn" : "fail", severity: "medium",
            evidence: [`Both ${www.url} and ${apex.url} return HTTP 200 — two live copies of every page.`, same ? `Their canonicals agree (${www.canonical}), so Google will probably consolidate, but links and metrics still split across two hosts.` : `Their canonicals ${www.canonical && apex.canonical ? `disagree (${www.canonical} vs ${apex.canonical})` : "are missing on at least one host"}, so Google has to guess which host is real.`],
            fix: `Choose one host (most sites keep ${hostOf(entry?.finalUrl ?? probe.entryUrl)}) and 301-redirect the other at DNS/edge level, path preserved. Verify with: curl -I https://${/^www\./.test(probe.host) ? probe.host.replace(/^www\./, "") : `www.${probe.host}`}/ — expect 301 to your primary host.`,
            effort: "low", docs: DOCS.canonical,
          }),
        );
      } else if ((is200(www) && is3xx(apex)) || (is200(apex) && is3xx(www))) {
        const primary = is200(www) ? www : apex;
        const other = primary === www ? apex : www;
        out.push(check({ id, dimension: D, status: "pass", severity: "medium", evidence: [`${primary.url} is the live host; ${other.url} redirects (${other.hops?.[0] ?? other.status}) to ${variantFinal(other) ?? primary.url}.`], effort: "low", docs: DOCS.canonical }));
      } else if (is200(www) || is200(apex)) {
        const primary = is200(www) ? www : apex;
        const other = primary === www ? apex : www;
        out.push(check({ id, dimension: D, status: "pass", severity: "medium", evidence: [`${primary.url} is live; ${other.url} does not serve content (HTTP ${other.status ?? "no response"}${other.error ? `, ${other.error}` : ""}). No duplicate host — consider a 301 so typed-in URLs still work.`], fix: `Optional: point ${hostOf(other.url)} at the same host and 301 it to ${primary.url}. Verify with: curl -I ${other.url}.`, effort: "low", docs: DOCS.canonical }));
      } else {
        out.push(check({ id, dimension: D, status: "warn", severity: "medium", evidence: [`Neither ${www.url} (HTTP ${www.status ?? "none"}) nor ${apex.url} (HTTP ${apex.status ?? "none"}) returned 200 directly; ${describeChain(www)}; ${describeChain(apex)}.`], fix: "Make exactly one of the two hosts answer 200 and 301 the other to it. Verify with curl -I on both.", effort: "low", docs: DOCS.canonical }));
      }
    }
  }

  /* ---------- crawl.url-variants ---------- */
  {
    const id = "crawl.url-variants";
    const kinds = new Set(["trailing-slash", "index-html", "uppercase", "utm"]);
    const vs = variants.filter((v) => v.kind && kinds.has(v.kind));
    if (!vs.length) {
      out.push(na(id, D, "medium", "Not measured: trailing-slash / index.html / uppercase / utm variants were not probed in this run.", { docs: DOCS.canonical }));
    } else {
      const bad = vs.filter((v) => v.status === 200 && !(v.canonical && urlKey(v.canonical) === mainKey));
      out.push(
        check({
          id, dimension: D, status: bad.length ? "warn" : "pass", severity: "medium",
          evidence: bad.length
            ? [`${bad.length} of ${vs.length} URL variants return HTTP 200 without a canonical back to the main URL: ${bad.map((v) => `${v.kind} (${v.url}${v.canonical ? `, canonical → ${v.canonical}` : ", no canonical"})`).join("; ")}. Each is a duplicate Google may index separately.`]
            : [`All ${vs.length} probed variants (${vs.map((v) => v.kind).join(", ")}) either redirect or declare the main URL as canonical.`],
          fix: bad.length ? `Either 301 each variant to the main URL (preferred for trailing slash / index.html / uppercase) or make sure the served page's canonical is exactly ${entry?.finalUrl ?? probe.entryUrl} (required for utm_ parameters). Verify with: curl -sI <variant> and view-source canonical.` : "",
          effort: "low", docs: DOCS.canonical, affected: bad.map((v) => v.url),
        }),
      );
    }
  }

  /* ---------- crawl.redirect.chains ---------- */
  {
    const id = "crawl.redirect.chains";
    if (!variants.length) {
      out.push(na(id, D, "medium", "Not measured: no URL variants were probed.", { docs: DOCS.redirects }));
    } else {
      const longest = variants.reduce<UrlVariant | null>((best, v) => (!best || variantHops(v) > variantHops(best) ? v : best), null)!;
      const hops = variantHops(longest);
      const metaRefresh = variants.filter((v) => v.metaRefresh).concat(pages.filter((p) => p.metaRefresh).map((p) => ({ url: p.url, status: p.status, location: null, chain: [] })));
      const status = metaRefresh.length ? "fail" : hops <= 1 ? "pass" : hops === 2 ? "warn" : "fail";
      out.push(
        check({
          id, dimension: D, status, severity: "medium",
          evidence: [
            `Longest redirect chain among ${variants.length} probed URLs: ${hops} hop(s) — ${describeChain(longest)}.`,
            ...(metaRefresh.length ? [`${metaRefresh.length} URL(s) use <meta http-equiv="refresh"> instead of an HTTP redirect: ${listPaths(metaRefresh.map((m) => m.url))}. Google treats it as a weak, slow redirect.`] : []),
            ...altHostLine(altMissing, droppedAlt),
          ],
          fix: status === "pass" ? "" : "Collapse every chain to a single 301 from the old URL straight to the final URL (update the rule that redirects http→https and www→apex to do both in one hop), and replace meta refresh with server-side 301s. Verify with: curl -sIL <url> | grep -E '^(HTTP|location)' — expect at most one 301 before the 200.",
          effort: "low", docs: DOCS.redirects, affected: metaRefresh.map((m) => m.url),
        }),
      );
    }
  }

  /* ---------- crawl.soft404 ---------- */
  {
    const id = "crawl.soft404";
    const s = probe.soft404;
    if (!s || s.status === null) {
      out.push(na(id, D, "medium", blocked ?? "Not measured: the random-URL probe got no response.", { docs: DOCS.soft404 }));
    } else if (s.status === 404 || s.status === 410) {
      out.push(check({ id, dimension: D, status: "pass", severity: "medium", evidence: [`${s.probeUrl} → HTTP ${s.status}. Missing pages are reported correctly, so Google will not waste crawl budget on them.`], effort: "low", docs: DOCS.soft404 }));
    } else if (s.status === 200 && s.isSoft404) {
      out.push(check({ id, dimension: D, status: "warn", severity: "medium", evidence: [`${s.probeUrl} → HTTP 200 with "not found" content (a soft 404). Google has to render and classify each of these instead of skipping them.`], fix: "Return HTTP 404 (or 410) for unknown paths: in Next.js use notFound() in the catch-all, in nginx/Apache make sure the error document keeps the 404 status. Verify with: curl -I <random-url> — expect 404.", effort: "low", docs: DOCS.soft404 }));
    } else if (s.status === 200) {
      out.push(check({ id, dimension: D, status: "info", severity: "medium", evidence: [`${s.probeUrl} → HTTP 200 with a full page (typical for single-page apps that render the shell for every path). We could not confirm a 404 from the raw HTML; Google's renderer will decide.`], fix: "If the client app shows a \"not found\" view, also make the server answer 404 for unknown routes (Next.js notFound(), or a status override in your SPA host). Verify with: curl -I <random-url>.", effort: "low", docs: DOCS.soft404 }));
    } else if (s.status >= 300 && s.status < 400) {
      out.push(check({ id, dimension: D, status: "warn", severity: "medium", evidence: [`${s.probeUrl} → HTTP ${s.status} redirect (usually to the homepage). Google classifies "redirect everything unknown to home" as a soft 404.`], fix: "Return 404 for unknown URLs instead of redirecting them. Verify with: curl -I <random-url> — expect 404, not 301/302.", effort: "low", docs: DOCS.soft404 }));
    } else {
      out.push(check({ id, dimension: D, status: "pass", severity: "medium", evidence: [`${s.probeUrl} → HTTP ${s.status}. Not a 200, so Google will not index junk URLs; 404 or 410 is still the cleanest signal.`], effort: "low", docs: DOCS.soft404 }));
    }
  }

  /* ---------- crawl.pages.errors(page) ---------- */
  {
    const all = ctx.pages;
    const bad = all.filter((p) => p.status === 0 || p.status >= 400);
    out.push(
      pageCheck({
        id: "crawl.pages.errors", dimension: D, severity: "high",
        universe: all.map((p) => p.url), affected: bad.map((p) => p.url),
        what: "returned an error (4xx / 5xx / no response) although they are linked internally",
        fix: "Fix or redirect (301) every erroring URL and update the internal links that point to it. Verify with Search Console → Pages → \"Not found (404)\" and \"Server error (5xx)\" trending to zero.",
        docs: DOCS.httpErrors, effort: "medium",
        extra: bad.slice(0, 5).map((p) => `${pathOf(p.url)} → HTTP ${p.status || "no response"}`),
        naNote: blocked ?? "Not measured: no pages were crawled.",
      }),
    );
  }

  /* ---------- crawl.links.broken(page) ---------- */
  {
    const id = "crawl.links.broken";
    const broken = probe.brokenInternal;
    if (!Array.isArray(broken)) {
      out.push(na(id, D, "high", blocked ?? "Not measured: internal links were not re-checked for broken targets in this run.", { docs: DOCS.crawlableLinks, scope: "page" }));
    } else {
      out.push(
        pageCheck({
          id, dimension: D, severity: "high",
          universe: (pages.length ? pages : ctx.pages).map((p) => p.url),
          affected: uniq(broken.map((b) => b.from)),
          what: `contain broken internal links (${broken.length} link(s) to ${uniq(broken.map((b) => b.to)).length} dead URL(s))`,
          fix: "Update each link to the live URL or 301 the dead target. Verify by re-crawling — the broken count should be 0 — and check Search Console → Pages → 404 report.",
          docs: DOCS.crawlableLinks, effort: "low",
          extra: broken.slice(0, 5).map((b) => `${pathOf(b.from)} → ${pathOf(b.to)} (HTTP ${b.status ?? "no response"})`),
          naNote: blocked ?? "Not measured: no crawled pages.",
        }),
      );
    }
  }

  /* ---------- crawl.links.to-redirects(page) ---------- */
  {
    const all = ctx.pages;
    const viaRedirect = all.filter((p) => (p.redirects ?? 0) > 0 || (p.finalUrl && urlKey(p.finalUrl) !== urlKey(p.url)));
    out.push(
      pageCheck({
        id: "crawl.links.to-redirects", dimension: D, severity: "low",
        universe: all.map((p) => p.url), affected: viaRedirect.map((p) => p.url),
        what: "were reached through a redirect (the internal link still points to an old URL)",
        thresholds: { pass: 0, warn: 0.1 },
        fix: "Update internal links, navigation and sitemap entries to the final URL so crawlers and users skip the extra hop. Verify by re-crawling: pages reached via redirect should be 0.",
        docs: DOCS.redirects, effort: "low",
        extra: viaRedirect.slice(0, 5).map((p) => `${pathOf(p.url)} → ${pathOf(p.finalUrl)}`),
        naNote: blocked ?? "Not measured: no pages were crawled.",
      }),
    );
  }

  /* ---------- crawl.hreflang ---------- */
  {
    const id = "crawl.hreflang";
    const withH = pages.filter((p) => Array.isArray(p.hreflang) && p.hreflang.length > 0);
    if (!withH.length) {
      out.push(na(id, D, "medium", "Not applicable: no hreflang annotations on the crawled pages (fine for single-language sites).", { docs: DOCS.hreflang }));
    } else {
      const problems: string[] = [];
      const bad = withH.filter((p) => {
        const parsable = p.hreflang.every((h) => isAbsoluteUrl(h.href));
        const hasDefault = p.hreflang.some((h) => h.lang.toLowerCase() === "x-default");
        const self = p.hreflang.some((h) => urlKey(h.href) === urlKey(p.finalUrl));
        const ok = parsable && (hasDefault || self);
        if (!ok) problems.push(`${pathOf(p.url)}: ${!parsable ? "non-absolute href" : !self ? "no self-reference" : "no x-default"}`);
        return !ok;
      });
      out.push(
        pageCheck({
          id, dimension: D, severity: "medium",
          universe: withH.map((p) => p.url), affected: bad.map((p) => p.url),
          unit: "pages with hreflang",
          what: "have an incomplete hreflang set (missing self-reference / x-default, or non-absolute hrefs)",
          forceStatus: "warn",
          fix: "Every page in a language set must list all alternates including itself, use absolute URLs, and ideally an x-default. Verify with Search Console → International targeting (legacy) or a validator such as hreflang.org's checker.",
          docs: DOCS.hreflang, effort: "medium", extra: problems.slice(0, 5),
        }),
      );
    }
  }

  return out;
}
