/* ============================================================
   性能 / 移动 / 安全:Core Web Vitals(PageSpeed Insights 的 CrUX 真实用户数据 + Lighthouse 实验室数据)、
   移动友好(Lighthouse 手机截图 + 视口检查)、安全响应头评分、HSTS 与 preload 资格。
   阈值:web.dev/articles/vitals(LCP ≤2.5s、INP ≤200ms、CLS ≤0.1,按 p75);
   HSTS preload 要求:hstspreload.org(max-age ≥ 31536000、includeSubDomains、preload、根域 http→https)。
   ============================================================ */

import { env } from "@/lib/env";
import { parseTarget, fetchAs, fetchNoFollow, header, isHtml, fetchFailure } from "../net";
import { parseDoc, metaTags, metaValue } from "../html";
import { type ToolResult, type CheckItem, type Status, worst, errorResult } from "../types";

const now = () => new Date().toISOString();

interface PsiJson {
  loadingExperience?: { overall_category?: string; metrics?: Record<string, { percentile: number; category: string }> };
  originLoadingExperience?: { overall_category?: string; metrics?: Record<string, { percentile: number; category: string }> };
  lighthouseResult?: {
    finalUrl?: string;
    categories?: Record<string, { score: number | null }>;
    audits?: Record<string, { score?: number | null; numericValue?: number; displayValue?: string; title?: string; details?: { type?: string; data?: string; overallSavingsMs?: number } }>;
  };
  error?: { message?: string };
}

async function psi(url: string, strategy: "mobile" | "desktop", categories: string[] = ["performance"]): Promise<PsiJson> {
  if (!env.PSI_API) throw new Error("PageSpeed Insights isn't configured on this server.");
  const qs = new URLSearchParams({ url, strategy, key: env.PSI_API });
  for (const c of categories) qs.append("category", c);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { signal: AbortSignal.timeout(55_000) });
  const json = (await res.json().catch(() => ({}))) as PsiJson;
  if (!res.ok) throw new Error(json.error?.message?.replace(/\s*\(.*$/s, "") || `PageSpeed Insights returned HTTP ${res.status}`);
  return json;
}

const rate = (v: number | null, good: number, ni: number): Status => (v === null ? "info" : v <= good ? "pass" : v <= ni ? "warn" : "fail");
const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

/* ---------------- Core Web Vitals ---------------- */

