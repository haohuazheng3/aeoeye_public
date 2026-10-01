/* ============================================================
   On-Page & Content(权重 20)

   V2 把原 Content Quality 维度并进来了:词数/薄页/近重复都在这里。
   几乎全是页面级检查 —— 状态由受影响页占比决定(helpers.pageCheck),
   证据第一句永远是样本量,避免"3 个页面缺标题"在 3 页和 300 页的站里
   被读成同一件事。
   ============================================================ */

import type { CrawledPage, SeoCheck } from "../types";
import {
  check,
  na,
  pageCheck,
  okPages,
  pathOf,
  listPaths,
  pct,
  tokenize,
  jaccard,
  slugTokens,
  minhashSimilarity,
  clusters,
  pageTypeOf,
  blockedNote,
  usableEntry,
  entryNaNote,
  DOCS,
  type CheckContext,
} from "./helpers";

const D = "onpage" as const;

const TITLE_MIN = 20;
const TITLE_MAX = 60;
const DESC_MAX = 160;
const THIN_WORDS = 200;
const NEAR_DUP_SIM = 0.8;

function trimmed(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function groupBy(pages: CrawledPage[], key: (p: CrawledPage) => string): Map<string, CrawledPage[]> {
  const m = new Map<string, CrawledPage[]>();
  for (const p of pages) {
    const k = key(p);
    if (!k) continue;
    const g = m.get(k) ?? [];
    g.push(p);
    m.set(k, g);
  }
  return m;
}

export function checkOnPage(ctx: CheckContext): SeoCheck[] {
  const pages = okPages(ctx);
  const urls = pages.map((p) => p.url);
  const blocked = blockedNote(ctx);
  const naNote = blocked ?? "Not measured: no crawled HTML pages.";
  const out: SeoCheck[] = [];

  /* ---------- JS 空壳页(复审 C22) ----------
     title / description / lang 在 <head> 里,原始 HTML 有没有就是事实,照常评;
     但 H1、标题层级、图片 alt、词数、近重复只在脚本跑完后才存在 —— 在空壳上判"缺 H1"是冤案。
     空壳 = 解析层标了 jsShell 的页,或 probe 判定 JS 依赖时的入口页。按页剔除而不是全站一刀切:
     入口是壳、sitemap 抽到的文章页是服务端渲染的,文章页照样能评。 */
  const jsDependent = ctx.probe.jsDependent === true;
  const entryUrl = ctx.entry?.url;
  const isShell = (p: CrawledPage) => p.jsShell === true || (jsDependent && (p === ctx.entry || (!!entryUrl && p.url === entryUrl)));
  const bodyPages = pages.filter((p) => !isShell(p));
  const shellPages = pages.filter(isShell);
  const SHELL_NA = `Not measured: based on raw HTML, which is a JavaScript shell — headings, images and body text only appear after scripts run (${shellPages.length} of ${pages.length} crawled page(s) are shells).`;
  /** 渲染类检查的 na 说明:没页 → 原说明;页全是壳 → 空壳说明 */
  const bodyNa = pages.length && !bodyPages.length ? SHELL_NA : naNote;
  /** 部分页是壳时追加的证据:说清排除了谁,分母为什么比抓取页数少 */
  const shellLine = shellPages.length && bodyPages.length ? [`${shellPages.length} JavaScript-shell page(s) excluded (raw HTML only, nothing to measure before scripts run): ${listPaths(shellPages.map((p) => p.url), 3)}.`] : [];

  /* ---------- titles ---------- */
  const noTitle = pages.filter((p) => !trimmed(p.title));
  out.push(
    pageCheck({
      id: "onpage.title.present", dimension: D, severity: "high",
      universe: urls, affected: noTitle.map((p) => p.url),
      what: "are missing a <title>",
      fix: "Write a unique, descriptive <title> for each listed page (primary topic first, brand last, ≤60 characters). Verify with: curl -s <url> | grep -o '<title>[^<]*' — every page must print one.",
      docs: DOCS.titleLink, effort: "low", naNote,
    }),
  );

  const badLen = pages.filter((p) => {
    const n = trimmed(p.title).length;
    return n > 0 && (n < TITLE_MIN || n > TITLE_MAX);
  });
  out.push(
    pageCheck({
      id: "onpage.title.length", dimension: D, severity: "low",
      universe: pages.filter((p) => trimmed(p.title)).map((p) => p.url), affected: badLen.map((p) => p.url),
      unit: "pages with a title",
      what: `have a title shorter than ${TITLE_MIN} or longer than ${TITLE_MAX} characters (Google rewrites or truncates these)`,
      fix: `Rewrite the listed titles to ${TITLE_MIN}–${TITLE_MAX} characters: keep the main keyword and the page's promise, drop boilerplate. Verify by checking the Search Console "Title link" after re-indexing, or simply count characters.`,
      docs: DOCS.titleLink, effort: "low",
      extra: badLen.slice(0, 4).map((p) => `${pathOf(p.url)}: "${trimmed(p.title).slice(0, 80)}${trimmed(p.title).length > 80 ? "…" : ""}" (${trimmed(p.title).length} chars)`),
      naNote,
    }),
  );

  const titleGroups = Array.from(groupBy(pages, (p) => trimmed(p.title).toLowerCase()).values()).filter((g) => g.length > 1);
  out.push(
    pageCheck({
      id: "onpage.title.unique", dimension: D, severity: "medium",
      universe: pages.filter((p) => trimmed(p.title)).map((p) => p.url), affected: titleGroups.flat().map((p) => p.url),
      unit: "pages with a title",
      what: `share a title with another page (${titleGroups.length} duplicate group${titleGroups.length === 1 ? "" : "s"})`,
      fix: "Make each title specific to its page — duplicate titles tell Google the pages are interchangeable, so only one tends to rank. Verify: no two URLs in the page table should print the same title.",
      docs: DOCS.titleLink, effort: "low",
      extra: titleGroups.slice(0, 4).map((g) => `"${trimmed(g[0].title).slice(0, 60)}" is used on ${g.length} pages: ${listPaths(g.map((p) => p.url), 4)}`),
      naNote,
    }),
  );

  {
    const candidates = bodyPages.filter((p) => trimmed(p.title) && p.h1s?.length && pageTypeOf(p) !== "home");
    const detail: string[] = [];
    const low = candidates.filter((p) => {
      const t = tokenize(p.title);
      const h = tokenize(p.h1s[0]);
      const s = slugTokens(p.url);
      const jh = jaccard(t, h);
      const js = s.size ? jaccard(t, s) : 0;
      const overlap = Math.max(jh, js);
      if (overlap < 0.2) detail.push(`${pathOf(p.url)}: title "${trimmed(p.title).slice(0, 50)}" vs H1 "${trimmed(p.h1s[0]).slice(0, 50)}" (overlap ${overlap.toFixed(2)})`);
      return overlap < 0.2;
    });
    out.push(
      pageCheck({
        id: "onpage.title.h1-slug-overlap", dimension: D, severity: "low",
        universe: candidates.map((p) => p.url), affected: low.map((p) => p.url),
        unit: "pages with a title and an H1",
        what: "have a title that shares almost no words with the H1 or the URL slug (Jaccard < 0.2)",
        fix: "Align the three signals: the title, the H1 and the slug should name the same topic in similar words (they don't have to be identical). Verify by reading title vs H1 side by side in the page table.",
        docs: DOCS.starterGuide, effort: "low", extra: [...detail.slice(0, 4), ...shellLine],
        naNote: blocked ?? (pages.length && !bodyPages.length ? SHELL_NA : "Not applicable: no crawled page has both a title and an H1."),
      }),
    );
  }

  /* ---------- descriptions ---------- */
  const noDesc = pages.filter((p) => !trimmed(p.description));
  out.push(
    pageCheck({
      id: "onpage.description.present", dimension: D, severity: "medium",
      universe: urls, affected: noDesc.map((p) => p.url),
      what: "have no meta description (Google will pick a random snippet)",
      fix: "Add <meta name=\"description\"> (70–160 characters, a concrete promise plus a reason to click) to each listed page. Verify with: curl -s <url> | grep -i 'name=\"description\"'.",
      docs: DOCS.snippet, effort: "low", naNote,
    }),
  );
  const longDesc = pages.filter((p) => trimmed(p.description).length > DESC_MAX);
  out.push(
    pageCheck({
      id: "onpage.description.length", dimension: D, severity: "low",
      universe: pages.filter((p) => trimmed(p.description)).map((p) => p.url), affected: longDesc.map((p) => p.url),
      unit: "pages with a description",
      what: `have a description longer than ${DESC_MAX} characters (truncated in results)`,
      fix: `Trim the listed descriptions to ≤${DESC_MAX} characters, front-loading the key benefit. Verify by counting characters in the page table.`,
      docs: DOCS.snippet, effort: "low",
      extra: longDesc.slice(0, 3).map((p) => `${pathOf(p.url)}: ${trimmed(p.description).length} chars`),
      naNote,
    }),
  );
  const descGroups = Array.from(groupBy(pages, (p) => trimmed(p.description).toLowerCase()).values()).filter((g) => g.length > 1);
  out.push(
    pageCheck({
      id: "onpage.description.unique", dimension: D, severity: "low",
      universe: pages.filter((p) => trimmed(p.description)).map((p) => p.url), affected: descGroups.flat().map((p) => p.url),
      unit: "pages with a description",
      what: `reuse a description found on another page (${descGroups.length} group${descGroups.length === 1 ? "" : "s"})`,
      fix: "Write a page-specific description for each listed URL, or remove the site-wide default so Google generates one from the content. Verify: no repeated descriptions in the page table.",
      docs: DOCS.snippet, effort: "low",
      extra: descGroups.slice(0, 3).map((g) => `"${trimmed(g[0].description).slice(0, 60)}…" on ${g.length} pages: ${listPaths(g.map((p) => p.url), 4)}`),
      naNote,
    }),
  );

  /* ---------- headings ---------- */
  const bodyUrls = bodyPages.map((p) => p.url);
  const noH1 = bodyPages.filter((p) => !(p.h1s?.length));
  out.push(
    pageCheck({
      id: "onpage.h1.missing", dimension: D, severity: "medium",
      universe: bodyUrls, affected: noH1.map((p) => p.url),
      what: "have no <h1>",
      fix: "Add exactly one <h1> that states the page topic (often the same as the title without the brand). Verify with: curl -s <url> | grep -c '<h1' — expect 1.",
      docs: DOCS.starterGuide, effort: "low", extra: shellLine, naNote: bodyNa,
    }),
  );
  const multiH1 = bodyPages.filter((p) => (p.h1s?.length ?? 0) > 1);
  out.push(
    pageCheck({
      id: "onpage.h1.multiple", dimension: D, severity: "low",
      universe: bodyUrls, affected: multiH1.map((p) => p.url),
      what: "have more than one <h1>",
      fix: "Keep one <h1> per page and demote the others to <h2> (logo text and section labels are the usual culprits). Verify with: curl -s <url> | grep -c '<h1' — expect 1.",
      docs: DOCS.starterGuide, effort: "low",
      extra: [...multiH1.slice(0, 3).map((p) => `${pathOf(p.url)}: ${p.h1s.length} H1s (${p.h1s.slice(0, 2).map((h) => `"${trimmed(h).slice(0, 30)}"`).join(", ")})`), ...shellLine],
      naNote: bodyNa,
    }),
  );
  const skipDetail: string[] = [];
  const skips = bodyPages.filter((p) => {
    let prev = 1;
    for (const h of p.headings ?? []) {
      if (h.level > prev + 1) {
        skipDetail.push(`${pathOf(p.url)}: h${prev} → h${h.level}`);
        return true;
      }
      prev = h.level;
    }
    return false;
  });
  out.push(
    pageCheck({
      id: "onpage.headings.order", dimension: D, severity: "low",
      universe: bodyPages.filter((p) => (p.headings?.length ?? 0) > 0).map((p) => p.url), affected: skips.map((p) => p.url),
      unit: "pages with headings",
      what: "skip a heading level (e.g. h1 → h3), which breaks the outline that Google and screen readers build",
      fix: "Use headings as an outline: h1 → h2 → h3, never jumping levels; style with CSS, not by picking a smaller heading tag. Verify with a headings outline extension or Lighthouse's heading-order audit.",
      docs: DOCS.starterGuide, effort: "low", extra: [...skipDetail.slice(0, 4), ...shellLine],
      naNote: pages.length && bodyPages.length ? "Not applicable: none of the crawled pages has headings." : bodyNa,
    }),
  );

  /* ---------- images.alt(按图片数占比,阈值 10%/30%) ---------- */
  {
    const id = "onpage.images.alt";
    const totalImg = bodyPages.reduce((n, p) => n + (p.images?.total ?? 0), 0);
    const missing = bodyPages.reduce((n, p) => n + (p.images?.missingAlt ?? 0), 0);
    const affected = bodyPages.filter((p) => (p.images?.missingAlt ?? 0) > 0);
    if (!bodyPages.length) {
      out.push(na(id, D, "medium", bodyNa, { docs: DOCS.images, scope: "page" }));
    } else if (totalImg === 0) {
      out.push(na(id, D, "medium", `Not applicable: no <img> elements across ${bodyPages.length} crawled pages.`, { docs: DOCS.images, scope: "page" }));
    } else {
      const share = missing / totalImg;
      const status = share <= 0.1 ? "pass" : share <= 0.3 ? "warn" : "fail";
      out.push(
        check({
          id, dimension: D, status, severity: "medium",
          evidence: [
            `Across ${bodyPages.length} crawled pages, ${missing} of ${totalImg} images (${pct(missing, totalImg)}%) have no alt attribute${affected.length ? `; pages affected: ${listPaths(affected.map((p) => p.url))}` : ""}.`,
            ...affected.slice(0, 3).map((p) => `${pathOf(p.url)}: ${p.images.missingAlt} of ${p.images.total} images without alt`),
            ...shellLine,
          ],
          fix: status === "pass" ? "" : "Add a descriptive alt to every content image (what is in the picture, in plain words; alt=\"\" only for pure decoration). Verify with: curl -s <url> | grep -c '<img' vs grep -c 'alt=' — the counts should match.",
          docs: DOCS.images, effort: "medium",
          affected: affected.map((p) => p.url), scope: "page",
        }),
      );
    }
  }

  /* ---------- thin(只对 article 页) ---------- */
  {
    const id = "onpage.thin";
    if (!bodyPages.length) {
      out.push(na(id, D, "medium", bodyNa, { docs: DOCS.helpfulContent, scope: "page" }));
    } else {
      const articles = bodyPages.filter((p) => pageTypeOf(p) === "article");
      const thinArticles = articles.filter((p) => p.wordCount < THIN_WORDS);
      const otherThin = bodyPages.filter((p) => pageTypeOf(p) !== "article" && !["legal", "contact"].includes(pageTypeOf(p)) && p.wordCount < THIN_WORDS);
      if (!articles.length) {
        out.push(
          check({
            id, dimension: D, status: otherThin.length ? "info" : "pass", severity: "medium",
            evidence: [
              `Across ${bodyPages.length} crawled pages, none is an article, so the thin-content rule (<${THIN_WORDS} words) is not applied.`,
              otherThin.length ? `${otherThin.length} non-article page(s) have fewer than ${THIN_WORDS} words: ${listPaths(otherThin.map((p) => p.url))} — fine for tools or forms, worth a look if they are meant to rank.` : "No page is under 200 words.",
              ...shellLine,
            ],
            fix: otherThin.length ? "For any listed page that targets a search query, add the content a searcher needs (answer first, then details). Verify: word count ≥ 200 after the change." : "",
            docs: DOCS.helpfulContent, effort: "medium", affected: otherThin.map((p) => p.url), scope: "page",
          }),
        );
      } else {
        out.push(
          pageCheck({
            id, dimension: D, severity: "medium",
            universe: articles.map((p) => p.url), affected: thinArticles.map((p) => p.url),
            unit: "article pages",
            what: `have fewer than ${THIN_WORDS} words of visible text`,
            fix: "Expand or consolidate the listed articles: answer the question in the first two sentences, then add the specifics (steps, numbers, examples). Merge stubs into a stronger page and 301 the stub. Verify: word count ≥ 200 and the page ranks for its own query.",
            docs: DOCS.helpfulContent, effort: "high",
            extra: [
              ...thinArticles.slice(0, 3).map((p) => `${pathOf(p.url)}: ${p.wordCount} words`),
              ...(otherThin.length ? [`${otherThin.length} non-article page(s) are also under ${THIN_WORDS} words (not scored): ${listPaths(otherThin.map((p) => p.url), 3)}.`] : []),
              ...shellLine,
            ],
          }),
        );
      }
    }
  }

  /* ---------- near-duplicate(minhash) ---------- */
  {
    const id = "onpage.near-duplicate";
    const hashed = bodyPages.filter((p) => Array.isArray(p.minhash) && p.minhash.length > 0);
    if (pages.length && !bodyPages.length) {
      out.push(na(id, D, "medium", SHELL_NA, { docs: DOCS.canonical, scope: "page" }));
    } else if (hashed.length < 2) {
      out.push(na(id, D, "medium", blocked ?? "Not measured: text fingerprints (minhash) were not available for at least two pages.", { docs: DOCS.canonical, scope: "page" }));
    } else {
      const pairs: [number, number][] = [];
      const sims = new Map<string, number>();
      for (let i = 0; i < hashed.length; i += 1) {
        for (let j = i + 1; j < hashed.length; j += 1) {
          const s = minhashSimilarity(hashed[i].minhash, hashed[j].minhash);
          if (s !== null && s >= NEAR_DUP_SIM) {
            pairs.push([i, j]);
            sims.set(`${i}-${j}`, s);
          }
        }
      }
      const groups = clusters(hashed.length, pairs);
      const affected = groups.flat().map((i) => hashed[i].url);
      out.push(
        pageCheck({
          id, dimension: D, severity: "medium",
          universe: hashed.map((p) => p.url), affected,
          what: `are near-duplicates of another page (estimated text similarity ≥ ${NEAR_DUP_SIM * 100}%, ${groups.length} cluster${groups.length === 1 ? "" : "s"})`,
          fix: "For each cluster keep one page, 301 the others to it (or set their canonical to it if they must stay live), and differentiate the survivors' content. Verify in Search Console → Pages: \"Duplicate without user-selected canonical\" should drop.",
          docs: DOCS.canonical, effort: "medium",
          extra: [...groups.slice(0, 3).map((g) => `Cluster: ${listPaths(g.map((i) => hashed[i].url), 4)} (similarity ${(Math.max(...g.flatMap((a) => g.map((b) => sims.get(`${Math.min(a, b)}-${Math.max(a, b)}`) ?? 0))) * 100).toFixed(0)}%)`), ...shellLine],
        }),
      );
    }
  }

  /* ---------- url.hygiene ---------- */
  {
    const detail: string[] = [];
    const bad = pages.filter((p) => {
      let path = "";
      let params = 0;
      try {
        const u = new URL(p.url);
        path = u.pathname;
        params = Array.from(u.searchParams.keys()).length;
      } catch {
        return false;
      }
      const reasons: string[] = [];
      if (/[A-Z]/.test(path)) reasons.push("uppercase");
      if (/_/.test(path)) reasons.push("underscore");
      if (p.url.length > 100) reasons.push(`${p.url.length} chars`);
      if (params >= 3) reasons.push(`${params} query params`);
      if (reasons.length) detail.push(`${pathOf(p.url)}: ${reasons.join(", ")}`);
      return reasons.length > 0;
    });
    out.push(
      pageCheck({
        id: "onpage.url.hygiene", dimension: D, severity: "low",
        universe: urls, affected: bad.map((p) => p.url),
        what: "have URLs with uppercase letters, underscores, more than 100 characters or 3+ query parameters",
        fix: "Prefer short lowercase paths with hyphens (/blog/ai-visibility-audit); 301 old URLs to the new ones and keep query parameters out of canonical URLs. Verify: the canonical of each listed page should be the clean form.",
        docs: DOCS.urlStructure, effort: "medium", extra: detail.slice(0, 4), naNote,
      }),
    );
  }

  /* ---------- lang ---------- */
  {
    const id = "onpage.lang";
    const e = usableEntry(ctx);
    if (!e) {
      out.push(na(id, D, "low", entryNaNote(ctx), { docs: DOCS.langAttr }));
    } else if (e.lang) {
      out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`${e.finalUrl} declares <html lang="${e.lang}">.`], effort: "low", docs: DOCS.langAttr }));
    } else {
      out.push(check({ id, dimension: D, status: "warn", severity: "low", evidence: [`${e.finalUrl} has no lang attribute on <html>. Screen readers and some crawlers guess the language.`], fix: "Add lang to the root element, e.g. <html lang=\"en\">. Verify with: curl -s <url> | grep -o '<html[^>]*>'.", effort: "low", docs: DOCS.langAttr }));
    }
  }

  /* ---------- robots-nofollow(内链 nofollow 占比) ---------- */
  {
    const id = "onpage.robots-nofollow";
    // 内链同样是渲染后才有的东西:空壳页上"0 条链接、0% nofollow"不是达标,是没测(复审 C22)
    const measured = bodyPages.filter((p) => typeof p.nofollowInternal === "number");
    if (pages.length && !bodyPages.length) {
      out.push(na(id, D, "low", SHELL_NA, { docs: DOCS.outboundLinks }));
    } else if (!measured.length) {
      out.push(na(id, D, "low", blocked ?? "Not measured: rel=\"nofollow\" on internal links was not counted in this run.", { docs: DOCS.outboundLinks }));
    } else {
      const total = measured.reduce((n, p) => n + (p.internalLinks ?? 0), 0);
      const nofollow = measured.reduce((n, p) => n + (p.nofollowInternal ?? 0), 0);
      const share = total ? nofollow / total : 0;
      const affected = measured.filter((p) => (p.nofollowInternal ?? 0) > 0);
      out.push(
        check({
          id, dimension: D, status: share > 0.1 ? "warn" : "pass", severity: "low",
          evidence: [`Across ${measured.length} crawled pages, ${nofollow} of ${total} internal links (${pct(nofollow, total)}%) carry rel="nofollow"${affected.length ? `; pages: ${listPaths(affected.map((p) => p.url))}` : ""}.`, ...shellLine],
          fix: share > 0.1 ? "Remove rel=\"nofollow\" from internal links — it throws away the PageRank you are trying to pass between your own pages. Keep it only for login/cart style links. Verify by re-crawling: nofollow share should be ≤10%." : "",
          docs: DOCS.outboundLinks, effort: "low", affected: affected.map((p) => p.url), scope: "page",
        }),
      );
    }
  }

  return out;
}
