/* ============================================================
   AEOeye AI Crawler Access Study —— 零成本一手数据(只发普通 HTTP GET,不调任何付费 API)

   对 ai-crawler-study-domains.json 里的每个域名:
     1. GET https://<domain>/robots.txt(跟随跳转;用审计引擎同一套解析器 lib/seo-audit/robots.ts 判定
        每个 AI 爬虫能不能抓首页 "/",以及 robots.txt 有没有点名它)
     2. 若 robots 允许我们的 UA:GET /llms.txt(判定是否是真的 markdown 文件,而不是 HTML 软 404)
     3. 若 robots 允许我们的 UA:GET /(首页 JSON-LD 的 @type、noai 元标记、是否被反爬挑战拦下)
   礼貌:UA 自报身份并带说明链接;同域请求串行、间隔 1 秒;全局并发 8;每次请求 15 秒超时。

   用法:npx tsx scripts/research/ai-crawler-access-study.mts [输出目录,默认 public/resources]
   产物:ai-crawler-access-study-2026-10.csv(逐域名)+ ai-crawler-access-study-2026-10.json(分组汇总 + 方法)
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { parseRobots, isPathAllowedFor, emptyRobots, looksLikeHtml, type RobotsRules } from "../../lib/seo-audit/robots";

const UA = "Mozilla/5.0 (compatible; AEOeyeResearch/1.0; +https://aeoeye.com/bot)";
const UA_TOKEN = "AEOeyeResearch";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3 * 1024 * 1024;
const CONCURRENCY = 8;
const GAP_MS = 1_000;

/** 逐个判定的爬虫(robots 产品标记)。分类依据各家官方文档,见 JSON 产物里的 botNotes。 */
const BOTS = {
  training: ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider", "meta-externalagent"],
  retrieval: ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"],
  search: ["Googlebot", "Bingbot"],
} as const;
const ALL_BOTS = [...BOTS.training, ...BOTS.retrieval, ...BOTS.search];

