/* ============================================================
   AEO 评分器(站点侧 AI 搜索就绪度,0–100,权重公开写在页面上)。
   它不问 AI —— 问 AI 是免费 AI 可见度审计的事;这里只检查"AI 搜索引擎能不能抓到、
   读懂、引用你的页面"这些站点自己能控制的条件。权重依据各引擎的官方爬虫文档:
   搜索型爬虫被挡 = 不可能被引用(OpenAI / Perplexity / Anthropic 文档原话),所以权重最高;
   llms.txt 没有任何主流引擎承诺读取,只给 5 分。
   ============================================================ */

import { fetchRobots, detectBlock } from "@/lib/seo-audit/crawl";
import { safeFetch } from "@/lib/seo-audit/fetch";
import { parseTarget, fetchAs, header, isHtml, fetchFailure } from "../net";
import { parseDoc, metaTags, metaValue, titleOf, linkRels, headings, mainText, words } from "../html";
import { decidingRule } from "./crawl";
import { bot } from "../bots";
import { type ToolResult, type CheckItem, type Status, errorResult } from "../types";

const now = () => new Date().toISOString();

export const AEO_WEIGHTS = [
  { key: "search-bots", label: "AI search crawlers allowed in robots.txt", weight: 20 },
  { key: "live", label: "AI crawlers actually get the page (no firewall block)", weight: 15 },
  { key: "ssr", label: "Main content is in the HTML (no JavaScript needed)", weight: 15 },
  { key: "index", label: "Indexable: 200, no noindex, self canonical", weight: 10 },
  { key: "entity", label: "Organization entity markup (name, logo, sameAs)", weight: 10 },
  { key: "structure", label: "Answer-ready structure (direct answer, question headings, lists/tables)", weight: 10 },
  { key: "meta", label: "Title and meta description", weight: 5 },
  { key: "sitemap", label: "XML sitemap declared in robots.txt", weight: 5 },
  { key: "https", label: "HTTPS", weight: 5 },
  { key: "llms", label: "llms.txt (optional, low weight)", weight: 5 },
] as const;

