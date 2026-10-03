/* ============================================================
   SEO Audit · robots.txt 解析与路径判定

   分两层:
     · 解析层是我们自己的(groups / sitemaps / crawl-delay)—— 报告要
       把分组原样展示给用户,还要对 AI 爬虫逐个出状态,这些 robots-parser
       不暴露;
     · **匹配层用 robots-parser**(与 google/robotstxt 同一套匹配算法:
       最长匹配、`*` 通配、`$` 锚定、同长 Allow 优先、Crawl-delay)。
       crawl.robots.blocks-site 是 critical 级别的判定,误判会把一个健康
       的站打成 F,所以匹配语义不能自己手搓。
   两层之间的桥:把解析出的 groups 序列化成规范 robots 文本再喂给
   robots-parser —— 保证"报告里展示的规则"和"实际用于判定的规则"
   是同一份(含补前导斜杠这类归一化)。

   UA 匹配按 RFC 9309 / Google:产品标记大小写不敏感的**精确**匹配
   ("Googlebot/2.1" 与 "googlebot" 相同,"Googlebot-Image" 不是 "Googlebot");
   没有专属组就回退到 "*"。
   ============================================================ */

import robotsParser from "robots-parser";

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

export type AiCrawlerStatus = "allow" | "disallow" | "unspecified";

export interface RobotsRules {
  found: boolean;
  status: number | null;
  sitemaps: string[];
  /** 对 * 或 Googlebot 整站 Disallow: / */
  disallowAll: boolean;
  groups: RobotsGroup[];
  bytes: number;
  error?: string;
  /* ---- v2 追加(可选,parseRobots / fetchRobots 填充) ---- */
  /** 原文(截到 32 KiB,供报告展示) */
  raw?: string;
  /** 对我们的 UA 生效的 Crawl-delay(秒;专属组优先,否则 *) */
  crawlDelay?: number | null;
  contentType?: string | null;
  /** 正文以 <!doctype / <html 开头 —— 软 200,不是 robots 文件 */
  isHtml?: boolean;
  /** Googlebot(专属组,否则 *)被整站禁止 */
  googlebotDisallowAll?: boolean;
  aiCrawlers?: Record<string, AiCrawlerStatus>;
  hasSitemapDirective?: boolean;
}

export const DEFAULT_UA = "AEOeyeBot";
export const GOOGLEBOT_UA = "Googlebot";

/**
 * 报告里逐个出状态的 AI 爬虫(展示名 → robots 里的产品标记)。
 * 前 6 个是 v2 的原名单,顺序不动(检查项证据按这个顺序列出);v4 追加的放在后面。
 * 每一个都必须出现在下面的 AI_RETRIEVAL_BOTS 或 AI_TRAINING_BOTS 里(测试守着)。
 */
export const AI_CRAWLERS: Record<string, string> = {
  GPTBot: "gptbot",
  ClaudeBot: "claudebot",
  PerplexityBot: "perplexitybot",
  "Google-Extended": "google-extended",
  "OAI-SearchBot": "oai-searchbot",
  CCBot: "ccbot",
  // v4(规格 v2 aisearch.crawlers)
  "ChatGPT-User": "chatgpt-user",
  "Perplexity-User": "perplexity-user",
  "Claude-SearchBot": "claude-searchbot",
  "Claude-User": "claude-user",
  Bingbot: "bingbot",
  Applebot: "applebot",
  "Applebot-Extended": "applebot-extended",
  Bytespider: "bytespider",
};

/**
 * 检索类:决定 AI 搜索 / 助手能不能实时抓到页面去引用 —— aisearch.crawlers 按它们的 allow/unspecified 占比计分。
 * (Bingbot 在列:ChatGPT 搜索与 Copilot 都建立在 Bing 索引上;Applebot 喂 Siri / Spotlight。)
 */
export const AI_RETRIEVAL_BOTS: readonly string[] = Object.freeze([
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "Bingbot",
  "Applebot",
]);

/**
 * 训练类:只决定内容会不会进模型训练语料,屏蔽它们是站长的商业选择 —— 只作证据,不计分。
 * (Google-Extended / Applebot-Extended 只是 robots 控制标记,本身不抓页面。)
 */
