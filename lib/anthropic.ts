import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { openaiTool, stageForTool } from "./openai";
import { recordAnthropicCost } from "./cost";

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  // Anthropic 偶发 429 / 529(overloaded) / 5xx 属可重试的瞬时错误。SDK 默认只重试 2 次、
  // 退避窗口太短(约 1.5–4s),扛不过几秒到十几秒的短时过载 —— 生产实测 529 overloaded
  // 让整条审计直接失败(报错 "We couldn't finish this audit")。提到 4 次(SDK 自带指数退避
  // + 尊重 retry-after),大幅降低瞬时过载导致的审计失败率。
  maxRetries: 4,
});

/* ------------------------------------------------------------------
   模型在本产品里有**两类完全不同**的角色,混成一个变量就是在污染测量:

   ┌ 分析层(判卷的人)—— 出题 / 判卷 / 汇总。越强越好。
   │   · 免费报告 FREE = GPT-5.6 Luna
   │   · 付费报告 FULL = GPT-5.6 Sol —— 免费页只承诺"最强档",不点名
   │
   └ 受测层(被考的人)—— 我们拿买家问题去问它,答案原样进报告。
       它代表"一个真实**免费**用户会得到什么",所以只能对标各家免费
       默认档:ChatGPT=Luna、Claude=Sonnet 5、Gemini=Flash、
       Perplexity=sonar。这里换成更强的模型 = 伪造用户
       体验,报告当场失真 —— 谁都不会拿 $20 订阅去验证你的免费报告。

   分层原则(站长 2026-08-09 拍板):
   · 免费 3 题,只测 ChatGPT(Luna 出题、Luna 作答、Luna 判卷)。
   · 付费 10 题 × 5 引擎,Sol 判卷;免费那 3 题的 ChatGPT 行**原样保留**
     ——用户在免费页读过的判定不换尺度,也不为同一批回答付第二遍钱。

   runTool 按模型名前缀路由:gpt- 走 OpenAI,其余走 Anthropic。
   ------------------------------------------------------------------ */

/** 付费报告的分析 / 判定 / 合成 —— 最强档(前端只说"最强",不点名) */
export const LLM_MODEL_FULL = env.LLM_MODEL_FULL || "gpt-5.6-sol";
/** 免费报告的分析 / 判定 / 合成 */
export const LLM_MODEL_FREE = env.LLM_MODEL_FREE || "gpt-5.6-luna";
/** 受测 ChatGPT 引擎 —— 必须等于真实免费 ChatGPT 用户默认那一档 */
export const LLM_MODEL_ENGINE_GPT = env.LLM_MODEL_ENGINE_GPT || "gpt-5.6-luna";
/** 受测 Claude 引擎 —— 必须等于真实免费 Claude 用户默认那一档 */
export const LLM_MODEL_ENGINE = env.LLM_MODEL_ENGINE || "claude-sonnet-5";
/** 兜底模型(调用方没显式指定时用;所有正式路径都显式传 model) */
export const LLM_MODEL_CHEAP = env.LLM_MODEL_CHEAP || "gpt-5.6-luna";

/** 从一次 tool_use 响应中取出工具入参(找不到返回 null) */
export function firstToolInput<T = unknown>(msg: Anthropic.Messages.Message): T | null {
  for (const block of msg.content) {
    if (block.type === "tool_use") return block.input as T;
  }
  return null;
}

type ToolDef = {
  name: string;
  description: string;
  input_schema: Anthropic.Messages.Tool.InputSchema;
};

/**
 * 强制模型调用某工具并返回其结构化入参。带一次重试。
 * 失败抛错(由上层兜底)。
 */
export async function runTool<T>(opts: {
  model?: string;
  system: string;
  user: string;
  tool: ToolDef;
  maxTokens?: number;
  /**
   * 默认 0 —— 审计是可复现的测量,不是创作。默认 1.0 时同一域名两次审计
   * 会生成不同问题、给出不同判定(实测 Notion 90A → 64C,差 26 分)。
   * 只有需要自然文案的合成步骤才该调高。
   */
  temperature?: number;
}): Promise<T> {
  const { system, user, tool, maxTokens = 2048, temperature = 0 } = opts;
  const model = opts.model || LLM_MODEL_FULL;
  // 分析层现在整层在 OpenAI —— 直接转发,调用方无感。
  // OPENAI_API 没配时才退到 Anthropic,免得整条审计挂掉。
  if (model.startsWith("gpt-")) {
    if (env.OPENAI_API) {
      return openaiTool<T>({ model, system, user, tool, maxTokens, temperature });
    }
    return runTool<T>({ ...opts, model: env.LLM_MODEL_ENGINE });
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: user }],
      });
      recordAnthropicCost({
        model,
        stage: stageForTool(tool.name),
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
      });
      const input = firstToolInput<T>(msg);
      if (input) return input;
      lastErr = new Error("no tool_use in response");
    } catch (e) {
      lastErr = e;
    }
    // 第一次失败后退避再试。SDK 已对 429/5xx/网络层做指数退避重试;这层额外兜住
    // "响应无 tool_use" 以及 SDK 重试耗尽后的再尝试,避免无间隔连打。
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  throw lastErr instanceof Error ? lastErr : new Error("runTool failed");
}
