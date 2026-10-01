/* ============================================================
   HTTPS & Trust(权重 10)

   两个 gate:入口没有 https、证书过期 —— 任一 fail 都封顶总分。
   证书/变体探针是 v2 才加的字段,缺失一律 na。
   sec.headers 只展示不计分:安全头对排名没有直接影响,但站长该知道。
   ============================================================ */

import type { CheckStatus, SeoCheck, UrlVariant } from "../types";
import {
  check,
  na,
  pageCheck,
  okPages,
  hostOf,
  pathOf,
  listPaths,
  urlKey,
  uniq,
  blockedNote,
  entryNaNote,
  tlsFailure,
  missingAltHost,
  realVariants,
  DOCS,
  type CheckContext,
} from "./helpers";

const D = "security" as const;

function finalOf(v: UrlVariant): string | null {
  if (v.finalUrl) return v.finalUrl;
  if (v.chain && v.chain.length > 1) return v.chain[v.chain.length - 1];
  if (v.location) return v.location;
  if (v.status === 200) return v.url;
  return null;
}

/** 证书错误 → 对症的修法(过期 / 主机名不符 / 自签 / 链不全 各不相同),一句通用话术帮不了人 */
function certFix(message: string, host: string): string {
  const verify = `Verify with: curl -vI https://${host}/ 2>&1 | grep -iE 'SSL certificate|subject|expire' — the handshake must succeed with no certificate error.`;
  if (/expired|not[ _]yet[ _]valid/i.test(message)) return `Renew the certificate for ${host} now and switch on auto-renewal (Let's Encrypt/certbot, or your host's or CDN's managed certificates). ${verify}`;
  if (/mismatch|ALTNAME|HOSTNAME/i.test(message)) return `Issue a certificate whose names include ${host} (and the www / non-www counterpart if both are used) — most hosts and CDNs do this automatically once the domain is added to the project. ${verify}`;
  if (/self[- _]?signed|DEPTH_ZERO/i.test(message)) return `Replace the self-signed certificate with one from a trusted authority (Let's Encrypt is free and most hosts install it in one click). ${verify}`;
  if (/chain|UNABLE_TO/i.test(message)) return `Serve the full certificate chain (your certificate plus the intermediate certificate from your CA) — usually the "fullchain" file instead of the single certificate. ${verify}`;
  return `Install a valid certificate for ${host} (Let's Encrypt via your host or CDN is free) and make sure the chain is complete. ${verify}`;
}

/** 变体没响应的原因提示:DNS 缺记录与证书失败是两种完全不同的修法,不能一律说"DNS 缺了" */
function unresolvedHint(vs: UrlVariant[]): string {
  const errs = vs.filter((v) => v.status === null).map((v) => v.error ?? "");
  if (errs.length && errs.every((e) => /ENOTFOUND|EAI_AGAIN|ENODATA|DNS/i.test(e))) return " — usually DNS for www or apex missing.";
  if (errs.some((e) => /CERT|TLS|SSL|certificate|self[- ]signed|hostname/i.test(e))) return " — the certificate was rejected (see the HTTPS checks).";
  return ".";
}

