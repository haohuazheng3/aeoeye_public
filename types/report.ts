/* ============================================================
   AEOeye 引擎类型 —— 产品核心数据结构
   ============================================================ */

/**
 * 报告覆盖的五家回答引擎。**chatgpt 是主引擎** —— 免费报告只测它,
 * 付费报告在它之上再加另外四家(站长 2026-08-09 拍板)。
 */
export type EngineId = "chatgpt" | "claude" | "gemini" | "google_ai" | "perplexity";

export type EngineStatus = "ok" | "inactive" | "error";

/** 一次"拿买家问题去问某个引擎"的原始结果 */
export type SearchProbeResult = {
  ok: boolean; // 调用成功且至少拿到过搜索结果(可用于检索性判定)
  text: string; // AI 的最终回答
  results: { url: string; title: string }[]; // 真实搜索结果(客观证据,非 AI 自述)
  /**
   * 这一题 AI 是否真的动用了搜索。**记忆层判定的唯一依据** ——
   * 只有 usedSearch=false 的回答里提到你,才证明"AI 不联网也知道你"。
   */
  usedSearch: boolean;
  /**
   * results 是**完整搜索结果集**还是**只有被引用的来源**。
   *   full  —— 回的是整份结果列表:里面没有你 ⇒ 真的搜不到你。
   *   cited —— 只回引用来源:里面没有你 ⇒ 只说明没被引用,完全可能
   *            搜到了却没引用,**不能**推成"搜不到你"。
   * 这一位直接决定敢不敢把品牌判到阶梯第 1 层(Invisible)—— 全报告最重的一句话。
   */
  resultScope: "full" | "cited";
};

export type Sentiment = "positive" | "neutral" | "negative" | "absent";

/** 一个 AI 引擎对一个问题的回答 + 对目标品牌的判定 */
export type EngineQuestionResult = {
  engine: EngineId;
  questionId: string;
  question: string;
  answerExcerpt: string; // AI 回答节选(展示用,已截断)
  /**
   * 回答完整原文(上限 6000 字,免费轮就存)。
   * 教训:曾经只存 240 字摘录 → 付费解锁重判时只有摘录可用,还把摘录当"原文"
   * 保留 → 用户花 $29 看到的 Claude 回答只有 240 字、比别家短 4 倍。
   * 摘录归摘录,原文归原文 —— 判定和重摘必须从这里取。
   */
  answerFull?: string;
  /**
   * 这一题引擎有没有真的联网搜。**记忆层判定的唯一依据**。
   * 必须逐题存:付费解锁时免费那几题不重问(用户读过的判定不换尺度),
   * 阶梯要在 10 题上重算,老题的这一位只能来自免费轮存下来的值 ——
   * 不存就只能瞎猜"AI 是不是不联网也记得你",那是报告里最贵的一句话。
   * 旧报告没有这个字段(undefined),渲染时按"未知"降级处理。
   */
  usedSearch?: boolean;
  mentioned: boolean; // 是否提到目标品牌
  rank: number | null; // 在推荐清单中的位次(1-based);未提及为 null
  sentiment: Sentiment;
  competitorsMentioned: string[]; // 该回答中出现的竞品名
  note?: string; // 描述是否准确 / 点评
};

/** 单个引擎的汇总表现 */
export type EngineSummary = {
  engine: EngineId;
  label: string;
  status: EngineStatus; // ok / inactive(未激活,如 DataForSEO 欠费)/ error
  live: boolean; // 是否真实查询
  mentionRate: number; // 0-100,被提及问题占比
  avgRank: number | null;
  visibilityScore: number; // 0-100
  questionsAsked: number;
  questionsMentioned: number;
  note?: string;
};

export type Question = {
  id: string;
  text: string;
  intent: "high" | "medium";
  persona?: string;
  category?: string;
};

export type CompetitorStat = {
  name: string;
  domain?: string;
  mentions: number; // 在所有问答中出现总次数
  appearsInQuestions: number; // 出现在多少个问题里
  winsVsYou: number; // 你缺席而它出现的问题数
};

export type GapQuestion = {
  question: string;
  intent: "high" | "medium";
  enginesAbsent: EngineId[]; // 你在哪些引擎里缺席
  competitorsPresent: string[]; // 这些问题里被推荐的竞品
  why: string; // 为什么 AI 没选你
};

export type Recommendation = {
  title: string;
  detail: string;
  impact: "high" | "medium" | "low";
  effort: "quick" | "moderate" | "involved";
  category: "content" | "structured-data" | "authority" | "presence" | "technical";
};

