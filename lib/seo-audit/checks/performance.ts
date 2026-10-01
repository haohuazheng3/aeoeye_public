/* ============================================================
   Performance(权重 15)—— CrUX 优先

   为什么 CrUX 优先:Lighthouse 是单次实验室跑分,抖动大;Google 排名信号
   用的是真实用户 p75(CrUX)。所以 4 个核心指标先看 psi.mobile.fieldMetrics,
   没有 field 数据才退回 lab 值,并且退回时最差只给 warn(单次实验室值
   不足以判 fail),证据里必须注明 "lab, single run"。
   PSI 没跑 / 报错 → 全部 na,总分按剩余维度重新归一(score.ts 处理)。
   ============================================================ */

import type { CheckStatus, PsiResult, SeoCheck } from "../types";
import { check, na, findAudit, percentile, pathOf, fmtKb, blockedNote, DOCS, type CheckContext } from "./helpers";

const D = "performance" as const;

interface Metric {
  id: string;
  /** 证据里用的指标名(检查标题由 titles.ts 统一生成) */
  label: string;
  severity: "high" | "medium";
  unit: "ms" | "";
  good: number;
  ni: number;
  docs: string;
  fieldKey: "lcpMs" | "inpMs" | "cls" | "ttfbMs";
  labKey: "lcpMs" | "tbtMs" | "cls" | "serverResponseMs" | null;
  labNote: string;
  fix: string;
}

const METRICS: Metric[] = [
  {
    id: "perf.cwv.lcp", label: "Largest Contentful Paint (LCP)", severity: "high", unit: "ms", good: 2500, ni: 4000, docs: DOCS.lcp,
    fieldKey: "lcpMs", labKey: "lcpMs", labNote: "lab, single run",
    fix: "Find the LCP element (usually the hero image or heading): serve it from the same origin with fetchpriority=\"high\", no lazy-loading, in a modern format sized for mobile; cut TTFB and render-blocking CSS. Target ≤2.5 s at p75. Verify in PageSpeed Insights → \"Discover what your real users are experiencing\" after 28 days, or the field LCP in Search Console → Core Web Vitals.",
  },
  {
    id: "perf.cwv.inp", label: "Interaction to Next Paint (INP)", severity: "high", unit: "ms", good: 200, ni: 500, docs: DOCS.inp,
    fieldKey: "inpMs", labKey: "tbtMs", labNote: "lab Total Blocking Time used as a proxy, single run",
    fix: "Break up long JavaScript tasks (>50 ms), defer third-party scripts, avoid heavy work in click/scroll handlers, and yield to the main thread (scheduler.yield / setTimeout) during input. Target ≤200 ms at p75. Verify with Chrome DevTools → Performance → Interactions, then field INP in Search Console.",
  },
  {
    id: "perf.cwv.cls", label: "Cumulative Layout Shift (CLS)", severity: "medium", unit: "", good: 0.1, ni: 0.25, docs: DOCS.cls,
    fieldKey: "cls", labKey: "cls", labNote: "lab, single run",
    fix: "Give images, ads, embeds and iframes explicit width/height (or aspect-ratio), reserve space for late content and cookie banners, and use font-display: optional or size-adjusted fallbacks. Target ≤0.1. Verify with DevTools → Performance → Layout Shifts.",
  },
  {
    id: "perf.cwv.ttfb", label: "Time to First Byte (TTFB)", severity: "medium", unit: "ms", good: 800, ni: 1800, docs: DOCS.ttfb,
    fieldKey: "ttfbMs", labKey: "serverResponseMs", labNote: "lab server response time, single run",
    fix: "Cache HTML at the edge/CDN (static or ISR), keep the origin close to users, avoid slow database calls on the request path, and cut redirect hops. Target ≤800 ms at p75. Verify with: curl -w '%{time_starttransfer}\\n' -o /dev/null -s <url>.",
  },
];

