import { env, features } from "@/lib/env";
import { recordDataForSeoCost } from "@/lib/cost";
import type { EngineId } from "./types";

/* ============================================================
   DataForSEO AI Optimization 适配器
   真实查询 ChatGPT / Perplexity / Gemini /(Google AI Mode)。
   余额耗尽或未配置时,上层把对应引擎标记为 "inactive"(不伪造结果)。
   ============================================================ */

const BASE = "https://api.dataforseo.com/v3";

function authHeader() {
  return { Authorization: `Basic ${env.DATAFORSEO_B64}`, "Content-Type": "application/json" };
}

/** DataForSEO 账户余额(USD)。失败或未配置返回 null。 */
export async function dfsBalance(): Promise<number | null> {
  if (!features.dataforseo) return null;
  try {
    const res = await fetch(`${BASE}/appendix/user_data`, { headers: authHeader(), signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    const money = json?.tasks?.[0]?.result?.[0]?.money;
    return typeof money?.balance === "number" ? money.balance : null;
  } catch {
    return null;
  }
}

/** 这些引擎是否"已激活"(配置存在且余额为正) */
export async function dfsEnginesActive(): Promise<boolean> {
  const bal = await dfsBalance();
  return bal !== null && bal > 0.05;
}

/**
 * 各引擎审计所用模型 —— 一律对标**免费用户默认拿到的那一档**(站长 2026-08-09 拍板)。
 * 不是最便宜的小模型,也不是 $20 订阅档:买家在免费 ChatGPT/Gemini/Perplexity 里
 * 问出来是什么样,报告就得是什么样。用 Pro 档去测,等于在测一个多数买家看不到的产品。
 *
 * 模型名全部取自 DataForSEO `.../llm_responses/models` 实测清单(免费端点)——
 * 名字猜错时 DataForSEO 返回 cost 0 + 空正文,会被误读成"这个 AI 没提到你",
 * 生成一份完全错误的付费报告。
 *
 * maxTokens:OpenAI 推理系模型拒绝 max_output_tokens(实测 40501 "Invalid Field"),
 * 必须省略;Gemini 与 Perplexity 接受(实测 20000),保留以控成本。
 * fallbacks:模型下线/改名时逐个降级,而不是静默失败。
 *
 * 五个引擎全部在这里 —— chatgpt 正常走 OpenAI 直连,这里的配置只是备份通道。
 */
type EngineCfg = { slug: string; model: string; fallbacks: string[]; maxTokens: boolean };

type DfsEngineId = EngineId;

const ENGINE_MAP: Record<DfsEngineId, EngineCfg> = {
  // 正常路径走 OpenAI 直连(gpt-engine.ts);这里只是主通道挂掉时的备份
  chatgpt: {
    slug: "chat_gpt",
    model: "gpt-5.6-luna",
    fallbacks: ["gpt-5.5", "gpt-5.3-chat-latest"],
    maxTokens: false,
  },
  // 免费 Claude 用户默认 Sonnet。ANTHROPIC_API_KEY 在位时走直连,缺席时落到这里
  claude: {
    slug: "claude",
    model: "claude-sonnet-5",
    fallbacks: ["claude-sonnet-4-6", "claude-sonnet-4-5"],
    maxTokens: true,
  },
  // 免费 Gemini 用户默认 Flash 档 —— Pro-preview 是 $20 订阅才有的
  gemini: {
    slug: "gemini",
    model: "gemini-3.6-flash",
    fallbacks: ["gemini-3.5-flash", "gemini-2.5-flash"],
    maxTokens: true,
  },
  // 免费 Perplexity 默认 sonar;sonar-pro 属 Pro($20/月)
  perplexity: {
    slug: "perplexity",
    model: "sonar",
    fallbacks: ["sonar-pro"],
    maxTokens: true,
  },
  google_ai: { slug: "chat_gpt", model: "", fallbacks: [], maxTokens: false }, // 未使用:实际走 ai_mode(见下)
};

/**
 * 递归收集回答正文。**不是**所有 text 都算回答 —— 实测两类节点必须整棵跳过:
 *
 * 1) type="reasoning"(实测 gemini-3.1-pro-preview 返回结构):模型的思考过程,
 *    "Okay, so the user wants…" 那种自言自语。曾被当正文捞进付费报告,
 *    用户花钱看到的是模型的草稿纸。真正的回答在 type="message" 节点里。
 * 2) type="ai_overview_reference" / "link_element" 及 references 键(实测
 *    ai_mode 返回结构):引用来源网页的片段,"Skip to content…" 导航残渣的来源。
 */
const SKIP_TYPES = new Set(["reasoning", "ai_overview_reference", "link_element"]);
const SKIP_KEYS = new Set(["references", "links"]);

function harvestText(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || node == null) return out;
  if (typeof node === "string") return out;
  if (Array.isArray(node)) {
    for (const x of node) harvestText(x, out, depth + 1);
    return out;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.type === "string" && SKIP_TYPES.has(o.type)) return out;
    if (typeof o.text === "string" && o.text.trim()) out.push(o.text.trim());
    else if (typeof o.message === "string" && o.message.trim()) out.push(o.message.trim());
    for (const k of Object.keys(o)) {
      if (k === "text" || k === "message" || SKIP_KEYS.has(k)) continue;
      harvestText(o[k], out, depth + 1);
    }
  }
  return out;
}

