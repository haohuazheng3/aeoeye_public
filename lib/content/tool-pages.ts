import fs from "node:fs";
import path from "node:path";
import { TOOLS as LEGACY_TOOLS } from "./tools";

/* ============================================================
   工具优先页(A 级,2026-10-24 SEO 底座 v2):content/tools/<slug>.json
   - 首屏即工具(runner 指定用哪个前端组件 / 哪个服务端检查器)
   - 正文 300–800 词,H2 = 副关键词的词条标题,先答后展开
   - 门禁:scripts/verify-content-quality.mjs(编辑证据 tools--<slug>.json)
   老的 4 个手写工具页(lib/content/tools.ts)保持原样,两者在 /tools 索引与分类枢纽里合并展示。
   ============================================================ */

export type ToolCategory = "ai-search" | "crawl-index" | "on-page" | "social-schema" | "speed-security";

export type RunnerConfig =
  | {
      component: "runner";
      tool: string;
      submitLabel: string;
      fields?: { name: string; label: string; placeholder?: string; type?: "url" | "text" | "textarea" | "select"; options?: { value: string; label: string }[]; optional?: boolean }[];
      extra?: Record<string, unknown>;
      examples?: string[];
      busyText?: string;
      footnote?: string;
    }
  | { component: "serp-editor" | "meta-generator" | "slug-generator" | "indexnow" | "og-image-generator" | "favicon-generator" | "seo-checklist" | "seo-report" | "sitemap-examples" | "ai-audit" };

export type ToolImage = { url: string; alt: string; photographer: string; photographerUrl: string; pexelsUrl?: string };

export type ToolPage = {
  slug: string;
  category: ToolCategory;
  /** 卡片 / 面包屑用的短名 */
  name: string;
  /** <title> 与 H1(主关键词词条标题) */
  title: string;
  description: string;
  /** H1 下 ≤60 词的直接答案 */
  answer: string;
  keywords: string[];
  runner: RunnerConfig;
  /** 首屏工具下方的一行可信说明(我们怎么测、测的是什么) */
  trust: string;
  /** 正文 Markdown(## 开头的 H2 分段) */
  body: string;
  faqs: { q: string; a: string }[];
  sources: { label: string; url: string }[];
  images: ToolImage[];
  related: string[];
  cta: "seo" | "aeo";
  appCategory?: string;
  published: string;
  updated: string;
};

export type CategoryMeta = {
  slug: ToolCategory;
  name: string;
  title: string;
  description: string;
  intro: string;
  keyword: string;
};

export const TOOL_CATEGORIES: CategoryMeta[] = [
  {
    slug: "ai-search",
    name: "AI search & crawlers",
    title: "Free AEO Tools: AI Crawler, llms.txt & AI Visibility Checks",
    description:
      "Free AEO tools that test what AI search actually sees: GPTBot, ClaudeBot and other AI crawler access, llms.txt, AEO readiness and whether ChatGPT recommends you.",
    intro:
      "AEO tools answer one question from two sides: can AI crawlers reach and read your site, and do AI assistants actually recommend you? Every tool here runs a live check — no signup, no tracking subscription.",
    keyword: "aeo tools",
  },
  {
    slug: "crawl-index",
    name: "Crawling & indexing",
    title: "Google Indexing Tools: Robots.txt, Sitemap & Redirect Checks",
    description:
      "Free crawling and indexing tools: test robots.txt rules, validate sitemaps, trace redirects, check status codes and headers, and see the HTML Googlebot gets.",
    intro:
      "If Google can't crawl a URL, nothing else on the page matters. These tools fetch your pages the way crawlers do and show the exact rule, redirect or header that's in the way.",
    keyword: "google indexing tool",
  },
  {
    slug: "on-page",
    name: "On-page & content",
    title: "On-Page SEO Analysis Tools Online: Titles, Meta & Content",
    description:
      "Free on-page SEO analysis tools online: check title tags and meta descriptions by pixel width, grade a page, count words, extract links and validate HTML.",
    intro:
      "On-page problems are the cheapest SEO fixes you'll ever make. These tools read a live page and tell you what to change in the title, description, headings and copy.",
    keyword: "seo analysis tools online",
  },
  {
    slug: "social-schema",
    name: "Schema & social previews",
    title: "Schema & Social Preview Tools: Rich Results, OG & X Cards",
    description:
      "Free tools to test structured data against Google's current rules and preview how your links look on Facebook, X, LinkedIn, Slack, Discord and iMessage.",
    intro:
      "Structured data decides which rich results you can get; Open Graph and card tags decide what a shared link looks like. Both are invisible until something breaks — these tools make them visible.",
    keyword: "structured data checker",
  },
  {
    slug: "speed-security",
    name: "Speed, mobile & security",
    title: "Website Speed, Mobile & Security Tests (Free, Real-User Data)",
    description:
      "Free website tests for Core Web Vitals from real Chrome users, mobile-friendliness, security headers and HSTS — graded, with copy-paste fixes.",
    intro:
      "Speed, mobile layout and HTTPS hygiene are table stakes for ranking and for trust. These tests use real-user Chrome data where it exists and tell you which fix moves the number.",
    keyword: "tools to check website performance",
  },
];