export async function coreWebVitals(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  let j: PsiJson;
  try { j = await psi(t.url, "mobile"); } catch (e) { return errorResult("cwv", input, (e as Error).message); }
  const page = j.loadingExperience?.metrics;
  const origin = j.originLoadingExperience?.metrics;
  const field = page && Object.keys(page).length ? { m: page, scope: "this URL" } : origin && Object.keys(origin).length ? { m: origin, scope: "the whole origin (not enough data for this URL)" } : null;
  const f = (k: string) => (field?.m[k]?.percentile ?? null);
  const lcp = f("LARGEST_CONTENTFUL_PAINT_MS"), inp = f("INTERACTION_TO_NEXT_PAINT"), clsRaw = f("CUMULATIVE_LAYOUT_SHIFT_SCORE"), ttfb = f("EXPERIMENTAL_TIME_TO_FIRST_BYTE");
  const cls = clsRaw === null ? null : clsRaw / 100;
  const a = j.lighthouseResult?.audits ?? {};
  const lab = (id: string) => (typeof a[id]?.numericValue === "number" ? (a[id].numericValue as number) : null);
  const perf = j.lighthouseResult?.categories?.performance?.score;
  const items: CheckItem[] = field ? [
    { label: "LCP (Largest Contentful Paint)", status: rate(lcp, 2500, 4000), value: ms(lcp), detail: "p75 of real Chrome users. Good ≤ 2.5 s." },
    { label: "INP (Interaction to Next Paint)", status: rate(inp, 200, 500), value: ms(inp), detail: "p75. Good ≤ 200 ms. Replaced FID in March 2024." },
    { label: "CLS (Cumulative Layout Shift)", status: rate(cls, 0.1, 0.25), value: cls === null ? "—" : cls.toFixed(2), detail: "p75. Good ≤ 0.1." },
    { label: "TTFB (Time to First Byte)", status: rate(ttfb, 800, 1800), value: ms(ttfb), detail: "Experimental in CrUX. Good ≤ 0.8 s." },
  ] : [{ label: "Field data (CrUX)", status: "info", value: "not available", detail: "Chrome doesn't have enough real-user visits to this site to report Core Web Vitals. The lab numbers below are a single simulated run — useful for debugging, not a pass/fail." }];
  const passed = field ? [lcp !== null && lcp <= 2500, inp === null || inp <= 200, cls !== null && cls <= 0.1].every(Boolean) : null;
  const labItems: CheckItem[] = [
    { label: "Lighthouse performance score (mobile)", status: perf == null ? "info" : perf >= 0.9 ? "pass" : perf >= 0.5 ? "warn" : "fail", value: perf == null ? "—" : String(Math.round(perf * 100)) },
    { label: "LCP (lab)", status: rate(lab("largest-contentful-paint"), 2500, 4000), value: ms(lab("largest-contentful-paint")) },
    { label: "TBT (lab proxy for INP)", status: rate(lab("total-blocking-time"), 200, 600), value: ms(lab("total-blocking-time")) },
    { label: "CLS (lab)", status: rate(lab("cumulative-layout-shift"), 0.1, 0.25), value: lab("cumulative-layout-shift")?.toFixed(2) ?? "—" },
    { label: "First Contentful Paint (lab)", status: rate(lab("first-contentful-paint"), 1800, 3000), value: ms(lab("first-contentful-paint")) },
    { label: "Speed Index (lab)", status: rate(lab("speed-index"), 3400, 5800), value: ms(lab("speed-index")) },
  ];
  const opps = Object.entries(a).filter(([, x]) => x.details?.type === "opportunity" && (x.details.overallSavingsMs ?? 0) > 100).sort((x, y) => (y[1].details?.overallSavingsMs ?? 0) - (x[1].details?.overallSavingsMs ?? 0)).slice(0, 6).map(([, x]) => [x.title ?? "", ms(x.details?.overallSavingsMs ?? null), x.displayValue ?? ""]);
  return {
    ok: true, tool: "cwv", input, url: j.lighthouseResult?.finalUrl ?? t.url, fetchedAt: now(),
    verdict: passed === null ? "info" : passed ? "pass" : "fail",
    score: perf == null ? null : Math.round(perf * 100),
    headline: passed === null ? `No real-user data for this site yet; Lighthouse lab score ${perf == null ? "—" : Math.round(perf * 100)}/100 on mobile.` : passed ? `Passes Core Web Vitals on mobile (field data for ${field!.scope}).` : `Fails Core Web Vitals on mobile (field data for ${field!.scope}).`,
    sections: [
      { title: field ? `Real users (CrUX, last 28 days, ${field.scope})` : "Real users (CrUX)", kind: "checks", items },
      { title: "Lighthouse test (mobile, simulated)", kind: "checks", items: labItems },
      ...(opps.length ? [{ title: "Biggest fixes (estimated savings)", kind: "table" as const, table: { columns: ["Opportunity", "Est. savings", "Detail"], rows: opps } }] : []),
    ],
  };
}

/* ---------------- 移动友好 ---------------- */

