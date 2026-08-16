import { runTool, LLM_MODEL_CHEAP } from "@/lib/anthropic";
import { truncate, excerptAroundBrand, stripMarkdown } from "@/lib/utils";
import type { EngineId, EngineQuestionResult, Sentiment } from "./types";

export type AnswerItem = {
  questionId: string;
  question: string;
  answer: string;
  /** 引擎这一题有没有联网搜(记忆层依据)—— 原样透传进判定行,判定层不碰它 */
  usedSearch?: boolean;
};

const JUDGE_TOOL = {
  name: "submit_judgments",
  description:
    "For each AI answer, judge how the target brand appears: whether it's mentioned, its rank among recommended options, sentiment, and which competitors are named.",
  input_schema: {
    type: "object" as const,
    properties: {
      judgments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            questionId: { type: "string" },
            mentioned: { type: "boolean", description: "Is the target brand named or clearly referenced in the answer?" },
            rank: {
              type: ["integer", "null"],
              description: "1-based position among the recommended options if mentioned, else null.",
            },
            sentiment: {
              type: "string",
              enum: ["positive", "neutral", "negative", "absent"],
              description: "How the brand is portrayed; 'absent' if not mentioned.",
            },
            competitorsMentioned: {
              type: "array",
              items: { type: "string" },
              description:
                "Named brands/products in this answer that are DIRECT COMPETITORS in the target's category — i.e. the same kind of product/tool/service a buyer would choose between. " +
                "Exclude the target brand. Exclude brands from unrelated categories (clothing, cosmetics, food, generic retailers, etc.) even when the answer names them. " +
                "Exclude general-purpose AI assistants and foundation models (ChatGPT, Claude, Gemini, Copilot, Perplexity, Llama, Ollama, etc.) unless the target itself is a general-purpose AI assistant — " +
                "an answer suggesting 'you could just ask ChatGPT' is not naming a category competitor. " +
                "If the answer names no real category competitor, return an empty array.",
            },
            mentionedDomain: {
              type: ["string", "null"],
              description:
                "ONLY when mentioned=true: the official website domain the answer attributes to that brand (e.g. 'example.com'). " +
                "Take it from the answer text/links if present; otherwise give the domain you are confident that named product actually uses. " +
                "Return null if the answer gives no domain and you are not confident — do NOT guess the target's domain.",
            },
            note: { type: "string", description: "Short note: e.g. how it's described, or who got recommended instead." },
          },
          required: ["questionId", "mentioned", "rank", "sentiment", "competitorsMentioned"],
        },
      },
    },
    required: ["judgments"],
  },
};

