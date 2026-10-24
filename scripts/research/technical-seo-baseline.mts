/* ============================================================
   AEOeye Technical SEO Baseline (October 2026) —— 零成本一手数据(只发普通 HTTP 请求,不调任何付费 API)

   样本:与 AI 爬虫访问研究相同的 391 个域名(scripts/research/ai-crawler-study-domains.json,便利样本,非随机)。
   每个域名:
     1. GET https://<domain>/robots.txt —— 不允许我们 UA 抓首页的站,只记录 robots 层面的数据,不再抓页面
     2. 从 http://<domain>/ 起手动跟随跳转(最多 10 跳):记录每跳状态码、最终 URL、是否一跳到 HTTPS
     3. 最终首页的响应头(HSTS / CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy /
        Permissions-Policy / 压缩)与 HTML(title、description、canonical、OG、X 卡片、favicon、viewport、
        lang、JSON-LD 类型、图片格式、博客与文档放在子域名还是子目录)
     4. og:image 只读前 64 KB 判断格式与尺寸
     5. GET 一个必然不存在的路径,看是否返回真 404(软 404 比例)
     6. GET /sitemap.xml 状态码
   礼貌:UA 自报身份并带说明链接;同域请求串行、间隔 1 秒;全局并发 8;每次请求 12 秒超时;页面最多读 3 MB。

   用法:npx tsx scripts/research/technical-seo-baseline.mts [输出目录,默认 public/resources]
   产物:technical-seo-baseline-2026-10.csv(逐域名)+ technical-seo-baseline-2026-10.json(汇总 + 方法 + 局限)
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { parseRobots, isPathAllowedFor, emptyRobots, looksLikeHtml, type RobotsRules } from "../../lib/seo-audit/robots";
import { parseDoc, metaTags, metaValue, titleOf, linkRels, anchors, htmlLang, headings } from "../../lib/tools/html";
import { sniff } from "../../lib/tools/image";
import { estimatePixels } from "../../lib/tools/checks/page";

const UA = "Mozilla/5.0 (compatible; AEOeyeResearch/1.0; +https://aeoeye.com/bot)";
const UA_TOKEN = "AEOeyeResearch";
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024;
const CONCURRENCY = 8;
const GAP_MS = 1_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Res = { status: number | null; url: string; location: string | null; headers: Record<string, string>; body: Uint8Array; error?: string };

async function req(url: string, opts: { follow?: boolean; maxBytes?: number; accept?: string } = {}): Promise<Res> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: opts.follow ? "follow" : "manual",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", "accept-encoding": "br, gzip, deflate" },
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const chunks: Uint8Array[] = [];
    let size = 0;
    const max = opts.maxBytes ?? MAX_BYTES;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
        if (size >= max) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }
    const body = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      body.set(c.subarray(0, Math.min(c.byteLength, size - off)), off);
      off += c.byteLength;
      if (off >= size) break;
    }
    return { status: res.status, url: res.url || url, location: res.headers.get("location"), headers, body };
  } catch (e) {
    return { status: null, url, location: null, headers: {}, body: new Uint8Array(), error: (e as Error).name === "AbortError" ? "timeout" : (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

const dec = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(b);
const registrable = (host: string) => host.replace(/^www\./, "").split(".").slice(-2).join(".");

type Row = Record<string, string | number | boolean | null>;

async function study(domain: string, group: string): Promise<Row> {
  const row: Row = { domain, group };
  // 1) robots.txt
  let robots = await req(`https://${domain}/robots.txt`, { follow: true, accept: "text/plain,*/*;q=0.8" });
  if (robots.status === null && !domain.startsWith("www.")) {
    await sleep(GAP_MS);
    robots = await req(`https://www.${domain}/robots.txt`, { follow: true, accept: "text/plain,*/*;q=0.8" });
  }
  let rules: RobotsRules;
  const rtext = dec(robots.body);
  if (robots.status === null) rules = emptyRobots(null, robots.error);
  else if (robots.status >= 400) rules = emptyRobots(robots.status);
  else if (looksLikeHtml(rtext)) rules = emptyRobots(robots.status);
  else rules = { ...parseRobots(rtext), found: true, status: robots.status, bytes: robots.body.byteLength };
  row.robotsStatus = robots.status;
  row.robotsSitemapLine = /^\s*sitemap\s*:/im.test(rtext) && !looksLikeHtml(rtext);
  const allowed = isPathAllowedFor(rules, "/", UA_TOKEN);
  row.robotsAllowsUs = allowed;
  if (robots.status === null) {
    row.outcome = "unreachable";
    return row;
  }
  if (!allowed) {
    row.outcome = "robots-disallowed";
    return row;
  }

  // 2) http:// 起手动跟随跳转
  await sleep(GAP_MS);
  const hops: { url: string; status: number | null }[] = [];
  let url = `http://${domain}/`;
  let final: Res | null = null;
  for (let i = 0; i < 10; i++) {
    const r = await req(url);
    hops.push({ url, status: r.status });
    if (r.status && r.status >= 300 && r.status < 400 && r.location) {
      const next = new URL(r.location, url).toString();
      if (hops.some((h) => h.url === next)) {
        row.redirectLoop = true;
        break;
      }
      url = next;
      await sleep(GAP_MS / 2);
      continue;
    }
    final = r;
    break;
  }
  const redirects = hops.filter((h) => h.status && h.status >= 300 && h.status < 400);
  row.redirectHops = redirects.length;
  row.redirectCodes = redirects.map((h) => h.status).join(">");
  row.finalUrl = final?.url ?? url;
  row.finalStatus = final?.status ?? null;
  const finalUrl = new URL(String(row.finalUrl));
  row.finalHttps = finalUrl.protocol === "https:";
  row.finalWww = finalUrl.hostname.startsWith("www.");
  row.httpToHttpsOneHop = redirects.length === 1 && row.finalHttps === true;
  const firstHop = hops[0];
  row.firstRedirectCode = firstHop && firstHop.status && firstHop.status >= 300 && firstHop.status < 400 ? firstHop.status : null;
  if (!final || !final.status || final.status >= 400) {
    row.outcome = final?.status ? `http-${final.status}` : "page-unreachable";
    return row;
  }
  const h = final.headers;
  const html = dec(final.body);
  if (!/<html|<head|<body/i.test(html.slice(0, 5000))) {
    row.outcome = "not-html";
    return row;
  }
  row.outcome = "ok";

  // 3) 响应头
  const hsts = h["strict-transport-security"] ?? "";
  row.hsts = Boolean(hsts);
  const maxAge = /max-age\s*=\s*"?(\d+)/i.exec(hsts);
  row.hstsMaxAge = maxAge ? Number(maxAge[1]) : null;
  row.hstsIncludeSub = /includesubdomains/i.test(hsts);
  row.hstsPreload = /preload/i.test(hsts);
  row.csp = Boolean(h["content-security-policy"]);
  row.cspReportOnly = Boolean(h["content-security-policy-report-only"]);
  row.xFrameOptions = Boolean(h["x-frame-options"]) || /frame-ancestors/i.test(h["content-security-policy"] ?? "");
  row.xContentTypeOptions = /nosniff/i.test(h["x-content-type-options"] ?? "");
  row.referrerPolicy = Boolean(h["referrer-policy"]);
  row.permissionsPolicy = Boolean(h["permissions-policy"]);
  row.encoding = h["content-encoding"] ?? "none";
  row.xRobotsTag = h["x-robots-tag"] ?? "";

  // HTML
  const doc = parseDoc(html);
  const tags = metaTags(doc);
  const title = titleOf(doc) ?? "";
  row.titleChars = title.length;
  row.titlePx = title ? Math.round(estimatePixels(title, 20)) : 0;
  const desc = metaValue(tags, "description") ?? "";
  row.descChars = desc.length;
  const rels = linkRels(doc, final.url);
  row.canonical = rels.some((r) => r.rel === "canonical");
  row.metaRobots = metaValue(tags, "robots") ?? "";
  row.viewport = Boolean(metaValue(tags, "viewport"));
  row.lang = htmlLang(doc) ?? "";
  row.h1Count = headings(doc).filter((x) => x.level === 1).length;
  row.ogTitle = Boolean(metaValue(tags, "og:title"));
  row.ogDescription = Boolean(metaValue(tags, "og:description"));
  const ogImage = metaValue(tags, "og:image") ?? metaValue(tags, "og:image:url") ?? metaValue(tags, "og:image:secure_url");
  row.ogImage = Boolean(ogImage);
  row.ogImageDeclaredSize = Boolean(metaValue(tags, "og:image:width") && metaValue(tags, "og:image:height"));
  row.twitterCard = metaValue(tags, "twitter:card") ?? "";
  const icons = rels.filter((r) => /(^|\s)icon(\s|$)/.test(r.rel));
  row.iconLinks = icons.length;
  row.iconSvg = icons.some((r) => /\.svg(\?|$)/i.test(r.href) || /svg/i.test(r.attrs.type ?? ""));
  row.iconSizes = icons.map((r) => r.attrs.sizes).filter(Boolean).join(" ");
  row.appleTouchIcon = rels.some((r) => r.rel.includes("apple-touch-icon"));
  // JSON-LD
  const types = new Set<string>();
  let ldInvalid = 0;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
    for (const [k, v] of Object.entries(o)) if (k !== "@context" && typeof v === "object") walk(v);
  };
  for (const block of doc.jsonLd) {
    try {
      walk(JSON.parse(block.trim().replace(/^<!--|-->$/g, "")));
    } catch {
      ldInvalid++;
    }
  }
  row.jsonLdBlocks = doc.jsonLd.length;
  row.jsonLdInvalid = ldInvalid;
  row.jsonLdTypes = [...types].sort().join(" ");
  // 图片格式:<img src/srcset> 扩展名 + <source type>
  const imgRefs: string[] = [];
  for (const el of doc.root.querySelectorAll("img")) {
    const src = el.getAttribute("src");
    if (src) imgRefs.push(src);
    const ss = el.getAttribute("srcset");
    if (ss) imgRefs.push(...ss.split(",").map((s) => s.trim().split(/\s+/)[0]));
  }
  const sourceTypes = doc.root.querySelectorAll("source").map((s) => (s.getAttribute("type") ?? "").toLowerCase());
  const ext = (u: string) => {
    const m = /\.(avif|webp|jpe?g|png|gif|svg)(?:[?#]|$)/i.exec(u) || /[?&](?:fm|format|f)=(avif|webp|jpe?g|png)/i.exec(u) || /\/f_(avif|webp|auto)\b/i.exec(u);
    return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "other";
  };
  const fmt: Record<string, number> = {};
  for (const u of imgRefs) fmt[ext(u)] = (fmt[ext(u)] || 0) + 1;
  row.imgCount = doc.root.querySelectorAll("img").length;
  row.imgAvif = (fmt.avif || 0) + sourceTypes.filter((t) => t === "image/avif").length;
  row.imgWebp = (fmt.webp || 0) + sourceTypes.filter((t) => t === "image/webp").length;
  row.imgJpgPng = (fmt.jpg || 0) + (fmt.png || 0);
  row.imgAuto = fmt.auto || 0;
  // 博客 / 文档放在哪
  const host = finalUrl.hostname;
  const reg = registrable(host);
  const as = anchors(doc, final.url, host);
  const blogSub = as.some((a) => {
    try {
      const u = new URL(a.href);
      return u.hostname !== host && registrable(u.hostname) === reg && /^(blog|news|insights|resources)\./.test(u.hostname);
    } catch {
      return false;
    }
  });
  const blogDir = as.some((a) => {
    try {
      const u = new URL(a.href);
      return registrable(u.hostname) === reg && !/^(blog|news|insights|resources)\./.test(u.hostname) && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(blog|news|insights|resources)(\/|$)/i.test(u.pathname);
    } catch {
      return false;
    }
  });
  row.blogLocation = blogSub && blogDir ? "both" : blogSub ? "subdomain" : blogDir ? "subfolder" : "none";
  const docsSub = as.some((a) => { try { const u = new URL(a.href); return u.hostname !== host && registrable(u.hostname) === reg && /^(docs|help|support|developer|developers)\./.test(u.hostname); } catch { return false; } });
  const docsDir = as.some((a) => { try { const u = new URL(a.href); return registrable(u.hostname) === reg && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(docs|help|support|developers?)(\/|$)/i.test(u.pathname) && !/^(docs|help|support|developer|developers)\./.test(u.hostname); } catch { return false; } });
  row.docsLocation = docsSub && docsDir ? "both" : docsSub ? "subdomain" : docsDir ? "subfolder" : "none";

  // 4) og:image 只读 64 KB
  if (ogImage) {
    await sleep(GAP_MS / 2);
    let abs: string | null = null;
    try { abs = new URL(ogImage, final.url).toString(); } catch { abs = null; }
    if (abs) {
      const r = await req(abs, { follow: true, maxBytes: 65536, accept: "image/*" });
      const s = r.status && r.status < 400 ? sniff(r.body, r.headers["content-type"] ?? "") : { format: null, width: null, height: null };
      row.ogImageStatus = r.status;
      row.ogImageFormat = s.format;
      row.ogImageWidth = s.width;
      row.ogImageHeight = s.height;
    }
  }
  // 5) 软 404
  await sleep(GAP_MS);
  const probe = await req(`${finalUrl.origin}/aeoeye-research-404-check-${Math.random().toString(36).slice(2, 10)}`, { follow: true });
  row.missingPageStatus = probe.status;
  // 6) sitemap.xml
  await sleep(GAP_MS);
  const sm = await req(`${finalUrl.origin}/sitemap.xml`, { follow: true, maxBytes: 4096, accept: "application/xml,text/xml,*/*;q=0.8" });
  row.sitemapXmlStatus = sm.status;
  row.sitemapXmlIsXml = Boolean(sm.status && sm.status < 400 && /<(urlset|sitemapindex)\b/i.test(dec(sm.body)));
  return row;
}

async function main() {
  const outDir = process.argv[2] || "public/resources";
  const groups = JSON.parse(fs.readFileSync("scripts/research/ai-crawler-study-domains.json", "utf8")) as Record<string, string[] | string>;
  const list: { domain: string; group: string }[] = [];
  for (const [g, ds] of Object.entries(groups)) if (Array.isArray(ds)) for (const d of ds) list.push({ domain: d, group: g });
  // 逐域名追加写 NDJSON(可续跑):曾因某个请求挂起、事件循环清空,进程静默退出而丢掉全部内存结果
  const ndjson = path.join(outDir, "technical-seo-baseline-2026-10.ndjson");
  const done = new Set<string>();
  if (fs.existsSync(ndjson)) for (const line of fs.readFileSync(ndjson, "utf8").split("\n")) if (line.trim()) done.add(JSON.parse(line).domain);
  const todo = list.filter((x) => !done.has(x.domain));
  const keepAlive = setInterval(() => {}, 1000);
  const startedAt = new Date().toISOString();
  let i = 0;
  let n = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < todo.length) {
        const item = todo[i++];
        let row: Row;
        try {
          row = await Promise.race([
            study(item.domain, item.group),
            new Promise<Row>((resolve) => setTimeout(() => resolve({ domain: item.domain, group: item.group, outcome: "domain-timeout" }), 90_000)),
          ]);
        } catch (e) {
          row = { domain: item.domain, group: item.group, outcome: `error: ${(e as Error).message}` };
        }
        fs.appendFileSync(ndjson, JSON.stringify(row) + "\n");
        if (++n % 25 === 0) console.error(`${n + done.size}/${list.length}`);
      }
    })
  );
  clearInterval(keepAlive);
  const rows: Row[] = fs.readFileSync(ndjson, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  rows.sort((a, b) => String(a.group).localeCompare(String(b.group)) || String(a.domain).localeCompare(String(b.domain)));
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => { const v = r[c]; if (v === null || v === undefined) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n");
  fs.writeFileSync(path.join(outDir, "technical-seo-baseline-2026-10.csv"), csv + "\n");
  console.error(`done: ${rows.length} rows, ${rows.filter((r) => r.outcome === "ok").length} ok (run started ${startedAt})`);
  process.exit(0);
}

main();
