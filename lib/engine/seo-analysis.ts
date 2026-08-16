/* ============================================================
   地基层五模块 —— 三引擎融合架构

   前三个模块(技术 SEO / 页面结构与关键词 / 内容质量与 E-E-A-T):
     1. 三个模型各自出一份分析:
        · 主分析模型 —— 直连 OpenAI,拿完整事实包 + 可自己抓站核实
        · Claude Opus 5 —— DataForSEO。⚠️ user_prompt 实测上限 500 字符,
        · Gemini 3.1 Pro   所以只能给压缩版事实摘要 + 让它自己联网看站
     2. 主分析模型把三份**融合成一份**,逐条与事实包对账 —— 与实测冲突的
        结论直接丢弃。用户只看融合结果,不看引擎分栏(太乱)。

   注意这里的模型全是**分析角色**,一律用各家最强档 —— 与问答矩阵里的
   "受测引擎必须是免费用户默认档"是相反的取向,别混。

   后两个模块(移动性能 / 外链权威):真实数据源 + 主分析模型解读,不变。

   输出纪律:每条 finding 短标题 + 最多两句话。地基层是给创始人扫一眼
   就能行动的清单,不是咨询报告。
   ============================================================ */

import { LLM_MODEL_FULL, runTool } from "@/lib/anthropic";
import { openaiText } from "@/lib/openai";
import { dfsAskModelChain } from "./dataforseo";
import { evidenceToPrompt } from "./seo-evidence";
import { psiToPrompt } from "./psi";
import { backlinksToPrompt } from "./backlinks";
import type { BacklinkData, PsiFieldData, SeoEvidence, SeoFinding, SeoModule, SeoModuleId } from "./types";

/** 陪审模型链(DataForSEO 实测清单里确认存在)—— 分析角色,取各家最强档 */
const CLAUDE_MODELS = ["claude-opus-5", "claude-sonnet-5"];
const GEMINI_MODELS = ["gemini-3.1-pro-preview", "gemini-2.5-pro"];

type ModuleSpec = { id: SeoModuleId; label: string; focus: string };

const PANEL_MODULES: ModuleSpec[] = [
  {
    id: "technical",
    label: "Technical SEO",
    focus:
      "Can AI crawlers reach and read this site: robots rules for AI bots, llms.txt, sitemap, canonical, " +
      "whether content survives without JavaScript, structured data coverage.",
  },
  {
    id: "structure",
    label: "Page Structure & Keywords",
    focus:
      "Is the page shaped so an AI can lift an answer out: heading hierarchy, answer-first sections, " +
      "paragraph length, lists/tables/FAQ, and whether wording matches what buyers actually type.",
  },
  {
    id: "content",
    label: "Content Quality & E-E-A-T",
    focus:
      "Experience, expertise, authority, trust as an AI weighs them before citing: first-hand specifics vs claims, " +
      "verifiable facts, clear pricing and company details, generic filler vs real knowledge.",
  },
];

/* ---------- 三份原始分析 ---------- */

/** 主分析模型直连:唯一拿得到**完整**事实包的一份(其余两家卡在 500 字符上限) */
async function primaryTake(spec: ModuleSpec, url: string, evidence: string): Promise<string> {
  return openaiText({
    model: LLM_MODEL_FULL,
    system:
      "You are a senior technical SEO auditor focused on AI-answer visibility. Be concrete and site-specific; no generic checklist advice.",
    user:
      `Audit ${url} on ONE dimension: ${spec.label}.\nFocus: ${spec.focus}\n\n` +
      `Verified crawl facts (ground truth, do not contradict):\n${evidence}\n\n` +
      `You may fetch the site to verify beyond these facts. Give 3-5 findings, each ONE line: ` +
      `what's wrong (or solid) and why it matters for AI citation. Then one line "SCORE: n/100".`,
    maxTokens: 900,
    webSearch: true,
  });
}

/**
 * DataForSEO 侧(GPT-5.6 / Gemini):受 500 字符 prompt 上限约束,
 * 只给压缩事实 + 让它自己联网看站。
 */
