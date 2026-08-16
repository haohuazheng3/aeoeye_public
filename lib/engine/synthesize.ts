import { runTool, LLM_MODEL_CHEAP } from "@/lib/anthropic";
import type {
  CompetitorStat,
  EngineSummary,
  GapQuestion,
  Recommendation,
  SeoModule,
  SiteAudit,
  VisibilityProbe,
} from "./types";

const TOOL = {
  name: "submit_synthesis",
  description: "Submit the verdict, gap explanations and a prioritized improvement plan for this brand's AI visibility.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "The verdict the brand owner reads first. HARD LIMIT: 2 sentences, 220 characters total. " +
          "Name the specific thing that happened (who AI recommended instead, which question was lost) — concrete beats sweeping. " +
          "No fluff, no generic SEO speak, no throat-clearing like 'Overall, the analysis shows'. " +
          "It must not contradict the retrieval findings shown to you — when search-mode already recommends the brand, never call it invisible.",
      },
      gapReasons: {
        type: "array",
        description:
          "For each gap question (by index), why AI didn't pick this brand. HARD LIMIT: one sentence, 110 characters. " +
          "Give the actual cause, not a restatement of the gap.",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, why: { type: "string" } },
          required: ["index", "why"],
        },
      },
      recommendations: {
        type: "array",
        description:
          "The FINAL consolidated fix roadmap for this brand — it must absorb every distinct problem across BOTH " +
          "the AI-visibility data AND the SEO foundation findings below, most impactful first. " +
          "No fixed count: output ONE item per distinct root cause you can actually point to in the data — " +
          "as many as the evidence supports, and no more. Merge duplicates: when a foundation finding and a " +
          "visibility gap share one root cause, write ONE action that fixes both and say so. " +
          "Padding is a failure: an invented action is worse than a shorter list. " +
          "If this brand genuinely has very few real problems, fill in with honest 'keep doing / monitor this' " +
          "items that name what is already working — never with fabricated problems. " +
          "The first 2 must be the highest-impact quick wins (they are the only ones shown in the free preview); " +
          "everything after them goes into the paid report and must be equally specific — no filler.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short imperative, max 60 characters, e.g. 'Publish a comparison page vs <competitor>'.",
            },
            detail: {
              type: "string",
              description:
                "HARD LIMIT: one sentence, 160 characters. Exactly what to do and why it moves AI visibility. " +
                "Name the page, the competitor or the schema type — a sentence that would fit any brand is a failed sentence.",
            },
            impact: { type: "string", enum: ["high", "medium", "low"] },
            effort: { type: "string", enum: ["quick", "moderate", "involved"] },
            category: {
              type: "string",
              enum: ["content", "structured-data", "authority", "presence", "technical"],
            },
          },
          required: ["title", "detail", "impact", "effort", "category"],
        },
      },
    },
    required: ["summary", "recommendations"],
  },
};