// ClaudeBot 归训练类:Anthropic 官方说明 ClaudeBot 抓取的是可能用于训练的内容,Claude 的检索 / 引用走
// Claude-SearchBot 与 Claude-User(https://support.anthropic.com/en/articles/8896518)。只屏蔽 ClaudeBot 不影响被 Claude 引用。
export const AI_TRAINING_BOTS: readonly string[] = Object.freeze(["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Applebot-Extended", "Bytespider"]);

/**
 * Apple 官方:robots.txt 没提 Applebot、但提了 Googlebot 时,Applebot 按 Googlebot 的规则走
 * (https://support.apple.com/en-us/119829)。不照这个判,"只放行 Google"的站会被误报成封了 Applebot。
 */
const FALLBACK_GROUP: Record<string, string> = { applebot: "googlebot" };

const RAW_CAP = 32 * 1024;
/** robots-parser 需要一个 URL 作为基址;这个主机名永远不会被请求 */
const MATCH_BASE = "http://robots.invalid";

/**
 * robots 里的产品标记不带版本号:"Googlebot/2.1" → "googlebot";
 * 完整 UA 串("Mozilla/5.0 (compatible; AEOeyeBot/1.0; +…)")取 compatible; 后面的标记。
 */
export function agentToken(value: string): string {
  const v = value.trim();
  const compat = /compatible;\s*([a-z0-9_.-]+)/i.exec(v);
  const token = compat ? compat[1] : v;
  return token.toLowerCase().split("/")[0].trim();
}

function normalizePattern(p: string): string {
  // Google 的做法:不以 / 或 * 开头的规则补一个 /
  return p.startsWith("/") || p.startsWith("*") ? p : `/${p}`;
}

/** 空的 RobotsRules —— "没有 robots.txt",一切允许 */
export function emptyRobots(status: number | null = null, error?: string): RobotsRules {
  const r: RobotsRules = { found: false, status, sitemaps: [], disallowAll: false, groups: [], bytes: 0 };
  if (error) r.error = error;
  return r;
}

export function looksLikeHtml(text: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html[\s>])/i.test((text ?? "").replace(/^﻿/, "").slice(0, 512));
}

interface Parsed {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** agent → crawl-delay 秒 */
  delays: Map<string, number>;
}

function parseGroups(text: string): Parsed {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const delays = new Map<string, number>();
  let current: RobotsGroup | null = null;
  // 上一行是否 User-agent:连续的 UA 行归到同一个 group
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/^﻿/, "").replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    switch (field) {
      case "user-agent": {
        const agent = agentToken(value);
        if (!agent) break;
        if (!current || !lastWasAgent) {
          current = { agents: [], allow: [], disallow: [] };
          groups.push(current);
        }
        if (!current.agents.includes(agent)) current.agents.push(agent);
        lastWasAgent = true;
        break;
      }
      case "allow":
      case "disallow": {
        lastWasAgent = false;
        if (!current || !value) break; // 没有 group 的规则和空规则都忽略
        (field === "allow" ? current.allow : current.disallow).push(normalizePattern(value));
        break;
      }
      case "crawl-delay": {
        lastWasAgent = false;
        const n = Number(value);
        if (current && Number.isFinite(n) && n >= 0) for (const a of current.agents) delays.set(a, n);
        break;
      }
      case "sitemap": {
        // Sitemap 是全局记录,不影响 group 边界
        if (value && !sitemaps.includes(value)) sitemaps.push(value);
        break;
      }
      default:
        // host 等:属于当前 group,但结束 UA 连续段
        lastWasAgent = false;
    }
  }
  return { groups, sitemaps, delays };
}

