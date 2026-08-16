import { env, features } from "@/lib/env";

export type FetchedPage = {
  url: string;
  ok: boolean;
  markdown: string;
  rawHtml: string;
  links: string[];
  metadata: Record<string, unknown>;
  title?: string;
};

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";

/** 用 Firecrawl 抓取单页(markdown + rawHtml + links + metadata)。失败返回 ok:false。 */
export async function scrapePage(
  url: string,
  { timeoutMs = 18000, onlyMainContent = false }: { timeoutMs?: number; onlyMainContent?: boolean } = {}
): Promise<FetchedPage> {
  const empty: FetchedPage = { url, ok: false, markdown: "", rawHtml: "", links: [], metadata: {} };
  if (!features.firecrawl) return empty;
  try {
    const res = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "rawHtml", "links"],
        onlyMainContent,
        blockAds: true,
        timeout: timeoutMs,
      }),
      signal: AbortSignal.timeout(timeoutMs + 5000),
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown> };
    const data = json.data || {};
    return {
      url,
      ok: !!json.success,
      markdown: (data.markdown as string) || "",
      rawHtml: (data.rawHtml as string) || "",
      links: (data.links as string[]) || [],
      metadata: (data.metadata as Record<string, unknown>) || {},
      title: ((data.metadata as Record<string, unknown>)?.title as string) || undefined,
    };
  } catch {
    return empty;
  }
}

/** 取小文本文件(robots.txt / sitemap.xml / llms.txt) */
export async function fetchText(url: string): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AEOeyeBot/1.0 (+https://aeoeye.com)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, text: "" };
    const text = await res.text();
    return { ok: true, text: text.slice(0, 20000) };
  } catch {
    return { ok: false, text: "" };
  }
}
