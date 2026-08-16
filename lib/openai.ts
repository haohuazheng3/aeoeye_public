import { env } from "./env";
import { recordOpenAiCost } from "./cost";

/**
 * 工具名 → 人能读懂的环节名。usage 界面按环节分组,用户要看的是
 * "钱花在出题还是判卷上",不是 "submit_judgments 花了多少"。
 */
const STAGE_BY_TOOL: Record<string, string> = {
  submit_brand_brief: "Question generation",
  submit_questions: "Question generation",
  submit_judgments: "Answer judging",
  submit_synthesis: "Synthesis",
  emit_module: "SEO foundation",
  emit_solo_module: "SEO foundation",
};

export function stageForTool(toolName: string): string {
  return STAGE_BY_TOOL[toolName] ?? toolName;
}

/** responses 端点的 usage 形状(字段缺失时按 0 计,绝不猜) */
type Usage = { input_tokens?: number; output_tokens?: number };

export function billOpenAi(args: {
  model: string;
  stage: string;
  usage: Usage | undefined;
  output?: { type?: string }[];
}) {
  const searchCalls = (args.output ?? []).filter((o) => o?.type === "web_search_call").length;
  recordOpenAiCost({
    model: args.model,
    stage: args.stage,
    inputTokens: args.usage?.input_tokens ?? 0,
    outputTokens: args.usage?.output_tokens ?? 0,
    webSearchCalls: searchCalls,
  });
}

/**
 * OpenAI 侧的结构化调用 —— 只服务**免费报告的分析模型**(GPT-5.6 Luna)。
 *
 * 为什么不装 openai npm 包:只用到一个端点的 function calling,一个 fetch 就够;
 * 少一个依赖就少一类供应链/版本问题。
 *
 * 为什么是 /v1/responses 而不是 /v1/chat/completions:GPT-5.6 推理系在
 * chat/completions 里带 function tools 会被整单拒收(400,"use /v1/responses
 * or set reasoning_effort to 'none'",实测)。关推理等于白用 Luna —— 判卷
 * 质量就指着它的推理;所以走 responses 端点,推理照跑,工具照调。
 *
 * 接口刻意与 lib/anthropic.ts 的 runTool 同构(system/user/tool/…),这样 runTool
 * 能按模型名前缀把调用整体转发过来,所有分析代码(出题/判卷/汇总)一行不改。
 */

type ToolLike = {
  name: string;
  description: string;
  // Anthropic 的 InputSchema 就是标准 JSON Schema,直接可用作 parameters
  input_schema: Record<string, unknown> | object;
};

/**
 * 纯文本输出(可选联网)。地基层"各出一份独立分析"那一步用它:
 * 那步要的是有观点的长文点评,套 function calling 反而把模型框进字段里,
 * 出来的东西全是同一个模子 —— 融合时也就没有真正的第二视角了。
 * 失败返回空串:融合层会自动只用还活着的那几份,不会因此整个模块挂掉。
 */
export async function openaiText(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** 开着让模型自己决定要不要抓站核实(地基层需要,它得看得见真实页面) */
  webSearch?: boolean;
  /** 记账用的环节名 */
  stage?: string;
}): Promise<string> {
  if (!env.OPENAI_API) return "";
  const { model, system, user, maxTokens = 900, webSearch = false, stage = "Analysis" } = opts;
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API}` },
      body: JSON.stringify({
        model,
        instructions: system,
        input: user,
        // 推理 token 同吃这个预算 —— 给 2 倍,否则推理烧完正文为空
        max_output_tokens: Math.max(maxTokens * 2, 4096),
        ...(webSearch ? { tools: [{ type: "web_search" }] } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as {
      output_text?: string;
      output?: { type?: string; content?: { text?: string }[] }[];
      usage?: Usage;
    };
    billOpenAi({ model, stage, usage: data.usage, output: data.output });
    if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
    let text = "";
    for (const item of data.output ?? []) {
      for (const block of item.content ?? []) if (typeof block.text === "string") text += block.text;
    }
    return text.trim();
  } catch {
    return "";
  }
}

export async function openaiTool<T>(opts: {
  model: string;
  system: string;
  user: string;
  tool: ToolLike;
  maxTokens?: number;
  /** 推理系模型不接受采样参数,收下但不上传;可复现性靠强制工具 + 严格 schema */
  temperature?: number;
}): Promise<T> {
  if (!env.OPENAI_API) throw new Error("OPENAI_API is not configured");
  const { model, system, user, tool, maxTokens = 2048 } = opts;

  const body = {
    model,
    instructions: system,
    input: user,
    // 推理 token 也计入 max_output_tokens —— 预算给到 2 倍,下限 4096,
    // 避免推理吃光预算后 function_call 为空。
    max_output_tokens: Math.max(maxTokens * 2, 4096),
    // responses 端点的 function tool 是扁平结构(没有嵌套的 "function" 层)
    tools: [
      { type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema },
    ],
    tool_choice: { type: "function", name: tool.name },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.OPENAI_API}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const data = (await res.json()) as {
        output?: { type?: string; arguments?: string }[];
        usage?: Usage;
      };
      // 记账在解析之前:哪怕这次没拿到 function_call(下面会重试),token 也已经烧掉了。
      // 只给成功的调用记账 = 账单少算重试的钱。
      billOpenAi({ model, stage: stageForTool(tool.name), usage: data.usage, output: data.output });
      const call = (data.output ?? []).find((o) => o.type === "function_call");
      if (call?.arguments) return JSON.parse(call.arguments) as T;
      lastErr = new Error("no function_call in OpenAI response");
    } catch (e) {
      lastErr = e;
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  throw lastErr instanceof Error ? lastErr : new Error("openaiTool failed");
}
