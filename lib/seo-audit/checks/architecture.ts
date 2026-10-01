/* ============================================================
   Architecture & Internal Links(权重 10)

   这维度全靠抓取样本说话,所以抓到 <5 页时整维度 na(V2-0 规定不计入总分)。
   孤页检查只是"抽样信号":sitemap 抽出来的 URL 没被我们抓到的 20 页链到,
   不等于全站没人链它 —— 证据里必须写明这个局限。
   ============================================================ */

import type { CheckStatus, SeoCheck } from "../types";
import { check, na, pageCheck, okPages, pathOf, listPaths, pct, urlKey, blockedNote, DOCS, type CheckContext } from "./helpers";

const D = "architecture" as const;
const MIN_PAGES = 5;

const IDS: { id: string; severity: "medium" | "low"; docs: string }[] = [
  { id: "arch.depth", severity: "medium", docs: DOCS.crawlBudget },
  { id: "arch.internal-links.min", severity: "medium", docs: DOCS.crawlableLinks },
  { id: "arch.internal-links.bloat", severity: "low", docs: DOCS.crawlableLinks },
  { id: "arch.generic-anchors", severity: "low", docs: DOCS.crawlableLinks },
  { id: "arch.orphans", severity: "medium", docs: DOCS.crawlableLinks },
  { id: "arch.breadcrumbs", severity: "low", docs: DOCS.breadcrumb },
  { id: "arch.url-depth", severity: "low", docs: DOCS.urlStructure },
  { id: "arch.nav-consistency", severity: "low", docs: DOCS.starterGuide },
];

function segments(url: string): number {
  return pathOf(url).split("?")[0].split("/").filter(Boolean).length;
}

