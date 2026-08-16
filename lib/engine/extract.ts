import type { FetchedPage } from "./crawl";
import type { SiteAudit, SiteSignal } from "./types";

/** 解析页面内所有 JSON-LD,展开 @graph,返回对象数组 + 类型集合 */
export function extractJsonLd(rawHtml: string): { blocks: unknown[]; types: string[] } {
  const blocks: unknown[] = [];
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawHtml)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        const graph = (item && (item as Record<string, unknown>)["@graph"]) as unknown[] | undefined;
        const nodes = Array.isArray(graph) ? graph : [item];
        for (const node of nodes) {
          blocks.push(node);
          const t = (node as Record<string, unknown>)?.["@type"];
          if (typeof t === "string") types.add(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
        }
      }
    } catch {
      /* 跳过坏块 */
    }
  }
  return { blocks, types: [...types] };
}

export function metaDescriptionOf(rawHtml: string): string {
  const m = rawHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  return m?.[1]?.trim() || "";
}

export function isNoindex(rawHtml: string): boolean {
  return /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(rawHtml);
}

export function hasViewport(rawHtml: string): boolean {
  return /<meta[^>]+name=["']viewport["']/i.test(rawHtml);
}

export function wordCount(markdown: string): number {
  return (markdown.match(/\b[\w'-]+\b/g) || []).length;
}

export function detectFaq(rawHtml: string, types: string[]): boolean {
  if (types.some((t) => /FAQPage|Question/i.test(t))) return true;
  return /(frequently asked questions|\bFAQ\b)/i.test(rawHtml);
}

/** 取页面正文片段(给 LLM 用),去掉多余空白 */
export function contentSnippet(markdown: string, max = 2400): string {
  const clean = markdown.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length <= max ? clean : clean.slice(0, max) + "…";
}

/** 从首页 + 辅助文件构建 AEO 技术信号(改进建议依据) */
export function buildSiteAudit(args: {
  home: FetchedPage;
  robots: { ok: boolean; text: string };
  sitemap: { ok: boolean };
  llms: { ok: boolean };
}): SiteAudit {
  const { home, robots, sitemap, llms } = args;
  if (!home.ok) {
    return {
      reachable: false,
      hasSchema: false,
      schemaTypes: [],
      hasLlmsTxt: false,
      hasFaq: false,
      wordCount: 0,
      signals: [],
    };
  }
  const { types } = extractJsonLd(home.rawHtml);
  const wc = wordCount(home.markdown);
  const desc = metaDescriptionOf(home.rawHtml);
  const noindex = isNoindex(home.rawHtml);
  const hasFaq = detectFaq(home.rawHtml, types);
  const hasOrg = types.some((t) => /Organization|LocalBusiness|Brand/i.test(t));
  const hasProductOrService = types.some((t) => /Product|Service|Offer/i.test(t));

  const signals: SiteSignal[] = [
    {
      id: "structured-data",
      label: "Structured data (schema.org)",
      status: types.length ? (hasOrg ? "pass" : "warn") : "fail",
      detail: types.length
        ? `Found: ${types.slice(0, 6).join(", ")}${hasOrg ? "" : " — missing Organization/Brand markup that tells AI who you are"}`
        : "No JSON-LD found. AI assistants rely on schema.org to understand your brand, products and facts.",
    },
    {
      id: "llms-txt",
      label: "llms.txt",
      status: llms.ok ? "pass" : "warn",
      detail: llms.ok
        ? "Present — gives AI crawlers a curated map of your most important pages."
        : "Missing. An llms.txt file helps AI assistants find and cite your authoritative pages.",
    },
    {
      id: "faq",
      label: "FAQ / question-style content",
      status: hasFaq ? "pass" : "warn",
      detail: hasFaq
        ? "Detected. Question-and-answer content is exactly what AI assistants quote."
        : "Not detected. AI answers reward pages that directly answer the questions buyers ask.",
    },
    {
      id: "meta-description",
      label: "Meta description",
      status: desc ? "pass" : "warn",
      detail: desc ? `"${desc.slice(0, 120)}${desc.length > 120 ? "…" : ""}"` : "Missing — adds an easy, machine-readable summary of the page.",
    },
    {
      id: "crawlable",
      label: "Crawlable by AI bots",
      status: noindex ? "fail" : robots.ok ? "pass" : "warn",
      detail: noindex
        ? "Homepage is set to noindex — you're actively hidden from search and AI crawlers."
        : robots.ok
          ? "robots.txt reachable and not blocking the homepage."
          : "robots.txt not found. Add one so crawlers know what to index.",
    },
    {
      id: "sitemap",
      label: "XML sitemap",
      status: sitemap.ok ? "pass" : "warn",
      detail: sitemap.ok ? "Present — helps engines discover all your pages." : "Not found at /sitemap.xml.",
    },
    {
      id: "content-depth",
      label: "Content depth",
      status: wc >= 500 ? "pass" : wc >= 200 ? "warn" : "fail",
      detail: `Homepage has ~${wc} words. ${wc >= 500 ? "Enough substance for AI to summarize." : "Thin pages give AI little to quote — add substantive, factual content."}`,
    },
    {
      id: "product-markup",
      label: "Product / service markup",
      status: hasProductOrService ? "pass" : "warn",
      detail: hasProductOrService
        ? "Product/Service/Offer schema present."
        : "No Product/Service schema — AI can't reliably extract what you sell, for whom, at what price.",
    },
  ];

  return {
    reachable: true,
    title: home.title,
    description: desc || undefined,
    hasSchema: types.length > 0,
    schemaTypes: types,
    hasLlmsTxt: llms.ok,
    hasFaq,
    wordCount: wc,
    signals,
  };
}