type Fetched = { status: number | null; finalUrl: string | null; body: string; headers: Record<string, string>; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<Fetched> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "text/html,text/plain,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    let body = "";
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
    return { status: res.status, finalUrl: res.url, body, headers };
  } catch (e) {
    return { status: null, finalUrl: null, body: "", headers: {}, error: String((e as Error)?.name === "AbortError" ? "timeout" : (e as Error)?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

function namedAgents(rules: RobotsRules): Set<string> {
  const s = new Set<string>();
  for (const g of rules.groups ?? []) for (const a of g.agents) s.add(a.toLowerCase());
  return s;
}

function jsonLdTypes(html: string): { blocks: number; invalid: number; types: string[] } {
  const types = new Set<string>();
  let blocks = 0;
  let invalid = 0;
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
    for (const [k, v] of Object.entries(o)) if (k !== "@context" && typeof v === "object") walk(v);
  };
  while ((m = re.exec(html)) !== null) {
    blocks++;
    try {
      walk(JSON.parse(m[1].trim().replace(/^<!--|-->$/g, "")));
    } catch {
      invalid++;
    }
  }
  return { blocks, invalid, types: [...types].sort() };
}

const ORG_TYPES = /^(Organization|Corporation|OnlineStore|OnlineBusiness|LocalBusiness|NewsMediaOrganization|EducationalOrganization|NGO|Store|Brand)$/;

function looksChallenged(f: Fetched): boolean {
  if (f.status === 429) return true;
  if (f.headers["cf-mitigated"] === "challenge") return true;
  if ((f.status === 403 || f.status === 503) && /just a moment|cf-chl|captcha|access denied|attention required|px-captcha|are you a robot|request unsuccessful/i.test(f.body.slice(0, 20000))) return true;
  return f.status === 403;
}

type Row = Record<string, string | number | boolean | null>;

async function study(domain: string, segment: string): Promise<Row> {
  const row: Row = { domain, segment };
  // 1) robots.txt —— apex 失败再试 www
  let robots = await get(`https://${domain}/robots.txt`);
  if (robots.status === null && !domain.startsWith("www.")) {
    await sleep(GAP_MS);
    robots = await get(`https://www.${domain}/robots.txt`);
  }
  const host = robots.finalUrl ? new URL(robots.finalUrl).host : domain;
  row.host = host;
  row.robotsStatus = robots.status;
  let rules: RobotsRules;
  let robotsState: "ok" | "none" | "html" | "unreachable" | "server-error";
  if (robots.status === null) {
    rules = emptyRobots(null, robots.error);
    robotsState = "unreachable";
  } else if (robots.status >= 500) {
    rules = emptyRobots(robots.status);
    robotsState = "server-error";
  } else if (robots.status >= 400) {
    rules = emptyRobots(robots.status); // RFC 9309:4xx = 无限制
    robotsState = "none";
  } else if (looksLikeHtml(robots.body)) {
    rules = emptyRobots(robots.status);
    robotsState = "html";
  } else {
    rules = { ...parseRobots(robots.body), found: true, status: robots.status, bytes: robots.body.length };
    robotsState = "ok";
  }
  row.robotsState = robotsState;
  row.robotsError = robots.error ?? null;
  const usable = robotsState !== "unreachable" && robotsState !== "server-error";
  const named = namedAgents(rules);
  for (const bot of ALL_BOTS) {
    row[`blocks:${bot}`] = usable ? !isPathAllowedFor(rules, "/", bot) : null;
    row[`names:${bot}`] = usable ? named.has(bot.toLowerCase()) : null;
  }
  row.blocksAllForStar = usable ? !isPathAllowedFor(rules, "/", "*") : null;
  row.contentSignals = robotsState === "ok" ? /^\s*content-signal\s*:/im.test(robots.body) : null;
  row.contentSignalAiTrainNo = robotsState === "ok" ? /content-signal\s*:[^\n]*ai-train\s*=\s*no/i.test(robots.body) : null;
  row.contentSignalSearchYes = robotsState === "ok" ? /content-signal\s*:[^\n]*search\s*=\s*yes/i.test(robots.body) : null;
  row.robotsMentionsLlmsTxt = robotsState === "ok" ? /llms(-full)?\.txt/i.test(robots.body) : null;
  row.sitemapDirective = robotsState === "ok" ? rules.sitemaps.length > 0 : null;

  // 2) llms.txt
  const ourAllowed = (p: string) => usable && isPathAllowedFor(rules, p, UA_TOKEN);
  if (ourAllowed("/llms.txt")) {
    await sleep(GAP_MS);
    const l = await get(`https://${host}/llms.txt`);
    const text = l.body.replace(/^﻿/, "").trimStart();
    const sameSite = l.finalUrl ? new URL(l.finalUrl).pathname.toLowerCase().endsWith("/llms.txt") : false;
    row.llmsStatus = l.status;
    // 403 / 429 / 5xx / 超时 = 被挡或出错,判断不了有没有 —— 记为未知、不进分母(否则会把"被反爬挡住"算成"没有 llms.txt")
    const unknown = l.status === null || l.status === 401 || l.status === 403 || l.status === 429 || l.status >= 500;
    row.llmsUnknown = unknown;
    row.llmsTxt = unknown ? null : l.status === 200 && sameSite && !looksLikeHtml(l.body) && text.length >= 40 && /^#\s+\S/.test(text);
    row.llmsSoft404 = unknown ? null : l.status === 200 && (looksLikeHtml(l.body) || !sameSite);
    row.llmsBytes = row.llmsTxt ? l.body.length : null;
  } else {
    row.llmsStatus = null;
    row.llmsUnknown = null;
    row.llmsTxt = null;
    row.llmsSoft404 = null;
    row.llmsBytes = null;
  }

  // 3) 首页
  if (ourAllowed("/")) {
    await sleep(GAP_MS);
    const h = await get(`https://${host}/`);
    row.homeStatus = h.status;
    row.homeError = h.error ?? null;
    const challenged = h.status !== null && h.status !== 200 && looksChallenged(h);
    row.homeChallenged = h.status === null ? null : challenged;
    const ok = h.status === 200 && !challenged;
    row.homeFetched = ok;
    if (ok) {
      const ld = jsonLdTypes(h.body);
      row.jsonLdBlocks = ld.blocks;
      row.jsonLdInvalid = ld.invalid;
      row.jsonLdTypes = ld.types.join("|");
      row.hasOrganization = ld.types.some((t) => ORG_TYPES.test(t));
      row.hasWebSite = ld.types.includes("WebSite");
      row.hasFAQPage = ld.types.includes("FAQPage");
      row.hasProductOrSoftware = ld.types.some((t) => /^(Product|SoftwareApplication|WebApplication|MobileApplication|Offer|AggregateOffer)$/.test(t));
      row.sameAs = /"sameAs"\s*:/.test(h.body);
      row.metaNoAi = /<meta[^>]+name=["']?(robots|googlebot)["']?[^>]+content=["'][^"']*\bnoai\b/i.test(h.body);
      row.cdn = h.headers["cf-ray"] ? "cloudflare" : h.headers["x-akamai-transformed"] || /akamai/i.test(h.headers["server"] ?? "") ? "akamai" : h.headers["x-vercel-id"] ? "vercel" : h.headers["x-served-by"]?.includes("cache-") ? "fastly" : "";
    }
  } else {
    row.homeStatus = null;
    row.homeFetched = false;
    row.homeSkipped = usable ? "disallowed-by-robots" : "robots-unavailable";
  }
  return row;
}

async function main() {
  const outDir = process.argv[2] ?? "public/resources";
  const src = JSON.parse(fs.readFileSync(new URL("./ai-crawler-study-domains.json", import.meta.url), "utf8")) as Record<string, string[] | string>;
  const jobs: { domain: string; segment: string }[] = [];
  for (const [segment, list] of Object.entries(src)) if (Array.isArray(list)) for (const domain of list) jobs.push({ domain, segment });
  // 调试:STUDY_ONLY=a.com,b.com 只跑这几个
  const only = process.env.STUDY_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  if (only?.length) jobs.splice(0, jobs.length, ...jobs.filter((j) => only.includes(j.domain)));

  const rows: Row[] = [];
  let i = 0;
  const startedAt = new Date().toISOString();
  async function worker() {
    while (i < jobs.length) {
      const j = jobs[i++];
      try {
        // 单域名总时限:个别服务器会让 body 流永远不结束,且不再持有任何句柄 ——
        // 那样 Node 会在事件循环空掉时静默退出(第一次全量跑就停在 375/391)。计时器既兜底也保活。
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<Row>((resolve) => {
          timer = setTimeout(() => resolve({ domain: j.domain, segment: j.segment, robotsState: "script-timeout", robotsError: "domain took over 120s" }), 120_000);
        });
        rows.push(await Promise.race([study(j.domain, j.segment), limit]));
        clearTimeout(timer);
      } catch (e) {
        rows.push({ domain: j.domain, segment: j.segment, robotsState: "script-error", robotsError: String((e as Error)?.message ?? e) });
      }
      if (rows.length % 25 === 0) console.error(`${rows.length}/${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  rows.sort((a, b) => String(a.segment).localeCompare(String(b.segment)) || String(a.domain).localeCompare(String(b.domain)));
  const finishedAt = new Date().toISOString();

  // ---- 汇总:分母只含 robots.txt 可判定的站(ok / none / html);首页类指标只含首页抓到的站
  const segments = ["all", ...new Set(rows.map((r) => String(r.segment)))];
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
  const summary: Record<string, unknown> = {};
  for (const seg of segments) {
    const rs = rows.filter((r) => seg === "all" || r.segment === seg);
    const usable = rs.filter((r) => ["ok", "none", "html"].includes(String(r.robotsState)));
    const llmsChecked = rs.filter((r) => r.llmsTxt !== null && r.llmsTxt !== undefined);
    const homes = rs.filter((r) => r.homeFetched === true);
    const homeTried = rs.filter((r) => r.homeChallenged !== null && r.homeChallenged !== undefined);
    const anyOf = (r: Row, bots: readonly string[]) => bots.some((b) => r[`blocks:${b}`] === true);
    const blocks: Record<string, number | null> = {};
    const names: Record<string, number | null> = {};
    for (const b of ALL_BOTS) {
      blocks[b] = pct(usable.filter((r) => r[`blocks:${b}`] === true).length, usable.length);
      names[b] = pct(usable.filter((r) => r[`names:${b}`] === true).length, usable.length);
    }
    summary[seg] = {
      domains: rs.length,
      robotsUsable: usable.length,
      robotsMissing: usable.filter((r) => r.robotsState !== "ok").length,
      robotsUnavailable: rs.length - usable.length,
      blocksPct: blocks,
      namesPct: names,
      blocksAnyTrainingPct: pct(usable.filter((r) => anyOf(r, BOTS.training)).length, usable.length),
      blocksAnyRetrievalPct: pct(usable.filter((r) => anyOf(r, BOTS.retrieval)).length, usable.length),
      blocksGPTBotButAllowsOAISearchBotPct: pct(usable.filter((r) => r["blocks:GPTBot"] === true && r["blocks:OAI-SearchBot"] === false).length, usable.length),
      blocksAllForStarPct: pct(usable.filter((r) => r.blocksAllForStar === true).length, usable.length),
      contentSignalsPct: pct(usable.filter((r) => r.contentSignals === true).length, usable.length),
      contentSignalAiTrainNoPct: pct(usable.filter((r) => r.contentSignalAiTrainNo === true).length, usable.length),
      sitemapDirectivePct: pct(usable.filter((r) => r.sitemapDirective === true).length, usable.length),
      llmsChecked: llmsChecked.length,
      llmsBlockedOrError: rs.filter((r) => r.llmsUnknown === true).length,
      llmsTxtPct: pct(llmsChecked.filter((r) => r.llmsTxt === true).length, llmsChecked.length),
      llmsSoft404Pct: pct(llmsChecked.filter((r) => r.llmsSoft404 === true).length, llmsChecked.length),
      homeTried: homeTried.length,
      homeChallengedPct: pct(homeTried.filter((r) => r.homeChallenged === true).length, homeTried.length),
      homesParsed: homes.length,
      jsonLdAnyPct: pct(homes.filter((r) => Number(r.jsonLdBlocks) > 0).length, homes.length),
      organizationPct: pct(homes.filter((r) => r.hasOrganization === true).length, homes.length),
      webSitePct: pct(homes.filter((r) => r.hasWebSite === true).length, homes.length),
      faqPagePct: pct(homes.filter((r) => r.hasFAQPage === true).length, homes.length),
      productOrSoftwarePct: pct(homes.filter((r) => r.hasProductOrSoftware === true).length, homes.length),
      sameAsPct: pct(homes.filter((r) => r.sameAs === true).length, homes.length),
      metaNoAiPct: pct(homes.filter((r) => r.metaNoAi === true).length, homes.length),
    };
  }

  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "ai-crawler-access-study-2026-10.csv"), csv);
  fs.writeFileSync(
    path.join(outDir, "ai-crawler-access-study-2026-10.json"),
    JSON.stringify(
      {
        study: "AEOeye AI Crawler Access Study",
        startedAt,
        finishedAt,
        userAgent: UA,
        sample: "Convenience sample of well-known brands chosen by AEOeye (SaaS, AI-visibility vendors incl. aeoeye.com, e-commerce & consumer brands) plus two contrast groups (news publishers; UGC/review sites). Not a random sample of the web. Full list: scripts/research/ai-crawler-study-domains.json",
        method: [
          "GET https://<domain>/robots.txt (redirects followed; www retried if the apex was unreachable). Parsed with the same parser AEOeye's SEO audit uses (robots-parser matching: longest match, * wildcards, $ anchors, Allow wins ties).",
          "A bot 'blocks' = its effective rules disallow the homepage path '/'. Partial blocks (e.g. Disallow: /checkout) are not counted as blocks. A bot is 'named' when robots.txt has a user-agent group for its exact product token.",
          "4xx robots.txt = no restrictions (RFC 9309). 5xx / unreachable robots.txt = excluded from the denominators (robotsUnavailable).",
          "llms.txt counts only when /llms.txt returns 200, is not HTML, stays on /llms.txt after redirects and starts with a Markdown H1. Fetched only where robots.txt allowed our user agent. 401/403/429/5xx/timeouts are 'unknown' (blocked or erroring) and excluded from the llms.txt denominator.",
          "Homepage fetched only where robots.txt allowed our user agent. JSON-LD @type values collected from every application/ld+json block, including @graph. 'Challenged' = 403/429 or a bot-challenge page.",
          "Politeness: requests per domain sequential with a 1-second gap; 8 domains at a time; 15-second timeout; self-identifying user agent.",
        ],
        botNotes: {
          training: "GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Bytespider, meta-externalagent — crawl or control use of content for model training. Blocking them does not remove a site from ChatGPT search, Claude search or Google AI Overviews.",
          retrieval: "OAI-SearchBot (ChatGPT search), ChatGPT-User (user-triggered fetches), Claude-SearchBot / Claude-User, PerplexityBot / Perplexity-User — fetch pages to answer and cite in real time.",
          search: "Googlebot and Bingbot — classic search crawlers; Google AI Overviews / AI Mode draw on Googlebot's index, ChatGPT search and Copilot partly on Bing's.",
          sources: [
            "https://developers.openai.com/api/docs/bots",
            "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
            "https://docs.perplexity.ai/guides/bots",
            "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
            "https://support.apple.com/en-us/119829",
          ],
        },
        summary,
      },
      null,
      1
    ) + "\n"
  );
  console.error(`done: ${rows.length} domains → ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