function compactPrompt(spec: ModuleSpec, url: string, e: SeoEvidence): string {
  const blocked = e.crawlers.filter((c) => !c.allowed).map((c) => c.bot);
  const facts = [
    blocked.length ? `blocked AI bots: ${blocked.slice(0, 4).join("/")}` : "AI bots allowed",
    e.hasLlmsTxt ? "llms.txt yes" : "llms.txt no",
    e.jsDependent ? "content needs JS (crawlers see near-empty page)" : "content readable without JS",
    e.schemaTypes.length ? `schema: ${e.schemaTypes.slice(0, 3).join(",")}` : "no JSON-LD",
    `H1x${e.h1Count} H2x${e.h2Count}`,
    e.hasFaq ? "FAQ yes" : "FAQ no",
    e.brandConsistent ? "" : "brand name inconsistent across title/schema/H1",
  ]
    .filter(Boolean)
    .join("; ");
  // 硬预算:总长必须 <500(DataForSEO 拒收线),留 5 字余量
  const head = `Visit ${url} and audit it for AI-answer visibility. Dimension: ${spec.label}. `;
  const tail = ` Known crawl facts: ${facts}. Give 3-4 one-line findings specific to THIS site, then "SCORE: n/100".`;
  const room = 495 - head.length - tail.length;
  const focus = spec.focus.length > room ? spec.focus.slice(0, Math.max(0, room)) : spec.focus;
  return `${head}${focus}${tail}`;
}

/* ---------- 融合 ---------- */

const MERGE_TOOL = {
  name: "emit_module",
  description: "Merge three independent audits into one concise module, fact-checked against the crawl evidence.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: { type: "string", description: "One sentence, answer-first, max 120 chars." },
      score: { type: "number", description: "0-100, weighing the three audits and the evidence." },
      findings: {
        type: "array",
        description:
          "3-6 merged findings, most important first. Deduplicate across the three audits. " +
          "DISCARD any claim that contradicts the crawl evidence. Kill generic advice that fits any website.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Max 55 chars, specific." },
            detail: {
              type: "string",
              description:
                "HARD LIMIT: one sentence, 160 characters. Concrete, actionable, site-specific — " +
                "a sentence that would fit any website is a failed sentence.",
            },
            severity: { type: "string", enum: ["critical", "important", "minor", "ok"] },
          },
          required: ["title", "detail", "severity"],
        },
      },
    },
    required: ["verdict", "score", "findings"],
  },
};

async function mergeTakes(args: {
  spec: ModuleSpec;
  evidence: string;
  takes: { source: string; text: string }[];
}): Promise<SeoModule> {
  const alive = args.takes.filter((t) => t.text.trim());
  const sources = alive.map((t) => t.source);

  // 三家全空(极端故障)→ 如实空模块,不编内容
  if (!alive.length)
    return fallbackModule(
      args.spec.id,
      args.spec.label,
      "None of the analysis models returned a result for this layer on this run."
    );

  const body = alive.map((t) => `### ${t.source}\n${t.text.trim()}`).join("\n\n");
  const out = await runTool<{
    verdict: string;
    score: number;
    findings: { title: string; detail: string; severity: SeoFinding["severity"] }[];
  }>({
    model: LLM_MODEL_FULL,
    system:
      "You merge three independent SEO audits into one. The crawl evidence is ground truth: discard contradicting claims. " +
      "Write for a founder scanning fast — short, specific, zero filler. Never invent findings not present in the audits or evidence.",
    user:
      `Dimension: ${args.spec.label}\n\nCRAWL EVIDENCE (ground truth):\n-----\n${args.evidence}\n-----\n\n` +
      `THREE AUDITS:\n${body}`,
    tool: MERGE_TOOL,
    maxTokens: 1800,
    temperature: 0.2,
  });

  return {
    id: args.spec.id,
    label: args.spec.label,
    verdict: out.verdict,
    score: clampScore(out.score),
    findings: (out.findings || []).slice(0, 6).map((f) => ({ ...f, provenance: "verified" as const })),
    sources,
  };
}

function clampScore(n: unknown): number | null {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* ---------- 单数据源模块(性能 / 外链) ---------- */

const SOLO_TOOL = {
  name: "emit_solo_module",
  description: "Interpret one real data source into a concise audit module.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: { type: "string", description: "One sentence, answer-first, max 120 chars." },
      score: { type: "number", description: "0-100. Omit if the data source returned nothing." },
      findings: {
        type: "array",
        description: "2-4 findings. Max 2 short sentences each. Never invent numbers not in the data.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Max 55 chars." },
            detail: { type: "string" },
            severity: { type: "string", enum: ["critical", "important", "minor", "ok"] },
          },
          required: ["title", "detail", "severity"],
        },
      },
      dataGap: { type: "string", description: "Only if the source had no data — one plain sentence." },
    },
    required: ["verdict", "findings"],
  },
};

