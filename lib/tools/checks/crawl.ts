/* ============================================================
   抓取 / 收录类检查:robots.txt、AI 与搜索爬虫访问、sitemap、跳转链、状态码、
   响应头、meta robots、以爬虫身份抓取、页面源码、llms.txt、IndexNow 提交。
   规则依据写在每个函数头;页面正文会引用同样的出处。
   ============================================================ */

import { gunzipSync } from "node:zlib";
import { fetchRobots, detectBlock } from "@/lib/seo-audit/crawl";
import { parseSitemapXml } from "@/lib/seo-audit/sitemap";
import { isPathAllowedFor, type RobotsRules, type RobotsGroup } from "@/lib/seo-audit/robots";
import { safeFetch } from "@/lib/seo-audit/fetch";
import { BOTS, ROBOTS_TEST_IDS, AI_BOT_IDS, bot } from "../bots";
import { parseTarget, fetchAs, fetchNoFollow, header, allHeaders, isHtml, fetchFailure, pool, sameHost, type FetchResult } from "../net";
import { parseDoc, metaTags, titleOf, linkRels, anchors, mainText, words, absUrl } from "../html";
import { type ToolResult, type CheckItem, type ResultSection, type Status, worst, errorResult } from "../types";

const now = () => new Date().toISOString();

/* ---------------- robots.txt ---------------- */

/** 按 RFC 9309 / Google 文档找"哪条规则决定了结果":最长匹配优先,等长时 Allow 优先 */
function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith("$");
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

function groupFor(groups: RobotsGroup[], token: string): { group: RobotsGroup | null; via: string } {
  const t = token.toLowerCase();
  const exact = groups.filter((g) => g.agents.some((a) => a.toLowerCase() === t));
  if (exact.length) return { group: { agents: [token], allow: exact.flatMap((g) => g.allow), disallow: exact.flatMap((g) => g.disallow) }, via: `User-agent: ${token}` };
  const star = groups.filter((g) => g.agents.includes("*"));
  if (star.length) return { group: { agents: ["*"], allow: star.flatMap((g) => g.allow), disallow: star.flatMap((g) => g.disallow) }, via: "User-agent: *" };
  return { group: null, via: "no matching group" };
}

export function decidingRule(rules: RobotsRules, path: string, token: string): { allowed: boolean; rule: string | null; via: string } {
  const { group, via } = groupFor(rules.groups ?? [], token);
  if (!group) return { allowed: true, rule: null, via };
  let best: { len: number; allow: boolean; raw: string } | null = null;
  const consider = (p: string, allow: boolean) => {
    if (!p) return;
    const norm = p.startsWith("/") || p.startsWith("*") ? p : `/${p}`;
    if (!patternToRegex(norm).test(path)) return;
    const len = norm.replace(/\$$/, "").length;
    if (!best || len > best.len || (len === best.len && allow && !best.allow)) best = { len, allow, raw: `${allow ? "Allow" : "Disallow"}: ${p}` };
  };
  for (const p of group.allow) consider(p, true);
  for (const p of group.disallow) consider(p, false);
  const b = best as { len: number; allow: boolean; raw: string } | null;
  return b ? { allowed: b.allow, rule: b.raw, via } : { allowed: true, rule: null, via };
}

const KNOWN_DIRECTIVES = /^(user-agent|allow|disallow|sitemap|crawl-delay|host|clean-param|request-rate|visit-time|noindex|content-signal)$/i;

