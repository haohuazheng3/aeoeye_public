import type { AuditResult, VisibilityProbe } from "@/lib/engine/types";
import { HighlightedText } from "./highlight";
import { excerptAroundBrand } from "@/lib/utils";

/**
 * AI 可见度阶梯 —— 5 层竖轨阶梯,按机制分层(检索层 → 记忆层),一眼看清
 * "我在哪一层、上面还有几层"。层级判定在引擎侧(lib/engine/probe.ts),
 * 与问答矩阵同一批回答推导。第 5 层门槛最硬:必须是 AI **压根没联网搜索**
 * 就点名了你,才算"记在脑子里";只要它搜了,再靠前也只到第 4 层。
 */
const LEVELS = [
  {
    n: 1,
    name: "Invisible",
    blurb: "You don't even appear in AI's search results. To AI, your brand doesn't exist.",
    next: "get findable — fix crawlability and indexing so AI can see your site at all.",
  },
  {
    n: 2,
    name: "Found, not picked",
    blurb: "AI can reach your site — and still names other brands in its answers.",
    next: "give AI a reason to pick you: comparisons, reviews, clear positioning.",
  },
  {
    n: 3,
    name: "Mentioned",
    blurb: "AI mentions you, but behind others and not every time.",
    next: "build authority so AI ranks you above the brands it names first.",
  },
  {
    n: 4,
    name: "Top pick",
    blurb: "AI recommends you first — after it looks you up on the web.",
    next: "get known well enough that AI names you without searching first.",
  },
  {
    n: 5,
    name: "In AI's memory",
    blurb: "AI names you without searching at all. It simply knows you. Peak visibility.",
    next: "",
  },
];

/** 旧报告(无 visibility 字段)降级:旧 matrix 即知识模式,强 → 5,有提及 → 3,零提及 → 1 */
function legacyLevel(result: AuditResult): 1 | 3 | 5 {
  const live = result.engines.filter((e) => e.status === "ok");
  if (live.length === 0) return 1;
  const rate = live.reduce((s, e) => s + e.mentionRate, 0) / live.length;
  const ranks = live.map((e) => e.avgRank).filter((r): r is number => r != null && r > 0);
  const avgRank = ranks.length ? ranks.reduce((s, r) => s + r, 0) / ranks.length : null;
  if (rate <= 0) return 1;
  if (rate >= 60 && avgRank != null && avgRank <= 2.5) return 5;
  return 3;
}

/** 当前层的证据行 —— 一句客观数据,全部来自问答矩阵同一批回答 */
function evidenceLine(v: VisibilityProbe): string {
  // 旧报告(双源探测时代)没有 searchMentionRate,降级用 knowledgeMentionRate
  const rate = v.searchMentionRate ?? v.knowledgeMentionRate ?? 0;
  const rank = v.searchAvgRank != null ? `, average position #${v.searchAvgRank}` : "";
  const rivals = v.pickedInstead.join(", ");
  if (v.level === 5) {
    const n = v.memoryQuestions ?? 0;
    return n
      ? `On ${n} question${n === 1 ? "" : "s"} AI didn't search the web at all — and still named you.`
      : `Named in ${rate}% of buyer questions${rank}.`;
  }
  if (v.level === 4) {
    const base = `Named in ${rate}% of buyer questions${rank}.`;
    // 说清这是"搜过之后"的成绩 —— 否则用户会以为 AI 本来就认识他
    if ((v.memoryQuestions ?? 0) === 0) return `${base} AI looked you up every time — it never answered from memory.`;
    return v.memoryMentionRate === 0
      ? `${base} But on the questions AI answered without searching, it never named you.`
      : base;
  }
  if (v.level === 3)
    return rivals ? `Named in ${rate}% of questions — but AI leads with ${rivals}.` : `Named in ${rate}% of questions, not at the top.`;
  if (v.level === 2)
    return rivals
      ? `AI can reach your site — it recommended ${rivals} instead.`
      : "AI can reach your site — it never named you in an answer.";
  return v.retrievable === false
    ? "Your site never appeared in AI's search results."
    : "AI never named you, and we couldn't confirm your site is reachable.";
}