export function checkArchitecture(ctx: CheckContext): SeoCheck[] {
  const pages = okPages(ctx);
  const blocked = blockedNote(ctx);

  if (ctx.pages.length < MIN_PAGES || pages.length === 0) {
    const note = blocked ?? `Not measured: only ${ctx.pages.length} page(s) were crawled (need at least ${MIN_PAGES}) — this dimension is excluded from the overall score.`;
    return IDS.map((c) => na(c.id, D, c.severity, note, { docs: c.docs }));
  }

  const urls = pages.map((p) => p.url);
  const out: SeoCheck[] = [];
  const naNote = blocked ?? "Not measured: no crawled HTML pages.";

  /* ---------- arch.depth ---------- */
  const deep = pages.filter((p) => p.depth > 3);
  out.push(
    pageCheck({
      id: "arch.depth", dimension: D, severity: "medium",
      universe: urls, affected: deep.map((p) => p.url),
      what: "sit more than 3 clicks from the homepage (crawled less often, ranked lower)",
      fix: "Link deep pages from hub pages, category pages or the footer so every important URL is reachable in ≤3 clicks; add 'related' links between siblings. Verify by re-crawling: depth >3 pages should be 0.",
      docs: DOCS.crawlBudget, effort: "medium",
      extra: deep.slice(0, 3).map((p) => `${pathOf(p.url)}: depth ${p.depth}`), naNote,
    }),
  );

  /* ---------- arch.internal-links.min / bloat ---------- */
  const linkCount = (p: (typeof pages)[number]) => (typeof p.uniqueInternalLinks === "number" ? p.uniqueInternalLinks : p.internalLinks ?? 0);
  const few = pages.filter((p) => linkCount(p) < 3);
  out.push(
    pageCheck({
      id: "arch.internal-links.min", dimension: D, severity: "medium",
      universe: urls, affected: few.map((p) => p.url),
      what: "contain fewer than 3 internal links (dead ends for crawlers and readers)",
      fix: "Add contextual links from each listed page to related pages plus the standard navigation/footer. Verify by re-crawling: every page should have ≥3 internal links.",
      docs: DOCS.crawlableLinks, effort: "low",
      extra: few.slice(0, 3).map((p) => `${pathOf(p.url)}: ${linkCount(p)} internal link(s)`), naNote,
    }),
  );
  const bloat = pages.filter((p) => linkCount(p) > 150);
  out.push(
    pageCheck({
      id: "arch.internal-links.bloat", dimension: D, severity: "low",
      universe: urls, affected: bloat.map((p) => p.url),
      what: "contain more than 150 internal links (each link passes less weight and mega-menus dilute relevance)",
      fix: "Trim mega-menus and tag clouds; keep primary navigation to the pages that matter and move long lists to hub pages. Verify by re-crawling: internal links per page ≤150.",
      docs: DOCS.crawlableLinks, effort: "medium",
      extra: bloat.slice(0, 3).map((p) => `${pathOf(p.url)}: ${linkCount(p)} internal links`), naNote,
    }),
  );

  /* ---------- arch.generic-anchors ---------- */
  {
    const id = "arch.generic-anchors";
    const totalLinks = pages.reduce((n, p) => n + (p.internalLinks ?? 0), 0);
    const generic = pages.reduce((n, p) => n + (p.genericAnchors ?? 0), 0);
    if (!totalLinks) {
      out.push(na(id, D, "low", "Not applicable: no internal links were found on the crawled pages.", { docs: DOCS.crawlableLinks }));
    } else {
      const share = generic / totalLinks;
      const status: CheckStatus = share > 0.15 ? "fail" : share > 0.05 ? "warn" : "pass";
      const affected = pages.filter((p) => (p.genericAnchors ?? 0) > 0);
      out.push(
        check({
          id, dimension: D, status, severity: "low",
          evidence: [`Across ${pages.length} crawled pages, ${generic} of ${totalLinks} internal links (${pct(generic, totalLinks)}%) use generic anchor text such as "click here", "read more", "here" or "learn more"${affected.length ? `; pages: ${listPaths(affected.map((p) => p.url))}` : ""}.`],
          fix: status === "pass" ? "" : "Rewrite generic anchors to describe the target page (\"see the SEO audit pricing\" instead of \"click here\"); anchor text is one of Google's strongest relevance hints. Verify by re-crawling: generic share ≤5%.",
          effort: "low", docs: DOCS.crawlableLinks, affected: affected.map((p) => p.url), scope: "page",
        }),
      );
    }
  }

  /* ---------- arch.orphans(抽样信号) ---------- */
  {
    const id = "arch.orphans";
    const sample = ctx.sitemapSample ?? [];
    if (!sample.length) {
      out.push(na(id, D, "medium", "Not applicable: no sitemap URLs were sampled (no sitemap found).", { docs: DOCS.crawlableLinks }));
    } else {
      const linked = new Set<string>();
      for (const p of pages) {
        linked.add(urlKey(p.url));
        linked.add(urlKey(p.finalUrl));
        for (const l of p.links ?? []) linked.add(urlKey(l));
      }
      const orphans = sample.filter((u) => !linked.has(urlKey(u)));
      const share = orphans.length / sample.length;
      const status: CheckStatus = share <= 0.5 ? "pass" : share <= 0.8 ? "warn" : "fail";
      out.push(
        check({
          id, dimension: D, status, severity: "medium",
          evidence: [
            `Of ${sample.length} sampled sitemap URLs, ${orphans.length} (${pct(orphans.length, sample.length)}%) are not linked from any of the ${pages.length} pages we crawled${orphans.length ? `: ${listPaths(orphans)}` : ""}.`,
            "Sampling caveat: a URL may be linked from pages outside our sample; treat this as a signal to verify, not a verdict.",
          ],
          fix: status === "pass" ? "" : "Check the listed URLs in Search Console → Links → Internal links; pages with 0 internal links need at least one link from a relevant hub, category or related-posts block. Pages that should not be linked probably should not be in the sitemap either.",
          effort: "medium", docs: DOCS.crawlableLinks, affected: orphans, scope: "page",
        }),
      );
    }
  }

  /* ---------- arch.breadcrumbs ---------- */
  {
    const id = "arch.breadcrumbs";
    const withBc = pages.filter((p) => p.hasBreadcrumbSchema || (p.jsonLdTypes ?? []).some((t) => /^BreadcrumbList$/i.test(t)));
    if (withBc.length) {
      out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`${withBc.length} of ${pages.length} crawled pages expose breadcrumbs (BreadcrumbList), e.g. ${listPaths(withBc.map((p) => p.url), 3)}.`], effort: "low", docs: DOCS.breadcrumb }));
    } else {
      out.push(check({ id, dimension: D, status: "info", severity: "low", evidence: [`No breadcrumb trail (BreadcrumbList) detected on ${pages.length} crawled pages. Breadcrumbs add internal links up the hierarchy and a readable path in mobile results.`], fix: "Add a visible breadcrumb (Home › Section › Page) with matching BreadcrumbList JSON-LD on every page below the homepage. Verify with the Rich Results Test.", effort: "low", docs: DOCS.breadcrumb }));
    }
  }

  /* ---------- arch.url-depth ---------- */
  {
    const deepPaths = pages.filter((p) => segments(p.url) > 3);
    out.push(
      pageCheck({
        id: "arch.url-depth", dimension: D, severity: "low",
        universe: urls, affected: deepPaths.map((p) => p.url),
        what: "have URL paths with more than 3 segments",
        thresholds: { pass: 0.1, warn: 1 },
        fix: "Flatten the hierarchy for new content (/blog/post-name instead of /blog/2024/03/category/post-name); keep old URLs working with 301s. Verify: ≥90% of crawled URLs have ≤3 path segments.",
        docs: DOCS.urlStructure, effort: "high",
        extra: deepPaths.slice(0, 3).map((p) => `${pathOf(p.url)} (${segments(p.url)} segments)`), naNote,
      }),
    );
  }

  /* ---------- arch.nav-consistency ---------- */
  {
    const id = "arch.nav-consistency";
    const withLinks = pages.filter((p) => (p.links ?? []).length > 0);
    if (withLinks.length < 2) {
      out.push(na(id, D, "low", "Not measured: fewer than two crawled pages expose their link lists.", { docs: DOCS.starterGuide }));
    } else {
      // 页面自身的 URL 视为"已包含":导航页通常不自链(或解析层去重了),
      // 若不补上,/pricing 会让交集丢掉 /pricing、/about 丢掉 /about …… 最后交集必为空。
      const seenOn = new Map<string, number>();
      for (const p of withLinks) {
        const keys = new Set<string>((p.links ?? []).map(urlKey));
        keys.add(urlKey(p.url));
        keys.forEach((k) => seenOn.set(k, (seenOn.get(k) ?? 0) + 1));
      }
      const shared: string[] = Array.from(seenOn.entries())
        .filter(([, count]) => count === withLinks.length)
        .map(([k]) => k);
      const n = shared.length;
      out.push(
        check({
          id, dimension: D, status: n >= 5 ? "pass" : "warn", severity: "low",
          evidence: [`${n} internal link target(s) appear on every one of the ${withLinks.length} crawled pages that expose links${n ? ` (e.g. ${shared.slice(0, 4).map((k) => `/${k.split("/").slice(1).join("/")}`).join(", ")})` : ""}. A stable header/footer of ≥5 shared links is what crawlers and users expect.`],
          fix: n >= 5 ? "" : "Give every page the same global navigation and footer (home, main sections, contact/legal) rendered in the HTML — not injected only on some templates or only after JavaScript. Verify by re-crawling: ≥5 links common to all pages.",
          effort: "low", docs: DOCS.starterGuide,
        }),
      );
    }
  }

  return out;
}
