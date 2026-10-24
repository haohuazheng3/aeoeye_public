import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { captureError } from "@/lib/errors";
import { ToolInputError } from "@/lib/tools/net";
import { errorResult, type ToolResult } from "@/lib/tools/types";
import { BOTS } from "@/lib/tools/bots";
import * as crawl from "@/lib/tools/checks/crawl";
import * as page from "@/lib/tools/checks/page";
import * as social from "@/lib/tools/checks/social";
import * as schema from "@/lib/tools/checks/schema";
import * as perf from "@/lib/tools/checks/perf";
import { aeoGrader } from "@/lib/tools/checks/aeo";

/* ============================================================
   免费工具统一入口:POST /api/tools/<tool> { url, ...options } → ToolResult。
   全部只读、零边际成本(自建抓取 + Google PSI 免费额度 + W3C 公共校验服务)。
   进程内令牌桶限流;重工具(PSI / W3C / sitemap 生成)单独更严。
   ============================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = Record<string, unknown>;
const s = (v: unknown, max = 2000) => String(v ?? "").slice(0, max);
const botOpt = (v: unknown) => (typeof v === "string" && BOTS[v] ? v : undefined);

const TOOLS: Record<string, { heavy?: boolean; run: (b: Body) => Promise<ToolResult> }> = {
  robots: { run: (b) => crawl.robotsTester(s(b.url), { path: s(b.path, 500), ua: s(b.ua, 200) }) },
  "bot-access": { run: (b) => crawl.botAccess(s(b.url), Array.isArray(b.bots) ? (b.bots as unknown[]).map(String).filter((x) => BOTS[x]).slice(0, 16) : undefined) },
  sitemap: { run: (b) => crawl.sitemapChecker(s(b.url)) },
  "sitemap-generator": { heavy: true, run: (b) => crawl.sitemapGenerator(s(b.url), { max: Number(b.max) }) },
  redirect: { run: (b) => crawl.redirectChecker(s(b.url), { botId: botOpt(b.bot) }) },
  status: { run: (b) => crawl.statusChecker(s(b.url, 6000)) },
  headers: { run: (b) => crawl.headerChecker(s(b.url), { botId: botOpt(b.bot) }) },
  "meta-robots": { run: (b) => crawl.metaRobotsChecker(s(b.url)) },
  googlebot: { run: (b) => crawl.googlebotSimulator(s(b.url)) },
  source: { run: (b) => crawl.viewSource(s(b.url), { botId: botOpt(b.bot) }) },
  "llms-txt": { run: (b) => crawl.llmsTxtChecker(s(b.url)) },
  indexnow: { heavy: true, run: (b) => crawl.indexNowSubmit(s(b.url), { key: s(b.key, 200), urls: s(b.urls, 20000) }) },
  meta: { run: (b) => page.metaTagChecker(s(b.url)) },
  title: { run: (b) => page.titleDescFetch(s(b.url)) },
  onpage: { run: (b) => page.onPageChecker(s(b.url), { keyword: s(b.keyword, 100) }) },
  density: { run: (b) => page.keywordDensity(s(b.url), { keyword: s(b.keyword, 100) }) },
  wordcount: { run: (b) => page.wordCounter(s(b.url)) },
  links: { run: (b) => page.linkExtractor(s(b.url)) },
  html: { heavy: true, run: (b) => page.htmlChecker(s(b.url)) },
  og: { run: (b) => social.openGraphChecker(s(b.url)) },
  "og-image": { run: (b) => social.ogImageChecker(s(b.url)) },
  twitter: { run: (b) => social.twitterCardValidator(s(b.url)) },
  facebook: { run: (b) => social.facebookDebugger(s(b.url)) },
  "link-preview": { run: (b) => social.linkPreview(s(b.url)) },
  favicon: { run: (b) => social.faviconChecker(s(b.url)) },
  schema: { run: (b) => schema.schemaValidator(s(b.url)) },
  rich: { run: (b) => schema.richResultsTest(s(b.url)) },
  cwv: { heavy: true, run: (b) => perf.coreWebVitals(s(b.url)) },
  mobile: { heavy: true, run: (b) => perf.mobileFriendly(s(b.url)) },
  security: { run: (b) => perf.securityHeaders(s(b.url)) },
  hsts: { run: (b) => perf.hstsChecker(s(b.url)) },
  aeo: { run: (b) => aeoGrader(s(b.url)) },
};

export async function POST(req: Request, { params }: { params: { tool: string } }) {
  const def = TOOLS[params.tool];
  if (!def) return NextResponse.json(errorResult(params.tool, "", "Unknown tool."), { status: 404 });
  const ip = clientIp(req.headers);
  const rl = rateLimit(`tools:${def.heavy ? "heavy" : "light"}:${ip}`, def.heavy ? { limit: 10, windowMs: 10 * 60_000 } : { limit: 40, windowMs: 10 * 60_000 });
  if (!rl.ok) return NextResponse.json(errorResult(params.tool, "", `Too many checks from your network. Try again in ${rl.retryAfter} seconds.`), { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* empty */ }
  try {
    const out = await def.run(body);
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ToolInputError) return NextResponse.json(errorResult(params.tool, s(body.url, 200), e.message), { status: 400 });
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    if (!/Enter |must be|at least one/i.test(msg)) { const err = e instanceof Error ? e : new Error(String(e)); await captureError({ name: err.name, message: err.message, stack: err.stack, route: `/api/tools/${params.tool}`, level: "warn", source: "server", meta: { input: s(body.url, 200) } }); }
    return NextResponse.json(errorResult(params.tool, s(body.url, 200), /Enter |must be|at least one/i.test(msg) ? msg : "The check failed unexpectedly. Please try again."), { status: /Enter |must be|at least one/i.test(msg) ? 400 : 500 });
  }
}
