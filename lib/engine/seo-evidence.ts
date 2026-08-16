/* ============================================================
   SEO 事实包 —— 全部由我们自己抓取解析,零 LLM 参与。

   它有两个用途,第二个比第一个重要:
     ① 喂给引擎当分析地基,省得它们靠猜;
     ② 当**测谎仪** —— 引擎说"你没有 schema"而我们抓到了,
        就说明它根本没看站,只是在套模板。这类结论一律丢弃,
        并把该引擎的可信度如实写进报告。

   所以这里的每一条都必须是可核实的客观事实,不能有任何判断。
   判断交给引擎,事实由我们保证。
   ============================================================ */

import type { FetchedPage } from "./crawl";
import { fetchText } from "./crawl";
import { extractJsonLd, metaDescriptionOf, isNoindex, hasViewport, wordCount } from "./extract";
import type { CrawlerVerdict, SeoEvidence } from "./types";

/**
 * 需要逐个判定的 AI 爬虫。
 * 这些 UA 决定了你的内容能不能进各家模型的训练/检索管线 —— 屏蔽了它们
 * 再优化内容也是白做,所以它排在事实包第一位。
 */
const AI_BOTS: { bot: string; label: string }[] = [
  { bot: "GPTBot", label: "OpenAI · 训练抓取" },
  { bot: "OAI-SearchBot", label: "OpenAI · ChatGPT 搜索" },
  { bot: "ChatGPT-User", label: "OpenAI · 用户实时访问" },
  { bot: "ClaudeBot", label: "Anthropic · 训练抓取" },
  { bot: "Claude-User", label: "Anthropic · 用户实时访问" },
  { bot: "PerplexityBot", label: "Perplexity · 索引" },
  { bot: "Perplexity-User", label: "Perplexity · 用户实时访问" },
  { bot: "Google-Extended", label: "Google · Gemini / AI Overviews 训练" },
  { bot: "CCBot", label: "Common Crawl(多家模型的语料来源)" },
  { bot: "Applebot-Extended", label: "Apple Intelligence" },
];

type RobotsGroup = { agents: string[]; disallow: string[]; allow: string[] };

/** 按 RFC 风格解析 robots.txt 成 user-agent 分组 */
function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // 连续多行 user-agent 属于同一组
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow") current.disallow.push(value);
    else if (field === "allow") current.allow.push(value);
  }
  return groups;
}

/**
 * 判定某个 bot 能否抓首页("/")。
 * 优先精确匹配该 bot 的分组;没有就落到 `*` 分组;都没有 = 未提及 = 默认放行。
 */
function verdictFor(bot: string, groups: RobotsGroup[]): CrawlerVerdict {
  const lower = bot.toLowerCase();
  const exact = groups.find((g) => g.agents.includes(lower));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const group = exact ?? wildcard;
  const label = AI_BOTS.find((b) => b.bot === bot)?.label ?? bot;

  if (!group) {
    return { bot, label, allowed: true, rule: "robots.txt 未提及 → 默认放行" };
  }
  // 整站封禁的写法是 `Disallow: /`
  const blocksRoot = group.disallow.some((d) => d === "/" || d === "/*");
  // 显式 Allow: / 覆盖整站封禁
  const allowsRoot = group.allow.some((a) => a === "/" || a === "/*");
  const source = exact ? `User-agent: ${bot}` : "User-agent: *";

  if (blocksRoot && !allowsRoot) {
    return { bot, label, allowed: false, rule: `${source} → Disallow: /` };
  }
  return {
    bot,
    label,
    allowed: true,
    rule: group.disallow.length ? `${source} → 未封禁首页` : `${source} → 无 Disallow`,
  };
}

/** 粗暴去标签取正文字数 —— 用来测「不跑 JS 的爬虫能看到多少」 */
function rawTextWordCount(html: string): number {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return wordCount(stripped);
}

function attr(html: string, re: RegExp): string | undefined {
  return html.match(re)?.[1]?.trim() || undefined;
}

/** 抽 H1/H2 文本 */
function headings(html: string, tag: "h1" | "h2"): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

/** JSON-LD 关键字段缺失检查 —— AI 提取品牌事实时最常卡在这几个字段上 */
function schemaGapsOf(blocks: unknown[]): string[] {
  const gaps: string[] = [];
  const need: Record<string, string[]> = {
    Organization: ["name", "url", "logo", "sameAs"],
    Product: ["name", "description", "offers"],
    FAQPage: ["mainEntity"],
    Article: ["headline", "author", "datePublished"],
  };
  for (const block of blocks) {
    const node = block as Record<string, unknown>;
    const t = node?.["@type"];
    const typeNames = typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x) => typeof x === "string") : [];
    for (const typeName of typeNames as string[]) {
      const required = need[typeName];
      if (!required) continue;
      for (const field of required) {
        const v = node[field];
        const missing = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
        if (missing) gaps.push(`${typeName}.${field}`);
      }
    }
  }
  return [...new Set(gaps)];
}

