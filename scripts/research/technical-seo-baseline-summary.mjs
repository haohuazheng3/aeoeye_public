// 汇总 technical-seo-baseline-2026-10.ndjson → technical-seo-baseline-2026-10.json(分组 + 全体,含方法与局限)
import fs from 'node:fs';
const dir = process.argv[2] || 'public/resources';
const rows = fs.readFileSync(`${dir}/technical-seo-baseline-2026-10.ndjson`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const med = (a) => { const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
function summarize(rs) {
  const ok = rs.filter((r) => r.outcome === 'ok');
  const reached = rs.filter((r) => r.redirectHops !== undefined);
  const o = {};
  o.domains = rs.length;
  o.outcomes = rs.reduce((m, r) => ((m[r.outcome] = (m[r.outcome] || 0) + 1), m), {});
  o.homepagesAnalyzed = ok.length;
  // 跳转(从 http://domain/ 起)
  o.redirect = {
    reached: reached.length,
    httpToHttpsOneHopPct: pct(reached.filter((r) => r.httpToHttpsOneHop).length, reached.length),
    twoPlusHopsPct: pct(reached.filter((r) => r.redirectHops >= 2).length, reached.length),
    threePlusHopsPct: pct(reached.filter((r) => r.redirectHops >= 3).length, reached.length),
    noRedirectFromHttpPct: pct(reached.filter((r) => r.redirectHops === 0).length, reached.length),
    finalHttpsPct: pct(reached.filter((r) => r.finalHttps).length, reached.length),
    finalWwwPct: pct(reached.filter((r) => r.finalWww).length, reached.length),
    firstHopCodePct: Object.fromEntries([301, 302, 303, 307, 308].map((c) => [c, pct(reached.filter((r) => r.firstRedirectCode === c).length, reached.filter((r) => r.firstRedirectCode).length)])),
    anyTemporaryInChainPct: pct(reached.filter((r) => /30[27]/.test(String(r.redirectCodes || ''))).length, reached.filter((r) => r.redirectHops > 0).length),
    loops: reached.filter((r) => r.redirectLoop).length,
  };
  const n = ok.length;
  const c = (f) => pct(ok.filter(f).length, n);
  o.headers = {
    hstsPct: c((r) => r.hsts), hstsMaxAgeOneYearPct: c((r) => r.hstsMaxAge >= 31536000), hstsIncludeSubPct: c((r) => r.hstsIncludeSub), hstsPreloadPct: c((r) => r.hstsPreload),
    hstsPreloadReadyPct: c((r) => r.hstsMaxAge >= 31536000 && r.hstsIncludeSub && r.hstsPreload),
    cspPct: c((r) => r.csp), cspReportOnlyPct: c((r) => r.cspReportOnly), frameProtectionPct: c((r) => r.xFrameOptions), xContentTypeOptionsPct: c((r) => r.xContentTypeOptions),
    referrerPolicyPct: c((r) => r.referrerPolicy), permissionsPolicyPct: c((r) => r.permissionsPolicy),
    allFiveCorePct: c((r) => r.hsts && r.csp && r.xFrameOptions && r.xContentTypeOptions && r.referrerPolicy),
    noneOfFivePct: c((r) => !r.hsts && !r.csp && !r.xFrameOptions && !r.xContentTypeOptions && !r.referrerPolicy),
    brotliPct: c((r) => /br/.test(r.encoding)), gzipPct: c((r) => /gzip/.test(r.encoding)), uncompressedPct: c((r) => r.encoding === 'none'),
    xRobotsTagPct: c((r) => r.xRobotsTag),
  };
  o.meta = {
    titleMissingPct: c((r) => !r.titleChars), titleMedianChars: med(ok.map((r) => r.titleChars).filter(Boolean)), titleMedianPx: med(ok.map((r) => r.titlePx).filter(Boolean)),
    titleOver600pxPct: pct(ok.filter((r) => r.titlePx > 600).length, ok.filter((r) => r.titleChars).length),
    titleOver60CharsPct: pct(ok.filter((r) => r.titleChars > 60).length, ok.filter((r) => r.titleChars).length),
    descMissingPct: c((r) => !r.descChars), descMedianChars: med(ok.map((r) => r.descChars).filter(Boolean)),
    descOver160Pct: pct(ok.filter((r) => r.descChars > 160).length, ok.filter((r) => r.descChars).length),
    descUnder70Pct: pct(ok.filter((r) => r.descChars && r.descChars < 70).length, ok.filter((r) => r.descChars).length),
    canonicalPct: c((r) => r.canonical), viewportPct: c((r) => r.viewport), langPct: c((r) => r.lang),
    h1NonePct: c((r) => r.h1Count === 0), h1OnePct: c((r) => r.h1Count === 1), h1MultiplePct: c((r) => r.h1Count > 1),
    metaRobotsNoindexPct: c((r) => /noindex/i.test(r.metaRobots || '')),
  };
  const withImg = ok.filter((r) => r.ogImageWidth && r.ogImageHeight);
  o.social = {
    ogTitlePct: c((r) => r.ogTitle), ogDescriptionPct: c((r) => r.ogDescription), ogImagePct: c((r) => r.ogImage), ogImageDeclaresSizePct: c((r) => r.ogImageDeclaredSize),
    ogImageMeasured: withImg.length,
    ogImageExactly1200x630Pct: pct(withImg.filter((r) => r.ogImageWidth === 1200 && r.ogImageHeight === 630).length, withImg.length),
    ogImageAtLeast1200WidePct: pct(withImg.filter((r) => r.ogImageWidth >= 1200).length, withImg.length),
    ogImageRatioNear191Pct: pct(withImg.filter((r) => Math.abs(r.ogImageWidth / r.ogImageHeight - 1.91) <= 0.06).length, withImg.length),
    ogImageUnder600WidePct: pct(withImg.filter((r) => r.ogImageWidth < 600).length, withImg.length),
    ogImageMedianWidth: med(withImg.map((r) => r.ogImageWidth)),
    ogImageFormats: withImg.reduce((m, r) => ((m[r.ogImageFormat] = (m[r.ogImageFormat] || 0) + 1), m), {}),
    ogImageBrokenPct: pct(ok.filter((r) => r.ogImage && r.ogImageStatus && r.ogImageStatus >= 400).length, ok.filter((r) => r.ogImage).length),
    twitterCardPct: c((r) => r.twitterCard), summaryLargeImagePct: c((r) => r.twitterCard === 'summary_large_image'), summaryPct: c((r) => r.twitterCard === 'summary'),
    iconLinkPct: c((r) => r.iconLinks > 0), iconSvgPct: c((r) => r.iconSvg), appleTouchIconPct: c((r) => r.appleTouchIcon),
  };
  o.structuredData = {
    jsonLdAnyPct: c((r) => r.jsonLdBlocks > 0), jsonLdInvalidPct: pct(ok.filter((r) => r.jsonLdInvalid > 0).length, ok.filter((r) => r.jsonLdBlocks > 0).length),
    organizationPct: c((r) => /\bOrganization\b|Corporation/.test(r.jsonLdTypes || '')), webSitePct: c((r) => /\bWebSite\b/.test(r.jsonLdTypes || '')),
    faqPagePct: c((r) => /\bFAQPage\b/.test(r.jsonLdTypes || '')), breadcrumbPct: c((r) => /\bBreadcrumbList\b/.test(r.jsonLdTypes || '')),
    productOrSoftwarePct: c((r) => /\b(Product|SoftwareApplication|WebApplication)\b/.test(r.jsonLdTypes || '')),
  };
  const withImgs = ok.filter((r) => r.imgCount > 0);
  o.images = {
    homepagesWithImages: withImgs.length,
    anyAvifPct: pct(withImgs.filter((r) => r.imgAvif > 0).length, withImgs.length),
    anyWebpPct: pct(withImgs.filter((r) => r.imgWebp > 0).length, withImgs.length),
    modernFormatPct: pct(withImgs.filter((r) => r.imgAvif > 0 || r.imgWebp > 0).length, withImgs.length),
    jpgPngOnlyPct: pct(withImgs.filter((r) => r.imgJpgPng > 0 && !r.imgAvif && !r.imgWebp && !r.imgAuto).length, withImgs.length),
    autoFormatCdnPct: pct(withImgs.filter((r) => r.imgAuto > 0).length, withImgs.length),
  };
  const blogKnown = ok.filter((r) => r.blogLocation && r.blogLocation !== 'none');
  o.architecture = {
    blogLinked: blogKnown.length,
    blogSubfolderPct: pct(blogKnown.filter((r) => r.blogLocation === 'subfolder').length, blogKnown.length),
    blogSubdomainPct: pct(blogKnown.filter((r) => r.blogLocation === 'subdomain').length, blogKnown.length),
    blogBothPct: pct(blogKnown.filter((r) => r.blogLocation === 'both').length, blogKnown.length),
    docsLinked: ok.filter((r) => r.docsLocation && r.docsLocation !== 'none').length,
    docsSubdomainPct: pct(ok.filter((r) => r.docsLocation === 'subdomain').length, ok.filter((r) => r.docsLocation && r.docsLocation !== 'none').length),
    docsSubfolderPct: pct(ok.filter((r) => r.docsLocation === 'subfolder').length, ok.filter((r) => r.docsLocation && r.docsLocation !== 'none').length),
  };
  const probed = ok.filter((r) => r.missingPageStatus);
  o.errors = {
    missingPageProbed: probed.length,
    real404Pct: pct(probed.filter((r) => r.missingPageStatus === 404).length, probed.length),
    gone410Pct: pct(probed.filter((r) => r.missingPageStatus === 410).length, probed.length),
    soft404Pct: pct(probed.filter((r) => r.missingPageStatus === 200).length, probed.length),
    otherPct: pct(probed.filter((r) => ![200, 404, 410].includes(r.missingPageStatus)).length, probed.length),
    sitemapXmlValidPct: pct(ok.filter((r) => r.sitemapXmlIsXml).length, ok.length),
    robotsSitemapLinePct: pct(rs.filter((r) => r.robotsSitemapLine).length, rs.filter((r) => r.robotsStatus && r.robotsStatus < 400).length),
  };
  return o;
}
const groups = [...new Set(rows.map((r) => r.group))];
const out = {
  study: 'AEOeye Technical SEO Baseline (October 2026)',
  run: '2026-10-24',
  userAgent: 'Mozilla/5.0 (compatible; AEOeyeResearch/1.0; +https://aeoeye.com/bot)',
  sample: 'The same 391 domains as the AEOeye AI Crawler Access Study (scripts/research/ai-crawler-study-domains.json): a convenience sample of well-known SaaS, AI-visibility vendor, e-commerce/consumer, news publisher and UGC/review sites. Not a random sample of the web.',
  method: [
    'robots.txt fetched first; domains whose robots.txt disallows our user agent for "/" were not fetched further (outcome robots-disallowed).',
    'Redirects followed manually from http://<domain>/ (max 10 hops); every status code recorded. "One hop to HTTPS" = exactly one redirect that lands on https.',
    'Homepage response headers and HTML analysed (title, description, canonical, Open Graph, X card, icons, JSON-LD, images, links). Title pixel width is an estimate at 20px Arial-like metrics.',
    'og:image: first 64 KB fetched to read format and pixel size from the file header.',
    'Soft-404 probe: one request to a random non-existent path on the final origin.',
    'Blog/docs location: from homepage links only (blog./news./insights./resources. subdomains vs /blog, /news, /insights, /resources paths; docs./help./support./developer(s). vs matching paths).',
    'Image formats: from <img src/srcset> file extensions and format query parameters, plus <source type>. CDNs that negotiate formats without a visible extension are counted separately ("auto") and otherwise invisible to this method.',
    'Requests: one domain at a time per worker, 1 s apart, 8 workers, 12 s timeout per request, 90 s cap per domain.',
  ],
  limitations: [
    'Homepages only — inner pages often differ.',
    'Bot-protected sites may serve challenges to our user agent; those count as http-403 / not-html outcomes and are excluded from page-level percentages.',
    'Percentages for page-level fields use homepagesAnalyzed as the denominator unless the field name says otherwise.',
    'A single snapshot on 2026-10-24; headers and markup change with every deploy.',
  ],
  all: summarize(rows),
  byGroup: Object.fromEntries(groups.map((g) => [g, summarize(rows.filter((r) => r.group === g))])),
  files: { perDomainCsv: '/resources/technical-seo-baseline-2026-10.csv', perDomainNdjson: '/resources/technical-seo-baseline-2026-10.ndjson', code: 'scripts/research/technical-seo-baseline.mts' },
};
fs.writeFileSync(`${dir}/technical-seo-baseline-2026-10.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.all, null, 1));