export async function aeoGrader(input: string): Promise<ToolResult> {
  const t = parseTarget(input);
  const [rules, page, oai, pplx, llms] = await Promise.all([
    fetchRobots(t.origin),
    fetchAs(t.url, "browser"),
    fetchAs(t.url, "oaisearchbot", { maxBytes: 512 * 1024 }),
    fetchAs(t.url, "perplexitybot", { maxBytes: 512 * 1024 }),
    safeFetch(`${t.origin}/llms.txt`, { timeoutMs: 8_000, maxBytes: 256 * 1024 }),
  ]);
  if (page.status === 0) return errorResult("aeo", input, fetchFailure(page) ?? "Unreachable");
  const path = (() => { try { return new URL(t.url).pathname || "/"; } catch { return "/"; } })();
  const doc = isHtml(page) ? parseDoc(page.body) : null;
  const tags = doc ? metaTags(doc) : [];
  const res: Record<string, { pts: number; status: Status; value: string; detail?: string }> = {};
  const w = (k: string) => AEO_WEIGHTS.find((x) => x.key === k)!.weight;

  const searchBots = ["oaisearchbot", "perplexitybot", "claudesearchbot", "googlebot", "bingbot"];
  const blocked = searchBots.filter((id) => !decidingRule(rules, path, bot(id).token).allowed).map((id) => bot(id).name);
  res["search-bots"] = { pts: Math.round(w("search-bots") * (1 - blocked.length / searchBots.length)), status: blocked.length ? "fail" : "pass", value: blocked.length ? `blocked: ${blocked.join(", ")}` : "OAI-SearchBot, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot all allowed", detail: blocked.length ? "A search crawler you block can't cite you. Training bots (GPTBot, ClaudeBot) are a separate choice." : undefined };

  const liveBlocked = [oai, pplx].map((r, i) => ({ r, name: i ? "PerplexityBot" : "OAI-SearchBot" })).filter(({ r }) => r.status === 0 || r.status >= 400 || detectBlock(r));
  res.live = { pts: Math.round(w("live") * (1 - liveBlocked.length / 2)), status: liveBlocked.length ? "warn" : "pass", value: liveBlocked.length ? liveBlocked.map(({ r, name }) => `${name}: HTTP ${r.status || "—"}`).join(", ") : `OAI-SearchBot HTTP ${oai.status}, PerplexityBot HTTP ${pplx.status}`, detail: liveBlocked.length ? "Your CDN or firewall answers these user-agents with an error or challenge. Allow verified AI search bots by user-agent and published IP ranges." : undefined };

  const main = doc ? mainText(doc) : { text: "", scope: "body" as const };
  const wc = words(main.text).length;
  res.ssr = { pts: wc >= 200 ? w("ssr") : wc >= 80 ? Math.round(w("ssr") / 2) : 0, status: wc >= 200 ? "pass" : wc >= 80 ? "warn" : "fail", value: `${wc} words in the raw HTML`, detail: wc < 200 ? "Many AI crawlers don't execute JavaScript. Server-render the main content." : undefined };

  const robotsMeta = [metaValue(tags, "robots"), header(page, "x-robots-tag")].filter(Boolean).join(",");
  const canonical = doc ? linkRels(doc, page.finalUrl).find((l) => l.rel === "canonical")?.href : undefined;
  const idxOk = page.status === 200 && !/noindex|none/i.test(robotsMeta);
  const canOk = !canonical || canonical.replace(/\/$/, "") === page.finalUrl.replace(/\/$/, "");
  res.index = { pts: (idxOk ? 7 : 0) + (canOk ? 3 : 0), status: !idxOk ? "fail" : canOk ? "pass" : "warn", value: `HTTP ${page.status}${/noindex/i.test(robotsMeta) ? " · noindex" : ""}${canonical ? ` · canonical ${canOk ? "self" : "→ " + canonical}` : " · no canonical"}` };

  let org: Record<string, unknown> | null = null;
  let faq = false;
  for (const raw of doc?.jsonLd ?? []) {
    try {
      const walk = (o: unknown) => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (!o || typeof o !== "object") return;
        const x = o as Record<string, unknown>;
        const ty = ([] as unknown[]).concat(x["@type"] ?? []);
        if (ty.some((v) => typeof v === "string" && /Organization|LocalBusiness|Corporation/.test(v)) && !org) org = x;
        if (ty.includes("FAQPage")) faq = true;
        if (x["@graph"]) walk(x["@graph"]);
      };
      walk(JSON.parse(raw));
    } catch { /* ignore */ }
  }
  const o = org as Record<string, unknown> | null;
  const orgParts = o ? ["name", "url", "logo", "sameAs"].filter((k) => o[k]) : [];
  res.entity = { pts: Math.round((w("entity") * orgParts.length) / 4), status: orgParts.length === 4 ? "pass" : orgParts.length ? "warn" : "fail", value: o ? `Organization with ${orgParts.join(", ")}` : "no Organization markup", detail: orgParts.length < 4 ? "Organization markup with name, url, logo and sameAs (your profiles) helps engines tie mentions to one entity." : undefined };

  const hs = doc ? headings(doc) : [];
  const h2 = hs.filter((h) => h.level === 2);
  const qHeads = h2.filter((h) => /\?$|^(what|how|why|when|which|who|is|are|can|does|do|should)\b/i.test(h.text)).length;
  const firstP = doc?.root.querySelectorAll("main p, article p, p").map((p) => p.text.trim()).find((x) => words(x).length >= 12) ?? "";
  const firstWords = words(firstP).length;
  const listsTables = doc ? doc.root.querySelectorAll("ul, ol, table").length : 0;
  let sPts = 0;
  if (firstWords >= 12 && firstWords <= 70) sPts += 4;
  if (qHeads >= 2 || faq) sPts += 3;
  if (listsTables >= 2) sPts += 3;
  res.structure = { pts: sPts, status: sPts >= 8 ? "pass" : sPts >= 4 ? "warn" : "fail", value: `first paragraph ${firstWords} words · ${qHeads} question-style H2 · ${listsTables} lists/tables${faq ? " · FAQPage markup" : ""}`, detail: sPts < 8 ? "Open with a 40–60 word direct answer, phrase subheadings as the questions people ask, and use lists or tables for comparisons." : undefined };

  const title = doc ? titleOf(doc) : null;
  const desc = metaValue(tags, "description");
  res.meta = { pts: (title ? 3 : 0) + (desc ? 2 : 0), status: title && desc ? "pass" : "warn", value: `${title ? "title ✓" : "no title"} · ${desc ? "description ✓" : "no description"}` };
  res.sitemap = { pts: rules.sitemaps.length ? w("sitemap") : 0, status: rules.sitemaps.length ? "pass" : "warn", value: rules.sitemaps.length ? rules.sitemaps[0] : "no Sitemap line in robots.txt" };
  res.https = { pts: page.finalUrl.startsWith("https://") ? w("https") : 0, status: page.finalUrl.startsWith("https://") ? "pass" : "fail", value: page.finalUrl.startsWith("https://") ? "yes" : "no" };
  const llmsOk = llms.status === 200 && /^#\s+\S/m.test(llms.body || "") && !/^\s*<(!doctype|html)/i.test(llms.body || "");
  res.llms = { pts: llmsOk ? w("llms") : 0, status: llmsOk ? "pass" : "info", value: llmsOk ? "present" : "not found", detail: "Optional. No major AI engine has committed to reading llms.txt, so it's weighted lightly." };

  const score = Math.min(100, Object.values(res).reduce((s, x) => s + x.pts, 0));
  const items: CheckItem[] = AEO_WEIGHTS.map((x) => ({ label: `${x.label} (${res[x.key].pts}/${x.weight})`, status: res[x.key].status, value: res[x.key].value, detail: res[x.key].detail }));
  return {
    ok: true, tool: "aeo", input, url: page.finalUrl, fetchedAt: now(), score,
    verdict: score >= 80 ? "pass" : score >= 55 ? "warn" : "fail",
    headline: `AEO readiness ${score}/100 for ${page.finalUrl}. This grades what's on your site; to see what AI engines actually say about you, run the free AI visibility audit.`,
    sections: [{ title: "Score breakdown (weights are fixed and published)", kind: "checks", items }],
  };
}
