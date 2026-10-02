/* ============================================================
   SEO Audit · 内容信号 —— v3 SEO Ranking Score 的页面级原料

   每个 2xx 的 HTML 页面算一份 PageContentSignals,挂在 page.content 上
   (parse.ts 调用)。ranking.ts / relevance.ts 只读这些字段,不读全文 ——
   落库的只有计数、比例与短文本(每页 < 3 KB)。

   为什么全是规则、不用模型(规格 §0):同一页面审计多少次都必须得到同一组数字,
   每个数字都要能指回页面上的具体文字。词表只收"高度特征化"的短语,宁可漏计也不误伤
   普通写作 —— 误判一个真人写的段落为 AI 套话,比漏掉一个套话代价大得多。

   口径(下游按此读):
     · 主体文本 = 去掉 nav/header/footer/aside(含 role=navigation/banner/contentinfo)
       与 script/style/noscript/template/svg 之后的可见文本。它与 minhash / textSample
       是**同一次抽取**(extractMainContent):词数、词表命中、数据点都基于这同一份文本;
     · 段落 = <p>,以及直接写在块级容器(div / section …)里的散文本(很多站点不用 <p>);
       ≥ 4 词才算段落 —— 按钮、眉标、"All articles" 这类 UI 碎片会把平均段落长度拉低,
       让一堵 300 词的文字墙看起来像短段落。<li> 是列表项;标题、表格单元格、代码块不是段落;
     · 句子与 Flesch 只在"散文"(段落 + 列表项)上算:标题不进,否则一页 30 个短标题会把
       可读性虚抬;表格单元格不进,数字表格不是读出来的句子;
     · 结构计数(H2/H3、列表、表格、图片、外链、下一步链接)都只看主体区域 ——
       侧栏的"相关文章"、页脚的媒体 logo 不是正文;目录 / 面包屑里的列表不算内容列表;
     · "主体区域" = 与主体文本同一片 DOM(body 去掉外壳),不是 <main> 标签:挂在 body 里的
       弹窗 / 表单也在其中 —— 这与 minhash 的口径一致,改它就会改掉近重复检测的指纹;
     · 署名、日期、弹窗线索、联系方式看整页:文章自己的 <header> 里常放署名与日期,
       弹窗挂在 body 末尾,邮箱 / 电话 / 地址多在页脚。

   性能(与复审 C6 同一约束):全部迭代遍历、线性;切块与词表最多分析前
   MAX_ANALYZED_CHARS 个字符 —— 超大页只会少算,不会把事件循环卡住。
   ============================================================ */

import { NodeType, TextNode, type HTMLElement, type Node as HtmlNode } from "node-html-parser";
import type { PageContentSignals } from "./types";
import { dedupeKey, isSameSite, normalizeUrl } from "./url";

/* ============================================================
   共享文本工具 —— parse.ts 也从这里取,保证词数 / 主体文本只有一个口径
   ============================================================ */

export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * 截断字符串但不劈开 UTF-16 代理对。半个 emoji 序列化成 "\ud83d" 后 Postgres 的 jsonb
 * 会拒收整份结果(审计白跑),所以任何落库字符串的截断都走这里。
 */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = Math.max(0, max);
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return s.slice(0, end);
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** 词数:CJK 一字一词;其余按字母数字串计("don't"、"run-rate"、"3.5" 各算一个) */
export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = text.replace(CJK, " ");
  const tokens = rest.match(/[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return cjk + tokens;
}

/** 小写、去标点的词序列(minhash 的 shingle 与 leadText 用它;CJK 一字一词) */
export function wordTokens(text: string): string[] {
  return (text.toLowerCase().replace(CJK, " $& ").match(/[\p{L}\p{N}]+/gu) ?? []) as string[];
}

export function tagOf(el: HTMLElement): string {
  return (el.rawTagName ?? "").toLowerCase();
}

function roleOf(el: HTMLElement): string {
  return (el.getAttribute("role") ?? "").toLowerCase();
}

/** 页面"外壳":主体文本要去掉它们 */
export const CHROME_TAGS = new Set(["nav", "header", "footer", "aside"]);
/** 不可见内容:预扫描已把前四种的内容剥掉,svg 里的 <title>/<text> 也不算页面文字 */
export const INVISIBLE_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);

export function isChrome(el: HTMLElement, tags: Set<string>): boolean {
  const tag = tagOf(el);
  if (tags.has(tag)) return true;
  if (tag === "div" || tag === "ul" || tag === "section" || tag === "aside") {
    const role = roleOf(el);
    if (role === "navigation" || role === "banner" || role === "contentinfo") return true;
  }
  return false;
}

/** 主体文本的剔除规则(minhash / textSample / 内容信号共用) */
export function isMainSkip(el: HTMLElement): boolean {
  return INVISIBLE_TAGS.has(tagOf(el)) || isChrome(el, CHROME_TAGS);
}

/**
 * element.text 的有上限版本(同口径:文本节点直接相连、<br> 记为换行),读够 max 个字符就停。
 * 标题、锚文本、署名只需要前几百个字符;嵌套的 <h1><span><h1>… 若每层都取完整 .text,
 * 底部一段大文本会被复制成"层数 × 文本长"(复审 C6)。返回值最多 max + 1 个字符,
 * 调用方据此判断"原文比上限长"。
 */