async function soloModule(args: {
  id: SeoModuleId;
  label: string;
  system: string;
  data: string;
  hasData: boolean;
  source: string;
}): Promise<SeoModule> {
  const out = await runTool<{
    verdict: string;
    score?: number;
    findings: { title: string; detail: string; severity: SeoFinding["severity"] }[];
    dataGap?: string;
  }>({
    model: LLM_MODEL_FULL,
    system: args.system,
    user: args.data,
    tool: SOLO_TOOL,
    maxTokens: 1200,
    temperature: 0.2,
  });

  return {
    id: args.id,
    label: args.label,
    verdict: out.verdict,
    score: args.hasData ? clampScore(out.score) : null,
    findings: (out.findings || []).slice(0, 4).map((f) => ({ ...f, provenance: "verified" as const })),
    sources: [args.source],
    dataGap: out.dataGap || (args.hasData ? undefined : "这个数据源本轮没有返回数据。"),
  };
}

const PERF_SYSTEM =
  "You interpret Chrome UX Report FIELD data — real users, real devices. Never call it a lab score, never invent numbers. " +
  "Explain briefly what each number means for AI citation (slow pages get crawled less and bounced from more). " +
  "If there is no field data, do NOT invent a score: say plainly the site's real traffic is below Google's sampling threshold, " +
  "and that this itself is the finding. Max 2 short sentences per finding.";

const AUTH_SYSTEM =
  "You interpret a real backlink profile from a live link index. Every number is measured — never invent or guess link quality you can't see. " +
  "Explain briefly what it means for AI citation: a domain nothing links to has no independent corroboration. " +
  "Be honest about scale; no generic link-building advice. Max 2 short sentences per finding.";

/* ---------- 对外入口 ---------- */

export async function buildFoundationModules(args: {
  url: string;
  domain: string;
  evidence: SeoEvidence;
  psi: PsiFieldData;
  backlinks: BacklinkData;
}): Promise<SeoModule[]> {
  const evidenceText = evidenceToPrompt(args.evidence);

  // 三个融合模块并行;每个模块内部三家模型也并行
  const panelWork = PANEL_MODULES.map(async (spec) => {
    const [primary, claude, gemini] = await Promise.all([
      primaryTake(spec, args.url, evidenceText),
      dfsAskModelChain("claude", CLAUDE_MODELS, compactPrompt(spec, args.url, args.evidence)).then((t) => t || ""),
      dfsAskModelChain("gemini", GEMINI_MODELS, compactPrompt(spec, args.url, args.evidence)).then((t) => t || ""),
    ]);
    // 融合失败多半是并发挤兑下的瞬时错(整轮升级同时打 4 引擎×10 题 + 3 份
    // 独立分析)。三家原文已经到手,丢掉太亏 —— 重试一次再认输。
    const takes = [
      { source: "GPT-5.6 (full crawl facts)", text: primary },
      { source: "Claude Opus 5", text: claude },
      { source: "Gemini 3.1 Pro", text: gemini },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await mergeTakes({ spec, evidence: evidenceText, takes });
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    return fallbackModule(spec.id, spec.label);
  });

  const perfWork = soloModule({
    id: "performance",
    label: "Mobile Performance",
    system: PERF_SYSTEM,
    data: psiToPrompt(args.psi),
    hasData: args.psi.scope !== "none",
    source: "Chrome UX Report (real users)",
  }).catch(() => fallbackModule("performance", "Mobile Performance"));

  const authWork = soloModule({
    id: "authority",
    label: "Backlinks & Brand Authority",
    system: AUTH_SYSTEM,
    data: backlinksToPrompt(args.backlinks, args.domain),
    hasData: args.backlinks.available,
    source: "DataForSEO Backlinks (live index)",
  }).catch(() => fallbackModule("authority", "Backlinks & Brand Authority"));

  const [panels, perf, auth] = await Promise.all([Promise.all(panelWork), perfWork, authWork]);
  return [...panels, perf, auth];
}

/** 分析失败时如实产出空模块,而不是编内容 */
function fallbackModule(id: SeoModuleId, label: string, gap?: string): SeoModule {
  return {
    id,
    label,
    verdict: "This module couldn't be generated on this run.",
    score: null,
    findings: [],
    sources: [],
    // 英文报告,兜底也必须英文;而且不放推测内容 —— 没测出来就是没测出来
    dataGap: gap ?? "This analysis step failed on this run — we don't guess, so this layer stays empty rather than made up.",
  };
}

/** 五个模块里真实问题的条数(severity != ok) */
export function countIssues(modules: SeoModule[]): number {
  const seen = new Set<string>();
  for (const m of modules) {
    for (const f of m.findings) {
      if (f.severity === "ok") continue;
      seen.add(`${m.id}::${f.title.toLowerCase().replace(/[^a-z0-9]+/g, "")}`);
    }
  }
  return seen.size;
}