/** 段落平均词数 —— AI 更爱短段落,这条直接影响可摘录性 */
function avgParagraphWords(html: string): number {
  const paras: number[] = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = wordCount(m[1].replace(/<[^>]+>/g, " "));
    if (n > 0) paras.push(n);
  }
  if (!paras.length) return 0;
  return Math.round(paras.reduce((a, b) => a + b, 0) / paras.length);
}

function countTag(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
}

/** 归一化品牌名:去掉常见后缀和分隔符后的尾巴,只比核心名 */
function normalizeBrand(s: string): string {
  return s
    .split(/[|—–\-·:]/)[0]
    .replace(/\b(inc|ltd|llc|co|corp|gmbh|app|ai|io|com)\b\.?/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * 构建事实包。
 * 注意 `plainHtml`:这是**不经过 JS 渲染**的原始响应,必须单独抓一次 ——
 * Firecrawl 返回的 rawHtml 是渲染后的,拿它测「爬虫看不看得到内容」会得出反的结论。
 */
export async function buildSeoEvidence(args: {
  url: string;
  home: FetchedPage;
  robots: { ok: boolean; text: string };
  sitemap: { ok: boolean };
  llms: { ok: boolean };
}): Promise<SeoEvidence> {
  const { url, home, robots, sitemap, llms } = args;
  const html = home.rawHtml || "";

  // 不跑 JS 的爬虫看到的是这份
  let plainHtml = "";
  let responseMs: number | null = null;
  try {
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { "User-Agent": "AEOeyeBot/1.0 (+https://aeoeye.com)" },
      signal: AbortSignal.timeout(10000),
    });
    responseMs = Date.now() - t0;
    if (res.ok) plainHtml = (await res.text()).slice(0, 400000);
  } catch {
    /* 抓不到就按 0 字处理,下面会如实反映 */
  }

  const groups = robots.ok ? parseRobots(robots.text) : [];
  const crawlers = AI_BOTS.map(({ bot }) => verdictFor(bot, groups));

  const { blocks, types } = extractJsonLd(html);
  const h1s = headings(html, "h1");
  const h2s = headings(html, "h2");

  const rawTextWords = rawTextWordCount(plainHtml);
  const renderedWords = wordCount(home.markdown);
  // 渲染后有实质内容、但原始响应几乎是空壳 ⇒ 纯客户端渲染,多数 AI 爬虫看到的是空白页
  const jsDependent = renderedWords >= 150 && rawTextWords < Math.max(80, renderedWords * 0.3);

  const title = home.title || attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogSiteName = attr(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i);
  const orgNode = blocks.find((b) => {
    const t = (b as Record<string, unknown>)?.["@type"];
    return typeof t === "string" ? /Organization|Brand|LocalBusiness/i.test(t) : false;
  }) as Record<string, unknown> | undefined;
  const schemaName = typeof orgNode?.name === "string" ? orgNode.name : undefined;

  const brandNames = [
    title ? { source: "<title>", value: title } : null,
    ogSiteName ? { source: "og:site_name", value: ogSiteName } : null,
    schemaName ? { source: "JSON-LD name", value: schemaName } : null,
    h1s[0] ? { source: "<h1>", value: h1s[0] } : null,
  ].filter(Boolean) as { source: string; value: string }[];

  const normalized = [...new Set(brandNames.map((b) => normalizeBrand(b.value)).filter(Boolean))];
  const brandConsistent = normalized.length <= 1;

  const desc = metaDescriptionOf(html);
  const canonical = attr(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);

  return {
    url,
    fetchedAt: new Date().toISOString(),

    crawlers,
    hasLlmsTxt: llms.ok,
    hasRobotsTxt: robots.ok,
    sitemapReachable: sitemap.ok,
    sitemapInRobots: /sitemap\s*:/i.test(robots.text || ""),

    rawTextWords,
    renderedWords,
    jsDependent,

    schemaTypes: types,
    schemaGaps: schemaGapsOf(blocks),

    h1Count: h1s.length,
    h2Count: h2s.length,
    headingOutline: h2s.slice(0, 12),
    avgParagraphWords: avgParagraphWords(html),
    listCount: countTag(html, "ul") + countTag(html, "ol"),
    tableCount: countTag(html, "table"),
    hasFaq: types.some((t) => /FAQPage|Question/i.test(t)) || /frequently asked questions|\bFAQ\b/i.test(html),

    brandNames,
    brandConsistent,

    title,
    titleLength: title?.length ?? 0,
    metaDescription: desc || undefined,
    metaDescriptionLength: desc.length,
    canonical,
    hasViewport: hasViewport(html),
    isHttps: url.startsWith("https://"),
    noindex: isNoindex(html),
    responseMs,
  };
}