export function checkSecurity(ctx: CheckContext): SeoCheck[] {
  const { probe, entry } = ctx;
  const pages = okPages(ctx);
  const blocked = blockedNote(ctx);
  const tls = probe.tls;
  // 另一主机(www ↔ 裸域)DNS 不存在时它的变体不参与判定(复审 C21)
  const altMissing = missingAltHost(probe);
  const variants = realVariants(probe);
  const tlsFail = tlsFailure(probe);
  // 入口一个字节都没回(证书 / DNS / 超时)时响应头根本不存在,HSTS 等只能 na,不能判"缺失";
  // 被 WAF 拦下且没抓到页面时沿用原口径(na)
  const noEntryResponse = !!probe.entryError || (entry ? entry.status === 0 : !!blocked);
  const out: SeoCheck[] = [];
  const mainUrl = entry?.finalUrl || probe.entryUrl;
  const mainHost = hostOf(mainUrl);

  /* ---------- sec.https(gate) ---------- */
  {
    const id = "sec.https";
    const httpsVariants = variants.filter((v) => /^https:\/\//i.test(v.url));
    const reachable = (entry && /^https:\/\//i.test(entry.finalUrl) && entry.status > 0 && entry.status < 500) || httpsVariants.some((v) => v.status !== null && v.status >= 200 && v.status < 400);
    if (tlsFail) {
      // 证书失败(过期 / 主机名不符 / 自签 / 链不全):访客和 Googlebot 都过不去,证据里原样给出错误串(复审 C20)
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`HTTPS on ${probe.host} fails the certificate check: ${tlsFail.message}.`, "Browsers show a full-page security warning instead of your site, and Google will not index pages it cannot load securely."], fix: certFix(tlsFail.message, probe.host), effort: "low", docs: DOCS.whyHttps }));
    } else if (reachable) {
      out.push(check({ id, dimension: D, status: "pass", severity: "critical", gate: true, evidence: [`${mainUrl} is served over HTTPS with a certificate our client accepted${tls?.issuer ? ` (issuer: ${tls.issuer})` : ""}.`], effort: "low", docs: DOCS.whyHttps }));
    } else if (!entry && blocked) {
      out.push(na(id, D, "critical", blocked, { gate: true, docs: DOCS.whyHttps }));
    } else {
      const entryWhy = probe.entryError && /^https:\/\//i.test(probe.entryUrl) ? `${probe.entryUrl}: ${probe.entryError.kind} — ${probe.entryError.message}` : null;
      const tried = uniq([...(entryWhy ? [entryWhy] : []), ...httpsVariants.map((v) => `${v.url} → ${v.status ?? v.error ?? "no response"}`)]);
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`No HTTPS URL for ${probe.host} returned a successful response${tried.length ? ` (${tried.join("; ")})` : ""}. HTTPS is a ranking signal and Chrome marks HTTP pages "Not secure".`], fix: `Enable HTTPS with a valid certificate for ${probe.host}${altMissing ? "" : " (and www)"}, then 301 all http:// traffic to it. Verify with: curl -I https://${probe.host}/ — expect HTTP 200.`, effort: "medium", docs: DOCS.whyHttps }));
    }
  }

  /* ---------- sec.tls.expired(gate) / expiring / www ---------- */
  {
    const id = "sec.tls.expired";
    // 只有"过期 / 尚未生效"归这条 gate(契约第 4 条);主机名不符、自签、链不全归 sec.https,
    // DNS / 拒连 / 超时属于连不上 —— 都不能在这里重复判 fail
    const expiredMsg = tlsFail?.expired && !(typeof tls?.daysLeft === "number" && tls.daysLeft <= 0) ? tlsFail.message : null;
    const dates = tls?.validTo ? ` (valid to ${tls.validTo}${tls.issuer ? `, issuer ${tls.issuer}` : ""})` : "";
    const renewFix = "Renew the certificate now and switch on auto-renewal (Let's Encrypt/certbot, or your host's or CDN's managed certificates). Verify with: curl -vI https://<host>/ 2>&1 | grep -iE 'expire date|SSL certificate' — no certificate error and an expiry date in the future.";
    if (tls && typeof tls.daysLeft === "number" && tls.daysLeft <= 0) {
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`The certificate for ${probe.host} expired ${Math.abs(tls.daysLeft)} day(s) ago${dates}. Every visitor sees a browser warning.`, ...(tlsFail ? [`TLS error: ${tlsFail.message}.`] : [])], fix: renewFix, effort: "low", docs: DOCS.tls }));
    } else if (expiredMsg) {
      // 主机自己的证书日期没问题、入口请求却撞上"过期":过期的是跳转目标(比如 www)上的证书,要说清楚是哪张
      const ownCertFine = typeof tls?.daysLeft === "number" && tls.daysLeft > 0;
      out.push(check({ id, dimension: D, status: "fail", severity: "critical", gate: true, evidence: [`The certificate check failed: ${expiredMsg}. Every visitor sees a browser warning before the page loads.`, ...(ownCertFine ? [`The certificate on ${probe.host} itself is valid until ${tls?.validTo ?? "unknown"} — the expired one is served by a host ${probe.entryUrl} redirects to.`] : [])], fix: renewFix, effort: "low", docs: DOCS.tls }));
    } else if (!tls) {
      out.push(na(id, D, "critical", tlsFail ? `Not measured: the certificate's dates could not be read; the HTTPS check reports the failure (${tlsFail.message}).` : "Not measured: the certificate was not inspected in this run.", { gate: true, docs: DOCS.tls }));
    } else if (tls.daysLeft === null && !tls.validTo) {
      out.push(na(id, D, "critical", tls.error ? `Not measured: the certificate could not be read (${tls.error}).` : "Not measured: certificate validity dates were not available.", { gate: true, docs: DOCS.tls }));
    } else {
      out.push(check({ id, dimension: D, status: "pass", severity: "critical", gate: true, evidence: [`Certificate for ${probe.host} is valid until ${tls.validTo ?? "unknown"} (${tls.daysLeft ?? "?"} days left${tls.issuer ? `, issuer ${tls.issuer}` : ""}).`, ...(tlsFail ? [`Its dates are fine, but it fails for another reason — see the HTTPS check: ${tlsFail.message}.`] : [])], effort: "low", docs: DOCS.tls }));
    }
  }
  {
    const id = "sec.tls.expiring";
    if (tlsFail?.expired || (tls && typeof tls.daysLeft === "number" && tls.daysLeft <= 0)) {
      out.push(na(id, D, "high", "Already expired or not yet valid — see the certificate expiry check above.", { docs: DOCS.tls }));
    } else if (!tls || typeof tls.daysLeft !== "number") {
      out.push(na(id, D, "high", "Not measured: certificate expiry was not inspected in this run.", { docs: DOCS.tls }));
    } else {
      const status: CheckStatus = tls.daysLeft < 14 ? "fail" : tls.daysLeft < 30 ? "warn" : "pass";
      out.push(check({ id, dimension: D, status, severity: "high", evidence: [`${tls.daysLeft} days until the certificate for ${probe.host} expires (${tls.validTo ?? "date unknown"}).`], fix: status === "pass" ? "" : "Renew now and switch on auto-renewal so this never becomes an outage. Verify after renewal: curl -vI https://<host>/ 2>&1 | grep 'expire date' should show a date ≥ 60 days out.", effort: "low", docs: DOCS.tls }));
    }
  }
  {
    const id = "sec.tls.www";
    if (altMissing) {
      // 另一主机 DNS 都不存在,就没有"证书要覆盖它"这回事(复审 C21)
      out.push(na(id, D, "medium", `No ${altMissing} host exists — nothing to cover.`, { docs: DOCS.tls }));
    } else if (!tls || tls.coversWww === null || tls.coversWww === undefined) {
      out.push(na(id, D, "medium", "Not measured: certificate subject alternative names were not inspected.", { docs: DOCS.tls }));
    } else if (tls.coversWww) {
      out.push(check({ id, dimension: D, status: "pass", severity: "medium", evidence: [`The certificate's subject alternative names cover both ${probe.host.replace(/^www\./, "")} and www.`], effort: "low", docs: DOCS.tls }));
    } else {
      out.push(check({ id, dimension: D, status: "warn", severity: "medium", evidence: [`The certificate does not cover the www variant of ${probe.host.replace(/^www\./, "")}, so https://www… shows a browser warning before any redirect can run.`], fix: "Issue a certificate whose SANs include both the apex and www (most CDNs do this automatically once both hosts point at them). Verify with: curl -I https://www.<host>/ — no TLS error, then a 301 to the primary host.", effort: "low", docs: DOCS.tls }));
    }
  }

  /* ---------- sec.https.variants ---------- */
  {
    const id = "sec.https.variants";
    const isHostVariant = (v: UrlVariant) => !v.kind || /^https?-(www|apex)$/.test(v.kind);
    const four = variants.filter(isHostVariant);
    const dropped = (probe.variants ?? []).filter(isHostVariant).length - four.length;
    if (four.length < 2) {
      out.push(na(id, D, "high", "Not measured: the http/https × www/apex variants were not probed.", { docs: DOCS.whyHttps }));
    } else {
      const bad: string[] = [];
      const unresolved: string[] = [];
      for (const v of four) {
        const f = finalOf(v);
        if (v.status === null) {
          unresolved.push(`${v.url}: ${v.error ?? "no response"}`);
          continue;
        }
        const ok = !!f && /^https:\/\//i.test(f) && hostOf(f) === mainHost;
        if (!ok) bad.push(`${v.url} → ${f ?? `HTTP ${v.status}`}`);
      }
      const status: CheckStatus = bad.length ? "fail" : unresolved.length ? "warn" : "pass";
      out.push(
        check({
          id, dimension: D, status, severity: "high",
          evidence: [
            bad.length ? `${bad.length} of ${four.length} variants do not end on https://${mainHost}: ${bad.join("; ")}.` : `All ${four.length - unresolved.length} reachable variants end on https://${mainHost}.`,
            ...(unresolved.length ? [`${unresolved.length} variant(s) did not respond: ${unresolved.join("; ")}${unresolvedHint(four)}`] : []),
            ...(altMissing && dropped > 0 ? [`${altMissing} has no DNS record, so its ${dropped} variant(s) are left out — there is no such host to redirect.`] : []),
          ],
          fix: status === "pass" ? "" : altMissing ? `Make http://${probe.host} 301 (path preserved) to https://${mainHost}, and make sure https://${probe.host} answers. Verify with: curl -sI http://${probe.host}/ | grep -iE '^(HTTP|location)'.` : `Make http://apex, http://www, https://apex and https://www all 301 (path preserved) to https://${mainHost}; add a DNS record for the missing host if one does not resolve. Verify with: for u in http://X http://www.X https://X https://www.X; do curl -sI $u | grep -iE '^(HTTP|location)'; done.`,
          effort: "low", docs: DOCS.whyHttps,
        }),
      );
    }
  }

  /* ---------- sec.mixed-content(page) ---------- */
  {
    const bad = pages.filter((p) => (p.mixedContent ?? 0) > 0);
    out.push(
      pageCheck({
        id: "sec.mixed-content", dimension: D, severity: "medium",
        universe: pages.map((p) => p.url), affected: bad.map((p) => p.url),
        what: "reference http:// scripts, styles, images or iframes from an https page",
        fix: "Change every http:// src/href/srcset to https:// (or protocol-relative) — browsers block http scripts/styles outright and downgrade the padlock for images. Verify in DevTools → Console: no \"Mixed Content\" warnings.",
        docs: DOCS.mixedContent, effort: "low",
        extra: bad.slice(0, 4).map((p) => `${pathOf(p.url)}: ${p.mixedContent} insecure reference(s)`),
        naNote: blocked ?? "Not measured: no crawled HTML pages.",
      }),
    );
  }

  /* ---------- sec.hsts ---------- */
  {
    const id = "sec.hsts";
    const h = probe.headers?.hsts;
    if (h) {
      const flags = [/includeSubDomains/i.test(h) ? "includeSubDomains" : null, /preload/i.test(h) ? "preload" : null].filter(Boolean);
      out.push(check({ id, dimension: D, status: "pass", severity: "low", evidence: [`Strict-Transport-Security: ${h}${flags.length ? ` (${flags.join(", ")})` : ""}.`], effort: "low", docs: DOCS.hsts }));
    } else if (noEntryResponse) {
      out.push(na(id, D, "low", entryNaNote(ctx), { docs: DOCS.hsts }));
    } else {
      out.push(check({ id, dimension: D, status: "warn", severity: "low", evidence: [`${mainUrl} sends no Strict-Transport-Security header, so a first visit typed as http:// can be intercepted before the redirect.`], fix: "Send Strict-Transport-Security: max-age=31536000; includeSubDomains on all https responses (add preload once every subdomain is https). Verify with: curl -sI https://<host>/ | grep -i strict-transport.", effort: "low", docs: DOCS.hsts }));
    }
  }

  /* ---------- sec.trust-pages ---------- */
  {
    const id = "sec.trust-pages";
    if (!pages.length) {
      out.push(na(id, D, "medium", blocked ?? "Not measured: no crawled HTML pages.", { docs: DOCS.helpfulContent }));
    } else {
      const urls = uniq([...pages.map((p) => p.url), ...pages.flatMap((p) => p.links ?? [])]).map((u) => pathOf(u).toLowerCase());
      const has = (re: RegExp) => urls.some((u) => re.test(u));
      const privacy = has(/privacy|datenschutz|gdpr/);
      const terms = has(/terms|tos\b|legal|conditions|agb/);
      const contact = has(/contact|about|impressum|imprint|support/);
      const missing = [!privacy && "privacy policy", !terms && "terms / legal", !contact && "contact or about"].filter(Boolean) as string[];
      const status: CheckStatus = missing.length === 0 ? "pass" : missing.length === 1 ? "warn" : "fail";
      out.push(
        check({
          id, dimension: D, status, severity: "medium",
          evidence: [`Across ${pages.length} crawled pages and their ${urls.length} distinct linked URLs: privacy ${privacy ? "found" : "missing"}, terms/legal ${terms ? "found" : "missing"}, contact/about ${contact ? "found" : "missing"}.`],
          fix: status === "pass" ? "" : `Publish the missing page(s) (${missing.join(", ")}) and link them from the footer of every page — Google's quality guidelines and AI engines both look for who is behind a site. Verify: the footer links resolve with HTTP 200.`,
          effort: "low", docs: DOCS.helpfulContent,
        }),
      );
    }
  }

  /* ---------- sec.headers(info) ---------- */
  {
    const id = "sec.headers";
    const h = probe.headers;
    if (!h || noEntryResponse) {
      out.push(na(id, D, "low", h ? entryNaNote(ctx) : "Not measured: response headers were not captured.", { docs: DOCS.securityHeaders }));
    } else {
      const rows: [string, string | null][] = [
        ["Content-Security-Policy", h.csp],
        ["X-Content-Type-Options", h.xContentTypeOptions],
        ["X-Frame-Options", h.xFrameOptions],
        ["Referrer-Policy", h.referrerPolicy],
      ];
      const missing = rows.filter(([, v]) => !v).map(([k]) => k);
      out.push(
        check({
          id, dimension: D, status: "info", severity: "low",
          evidence: [
            `On ${mainUrl}: ${rows.map(([k, v]) => `${k}: ${v ? (v.length > 60 ? `${v.slice(0, 60)}…` : v) : "missing"}`).join(" · ")}.`,
            "Not part of the score — these protect users rather than rankings.",
          ],
          fix: missing.length ? `Add ${missing.join(", ")} (X-Content-Type-Options: nosniff; X-Frame-Options: SAMEORIGIN or a CSP frame-ancestors; Referrer-Policy: strict-origin-when-cross-origin). Verify with: curl -sI <url>.` : "",
          effort: "low", docs: DOCS.securityHeaders,
        }),
      );
    }
  }

  return out;
}