export function VisibilityLadder({ result }: { result: AuditResult }) {
  const v = result.visibility;
  const rawLevel = v?.level ?? legacyLevel(result);
  // 存量报告保守降级:有一批报告是"每题强制联网"时期生成的,它们的第 5 层
  // 只证明了"搜得到并排第一",没有任何记忆层证据(既无 memoryQuestions,
  // 也无更早双源时代的 knowledgeMentionRate)。宁可少判一层,不虚报。
  const level =
    rawLevel === 5 && v && v.memoryQuestions == null && v.knowledgeMentionRate == null ? 4 : rawLevel;
  const rows = [...LEVELS].reverse(); // 第 5 层在上 —— 用户从下往上爬

  // 层级证据 = 问答矩阵里"真的提到你"的那一行原文,与下方 The questions, the answers
  // 读的是同一份数据。绝不引入第二来源:旧版阶梯独立存 evidence,导致同一个问题
  // 上方展示"推荐了你"、下方展示"Absent",报告自相矛盾。
  const brandLower = result.brand.toLowerCase();
  const evidence =
    level >= 3
      ? (result.matrix
          .filter((m) => m.engine === "chatgpt" && m.mentioned && m.answerExcerpt)
          .map((m) => ({ question: m.question, answer: m.answerExcerpt }))
          .find((e) => e.answer.toLowerCase().includes(brandLower)) ?? null)
      : null;

  return (
    <div className="card p-7 sm:p-8">
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Where you stand</p>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
              How far AI recommends you
            </h2>
          </div>
          <span className="rounded-full bg-ink/[0.06] px-4 py-2 font-display text-sm font-bold text-ink">
            Level {level} <span className="font-medium text-ink/45">/ 5</span>
          </span>
        </div>

        <ol className="relative mt-7 space-y-1.5">
          {/* 阶梯竖轨(串起层级;只有当前层浮起为玻璃模块) */}
          <span aria-hidden className="absolute bottom-8 left-[33px] top-8 w-px bg-ink/10" />
          {rows.map((lv) => {
            const isCurrent = lv.n === level;
            const passed = lv.n < level;
            return (
              <li
                key={lv.n}
                className={`relative flex items-start gap-4 p-4 ${
                  isCurrent ? "surface shadow-float ring-2 ring-ink/70" : ""
                }`}
              >
                <span
                  className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
                    isCurrent
                      ? "text-white shadow-[0_6px_16px_-4px_rgba(12,14,22,0.45)]"
                      : passed
                        ? "border border-ink/25 bg-white text-ink/55"
                        : "border border-ink/10 bg-white text-ink/35"
                  }`}
                  style={
                    isCurrent ? { backgroundImage: "linear-gradient(180deg, #242a40, #0c0e16 62%)" } : undefined
                  }
                >
                  {lv.n}
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`font-semibold ${isCurrent ? "text-ink" : passed ? "text-ink/60" : "text-ink/40"}`}>
                      {lv.name}
                    </p>
                    {isCurrent && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                        style={{ backgroundImage: "linear-gradient(180deg, #242a40, #0c0e16 62%)" }}
                      >
                        {"You're here"}
                      </span>
                    )}
                  </div>
                  <p className={`mt-0.5 text-sm ${isCurrent ? "text-ink/60" : "text-ink/40"}`}>{lv.blurb}</p>
                  {isCurrent && v && <p className="mt-2 text-xs font-medium text-ink/70">{evidenceLine(v)}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        {/* 证据:AI 的真实回答,荧光笔只标你的品牌名(仅 L3+ 展示) */}
        {evidence && (
          <div className="surface mt-5 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/40">
                What the AI actually said
              </p>
              {/* 标出荧光对应的确切实体 —— 同名品牌很常见,域名让用户确认"这就是我" */}
              <span className="flex items-center gap-1.5 text-[11px] text-ink/45">
                <span className="h-2 w-2 rounded-full bg-mint/70" />
                {result.brand}
                {result.domain ? <span className="text-ink/35">· {result.domain}</span> : null}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium text-ink/70">“{evidence.question}”</p>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              {/* 再围绕品牌名开一次窗 —— 兜底旧报告(它们存的是回答开头,可能不含品牌名) */}
              <HighlightedText text={excerptAroundBrand(evidence.answer, result.brand, 300)} brand={result.brand} />
            </p>
          </div>
        )}

        {level < 5 && (
          <p className="mt-5 rounded-2xl bg-ink/[0.03] px-4 py-3 text-sm leading-relaxed text-ink/60">
            <span className="font-semibold text-iris">Next level</span> — {LEVELS[level - 1].next}
          </p>
        )}
      </div>
    </div>
  );
}
