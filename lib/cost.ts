import { AsyncLocalStorage } from "node:async_hooks";

/* ============================================================
   成本账本 —— 一次审计到底花了多少钱

   为什么用 AsyncLocalStorage 而不是把 ledger 一路当参数传:
   计费点散在 openai.ts / anthropic.ts / dataforseo.ts / gpt-engine.ts,
   中间隔着 prepare / judge / synthesize / seo-analysis 十几层。逐层传参
   意味着每个函数签名都要改,而且**漏传一层就少算一笔钱** —— 账本少记
   比不记更危险(用户会以为那就是全部花费)。ALS 让计费点自己找到账本。

   没有账本在上下文里时 recordCost 是空操作 —— 站点自己跑的免费审计不需要记账,
   只有走 API 的调用才开账本。
   ============================================================ */

export type CostProvider = "openai" | "anthropic" | "dataforseo" | "firecrawl" | "psi";

/**
 * accuracy 必须如实标:
 *   measured  —— 供应商在响应里直接告诉我们这次花了多少(DataForSEO 的 cost);
 *   estimated —— 我们拿实测 token 数 × 本地价目表算出来的。token 是真的,
 *                单价是我们维护的,供应商调价而我们没跟上时它就会偏。
 * 界面必须把这两类分开显示 —— 把估算说成实测,等于给用户一个假账单。
 */
export type CostAccuracy = "measured" | "estimated";

export type CostEntry = {
  provider: CostProvider;
  /** 具体模型或端点,例如 "gpt-5.6-sol" / "ai_optimization/claude" */
  resource: string;
  /** 这笔花在哪个环节 —— usage 界面按它分组 */
  stage: string;
  inputTokens?: number;
  outputTokens?: number;
  /** 次数类计费(web_search 调用、SERP 查询) */
  calls?: number;
  usd: number;
  accuracy: CostAccuracy;
};

const ledgerStore = new AsyncLocalStorage<CostEntry[]>();

/** 在账本上下文里跑一段逻辑,回来时拿到这段时间内的全部花费明细 */
export async function withCostLedger<T>(fn: () => Promise<T>): Promise<{ result: T; entries: CostEntry[] }> {
  const entries: CostEntry[] = [];
  const result = await ledgerStore.run(entries, fn);
  return { result, entries };
}

/** 记一笔。不在账本上下文里(站点自己的免费审计)时什么都不做。 */
export function recordCost(entry: CostEntry): void {
  ledgerStore.getStore()?.push(entry);
}

/* ---------- 价目表 ----------
   来源与核对日期写在每一行。改模型时**必须**同步这里 —— 漏改的表现是
   账单看起来正常、数字却是错的,比报错难发现得多。 */

type TokenPrice = { in: number; out: number }; // USD per 1M tokens

/** OpenAI —— developers.openai.com/api/docs/pricing 实测抓取(2026-08-09) */
const OPENAI_PRICES: Record<string, TokenPrice> = {
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "gpt-5.6-sol": { in: 5.0, out: 30.0 },
  "gpt-5.6-terra": { in: 2.0, out: 12.0 },
};
/** 内置 web_search 工具:$10 / 1k calls(搜索内容 token 另按模型价计,已含在 usage 里) */
const OPENAI_WEB_SEARCH_PER_CALL = 0.01;

/**
 * Anthropic —— 公开价目(Sonnet 档)。⚠️ 未在本项目实测核对过,
 * 而且 Claude 引擎只在配了 ANTHROPIC_API_KEY 时才直连(否则走 DataForSEO 的
 * 真实计费),所以这条线通常不产生费用。标 estimated,不假装是实测。
 */