export async function mobileFriendly(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  // 页面本身按手机浏览器读取;Googlebot 单独请求一次。很多站按 IP 校验 Googlebot,会拒绝我们这种
  // "UA 是 Googlebot、IP 不是 Google"的请求 —— 那是正确的防护,不能因此把视口等检查判成缺失。
  const [r, g, jr] = await Promise.allSettled([fetchAs(t.url, "mobilebrowser"), fetchAs(t.url, "googlebot"), psi(t.url, "mobile", ["performance", "accessibility"])]);
  const page = r.status === "fulfilled" ? r.value : null;
  const gb = g.status === "fulfilled" ? g.value : null;
  if (!page || page.status === 0) return errorResult("mobile", input, page ? fetchFailure(page) ?? "Unreachable" : "Unreachable");
  const items: CheckItem[] = [];
  const doc = isHtml(page) ? parseDoc(page.body) : null;
  const tags = doc ? metaTags(doc) : [];
  const vp = metaValue(tags, "viewport");
  items.push(!vp ? { label: "Viewport meta tag", status: "fail", value: "missing", detail: "Phones render the page at desktop width and shrink it. Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">." } : { label: "Viewport meta tag", status: /width\s*=\s*device-width/.test(vp) ? "pass" : "warn", value: vp, detail: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(vp) ? "Blocking zoom hurts accessibility; remove user-scalable=no / maximum-scale=1." : undefined });
  const fixedWide = (page.body.match(/\bwidth\s*:\s*(\d{4,})px/gi) ?? []).length;
  if (fixedWide) items.push({ label: "Fixed-width elements", status: "warn", value: `${fixedWide} inline width ≥ 1000px`, detail: "Fixed pixel widths wider than a phone cause sideways scrolling." });
  const shot = jr.status === "fulfilled" ? jr.value.lighthouseResult?.audits?.["final-screenshot"]?.details?.data ?? null : null;
  if (jr.status === "fulfilled") {
    const a = jr.value.lighthouseResult?.audits ?? {};
    const acc = jr.value.lighthouseResult?.categories?.accessibility?.score;
    const tapAudit = a["target-size"];
    if (tapAudit) items.push({ label: "Tap target size", status: tapAudit.score === 1 ? "pass" : tapAudit.score == null ? "info" : "warn", value: tapAudit.score === 1 ? "large enough" : tapAudit.displayValue || "some targets too small or close", detail: "Buttons and links should be at least 24×24 CSS px with spacing (WCAG 2.2 target size)." });
    const fs = a["font-size"];
    if (fs) items.push({ label: "Legible font sizes", status: fs.score === 1 ? "pass" : "warn", value: fs.displayValue || (fs.score === 1 ? "OK" : "text too small") });
    const cw = a["content-width"];
    if (cw) items.push({ label: "Content fits the screen", status: cw.score === 1 ? "pass" : "fail", value: cw.score === 1 ? "no horizontal scroll" : "content wider than the viewport" });
    const lcp = a["largest-contentful-paint"]?.numericValue ?? null;
    items.push({ label: "Mobile load (LCP, lab)", status: rate(lcp, 2500, 4000), value: ms(lcp) });
    items.push({ label: "Accessibility score", status: acc == null ? "info" : acc >= 0.9 ? "pass" : acc >= 0.7 ? "warn" : "fail", value: acc == null ? "—" : String(Math.round(acc * 100)) });
  } else {
    items.push({ label: "Lighthouse mobile run", status: "info", value: "unavailable", detail: (jr.reason as Error)?.message ?? "PageSpeed Insights didn't respond." });
  }
  const gbStatus = gb?.status ?? 0;
  items.push(
    gbStatus === 200
      ? { label: "Googlebot Smartphone user agent gets the page", status: "pass", value: "HTTP 200", detail: "Google indexes the mobile version of your pages (mobile-first indexing)." }
      : page.status === 200
        ? { label: "Googlebot Smartphone user agent gets the page", status: "warn", value: `HTTP ${gbStatus || "no response"} (browser: 200)`, detail: "Your server treats our Googlebot-labelled request differently from a phone browser. Sites that verify Googlebot by IP do this on purpose; confirm with the URL Inspection tool in Search Console that the real Googlebot gets the page." }
        : { label: "Googlebot Smartphone user agent gets the page", status: "fail", value: `HTTP ${gbStatus || "no response"}`, detail: "Neither a phone browser nor Googlebot gets a normal page. Google indexes the mobile version, so this blocks indexing." }
  );
  const fails = items.filter((i) => i.status === "fail").length;
  return {
    ok: true, tool: "mobile", input, url: page.finalUrl, fetchedAt: now(), verdict: fails ? "fail" : worst(items.map((i) => i.status)),
    headline: fails ? `Not mobile-friendly yet: ${fails} blocking issue(s).` : items.some((i) => i.status === "warn") ? "Mostly mobile-friendly, with a few things to fix." : "Mobile-friendly: viewport set, content fits, text and tap targets OK.",
    sections: [
      ...(shot ? [{ title: "How it looks on a phone (Lighthouse, Moto G Power viewport)", kind: "image" as const, image: { src: shot, alt: `Mobile screenshot of ${page.finalUrl}`, width: 412, height: 823 } }] : []),
      { title: "Mobile-friendly checks", kind: "checks", items },
    ],
  };
}

/* ---------------- 安全响应头 ---------------- */

export async function securityHeaders(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const r = await fetchAs(t.url, "browser", { maxBytes: 256 * 1024 });
  if (r.status === 0) return errorResult("security", input, fetchFailure(r) ?? "Unreachable");
  const h = (k: string) => header(r, k);
  const items: CheckItem[] = [];
  let score = 0;
  const hsts = h("strict-transport-security");
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts ?? "")?.[1] ?? 0);
  items.push(!hsts ? { label: "Strict-Transport-Security", status: "fail", value: "missing", detail: "Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` so browsers never load the site over HTTP." } : { label: "Strict-Transport-Security", status: maxAge >= 15552000 ? "pass" : "warn", value: hsts, detail: maxAge < 15552000 ? "max-age under 6 months; raise it to 31536000 (1 year)." : undefined });
  if (hsts && maxAge >= 15552000) score += 25; else if (hsts) score += 12;
  const csp = h("content-security-policy");
  items.push(!csp ? { label: "Content-Security-Policy", status: "fail", value: "missing", detail: "A CSP limits which scripts can run — the main defence against XSS. Start with `default-src 'self'` in report-only mode." } : { label: "Content-Security-Policy", status: /unsafe-inline|unsafe-eval/.test(csp) ? "warn" : "pass", value: csp.slice(0, 160) + (csp.length > 160 ? "…" : ""), detail: /unsafe-inline|unsafe-eval/.test(csp) ? "Allows unsafe-inline / unsafe-eval, which weakens XSS protection." : undefined });
  if (csp) score += /unsafe-inline|unsafe-eval/.test(csp) ? 15 : 25;
  const xcto = h("x-content-type-options");
  items.push(xcto?.toLowerCase() === "nosniff" ? { label: "X-Content-Type-Options", status: "pass", value: "nosniff" } : { label: "X-Content-Type-Options", status: "fail", value: xcto ?? "missing", detail: "Add `X-Content-Type-Options: nosniff`." });
  if (xcto?.toLowerCase() === "nosniff") score += 15;
  const xfo = h("x-frame-options");
  const fa = /frame-ancestors/i.test(csp ?? "");
  items.push(xfo || fa ? { label: "Clickjacking protection", status: "pass", value: xfo ? `X-Frame-Options: ${xfo}` : "CSP frame-ancestors" } : { label: "Clickjacking protection", status: "fail", value: "missing", detail: "Add `X-Frame-Options: SAMEORIGIN` or CSP `frame-ancestors 'self'`." });
  if (xfo || fa) score += 15;
  const rp = h("referrer-policy");
  items.push(rp ? { label: "Referrer-Policy", status: /unsafe-url/.test(rp) ? "warn" : "pass", value: rp } : { label: "Referrer-Policy", status: "warn", value: "missing", detail: "Add `Referrer-Policy: strict-origin-when-cross-origin`." });
  if (rp && !/unsafe-url/.test(rp)) score += 10;
  const pp = h("permissions-policy");
  items.push(pp ? { label: "Permissions-Policy", status: "pass", value: pp.slice(0, 160) } : { label: "Permissions-Policy", status: "info", value: "missing", detail: "Optional: disable features you don't use, e.g. `camera=(), microphone=(), geolocation=()`." });
  if (pp) score += 10;
  const leak = [h("server"), h("x-powered-by")].filter((x) => x && /\d/.test(x)) as string[];
  if (leak.length) items.push({ label: "Version disclosure", status: "info", value: leak.join(" · "), detail: "Server or framework version numbers help attackers target known bugs." });
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F";
  return {
    ok: true, tool: "security", input, url: r.finalUrl, fetchedAt: now(), score, verdict: score >= 75 ? "pass" : score >= 55 ? "warn" : "fail",
    headline: `Grade ${grade} (${score}/100) for ${r.finalUrl}.`,
    sections: [{ title: "Security headers", kind: "checks", items }, { title: "Copy-paste starting point (nginx)", kind: "code", code: { lang: "nginx", text: [
      'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
      "add_header Content-Security-Policy-Report-Only \"default-src 'self'; img-src 'self' https: data:; frame-ancestors 'self'\" always;",
      'add_header X-Content-Type-Options "nosniff" always;',
      'add_header X-Frame-Options "SAMEORIGIN" always;',
      'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
      'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
    ].join("\n"), filename: "security-headers.conf" } }],
  };
}

