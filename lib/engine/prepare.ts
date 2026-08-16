import { runTool, LLM_MODEL_CHEAP } from "@/lib/anthropic";
import type { Question } from "./types";
import { shortId } from "@/lib/utils";

export type Prepared = {
  brand: string;
  category: string;
  positioning: string;
  competitorsSeed: string[];
  questions: Question[];
};

const TOOL = {
  name: "submit_brand_brief",
  description:
    "Submit the resolved brand profile and the high-intent questions real buyers ask AI assistants in this category.",
  input_schema: {
    type: "object" as const,
    properties: {
      brand: { type: "string", description: "The brand/company/product name, properly capitalized." },
      category: {
        type: "string",
        description: "Concise market category, e.g. 'project management software', 'organic dog food', 'CRM for startups'.",
      },
      positioning: { type: "string", description: "One sentence on what this brand offers and for whom." },
      competitorsSeed: {
        type: "array",
        items: { type: "string" },
        description: "5–8 well-known competitors or alternatives in this exact category (brand names only).",
      },
      questions: {
        type: "array",
        description:
          "PRODUCT-SELECTION questions real buyers type into ChatGPT/Perplexity/Google AI when choosing a product/tool/service in THIS EXACT category. " +
          "HARD TEST — before writing each question, ask yourself: 'would the natural answer be a list of NAMED companies/products?' If the honest answer is a paragraph of explanation instead, rewrite the question. " +
          "Good shapes: 'best <category> for <use case>', '<named competitor> alternatives', 'top-rated <category> in <place>', 'which <category> is most accurate', '<named brand A> vs <named brand B>'. " +
          "In a 'X vs Y' question, X and Y must be SPECIFIC NAMED BRANDS — never two approaches, methods, formats or sub-categories " +
          "(bad: 'live chef catering vs platter catering', 'AI rating vs traditional rating'). Those get answered with an explanation and name nobody, which measures nothing. " +
          "NEVER write generic self-help or how-to questions about the underlying problem (e.g. 'how do I improve my X?', 'what's the fastest way to fix X?') — those make the AI recommend unrelated consumer goods instead of real category competitors. " +
          "Natural, specific, varied. Do NOT mention the target brand by name.",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            intent: { type: "string", enum: ["high", "medium"] },
            persona: { type: "string", description: "Who is asking, e.g. 'solo founder', 'marketing manager'." },
          },
          required: ["text", "intent"],
        },
      },
    },
    required: ["brand", "category", "positioning", "competitorsSeed", "questions"],
  },
};

/**
 * 出题红线:问题里不许出现被审计的品牌名/域名。
 *
 * 实测事故:一轮审计生成了 "Real World Appeal vs Photofeeler" —— 问题自己把
 * 品牌递给了 AI,五个引擎全在这题"提及",分数被抬了 17 分(24F → 41D)。
 * 那不是 AI 推荐了它,是导航型查询,只有已知道品牌的人才会这么搜,
 * 与产品承诺的 "asked blind, without naming you" 直接矛盾。
 * 提示词里早有这条规则但模型照样漏 —— 自觉不可靠,必须代码闸。
 */
function leaksBrand(text: string, brand: string, domain?: string): boolean {
  const t = text.toLowerCase();
  const b = brand.trim().toLowerCase();
  if (b.length >= 3 && t.includes(b)) return true;
  // 域名主体(realworldappeal.com → realworldappeal)与整域名都算泄漏
  const base = (domain || "").toLowerCase().replace(/^www\./, "");
  const stem = base.split(".")[0];
  if (base && t.includes(base)) return true;
  if (stem.length >= 5 && t.includes(stem)) return true;
  return false;
}

/**
 * 一次调用解析品牌画像 + 生成买家问题。
 * @param count 期望问题数(免费 6 / 完整 18)
 */