/** 老的 4 个手写工具页归到哪个枢纽 */
export const LEGACY_TOOL_CATEGORY: Record<string, ToolCategory> = {
  "llms-txt-generator": "ai-search",
  "ai-robots-txt-generator": "ai-search",
  "schema-generator": "social-schema",
  "seo-roi-calculator": "on-page",
};

const DIR = path.join(process.cwd(), "content", "tools");

let cache: ToolPage[] | null = null;

export function getToolPages(): ToolPage[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  let files: string[] = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  const pages = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as ToolPage);
  pages.sort((a, b) => a.name.localeCompare(b.name));
  cache = pages;
  return pages;
}

export function getToolPage(slug: string): ToolPage | undefined {
  return getToolPages().find((p) => p.slug === slug);
}

export function getCategory(slug: string): CategoryMeta | undefined {
  return TOOL_CATEGORIES.find((c) => c.slug === slug);
}

/** 正文按 H2 切段,便于在段间插图与生成目录。代码块(```)里以 "## " 开头的行(例如 llms.txt 范例)不算标题。 */
export function splitSections(markdown: string): { heading: string | null; body: string }[] {
  const out: { heading: string | null; body: string[] }[] = [{ heading: null, body: [] }];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence && /^## (.+)$/.exec(line);
    if (m) out.push({ heading: m[1].trim(), body: [] });
    else out[out.length - 1].body.push(line);
  }
  return out
    .map((s) => ({ heading: s.heading, body: s.body.join("\n").trim() }))
    .filter((s) => s.heading !== null || s.body.length > 0);
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 可见正文词数(答案 + 正文 + FAQ),供 lint 与门禁对照 A 级 300–800 词 */
export function visibleWordCount(p: ToolPage): number {
  const text = [p.answer, p.body.replace(/[#*_`>|\-[\]()]/g, " "), ...p.faqs.flatMap((f) => [f.q, f.a])].join(" ");
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

/** 枢纽内条目:新工具页 + 归到该枢纽的老工具页(底座要求每个枢纽 ≤15–20 条) */
export function categoryItems(slug: string): { slug: string; name: string; description: string }[] {
  const pages = getToolPages()
    .filter((p) => p.category === slug)
    .map((p) => ({ slug: p.slug, name: p.name, description: p.description }));
  const legacy = LEGACY_TOOLS.filter((t) => LEGACY_TOOL_CATEGORY[t.slug] === slug).map((t) => ({ slug: t.slug, name: t.name, description: t.description }));
  return [...pages, ...legacy];
}