export async function synthesize(input: {
  brand: string;
  category: string;
  positioning: string;
  overallScore: number;
  engines: EngineSummary[];
  competitors: CompetitorStat[];
  gaps: GapQuestion[];
  site?: SiteAudit;
  /** 阶梯层级 —— 与问答矩阵同源推导。裁决必须与它一致,否则报告自相矛盾 */
  visibility?: VisibilityProbe;
  /** 地基层五模块(付费升级时传入)。roadmap 是最终汇总,必须吸收这些发现 */
  foundationModules?: SeoModule[];
  model?: string;
}): Promise<{ summary: string; gaps: GapQuestion[]; recommendations: Recommendation[] }> {
  const engineLines = input.engines
    .filter((e) => e.status === "ok")
    .map((e) => `- ${e.label}: mentioned in ${e.questionsMentioned}/${e.questionsAsked} (${e.mentionRate}%), avg rank ${e.avgRank ?? "—"}, visibility ${e.visibilityScore}/100`)
    .join("\n");
  const compLines = input.competitors
    .slice(0, 8)
    .map((c) => `- ${c.name}: recommended in ${c.appearsInQuestions} questions; beat you in ${c.winsVsYou}`)
    .join("\n");
  const gapLines = input.gaps
    .map((g, i) => `[${i}] (${g.intent}) "${g.question}" — AI recommended: ${g.competitorsPresent.join(", ") || "others"}`)
    .join("\n");
  const siteLines = input.site?.reachable
    ? input.site.signals.map((s) => `- ${s.label}: ${s.status}`).join("\n")
    : "Website not crawled / unreachable.";

  // 地基层发现原样列给模型 —— roadmap 是"一张单子讲完所有该修的事",
  // 这些不进 prompt 的话,付费报告里五个模块指出的问题就永远排不进修复计划。
  const foundationLines = (input.foundationModules ?? [])
    .filter((m) => (m.findings?.length ?? 0) > 0)
    .map(
      (m) =>
        `${m.label}${m.score != null ? ` (${m.score}/100)` : ""}: ${m.verdict}\n` +
        m.findings.map((f) => `  - [${f.severity}] ${f.title}: ${f.detail}`).join("\n")
    )
    .join("\n");

  // 阶梯层级与问答矩阵同源(同一批联网回答推导),所以裁决只有一套事实要遵守。
  const v = input.visibility;
  const LEVEL_MEANING: Record<number, string> = {
    1: "not findable at all — the brand never even appears in AI's search results",
    2: "findable but never recommended — AI can reach the site yet names other brands",
    3: "mentioned, but behind others and not consistently",
    4: "recommended first in most answers — but only after AI looks the brand up on the web",
    5: "in AI's memory — named without AI searching the web at all",
  };
  const memN = v?.memoryQuestions ?? 0;
  const visibilityLines = v
    ? [
        `Level ${v.level}/5 — ${LEVEL_MEANING[v.level]}.`,
        `- Named in ${v.searchMentionRate ?? 0}% of the buyer questions${v.searchAvgRank != null ? `, average position #${v.searchAvgRank} among the options AI listed` : ""}.`,
        `- Site appears in AI's real search results: ${v.retrievable === true ? "yes" : v.retrievable === false ? "no" : "could not be verified"}.`,
        // AI 自行决定要不要搜 —— 没搜就作答的题是"记忆层"的唯一证据
        memN > 0
          ? `- On ${memN} question${memN === 1 ? "" : "s"} AI answered from its own knowledge without searching; it named the brand in ${v.memoryMentionRate ?? 0}% of those.`
          : `- AI chose to search the web on every question, so we have no evidence about whether it knows the brand unaided. Say nothing about what AI "remembers" or "knows without searching".`,
        v.pickedInstead.length ? `- Named instead of the brand: ${v.pickedInstead.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "(not measured)";

  let res: { summary?: string; gapReasons?: { index: number; why: string }[]; recommendations?: Recommendation[] };
  try {
    res = await runTool({
      model: input.model || LLM_MODEL_CHEAP,
      system:
        "You advise brands on Answer Engine Optimization (AEO) — getting recommended by ChatGPT, Claude, Gemini, Google AI and Perplexity. " +
        "Recommendations must be concrete and tailored to THIS brand, category and the gaps shown.\n" +
        "HOUSE STYLE — the reader is a founder scanning on a phone:\n" +
        "· Answer first. The point goes in the first clause, never after a wind-up.\n" +
        "· Respect every character limit in the schema. They are limits, not targets.\n" +
        "· Cut hedges ('may', 'could potentially', 'it's worth considering') and cut throat-clearing ('Overall', 'In summary', 'It appears that').\n" +
        "· One idea per sentence. If a sentence needs a semicolon, split it or drop half.\n" +
        "· Specific nouns beat adjectives: a competitor's name, a page, a schema type — not 'strong', 'robust', 'comprehensive'.",
      user:
        `Brand: ${input.brand}\nCategory: ${input.category}\nPositioning: ${input.positioning}\nOverall AI visibility score: ${input.overallScore}/100\n\n` +
        `HOW THIS WAS MEASURED — we asked an AI assistant these buyer questions exactly as a real buyer would, with web search available but left to the assistant's own judgement, and read what it recommended. Every number below comes from that same set of answers.\n\n` +
        `Per-engine performance:\n${engineLines || "(no live engine data)"}\n\n` +
        `Where the brand stands:\n${visibilityLines}\n\n` +
        `Competitors AI keeps recommending:\n${compLines || "(none detected)"}\n\n` +
        `Buyer questions where the brand was absent:\n${gapLines || "(none)"}\n\n` +
        `Website AEO signals:\n${siteLines}\n\n` +
        (foundationLines
          ? `SEO foundation audit findings (already verified against the live site — treat as ground truth, and make sure every distinct problem here gets an action in the roadmap):\n${foundationLines}\n\n`
          : "") +
        `Write the verdict, a one-line reason for each gap (by index), and the improvement plan.\n\n` +
        `VERDICT RULES — state only what the data above shows, and never contradict the level:\n` +
        `- The verdict must match the level. At level 4-5 the brand IS getting recommended — do not call it invisible, absent or unknown. At level 1-2 it is NOT getting recommended — do not imply it wins anything.\n` +
        `- "Appears in search results" is not "recommended". At level 2 the honest framing is: AI can reach the site and still names competitors instead. Do not soften that into "findable, so you're halfway there".\n` +
        `- Lead with the specific buyer question that was lost and who won it. Concrete beats general.\n` +
        `- Website signals (schema, llms.txt, FAQ markup) belong in the plan as fixes. Do not present a missing schema as the measured cause of a lost answer.\n` +
        `- Only claim AI "knows" or "remembers" the brand when the line above reports questions AI answered WITHOUT searching. If it searched every time, being named proves it is findable, not that it is known — never upgrade one into the other.\n` +
        `- Strong across the board: say so plainly, point at the remaining edge, do not manufacture alarm.`,
      tool: TOOL,
      // 汇总了地基层后条目可能到 15+,2000 会把 roadmap 尾部整段截掉
      maxTokens: input.foundationModules?.length ? 4000 : 2000,
      // 裁决与建议是给人读的文案,留一点自然度;事实约束靠上面的 VERDICT RULES 兜
      temperature: 0.3,
    });
  } catch {
    res = {};
  }

  const reasonMap = new Map((res.gapReasons || []).map((r) => [r.index, r.why]));
  const gaps = input.gaps.map((g, i) => ({ ...g, why: reasonMap.get(i) || g.why || "This page/topic isn't covered in a way AI can quote." }));

  // 条数按真实问题数走,没有配额:模型给几条就是几条,这里不会往上补。
  // 上限 18 只是防跑题的护栏(可见度侧 + 地基五模块全算上也到不了),
  // 不是目标值。免费预览始终只取前 2 条。
  const recommendations: Recommendation[] = (res.recommendations || [])
    .slice(0, 18)
    .map((r) => ({
      title: r.title,
      detail: r.detail,
      impact: r.impact,
      effort: r.effort,
      category: r.category,
    }));

  return {
    // 兜底文案同样要分模式,否则 AI 一搜就首推你的品牌会被写成 "almost none"
    summary: res.summary?.trim() || fallbackSummary(input.brand, input.category, input.overallScore, v),
    gaps,
    recommendations: recommendations.length ? recommendations : fallbackRecs(input.brand),
  };
}