export function boundedText(el: HtmlNode, max: number): string {
  let out = "";
  const stack: HtmlNode[] = [];
  for (let i = el.childNodes.length - 1; i >= 0; i--) stack.push(el.childNodes[i]);
  while (stack.length && out.length <= max) {
    const node = stack.pop() as HtmlNode;
    if (node.nodeType === NodeType.TEXT_NODE) {
      // 先截原文再解码:TextNode.text 每次都把整段原文 decode 一遍,超长文本节点不能每层都付一次
      const raw = (node as TextNode).rawText;
      const room = max + 1 - out.length + 32;
      out += raw.length > room ? new TextNode(raw.slice(0, room)).text : (node as TextNode).text;
    } else if (node.nodeType === NodeType.ELEMENT_NODE) {
      if (tagOf(node as HTMLElement) === "br") {
        out += "\n";
        continue;
      }
      const kids = node.childNodes;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }
  return out.length > max + 1 ? out.slice(0, max + 1) : out;
}

/* ============================================================
   上限
   ============================================================ */

/** 切块、词表、数据点最多分析的主体文本字符数(约 3 万英文词,真实长文远小于此) */
export const MAX_ANALYZED_CHARS = 200_000;
/** 段落的最少词数:更短的是 UI 碎片(按钮、眉标、日期行) */
export const MIN_PARAGRAPH_WORDS = 4;
/** Flesch 至少要这么多散文词;更少时公式的波动比信号大 */
export const MIN_FLESCH_WORDS = 30;
export const LEAD_WORDS = 150;
const MAX_LEAD_CHARS = 1_500;
export const FIRST_PARAGRAPH_CHARS = 300;
const MAX_ENTITY_CHARS = 100;
const MAX_NAME_CHARS = 100;
const MAX_AUTHOR_LINK_CHARS = 500;
/** "By <名字>" 只在主体文本前这么多字符里找(与 textSample 同长) */
export const BYLINE_SCAN_CHARS = 400;
/** 正文后 30% 才算"下一步"链接 */
export const NEXT_STEP_FROM = 0.7;
/** 外链 / 图片去重集合的上限(DOM 已封顶 1 万元素,这是第二道保险) */
const MAX_TRACKED = 2_000;
/**
 * 站内链接按目标去重后的上限 —— 与 parse.ts 的 MAX_DOM_ELEMENTS 相同。不能更小:
 * "下一步"链接恰恰是页面**后面**的那些,先到先得的上限会把它们全挤掉。
 */
const MAX_INTERNAL_TRACKED = 10_000;
const MAX_LD_NODES = 5_000;
const MAX_LD_DEPTH = 12;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 统一引号与连字符:词表按 ASCII 写,页面里常是弯引号 / 不换行连字符 */
function normalizeTypography(s: string): string {
  return s.replace(/[‘’ʼ′]/g, "'").replace(/[‐‑]/g, "-");
}

/* ============================================================
   词表(规格 §2;只追加词形变化,不扩大语义 —— 扩展处在注释里标明)
   ============================================================ */

/** 一手经验。"we used to / I used to" 是习惯过去时,不是"我们用过",排除 */
const EXPERIENCE_PATTERNS: string[] = [
  String.raw`\bin (?:our|my) experience\b`,
  String.raw`\b(?:we|i) (?:tested|tried)\b`,
  String.raw`\b(?:we|i) used\b(?! to\b)`,
  String.raw`\b(?:we|i) found\b`,
  String.raw`\bhands-on\b`,
  String.raw`\bwe (?:measured|ran|spent|interviewed)\b`,
  String.raw`\bour results\b`,
  String.raw`\bour test(?:s|ing)?\b`,
  String.raw`\bafter (?:testing|using)\b`,
  // 复数 "case studies" 与 "firsthand" 是同一个词的写法变体
  String.raw`\bcase stud(?:y|ies)\b`,
  String.raw`\bfirst-?hand\b`,
  String.raw`\bscreenshots? of\b`,
];

/** 原始数据。以 \d 结尾的模式不能再加尾部 \b("n=500" 的 5 和 0 之间不是词边界) */
const ORIGINAL_DATA_PATTERNS: string[] = [
  String.raw`\bour (?:surveys?|stud(?:y|ies)|analys[ie]s|datasets?|data|research|benchmarks?)\b`,
  String.raw`\bwe (?:surveyed|analy[sz]ed|collected|tracked|audited|sampled|reviewed) \d`,
  String.raw`\bsample of \d`,
  String.raw`\bn ?= ?\d`,
  String.raw`\bmethodolog(?:y|ies)\b`,
  String.raw`\bwe found that \d`,
];

/** AI 套话(只收高度特征化的短语;delve 收全词形 —— "delving into" 才是最典型的那个) */
const AI_PHRASE_PATTERNS: string[] = [
  String.raw`\bdelv(?:e|es|ed|ing)\b`,
  String.raw`\bin today's (?:fast-paced|digital|ever-changing)\b`,
  String.raw`\bunlock(?:ing)? the (?:full potential|power|potential)\b`,
  String.raw`\bgame[- ]changers?\b`,
  String.raw`\bit's (?:important|worth) (?:to note|noting)\b`,
  String.raw`\bnavigat(?:e|ing) the (?:complex|ever-changing|ever-evolving)\b`,
  String.raw`\bever-evolving landscape\b`,
  String.raw`\bin the realm of\b`,
  String.raw`\brich tapestry\b`,
  String.raw`\bembark(?:ing)? on (?:a|your) journey\b`,
  String.raw`\blook no further\b`,
  String.raw`\bwhether you're a (?:beginner|seasoned)\b`,
  String.raw`\belevate your\b`,
  // 前缀匹配:integrate / integrates / integrated / integration 都算
  String.raw`\bseamlessly integrat`,
];

/** YMYL(健康 / 金融 / 法律);invest 只收它自己的词族,不能前缀匹配到 investigate */
const YMYL_PATTERNS: string[] = [
  // 健康
  String.raw`\bsymptoms?\b`,
  String.raw`\bdiagnos(?:is|es|ed)\b`,
  String.raw`\btreatments?\b`,
  String.raw`\bmedications?\b`,
  String.raw`\bdosages?\b`,
  String.raw`\bdiseases?\b`,
  String.raw`\bcancers?\b`,
  String.raw`\bdiabet(?:es|ic)\b`,
  String.raw`\bpregnan(?:cy|cies|t)\b`,
  String.raw`\bmental health\b`,
  String.raw`\btherap(?:y|ies|ist|ists)\b`,
  // 金融
  String.raw`\bloans?\b`,
  String.raw`\bmortgages?\b`,
  String.raw`\bcredit scores?\b`,
  String.raw`\binvest(?:s|ed|ing|ments?|ors?)?\b`,
  String.raw`\btax(?:es)?\b`,
  String.raw`\bretirement\b`,
  String.raw`\binsurance\b`,
  String.raw`\bcrypto(?:currency|currencies)?\b`,
  String.raw`\btrading\b`,
  // 法律
  String.raw`\blawyers?\b`,
  String.raw`\battorneys?\b`,
  String.raw`\blawsuits?\b`,
  String.raw`\bvisas?\b`,
  String.raw`\bimmigration\b`,
  String.raw`\bdivorces?\b`,
  String.raw`\bcustody\b`,
];

export type MarkerKind = "experience" | "originalData" | "aiPhrase" | "ymyl";

/**
 * 每类词表编译成**一条**交替正则:全局匹配天然不重叠 ——
 * "navigating the ever-evolving landscape" 同时命中两个套话,但只记 1 次。
 */
const MARKER_RES: Record<MarkerKind, RegExp> = {
  experience: new RegExp(EXPERIENCE_PATTERNS.join("|"), "gi"),
  originalData: new RegExp(ORIGINAL_DATA_PATTERNS.join("|"), "gi"),
  aiPhrase: new RegExp(AI_PHRASE_PATTERNS.join("|"), "gi"),
  ymyl: new RegExp(YMYL_PATTERNS.join("|"), "gi"),
};

/** 词表命中次数(不区分大小写、词边界、同类内不重叠计数) */
export function countMarkers(text: string, kind: MarkerKind): number {
  if (!text) return 0;
  return normalizeTypography(text).match(MARKER_RES[kind])?.length ?? 0;
}

/** 权威来源域名(规格 §2 原表);子域名一并算(en.wikipedia.org、link.springer.com …) */
export const AUTHORITATIVE_DOMAINS: readonly string[] = [
  "wikipedia.org",
  "developers.google.com",
  "support.google.com",
  "web.dev",
  "developer.mozilla.org",
  "w3.org",
  "schema.org",
  "ietf.org",
  "rfc-editor.org",
  "arxiv.org",
  "doi.org",
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "acm.org",
  "ieee.org",
  "ncbi.nlm.nih.gov",
  "who.int",
  "oecd.org",
  "worldbank.org",
  "imf.org",
  "pewresearch.org",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "theguardian.com",
  "ft.com",
  "wsj.com",
  "economist.com",
];
const AUTHORITATIVE_TLDS = new Set(["gov", "edu", "mil", "int"]);
/** 国家代码下的政府 / 学术二级域(gov.uk、ac.uk、edu.au、gob.mx、gouv.fr、govt.nz)—— 与 .gov/.edu 同一类来源 */
const AUTHORITATIVE_SECOND_LEVEL = new Set(["gov", "edu", "mil", "ac", "gob", "gouv", "govt"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function hostMatches(host: string, domains: readonly string[]): boolean {
  for (const d of domains) if (host === d || host.endsWith(`.${d}`)) return true;
  return false;
}

/** 指向权威来源(.gov / .edu / 官方文档 / 学术 / 维基百科 / 主流媒体)的链接 */
export function isAuthoritativeUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (AUTHORITATIVE_TLDS.has(last)) return true;
  if (labels.length >= 3 && last.length === 2 && AUTHORITATIVE_SECOND_LEVEL.has(labels[labels.length - 2] ?? "")) return true;
  if (labels.includes("pubmed")) return true;
  return hostMatches(host, AUTHORITATIVE_DOMAINS);
}

/** 图库主机(规格 §2 原表) */
export const STOCK_IMAGE_HOSTS: readonly string[] = [
  "pexels.com",
  "unsplash.com",
  "shutterstock.com",
  "istockphoto.com",
  "gettyimages.com",
  "stock.adobe.com",
  "ftcdn.net",
  "depositphotos.com",
  "dreamstime.com",
  "123rf.com",
  "pixabay.com",
  "freepik.com",
];
/**
 * 下载后自托管的图库图仍带着图库的默认文件名(pexels-photo-123.jpeg、shutterstock_123.jpg、
 * iStock-123.jpg、AdobeStock_123.jpeg、GettyImages-123.jpg、<作者>-<id>-unsplash.jpg)——
 * 只看主机会把"从 Pexels 下载再传到 WordPress"的图当成原创图。
 */
const STOCK_FILENAME = /(?:^|[^a-z])(?:pexels|unsplash|shutterstock|istock(?:photo)?|getty[-_]?images|adobe[-_]?stock|depositphotos|dreamstime|123rf|pixabay|freepik)(?:[^a-z]|$)/i;
const EMBEDDED_HOST = /(?:https?:)?\/\/([a-z0-9.-]+)/gi;

function lastPathSegment(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  const seg = path.split("/").pop() ?? "";
  return seg;
}

/**
 * 图库图片:主机在图库表里,或者文件名是图库的默认命名。URL 先解码 ——
 * Next.js / Vercel / Cloudinary 的图片代理把真实地址包在参数里
 * (/_next/image?url=https%3A%2F%2Fimages.pexels.com%2F…)。
 */
export function isStockImageUrl(url: string): boolean {
  if (!url) return false;
  let decoded = url;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  const lower = decoded.toLowerCase();
  for (const m of lower.matchAll(EMBEDDED_HOST)) {
    if (hostMatches((m[1] ?? "").replace(/\.$/, ""), STOCK_IMAGE_HOSTS)) return true;
  }
  if (STOCK_FILENAME.test(lastPathSegment(lower))) return true;
  // 代理参数里的真实文件名(?url=/uploads/pexels-photo-1.jpeg)
  for (const m of lower.matchAll(/[?&](?:url|src|image|img)=([^&#]+)/g)) {
    if (STOCK_FILENAME.test(lastPathSegment(m[1] ?? ""))) return true;
  }
  return false;
}

/**
 * 明确"不是本站原创"的第三方图片主机:电商商品图、GIF、徽章、头像、视频缩略图、
 * 社交平台图、表情、广告像素。其余主机默认算本站自己的(站点自己的 CDN / CMS 图床五花八门,
 * 白名单列不全;列不全时宁可把原创图认出来)。
 */
const THIRD_PARTY_IMAGE_HOSTS: readonly string[] = [
  "media-amazon.com",
  "ssl-images-amazon.com",
  "images-amazon.com",
  "ebayimg.com",
  "walmartimages.com",
  "etsystatic.com",
  "alicdn.com",
  "giphy.com",
  "tenor.com",
  "shields.io",
  "badgen.net",
  "gravatar.com",
  "ytimg.com",
  "vimeocdn.com",
  "twimg.com",
  "fbcdn.net",
  "cdninstagram.com",
  "pinimg.com",
  "redd.it",
  "redditmedia.com",
  "redditstatic.com",
  "licdn.com",
  "tiktokcdn.com",
  "mzstatic.com",
  "w.org",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adsrvr.org",
];

/** 站点的"组织根域":example.com / example.co.uk(二级公共后缀粗略识别),供"自家子域图床"判断 */
function siteRoot(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const labels = h.split(".");
  if (labels.length <= 2) return h;
  const last = labels[labels.length - 1] ?? "";
  const second = labels[labels.length - 2] ?? "";
  return labels.slice(last.length === 2 && second.length <= 3 ? -3 : -2).join(".");
}

export type ImageOrigin = "stock" | "own" | "third-party";

export function imageOrigin(absUrl: string, siteHost: string): ImageOrigin {
  if (isStockImageUrl(absUrl)) return "stock";
  const h = hostOf(absUrl);
  if (!h) return "third-party";
  const root = siteRoot(siteHost);
  if (h === root || h.endsWith(`.${root}`)) return "own";
  if (hostMatches(h, THIRD_PARTY_IMAGE_HOSTS)) return "third-party";
  return "own";
}

/** 分享按钮(不是引用来源,不进外链计数) */
const SHARE_URL = /(?:twitter\.com|x\.com)\/(?:intent|share)|facebook\.com\/(?:sharer|share\.php|dialog\/(?:share|feed))|linkedin\.com\/(?:sharearticle|share|cws\/share)|pinterest\.[a-z.]+\/pin\/create|reddit\.com\/submit|news\.ycombinator\.com\/submitlink|wa\.me\/|api\.whatsapp\.com\/send|(?:t|telegram)\.me\/share|tumblr\.com\/(?:share|widgets\/share)|getpocket\.com\/(?:save|edit)|threads\.net\/intent|bsky\.app\/intent/i;

/* ============================================================
   可读性
   ============================================================ */

/** 元音组启发式(规格 §2):去掉不发音的词尾 e / es / ed,数 1–2 个连续元音组 */
export function countSyllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1; // 纯数字 / 非拉丁词:按 1 个音节
  if (w.length <= 3) return 1;
  // -ted / -ded 的 ed 是要读出来的(wanted、needed),其余词尾 ed 不发音(jumped)
  w = w.replace(/(?:[^laeiouy]es|(?<![td])ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** 句中缩写:后面的句点不是句末("e.g. ChatGPT"、"Dr. Smith"、"the U.S. market") */
const ABBREVIATIONS = new Set(["e.g", "i.e", "vs", "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "inc", "ltd", "co", "corp", "no", "fig", "figs", "approx", "est", "dept", "vol", "u.s", "u.k", "a.m", "p.m"]);
const SENTENCE_BREAK = /(?<=[.!?]["'”’)\]]*)\s+/;
const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * 句子:按 ". ! ?"(可带收尾引号 / 括号)后接空白切分;换行(块的边界)也是句末。
 * 缩写与单字母缩写名(John F. Kennedy)后面的句点不切。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    if (!HAS_WORD.test(line)) continue;
    let cur = "";
    for (const piece of line.split(SENTENCE_BREAK)) {
      cur = cur ? `${cur} ${piece}` : piece;
      const m = /([\p{L}.]+)\.$/u.exec(cur);
      if (m) {
        const tok = (m[1] ?? "").toLowerCase();
        if (ABBREVIATIONS.has(tok) || /^\p{L}$/u.test(tok)) continue;
      }
      if (HAS_WORD.test(cur)) out.push(cur);
      cur = "";
    }
    if (cur && HAS_WORD.test(cur)) out.push(cur);
  }
  return out;
}

const WORD_TOKEN = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;

interface ReadabilityCounts {
  words: number;
  sentences: number;
  syllables: number;
}

function readabilityCounts(text: string): ReadabilityCounts {
  let words = 0;
  let syllables = 0;
  for (const m of text.matchAll(WORD_TOKEN)) {
    words++;
    syllables += countSyllables(m[0]);
  }
  return { words, sentences: words ? splitSentences(text).length : 0, syllables };
}

function fleschFrom(c: ReadabilityCounts): number | null {
  if (c.words < MIN_FLESCH_WORDS || c.sentences === 0) return null;
  const v = 206.835 - 1.015 * (c.words / c.sentences) - 84.6 * (c.syllables / c.words);
  // 截到 0–100(主流工具的显示口径);ranking 的分档线(60 / 40 / 30)不受影响
  return round1(Math.min(100, Math.max(0, v)));
}

/**
 * Flesch Reading Ease = 206.835 − 1.015 × (词/句) − 84.6 × (音节/词)。
 * 散文少于 MIN_FLESCH_WORDS 词时为 null(几个词的样本波动比信号大)。
 * 只该对英文调用 —— 语言判断由调用方按 <html lang> 做。
 */
export function fleschReadingEase(text: string): number | null {
  return fleschFrom(readabilityCounts(text));
}

/* ============================================================
   数据点
   ============================================================ */

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
/** 日期与时刻先抹掉:"Jul 17, 2026" 里的 17、"10:30" 里的 30 不是数据 */
const DATES_AND_TIMES = new RegExp(
  [
    String.raw`\b\d{4}-\d{1,2}-\d{1,2}(?:[tT ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[zZ]|[+-]\d{2}:?\d{2})?)?`,
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
    String.raw`\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?`,
    String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH},?\s+\d{4}\b`,
  ].join("|"),
  "gi"
);

/**
 * 数字 token:可选货币符号 + 数字(千分位 / 小数)+ 可选单位。
 * 前面不能紧挨字母或数字("H2"、"GPT4"、"B2B" 不是数据);后面不能紧挨字母
 * ("21st" 是序数、"1990s" 是年代、"3D" 是名词)。
 */
const DATA_POINT = /(?<![\p{L}\p{N}_.,])([$€£¥₹]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\s?(?:%|percent\b|pct\b|x\b|k\b|m\b|bn\b|million\b|billion\b|trillion\b|thousand\b|ms\b|secs?\b|seconds?\b|mins?\b|minutes?\b|hrs?\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|kb\b|mb\b|gb\b|tb\b|px\b|kg\b|lbs?\b|km\b|miles?\b|cm\b|°[cf]?))?(?![\p{L}\p{N}_])/giu;

/**
 * 正文里的数据点(规格 §2):带货币 / 百分号 / 单位的数字,以及 ≥2 位的数字;
 * 不含年份(1900–2099 的裸四位数)、日期、时刻、序数与 01–09 这类编号。
 */
export function countDataPoints(text: string): number {
  if (!text) return 0;
  const t = text.replace(DATES_AND_TIMES, " ");
  let n = 0;
  for (const m of t.matchAll(DATA_POINT)) {
    const intPart = m[2] ?? "";
    const frac = m[3] ?? "";
    if (!m[1] && !m[4]) {
      if (!frac && !intPart.includes(",") && intPart.length === 4) {
        const v = Number(intPart);
        if (v >= 1900 && v <= 2099) continue;
      }
      if (intPart.replace(/,/g, "").length + frac.length < 2) continue;
      if (!frac && /^0\d$/.test(intPart)) continue;
    }
    n++;
  }
  return n;
}

/* ============================================================
   标题
   ============================================================ */

/** 标题里 1990–2099 的年份;"2025–2026" 这类区间取最大的(判断"过期年份"要看最新那个) */
export function titleYear(title: string): number | null {
  let best: number | null = null;
  for (const m of (title ?? "").matchAll(/(?<!\d)(199\d|20\d{2})(?!\d)/g)) {
    const y = Number(m[1]);
    if (best === null || y > best) best = y;
  }
  return best;
}

/**
 * 标题承诺数量的名词。规格列了 ways / best / tips / tools / examples;同类的列表名词一并收
 * ("7 Steps to…"、"12 AEO Mistakes" 承诺的同样是 N 个条目)。
 */
const LIST_NOUNS = [
  "ways", "best", "tips", "tools", "examples", "reasons", "steps", "things", "ideas", "strategies", "mistakes",
  "alternatives", "questions", "signs", "tricks", "hacks", "apps", "platforms", "options", "methods", "techniques",
  "lessons", "rules", "books", "places", "websites", "sites", "companies", "brands", "features", "benefits", "factors",
  "metrics", "kpis", "prompts", "templates", "plugins", "extensions", "resources", "trends", "stats", "statistics",
  "facts", "myths", "secrets", "habits", "practices", "tactics", "products", "services", "solutions", "agencies",
  "courses", "picks", "keywords", "checks", "errors", "issues", "types",
].join("|");
/** 数字后面紧跟时间 / 百分比 / 倍数单位时不是"条目数"("5-Minute Guide"、"30 Days"、"10x") */
const NOT_A_COUNT = String.raw`(?!\s*-?\s*(?:%|percent\b|x\b|k\b|m\b|ms\b|secs?\b|seconds?\b|mins?\b|minutes?\b|hrs?\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|am\b|pm\b))`;
const TITLE_TOP_N = /\btop[-\s]+(\d{1,3})\b/i;
/** "12 AI Visibility Tools":数字与列表名词之间最多隔 3 个词 */
const TITLE_N_NOUN = new RegExp(String.raw`(?<![\d.,/])\b(\d{1,3})\b${NOT_A_COUNT}\s+(?:[\p{L}'’&-]+\s+){0,3}?(?:${LIST_NOUNS})\b`, "iu");
/** 标题开头的 1–2 位数字("7 Steps to…");3 位以上的开头数字多是代号("404 Errors") */
const TITLE_LEAD_N = new RegExp(String.raw`^[^\p{L}\p{N}]*(\d{1,2})(?![\d.,%/:])\b${NOT_A_COUNT}`, "iu");

/** HTTP 状态码("404 Errors"、"301 Redirects")不是条目数,匹配前先抹掉 */
const HTTP_STATUS_PHRASE = /\b[1-5]\d{2}\s+(?:errors?|status(?:es)?|codes?|pages?|redirects?|responses?)\b/gi;

/** 标题承诺的数量("10 ways" → 10、"Top 7" → 7、"12 Best…" → 12);没有承诺为 null */
export function titlePromisedNumber(title: string): number | null {
  const t = normalizeTypography(title ?? "").replace(HTTP_STATUS_PHRASE, " ");
  for (const re of [TITLE_TOP_N, TITLE_N_NOUN, TITLE_LEAD_N]) {
    const m = re.exec(t);
    if (m) {
      const v = Number(m[1]);
      if (v >= 1) return v;
    }
  }
  return null;
}

/** 标题里的品牌后缀分隔符(规格:| - —;WordPress 默认的 – 与常见的 · • » :: 一并收) */
const TITLE_SEPARATOR = /\s(?:\||-|–|—|·|•|»|::)\s/g;

function brandSplit(title: string): { head: string; brand: string | null } {
  let at = -1;
  let len = 0;
  for (const m of title.matchAll(TITLE_SEPARATOR)) {
    at = m.index ?? -1;
    len = m[0].length;
  }
  if (at < 0) return { head: title, brand: null };
  return { head: title.slice(0, at), brand: collapse(title.slice(at + len)) };
}

/**
 * 标题最后一个分隔符之后的部分。问句或超过 6 个词的不是品牌,是副标题
 * ("AEO vs SEO - What's the Difference?")。
 */
export function titleBrand(title: string): string | null {
  const { brand } = brandSplit(collapse(title ?? ""));
  if (!brand || /\?$/.test(brand) || brand.split(" ").length > 6) return null;
  return clipText(brand, MAX_ENTITY_CHARS);
}

const CLICKBAIT_RE = /\byou won'?t believe\b|\bshocking\b|\binsane\b|\bmind[- ]?blowing\b|\bthis one trick\b|\bwhat happens next\b|\bsecrets?\b/gi;
/** ≤4 个字母的全大写词多是缩写(SEO、AEO、API),只有这些算"喊叫" */
const SHOUT_WORDS = new Set(["FREE", "NOW", "NEW", "HUGE", "BEST", "WOW", "OMG", "MUST", "SALE", "HOT", "TOP", "BIG", "EVER", "JUST", "ALL", "OFF", "WIN", "STOP", "DONT", "WHY", "HOW", "WHAT", "THIS", "THAT", "YOU", "YOUR", "THE", "AND", "FOR", "WITH", "NOT", "ONLY", "LAST", "NEXT", "REAL", "TRUE", "FAST", "EASY", "WILL", "CAN", "GET", "SEE", "ONE"]);
/** ≥5 个字母但确实是缩写的词(更短的全大写词默认是缩写,不必列) */
const LONG_ACRONYMS = new Set(["HTTPS", "HIPAA", "NASDAQ", "UNESCO", "UNICEF", "OAUTH", "SCORM", "COVID", "ASEAN", "OPENAI"]);

function shoutingShare(text: string): number {
  const ws = text.match(/\p{L}[\p{L}'’]*/gu) ?? [];
  if (ws.length < 3) return 0;
  let caps = 0;
  for (const w of ws) {
    const letters = w.replace(/['’]/g, "");
    if (letters.length < 2 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) continue;
    if (SHOUT_WORDS.has(letters) || (letters.length >= 5 && !LONG_ACRONYMS.has(letters))) caps++;
  }
  return caps / ws.length;
}

/**
 * 标题党信号命中数:每个短语每出现一次记 1;有感叹号记 1;"喊叫"大写词占标题词 ≥30% 记 1。
 * 品牌后缀不参与(品牌叫 "Yahoo!" 不是标题党)。
 */
export function clickbaitHits(title: string): number {
  const t = normalizeTypography(collapse(title ?? ""));
  if (!t) return 0;
  const head = brandSplit(t).head;
  let n = head.match(CLICKBAIT_RE)?.length ?? 0;
  if (head.includes("!")) n++;
  if (shoutingShare(head) >= 0.3) n++;
  return n;
}

/* ============================================================
   日期与署名
   ============================================================ */

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * 统一成 ISO 日期(yyyy-mm-dd)。以 yyyy-mm-dd 开头的直接取字面日期 ——
 * "2026-09-30T23:30:00-05:00" 发布地是 9 月 30 日,换算成 UTC 会变成 10 月 1 日。
 * 只有年份、超出 1990–2099、不存在的日期(2 月 31 日)都返回 null。
 */
export function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 64 || /^\d{4}$/.test(s)) return null;
  let y: number;
  let mo: number;
  let d: number;
  const lit = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(s) ?? /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?!\d)/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})(?:T|$)/.exec(s);
  if (lit) {
    y = Number(lit[1]);
    mo = Number(lit[2]);
    d = Number(lit[3]);
  } else {
    const ts = Date.parse(s);
    if (Number.isNaN(ts)) return null;
    const dt = new Date(ts);
    // 带时区的(GMT / Z / +08:00)按 UTC 取日期;"September 30, 2026" 这种无时区的按本地日历
    const utc = /(?:\bz|gmt|utc|[+-]\d{2}:?\d{2})\s*$/i.test(s) || /\bgmt\b/i.test(s);
    y = utc ? dt.getUTCFullYear() : dt.getFullYear();
    mo = (utc ? dt.getUTCMonth() : dt.getMonth()) + 1;
    d = utc ? dt.getUTCDate() : dt.getDate();
  }
  if (y < 1990 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

const NAME_PARTICLES = new Set(["de", "da", "del", "della", "der", "di", "du", "la", "le", "van", "von", "bin", "al", "y", "and", "&", "of"]);
/** "the AEOeye editorial team" 这类机构署名里允许的小写词 */
const TEAM_WORDS = new Set(["team", "staff", "editors", "editorial", "desk", "newsroom", "writers", "contributors"]);
/** 有署名但没有信息量的名字:byline 仍算 true,authorName 留空 */
const GENERIC_AUTHORS = new Set(["admin", "administrator", "author", "authors", "guest", "unknown", "anonymous", "user", "webmaster", "editor", "staff", "team"]);

/**
 * 从署名文本里取出名字:去掉 "By" / "Written by" / "Author:" 前缀,在分隔符 / 日期处截断,
 * 再要求它长得像名字(≤6 词、拉丁字母的每个词首字母大写或是姓名小品词、不含数字与网址)。
 * 作者简介框("Jane Doe is a senior editor with…")取不出名字时返回 null。
 */
export function cleanAuthorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = collapse(normalizeTypography(raw));
  s = s
    .replace(/^[^\p{L}]+/u, "")
    .replace(/^(?:(?:written|posted|published|reviewed|edited|authored)\s+)?by\s*:?\s+/i, "")
    .replace(/^(?:authors?|writer|byline)\s*:\s*/i, "")
    .replace(/^the\s+/i, "");
  s = s.split(/\s*(?:[|·•,;(\[\]<>]|\s[-–—]\s|—|–)\s*/)[0] ?? "";
  s = s.replace(/\s+(?:on|updated|published|posted|last|in)\b.*$/i, "").replace(/[\s.:-]+$/, "").trim();
  if (!s || s.length > 60) return null;
  if (/https?:|www\.|@|\d/.test(s)) return null;
  const parts = s.split(" ");
  if (parts.length > 6) return null;
  if (/[A-Za-z]/.test(s)) {
    for (let i = 0; i < parts.length; i++) {
      const w = parts[i] ?? "";
      const first = w.charAt(0);
      if (first !== first.toLowerCase()) continue;
      const lw = w.toLowerCase();
      if (i > 0 && (NAME_PARTICLES.has(lw) || TEAM_WORDS.has(lw))) continue;
      return null;
    }
  }
  if (GENERIC_AUTHORS.has(s.toLowerCase())) return null;
  return clipText(s, MAX_NAME_CHARS);
}

/** "By X" 里 X 是这些词时只是普通句子("By default"、"By Monday"、"By The Way") */
const BY_STOP = new Set([
  "the", "this", "that", "these", "those", "our", "your", "their", "his", "her", "its", "a", "an", "default", "now", "then",
  "contrast", "comparison", "far", "design", "category", "industry", "region", "type", "date", "name", "price", "popularity",
  "topic", "month", "year", "day", "week", "email", "phone", "law", "hand", "way", "all", "means", "nature", "definition",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april",
  "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun",
  "jul", "aug", "sep", "sept", "oct", "nov", "dec", "end", "mid", "early", "late", "next", "last", "using", "clicking",
]);
const BY_NAME_RE = /(?:^|[^\p{L}\p{N}])[Bb]y\s+(the\s+)?(\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|de|da|del|der|di|du|la|le|van|von|bin|al)){0,3})/gu;

/**
 * 主体文本开头的 "By <首字母大写的名字>"(规格 §2),以及机构署名 "By the <品牌> (editorial) team"。
 * 单个词的名字后面必须紧跟分隔符或结尾 —— "By Monday we…" 不是署名。
 */
export function bylineFromText(sample: string): string | null {
  for (const m of sample.matchAll(BY_NAME_RE)) {
    const team = !!m[1];
    let name = m[2] ?? "";
    const after = sample.slice((m.index ?? 0) + m[0].length);
    const first = (name.split(/\s+/)[0] ?? "").toLowerCase().replace(/[.'’-]+$/, "");
    if (BY_STOP.has(first) || /ing$/.test(first)) continue;
    if (team) {
      const t = /^\s+((?:editorial\s+)?(?:team|staff|editors|desk|newsroom))\b/i.exec(after);
      if (!t) continue;
      name = `${name} ${t[1]}`;
    } else if (!/\s/.test(name) && !/^\s*(?:$|[|·•,;:(—–-]|(?:on|updated|published|posted|and)\b|\d)/i.test(after)) {
      continue;
    }
    const clean = cleanAuthorName(name);
    if (clean) return clean;
  }
  return null;
}

/* ============================================================
   联系方式(整页,含页头页脚 —— 联系方式通常就在页脚或 /contact)
   ============================================================ */

export interface ContactDetails {
  email: boolean;
  phone: boolean;
  address: boolean;
}

/** 文档 / 表单里的占位邮箱域名:它们证明不了"这个站留了能联系到人的地址" */
const PLACEHOLDER_EMAIL_DOMAINS = new Set(["example.com", "example.org", "example.net", "domain.com", "company.com", "email.com", "website.com", "mysite.com", "site.com", "test.com"]);
const PLACEHOLDER_EMAIL_LOCALS = new Set(["you", "your", "yourname", "your.name", "youremail", "your.email", "name", "firstname", "firstname.lastname", "first.last", "john.doe", "jane.doe", "johndoe", "janedoe", "username", "someone", "email"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic"]);
const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

/**
 * 像真的邮箱:形状合法;不是图片文件名(logo@2x.png);不是占位地址
 * (example@example.com、you@domain.com、name@company.com、*.test / *.example、your*.com)。
 */
export function isPlausibleEmail(raw: string): boolean {
  const e = (raw ?? "").trim().replace(/^mailto:/i, "");
  if (!EMAIL_SHAPE.test(e)) return false;
  const at = e.lastIndexOf("@");
  const local = e.slice(0, at).toLowerCase();
  const domain = e.slice(at + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(domain.slice(domain.lastIndexOf(".") + 1))) return false;
  if (PLACEHOLDER_EMAIL_DOMAINS.has(domain) || /^your/.test(domain) || /\.(?:example|test|invalid|localhost|local)$/.test(domain)) return false;
  return !PLACEHOLDER_EMAIL_LOCALS.has(local);
}

const isEmailLocalChar = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45;
const isEmailDomainChar = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 45;

/**
 * 可见文本里的邮箱。不用一条大正则扫全文:一长串没有 @ 的字母会让 [..]+@ 退化成平方级。
 * 改为逐个找 "@",只看它前 64 / 后 255 个字符的窗口 —— 线性,2 MB 也是毫秒级。
 */
export function textHasEmail(text: string): boolean {
  let from = 0;
  for (let checks = 0; checks < 2_000; checks++) {
    const at = text.indexOf("@", from);
    if (at < 0) return false;
    from = at + 1;
    let s = at;
    while (s > 0 && at - s < 64 && isEmailLocalChar(text.charCodeAt(s - 1))) s--;
    let e = at + 1;
    while (e < text.length && e - at <= 255 && isEmailDomainChar(text.charCodeAt(e))) e++;
    if (isPlausibleEmail(text.slice(s, e).replace(/[.-]+$/, ""))) return true;
  }
  return false;
}

/**
 * 电话号码候选:可选国家码、可选括号区号、再接 ≥2 组由空格 / 点 / 横线隔开的数字,
 * 或 E.164 的 "+15551234567"。量词全部有上限,扫描是线性的。
 * 前后不能紧挨字母、数字、货币符号、小数点 / 千分位、斜杠或横线 —— 价格、版本号、
 * "ORD-2026-0001" 这类编号的一截都不算。
 */
const PHONE_CANDIDATE = /(?<![\p{L}\p{N}.,/:$€£¥₹#+-])(?:\+\d{7,15}|(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]\d{1,4}){1,5})(?![\p{L}\p{N}]|[.-]\d|\s\d)/gu;
/** 全是年份("2024 2025 2026" 表头、"2025-2026" 区间、"2025–26") */
const YEAR_RUN = /^(?:19|20)\d{2}(?:[\s.–-]+(?:(?:19|20)\d{2}|\d{2}))+$/;
const DATE_SHAPED = /^(?:\d{4}[\s./-]\d{1,2}[\s./-]\d{1,2}|\d{1,2}[\s./-]\d{1,2}[\s./-]\d{2,4})$/;
const IPV4_SHAPED = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** "10 000 000" 是千分位写法的数字;只有前面带着 tel / phone / call 之类字样时才当电话 */
const THOUSANDS_GROUPED = /^\d{1,3}(?:[\s.]\d{3})+$/;
const PHONE_CONTEXT = /(?:tel|phone|call|mobile|fax|whatsapp|hotline|☎|📞)[^\n]{0,30}$/i;

/** 一个电话候选是否成立:7–15 位数字,且不是年份区间 / 日期 / IP / 千分位数字 */
export function isPlausiblePhone(candidate: string, before = ""): boolean {
  const c = (candidate ?? "").trim();
  const digits = c.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^\+\d+$/.test(c)) return true;
  if (YEAR_RUN.test(c) || DATE_SHAPED.test(c) || IPV4_SHAPED.test(c)) return false;
  if (THOUSANDS_GROUPED.test(c) && !PHONE_CONTEXT.test(before)) return false;
  return true;
}

/** 一段可见文本里的电话号码;before = 这段文字之前的上下文("Call us on <b>912 345 678</b>" 的前半句) */
export function textHasPhone(text: string, before = ""): boolean {
  let n = 0;
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    const at = m.index ?? 0;
    const context = `${before} ${text.slice(Math.max(0, at - 40), at)}`.slice(-40);
    if (isPlausiblePhone(m[0], context)) return true;
    if (++n > 5_000) break;
  }
  return false;
}

/**
 * 整页可见文本里的邮箱 / 电话,**逐个文本节点**扫:collapse 后的整页文本会把表格里相邻的单元格
 * ("2024" "2025" "2026"、"82" "64" "91" "77")拼成一个像电话号码的串。前一个节点的末尾当上下文。
 */
export function contactInText(parts: readonly string[]): { email: boolean; phone: boolean } {
  let email = false;
  let phone = false;
  let prev = "";
  for (const raw of parts) {
    if (email && phone) break;
    const t = collapse(raw);
    if (!t) continue;
    if (!email && t.includes("@") && textHasEmail(t)) email = true;
    if (!phone && /\d/.test(t) && textHasPhone(t, prev)) phone = true;
    prev = t.slice(-40);
  }
  return { email, phone };
}

/** tel: 链接里 ≥7 位数字才算 */
function telHasPhone(href: string): boolean {
  let v = href.replace(/^tel:/i, "");
  try {
    v = decodeURIComponent(v);
  } catch {
    /* 保留原文 */
  }
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/** mailto: 链接(可带多个收件人与 ?subject=)里任一地址像真的就算 */
function mailtoHasEmail(href: string): boolean {
  let v = href.replace(/^mailto:/i, "").split("?")[0] ?? "";
  try {
    v = decodeURIComponent(v);
  } catch {
    /* 保留原文 */
  }
  return v.split(/[,;]/).some((x) => isPlausibleEmail(x));
}

/* ============================================================
   JSON-LD
   ============================================================ */

export interface JsonLdFacts {
  /** 文章 / 网页类节点的 author.name(@id 引用已解析) */
  authorName: string | null;
  authorUrl: string | null;
  authorInSchema: boolean;
  datePublished: string | null;
  dateModified: string | null;
  /** Organization / LocalBusiness 等机构节点(广度优先,顶层优先)的 name */
  orgName: string | null;
  /** 机构节点里 sameAs 条数的最大值 */
  sameAsCount: number;
  hasFaqPage: boolean;
  /** 图里任何位置有 PostalAddress(Organization.address / LocalBusiness.address …),或机构的 address 是一段完整地址文本 */
  hasPostalAddress: boolean;
}

type LdNode = { obj: Record<string, unknown>; types: string[]; depth: number; pageOk: boolean; orgOk: boolean };

/**
 * 挂在这些属性下面的节点描述的是"别的东西":商品下的评测、文章的评论与引用、作者 / 出版方本身……
 * 它们的 datePublished / author 不是本页的。
 */
const NOT_THIS_PAGE_KEYS = new Set([
  "review", "reviews", "comment", "comments", "citation", "isBasedOn", "mentions", "about", "subjectOf", "itemReviewed",
  "workExample", "isPartOf", "relatedLink", "significantLink", "author", "creator", "publisher", "contributor", "editor",
  "provider", "sourceOrganization", "recordedAt",
]);
/** 这些属性下的机构不是本站(被评测的商家、母公司、赞助方、竞品)—— publisher / author 下的机构恰恰多是本站,不排除 */
const NOT_THIS_ORG_KEYS = new Set([
  "review", "reviews", "comment", "comments", "citation", "isBasedOn", "mentions", "about", "subjectOf", "itemReviewed",
  "workExample", "parentOrganization", "subOrganization", "memberOf", "alumniOf", "sponsor", "funder", "competitor",
]);

const ARTICLE_TYPE = /article$|^blogposting$|^report$|^review$|^howto$|^recipe$|^qapage$|^faqpage$|posting$/i;
const PAGE_TYPE = /webpage$|^aboutpage$|^itempage$|^collectionpage$|^profilepage$|^mediagallery$|^contactpage$/i;
const ORG_TYPE = /^(?:organization|corporation|localbusiness|onlinebusiness|onlinestore|ngo|store|professionalservice)$|organization$|business$/i;

const ldPriority = (types: string[]): number => (types.some((t) => ARTICLE_TYPE.test(t)) ? 2 : types.some((t) => PAGE_TYPE.test(t)) ? 1 : 0);

function resolveAuthor(v: unknown, byId: Map<string, Record<string, unknown>>): { name: string | null; url: string | null } | null {
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first === "string") return first.trim() ? { name: first, url: null } : null;
  if (!first || typeof first !== "object") return null;
  let o = first as Record<string, unknown>;
  const id = typeof o["@id"] === "string" ? (o["@id"] as string) : null;
  if (typeof o.name !== "string" && id && byId.has(id)) o = byId.get(id) as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name : null;
  let url = typeof o.url === "string" ? o.url : null;
  if (!url) {
    const oid = typeof o["@id"] === "string" ? (o["@id"] as string) : id;
    if (oid && /^https?:\/\//i.test(oid)) url = oid.replace(/#.*$/, "");
  }
  return name ? { name, url } : null;
}

/**
 * 从已解析的 JSON-LD 根对象里取作者、日期、机构与 FAQPage。广度优先(顶层节点先于嵌套节点),
 * 深度 ≤ 12、节点 ≤ 5000 —— 与 parse.ts 的 walkJsonLd 同样防住超大 / 超深的 JSON。
 * 日期与作者只从文章类(优先)或网页类节点取,而且不能挂在 review / comment / citation 之类的属性下:
 * Product 里嵌的 Review 的作者与日期是评测者的,不是本页的。
 */
export function jsonLdFacts(roots: unknown[]): JsonLdFacts {
  const facts: JsonLdFacts = { authorName: null, authorUrl: null, authorInSchema: false, datePublished: null, dateModified: null, orgName: null, sameAsCount: 0, hasFaqPage: false, hasPostalAddress: false };
  const nodes: LdNode[] = [];
  const byId = new Map<string, Record<string, unknown>>();
  type Item = { v: unknown; depth: number; pageOk: boolean; orgOk: boolean };
  const queue: Item[] = (roots ?? []).map((v) => ({ v, depth: 0, pageOk: true, orgOk: true }));
  const room = () => queue.length < MAX_LD_NODES * 4;
  for (let qi = 0; qi < queue.length && nodes.length < MAX_LD_NODES; qi++) {
    const { v, depth, pageOk, orgOk } = queue[qi] as Item;
    if (depth > MAX_LD_DEPTH || v === null || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === "object" && room()) queue.push({ v: x, depth: depth + 1, pageOk, orgOk });
      continue;
    }
    const obj = v as Record<string, unknown>;
    const t = obj["@type"];
    const types = typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
    nodes.push({ obj, types, depth, pageOk, orgOk });
    const id = obj["@id"];
    if (typeof id === "string" && !byId.has(id)) byId.set(id, obj);
    for (const [k, val] of Object.entries(obj)) {
      if (k === "@context" || !val || typeof val !== "object") continue;
      if (room()) queue.push({ v: val, depth: depth + 1, pageOk: pageOk && !NOT_THIS_PAGE_KEYS.has(k), orgOk: orgOk && !NOT_THIS_ORG_KEYS.has(k) });
    }
  }

  if (nodes.some((n) => n.types.some((t) => t.toLowerCase() === "faqpage"))) facts.hasFaqPage = true;
  // 地址不看节点挂在哪:被评测商家的地址也是"页面上有地址",但真正要的是本站的 —— 这里只当"联系方式存在"的信号
  for (const n of nodes) {
    const isPostal = n.types.some((t) => t.toLowerCase() === "postaladdress") || (n.types.length === 0 && ("streetAddress" in n.obj || "postalCode" in n.obj));
    const textAddress = n.orgOk && n.types.some((t) => ORG_TYPE.test(t)) && typeof n.obj.address === "string" && collapse(n.obj.address).length >= 15;
    if (isPostal || textAddress) {
      facts.hasPostalAddress = true;
      break;
    }
  }

  // 文章类优先,其次网页类;同级里浅的(顶层)优先 —— 稳定排序保留文档顺序
  const pageNodes = nodes
    .map((n, i) => ({ n, i, p: n.pageOk ? ldPriority(n.types) : 0 }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.n.depth - b.n.depth || a.i - b.i)
    .map((x) => x.n);
  for (const n of pageNodes) {
    if (!facts.datePublished) facts.datePublished = toIsoDate(n.obj.datePublished);
    if (!facts.dateModified) facts.dateModified = toIsoDate(n.obj.dateModified);
    if (!facts.authorName && n.obj.author !== undefined) {
      const a = resolveAuthor(n.obj.author, byId);
      if (a) {
        facts.authorName = a.name;
        facts.authorUrl = a.url;
        facts.authorInSchema = true;
      }
    }
  }

  for (const n of nodes) {
    if (!n.orgOk || !n.types.some((t) => ORG_TYPE.test(t))) continue;
    if (!facts.orgName && typeof n.obj.name === "string" && n.obj.name.trim()) facts.orgName = clipText(collapse(n.obj.name), MAX_ENTITY_CHARS);
    const sa = n.obj.sameAs;
    const list = Array.isArray(sa) ? sa : typeof sa === "string" ? [sa] : [];
    const uniq = new Set(list.filter((x): x is string => typeof x === "string" && /^https?:\/\//i.test(x.trim())).map((x) => x.trim().toLowerCase()));
    if (uniq.size > facts.sameAsCount) facts.sameAsCount = uniq.size;
  }
  return facts;
}

/* ============================================================
   DOM:主体内容切块(与 minhash 同一次抽取)
   ============================================================ */

/** p = 段落(含块级容器里的散文本);li = 列表项;h = 标题;cell = 表格;pre = 代码块;other = 表单控件 / 图注 */
export type BlockKind = "p" | "li" | "h" | "cell" | "pre" | "other";

const BLOCK_KIND = new Map<string, BlockKind>();
for (const t of ["p"]) BLOCK_KIND.set(t, "p");
for (const t of ["li", "dt"]) BLOCK_KIND.set(t, "li");
for (const t of ["h1", "h2", "h3", "h4", "h5", "h6", "summary"]) BLOCK_KIND.set(t, "h");
for (const t of ["td", "th", "caption"]) BLOCK_KIND.set(t, "cell");
for (const t of ["pre", "xmp", "listing", "plaintext"]) BLOCK_KIND.set(t, "pre");
for (const t of ["figcaption", "legend", "label", "button", "select", "option", "optgroup", "textarea", "datalist", "output", "meter", "progress"]) BLOCK_KIND.set(t, "other");
// 其余块级容器里直接写的文字按段落计(很多站点整篇正文都是 <div>)
for (const t of ["address", "article", "aside", "blockquote", "body", "center", "dd", "details", "dialog", "dir", "div", "dl", "fieldset", "figure", "footer", "form", "header", "hgroup", "hr", "html", "main", "menu", "nav", "ol", "section", "search", "table", "tbody", "thead", "tfoot", "tr", "ul"]) {
  BLOCK_KIND.set(t, "p");
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
/** 目录与面包屑:它们的列表不是内容列表,文字也不是"正文开头" */
const LEAD_SKIP = /(?:^|[\s_-])(?:toc|breadcrumbs?)(?:$|[\s_-])|table-?of-?contents|tableofcontents|breadcrumb/i;
const FAQ_HEADING = /\b(?:faqs?|frequently asked questions?|common questions)\b/i;

export interface MainBlock {
  kind: BlockKind;
  /** collapse 后的块文本(所有块合计不超过 MAX_ANALYZED_CHARS) */
  text: string;
  words: number;
  /** false = 在目录 / 面包屑里:不进 leadText / firstParagraph */
  lead: boolean;
  /** 所在块元素的标签(FAQ 标题判断用) */
  tag: string;
}

export interface MainContent {
  /** 与 minhash / textSample 同一份主体文本(collapse 后,全文,不封顶) */
  text: string;
  blocks: MainBlock[];
  h2: number;
  h3: number;
  lists: number;
  orderedLists: number;
  listItems: number;
  tables: number;
  faqHeading: boolean;
  /** 站内链接(不含本页、按目标去重)最后一次出现的位置(切块口径的词序号) */
  internalLinkPositions: number[];
  /** 主体区域里的外链(去重,不含分享按钮) */
  externalUrls: string[];
  imagesOwn: number;
  imagesStock: number;
  /** 切块口径的总词数(nextStepLinks 的分母) */
  totalWords: number;
  /** 切块在 MAX_ANALYZED_CHARS 处停了(超大页) */
  truncated: boolean;
}

export interface MainContentOptions {
  /** 页面最终 URL(解析相对链接 / 图片、识别本页自链) */
  base?: string;
  /** 被审计站点主机(站内 / 站外判断) */
  host?: string;
  /** 只要主体文本(非 2xx 页不需要切块) */
  textOnly?: boolean;
}

class Exit {
  constructor(
    readonly tag: string,
    readonly kind: BlockKind | undefined,
    readonly skipLead: boolean
  ) {}
}

function classAndId(el: HTMLElement): string {
  const cls = el.classList && el.classList.length ? el.classList.toString() : "";
  const id = el.id || "";
  return cls && id ? `${cls} ${id}` : cls || id;
}

function numAttr(el: HTMLElement, name: string): number | null {
  const v = el.getAttribute(name);
  if (v === undefined) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** 懒加载图片的真实地址在 data-src / data-lazy-src / data-original;src 往往是占位图 */
function imageSrcOf(el: HTMLElement): string | null {
  for (const a of ["data-src", "data-lazy-src", "data-original", "src"]) {
    const v = (el.getAttribute(a) ?? "").trim();
    if (v && !/^data:/i.test(v)) return v;
  }
  for (const a of ["srcset", "data-srcset"]) {
    const v = (el.getAttribute(a) ?? "").trim();
    const first = v.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
    if (first && !/^data:/i.test(first)) return first;
  }
  return null;
}

const DECORATIVE_FILE = /(?:^|[-_.])(?:avatars?|emoji|icons?|logos?|favicon|badges?|spinner|loader|placeholder|pixel|spacer|blank)(?:[-_.]|$)/i;
/** 懒加载库会给真图挂 "lazyload placeholder" 之类的 class,所以 placeholder / loader 只看文件名不看 class */
const DECORATIVE_CLASS = /avatar|emoji|gravatar|\bicon|logo|badge|spinner/i;

/** 图标、头像、logo、跟踪像素不算"正文图片"—— 它们证明不了一手经验 */
function isDecorativeImage(el: HTMLElement, src: string): boolean {
  const w = numAttr(el, "width");
  const h = numAttr(el, "height");
  if ((w !== null && w <= 2) || (h !== null && h <= 2)) return true;
  if (w !== null && h !== null && w <= 64 && h <= 64) return true;
  const file = lastPathSegment(src.toLowerCase());
  // SVG 多是图标;声明了 ≥200px 宽的才当作图示
  if (/\.svg$/.test(file) && !(w !== null && w >= 200)) return true;
  if (DECORATIVE_FILE.test(file)) return true;
  const ci = classAndId(el);
  return !!ci && DECORATIVE_CLASS.test(ci);
}

/**
 * 主体内容抽取:一次迭代遍历同时产出
 *   · 主体文本(与原来 collectText 完全同口径:同一套剔除规则、文本节点按文档顺序、空格拼接);
 *   · 切块(块级元素边界切分,标注段落 / 列表项 / 标题 …);
 *   · 结构计数、站内链接位置、外链、图片来源。
 * 迭代而不是递归:几千层嵌套不能把调用栈压爆(复审 C6)。切块的簿记万一出错,
 * 只停掉切块、主体文本照常产出 —— 内容信号是锦上添花,不能连累 minhash 与整页解析。
 */
export function extractMainContent(textRoot: HTMLElement, opts: MainContentOptions = {}): MainContent {
  const out: MainContent = {
    text: "",
    blocks: [],
    h2: 0,
    h3: 0,
    lists: 0,
    orderedLists: 0,
    listItems: 0,
    tables: 0,
    faqHeading: false,
    internalLinkPositions: [],
    externalUrls: [],
    imagesOwn: 0,
    imagesStock: 0,
    totalWords: 0,
    truncated: false,
  };
  const parts: string[] = [];
  const base = opts.base ?? "";
  const host = opts.host ?? "";
  let detail = !opts.textOnly;
  let selfKey = "";
  if (detail && base) {
    try {
      selfKey = dedupeKey(base);
    } catch {
      selfKey = "";
    }
  }

  // ---- 切块状态 ----
  const kinds: { kind: BlockKind; tag: string }[] = [{ kind: "p", tag: tagOf(textRoot) || "body" }];
  let run: string[] = [];
  let runWords = 0;
  let analyzed = 0;
  let wordsBefore = 0;
  let leadSkip = 0;
  const lists: { ordered: boolean; items: number; inSkip: boolean }[] = [];
  const tables: { rows: number; maxCells: number; layout: boolean }[] = [];
  const rows: number[] = [];
  const internal = new Map<string, number>();
  const external = new Set<string>();
  const images = new Set<string>();

  const flush = () => {
    if (!run.length) return;
    const text = collapse(run.join(" "));
    run = [];
    runWords = 0;
    if (!text) return;
    const words = countWords(text);
    if (!words) return;
    wordsBefore += words;
    const top = kinds[kinds.length - 1] as { kind: BlockKind; tag: string };
    out.blocks.push({ kind: top.kind, text, words, lead: leadSkip === 0, tag: top.tag });
    if (!out.faqHeading && HEADING_TAGS.has(top.tag) && FAQ_HEADING.test(text.slice(0, 200))) out.faqHeading = true;
  };

  const onText = (t: string) => {
    if (out.truncated) return;
    const room = MAX_ANALYZED_CHARS - analyzed;
    const piece = t.length > room ? clipText(t, room) : t;
    analyzed += piece.length;
    run.push(piece);
    if (/\S/.test(piece)) runWords += countWords(piece);
    if (analyzed >= MAX_ANALYZED_CHARS) {
      flush();
      out.truncated = true;
    }
  };

  const onLink = (el: HTMLElement) => {
    if (!base) return;
    const href = (el.getAttribute("href") ?? "").trim();
    if (!href || href.startsWith("#")) return;
    const abs = normalizeUrl(href, base);
    if (!abs) return; // mailto: / tel: / javascript:
    if (isSameSite(abs, host)) {
      if (out.truncated) return; // 超出分析范围:位置未知,不计入"下一步"
      const key = dedupeKey(abs);
      if (key === selfKey) return;
      const pos = wordsBefore + runWords;
      const prev = internal.get(key);
      if (prev === undefined) {
        if (internal.size < MAX_INTERNAL_TRACKED) internal.set(key, pos);
      } else if (pos > prev) internal.set(key, pos);
      return;
    }
    if (external.size >= MAX_TRACKED || SHARE_URL.test(abs)) return;
    external.add(abs);
  };

  const onImage = (el: HTMLElement) => {
    if (!base || images.size >= MAX_TRACKED) return;
    const src = imageSrcOf(el);
    if (!src || isDecorativeImage(el, src)) return;
    const abs = normalizeUrl(src, base);
    if (!abs || images.has(abs)) return;
    images.add(abs);
    const origin = imageOrigin(abs, host);
    if (origin === "stock") out.imagesStock++;
    else if (origin === "own") out.imagesOwn++;
  };

  const enter = (el: HTMLElement): Exit | null => {
    const tag = tagOf(el);
    const kind = BLOCK_KIND.get(tag);
    if (kind !== undefined) flush();
    let skipLead = false;
    if (el.classList?.length || el.id) {
      const ci = classAndId(el);
      if (ci && LEAD_SKIP.test(ci)) {
        if (kind === undefined) flush();
        leadSkip++;
        skipLead = true;
      }
    }
    if (kind !== undefined) kinds.push({ kind, tag });
    switch (tag) {
      case "h2":
        out.h2++;
        break;
      case "h3":
        out.h3++;
        break;
      case "ul":
      case "ol":
        lists.push({ ordered: tag === "ol", items: 0, inSkip: leadSkip > 0 });
        break;
      case "li":
        if (leadSkip === 0) out.listItems++;
        if (lists.length) (lists[lists.length - 1] as { items: number }).items++;
        break;
      case "table":
        tables.push({ rows: 0, maxCells: 0, layout: /^(?:presentation|none)$/i.test((el.getAttribute("role") ?? "").trim()) });
        break;
      case "tr":
        rows.push(0);
        if (tables.length) (tables[tables.length - 1] as { rows: number }).rows++;
        break;
      case "td":
      case "th":
        if (rows.length) rows[rows.length - 1] = (rows[rows.length - 1] ?? 0) + 1;
        break;
      case "a":
        onLink(el);
        break;
      case "img":
        onImage(el);
        break;
    }
    if (kind !== undefined || skipLead || tag === "ul" || tag === "ol" || tag === "table" || tag === "tr") return new Exit(tag, kind, skipLead);
    return null;
  };

  const exit = (m: Exit) => {
    if (m.kind !== undefined) {
      flush();
      if (kinds.length > 1) kinds.pop();
    }
    if (m.skipLead) {
      if (m.kind === undefined) flush();
      leadSkip = Math.max(0, leadSkip - 1);
    }
    switch (m.tag) {
      case "ul":
      case "ol": {
        const l = lists.pop();
        if (l && l.items > 0 && !l.inSkip) {
          out.lists++;
          if (l.ordered) out.orderedLists++;
        }
        break;
      }
      case "tr": {
        const cells = rows.pop() ?? 0;
        const t = tables[tables.length - 1];
        if (t && cells > t.maxCells) t.maxCells = cells;
        break;
      }
      case "table": {
        // 布局表格(单列包整页、role=presentation)不是数据表
        const t = tables.pop();
        if (t && !t.layout && t.rows >= 2 && t.maxCells >= 2) out.tables++;
        break;
      }
    }
  };

  const stack: (HtmlNode | Exit)[] = [];
  for (let i = textRoot.childNodes.length - 1; i >= 0; i--) stack.push(textRoot.childNodes[i] as HtmlNode);
  while (stack.length) {
    const item = stack.pop() as HtmlNode | Exit;
    if (item instanceof Exit) {
      if (detail) {
        try {
          exit(item);
        } catch {
          detail = false;
        }
      }
      continue;
    }
    if (item.nodeType === NodeType.TEXT_NODE) {
      const t = (item as TextNode).text;
      parts.push(t);
      if (detail) {
        try {
          onText(t);
        } catch {
          detail = false;
        }
      }
      continue;
    }
    if (item.nodeType !== NodeType.ELEMENT_NODE) continue;
    const el = item as HTMLElement;
    if (isMainSkip(el)) continue;
    if (detail) {
      try {
        const marker = enter(el);
        if (marker) stack.push(marker);
      } catch {
        detail = false;
      }
    }
    const kids = el.childNodes;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as HtmlNode);
  }
  if (detail) {
    try {
      flush();
    } catch {
      detail = false;
    }
  }

  out.text = collapse(parts.join(" "));
  out.totalWords = wordsBefore;
  out.internalLinkPositions = Array.from(internal.values());
  out.externalUrls = Array.from(external);
  return out;
}

/** 页面的主体文本(去掉外壳与不可见元素;与 parse.ts 给 minhash 用的完全相同) */
export function extractMainText(root: HTMLElement): string {
  const body = root.querySelector("body") ?? root;
  return extractMainContent(body, { textOnly: true }).text;
}

/* ============================================================
   DOM:整页扫描(署名 / 日期 / 弹窗 / FAQ 微数据)
   ============================================================ */

const BYLINE_CLASS = /author|byline/;
/** 评论作者、推荐语作者、评测者不是本文作者;authorize / authentication 只是字面含 author */
const BYLINE_EXCLUDE = /authoriz|authent|comment|testimonial|review|quote|reply/;
/** 评论区整块跳过:评论者的署名与时间不是文章的 */
const COMMENT_CTX = /(?:^|[\s_-])comments?(?:$|[\s_-])|commentlist|comment_|comment-/;
const INTERSTITIAL_HINT = /modal|popup|pop-up|interstitial|newsletter-overlay|lightbox-overlay/;
/** "multimodal" / "modality" 字面含 modal,不是弹窗 */
const INTERSTITIAL_FALSE = /(?:multi|bi|uni|cross|tri)modal\w*|modalit\w*/g;
/** 用户主动打开的 UI(搜索、菜单、购物车、登录、视频、分享、相册)与 Google 不处罚的 cookie / 法律弹窗 */
const INTERSTITIAL_BENIGN = /cookie|consent|gdpr|ccpa|search|menu|navbar|cart|video|share|gallery|zoom|login|log-in|signin|sign-in|auth|account|quick-?view/;
const AUTHOR_PATH = /\/(?:author|authors)\/[^/?#]+/i;
const SIDE_TAGS = new Set(["nav", "aside", "footer"]);

const F_AUTHOR = 1;
const F_MODAL = 2;
const F_SIDE = 4;

/** 弹窗 / 遮罩线索(class 或 id 小写后传入) */
export function isInterstitialHint(classOrIdLower: string): boolean {
  if (!INTERSTITIAL_HINT.test(classOrIdLower)) return false;
  if (!INTERSTITIAL_HINT.test(classOrIdLower.replace(INTERSTITIAL_FALSE, " "))) return false;
  return !INTERSTITIAL_BENIGN.test(classOrIdLower);
}

interface DocScan {
  bylineFound: boolean;
  /** [优先级, 原始文本]:数字越小越可信 */
  names: [number, string][];
  authorLinks: [number, string][];
  metaAuthor: string | null;
  metaPublished: string | null;
  metaModified: string | null;
  ogUpdated: string | null;
  propPublished: string | null;
  propModified: string | null;
  timePublished: string | null;
  timeModified: string | null;
  faqMicrodata: boolean;
  interstitials: number;
  email: boolean;
  phone: boolean;
  address: boolean;
}

function sameSiteLink(href: string | undefined | null, base: string, host: string, selfKey: string): string | null {
  if (!href || !base) return null;
  const h = href.trim();
  if (!h || h.startsWith("#")) return null;
  const abs = normalizeUrl(h, base);
  if (!abs || abs.length > MAX_AUTHOR_LINK_CHARS || !isSameSite(abs, host)) return null;
  if (selfKey && dedupeKey(abs) === selfKey) return null;
  return abs;
}

function readMeta(el: HTMLElement, scan: DocScan): void {
  if (!el.rawAttrs) return;
  const name = (el.getAttribute("name") ?? "").trim().toLowerCase();
  const prop = (el.getAttribute("property") ?? "").trim().toLowerCase();
  const ip = (el.getAttribute("itemprop") ?? "").trim().toLowerCase();
  const content = (el.getAttribute("content") ?? "").trim();
  if (!content) return;
  const key = prop || name;
  if (name === "author" || key === "article:author") {
    scan.bylineFound = true;
    scan.metaAuthor ??= content;
  } else if (key === "article:published_time") scan.metaPublished ??= content;
  else if (key === "article:modified_time") scan.metaModified ??= content;
  else if (key === "og:updated_time") scan.ogUpdated ??= content;
  if (ip === "datepublished") scan.propPublished ??= content;
  else if (ip === "datemodified") scan.propModified ??= content;
  else if (/\bauthor\b/.test(ip)) {
    scan.bylineFound = true;
    scan.names.push([2, content]);
  }
}

function scanDocument(root: HTMLElement, base: string, host: string, selfKey: string): DocScan {
  const scan: DocScan = {
    bylineFound: false,
    names: [],
    authorLinks: [],
    metaAuthor: null,
    metaPublished: null,
    metaModified: null,
    ogUpdated: null,
    propPublished: null,
    propModified: null,
    timePublished: null,
    timeModified: null,
    faqMicrodata: false,
    interstitials: 0,
    email: false,
    phone: false,
    address: false,
  };
  let authorBudget = 20;
  const stack: [HtmlNode, number][] = [];
  for (let i = root.childNodes.length - 1; i >= 0; i--) stack.push([root.childNodes[i] as HtmlNode, 0]);
  while (stack.length) {
    const [node, flags] = stack.pop() as [HtmlNode, number];
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = tagOf(el);
    // <dialog> 默认隐藏、是无障碍组件(规格 §2 明确不算弹窗);不可见元素与评论区整块跳过
    if (INVISIBLE_TAGS.has(tag) || tag === "dialog") continue;
    const ci = el.classList?.length || el.id ? classAndId(el).toLowerCase() : "";
    if (ci && COMMENT_CTX.test(ci)) continue;
    let f = flags;
    // 只数最外层:一个 Bootstrap 弹窗有 modal / modal-dialog / modal-content 五六层
    if (ci && !(f & F_MODAL) && isInterstitialHint(ci)) {
      scan.interstitials++;
      f |= F_MODAL;
    }
    if (!(f & F_SIDE) && isChrome(el, SIDE_TAGS)) f |= F_SIDE;
    if (tag === "meta") {
      readMeta(el, scan);
      continue;
    }
    const raw = el.rawAttrs ?? "";
    let authorEl = false;
    if (raw) {
      if ((tag === "a" || tag === "link") && /\brel\s*=/i.test(raw) && /(?:^|\s)author(?:\s|$)/.test((el.getAttribute("rel") ?? "").toLowerCase())) {
        scan.bylineFound = true;
        const link = sameSiteLink(el.getAttribute("href"), base, host, selfKey);
        if (link) scan.authorLinks.push([2, link]);
        if (tag === "a") scan.names.push([3, boundedText(el, 120)]);
      }
      if (/itemprop/i.test(raw)) {
        const ip = (el.getAttribute("itemprop") ?? "").toLowerCase();
        if (/\bauthor\b/.test(ip)) {
          scan.bylineFound = true;
          authorEl = true;
        } else if (ip === "name" && f & F_AUTHOR) scan.names.push([2, boundedText(el, 120)]);
        const dateValue = () => el.getAttribute("datetime") ?? el.getAttribute("content") ?? boundedText(el, 64);
        if (/\bdatepublished\b/.test(ip)) scan.propPublished ??= dateValue();
        if (/\bdatemodified\b/.test(ip)) scan.propModified ??= dateValue();
      }
      if (!scan.faqMicrodata && /itemtype/i.test(raw) && /faqpage/i.test(raw)) scan.faqMicrodata = true;
      if (!scan.address && /itemtype/i.test(raw) && /postaladdress/i.test(raw)) scan.address = true;
      if (tag === "a" && (!scan.email || !scan.phone) && /(?:mailto|tel):/i.test(raw)) {
        const href = (el.getAttribute("href") ?? "").trim();
        if (/^mailto:/i.test(href) && mailtoHasEmail(href)) scan.email = true;
        else if (/^tel:/i.test(href) && telHasPhone(href)) scan.phone = true;
      }
    }
    // <address> 也常被拿来包作者署名("By Jane Doe"),所以除了 ≥15 个字符还要有数字(门牌号 / 邮编 / 电话)
    if (tag === "address" && !scan.address) {
      const text = collapse(boundedText(el, 300));
      if (text.length >= 15 && /\d/.test(text)) scan.address = true;
    }
    if (ci && BYLINE_CLASS.test(ci) && !BYLINE_EXCLUDE.test(ci)) {
      scan.bylineFound = true;
      authorEl = true;
    }
    if (authorEl && !(f & F_AUTHOR)) {
      f |= F_AUTHOR;
      if (authorBudget-- > 0) scan.names.push([4, boundedText(el, 160)]);
    }
    if (tag === "a" && raw) {
      if (f & F_AUTHOR) {
        if (authorBudget > 0) {
          const link = sameSiteLink(el.getAttribute("href"), base, host, selfKey);
          if (link) {
            scan.authorLinks.push([3, link]);
            scan.names.push([3, boundedText(el, 120)]);
          }
        }
      } else if (!(f & F_SIDE) && /author/i.test(raw)) {
        // 侧栏 / 页脚里的 /author/x 多是"其他作者"列表,不是本文作者
        const href = el.getAttribute("href") ?? "";
        if (AUTHOR_PATH.test(href)) {
          const link = sameSiteLink(href, base, host, selfKey);
          if (link) scan.authorLinks.push([4, link]);
        }
      }
    }
    // 侧栏 / 页脚 / 导航里的 <time> 多是"相关文章"的日期
    if (tag === "time" && !(f & F_SIDE)) {
      const dt = (el.getAttribute("datetime") ?? "").trim();
      if (dt) {
        const hint = `${ci} ${(el.getAttribute("itemprop") ?? "").toLowerCase()}`;
        if (/modif|updat/.test(hint)) scan.timeModified ??= dt;
        else scan.timePublished ??= dt;
      }
    }
    const kids = el.childNodes;
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i] as HtmlNode, f]);
  }
  return scan;
}

/* ============================================================
   汇总
   ============================================================ */

export interface ContentSignalsInput {
  /** 整个文档(署名 / 日期 / 弹窗看整页) */
  root: HTMLElement;
  /** extractMainContent 的结果(与 minhash 同一次抽取) */
  main: MainContent;
  title: string;
  lang: string | null;
  og: Record<string, string>;
  /** 已解析的 JSON-LD 根对象 */
  jsonLd: unknown[];
  base: string;
  host: string;
  /** 整页可见文本的各个文本节点(含页头页脚;parse.ts 算 wordCount 的那一份)—— 找邮箱 / 电话用;缺省时退回主体文本 */
  visibleParts?: readonly string[];
}

const METADATA_LINE = /^(?:by|written by|posted by|reviewed by|edited by|published|updated|last updated|posted)\b|\b\d+\s*-?\s*min(?:ute)?s?\s+read\b/i;
const DATE_LIKE = new RegExp(String.raw`\b(?:\d{4}-\d{2}-\d{2}|${MONTH}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+${MONTH}\s+\d{4})\b`, "i");

/** 署名行 / 日期行 / "7 min read":不是正文开头 */
function isMetadataBlock(b: MainBlock): boolean {
  if (b.words > 25) return false;
  return METADATA_LINE.test(b.text) || (b.words < 15 && DATE_LIKE.test(b.text));
}

const isParagraph = (b: MainBlock): boolean => b.kind === "p" && b.words >= MIN_PARAGRAPH_WORDS;

/**
 * 常见英文功能词。很多英文站压根没写 <html lang>:那时退到"看文本像不像英文"——英文散文里这些词
 * 通常占 20% 以上,德 / 法 / 西等语言里它们几乎不出现(偶有 a / in / an,远低于门槛)。
 * 声明了语言就以声明为准(写了 lang="de" 的页不会被这里改判成英文)。
 */
const EN_FUNCTION_WORDS = new Set([
  "the", "and", "of", "to", "a", "in", "is", "that", "for", "it", "with", "as", "on", "be", "are", "this", "by",
  "you", "your", "or", "at", "from", "can", "not", "have", "an", "we", "our", "was", "will", "if", "they", "their",
  "which", "has", "but", "what", "how", "more",
]);
/** 功能词占比门槛与最少样本:样本太少(<50 词)不下结论,宁可给 null */
const EN_FUNCTION_SHARE = 0.12;
const EN_MIN_WORDS = 50;

export function looksEnglish(text: string): boolean {
  const total = countWords(text);
  if (total < EN_MIN_WORDS) return false;
  let hits = 0;
  for (const t of wordTokens(text)) if (EN_FUNCTION_WORDS.has(t)) hits++;
  return hits / total >= EN_FUNCTION_SHARE;
}

/** 计算一页的 PageContentSignals(纯计算 + 只读 DOM;同一输入永远同一输出) */
export function computeContentSignals(input: ContentSignalsInput): PageContentSignals {
  const { main, base, host } = input;
  const title = input.title ?? "";
  let selfKey = "";
  try {
    selfKey = base ? dedupeKey(base) : "";
  } catch {
    selfKey = "";
  }

  /* ---- 文本(全部基于同一份主体文本) ---- */
  const mainWords = countWords(main.text);
  const analysis = normalizeTypography(clipText(main.text, MAX_ANALYZED_CHARS));

  // 目录 / 面包屑里的文字是导航,不是散文:不进段落、句子与 Flesch(与列表计数同一口径)
  let paragraphs = 0;
  let paragraphWords = 0;
  const prose: string[] = [];
  for (const b of main.blocks) {
    if (!b.lead) continue;
    if (isParagraph(b)) {
      paragraphs++;
      paragraphWords += b.words;
      prose.push(b.text);
    } else if (b.kind === "li") prose.push(b.text);
  }
  const proseText = prose.join("\n");
  const counts = readabilityCounts(proseText);
  // 声明了 lang 以声明为准;没声明时看散文本身像不像英文(只决定 Flesch 算不算,词表类信号本来就只认英文)
  const declaredLang = (input.lang ?? "").trim();
  const english = declaredLang ? /^en(?:$|[-_])/i.test(declaredLang) : looksEnglish(proseText);

  /* ---- 开头 ---- */
  const leadTokens: string[] = [];
  let firstParagraph = "";
  for (const b of main.blocks) {
    if (!b.lead || !(isParagraph(b) || b.kind === "li") || isMetadataBlock(b)) continue;
    if (!firstParagraph && isParagraph(b)) firstParagraph = clipText(b.text, FIRST_PARAGRAPH_CHARS);
    if (leadTokens.length < LEAD_WORDS) {
      for (const t of wordTokens(b.text)) {
        leadTokens.push(t);
        if (leadTokens.length >= LEAD_WORDS) break;
      }
    }
    if (firstParagraph && leadTokens.length >= LEAD_WORDS) break;
  }

  /* ---- 下一步链接:正文后 30% 里指向站内其他页的(按目标去重) ---- */
  let nextStepLinks = 0;
  if (main.totalWords > 0) {
    const from = main.totalWords * NEXT_STEP_FROM;
    for (const pos of main.internalLinkPositions) if (pos >= from) nextStepLinks++;
  }

  /* ---- 外链 ---- */
  let authoritativeOutlinks = 0;
  for (const u of main.externalUrls) if (isAuthoritativeUrl(u)) authoritativeOutlinks++;

  /* ---- 署名、日期、弹窗(整页) ---- */
  const ld = jsonLdFacts(input.jsonLd);
  const scan = scanDocument(input.root, base, host, selfKey);
  const byText = bylineFromText(clipText(main.text, BYLINE_SCAN_CHARS));

  const nameCandidates: [number, string | null][] = [[0, ld.authorName], [1, scan.metaAuthor], ...scan.names, [5, byText]];
  nameCandidates.sort((a, b) => a[0] - b[0]);
  let authorName: string | null = null;
  for (const [, raw] of nameCandidates) {
    authorName = cleanAuthorName(raw);
    if (authorName) break;
  }

  const linkCandidates: [number, string][] = [];
  const ldLink = sameSiteLink(ld.authorUrl, base, host, selfKey);
  if (ldLink) linkCandidates.push([1, ldLink]);
  linkCandidates.push(...scan.authorLinks);
  linkCandidates.sort((a, b) => a[0] - b[0]);
  const authorLink = linkCandidates[0]?.[1] ?? null;

  // 只凭"页面某处有 /author/x 链接"不算署名:rel=author 与署名区里的链接已经让 bylineFound 成立
  const byline = ld.authorInSchema || scan.bylineFound || !!byText;

  const datePublished = ld.datePublished ?? toIsoDate(scan.metaPublished) ?? toIsoDate(scan.propPublished) ?? toIsoDate(scan.timePublished);
  const dateModified = ld.dateModified ?? toIsoDate(scan.metaModified) ?? toIsoDate(scan.ogUpdated) ?? toIsoDate(scan.propModified) ?? toIsoDate(scan.timeModified);

  const siteNameRaw = collapse(input.og?.["og:site_name"] ?? "");
  const inText = scan.email && scan.phone ? { email: true, phone: true } : contactInText(input.visibleParts ?? [main.text]);
  const contactDetails: ContactDetails = {
    email: scan.email || inText.email,
    phone: scan.phone || inText.phone,
    address: ld.hasPostalAddress || scan.address,
  };

  return {
    mainWords,
    sentences: counts.sentences,
    paragraphs,
    fleschReadingEase: english ? fleschFrom(counts) : null,
    avgSentenceWords: counts.sentences ? round1(counts.words / counts.sentences) : 0,
    avgParagraphWords: paragraphs ? round1(paragraphWords / paragraphs) : 0,
    h2Count: main.h2,
    h3Count: main.h3,
    listCount: main.lists,
    orderedListCount: main.orderedLists,
    listItemCount: main.listItems,
    tableCount: main.tables,
    numberCount: countDataPoints(analysis),
    experienceMarkers: countMarkers(analysis, "experience"),
    originalDataMarkers: countMarkers(analysis, "originalData"),
    aiPhraseHits: countMarkers(analysis, "aiPhrase"),
    authoritativeOutlinks,
    outboundLinks: main.externalUrls.length,
    imagesSelfHosted: main.imagesOwn,
    imagesStock: main.imagesStock,
    byline,
    authorName,
    authorLink,
    authorInSchema: ld.authorInSchema,
    datePublished,
    dateModified,
    titleYear: titleYear(title),
    leadText: clipText(leadTokens.join(" "), MAX_LEAD_CHARS),
    firstParagraph,
    hasFaq: ld.hasFaqPage || scan.faqMicrodata || main.faqHeading,
    nextStepLinks,
    clickbaitHits: clickbaitHits(title),
    titleNumber: titlePromisedNumber(title),
    ymylHits: countMarkers(analysis, "ymyl"),
    orgName: ld.orgName,
    siteName: siteNameRaw ? clipText(siteNameRaw, MAX_ENTITY_CHARS) : null,
    titleBrand: titleBrand(title),
    sameAsCount: ld.sameAsCount,
    interstitialHints: scan.interstitials,
    contactDetails,
  };
}