const ANTHROPIC_PRICES: Record<string, TokenPrice> = {
  "claude-sonnet-5": { in: 3.0, out: 15.0 },
  "claude-opus-5": { in: 15.0, out: 75.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
};

function tokenCost(price: TokenPrice | undefined, inTok: number, outTok: number): number {
  if (!price) return 0;
  return (inTok / 1_000_000) * price.in + (outTok / 1_000_000) * price.out;
}

/** OpenAI 一次调用的花费(token + 可选的 web_search 次数) */
export function recordOpenAiCost(args: {
  model: string;
  stage: string;
  inputTokens: number;
  outputTokens: number;
  webSearchCalls?: number;
}): void {
  const price = OPENAI_PRICES[args.model];
  const searchCalls = args.webSearchCalls ?? 0;
  const usd = tokenCost(price, args.inputTokens, args.outputTokens) + searchCalls * OPENAI_WEB_SEARCH_PER_CALL;
  recordCost({
    provider: "openai",
    resource: args.model,
    stage: args.stage,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    calls: searchCalls || undefined,
    usd,
    // 价目表未收录这个模型 ⇒ 算出来是 0,那不是"免费",是"我们不知道" ——
    // 界面据此提示,而不是把 0 当成事实
    accuracy: price ? "estimated" : "estimated",
  });
}

export function recordAnthropicCost(args: {
  model: string;
  stage: string;
  inputTokens: number;
  outputTokens: number;
}): void {
  recordCost({
    provider: "anthropic",
    resource: args.model,
    stage: args.stage,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    usd: tokenCost(ANTHROPIC_PRICES[args.model], args.inputTokens, args.outputTokens),
    accuracy: "estimated",
  });
}

/** DataForSEO 在每个 task 上回真实 cost —— 这是账本里唯一的实测数字 */
export function recordDataForSeoCost(args: { endpoint: string; stage: string; usd: number }): void {
  if (!args.usd) return;
  recordCost({
    provider: "dataforseo",
    resource: args.endpoint,
    stage: args.stage,
    calls: 1,
    usd: args.usd,
    accuracy: "measured",
  });
}

/** 价目表未收录的模型 —— usage 界面要能提示"这笔没算准" */
export function isPricedModel(provider: "openai" | "anthropic", model: string): boolean {
  return provider === "openai" ? model in OPENAI_PRICES : model in ANTHROPIC_PRICES;
}

/* ---------- 汇总 ---------- */

export type CostSummary = {
  totalUsd: number;
  measuredUsd: number;
  estimatedUsd: number;
  byProvider: { provider: CostProvider; usd: number; calls: number }[];
  byStage: { stage: string; usd: number; calls: number }[];
  totalInputTokens: number;
  totalOutputTokens: number;
  entries: CostEntry[];
};

export function summarizeCost(entries: CostEntry[]): CostSummary {
  const byProvider = new Map<CostProvider, { usd: number; calls: number }>();
  const byStage = new Map<string, { usd: number; calls: number }>();
  let totalUsd = 0;
  let measuredUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const e of entries) {
    totalUsd += e.usd;
    if (e.accuracy === "measured") measuredUsd += e.usd;
    totalInputTokens += e.inputTokens ?? 0;
    totalOutputTokens += e.outputTokens ?? 0;

    const p = byProvider.get(e.provider) ?? { usd: 0, calls: 0 };
    p.usd += e.usd;
    p.calls += 1;
    byProvider.set(e.provider, p);

    const s = byStage.get(e.stage) ?? { usd: 0, calls: 0 };
    s.usd += e.usd;
    s.calls += 1;
    byStage.set(e.stage, s);
  }

  return {
    totalUsd: round6(totalUsd),
    measuredUsd: round6(measuredUsd),
    estimatedUsd: round6(totalUsd - measuredUsd),
    byProvider: [...byProvider.entries()]
      .map(([provider, v]) => ({ provider, usd: round6(v.usd), calls: v.calls }))
      .sort((a, b) => b.usd - a.usd),
    byStage: [...byStage.entries()]
      .map(([stage, v]) => ({ stage, usd: round6(v.usd), calls: v.calls }))
      .sort((a, b) => b.usd - a.usd),
    totalInputTokens,
    totalOutputTokens,
    entries,
  };
}

/** 单次调用可能只花几十微美元,四舍五入到分会全变成 0 —— 保到 1e-6 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