/** 该引擎审计时实际使用的模型标识(展示给用户,报告要能自证用的是哪一档) */
export function dfsEngineModel(engine: EngineId): string | null {
  if (engine === "google_ai") return null;
  return ENGINE_MAP[engine as DfsEngineId]?.model ?? null;
}

/** 单次 live 调用。返回正文,或 null(该模型不可用/无正文) */
async function askOnce(cfg: EngineCfg, model: string, prompt: string, stage: string): Promise<string | null> {
  const body: Record<string, unknown> = { user_prompt: prompt, model_name: model, web_search: true };
  if (cfg.maxTokens) body.max_output_tokens = 700;
  const res = await fetch(`${BASE}/ai_optimization/${cfg.slug}/llm_responses/live`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify([body]),
    signal: AbortSignal.timeout(45000),
  });
  const json = await res.json();
  const task = json?.tasks?.[0];
  // 记账用 task.cost —— 这是 DataForSEO 自己算的真实扣费,账本里唯一的实测数字。
  // 被拒的 task cost 为 0,照记不误(0 也是事实)。
  recordDataForSeoCost({
    endpoint: `ai_optimization/${cfg.slug}`,
    stage,
    usd: typeof task?.cost === "number" ? task.cost : 0,
  });
  if (json?.status_code !== 20000 || task?.status_code !== 20000) {
    // 模型名失效/字段被拒 —— 记下来,让上层能降级,而不是当成"AI 没提到你"
    console.error("dfs model rejected", cfg.slug, model, task?.status_code, task?.status_message);
    return null;
  }
  const text = harvestText(task?.result?.[0]?.items).join("\n").trim();
  return text || null;
}

/**
 * 用 DataForSEO 真实查询某引擎对一个问题的回答。返回回答正文;全部候选都失败才返回 null。
 * 逐个降级而非静默失败 —— 空正文会被判成"这个 AI 从不推荐你",直接毁掉一份付费报告。
 */
export async function dfsAskEngine(engine: EngineId, prompt: string): Promise<string | null> {
  if (!features.dataforseo) return null;

  // Google AI Mode 走 SERP 端点
  if (engine === "google_ai") return dfsGoogleAiMode(prompt);

  const cfg = ENGINE_MAP[engine as DfsEngineId];
  const stage = `Engine: ${engine}`;
  for (const model of [cfg.model, ...cfg.fallbacks]) {
    try {
      const text = await askOnce(cfg, model, prompt, stage);
      if (text) return text;
    } catch {
      /* 该候选异常,试下一个 */
    }
  }
  return null;
}

/**
 * 指定模型链的自定义调用(地基层分析用)。
 * ⚠️ DataForSEO 的 user_prompt 实测上限 **500 字符**(490 过、800 拒 40501),
 * 超限直接拒收且 cost=0 —— 曾把整包事实塞进来,四个引擎全空,
 * 报告满屏 "No response returned from this engine"。这里硬裁到 495 防御。
 */
export async function dfsAskModelChain(
  slug: "chat_gpt" | "gemini" | "claude",
  models: string[],
  prompt: string
): Promise<string | null> {
  if (!features.dataforseo) return null;
  const cfg: EngineCfg = { slug, model: models[0], fallbacks: models.slice(1), maxTokens: slug !== "chat_gpt" };
  const clipped = prompt.length > 495 ? prompt.slice(0, 495) : prompt;
  for (const model of [cfg.model, ...cfg.fallbacks]) {
    try {
      const text = await askOnce(cfg, model, clipped, "SEO foundation");
      if (text) return text;
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

/** Google AI Mode(SERP)对一个查询的 AI 回答 */
async function dfsGoogleAiMode(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/serp/google/ai_mode/live/advanced`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify([{ keyword: prompt, location_code: 2840, language_code: "en", device: "desktop" }]),
      signal: AbortSignal.timeout(40000),
    });
    const json = await res.json();
    const task = json?.tasks?.[0];
    recordDataForSeoCost({
      endpoint: "serp/google/ai_mode",
      stage: "Engine: google_ai",
      usd: typeof task?.cost === "number" ? task.cost : 0,
    });
    if (json?.status_code !== 20000) return null;
    const items = task?.result?.[0]?.items;
    const text = harvestText(items).join("\n").trim();
    return text || null;
  } catch {
    return null;
  }
}