/** 裁决兜底:必须与阶梯层级一致,否则头部裁决与阶梯当场打架 */
function fallbackSummary(brand: string, category: string, score: number, v?: VisibilityProbe): string {
  if (!v)
    return `When buyers ask AI about ${category}, ${brand} shows up in ${score >= 50 ? "some" : "almost none"} of the answers — competitors are taking the recommendations.`;
  const rate = v.searchMentionRate ?? 0;
  const rivals = v.pickedInstead.length ? v.pickedInstead.join(", ") : "competitors";
  if (v.level >= 5)
    return `AI knows ${brand} without looking it up — it named you from its own knowledge on ${v.memoryQuestions ?? 0} of the buyer questions about ${category}. That is the strongest position there is.`;
  if (v.level === 4)
    return (v.memoryQuestions ?? 0) === 0
      ? `AI recommends ${brand} for ${category} — named in ${rate}% of buyer questions — but it searched the web every single time. Nothing here shows AI knows you unaided.`
      : `AI already recommends ${brand} for ${category} — named in ${rate}% of buyer questions. The gap is the answers where ${rivals} still take the top spot.`;
  if (v.level === 3) return `AI does mention ${brand}, but only in ${rate}% of buyer questions and rarely at the top — ${rivals} get named ahead of you.`;
  if (v.level === 2) return `AI can reach your site and still recommends ${rivals} instead — ${brand} was named in none of the buyer questions we asked.`;
  return `${brand} never appeared in AI's answers about ${category} — not even in its search results. To AI, your brand effectively doesn't exist yet.`;
}

function fallbackRecs(brand: string): Recommendation[] {
  return [
    {
      title: "Add Organization & Product schema",
      detail: `Mark up who ${brand} is, what you sell and for whom, so AI can extract facts reliably.`,
      impact: "high",
      effort: "moderate",
      category: "structured-data",
    },
    {
      title: "Publish question-style content",
      detail: "Create pages that directly answer the high-intent questions buyers ask AI — these are what assistants quote.",
      impact: "high",
      effort: "moderate",
      category: "content",
    },
    {
      title: "Add an llms.txt file",
      detail: "Give AI crawlers a curated map of your most authoritative pages.",
      impact: "medium",
      effort: "quick",
      category: "technical",
    },
  ];
}