function fmt(v: number, unit: "ms" | ""): string {
  return unit === "ms" ? `${Math.round(v)} ms` : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function statusFor(v: number, m: Metric): CheckStatus {
  return v <= m.good ? "pass" : v <= m.ni ? "warn" : "fail";
}

/** PSI 没跑或报错 → null;否则原样。用一个变量承接,避免类型谓词在 else 分支把 psi 收窄成 never */
function usablePsi(psi: PsiResult | null): PsiResult | null {
  return psi && !psi.error ? psi : null;
}

function psiNaNote(raw: PsiResult | null): string {
  return `Not measured: PageSpeed Insights ${raw?.error ? `failed (${raw.error})` : "did not run for this audit"}.`;
}

function auditCheck(
  raw: PsiResult | null,
  opts: { id: string; auditIds: string[]; docs: string; fix: string; severity?: "low" | "medium" },
): SeoCheck {
  const sev = opts.severity ?? "low";
  const psi = usablePsi(raw);
  if (!psi) return na(opts.id, D, sev, psiNaNote(raw), { docs: opts.docs });
  const audits = opts.auditIds.map((a) => findAudit(psi, a)).filter((a): a is NonNullable<typeof a> => !!a && a.score !== null);
  if (!audits.length) return na(opts.id, D, sev, `Not measured: Lighthouse audit ${opts.auditIds.join(" / ")} was not returned (not applicable to this page or not in the report).`, { docs: opts.docs });
  const worst = audits.reduce((w, a) => ((a.score ?? 1) < (w.score ?? 1) ? a : w), audits[0]);
  const s = worst.score ?? 1;
  const status: CheckStatus = s >= 0.9 ? "pass" : s >= 0.5 ? "warn" : "fail";
  return check({
    id: opts.id, dimension: D, status, severity: sev,
    evidence: audits.map((a) => `${a.title}: ${a.displayValue || (a.score === 1 ? "passed" : "see report")} (Lighthouse score ${Math.round((a.score ?? 0) * 100)}/100, lab, mobile)`),
    fix: status === "pass" ? "" : opts.fix,
    effort: "medium", docs: opts.docs,
  });
}

export function checkPerformance(ctx: CheckContext): SeoCheck[] {
  const raw = ctx.psi.mobile;
  const psi = usablePsi(raw);
  const blocked = blockedNote(ctx);
  const out: SeoCheck[] = [];
  const psiNa = `${psiNaNote(raw)} Performance is excluded from the overall score.`;

  /* ---------- 4 个核心指标 ---------- */
  for (const m of METRICS) {
    if (!psi) {
      out.push(na(m.id, D, m.severity, psiNa, { docs: m.docs }));
      continue;
    }
    const fm = psi.fieldMetrics;
    const fieldVal = fm ? fm[m.fieldKey] : null;
    if (typeof fieldVal === "number") {
      const status = statusFor(fieldVal, m);
      out.push(
        check({
          id: m.id, dimension: D, status, severity: m.severity,
          evidence: [
            `${m.label.replace(/\s*\(.*\)$/, "")} p75 for real Chrome users on mobile: ${fmt(fieldVal, m.unit)} (${status === "pass" ? "good" : status === "warn" ? "needs improvement" : "poor"}; thresholds ≤${fmt(m.good, m.unit)} good, ≤${fmt(m.ni, m.unit)} needs improvement). Source: CrUX ${fm?.source ?? "page"}-level data${psi.fetchTime ? `, fetched ${psi.fetchTime}` : ""}.`,
          ],
          fix: status === "pass" ? "" : m.fix, effort: "high", docs: m.docs,
        }),
      );
      continue;
    }
    const labVal = m.labKey ? psi.lab?.[m.labKey] : null;
    if (typeof labVal !== "number") {
      out.push(na(m.id, D, m.severity, `Not measured: no CrUX field data for this origin (too little traffic) and no lab value for ${m.label}.`, { docs: m.docs }));
      continue;
    }
    // 没有真实用户数据:lab 值只能给到 warn,不判 fail(单次实验室跑分不够可靠)
    const raw = m.labKey === "tbtMs" ? (labVal <= 200 ? "pass" : labVal <= 600 ? "warn" : "fail") : statusFor(labVal, m);
    const status: CheckStatus = raw === "fail" ? "warn" : raw;
    out.push(
      check({
        id: m.id, dimension: D, status, severity: m.severity,
        evidence: [
          `${m.label.replace(/\s*\(.*\)$/, "")}: ${fmt(labVal, m.unit)} (${m.labNote}, mobile emulation${psi.fetchTime ? `, ${psi.fetchTime}` : ""}). No CrUX field data exists for this page or origin — not enough real-user traffic — so this is capped at "warn" rather than "fail".`,
        ],
        fix: status === "pass" ? "" : m.fix, effort: "high", docs: m.docs,
      }),
    );
  }

  /* ---------- perf.lighthouse-score(info) ---------- */
  {
    const id = "perf.lighthouse-score";
    const s = psi ? psi.scores?.performance : null;
    if (!psi || typeof s !== "number") {
      out.push(na(id, D, "low", psiNa, { docs: DOCS.lighthouseScoring }));
    } else {
      out.push(
        check({
          id, dimension: D, status: "info", severity: "low",
          evidence: [`Lighthouse performance score: ${Math.round(s)}/100 (lab, single run, mobile emulation${psi.fetchTime ? `, ${psi.fetchTime}` : ""}). Shown for reference — Google ranks on real-user Core Web Vitals, not this number.`],
          fix: "Use the score as a diagnostic: the audits below say what to change. Verify improvements over several runs, not one.",
          effort: "medium", docs: DOCS.lighthouseScoring,
        }),
      );
    }
  }

  /* ---------- perf.crawl-ttfb(我们自己抓的 20 页) ---------- */
  {
    const id = "perf.crawl-ttfb";
    const ct = ctx.probe.crawlTtfb;
    let p90: number | null = null;
    let slowest: { url: string; ms: number }[] = [];
    let n = 0;
    if (ct && typeof ct.p90 === "number") {
      p90 = ct.p90;
      slowest = ct.slowest ?? [];
      n = ctx.pages.length;
    } else {
      const measured = ctx.pages.filter((p) => typeof p.ttfbMs === "number").map((p) => ({ url: p.url, ms: p.ttfbMs as number }));
      if (measured.length) {
        n = measured.length;
        p90 = percentile(measured.map((x) => x.ms), 90);
        slowest = [...measured].sort((a, b) => b.ms - a.ms).slice(0, 3);
      }
    }
    if (p90 === null) {
      out.push(na(id, D, "medium", blocked ?? "Not measured: per-page time-to-first-byte was not recorded during the crawl.", { docs: DOCS.optimizeTtfb }));
    } else {
      const status: CheckStatus = p90 > 2500 ? "fail" : p90 > 1200 ? "warn" : "pass";
      out.push(
        check({
          id, dimension: D, status, severity: "medium",
          evidence: [
            `Across ${n} crawled pages, the p90 time-to-first-byte from our crawler was ${Math.round(p90)} ms (thresholds: ≤1200 ms ok, >2500 ms fail).`,
            ...(slowest.length ? [`Slowest: ${slowest.slice(0, 3).map((s) => `${pathOf(s.url)} ${Math.round(s.ms)} ms`).join(", ")}.`] : []),
          ],
          fix: status === "pass" ? "" : "The slow pages are usually uncached dynamic routes: add edge/CDN caching or static generation for them, index the database queries behind them, and check for slow third-party calls on the server. Verify with: curl -w '%{time_starttransfer}\\n' -o /dev/null -s <slow-url> — aim for <800 ms.",
          effort: "medium", docs: DOCS.optimizeTtfb, affected: slowest.map((s) => s.url), scope: "page",
        }),
      );
    }
  }

  /* ---------- perf.lcp-element ---------- */
  {
    const id = "perf.lcp-element";
    const ids = ["lcp-lazy-loaded", "prioritize-lcp-image", "unsized-images", "largest-contentful-paint-element"];
    if (!psi) {
      out.push(na(id, D, "medium", psiNa, { docs: DOCS.optimizeLcp }));
    } else {
      const found = ids.map((a) => findAudit(psi, a)).filter((a): a is NonNullable<typeof a> => !!a);
      const scored = found.filter((a) => a.score !== null);
      if (!found.length) {
        out.push(na(id, D, "medium", "Not measured: Lighthouse did not return the LCP-element audits for this page.", { docs: DOCS.optimizeLcp }));
      } else {
        const bad = scored.filter((a) => (a.score ?? 1) < 0.5);
        const lcpEl = found.find((a) => a.id === "largest-contentful-paint-element");
        out.push(
          check({
            id, dimension: D, status: bad.length ? "warn" : "pass", severity: "medium",
            evidence: [
              lcpEl ? `LCP element: ${lcpEl.displayValue || lcpEl.description?.slice(0, 120) || "see Lighthouse"} (lab).` : "LCP element audit not returned.",
              ...(bad.length ? bad.map((a) => `${a.title}: ${a.displayValue || "flagged"} (score ${Math.round((a.score ?? 0) * 100)}/100)`) : [`${scored.length} LCP-related audit(s) pass (${scored.map((a) => a.id).join(", ")}).`]),
            ],
            fix: bad.length ? "Do not lazy-load the LCP image; add <link rel=\"preload\"> or fetchpriority=\"high\" to it; give every image width and height so the layout is stable. Verify in PageSpeed Insights: the flagged audits should turn green." : "",
            effort: "low", docs: DOCS.optimizeLcp,
          }),
        );
      }
    }
  }

  /* ---------- 诊断性 audit(低权重) ---------- */
  out.push(
    auditCheck(raw, {
      id: "perf.weight", auditIds: ["total-byte-weight"], docs: DOCS.optimizeLcp,
      fix: `Cut the heaviest requests first (Lighthouse lists them): compress and resize images, drop unused JS bundles, self-host and subset fonts. Aim for under 1.5 MB on mobile${psi && typeof psi.lab?.totalBytes === "number" ? ` (currently ${fmtKb(psi.lab.totalBytes)})` : ""}. Verify in DevTools → Network → transferred size.`,
    }),
  );
  out.push(
    auditCheck(raw, {
      id: "perf.render-blocking", auditIds: ["render-blocking-resources"], docs: DOCS.renderBlocking,
      fix: "Inline critical CSS, load the rest with media/preload, and add defer or async to scripts in <head>. Verify: Lighthouse's render-blocking audit should list no resources.",
    }),
  );
  out.push(
    auditCheck(raw, {
      id: "perf.compression", auditIds: ["uses-text-compression"], docs: DOCS.textCompression,
      fix: "Enable brotli (or gzip) for HTML, CSS, JS, JSON and SVG at your CDN or server. Verify with: curl -sI -H 'Accept-Encoding: br,gzip' <url> | grep -i content-encoding.",
    }),
  );
  out.push(
    auditCheck(raw, {
      id: "perf.cache", auditIds: ["uses-long-cache-ttl"], docs: DOCS.httpCache,
      fix: "Serve hashed static assets with Cache-Control: public, max-age=31536000, immutable; keep HTML short-lived. Verify with: curl -sI <asset-url> | grep -i cache-control.",
    }),
  );
  out.push(
    auditCheck(raw, {
      id: "perf.images", auditIds: ["modern-image-formats", "uses-optimized-images", "uses-responsive-images"], docs: DOCS.imageFormats,
      fix: "Serve AVIF/WebP with srcset sizes that match the rendered width, and compress at quality ~75. Verify: the three image audits in Lighthouse should show 0 KiB of potential savings.",
    }),
  );
  out.push(
    auditCheck(raw, {
      id: "perf.unused-js", auditIds: ["unused-javascript"], docs: DOCS.removeUnusedCode,
      fix: "Code-split by route, lazy-load below-the-fold widgets, and remove tag-manager scripts nobody uses. Verify with DevTools → Coverage: unused bytes on first load should drop below ~30%.",
    }),
  );

  return out;
}
