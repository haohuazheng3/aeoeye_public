#!/usr/bin/env node
/**
 * 五个受测引擎的通道自检 —— `node scripts/verify-engines.mjs`
 *
 * 为什么需要它:改引擎通道时最危险的失败不是报错,是**静默返回空正文**。
 * 空正文会被判定层读成"这个 AI 没提到你",生成一份看起来正常、其实全错的报告。
 * 所以这里逐条通道发一次真实最小请求,把"到底回没回内容"打出来。
 *
 * ⚠️ 会产生真实 API 费用(每条通道一次极小请求,总计约 $0.01–0.05 量级)。
 * 只在改动引擎通道后跑,不要放进 CI。
 *
 * 读 .env.local(项目内)或 ../.env(站长的集中 env),不回显任何密钥。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const out = {};
  for (const p of [resolve(root, ".env.local"), resolve(root, "../.env")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !out[m[1]]) out[m[1]] = m[2].trim();
    }
  }
  return { ...out, ...process.env };
}

const env = loadEnv();
const Q = "What are the best project management tools for a small remote team?";
const results = [];

function report(channel, ok, detail) {
  results.push({ channel, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${channel.padEnd(22)} ${detail}`);
}

/* ---------- 1. ChatGPT(OpenAI 直连 + web_search)—— 免费报告的主引擎 ---------- */
async function checkOpenAI() {
  if (!env.OPENAI_API) return report("chatgpt (OpenAI)", false, "OPENAI_API 未配置");
  // 工具类型名换过一轮(web_search_preview → web_search),两个都试,报告哪个被接受
  for (const tool of [{ type: "web_search" }, { type: "web_search_preview" }]) {
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API}` },
        body: JSON.stringify({
          model: env.LLM_MODEL_ENGINE_GPT || "gpt-5.6-luna",
          instructions: "Answer briefly. Name 3 specific products.",
          input: Q,
          max_output_tokens: 2600,
          tools: [tool],
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 160);
        console.log(`   · tool "${tool.type}" 被拒(${res.status}): ${body}`);
        continue;
      }
      const data = await res.json();
      let text = "";
      let cited = 0;
      let searched = false;
      for (const item of data.output ?? []) {
        if (item.type === "web_search_call") searched = true;
        for (const b of item.content ?? []) {
          if (typeof b.text === "string") text += b.text;
          for (const a of b.annotations ?? []) if (a.type === "url_citation") cited++;
        }
      }
      return report(
        "chatgpt (OpenAI)",
        text.trim().length > 0,
        `tool="${tool.type}" 正文 ${text.trim().length} 字 · 搜索=${searched} · 引用 ${cited} 条`
      );
    } catch (e) {
      console.log(`   · tool "${tool.type}" 异常: ${e.message}`);
    }
  }
  report("chatgpt (OpenAI)", false, "两种 web_search 工具形态都不被接受 —— 引擎会降级成不联网作答");
}

/* ---------- 2-5. DataForSEO 侧四条通道 ---------- */
async function checkDfs() {
  if (!env.DATAFORSEO_B64) return report("dataforseo (4 engines)", false, "DATAFORSEO_B64 未配置");
  const auth = { Authorization: `Basic ${env.DATAFORSEO_B64}`, "Content-Type": "application/json" };

  const cases = [
    { name: "claude", slug: "claude", model: "claude-sonnet-5", maxTokens: true },
    { name: "gemini", slug: "gemini", model: "gemini-3.6-flash", maxTokens: true },
    { name: "perplexity", slug: "perplexity", model: "sonar", maxTokens: true },
  ];
  for (const c of cases) {
    try {
      const body = { user_prompt: Q, model_name: c.model, web_search: true };
      if (c.maxTokens) body.max_output_tokens = 700;
      const res = await fetch(`https://api.dataforseo.com/v3/ai_optimization/${c.slug}/llm_responses/live`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify([body]),
      });
      const json = await res.json();
      const task = json?.tasks?.[0];
      const cost = task?.cost ?? json?.cost ?? 0;
      if (json?.status_code !== 20000 || task?.status_code !== 20000) {
        report(`${c.name} (DataForSEO)`, false, `${task?.status_code} ${task?.status_message} · model=${c.model}`);
        continue;
      }
      const len = JSON.stringify(task?.result?.[0]?.items ?? "").length;
      report(`${c.name} (DataForSEO)`, len > 200, `model=${c.model} · 返回 ${len} 字节 · cost $${cost}`);
    } catch (e) {
      report(`${c.name} (DataForSEO)`, false, e.message);
    }
  }

  // Google AI Mode 走 SERP 端点,形态不同
  try {
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced", {
      method: "POST",
      headers: auth,
      body: JSON.stringify([{ keyword: Q, location_code: 2840, language_code: "en", device: "desktop" }]),
    });
    const json = await res.json();
    const task = json?.tasks?.[0];
    const len = JSON.stringify(task?.result?.[0]?.items ?? "").length;
    report("google_ai (DataForSEO)", len > 200, `返回 ${len} 字节 · cost $${task?.cost ?? 0}`);
  } catch (e) {
    report("google_ai (DataForSEO)", false, e.message);
  }
}

console.log("受测引擎通道自检 —— 会产生真实 API 费用\n");
await checkOpenAI();
await checkDfs();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 条通道可用`);
if (failed.length) {
  console.log("不可用:", failed.map((f) => f.channel).join(", "));
  console.log("→ 这些引擎会在报告里标成 inactive(不伪造结果),修好通道即自动恢复。");
}
process.exit(failed.some((f) => f.channel.startsWith("chatgpt")) ? 1 : 0);