/** 判定一个引擎对一批问题的回答中目标品牌的表现 */
export async function judgeAnswers(args: {
  brand: string;
  domain: string;
  engine: EngineId;
  items: AnswerItem[];
  model?: string;
  category?: string;
  /** 品类校准锚:prepare 生成的同类竞品示例,判定"像不像这几个"来收竞品 */
  competitorsSeed?: string[];
  /** 回答摘录长度(付费报告存更长的原话) */
  excerptChars?: number;
  /** 用户输入的是网址(有确切域名)→ 用域名交叉核验,排除同名不同实体 */
  verifyDomain?: boolean;
}): Promise<EngineQuestionResult[]> {
  const { brand, domain, engine, items, category, competitorsSeed } = args;
  const excerptChars = args.excerptChars ?? 320;
  const usable = items.filter((i) => i.answer && i.answer.trim().length > 0);

  if (usable.length === 0) {
    return items.map((i) => emptyResult(engine, i, "No answer was returned by this engine."));
  }

  let judgments: Array<{
    questionId: string;
    mentioned: boolean;
    rank: number | null;
    sentiment: Sentiment;
    competitorsMentioned: string[];
    mentionedDomain?: string | null;
    note?: string;
  }> = [];

  try {
    const payload = usable
      .map(
        (i, n) =>
          `### Answer ${n + 1} (questionId: ${i.questionId})\nQ: ${i.question}\nA: ${truncate(i.answer, 1800)}`
      )
      .join("\n\n");
    const res = await runTool<{ judgments: typeof judgments }>({
      model: args.model || LLM_MODEL_CHEAP,
      system:
        "You are a precise analyst measuring a brand's visibility inside AI answers. Match the brand by name OR domain, including obvious variants. Only count it as mentioned if it actually appears. Rank = its position in the list of recommended options. Be strict and accurate — this drives a paid report.",
      user:
        `Target brand: "${brand}" (domain: ${domain})` +
        (category
          ? `\nCategory: ${category}\nOnly count brands as competitors if they compete in THIS category. Ignore brands from unrelated categories even if the answer recommends them.`
          : "") +
        (competitorsSeed?.length
          ? `\nKnown direct competitors (calibration examples): ${competitorsSeed.join(", ")}. ` +
            `A brand counts as a competitor ONLY if it does the same job as these — a buyer would choose between it and the target. ` +
            `Adjacent-category products (photo editors, beauty cameras, styling/outfit apps, generic platforms, research models) are NOT competitors even when the answer recommends them.`
          : "") +
        (args.verifyDomain
          ? `\n\nIDENTITY CHECK — the target is identified by its domain "${domain}". ` +
            `Different companies can share a name. When you mark mentioned=true, also fill mentionedDomain with the website the answer attributes to that name ` +
            `(from the answer text/links, or the domain you are confident that named product actually uses). Leave it null if you are unsure — never copy "${domain}" as a guess.`
          : "") +
        `\n\nJudge each answer below. Return one judgment per questionId.\n\n${payload}`,
      tool: JUDGE_TOOL,
      maxTokens: 2000,
    });
    judgments = res.judgments || [];
  } catch {
    // 判定失败时退化为"未提及"(保守,不伪造可见度)
    judgments = [];
  }

  const byId = new Map(judgments.map((j) => [j.questionId, j]));
  return items.map((i) => {
    const j = byId.get(i.questionId);
    const answer = usable.find((u) => u.questionId === i.questionId)?.answer || "";
    if (!j) return emptyResult(engine, i, answer ? "Could not analyze this answer." : "No answer returned.");

    // 身份核验:用户给了确切域名时,AI 所指品牌的域名必须对得上 —— 同名不同实体不算你
    let mentioned = !!j.mentioned;
    let note = j.note;
    if (mentioned && args.verifyDomain) {
      const said = normalizeDomain(j.mentionedDomain);
      if (said && !sameSite(said, domain)) {
        mentioned = false;
        note = `A different "${brand}" (${said}) was named — not your site.`;
      }
    }

    return {
      engine,
      questionId: i.questionId,
      question: i.question,
      usedSearch: i.usedSearch,
      // 被提及时以品牌名为中心截取,确保报告里的荧光高亮落在可见片段内;
      // 两条路径都先剥 Markdown —— 摘录在报告里按纯文本渲染,## 与 ** 会变成噪音
      answerExcerpt: mentioned
        ? excerptAroundBrand(answer, brand, excerptChars)
        : truncate(stripMarkdown(answer), excerptChars),
      // 原文单独存(封顶 6000)。付费解锁的重判/重摘只能以它为源 ——
      // 拿摘录当原文重判,是"付费报告 Claude 只有 240 字"事故的根因。
      answerFull: answer ? answer.slice(0, 6000) : undefined,
      mentioned,
      rank: mentioned && typeof j.rank === "number" ? j.rank : null,
      sentiment: mentioned ? ((j.sentiment as Sentiment) || "neutral") : "absent",
      competitorsMentioned: (j.competitorsMentioned || []).filter(Boolean).slice(0, 8),
      note,
    } satisfies EngineQuestionResult;
  });
}

/** 取裸域名:去协议/路径/www/端口,小写 */
function normalizeDomain(raw?: string | null): string {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "";
  const host = s
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .split(":")[0]
    .trim();
  return host.includes(".") ? host : "";
}

/**
 * 是否同一站点:完全相同,或互为子域(app.x.com ↔ x.com),
 * 或仅 TLD 不同的同名站(brand.com ↔ brand.io —— 常见的多域名同品牌)。
 */
function sameSite(a: string, b: string): boolean {
  const x = normalizeDomain(a);
  const y = normalizeDomain(b);
  if (!x || !y) return false;
  if (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)) return true;
  const root = (d: string) => d.split(".").slice(0, -1).join(".") || d;
  return root(x) === root(y);
}

function emptyResult(engine: EngineId, i: AnswerItem, note: string): EngineQuestionResult {
  return {
    engine,
    questionId: i.questionId,
    question: i.question,
    usedSearch: i.usedSearch,
    answerExcerpt: truncate(stripMarkdown(i.answer || ""), 240),
    mentioned: false,
    rank: null,
    sentiment: "absent",
    competitorsMentioned: [],
    note,
  };
}
