/* ============================================================
   Structured Data & Social(权重 10)

   注意数据边界:CrawledPage 只保留 JSON-LD 的 @type 列表与解析错误数,
   没有字段级内容。所以 Organization/Article/Product 这几项只能验证
   "类型是否出现",字段完整性(name/url/logo、headline/datePublished …)
   在证据里明说"需用 Rich Results Test 验证",不假装测过。
   ============================================================ */

import type { CheckStatus, CrawledPage, SeoCheck } from "../types";
import { check, na, pageCheck, okPages, pageTypeOf, listPaths, pathOf, blockedNote, usableEntry, entryNaNote, DOCS, type CheckContext } from "./helpers";

const D = "structured" as const;

function typesOf(p: CrawledPage): string[] {
  return (p.jsonLdTypes ?? []).map((t) => String(t));
}

function hasType(p: CrawledPage, re: RegExp): boolean {
  return typesOf(p).some((t) => re.test(t));
}

/** og 键可能是 "og:title" 也可能被解析层去掉了前缀 —— 两种都认 */
function metaGet(m: Record<string, string> | undefined, key: string, prefix: string): string | null {
  if (!m) return null;
  return m[`${prefix}:${key}`] ?? m[key] ?? null;
}

export function checkStructured(ctx: CheckContext): SeoCheck[] {
  const pages = okPages(ctx);
  // 入口 500 / 证书失败时 ctx.entry 仍在但没有内容:按"没测"处理,不能判"缺 Organization / OG"(复审 C20 连带)
  const e = usableEntry(ctx);
  const blocked = blockedNote(ctx);
  const out: SeoCheck[] = [];
  const noEntry = entryNaNote(ctx);

  /* ---------- schema.jsonld.valid ---------- */
  {
    const id = "schema.jsonld.valid";
    if (!pages.length) {
      out.push(na(id, D, "high", blocked ?? "Not measured: no crawled HTML pages.", { docs: DOCS.structuredIntro }));
    } else {
      const errPages = pages.filter((p) => (p.jsonLdErrors ?? 0) > 0);
      const withAny = pages.filter((p) => typesOf(p).length > 0);
      if (errPages.length) {
        out.push(
          check({
            id, dimension: D, status: "fail", severity: "high",
            evidence: [`Across ${pages.length} crawled pages, ${errPages.length} contain JSON-LD that fails to parse (${errPages.reduce((n, p) => n + (p.jsonLdErrors ?? 0), 0)} broken block(s)): ${listPaths(errPages.map((p) => p.url))}. Google silently ignores invalid blocks — no rich results.`],
            fix: "Fix the JSON syntax (trailing commas, unescaped quotes, HTML inside strings) — usually a template that interpolates raw text. Verify each URL with the Rich Results Test (search.google.com/test/rich-results): it must report no parsing errors.",
            effort: "low", docs: DOCS.structuredIntro, affected: errPages.map((p) => p.url), scope: "page",
          }),
        );
      } else if (!withAny.length) {
        out.push(
          check({
            id, dimension: D, status: "warn", severity: "medium",
            evidence: [`None of the ${pages.length} crawled pages contains a JSON-LD block. You get no rich results and AI engines get no machine-readable facts about the brand.`],
            fix: "Add JSON-LD in <head>: Organization + WebSite on the homepage, BreadcrumbList site-wide, Article on posts, Product on product pages. Verify with the Rich Results Test.",
            effort: "medium", docs: DOCS.structuredIntro,
          }),
        );
      } else {
        const typeCount = new Map<string, number>();
        for (const p of withAny) for (const t of typesOf(p)) typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
        out.push(
          check({
            id, dimension: D, status: "pass", severity: "high",
            evidence: [`${withAny.length} of ${pages.length} crawled pages carry valid JSON-LD; types seen: ${Array.from(typeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} (${n})`).join(", ")}.`],
            effort: "low", docs: DOCS.structuredIntro,
          }),
        );
      }
    }
  }

  /* ---------- schema.organization ---------- */
  {
    const id = "schema.organization";
    if (!e) {
      out.push(na(id, D, "medium", noEntry, { docs: DOCS.organization }));
    } else {
      const re = /^(Organization|LocalBusiness|Corporation|OnlineBusiness|OnlineStore|Store|Restaurant|MedicalBusiness|ProfessionalService|.*Organization|.*Business)$/i;
      const onEntry = hasType(e, re);
      const elsewhere = pages.filter((p) => p !== e && hasType(p, re));
      if (onEntry) {
        out.push(
          check({
            id, dimension: D, status: "pass", severity: "medium",
            evidence: [`${e.finalUrl} declares ${typesOf(e).filter((t) => re.test(t)).join(", ")} in JSON-LD. We verified the type is present; confirm name, url and logo are filled in with the Rich Results Test.`],
            effort: "low", docs: DOCS.organization,
          }),
        );
      } else {
        out.push(
          check({
            id, dimension: D, status: "warn", severity: "medium",
            evidence: [`${e.finalUrl} has no Organization / LocalBusiness JSON-LD${elsewhere.length ? ` (found on ${listPaths(elsewhere.map((p) => p.url), 3)} instead)` : ""}. Google and AI engines use it to tie your name, logo and social profiles to the entity.`],
            fix: `Add to the homepage <head>: {"@context":"https://schema.org","@type":"Organization","name":"<brand>","url":"${ctx.probe.origin}/","logo":"${ctx.probe.origin}/logo.png","sameAs":["<linkedin>","<x>"]}. Verify with the Rich Results Test → "Organization" detected with no missing fields.`,
            effort: "low", docs: DOCS.organization,
          }),
        );
      }
    }
  }

  /* ---------- schema.website ---------- */
  {
    const id = "schema.website";
    if (!e) {
      out.push(na(id, D, "low", noEntry, { docs: DOCS.structuredIntro }));
    } else if (hasType(e, /^WebSite$/i)) {
      out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`${e.finalUrl} declares WebSite in JSON-LD (site name for the search result header).`], effort: "low", docs: DOCS.structuredIntro }));
    } else {
      out.push(check({ id, dimension: D, status: "warn", severity: "low", evidence: [`${e.finalUrl} has no WebSite JSON-LD, so Google infers the site name from other signals.`], fix: `Add {"@type":"WebSite","name":"<site name>","url":"${ctx.probe.origin}/"} to the homepage JSON-LD (skip the deprecated SearchAction). Verify with the Rich Results Test.`, effort: "low", docs: DOCS.structuredIntro }));
    }
  }

  /* ---------- schema.breadcrumb ---------- */
  {
    const id = "schema.breadcrumb";
    if (!pages.length) {
      out.push(na(id, D, "low", blocked ?? "Not measured: no crawled HTML pages.", { docs: DOCS.breadcrumb }));
    } else {
      const withBc = pages.filter((p) => p.hasBreadcrumbSchema || hasType(p, /^BreadcrumbList$/i));
      const deep = pages.filter((p) => p.depth >= 2);
      if (withBc.length) {
        out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`${withBc.length} of ${pages.length} crawled pages declare BreadcrumbList (e.g. ${listPaths(withBc.map((p) => p.url), 3)}). Confirm each item has position and name with the Rich Results Test.`], effort: "low", docs: DOCS.breadcrumb }));
      } else {
        out.push(check({ id, dimension: D, status: "info", severity: "low", evidence: [`No crawled page declares BreadcrumbList${deep.length ? ` although ${deep.length} pages sit two or more clicks deep` : ""}. Breadcrumb markup replaces the URL in mobile results with a readable path.`], fix: "Add BreadcrumbList JSON-LD (itemListElement with position, name, item) mirroring your visible breadcrumb trail on every page below the homepage. Verify with the Rich Results Test → Breadcrumbs valid.", effort: "low", docs: DOCS.breadcrumb }));
      }
    }
  }

  /* ---------- schema.article(仅 article 页) ---------- */
  {
    const id = "schema.article";
    const articles = pages.filter((p) => pageTypeOf(p) === "article");
    if (!articles.length) {
      out.push(na(id, D, "high", blocked ?? "Not applicable: no article pages among the crawled pages.", { docs: DOCS.article, scope: "page" }));
    } else {
      const re = /^(Article|BlogPosting|NewsArticle|TechArticle|ScholarlyArticle|Report)$/i;
      const missing = articles.filter((p) => !hasType(p, re));
      out.push(
        pageCheck({
          id, dimension: D, severity: "high",
          universe: articles.map((p) => p.url), affected: missing.map((p) => p.url),
          unit: "article pages",
          what: "have no Article / BlogPosting JSON-LD",
          fix: "Add Article (or BlogPosting) JSON-LD with headline (matching the title), image, datePublished, dateModified and author.name to each listed page. Verify with the Rich Results Test: \"Article\" detected, no missing required fields.",
          docs: DOCS.article, effort: "low",
          extra: missing.length < articles.length ? [`${articles.length - missing.length} article page(s) do declare it; headline/image/datePublished/author fields could not be validated from the raw crawl — check them in the Rich Results Test.`] : [],
        }),
      );
    }
  }

  /* ---------- schema.product(仅 product 页) ---------- */
  {
    const id = "schema.product";
    const products = pages.filter((p) => pageTypeOf(p) === "product");
    if (!products.length) {
      out.push(na(id, D, "high", blocked ?? "Not applicable: no product pages among the crawled pages.", { docs: DOCS.product, scope: "page" }));
    } else {
      const missing = products.filter((p) => !hasType(p, /product$/i));
      out.push(
        pageCheck({
          id, dimension: D, severity: "high",
          universe: products.map((p) => p.url), affected: missing.map((p) => p.url),
          unit: "product pages",
          what: "have no Product JSON-LD",
          fix: "Add Product JSON-LD with name, image, description and offers (price, priceCurrency, availability) — or review / aggregateRating — to each listed page. Verify with the Rich Results Test: \"Product snippets\" or \"Merchant listings\" valid.",
          docs: DOCS.product, effort: "medium",
          extra: missing.length < products.length ? ["offers / review / aggregateRating fields could not be validated from the raw crawl — check them in the Rich Results Test."] : [],
        }),
      );
    }
  }

  /* ---------- schema.deprecated(info) ---------- */
  {
    const id = "schema.deprecated";
    const found = pages.filter((p) => hasType(p, /^(FAQPage|HowTo)$/i));
    if (!pages.length) {
      out.push(na(id, D, "low", blocked ?? "Not measured: no crawled HTML pages.", { docs: DOCS.faq }));
    } else {
      out.push(
        check({
          id, dimension: D, status: "info", severity: "low",
          evidence: [
            found.length
              ? `${found.length} crawled page(s) use FAQPage / HowTo markup: ${listPaths(found.map((p) => p.url))}. Google no longer shows FAQ or How-to rich results for most sites (2023), so this markup brings no SERP benefit any more — it is harmless, and the Q&A text itself still helps AI answer engines.`
              : "No FAQPage / HowTo markup found — nothing relies on retired rich-result types.",
          ],
          fix: found.length ? "Keep the visible Q&A content (it is what ChatGPT and Perplexity quote); do not spend effort maintaining the markup, and do not expect FAQ rich results in Google." : "",
          effort: "low", docs: DOCS.faq, affected: found.map((p) => p.url),
        }),
      );
    }
  }

  /* ---------- schema.og ---------- */
  {
    const id = "schema.og";
    if (!e) {
      out.push(na(id, D, "low", noEntry, { docs: DOCS.openGraph }));
    } else {
      const ogTitle = metaGet(e.og, "title", "og");
      const ogDesc = metaGet(e.og, "description", "og");
      const ogImage = metaGet(e.og, "image", "og");
      const present = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
      const img = ctx.probe.ogImage;
      const imgBad = !!ogImage && img !== undefined && img !== null && (img.status !== 200 || (img.contentType !== null && !/^image\//i.test(img.contentType)));
      let status: CheckStatus = present === 3 ? "pass" : present > 0 ? "warn" : "fail";
      if (status === "pass" && imgBad) status = "warn";
      const missing = [["og:title", ogTitle], ["og:description", ogDesc], ["og:image", ogImage]].filter(([, v]) => !v).map(([k]) => k);
      out.push(
        check({
          id, dimension: D, status, severity: "low",
          evidence: [
            `${e.finalUrl}: ${present} of 3 core Open Graph tags present${missing.length ? ` (missing ${missing.join(", ")})` : ""}.`,
            ...(ogImage && img ? [imgBad ? `og:image ${ogImage} is not usable: HTTP ${img.status ?? "no response"}${img.contentType ? `, content-type ${img.contentType}` : ""}.` : `og:image ${ogImage} loads (HTTP 200${img.contentType ? `, ${img.contentType}` : ""}${typeof img.bytes === "number" ? `, ${Math.round(img.bytes / 1024)} KB` : ""}).`] : []),
          ],
          fix: status === "pass" ? "" : `Add og:title, og:description and an absolute og:image (1200×630 JPG/PNG that returns 200) to every page's <head>. Verify with: curl -s ${e.finalUrl} | grep -i 'property="og:' and by pasting the URL into LinkedIn's Post Inspector.`,
          effort: "low", docs: DOCS.openGraph,
        }),
      );
    }
  }

  /* ---------- schema.twitter ---------- */
  {
    const id = "schema.twitter";
    if (!e) {
      out.push(na(id, D, "low", noEntry, { docs: DOCS.twitterCards }));
    } else {
      const card = metaGet(e.twitter, "card", "twitter");
      if (card) {
        out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`${e.finalUrl} declares twitter:card="${card}".`], effort: "low", docs: DOCS.twitterCards }));
      } else {
        out.push(check({ id, dimension: D, status: "warn", severity: "low", evidence: [`${e.finalUrl} has no twitter:card meta tag; X/Twitter, Slack and Discord fall back to Open Graph or show a bare link.`], fix: "Add <meta name=\"twitter:card\" content=\"summary_large_image\"> (title/description/image fall back to og:*). Verify with: curl -s <url> | grep -i 'twitter:card'.", effort: "low", docs: DOCS.twitterCards }));
      }
    }
  }

  /* ---------- schema.favicon ---------- */
  {
    const id = "schema.favicon";
    if (!e) {
      out.push(na(id, D, "low", noEntry, { docs: DOCS.favicon }));
    } else if (e.hasFavicon) {
      out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`${e.finalUrl} links a favicon (Google shows it next to the site name in mobile results).`], effort: "low", docs: DOCS.favicon }));
    } else {
      out.push(check({ id, dimension: D, status: "warn", severity: "low", evidence: [`${e.finalUrl} declares no <link rel="icon"> and no /favicon.ico was detected. Mobile results show a generic globe instead of your logo.`], fix: `Add a square favicon (at least 48×48, PNG/SVG/ICO) and reference it with <link rel="icon" href="/favicon.ico"> on the homepage. Verify with: curl -I ${ctx.probe.origin}/favicon.ico — expect 200.`, effort: "low", docs: DOCS.favicon }));
    }
  }

  return out;
}
