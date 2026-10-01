/* ============================================================
   Mobile Usability(权重 10)

   Google 是移动优先索引:它看的是移动 UA 拿到的页面。viewport 缺失是
   唯一的 critical(页面在手机上直接不可用);其余靠 PSI 的移动端审计和
   我们自己的移动/桌面 parity 探针。PSI 缺失 → na,不惩罚。
   ============================================================ */

import type { CheckStatus, SeoCheck } from "../types";
import { check, na, findAudit, pct, listPaths, pathOf, fmtKb, blockedNote, okPages, usableEntry, entryNaNote, DOCS, type CheckContext } from "./helpers";

const D = "mobile" as const;

export function checkMobile(ctx: CheckContext): SeoCheck[] {
  const psi = ctx.psi.mobile;
  const psiOk = !!psi && !psi.error;
  const blocked = blockedNote(ctx);
  const pages = okPages(ctx);
  const out: SeoCheck[] = [];
  const psiNa = `Not measured: PageSpeed Insights ${psi?.error ? `failed (${psi.error})` : "did not run for this audit"}.`;

  /* ---------- mobile.viewport(critical) ---------- */
  {
    const id = "mobile.viewport";
    // 入口没读到内容(非 200 / 证书失败)时不能报"缺 viewport"——那是 critical 级的冤案
    const e = usableEntry(ctx);
    if (!e) {
      out.push(na(id, D, "critical", entryNaNote(ctx), { docs: DOCS.viewportMeta }));
    } else if (!e.viewport) {
      out.push(
        check({
          id, dimension: D, status: "fail", severity: "critical",
          evidence: [`${e.finalUrl} has no <meta name="viewport">. Phones render it at desktop width and shrink it; Google's mobile-first indexing treats the page as not mobile-friendly.`],
          fix: `Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head> of every page (in Next.js this is the default unless a custom viewport export removed it). Verify with: curl -s ${e.finalUrl} | grep -i 'name="viewport"'.`,
          effort: "low", docs: DOCS.viewportMeta,
        }),
      );
    } else if (!/width\s*=\s*device-width/i.test(e.viewport)) {
      out.push(
        check({
          id, dimension: D, status: "warn", severity: "critical",
          evidence: [`${e.finalUrl} has a viewport meta ("${e.viewport}") but it does not use width=device-width, so the layout will not adapt to the phone's width.`],
          fix: "Change it to content=\"width=device-width, initial-scale=1\" and avoid maximum-scale=1 / user-scalable=no (accessibility). Verify in Chrome DevTools device mode: the page should fit the viewport without horizontal scrolling.",
          effort: "low", docs: DOCS.viewportMeta,
        }),
      );
    } else {
      out.push(check({ id, dimension: D, status: "pass", severity: "critical", evidence: [`${e.finalUrl} declares <meta name="viewport" content="${e.viewport}">.`], effort: "low", docs: DOCS.viewportMeta }));
    }
  }

  /* ---------- PSI 移动端审计:font-size / tap-targets ---------- */
  const psiAudit = (id: string, auditId: string, docs: string, fix: string): SeoCheck => {
    if (!psiOk) return na(id, D, "medium", psiNa, { docs });
    const a = findAudit(psi, auditId);
    if (!a || a.score === null) return na(id, D, "medium", `Not measured: Lighthouse did not score the ${auditId} audit for this page.`, { docs });
    const status: CheckStatus = a.score >= 0.9 ? "pass" : a.score >= 0.5 ? "warn" : "fail";
    return check({
      id, dimension: D, status, severity: "medium",
      evidence: [`${a.title}: ${a.displayValue || (status === "pass" ? "passed" : "flagged")} (Lighthouse score ${Math.round(a.score * 100)}/100, mobile emulation, lab).`],
      fix: status === "pass" ? "" : fix, effort: "low", docs,
    });
  };
  out.push(psiAudit("mobile.font-size", "font-size", DOCS.fontSize, "Use at least 12px (ideally 16px) for body text on mobile and make sure ≥60% of the text meets that. Check for hard-coded small sizes in footers, tables and legal text. Verify: Lighthouse font-size audit passes."));
  out.push(psiAudit("mobile.tap-targets", "tap-targets", DOCS.tapTargets, "Make buttons and links at least 48×48 px with ≥8 px spacing on mobile (padding, not just font size); nav links and footer link lists are the usual offenders. Verify: Lighthouse tap-targets audit passes."));

  /* ---------- mobile.parity ---------- */
  {
    const id = "mobile.parity";
    const p = ctx.probe.parity;
    if (!p) {
      out.push(na(id, D, "high", blocked ?? "Not measured: the mobile-vs-desktop parity probe did not run in this audit.", { docs: DOCS.mobileFirst }));
    } else {
      const ratio = p.desktopWords > 0 ? p.mobileWords / p.desktopWords : 1;
      const missingH1 = !!p.desktopH1 && !p.mobileH1;
      const missingJsonLd = p.desktopJsonLd > 0 && p.mobileJsonLd === 0;
      const status: CheckStatus = ratio < 0.5 ? "fail" : ratio < 0.8 || missingH1 || missingJsonLd ? "warn" : "pass";
      out.push(
        check({
          id, dimension: D, status, severity: "high",
          evidence: [
            `Entry page fetched with a mobile UA vs desktop UA: ${p.mobileWords} vs ${p.desktopWords} words (${pct(p.mobileWords, p.desktopWords || 1)}%), ${p.mobileLinks} vs ${p.desktopLinks} internal links, ${p.mobileJsonLd} vs ${p.desktopJsonLd} JSON-LD blocks${missingH1 ? `, and the H1 "${p.desktopH1}" is missing on mobile` : ""}.`,
            "Google indexes the mobile version; anything only the desktop version has is invisible to ranking.",
          ],
          fix: status === "pass" ? "" : "Serve the same primary content, headings, internal links and structured data to mobile users (responsive layout, no separate stripped-down mobile template). Verify with: curl -A 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile' <url> and compare word count and JSON-LD against the desktop UA.",
          effort: "medium", docs: DOCS.mobileFirst,
        }),
      );
    }
  }

  /* ---------- mobile.images.dims(page) ---------- */
  {
    const id = "mobile.images.dims";
    const measured = pages.filter((p) => typeof p.imagesMissingDims === "number");
    if (!measured.length) {
      out.push(na(id, D, "low", blocked ?? "Not measured: missing width/height attributes on images were not counted in this run.", { docs: DOCS.optimizeCls, scope: "page" }));
    } else {
      const totalImg = measured.reduce((n, p) => n + (p.images?.total ?? 0), 0);
      const missing = measured.reduce((n, p) => n + (p.imagesMissingDims ?? 0), 0);
      if (totalImg === 0) {
        out.push(na(id, D, "low", `Not applicable: no <img> elements across ${measured.length} crawled pages.`, { docs: DOCS.optimizeCls, scope: "page" }));
      } else {
        const share = missing / totalImg;
        const status: CheckStatus = missing === 0 ? "pass" : share <= 0.2 ? "warn" : "fail";
        const affected = measured.filter((p) => (p.imagesMissingDims ?? 0) > 0);
        out.push(
          check({
            id, dimension: D, status, severity: "low",
            evidence: [`Across ${measured.length} crawled pages, ${missing} of ${totalImg} images (${pct(missing, totalImg)}%) lack width/height attributes${affected.length ? `; pages: ${listPaths(affected.map((p) => p.url))}` : ""}. Unsized images cause layout shift on narrow screens.`],
            fix: status === "pass" ? "" : "Add width and height (or CSS aspect-ratio) to every <img>; frameworks like next/image do this automatically. Verify: Lighthouse's \"unsized-images\" audit passes and CLS drops.",
            effort: "low", docs: DOCS.optimizeCls, affected: affected.map((p) => p.url), scope: "page",
          }),
        );
      }
    }
  }

  /* ---------- mobile.images.large ---------- */
  {
    const id = "mobile.images.large";
    const li = ctx.probe.largeImages;
    if (!Array.isArray(li)) {
      out.push(na(id, D, "low", blocked ?? "Not measured: image sizes were not sampled in this run.", { docs: DOCS.imageFormats }));
    } else {
      const n = li.length;
      const status: CheckStatus = n === 0 ? "pass" : n <= 3 ? "warn" : "fail";
      out.push(
        check({
          id, dimension: D, status, severity: "low",
          evidence: [
            n === 0 ? "None of the sampled images exceeds 200 KB." : `${n} sampled image(s) exceed 200 KB: ${li.slice(0, 5).map((x) => `${pathOf(x.url)} (${fmtKb(x.bytes)})`).join(", ")}. On mobile data these dominate load time.`,
          ],
          fix: status === "pass" ? "" : "Resize to the largest rendered width (usually ≤1600 px), convert to AVIF/WebP at quality ~75 and serve srcset variants. Verify with: curl -sI <image-url> | grep -i content-length — aim for <200 KB, hero ≤300 KB.",
          effort: "low", docs: DOCS.imageFormats, affected: li.map((x) => x.url),
        }),
      );
    }
  }

  /* ---------- mobile.accessibility(info) ---------- */
  {
    const id = "mobile.accessibility";
    const s = psiOk ? psi.scores?.accessibility : null;
    if (typeof s !== "number") {
      out.push(na(id, D, "low", psiNa, { docs: DOCS.accessibility }));
    } else {
      out.push(
        check({
          id, dimension: D, status: "info", severity: "low",
          evidence: [`Lighthouse accessibility score: ${Math.round(s)}/100 (mobile, lab). Shown for reference; not part of the SEO score, but contrast, labels and link names overlap with what crawlers read.`],
          fix: "Open the PageSpeed Insights accessibility section for the specific failing audits (contrast, missing labels, link names).",
          effort: "medium", docs: DOCS.accessibility,
        }),
      );
    }
  }

  return out;
}