/* ---------------- HSTS ---------------- */

export async function hstsChecker(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const host = t.host;
  const apex = host.replace(/^www\./, "");
  const [https, http, apexHttp] = await Promise.all([
    fetchAs(`https://${host}/`, "browser", { maxBytes: 128 * 1024 }),
    fetchNoFollow(`http://${host}/`, "browser"),
    host !== apex ? fetchNoFollow(`http://${apex}/`, "browser") : Promise.resolve(null),
  ]);
  if (https.status === 0) return errorResult("hsts", input, fetchFailure(https) ?? "HTTPS isn't reachable for this host.");
  const raw = header(https, "strict-transport-security");
  const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(raw ?? "")?.[1] ?? 0);
  const sub = /includesubdomains/i.test(raw ?? "");
  const pre = /(^|;)\s*preload/i.test(raw ?? "");
  const httpLoc = header(http, "location") ?? "";
  const redirects = http.status >= 300 && http.status < 400 && httpLoc.startsWith("https://");
  const items: CheckItem[] = [
    raw ? { label: "Header present (on HTTPS)", status: "pass", value: raw } : { label: "Header present (on HTTPS)", status: "fail", value: "missing", detail: "Send `Strict-Transport-Security` on HTTPS responses. Browsers ignore it over plain HTTP." },
    { label: "max-age", status: maxAge >= 31536000 ? "pass" : maxAge >= 15552000 ? "warn" : raw ? "fail" : "info", value: raw ? `${maxAge.toLocaleString()} s (${Math.round(maxAge / 86400)} days)` : "—", detail: maxAge < 31536000 && raw ? "Preload requires at least 31536000 (one year). Ramp up: 300 → 604800 → 2592000 → 31536000." : undefined },
    { label: "includeSubDomains", status: sub ? "pass" : raw ? "warn" : "info", value: sub ? "yes" : "no", detail: sub ? "Every subdomain must serve HTTPS — check old staging or mail hosts before turning this on." : "Required for preload; also protects cookies set on subdomains." },
    { label: "preload directive", status: pre ? "pass" : "info", value: pre ? "yes" : "no", detail: "Only add preload when you're ready to submit at hstspreload.org — removal takes months." },
    { label: "http:// redirects to https://", status: redirects ? "pass" : http.status === 0 ? "info" : "fail", value: http.status ? `HTTP ${http.status}${httpLoc ? ` → ${httpLoc}` : ""}` : "port 80 not reachable", detail: redirects ? undefined : "The plain HTTP version must redirect to HTTPS (preload requires a redirect on the same host first)." },
  ];
  if (apexHttp) {
    const l = header(apexHttp, "location") ?? "";
    items.push({ label: `http://${apex} redirects to https://${apex}`, status: apexHttp.status >= 300 && apexHttp.status < 400 && l.startsWith(`https://${apex}`) ? "pass" : "warn", value: `HTTP ${apexHttp.status || "—"}${l ? ` → ${l}` : ""}`, detail: "Preload checks the bare domain: it must redirect to HTTPS on itself before going to www." });
  }
  const eligible = raw && maxAge >= 31536000 && sub && pre && redirects;
  return {
    ok: true, tool: "hsts", input, url: `https://${host}/`, fetchedAt: now(), verdict: eligible ? "pass" : raw ? "warn" : "fail",
    headline: !raw ? "No HSTS header: browsers will still try plain HTTP first." : eligible ? "HSTS is set correctly and looks eligible for the preload list." : `HSTS is on (max-age ${Math.round(maxAge / 86400)} days) but not preload-ready.`,
    sections: [{ title: "HSTS check", kind: "checks", items }, { title: "Recommended header", kind: "code", code: { lang: "http", text: "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload", filename: "header" } }],
  };
}