function robotsSyntax(raw: string): CheckItem[] {
  const items: CheckItem[] = [];
  const lines = raw.split(/\r?\n/);
  let seenAgent = false;
  const unknown: string[] = [];
  const orphan: number[] = [];
  let noindex = 0, delay = 0, relSitemap = 0;
  lines.forEach((line, i) => {
    const l = line.replace(/#.*/, "").trim();
    if (!l) return;
    const m = /^([^:]+):\s*(.*)$/.exec(l);
    if (!m) { unknown.push(`line ${i + 1}: "${l.slice(0, 60)}"`); return; }
    const key = m[1].trim().toLowerCase();
    if (!KNOWN_DIRECTIVES.test(key)) unknown.push(`line ${i + 1}: ${m[1].trim()}`);
    if (key === "user-agent") seenAgent = true;
    if ((key === "allow" || key === "disallow") && !seenAgent) orphan.push(i + 1);
    if (key === "noindex") noindex++;
    if (key === "crawl-delay") delay++;
    if (key === "sitemap" && !/^https?:\/\//i.test(m[2].trim())) relSitemap++;
  });
  items.push(unknown.length
    ? { label: "Unrecognised lines", status: "warn", value: `${unknown.length}`, detail: `Crawlers silently ignore these: ${unknown.slice(0, 5).join("; ")}${unknown.length > 5 ? "…" : ""}` }
    : { label: "Unrecognised lines", status: "pass", value: "none", detail: "Every non-comment line is a directive crawlers understand." });
  if (orphan.length) items.push({ label: "Rules before any User-agent", status: "fail", value: `lines ${orphan.slice(0, 5).join(", ")}`, detail: "Allow/Disallow lines must sit inside a User-agent group; these are ignored." });
  if (noindex) items.push({ label: "Noindex in robots.txt", status: "warn", value: `${noindex} line(s)`, detail: "Google stopped supporting noindex in robots.txt in September 2019. Use a meta robots tag or X-Robots-Tag header instead." });
  if (delay) items.push({ label: "Crawl-delay", status: "info", value: `${delay} line(s)`, detail: "Googlebot ignores Crawl-delay; Bing and some others honour it." });
  if (relSitemap) items.push({ label: "Relative Sitemap URL", status: "warn", value: `${relSitemap}`, detail: "Sitemap lines should be absolute URLs (https://…)." });
  return items;
}

export async function robotsTester(input: string, opts: { path?: string; ua?: string } = {}): Promise<ToolResult> {
  const t = parseTarget(input);
  const rules = await fetchRobots(t.origin);
  let path = "/";
  try {
    const u = new URL(opts.path ? new URL(opts.path, t.origin).toString() : t.url);
    path = (u.pathname || "/") + (u.search || "");
  } catch { /* 用默认 / */ }

  const sections: ResultSection[] = [];
  const fileItems: CheckItem[] = [];
  const st = rules.status;
  if (!rules.found) {
    if (st === 404 || st === 410) fileItems.push({ label: "robots.txt", status: "info", value: `HTTP ${st}`, detail: "No robots.txt: Google treats this as \"everything is allowed\"." });
    else if (st && st >= 500) fileItems.push({ label: "robots.txt", status: "fail", value: `HTTP ${st}`, detail: "A 5xx on robots.txt makes Google treat the whole site as disallowed until it can fetch the file again." });
    else if (rules.isHtml) fileItems.push({ label: "robots.txt", status: "warn", value: `HTTP ${st} (HTML page)`, detail: "The URL returns an HTML page, not a robots.txt file, so crawlers see no rules." });
    else fileItems.push({ label: "robots.txt", status: "warn", value: st ? `HTTP ${st}` : rules.error || "unreachable", detail: "We couldn't read a robots.txt file." });
  } else {
    fileItems.push({ label: "robots.txt", status: "pass", value: `HTTP 200 · ${rules.bytes.toLocaleString()} bytes`, detail: `${rules.groups.length} user-agent group(s) found at ${rules.url}.` });
    if (rules.bytes > 500 * 1024) fileItems.push({ label: "File size", status: "fail", value: `${Math.round(rules.bytes / 1024)} KiB`, detail: "Google only reads the first 500 KiB; rules after that are ignored." });
    fileItems.push(rules.sitemaps.length
      ? { label: "Sitemap directive", status: "pass", value: `${rules.sitemaps.length}`, detail: rules.sitemaps.slice(0, 3).join("  ") }
      : { label: "Sitemap directive", status: "warn", value: "none", detail: "Add a Sitemap: line so every crawler, including AI crawlers, can find your sitemap." });
    if (rules.raw) fileItems.push(...robotsSyntax(rules.raw));
  }
  sections.push({ title: "The robots.txt file", kind: "checks", items: fileItems });

  const botIds = [...ROBOTS_TEST_IDS];
  const rows = botIds.map((id) => {
    const b = bot(id);
    const d = decidingRule(rules, path, b.token);
    const engine = isPathAllowedFor(rules, path, b.token);
    return [b.name, b.operator, d.allowed && engine ? "Allowed" : "Blocked", d.rule ?? "(no matching rule → allowed)", d.via];
  });
  if (opts.ua && opts.ua.trim()) {
    const token = opts.ua.trim().split(/[\/\s;]/)[0];
    const d = decidingRule(rules, path, token);
    rows.unshift([`${token} (custom)`, "—", d.allowed ? "Allowed" : "Blocked", d.rule ?? "(no matching rule → allowed)", d.via]);
  }
  sections.push({ title: `Can each crawler fetch ${path}?`, kind: "table", table: { columns: ["Crawler", "Operator", "Result", "Deciding rule", "Group used"], rows } });
  if (rules.raw) sections.push({ title: "robots.txt as served", kind: "code", code: { lang: "text", text: rules.raw.slice(0, 20000), filename: "robots.txt" } });

  const blocked = rows.filter((r) => r[2] === "Blocked").map((r) => String(r[0]));
  const googleBlocked = blocked.some((n) => n.startsWith("Googlebot"));
  const verdict: Status = googleBlocked ? "fail" : worst(fileItems.map((i) => i.status));
  return {
    ok: true, tool: "robots", input, url: t.url, fetchedAt: now(), verdict,
    headline: googleBlocked
      ? `Googlebot is blocked from ${path}. Google can't crawl this URL.`
      : blocked.length ? `${path} is open to Google; blocked for ${blocked.length} crawler(s): ${blocked.slice(0, 4).join(", ")}${blocked.length > 4 ? "…" : ""}.` : `${path} is open to all ${rows.length} crawlers we tested.`,
    sections,
  };
}

/* ---------------- AI / 搜索爬虫访问(robots + 实际请求) ---------------- */

export async function botAccess(input: string, botIds: string[] = [...AI_BOT_IDS]): Promise<ToolResult> {
  const t = parseTarget(input);
  const path = (() => { try { const u = new URL(t.url); return u.pathname + u.search; } catch { return "/"; } })();
  const [rules, browser] = await Promise.all([fetchRobots(t.origin), fetchAs(t.url, "browser")]);
  const live = await pool(botIds, 4, async (id) => {
    const b = bot(id);
    if (!b.ua) return { id, res: null as FetchResult | null };
    return { id, res: await fetchAs(t.url, id, { maxBytes: 512 * 1024 }) };
  });

  const rows: (string | null)[][] = [];
  const items: CheckItem[] = [];
  let blockedRobots = 0, blockedLive = 0;
  for (const { id, res } of live) {
    const b = bot(id);
    const d = decidingRule(rules, path, b.token);
    if (!d.allowed) blockedRobots++;
    let liveText = "— (robots.txt token only, no separate crawler)";
    let liveStatus: Status = "info";
    if (res) {
      const blk = detectBlock(res);
      if (res.status === 0) { liveText = fetchFailure(res) ?? "unreachable"; liveStatus = "warn"; }
      else if (blk) { liveText = `HTTP ${res.status} · ${blk.kind}: ${blk.evidence}`; liveStatus = "fail"; blockedLive++; }
      else if (res.status >= 400) { liveText = `HTTP ${res.status}`; liveStatus = "warn"; blockedLive++; }
      else { liveText = `HTTP ${res.status} · ${res.bytes.toLocaleString()} bytes`; liveStatus = "pass"; }
    }
    rows.push([b.name, b.operator, b.purpose, d.allowed ? "Allowed" : "Blocked", d.rule ?? "no rule → allowed", liveText]);
    items.push({
      label: b.name,
      status: !d.allowed ? (b.purpose === "training" ? "info" : "warn") : liveStatus === "fail" ? "fail" : liveStatus,
      value: `${d.allowed ? "robots: allowed" : "robots: blocked"}${res ? ` · live: ${res.status || "no response"}` : ""}`,
      detail: b.role,
    });
  }
  const browserLine = browser.status === 0 ? fetchFailure(browser) : `HTTP ${browser.status} · ${browser.bytes.toLocaleString()} bytes`;
  const sections: ResultSection[] = [
    { title: "Verdict per crawler", kind: "checks", items },
    { title: "Details", kind: "table", table: { columns: ["Crawler", "Operator", "Purpose", "robots.txt", "Deciding rule", "Live request"], rows }, note: `For comparison, a normal browser request got: ${browserLine}. Live requests come from AEOeye's servers with each bot's user-agent string; firewalls that verify a bot by IP address may treat the real crawler differently.` },
  ];
  const searchBlocked = live.filter(({ id }) => { const b = bot(id); return b.purpose !== "training" && !decidingRule(rules, path, b.token).allowed; }).length;
  return {
    ok: true, tool: "bot-access", input, url: t.url, fetchedAt: now(),
    verdict: blockedLive > 0 || searchBlocked > 0 ? "warn" : "pass",
    headline: `${botIds.length - blockedRobots} of ${botIds.length} crawlers are allowed by robots.txt${blockedLive ? `; ${blockedLive} live request(s) were blocked or challenged` : "; no live requests were blocked"}.`,
    sections,
  };
}

/* ---------------- sitemap ---------------- */

interface SitemapFile { url: string; status: number; text: string; error?: string; gz: boolean; bytes: number }

async function fetchSitemap(url: string): Promise<SitemapFile> {
  const res = await safeFetch(url, { raw: true, maxBytes: 10 * 1024 * 1024, timeoutMs: 15_000, accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" });
  let text = res.body || "";
  let gz = false;
  if (res.raw && res.raw[0] === 0x1f && res.raw[1] === 0x8b) {
    try { text = gunzipSync(Buffer.from(res.raw)).toString("utf8"); gz = true; } catch { text = ""; }
  }
  return { url: res.finalUrl || url, status: res.status, text, error: res.status === 0 ? fetchFailure(res) ?? undefined : undefined, gz, bytes: res.bytes };
}

export async function sitemapChecker(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const direct = /\.xml(\.gz)?$|sitemap/i.test(new URL(t.url).pathname) ? [t.url] : [];
  const rules = await fetchRobots(t.origin);
  const candidates = Array.from(new Set([...direct, ...rules.sitemaps, `${t.origin}/sitemap.xml`, `${t.origin}/sitemap_index.xml`, `${t.origin}/sitemap-index.xml`, `${t.origin}/wp-sitemap.xml`]));
  const found: { src: string; f: SitemapFile }[] = [];
  const discovery: (string | number)[][] = [];
  for (const c of candidates.slice(0, 8)) {
    const f = await fetchSitemap(c);
    const src = direct.includes(c) ? "you entered it" : rules.sitemaps.includes(c) ? "robots.txt" : "common path";
    const ok = f.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(f.text);
    discovery.push([c, src, f.status || "no response", ok ? "valid sitemap" : f.status === 200 ? "not a sitemap" : "—"]);
    if (ok) found.push({ src, f });
    if (found.length >= 3) break;
  }
  const sections: ResultSection[] = [{ title: "Sitemap finder: where we looked", kind: "table", table: { columns: ["URL", "Found via", "Status", "Result"], rows: discovery } }];
  if (!found.length) {
    return { ok: true, tool: "sitemap", input, url: t.url, fetchedAt: now(), verdict: "fail", headline: "No XML sitemap found in robots.txt or at the common paths.", sections };
  }

  const items: CheckItem[] = [];
  let pageUrls: string[] = [];
  const main = found[0].f;
  const p = parseSitemapXml(main.text);
  items.push({ label: "Sitemap found", status: "pass", value: main.url, detail: `Discovered via ${found[0].src}${main.gz ? " (gzipped)" : ""}.` });
  items.push(rules.sitemaps.length ? { label: "Listed in robots.txt", status: "pass", value: `${rules.sitemaps.length} Sitemap line(s)` } : { label: "Listed in robots.txt", status: "warn", value: "no", detail: "Add `Sitemap: " + main.url + "` to robots.txt so every crawler finds it." });
  items.push(p.valid ? { label: "XML parses", status: "pass", value: p.isIndex ? "sitemap index" : "urlset" } : { label: "XML parses", status: "fail", value: p.error || "invalid", detail: "Google rejects sitemaps that aren't well-formed XML." });
  const nsOk = /xmlns\s*=\s*["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(main.text);
  items.push(nsOk ? { label: "Namespace", status: "pass", value: "sitemaps.org 0.9" } : { label: "Namespace", status: "warn", value: "missing or wrong", detail: "The root element should declare xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"." });

  if (p.isIndex) {
    items.push({ label: "Child sitemaps", status: p.urlCount ? "pass" : "fail", value: `${p.urlCount}`, detail: "An index may list up to 50,000 sitemaps." });
    const kids = p.locs.slice(0, 3);
    for (const k of kids) {
      const f = await fetchSitemap(k);
      const kp = parseSitemapXml(f.text);
      items.push({ label: `Child: ${k.replace(/^https?:\/\//, "").slice(0, 70)}`, status: f.status === 200 && kp.valid ? "pass" : "fail", value: f.status === 200 ? `${kp.urlCount.toLocaleString()} URLs` : `HTTP ${f.status || "—"}`, detail: kp.valid ? undefined : kp.error });
      if (kp.valid && !kp.isIndex) pageUrls = pageUrls.concat(kp.locs);
      // 嵌套索引(索引里套索引,大站常见):再往下走一层,取第一个子 sitemap 的 URL 做抽查
      if (kp.valid && kp.isIndex && pageUrls.length < 10) {
        for (const g of kp.locs.slice(0, 2)) {
          const gf = await fetchSitemap(g);
          const gp = parseSitemapXml(gf.text);
          if (gp.valid && !gp.isIndex) pageUrls = pageUrls.concat(gp.locs);
          if (pageUrls.length >= 10) break;
        }
      }
    }
  } else {
    pageUrls = p.locs;
    items.push({ label: "URLs listed", status: p.urlCount > 50000 ? "fail" : p.urlCount ? "pass" : "fail", value: p.urlCount.toLocaleString(), detail: p.urlCount > 50000 ? "One sitemap may hold at most 50,000 URLs; split it with a sitemap index." : undefined });
  }
  if (main.bytes > 50 * 1024 * 1024) items.push({ label: "File size", status: "fail", value: `${Math.round(main.bytes / 1024 / 1024)} MB`, detail: "Sitemaps must be 50 MB (uncompressed) or smaller." });
  items.push({ label: "lastmod coverage", status: p.lastmodShare >= 0.8 ? "pass" : p.lastmodShare > 0 ? "warn" : "info", value: `${Math.round(p.lastmodShare * 100)}% of entries`, detail: p.newestLastmod ? `Newest lastmod: ${p.newestLastmod.slice(0, 10)}. Google uses lastmod only when it's consistently accurate.` : "No lastmod dates. Add them only if they reflect real content changes." });
  const offHost = pageUrls.filter((u) => !sameHost(u, t.host.replace(/^www\./, ""))).length;
  if (pageUrls.length) items.push(offHost ? { label: "URLs on the same host", status: "warn", value: `${offHost} off-host`, detail: "A sitemap should only list URLs on its own host (unless verified cross-site)." } : { label: "URLs on the same host", status: "pass", value: "all" });
  const http = pageUrls.filter((u) => u.startsWith("http://")).length;
  if (http) items.push({ label: "Protocol", status: "warn", value: `${http} http:// URLs`, detail: "List the canonical https:// version of each URL." });
  const ext = [/xmlns:image/i.test(main.text) && "image", /xmlns:video/i.test(main.text) && "video", /xmlns:news/i.test(main.text) && "news", /xhtml:link/i.test(main.text) && "hreflang"].filter(Boolean);
  if (ext.length) items.push({ label: "Extensions used", status: "info", value: ext.join(", ") });

  sections.push({ title: "Sitemap validator", kind: "checks", items });

  // 抽查:列出的 URL 是否真的 200 且可索引
  const sample = pageUrls.filter((_, i) => i % Math.max(1, Math.floor(pageUrls.length / 10)) === 0).slice(0, 10);
  const tested = await pool(sample, 4, async (u) => {
    const r = await fetchAs(u, "googlebot", { maxBytes: 512 * 1024 });
    let noindex = false, canonicalElsewhere = false;
    if (r.status === 200 && isHtml(r)) {
      const doc = parseDoc(r.body);
      const tags = metaTags(doc);
      const robots = tags.filter((m) => m.key === "robots" || m.key === "googlebot").map((m) => m.content).join(",") + "," + (header(r, "x-robots-tag") || "");
      noindex = /noindex|none/i.test(robots);
      const can = linkRels(doc, r.finalUrl).find((l) => l.rel === "canonical")?.href;
      canonicalElsewhere = !!can && can.replace(/\/$/, "") !== (r.finalUrl || u).replace(/\/$/, "");
    }
    return { u, r, noindex, canonicalElsewhere };
  });
  const sampleRows = tested.map(({ u, r, noindex, canonicalElsewhere }) => {
    const verdict = r.status === 0 ? "unreachable" : (r.chain?.length ?? 0) > 0 ? `redirects (${r.status} final)` : r.status !== 200 ? `HTTP ${r.status}` : noindex ? "noindex" : canonicalElsewhere ? "canonical points elsewhere" : "OK";
    return [u, r.status || "—", verdict];
  });
  const bad = sampleRows.filter((r) => r[2] !== "OK").length;
  sections.push({ title: `Sitemap test: ${sample.length} sampled URLs`, kind: "table", table: { columns: ["URL", "Status", "Result"], rows: sampleRows }, note: "A sitemap should list only canonical, indexable URLs that return 200. We fetched these as Googlebot Smartphone." });

  const status = worst(items.map((i) => i.status).concat(bad ? ["warn"] : []));
  return {
    ok: true, tool: "sitemap", input, url: main.url, fetchedAt: now(), verdict: status,
    headline: `${p.isIndex ? "Sitemap index" : "Sitemap"} with ${p.urlCount.toLocaleString()} ${p.isIndex ? "child sitemaps" : "URLs"}; ${!sample.length ? "we couldn't read any page URLs to sample from the child sitemaps" : bad ? `${bad} of ${sample.length} sampled URLs aren't clean 200s` : `all ${sample.length} sampled URLs return 200 and are indexable`}.`,
    sections,
  };
}

/* ---------------- sitemap 生成(按搜索引擎方式抓取,最多 500 页) ---------------- */

export async function sitemapGenerator(input: string, opts: { max?: number } = {}): Promise<ToolResult> {
  const t = parseTarget(input);
  const max = Math.min(Math.max(Number(opts.max) || 200, 10), 500);
  const deadline = Date.now() + 45_000;
  const rules = await fetchRobots(t.origin);
  const start = t.origin + "/";
  const queue: string[] = [start];
  const seen = new Set<string>([start]);
  const kept: { url: string; lastmod: string | null }[] = [];
  const skipped: (string | number)[][] = [];
  const hostBare = t.host.replace(/^www\./, "");
  let fetched = 0;
  while (queue.length && kept.length < max && Date.now() < deadline) {
    const batch = queue.splice(0, 6);
    const results = await pool(batch, 6, async (u) => {
      const path = new URL(u).pathname + new URL(u).search;
      if (!isPathAllowedFor(rules, path, "Googlebot")) return { u, skip: "blocked by robots.txt" as string | null, r: null as FetchResult | null };
      const r = await fetchAs(u, "googlebot", { maxBytes: 1024 * 1024, maxRedirects: 0 });
      fetched++;
      return { u, skip: null, r };
    });
    for (const { u, skip, r } of results) {
      if (skip || !r) { skipped.push([u, skip ?? "error"]); continue; }
      if (r.status >= 300 && r.status < 400) {
        skipped.push([u, `redirect ${r.status}`]);
        const loc = absUrl(header(r, "location"), u);
        if (loc && sameHost(loc, hostBare) && !seen.has(loc)) { seen.add(loc); queue.push(loc); }
        continue;
      }
      if (r.status !== 200 || !isHtml(r)) { skipped.push([u, r.status ? `HTTP ${r.status}${r.status === 200 ? " (not HTML)" : ""}` : "unreachable"]); continue; }
      const doc = parseDoc(r.body);
      const tags = metaTags(doc);
      const robots = tags.filter((m) => m.key === "robots" || m.key === "googlebot").map((m) => m.content).join(",") + "," + (header(r, "x-robots-tag") || "");
      if (/noindex|none/i.test(robots)) { skipped.push([u, "noindex"]); continue; }
      const can = linkRels(doc, u).find((l) => l.rel === "canonical")?.href;
      if (can && can.replace(/\/$/, "") !== u.replace(/\/$/, "")) {
        skipped.push([u, "canonical points elsewhere"]);
        if (sameHost(can, hostBare) && !seen.has(can)) { seen.add(can); queue.push(can); }
        continue;
      }
      const lm = header(r, "last-modified");
      kept.push({ url: u, lastmod: lm && !Number.isNaN(Date.parse(lm)) ? new Date(lm).toISOString().slice(0, 10) : null });
      for (const a of anchors(doc, u, hostBare)) {
        if (!a.internal || /nofollow/.test(a.rel)) continue;
        let clean: string;
        try { const x = new URL(a.href); x.hash = ""; if (/\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml|txt)$/i.test(x.pathname)) continue; clean = x.toString(); } catch { continue; }
        if (!seen.has(clean) && seen.size < max * 4) { seen.add(clean); queue.push(clean); }
      }
    }
  }
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...kept.map((k) => `  <url>\n    <loc>${k.url.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</loc>${k.lastmod ? `\n    <lastmod>${k.lastmod}</lastmod>` : ""}\n  </url>`),
    "</urlset>"].join("\n");
  const timedOut = Date.now() >= deadline;
  return {
    ok: true, tool: "sitemap-generator", input, url: t.origin, fetchedAt: now(),
    verdict: kept.length ? "pass" : "fail",
    headline: kept.length ? `Built a sitemap with ${kept.length} indexable URLs (crawled ${fetched} pages${timedOut ? ", stopped at the 45-second limit" : ""}).` : "We couldn't find any indexable pages to include.",
    sections: [
      { title: "sitemap.xml", kind: "code", code: { lang: "xml", text: xml, filename: "sitemap.xml" } },
      { title: `Skipped URLs (${skipped.length})`, kind: "table", table: { columns: ["URL", "Why it was left out"], rows: skipped.slice(0, 200) }, note: "A sitemap should contain only canonical, indexable 200 pages — so redirects, noindex pages and URLs blocked by robots.txt are left out on purpose." },
    ],
    download: { filename: "sitemap.xml", mime: "application/xml", content: xml },
  };
}

/* ---------------- 跳转链 ---------------- */

export async function redirectChecker(input: string, opts: { botId?: string } = {}): Promise<ToolResult> {
  const t = parseTarget(input);
  const botId = opts.botId && BOTS[opts.botId] ? opts.botId : "browser";
  const hops: (string | number)[][] = [];
  const seen = new Set<string>();
  let url = t.url;
  let finalStatus = 0;
  let loop = false;
  let totalMs = 0;
  const codes: number[] = [];
  for (let i = 0; i < 10; i++) {
    if (seen.has(url)) { loop = true; break; }
    seen.add(url);
    const r = await fetchNoFollow(url, botId, "GET");
    totalMs += r.ms;
    if (r.status === 0) { hops.push([i + 1, url, "no response", "", `${r.ms} ms`]); finalStatus = 0; break; }
    const loc = r.status >= 300 && r.status < 400 ? absUrl(header(r, "location"), url) : null;
    const refresh = r.status === 200 && isHtml(r) ? /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i.exec(r.body)?.[1] : null;
    hops.push([i + 1, url, r.status, loc ?? (refresh ? `meta refresh → ${refresh}` : ""), `${r.ms} ms`]);
    finalStatus = r.status;
    if (loc) { codes.push(r.status); url = loc; continue; }
    if (refresh) { codes.push(0); const n = absUrl(refresh, url); if (n) { url = n; continue; } }
    break;
  }
  const redirects = codes.length;
  const items: CheckItem[] = [];
  items.push(loop ? { label: "Redirect loop", status: "fail", value: "yes", detail: "The chain returns to a URL it already visited. Browsers and crawlers give up." } : { label: "Redirect loop", status: "pass", value: "no" });
  items.push(redirects === 0 ? { label: "Redirects", status: "pass", value: "none", detail: "The URL answers directly." } : redirects === 1 ? { label: "Redirects", status: "pass", value: "1 hop" } : { label: "Redirects", status: redirects >= 3 ? "fail" : "warn", value: `${redirects} hops`, detail: "Point the first URL straight at the final destination. Google follows up to 10 hops, but each one costs crawl time and slows users." });
  const temp = codes.filter((c) => c === 302 || c === 303 || c === 307).length;
  if (temp) items.push({ label: "Temporary redirects", status: "warn", value: `${temp} (${codes.filter((c) => [302, 303, 307].includes(c)).join(", ")})`, detail: "If the move is permanent, use 301 or 308 so Google consolidates signals on the new URL faster." });
  if (codes.includes(0)) items.push({ label: "Meta refresh", status: "warn", value: "used", detail: "Server-side 301/308 redirects are clearer signals than meta refresh." });
  if (t.url.startsWith("https://") && hops.some((h) => String(h[3]).startsWith("http://"))) items.push({ label: "HTTPS downgrade", status: "fail", value: "https → http", detail: "The chain sends HTTPS visitors to an insecure URL." });
  items.push({ label: "Final status", status: finalStatus === 200 ? "pass" : finalStatus === 0 ? "fail" : finalStatus >= 400 ? "fail" : "warn", value: finalStatus ? `HTTP ${finalStatus}` : "no response", detail: finalStatus >= 400 ? "The chain ends on an error page, so link equity and visitors are lost." : undefined });
  items.push({ label: "Total time", status: totalMs > 2000 ? "warn" : "info", value: `${totalMs} ms` });
  return {
    ok: true, tool: "redirect", input, url: t.url, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: loop ? "Redirect loop detected." : redirects === 0 ? `No redirect: ${t.url} returns HTTP ${finalStatus}.` : `${redirects} redirect${redirects > 1 ? "s" : ""} (${codes.filter(Boolean).join(" → ")}) ending in HTTP ${finalStatus}.`,
    sections: [{ title: "Every hop", kind: "table", table: { columns: ["#", "URL", "Status", "Location", "Time"], rows: hops } }, { title: "What it means", kind: "checks", items }],
  };
}

/* ---------------- 批量状态码 ---------------- */

const STATUS_MEANING: Record<string, string> = {
  "200": "OK — indexable if nothing else blocks it.",
  "301": "Moved permanently — Google transfers signals to the target.",
  "302": "Found (temporary) — Google may keep the old URL indexed for a while.",
  "304": "Not modified — fine for conditional requests.",
  "307": "Temporary redirect (method preserved).",
  "308": "Permanent redirect (method preserved) — treated like 301.",
  "401": "Unauthorized — crawlers can't see the page.",
  "403": "Forbidden — the page won't be indexed; check firewall rules for crawlers.",
  "404": "Not found — dropped from the index over time.",
  "410": "Gone — removed from the index faster than 404.",
  "429": "Too many requests — Google slows its crawl rate.",
  "500": "Server error — Google retries, then drops the URL if it persists.",
  "503": "Service unavailable — the right code for planned maintenance.",
};

export async function statusChecker(input: string): Promise<ToolResult> {
  const list = String(input || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!list.length) throw new Error("Enter at least one URL.");
  const targets = list.map((s) => { try { return parseTarget(s).url; } catch { return null; } });
  const rows = await pool(targets, 5, async (u, i) => {
    if (!u) return [list[i], "invalid URL", "", "", ""];
    const r = await fetchAs(u, "browser", { maxBytes: 256 * 1024 });
    const first = r.hops?.[0]?.status ?? r.status;
    const chain = (r.hops ?? []).filter((h) => h.status >= 300 && h.status < 400).map((h) => h.status);
    return [u, r.status || "no response", chain.length ? `${chain.join(" → ")} → ${r.status}` : String(first || "—"), r.finalUrl !== u ? r.finalUrl : "", `${r.ms} ms`];
  });
  const finals = rows.map((r) => Number(r[1])).filter((n) => Number.isFinite(n));
  const bad = finals.filter((n) => n >= 400).length;
  const codes = Array.from(new Set(rows.map((r) => String(r[1])))).filter((c) => STATUS_MEANING[c]);
  return {
    ok: true, tool: "status", input, fetchedAt: now(), verdict: bad ? "fail" : rows.some((r) => String(r[2]).includes("→")) ? "warn" : "pass",
    headline: `${rows.length} URL${rows.length > 1 ? "s" : ""} checked: ${finals.filter((n) => n === 200).length} OK, ${rows.filter((r) => String(r[2]).includes("→")).length} redirected, ${bad} errors.`,
    sections: [
      { title: "Results", kind: "table", table: { columns: ["URL", "Final status", "Status path", "Final URL", "Time"], rows } },
      { title: "What these codes mean for SEO", kind: "kv", kv: codes.map((c) => ({ key: c, value: STATUS_MEANING[c] })) },
    ],
  };
}

/* ---------------- 响应头 ---------------- */

const SEO_HEADERS: Record<string, string> = {
  "x-robots-tag": "Indexing directives sent as a header (noindex, nofollow…). Applies to PDFs and images too.",
  link: "Can carry rel=\"canonical\" or hreflang for non-HTML files.",
  "content-type": "Must be text/html for pages; wrong types can stop rendering.",
  "cache-control": "Controls browser and CDN caching; affects repeat-visit speed.",
  "last-modified": "Used for conditional requests; helps crawl efficiency.",
  etag: "Lets crawlers revalidate without downloading the page again.",
  "content-encoding": "gzip / br compression; uncompressed HTML is slower.",
  "strict-transport-security": "HSTS: forces HTTPS on future visits.",
  vary: "Tells caches which request headers change the response (e.g. User-Agent).",
  location: "Redirect target.",
  "content-language": "Declared language of the page.",
};

export async function headerChecker(input: string, opts: { botId?: string } = {}): Promise<ToolResult> {
  const t = parseTarget(input);
  const botId = opts.botId && BOTS[opts.botId] ? opts.botId : "browser";
  const first = await fetchNoFollow(t.url, botId, "GET");
  const final = first.status >= 300 && first.status < 400 ? await fetchAs(t.url, botId, { maxBytes: 512 * 1024 }) : first;
  if (final.status === 0) return errorResult("headers", input, fetchFailure(final) ?? "Unreachable");
  const hdrs = allHeaders(final);
  const flagged: CheckItem[] = [];
  for (const [k, why] of Object.entries(SEO_HEADERS)) {
    const v = header(final, k);
    if (!v) continue;
    let status: Status = "info";
    if (k === "x-robots-tag" && /noindex|none/i.test(v)) status = "fail";
    if (k === "content-encoding") status = /br|gzip|zstd/i.test(v) ? "pass" : "warn";
    if (k === "strict-transport-security") status = "pass";
    flagged.push({ label: k, status, value: v.slice(0, 200), detail: why });
  }
  if (!header(final, "content-encoding") && /html/.test(final.contentType)) flagged.push({ label: "content-encoding", status: "warn", value: "none", detail: "The HTML isn't compressed. Enable gzip or Brotli at the server or CDN." });
  if (!header(final, "x-robots-tag")) flagged.push({ label: "x-robots-tag", status: "pass", value: "not set", detail: "No header-level indexing restrictions." });
  const sections: ResultSection[] = [
    { title: "SEO-relevant headers", kind: "checks", items: flagged },
    { title: `All response headers (HTTP ${final.status})`, kind: "kv", kv: hdrs },
  ];
  if (first !== final) sections.push({ title: `First response (HTTP ${first.status})`, kind: "kv", kv: allHeaders(first) });
  return {
    ok: true, tool: "headers", input, url: final.finalUrl, fetchedAt: now(), verdict: worst(flagged.map((f) => f.status)),
    headline: `HTTP ${final.status} · ${hdrs.length} headers · ${final.contentType || "no content-type"}${first !== final ? ` (after ${final.chain.length} redirect${final.chain.length > 1 ? "s" : ""})` : ""}.`,
    sections,
  };
}

/* ---------------- meta robots + X-Robots-Tag ---------------- */

export async function metaRobotsChecker(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const [gr, rules] = await Promise.all([fetchAs(t.url, "googlebot"), fetchRobots(t.origin)]);
  // 按 IP 校验 Googlebot 的站会拒绝我们的 Googlebot UA 请求;此时改用浏览器读标签,免得把空响应读成"没有 noindex"
  const viaBrowser = gr.status !== 200;
  const r = viaBrowser ? await fetchAs(t.url, "browser") : gr;
  if (r.status === 0) return errorResult("meta-robots", input, fetchFailure(r) ?? "Unreachable");
  const doc = isHtml(r) ? parseDoc(r.body) : null;
  const tags = doc ? metaTags(doc) : [];
  const robotMetas = tags.filter((m) => ["robots", "googlebot", "googlebot-news", "bingbot"].includes(m.key));
  const xrt = r.headers ? (() => { const v: string[] = []; r.headers.forEach((val, k) => { if (k === "x-robots-tag") v.push(val); }); return v; })() : [];
  const forGoogle = [...robotMetas.filter((m) => m.key === "robots" || m.key === "googlebot").map((m) => m.content), ...xrt.filter((v) => !/^\s*[a-z-]+bot\s*:/i.test(v) || /^\s*googlebot\s*:/i.test(v)).map((v) => v.replace(/^\s*googlebot\s*:/i, ""))].join(",").toLowerCase();
  const has = (d: string) => new RegExp(`(^|[,\\s])${d}([,\\s]|$)`).test(forGoogle);
  const noindex = has("noindex") || has("none");
  const nofollow = has("nofollow") || has("none");
  const path = new URL(r.finalUrl || t.url).pathname;
  const crawlable = isPathAllowedFor(rules, path, "Googlebot");
  const items: CheckItem[] = [
    { label: "Meta robots tags", status: robotMetas.length ? "info" : "pass", value: robotMetas.length ? robotMetas.map((m) => `${m.key}="${m.content}"`).join("  ") : "none (defaults to index, follow)" },
    { label: "X-Robots-Tag header", status: xrt.length ? "info" : "pass", value: xrt.length ? xrt.join(" | ") : "none" },
    { label: "Indexing", status: noindex ? "fail" : "pass", value: noindex ? "noindex — Google will drop this page" : "indexable", detail: noindex ? "Remove noindex (from the tag and the header) if you want this page in search." : undefined },
    { label: "Link following", status: nofollow ? "warn" : "pass", value: nofollow ? "nofollow — links on this page pass no signals" : "follow" },
    { label: "Snippet controls", status: "info", value: ["nosnippet", "max-snippet", "max-image-preview", "max-video-preview", "noimageindex", "notranslate", "unavailable_after"].filter((d) => forGoogle.includes(d)).join(", ") || "none", detail: "nosnippet also keeps text out of AI Overviews; max-snippet limits how much text Google can quote." },
    { label: "robots.txt", status: crawlable ? "pass" : noindex ? "fail" : "warn", value: crawlable ? "Googlebot may crawl this URL" : "Googlebot is blocked by robots.txt", detail: !crawlable ? "If robots.txt blocks a page, Google never sees its noindex — the URL can still be indexed from links. Unblock it so the noindex can be read." : undefined },
    { label: "HTTP status", status: r.status === 200 ? "pass" : "warn", value: `HTTP ${r.status}` },
    ...(viaBrowser ? [{ label: "Read as", status: "info" as const, value: `browser (Googlebot user agent got HTTP ${gr.status || "no response"})`, detail: "Many sites verify Googlebot by IP and reject look-alike requests like ours. We read the tags as a browser instead; confirm what the real Googlebot gets with URL Inspection in Search Console." }] : []),
  ];
  return {
    ok: true, tool: "meta-robots", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: noindex ? "This page tells Google not to index it." : !crawlable ? "Indexable by tags, but robots.txt blocks Googlebot from crawling it." : "Indexable: no noindex in the meta tag or the X-Robots-Tag header.",
    sections: [{ title: "Directives Google will follow", kind: "checks", items }],
  };
}

/* ---------------- 以 Googlebot 身份抓取(对比浏览器) ---------------- */

function snapshot(r: FetchResult, host: string) {
  if (r.status === 0 || !isHtml(r)) return null;
  const doc = parseDoc(r.body);
  const tags = metaTags(doc);
  const text = mainText(doc).text;
  const links = anchors(doc, r.finalUrl, host);
  return {
    title: titleOf(doc) ?? "",
    canonical: linkRels(doc, r.finalUrl).find((l) => l.rel === "canonical")?.href ?? "",
    robots: tags.filter((m) => m.key === "robots" || m.key === "googlebot").map((m) => m.content).join(", "),
    words: words(text).length,
    links: links.length,
    jsonLd: doc.jsonLd.length,
    text: text.slice(0, 3000),
  };
}

export async function googlebotSimulator(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const [g, b, rules] = await Promise.all([fetchAs(t.url, "googlebot"), fetchAs(t.url, "browser"), fetchRobots(t.origin)]);
  if (g.status === 0 && b.status === 0) return errorResult("googlebot", input, fetchFailure(g) ?? "Unreachable");
  const host = t.host.replace(/^www\./, "");
  const gs = snapshot(g, host), bs = snapshot(b, host);
  const path = (() => { try { return new URL(t.url).pathname; } catch { return "/"; } })();
  const allowed = isPathAllowedFor(rules, path, "Googlebot");
  const blk = detectBlock(g);
  const rows: (string | number)[][] = [
    ["HTTP status", g.status || "—", b.status || "—"],
    ["Final URL", g.finalUrl, b.finalUrl],
    ["Bytes", g.bytes, b.bytes],
    ["Title", gs?.title ?? "—", bs?.title ?? "—"],
    ["Canonical", gs?.canonical || "—", bs?.canonical || "—"],
    ["Meta robots", gs?.robots || "—", bs?.robots || "—"],
    ["Words in main content", gs?.words ?? "—", bs?.words ?? "—"],
    ["Links", gs?.links ?? "—", bs?.links ?? "—"],
    ["JSON-LD blocks", gs?.jsonLd ?? "—", bs?.jsonLd ?? "—"],
  ];
  const items: CheckItem[] = [
    { label: "robots.txt", status: allowed ? "pass" : "fail", value: allowed ? "Googlebot may crawl this URL" : "blocked for Googlebot" },
    { label: "Response to Googlebot", status: blk ? "fail" : g.status === 200 ? "pass" : "warn", value: blk ? `${blk.kind}: ${blk.evidence}` : `HTTP ${g.status}` },
  ];
  if (gs && bs) {
    const diffWords = Math.abs(gs.words - bs.words) / Math.max(bs.words, 1);
    items.push({ label: "Content parity", status: diffWords > 0.3 ? "warn" : "pass", value: `${gs.words} vs ${bs.words} words`, detail: diffWords > 0.3 ? "Googlebot and a browser get noticeably different content. Make sure this isn't accidental cloaking or a bot block." : "Googlebot gets essentially the same content as a browser." });
    items.push({ label: "Text in the raw HTML", status: gs.words < 100 ? "warn" : "pass", value: `${gs.words} words`, detail: gs.words < 100 ? "Very little text before JavaScript runs. Google renders JS, but many AI crawlers don't — server-render your main content." : "Main content is present without JavaScript." });
    if (gs.title !== bs.title) items.push({ label: "Title differs", status: "warn", value: `"${gs.title.slice(0, 60)}" vs "${bs.title.slice(0, 60)}"` });
  }
  const sections: ResultSection[] = [
    { title: "What changed for Googlebot", kind: "checks", items },
    { title: "Googlebot Smartphone vs desktop browser", kind: "table", table: { columns: ["", "Googlebot Smartphone", "Chrome desktop"], rows } },
  ];
  if (gs?.text) sections.push({ title: "Text Googlebot can read (first 3,000 characters, no JavaScript)", kind: "text", text: gs.text });
  sections.push({ title: "Request details", kind: "kv", kv: [{ key: "User-agent sent", value: BOTS.googlebot.ua }, { key: "Note", value: "This is a single raw fetch with Googlebot's user-agent from AEOeye's servers. Real Googlebot also renders JavaScript and comes from Google IP ranges, which some firewalls verify." }] });
  return {
    ok: true, tool: "googlebot", input, url: g.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: blk ? "Googlebot's request was blocked or challenged." : !allowed ? "robots.txt blocks Googlebot from this URL." : `Googlebot gets HTTP ${g.status} with ${gs?.words ?? 0} words of readable text.`,
    sections,
  };
}

/* ---------------- 页面源码 ---------------- */

export async function viewSource(input: string, opts: { botId?: string } = {}): Promise<ToolResult> {
  const t = parseTarget(input);
  const botId = opts.botId && BOTS[opts.botId] ? opts.botId : "browser";
  const r = await fetchAs(t.url, botId, { maxBytes: 1024 * 1024 });
  if (r.status === 0) return errorResult("source", input, fetchFailure(r) ?? "Unreachable");
  const raw = r.body || "";
  // 压缩成一两行的 HTML 没法读:在标签之间断行(只改显示,不改内容);已经分好行的源码原样展示
  const lineCount = raw.split("\n").length;
  const minified = isHtml(r) && raw.length > 3000 && raw.length / Math.max(1, lineCount) > 400;
  const body = minified ? raw.replace(/>\s*</g, ">\n<") : raw;
  const kv = [
    { key: "Status", value: `HTTP ${r.status}${r.chain.length ? ` after ${r.chain.length} redirect(s)` : ""}` },
    { key: "Final URL", value: r.finalUrl },
    { key: "Size", value: `${r.bytes.toLocaleString()} bytes${r.truncated ? " (truncated at 1 MB)" : ""}` },
    { key: "Content-Type", value: r.contentType || "—" },
    { key: "Lines", value: minified ? `${lineCount.toLocaleString()} as served · ${body.split("\n").length.toLocaleString()} after formatting` : lineCount.toLocaleString() },
    { key: "Fetched as", value: BOTS[botId].name },
  ];
  // 把 SEO 关键标签从源码里摘出来,附上所在行号(和下方带行号的源码对得上)
  const lines = body.split("\n");
  const lineOf = (re: RegExp) => { const i = lines.findIndex((l) => re.test(l)); return i >= 0 ? i + 1 : null; };
  const seoTags: { key: string; value: string }[] = [];
  if (isHtml(r)) {
    const probes: [string, RegExp][] = [
      ["<title>", /<title[\s>]/i],
      ["meta description", /<meta[^>]+name=["']?description["']?/i],
      ["meta robots", /<meta[^>]+name=["']?(robots|googlebot)["']?/i],
      ["canonical", /<link[^>]+rel=["']?canonical["']?/i],
      ["hreflang", /<link[^>]+hreflang=/i],
      ["og:title", /property=["']?og:title/i],
      ["og:image", /property=["']?og:image["'\s>]/i],
      ["twitter:card", /name=["']?twitter:card/i],
      ["viewport", /<meta[^>]+name=["']?viewport/i],
      ["JSON-LD", /application\/ld\+json/i],
    ];
    for (const [label, re] of probes) {
      const n = lineOf(re);
      const count = n ? lines.filter((l) => re.test(l)).length : 0;
      seoTags.push({ key: label, value: n ? `line ${n.toLocaleString()}${count > 1 ? ` (+${count - 1} more)` : ""}` : "not found" });
    }
  }
  return {
    ok: true, tool: "source", input, url: r.finalUrl, fetchedAt: now(), verdict: r.status === 200 ? "pass" : "warn",
    headline: `${r.bytes.toLocaleString()} bytes of ${isHtml(r) ? "HTML" : r.contentType || "content"} from ${r.finalUrl}.`,
    sections: [
      { title: "Response", kind: "kv", kv },
      ...(seoTags.length ? [{ title: "SEO tags in this source", kind: "kv" as const, kv: seoTags, note: "Line numbers match the source below. Use the search box to jump to any tag." }] : []),
      { title: minified ? "Page source (formatted)" : "Page source", kind: "code", code: { lang: isHtml(r) ? "html" : "text", text: body, filename: "source.html" }, ...(minified ? { note: "The page was served minified, so we put each tag on its own line to make it readable. The content itself is unchanged; download keeps the formatted version." } : {}) },
    ],
  };
}

/* ---------------- llms.txt ---------------- */

export async function llmsTxtChecker(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const url = `${t.origin}/llms.txt`;
  const [r, full] = await Promise.all([safeFetch(url, { timeoutMs: 10_000, maxBytes: 1024 * 1024, accept: "text/plain,text/markdown,*/*;q=0.5" }), safeFetch(`${t.origin}/llms-full.txt`, { method: "HEAD", timeoutMs: 8_000 })]);
  const items: CheckItem[] = [];
  const body = r.body || "";
  const html = /^\s*<(!doctype|html)/i.test(body);
  if (r.status !== 200 || html) {
    items.push({ label: "llms.txt", status: "fail", value: r.status === 200 ? "returns an HTML page" : `HTTP ${r.status || "no response"}`, detail: "No llms.txt at the domain root. It's optional — but if you want one, it must live at /llms.txt as plain Markdown." });
    return { ok: true, tool: "llms-txt", input, url, fetchedAt: now(), verdict: "fail", headline: "No llms.txt file found at the root of this domain.", sections: [{ title: "llms.txt", kind: "checks", items }] };
  }
  const lines = body.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  const quote = lines.findIndex((l) => /^>\s*\S/.test(l));
  const h2s = lines.filter((l) => /^##\s+\S/.test(l));
  const links = Array.from(body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)).map((m) => m[2]);
  items.push({ label: "File found", status: "pass", value: `HTTP 200 · ${r.bytes.toLocaleString()} bytes`, detail: `Content-Type: ${r.contentType || "—"}` });
  items.push(h1 === -1 ? { label: "H1 title", status: "fail", value: "missing", detail: "The spec requires one H1 (`# Your Brand`) as the first heading." } : h1 > 3 ? { label: "H1 title", status: "warn", value: lines[h1].slice(0, 80), detail: "The H1 should be the first line." } : { label: "H1 title", status: "pass", value: lines[h1].slice(0, 80) });
  items.push(quote === -1 ? { label: "Summary blockquote", status: "warn", value: "missing", detail: "Add a one-line `> summary` under the title — it's what a model reads first." } : { label: "Summary blockquote", status: "pass", value: lines[quote].slice(0, 120) });
  items.push(h2s.length ? { label: "Sections (H2)", status: "pass", value: `${h2s.length}: ${h2s.slice(0, 5).map((h) => h.replace(/^##\s+/, "")).join(", ")}` } : { label: "Sections (H2)", status: "warn", value: "none", detail: "Group links under `## Docs`, `## Products` etc." });
  items.push(links.length ? { label: "Links", status: "pass", value: `${links.length}` } : { label: "Links", status: "warn", value: "none", detail: "Each section should list `- [Name](https://…): note` links." });
  if (r.bytes > 200 * 1024) items.push({ label: "Size", status: "warn", value: `${Math.round(r.bytes / 1024)} KB`, detail: "llms.txt is meant to be a short index; put long content in llms-full.txt." });
  items.push({ label: "llms-full.txt", status: "info", value: full.status === 200 ? "present" : "not found", detail: "Optional companion with full page text." });
  const sample = links.slice(0, 8);
  const checked = await pool(sample, 4, async (u) => { const x = await safeFetch(u, { method: "HEAD", timeoutMs: 8_000 }); return [u, x.status || "no response"]; });
  const broken = checked.filter((c) => Number(c[1]) >= 400 || c[1] === "no response").length;
  if (sample.length) items.push({ label: "Linked URLs", status: broken ? "warn" : "pass", value: broken ? `${broken} of ${sample.length} sampled are broken` : `all ${sample.length} sampled resolve` });
  return {
    ok: true, tool: "llms-txt", input, url, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: `llms.txt found with ${h2s.length} section(s) and ${links.length} link(s)${broken ? `; ${broken} sampled link(s) are broken` : ""}.`,
    sections: [{ title: "Format check (llmstxt.org proposal)", kind: "checks", items }, ...(sample.length ? [{ title: "Sampled links", kind: "table" as const, table: { columns: ["URL", "Status"], rows: checked } }] : []), { title: "Your llms.txt", kind: "code", code: { lang: "markdown", text: body.slice(0, 20000), filename: "llms.txt" } }],
  };
}

/* ---------------- IndexNow 提交 ---------------- */

export async function indexNowSubmit(input: string, opts: { key?: string; urls?: string } = {}): Promise<ToolResult> {
  const t = parseTarget(input);
  const key = String(opts.key || "").trim();
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new Error("The key must be 8–128 letters, numbers or dashes.");
  const keyLocation = `${t.origin}/${key}.txt`;
  const kr = await safeFetch(keyLocation, { timeoutMs: 10_000, maxBytes: 4096 });
  const keyOk = kr.status === 200 && (kr.body || "").trim() === key;
  const urls = String(opts.urls || "").split(/\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const valid = urls.filter((u) => sameHost(u, t.host.replace(/^www\./, "")));
  const items: CheckItem[] = [
    { label: "Key file", status: keyOk ? "pass" : "fail", value: keyOk ? keyLocation : `HTTP ${kr.status || "—"} at ${keyLocation}`, detail: keyOk ? "The key file is live and matches." : `Create a plain-text file at ${keyLocation} containing only the key, then try again.` },
    { label: "URLs", status: valid.length ? "pass" : "fail", value: `${valid.length} on ${t.host}${urls.length !== valid.length ? ` (${urls.length - valid.length} other-host URLs dropped)` : ""}` },
  ];
  if (!keyOk || !valid.length) return { ok: true, tool: "indexnow", input, url: t.origin, fetchedAt: now(), verdict: "fail", headline: !keyOk ? "Key file not found — IndexNow would reject the submission." : "No URLs on this host to submit.", sections: [{ title: "Before submitting", kind: "checks", items }] };
  const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host: t.host, key, keyLocation, urlList: valid }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const code = res?.status ?? 0;
  const meaning: Record<number, string> = { 200: "Accepted: URLs submitted successfully.", 202: "Accepted: key validation pending.", 400: "Bad request: invalid format.", 403: "Forbidden: the key wasn't valid for this host.", 422: "Unprocessable: URLs don't belong to the host or key mismatch.", 429: "Too many requests: slow down." };
  items.push({ label: "IndexNow response", status: code === 200 || code === 202 ? "pass" : "fail", value: code ? `HTTP ${code}` : "no response", detail: meaning[code] ?? "Unexpected response." });
  return { ok: true, tool: "indexnow", input, url: t.origin, fetchedAt: now(), verdict: code === 200 || code === 202 ? "pass" : "fail", headline: code === 200 || code === 202 ? `${valid.length} URL(s) submitted to IndexNow (shared with Bing, Yandex, Seznam, Naver and others).` : `IndexNow rejected the submission (HTTP ${code || "—"}).`, sections: [{ title: "Submission", kind: "checks", items }] };
}