export type SiteSignal = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

/**
 * AI 可见度阶梯探测(5 层,按机制分层:检索层 → 记忆层)
 * 1 Invisible      —— 联网搜索都搜不到你的站(AI 不知道你存在)
 * 2 Found, not picked —— 搜到了,但回答里从不提你
 * 3 Mentioned      —— 提了,但排在别人后面(不算有力推荐)
 * 4 Top pick       —— 联网模式下有力、靠前地推荐你
 * 5 In AI's memory —— 不联网也知道你并主动提你(刻进模型记忆,最高层)
 */
export type VisibilityProbe = {
  level: 1 | 2 | 3 | 4 | 5;
  retrievable: boolean | null; // 真实搜索结果里有没有你的站(读 web_search 工具返回判定;null = 搜索不可用)
  searchMentionRate: number | null; // 被提及率 0-100(与问答矩阵同一批回答,单一事实源)
  searchAvgRank: number | null; // 平均推荐位次(同上)
  searchedQuestions: number; // 参与推导的问题数
  pickedInstead: string[]; // 你缺席的问题里最常被点名的竞品
  /** AI 未动用搜索、纯凭已有知识作答的题数 —— 记忆层样本量(0 = 这轮没测到记忆层) */
  memoryQuestions?: number;
  memoryMentionRate?: number | null; // 记忆层样本里的被提及率(第 5 层的唯一依据)
  memoryAvgRank?: number | null; // 记忆层样本里的平均位次
  /** @deprecated 旧版双源探测才有(知识模式提及率);新报告不再产生,仅为渲染历史报告保留 */
  knowledgeMentionRate?: number;
  /** @deprecated 旧版单独存的探测回答;新报告阶梯直接引用问答矩阵同一行 */
  evidence?: { question: string; answer: string }[];
  note?: string;
};

export type SiteAudit = {
  reachable: boolean;
  title?: string;
  description?: string;
  hasSchema: boolean;
  schemaTypes: string[];
  hasLlmsTxt: boolean;
  hasFaq: boolean;
  wordCount: number;
  signals: SiteSignal[];
};

/**
 * 单个引擎的完整分析(付费报告用)。每个引擎独立拥有与 Claude 同构的模块数据:
 * 阶梯层级、竞品榜、缺口、该引擎的全部问答行 —— 让用户逐引擎横向对比。
 */
export type EngineBreakdown = {
  engine: EngineId;
  label: string;
  visibility: VisibilityProbe;
  competitors: CompetitorStat[];
  gaps: GapQuestion[];
  /** 该引擎实测所用的模型标识 —— 报告要能自证测的是"真实用户默认那一档" */
  modelName?: string;
};

/* ============================================================
   地基层:SEO —— 付费报告的下半部分
   ============================================================ */

/** 五个地基模块。前三个由 4 引擎共同分析,后两个由 Claude 单引擎分析真实数据源。 */
export type SeoModuleId =
  | "technical"      // 技术 SEO
  | "structure"      // 页面结构与关键词
  | "content"        // 内容质量与 E-E-A-T
  | "performance"    // 移动性能(PageSpeed Insights 真实用户数据)
  | "authority";     // 外链与品牌权威(DataForSEO Backlinks)

/**
 * 一条发现的**来源**。引擎自由探索时必须自报来源,这是防幻觉的核心机制:
 *   verified —— 事实包里有,我们自己抓过,可核实
 *   observed —— 引擎自己抓到的,必须能引用看到的原文
 *   inferred —— 推理,没直接看到(展示时降权)
 */
export type FindingProvenance = "verified" | "observed" | "inferred";

export type SeoFinding = {
  title: string;
  detail: string;
  provenance: FindingProvenance;
  /** observed 时引擎引用的原文片段 —— 没有原文的 observed 会被降级为 inferred */
  quote?: string;
  severity: "critical" | "important" | "minor" | "ok";
};

/**
 * 地基模块 —— **融合后的单一分析**,不再逐引擎分栏。
 * 三个多引擎模块的流程:Opus / GPT-5.6 / Gemini 3.1 Pro 各出一份 →
 * Opus 与事实包对账后融合成一份精简结论。用户只看融合结果,
 * 参与的模型记在 sources 里自证。
 */
export type SeoModule = {
  id: SeoModuleId;
  label: string;
  /** 一句话结论(答案前置,≤120 字符) */
  verdict: string;
  score: number | null; // 0-100;数据不足时 null
  /** 融合后的发现,每条一张小卡:短标题 + 1-2 句 */
  findings: SeoFinding[];
  /** 参与分析的模型名(报告要能自证是谁在分析) */
  sources: string[];
  /** 数据源缺失时如实说明(例如 CrUX 无字段数据),不编造 */
  dataGap?: string;
};

