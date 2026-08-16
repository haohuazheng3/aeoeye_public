import { env } from "@/lib/env";
import { LLM_MODEL_ENGINE_GPT } from "@/lib/anthropic";
import { billOpenAi } from "@/lib/openai";
import type { SearchProbeResult } from "./types";

/**
 * 受测 ChatGPT 引擎 —— 免费报告的**唯一**问答通道,付费报告的 ChatGPT 行也来自这里。
 *
 * 为什么直连 OpenAI 而不是走 DataForSEO:
 *   1. 免费审计每天要跑很多次,不能烧 DataForSEO 余额(全程红线 $3);
 *   2. 只有直连才拿得到**工具层面的客观证据** —— 它到底搜没搜、引用了谁。
 *      DataForSEO 只回正文,搜索行为不可见,阶梯的记忆层就没了依据。
 *
 * 模型固定在免费 ChatGPT 用户默认那一档(Luna)。调强 = 伪造用户体验。
 *
 * ⚠️ **证据强度**(必须如实对待):OpenAI 的 responses 只回**被引用**的来源
 *   (url_citation),不是完整搜索结果集。引用里有你 ⇒ 确证搜得到;引用里没有你
 *   ⇒ **未知**(可能搜到了没引用),绝不能推成"搜不到你"。所以 resultScope 恒为
 *   "cited",run.ts 据此把 retrievable 留成 null 而不是 false。
 */

type OutputItem = {
  type?: string;
  action?: { type?: string; query?: string; sources?: unknown };
  content?: { type?: string; text?: string; annotations?: unknown[] }[];
};

/** 空回答整体重试一次:空答案不是数据,是故障 —— 原样落库会变成"这一格没内容" */
export async function gptSearchAnswer(
  question: string,
  opts: { model?: string } = {}
): Promise<SearchProbeResult> {
  const first = await gptSearchOnce(question, opts);
  if (first.text.trim()) return first;
  const second = await gptSearchOnce(question, opts);
  return second.text.trim() ? second : first;
}

const SYSTEM =
  "You are a helpful AI assistant answering a real person's question. " +
  "Decide for yourself whether to search the web: if you can already name specific real options from your own knowledge, answer directly without searching. " +
  "Search only when the question needs current, local or fast-changing facts, or when you are not confident naming real options yourself. " +
  "When they ask for the best / recommended / top options, give a concrete shortlist of 4–6 SPECIFIC, NAMED brands, products, tools or companies with a few words on each. Be decisive.";

/**
 * 内置工具的类型名换过一轮(web_search_preview → web_search)。名字被拒时整单 400,
 * 会让整条免费审计挂掉 —— 所以按新名先发,被拒再退回旧名,最后退到不带搜索。
 * 不带搜索也是**如实**的:usedSearch=false,阶梯只会把它当记忆层样本,不会伪造检索证据。
 */
const TOOL_VARIANTS: (Record<string, unknown> | null)[] = [
  { type: "web_search" },
  { type: "web_search_preview" },
  null,
];

async function gptSearchOnce(
  question: string,
  opts: { model?: string } = {}
): Promise<SearchProbeResult> {
  const empty: SearchProbeResult = { ok: false, text: "", results: [], usedSearch: false, resultScope: "cited" };
  if (!env.OPENAI_API) return empty;
  const model = opts.model || LLM_MODEL_ENGINE_GPT;

  for (const tool of TOOL_VARIANTS) {
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API}` },
        body: JSON.stringify({
          model,
          instructions: SYSTEM,
          input: question,
          // 推理 token 也吃这个预算 —— 给足,否则推理烧完正文为空(会被误读成"没提到你")
          max_output_tokens: 2600,
          ...(tool ? { tools: [tool] } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const body = await res.text();
        // 工具名不认 ⇒ 换下一个变体;其余错误(限流/超载)当次失败,交给外层重试
        if (res.status === 400 && /web_search|tool/i.test(body)) continue;
        return empty;
      }

      const data = await res.json();
      billOpenAi({ model, stage: "Engine: ChatGPT", usage: data?.usage, output: data?.output });
      return parseResponse(data);
    } catch {
      // 网络/超时:换变体重试没意义,直接交回上层(gptSearchAnswer 会整体再跑一次)
      return empty;
    }
  }
  return empty;
}

function parseResponse(data: { output?: OutputItem[] }): SearchProbeResult {
  const results: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  let text = "";
  let usedSearch = false;

  for (const item of data.output ?? []) {
    // 只要发起过搜索(哪怕没结果),这一题就不能再当记忆层证据
    if (item.type === "web_search_call") {
      usedSearch = true;
      collectSources(item.action?.sources, results, seen);
      continue;
    }
    for (const block of item.content ?? []) {
      if (typeof block.text === "string") text += block.text;
      for (const a of block.annotations ?? []) {
        const ann = a as { type?: string; url?: string; title?: string };
        if (ann.type === "url_citation" && typeof ann.url === "string") {
          push(results, seen, ann.url, ann.title || "");
        }
      }
    }
  }

  return { ok: results.length > 0, text: text.trim(), results, usedSearch, resultScope: "cited" };
}

/** action.sources 的形状官方没锁死,能捞到 url 就捞,捞不到不影响主流程 */
function collectSources(raw: unknown, out: { url: string; title: string }[], seen: Set<string>) {
  if (!Array.isArray(raw)) return;
  for (const s of raw) {
    if (typeof s === "string") push(out, seen, s, "");
    else if (s && typeof s === "object") {
      const o = s as { url?: unknown; title?: unknown };
      if (typeof o.url === "string") push(out, seen, o.url, typeof o.title === "string" ? o.title : "");
    }
  }
}

function push(out: { url: string; title: string }[], seen: Set<string>, url: string, title: string) {
  if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
  seen.add(url);
  out.push({ url, title });
}