/** 把 groups 序列化成规范 robots 文本(robots-parser 的输入) */
function serialize(groups: RobotsGroup[], delays?: Map<string, number>): string {
  const lines: string[] = [];
  for (const g of groups) {
    if (!g.agents.length) continue;
    for (const a of g.agents) lines.push(`User-agent: ${a}`);
    // 没有任何规则的组也要登记(空 Disallow = 该 UA 一切允许,且不再回退到 *)
    if (!g.allow.length && !g.disallow.length) lines.push("Disallow:");
    for (const p of g.allow) lines.push(`Allow: ${p}`);
    for (const p of g.disallow) lines.push(`Disallow: ${p}`);
    if (delays) {
      const d = g.agents.map((a) => delays.get(a)).find((x) => typeof x === "number");
      if (typeof d === "number") lines.push(`Crawl-delay: ${d}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

type Matcher = ReturnType<typeof robotsParser>;

const matcherCache = new WeakMap<RobotsGroup[], Matcher>();

function matcherFor(groups: RobotsGroup[], delays?: Map<string, number>): Matcher {
  let m = matcherCache.get(groups);
  if (!m) {
    m = robotsParser(`${MATCH_BASE}/robots.txt`, serialize(groups, delays));
    matcherCache.set(groups, m);
  }
  return m;
}

function hasGroupFor(groups: RobotsGroup[], token: string): boolean {
  return groups.some((g) => g.agents.includes(token));
}

function allowedByMatcher(m: Matcher, path: string, ua: string): boolean {
  const p = path.startsWith("/") ? path : `/${path}`;
  let url: string;
  try {
    url = new URL(p, `${MATCH_BASE}/`).href;
  } catch {
    return true;
  }
  return m.isAllowed(url, agentToken(ua)) !== false;
}

export function parseRobots(text: string): Omit<RobotsRules, "found" | "status" | "bytes" | "error"> {
  const source = text ?? "";
  const { groups, sitemaps, delays } = parseGroups(source);
  const m = matcherFor(groups, delays);

  // "Disallow: /" 对 * 或对 Googlebot 生效就是整站封锁
  const starBlocked = !allowedByMatcher(m, "/", "*");
  const googlebotDisallowAll = !allowedByMatcher(m, "/", GOOGLEBOT_UA);
  const disallowAll = starBlocked || googlebotDisallowAll;

  const aiCrawlers: Record<string, AiCrawlerStatus> = {};
  for (const [name, token] of Object.entries(AI_CRAWLERS)) {
    const fallback = FALLBACK_GROUP[token];
    if (hasGroupFor(groups, token)) aiCrawlers[name] = allowedByMatcher(m, "/", token) ? "allow" : "disallow";
    else if (fallback && hasGroupFor(groups, fallback)) aiCrawlers[name] = allowedByMatcher(m, "/", fallback) ? "allow" : "disallow";
    else aiCrawlers[name] = starBlocked ? "disallow" : "unspecified";
  }

  const delay = m.getCrawlDelay(agentToken(DEFAULT_UA));

  return {
    sitemaps,
    disallowAll,
    groups,
    raw: source.length > RAW_CAP ? source.slice(0, RAW_CAP) : source,
    crawlDelay: typeof delay === "number" && Number.isFinite(delay) ? delay : null,
    isHtml: looksLikeHtml(source),
    googlebotDisallowAll,
    aiCrawlers,
    hasSitemapDirective: sitemaps.length > 0,
  };
}

/**
 * 路径是否允许抓取。path 传 pathname(+search)。
 * 默认 ua "AEOeyeBot",没有专属 group 就看 "*";robots 不存在或解析失败 → 允许。
 */
export function isPathAllowed(rules: RobotsRules, path: string, ua: string = DEFAULT_UA): boolean {
  if (!rules || !rules.found || !Array.isArray(rules.groups) || rules.groups.length === 0) return true;
  return allowedByMatcher(matcherFor(rules.groups), path, ua);
}

/** 同 isPathAllowed,但 UA 必填 —— 供"Google 能不能抓"这类判断,读起来不会误以为是我们的 UA */
export function isPathAllowedFor(rules: RobotsRules, path: string, ua: string): boolean {
  return isPathAllowed(rules, path, ua);
}

/** 对 ua 生效的 Crawl-delay(秒):专属组优先,否则 *;没有 → null */
export function crawlDelayFor(rules: RobotsRules, ua: string = DEFAULT_UA): number | null {
  if (!rules || !rules.found) return null;
  if (agentToken(ua) === agentToken(DEFAULT_UA) && typeof rules.crawlDelay === "number") return rules.crawlDelay;
  if (rules.raw) {
    const { groups, delays } = parseGroups(rules.raw);
    const d = robotsParser(`${MATCH_BASE}/robots.txt`, serialize(groups, delays)).getCrawlDelay(agentToken(ua));
    return typeof d === "number" && Number.isFinite(d) ? d : null;
  }
  return null;
}