/** AI 爬虫逐个判定 */
export type CrawlerVerdict = {
  bot: string;
  label: string;
  allowed: boolean;
  /** 命中的是哪条规则;无规则时说明「未提及 = 默认放行」 */
  rule: string;
};

/**
 * SEO 事实包 —— 全部由我们自己抓取解析得出,零 LLM 参与。
 * 它有两个用途:① 喂给引擎当分析地基 ② 当**测谎仪**校验引擎有没有真的看站。
 */
export type SeoEvidence = {
  url: string;
  fetchedAt: string;

  crawlers: CrawlerVerdict[];
  hasLlmsTxt: boolean;
  hasRobotsTxt: boolean;
  sitemapReachable: boolean;
  sitemapInRobots: boolean;

  /** 不执行 JS 的爬虫能看到多少字 vs 渲染后多少字 —— 纯前端渲染的站这里会露馅 */
  rawTextWords: number;
  renderedWords: number;
  jsDependent: boolean;

  schemaTypes: string[];
  /** 缺失的关键 schema 字段,例如 "Organization.logo" */
  schemaGaps: string[];

  h1Count: number;
  h2Count: number;
  headingOutline: string[]; // 前若干个 H2 原文,给引擎判断答案前置
  avgParagraphWords: number;
  listCount: number;
  tableCount: number;
  hasFaq: boolean;

  /** 品牌名在各处是否一致 */
  brandNames: { source: string; value: string }[];
  brandConsistent: boolean;

  title?: string;
  titleLength: number;
  metaDescription?: string;
  metaDescriptionLength: number;
  canonical?: string;
  hasViewport: boolean;
  isHttps: boolean;
  noindex: boolean;
  responseMs: number | null;
};

/** PageSpeed Insights 真实用户字段数据(CrUX)。绝不掺 Lighthouse 实验室数据。 */
export type FieldMetric = {
  metric: string;
  label: string;
  p75: number;
  unit: "ms" | "score";
  category: "FAST" | "AVERAGE" | "SLOW";
};

export type PsiFieldData = {
  /** page = 该页面自身的字段数据;origin = 整站聚合;none = 流量不足,Chrome 无数据 */
  scope: "page" | "origin" | "none";
  overall?: "FAST" | "AVERAGE" | "SLOW";
  metrics: FieldMetric[];
  note?: string;
};

/** DataForSEO Backlinks 域名概览 */
export type BacklinkData = {
  available: boolean;
  rank?: number;
  referringDomains?: number;
  referringMainDomains?: number;
  backlinks?: number;
  dofollowRatio?: number | null;
  brokenBacklinks?: number;
  spamScore?: number;
  firstSeen?: string;
  note?: string;
};

export type SeoFoundation = {
  evidence: SeoEvidence;
  psi?: PsiFieldData;
  backlinks?: BacklinkData;
  modules: SeoModule[];
  /** 五个模块合计的真实问题数 —— 免费报告钩子显示的就是这个数 */
  issueCount: number;
};

export type AuditResult = {
  brand: string;
  input: string;
  url: string | null;
  domain: string;
  category: string;
  summary: string; // 1–2 句裁决(有冲击力)
  overallScore: number; // 0-100
  grade: string;
  engines: EngineSummary[];
  matrix: EngineQuestionResult[]; // 全部「引擎 × 问题」结果(免费仅展示部分)
  questions: Question[];
  competitors: CompetitorStat[];
  gaps: GapQuestion[];
  recommendations: Recommendation[];
  site?: SiteAudit;
  visibility?: VisibilityProbe; // 可见度阶梯(旧报告无此字段,前端做降级)
  breakdown?: EngineBreakdown[]; // 逐引擎分析(仅完整报告;免费报告只有 Claude,无需拆分)
  /**
   * 地基层:SEO(仅完整报告有完整内容)。
   * 免费报告只带 issueCount 用作钩子,modules 为空 —— 数字是真的,内容锁着。
   */
  foundation?: SeoFoundation;
  meta: {
    enginesLive: EngineId[];
    enginesInactive: EngineId[];
    generatedAt: string;
    questionCount: number;
    plan: "free" | "full";
    engineNote?: string; // 例如:DataForSEO 余额不足,多引擎未激活
  };
};

/** 付费完整报告数据(目前与 AuditResult 完整版同构) */
export type ReportData = AuditResult;
