import type { EngineQuestionResult, VisibilityProbe } from "./types";

/**
 * 可见度阶梯 —— 单一事实源版。
 *
 * 阶梯层级不再单独跑一套探测问答(旧版:矩阵不联网问 5 题、阶梯又联网重问 2 题,
 * 同一问题出现两种答案,报告自相矛盾)。现在 run.ts 只问一遍(带 web_search),
 * 分数、问答矩阵、缺口、竞品、阶梯全部从同一批判定行推导 —— 本文件是纯函数,零 API 调用。
 */

/** 搜索结果里是否命中目标品牌/域名(域名精确后缀匹配 + 品牌 token 命中 hostname/标题) */
export function brandHit(brand: string, domain: string, r: { url: string; title: string }): boolean {
  const b = brand.toLowerCase().trim();
  const compact = b.replace(/[^a-z0-9]/g, "");
  const title = (r.title || "").toLowerCase();
  let host = "";
  try {
    host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    /* 无效 URL 跳过 host 匹配 */
  }
  if (domain.includes(".") && (host === domain || host.endsWith(`.${domain}`))) return true;
  if (compact.length >= 3 && host.replace(/[^a-z0-9]/g, "").includes(compact)) return true;
  if (b.length >= 3 && title.includes(b)) return true;
  return false;
}

/**
 * 由判定行(与问答矩阵完全同一批)推导阶梯层级:
 *   5 = 记在 AI 脑子里:**在 AI 没有联网搜索的那些题里**依然点名你(唯一能证明记忆层的证据)
 *   4 = 首选推荐:≥50% 被提及且平均位次 ≤2.5
 *   3 = 有提及:至少一题提到你,但不靠前/不稳定
 *   2 = 搜得到不提你:真实搜索结果里出现你的站,但回答从不点名你
 *   1 = 隐身:连搜索结果里都没有你
 *
 * 第 5 层的门槛必须硬:只要这一题 AI 动用了搜索,它提到你就只能说明"搜得到",
 * 不能说明"记得住"。没有未搜索样本 ⇒ 记忆层未测到 ⇒ 最高只能判到第 4 层。
 * retrievable 读的是 web_search 工具返回的真实结果列表(客观证据,非 AI 自述)。
 */
export function computeVisibility(args: {
  rows: EngineQuestionResult[];
  retrievable: boolean | null;
  /** 这些题 AI 真的搜了网 —— 其余题才算记忆层样本 */
  searchedQuestionIds: Set<string>;
}): VisibilityProbe {
  const asked = args.rows.length || 1;
  const mentionedRows = args.rows.filter((r) => r.mentioned);
  const rate = Math.round((100 * mentionedRows.length) / asked);
  const ranks = mentionedRows.map((r) => r.rank).filter((r): r is number => r != null && r > 0);
  const avgRank = ranks.length ? Math.round((ranks.reduce((s, r) => s + r, 0) / ranks.length) * 10) / 10 : null;

  // 记忆层:AI 没搜就作答的那些题
  const memoryRows = args.rows.filter((r) => !args.searchedQuestionIds.has(r.questionId));
  const memoryMentioned = memoryRows.filter((r) => r.mentioned);
  const memoryRate = memoryRows.length
    ? Math.round((100 * memoryMentioned.length) / memoryRows.length)
    : null;
  const memoryRanks = memoryMentioned.map((r) => r.rank).filter((r): r is number => r != null && r > 0);
  const memoryAvgRank = memoryRanks.length
    ? Math.round((memoryRanks.reduce((s, r) => s + r, 0) / memoryRanks.length) * 10) / 10
    : null;

  let level: VisibilityProbe["level"];
  // 至少 2 个记忆层样本 + 其中稳定点名你,才敢说"AI 记得你"
  if (memoryRows.length >= 2 && memoryRate != null && memoryRate >= 80 && memoryMentioned.length >= 2) level = 5;
  else if (rate >= 50 && avgRank != null && avgRank <= 2.5) level = 4;
  else if (mentionedRows.length > 0) level = 3;
  // 第 1 层是全报告最重的一句话("AI 连搜都搜不到你"),只有**确证**才敢下:
  // retrievable=false 意味着我们拿到了完整搜索结果集、里面确实没有你。
  // null = 通道只回引用来源,无从否证 —— 这时保守判第 2 层,绝不诬陷成隐身。
  else if (args.retrievable === false) level = 1;
  else level = 2;

  // 你缺席的问题里最常被点名的竞品 —— 与矩阵同一套判定,天然一致
  const freq = new Map<string, { name: string; n: number }>();
  for (const r of args.rows.filter((x) => !x.mentioned)) {
    for (const raw of r.competitorsMentioned) {
      const name = (raw || "").trim();
      const k = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!k) continue;
      const e = freq.get(k) ?? { name, n: 0 };
      e.n += 1;
      freq.set(k, e);
    }
  }
  const pickedInstead = [...freq.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((e) => e.name);

  return {
    level,
    retrievable: args.retrievable,
    searchMentionRate: rate,
    searchAvgRank: avgRank,
    searchedQuestions: args.rows.length,
    pickedInstead,
    memoryQuestions: memoryRows.length,
    memoryMentionRate: memoryRate,
    memoryAvgRank,
    // 证据不单独存:阶梯直接引用问答矩阵的同一行(components/report/visibility-ladder.tsx)
    note:
      args.retrievable === null
        ? "This engine only reports the sources it cited, so we can't confirm either way whether search finds your site."
        : undefined,
  };
}