/** 抓齐 robots / sitemap / llms 三件套(给 run.ts 复用) */
export async function fetchSiteFiles(origin: string) {
  const [robots, sitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap.xml`),
    fetchText(`${origin}/llms.txt`),
  ]);
  return { robots, sitemap, llms };
}

/**
 * 免费报告钩子用的问题数 —— **纯代码数出来的客观问题**,零 LLM 参与。
 *
 * 为什么不用 LLM 数:免费报告拿这个数字去承诺付费内容,数字必须能兑现。
 * 这里每一条都来自事实包里可核实的事实,付费报告一定会展开讲到,
 * 不存在「钩子说 7 条、买完只有 3 条」的情况。
 */
export function countEvidenceIssues(e: SeoEvidence): number {
  let n = 0;
  n += e.crawlers.filter((c) => !c.allowed).length; // 每个被拦的 AI 爬虫算一条
  if (!e.hasLlmsTxt) n++;
  if (!e.hasRobotsTxt) n++;
  if (!e.sitemapReachable) n++;
  else if (!e.sitemapInRobots) n++;
  if (e.jsDependent) n++;
  if (!e.schemaTypes.length) n++;
  else n += Math.min(3, e.schemaGaps.length); // schema 字段缺失最多计 3 条,避免刷数
  if (!e.brandConsistent) n++;
  if (e.noindex) n++;
  if (!e.canonical) n++;
  if (!e.metaDescription || e.metaDescriptionLength < 50) n++;
  if (e.h1Count !== 1) n++;
  if (e.h2Count < 3) n++;
  if (!e.hasFaq) n++;
  if (e.avgParagraphWords > 80) n++;
  if (!e.hasViewport) n++;
  if (!e.isHttps) n++;
  return n;
}

/**
 * 把事实包压成给 LLM 读的纯事实文本。
 * 刻意只陈述事实、不下判断 —— 判断是引擎的活,我们下了判断它就只会附和。
 */
export function evidenceToPrompt(e: SeoEvidence): string {
  const blocked = e.crawlers.filter((c) => !c.allowed);
  const lines = [
    `URL: ${e.url}`,
    `Fetched: ${e.fetchedAt}`,
    "",
    "== AI crawler access (from robots.txt) ==",
    ...e.crawlers.map((c) => `- ${c.bot} (${c.label}): ${c.allowed ? "ALLOWED" : "BLOCKED"} — ${c.rule}`),
    blocked.length ? `TOTAL BLOCKED: ${blocked.length}` : "TOTAL BLOCKED: 0",
    `llms.txt: ${e.hasLlmsTxt ? "present" : "missing"}`,
    `robots.txt: ${e.hasRobotsTxt ? "present" : "missing"}`,
    `sitemap.xml: ${e.sitemapReachable ? "reachable" : "not reachable"}; declared in robots.txt: ${e.sitemapInRobots}`,
    "",
    "== Rendering (what a non-JS crawler sees) ==",
    `Words in raw HTML response (no JS executed): ${e.rawTextWords}`,
    `Words after JS rendering: ${e.renderedWords}`,
    `JS-dependent content: ${e.jsDependent ? "YES — non-JS crawlers see a near-empty page" : "no"}`,
    `Response time: ${e.responseMs === null ? "unknown" : `${e.responseMs}ms`}`,
    "",
    "== Structured data ==",
    `JSON-LD types found: ${e.schemaTypes.length ? e.schemaTypes.join(", ") : "NONE"}`,
    `Missing required fields: ${e.schemaGaps.length ? e.schemaGaps.join(", ") : "none"}`,
    "",
    "== Page structure ==",
    `H1 count: ${e.h1Count}; H2 count: ${e.h2Count}`,
    `H2 outline: ${e.headingOutline.length ? e.headingOutline.map((h) => `"${h}"`).join(" | ") : "none"}`,
    `Average paragraph length: ${e.avgParagraphWords} words`,
    `Lists: ${e.listCount}; Tables: ${e.tableCount}; FAQ block: ${e.hasFaq ? "yes" : "no"}`,
    "",
    "== Entity consistency ==",
    ...e.brandNames.map((b) => `- ${b.source}: "${b.value}"`),
    `Consistent across sources: ${e.brandConsistent ? "yes" : "NO — the brand name differs between sources"}`,
    "",
    "== Technical basics ==",
    `Title (${e.titleLength} chars): ${e.title ? `"${e.title}"` : "MISSING"}`,
    `Meta description (${e.metaDescriptionLength} chars): ${e.metaDescription ? `"${e.metaDescription}"` : "MISSING"}`,
    `Canonical: ${e.canonical ?? "MISSING"}`,
    `Viewport meta: ${e.hasViewport ? "present" : "MISSING"}`,
    `HTTPS: ${e.isHttps}`,
    `noindex: ${e.noindex ? "YES — the page asks engines not to index it" : "no"}`,
  ];
  return lines.join("\n");
}