export async function prepare(input: {
  rawInput: string;
  domain?: string;
  homeTitle?: string;
  homeDescription?: string;
  homeSnippet?: string;
  count: number;
  model?: string;
  /**
   * 品类锚(同域名上一次审计的 category)。不锚定时,两轮审计会各自措辞品类
   * ("assessment tools" vs "rating tools for men"),题目整批漂移,分数不可比。
   */
  categoryHint?: string;
}): Promise<Prepared> {
  const ctx: string[] = [`User input: ${input.rawInput}`];
  if (input.domain) ctx.push(`Domain: ${input.domain}`);
  if (input.homeTitle) ctx.push(`Homepage title: ${input.homeTitle}`);
  if (input.homeDescription) ctx.push(`Homepage description: ${input.homeDescription}`);
  if (input.homeSnippet) ctx.push(`Homepage content:\n${input.homeSnippet}`);
  if (input.categoryHint)
    ctx.push(
      `Established category (from this domain's previous audit — reuse it VERBATIM as the category unless the site has clearly pivoted): ${input.categoryHint}`
    );

  const result = await runTool<{
    brand: string;
    category: string;
    positioning: string;
    competitorsSeed: string[];
    questions: { text: string; intent: "high" | "medium"; persona?: string }[];
  }>({
    model: input.model || LLM_MODEL_CHEAP,
    system:
      "You are an expert in AI search (answer engine optimization). You map a brand to its exact product category and generate the questions buyers ask AI assistants when they are SHOPPING FOR A PRODUCT IN THAT CATEGORY. " +
      "Critical rule: every question must be one where a good AI answer names specific competing products/tools in the same category — never a general-advice question. " +
      "Be accurate and specific to the actual category. Generate exactly the requested number of questions.",
    user:
      `${ctx.join("\n")}\n\nResolve the brand and produce exactly ${input.count} buyer questions. ` +
      `If the input is only a name with no site, infer the most likely category from the name and general knowledge.\n\n` +
      `HARD REQUIREMENT — before writing each question, test it: "Would ChatGPT answer this with a shortlist of named products in this exact category?" ` +
      `If the answer would instead be generic advice, lifestyle tips, or unrelated consumer goods (clothing, cosmetics, food, apps from another category), REWRITE the question as a product-selection question. ` +
      `The competitors named in competitorsSeed are the kind of brands the answers should surface.`,
    tool: TOOL,
    maxTokens: 1600,
  });

  const brand = result.brand?.trim() || input.rawInput;
  const category = (input.categoryHint || result.category)?.trim() || "your category";

  // 红线过滤:点名品牌/域名的题一律丢弃(见 leaksBrand 注释里的事故)
  let clean = (result.questions || []).filter((q) => !leaksBrand(q.text || "", brand, input.domain));
  const dropped = (result.questions || []).length - clean.length;

  // 被丢了题且不够数 → 一次补题(明示禁令与已收题目);仍不够就带着少几题走,
  // 宁可题少也不能让点名题混进测量。
  if (dropped > 0 && clean.length < input.count) {
    const more = await extraQuestions({
      brand,
      domain: input.domain,
      category,
      need: input.count - clean.length,
      existing: clean.map((q) => q.text),
      model: input.model,
    });
    clean = clean.concat(more.map((q) => ({ text: q.text, intent: q.intent, persona: q.persona })));
  }

  const questions: Question[] = clean.slice(0, input.count).map((q) => ({
    id: shortId(8),
    text: q.text,
    intent: q.intent === "medium" ? "medium" : "high",
    persona: q.persona,
    category,
  }));

  return {
    brand,
    category,
    positioning: result.positioning?.trim() || "",
    competitorsSeed: (result.competitorsSeed || []).slice(0, 8),
    questions,
  };
}

/**
 * 在已有题目之外再出 N 道**不重复**的买家问题。
 *
 * 两个用途:① prepare 内部被红线过滤后补齐;② 付费解锁时把免费轮的 3 题
 * 扩到 10 题 —— 免费那几题必须原样留着(用户读过、chatgpt 行也直接沿用),
 * 所以只能"增补",不能重新出一整套。
 *
 * 失败返回空数组:题少一点还是真实测量,硬凑出来的题会污染整份报告。
 */
export async function extraQuestions(input: {
  brand: string;
  domain?: string;
  category: string;
  need: number;
  existing: string[];
  model?: string;
}): Promise<Question[]> {
  if (input.need <= 0) return [];
  try {
    const res = await runTool<{ questions: { text: string; intent: "high" | "medium"; persona?: string }[] }>({
      model: input.model || LLM_MODEL_CHEAP,
      system:
        "You generate additional buyer questions for an AI-visibility audit. Each must be a product-selection question a real buyer would ask an AI assistant — the kind whose honest answer is a shortlist of named products in this exact category.",
      user:
        `Category: ${input.category}\n` +
        `ABSOLUTE RULE: never mention the brand "${input.brand}"${input.domain ? ` or the domain ${input.domain}` : ""} — the audit asks blind.\n` +
        (input.existing.length
          ? `Already asked (cover DIFFERENT use cases, personas and buying angles — no near-duplicates):\n${input.existing
              .map((t) => `- ${t}`)
              .join("\n")}\n\n`
          : "") +
        `Produce exactly ${input.need} more question(s).`,
      tool: {
        name: "submit_questions",
        description: "Submit additional buyer questions.",
        input_schema: {
          type: "object" as const,
          properties: { questions: TOOL.input_schema.properties.questions },
          required: ["questions"],
        },
      },
      maxTokens: 1200,
    });
    return (res.questions || [])
      .filter((q) => q?.text && !leaksBrand(q.text, input.brand, input.domain))
      .slice(0, input.need)
      .map((q) => ({
        id: shortId(8),
        text: q.text,
        intent: q.intent === "medium" ? ("medium" as const) : ("high" as const),
        persona: q.persona,
        category: input.category,
      }));
  } catch {
    return [];
  }
}
