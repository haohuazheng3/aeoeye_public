import { pgTable, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type { AuditResult, ReportData } from "@/lib/engine/types";
import type { SeoAuditProgress, SeoAuditResult } from "@/lib/seo-audit/types";

/* ============================================================
   AEOeye 数据表(身份认证由 Clerk 托管,本库不存用户密码)
   ============================================================ */

/** 用户(纯邮箱验证码登录,无密码) */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

/** 一次性登录验证码(哈希存储,短时有效) */
export const loginCodes = pgTable(
  "login_codes",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumed: boolean("consumed").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ emailIdx: index("login_codes_email_idx").on(t.email) })
);

/** 会话(不透明 token,可撤销) */
export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ userIdx: index("sessions_user_idx").on(t.userId) })
);

export type User = typeof users.$inferSelect;

/** 一次 AI 可见度审计 */
export const audits = pgTable(
  "audits",
  {
    id: text("id").primaryKey(),
    input: text("input").notNull(), // 用户原始输入(品牌名或网址)
    brand: text("brand").notNull(),
    url: text("url"),
    domain: text("domain").notNull(),
    category: text("category"),
    status: text("status").notNull().default("pending"), // pending|running|complete|failed
    source: text("source"), // home / 工具页 slug / 行业页 slug
    score: integer("score"),
    grade: text("grade"),
    result: jsonb("result").$type<AuditResult>(),
    error: text("error"),
    email: text("email"),
    unlocked: boolean("unlocked").notNull().default(false), // 是否解锁完整报告
    pdfSentAt: timestamp("pdf_sent_at"), // 完整报告 PDF 已发往买家邮箱的时间(幂等标记)
    plan: text("plan").notNull().default("free"), // free | full
    userId: text("user_id"), // Clerk userId(若已登录)
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    domainIdx: index("audits_domain_idx").on(t.domain),
    userIdx: index("audits_user_idx").on(t.userId),
    createdIdx: index("audits_created_idx").on(t.createdAt),
  })
);

/** 邮箱线索(解锁 / 订阅 / 联系 / newsletter) */
export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  type: text("type").notNull(), // unlock | contact | newsletter | waitlist | monitor
  auditId: text("audit_id"),
  brand: text("brand"),
  name: text("name"),
  message: text("message"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Stripe 一次性订单(单份完整报告) */
export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  stripeSessionId: text("stripe_session_id").unique(),
  stripePaymentIntent: text("stripe_payment_intent"),
  email: text("email").notNull(),
  product: text("product").notNull(), // full-report
  amount: integer("amount").notNull(), // cents
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("pending"), // pending|paid|refunded
  auditId: text("audit_id"),
  reportId: text("report_id"),
  userId: text("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
});

/** Stripe 订阅(Pro:持续监测 / 竞品追踪 / 变化提醒) */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    status: text("status").notNull().default("incomplete"), // active|trialing|past_due|canceled|incomplete
    plan: text("plan").notNull().default("pro"), // pro
    priceId: text("price_id"),
    interval: text("interval"), // month | year
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({ userIdx: index("subs_user_idx").on(t.userId) })
);

/** 持续监测的品牌(Pro 功能) */
export const monitors = pgTable(
  "monitors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    brand: text("brand").notNull(),
    url: text("url"),
    domain: text("domain").notNull(),
    cadence: text("cadence").notNull().default("weekly"), // weekly | monthly
    competitors: jsonb("competitors").$type<string[]>().default([]),
    lastAuditId: text("last_audit_id"),
    lastScore: integer("last_score"),
    nextRunAt: timestamp("next_run_at"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ userIdx: index("monitors_user_idx").on(t.userId) })
);

/** 付费完整报告快照 */
export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  auditId: text("audit_id").notNull(),
  orderId: text("order_id"),
  data: jsonb("data").$type<ReportData>(),
  pdfUrl: text("pdf_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 自建错误收件箱(全栈错误捕获,按指纹分组计数) */
export const errorEvents = pgTable(
  "error_events",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull().unique(), // hash(name + 首帧 + route)
    name: text("name").notNull(),
    message: text("message"),
    stack: text("stack"), // 截断后的首若干帧
    route: text("route"),
    level: text("level").notNull().default("error"), // error | warn
    source: text("source").notNull().default("server"), // server | client | edge
    count: integer("count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    sampleMeta: jsonb("sample_meta").$type<Record<string, unknown>>(),
  },
  (t) => ({ resolvedIdx: index("error_events_resolved_idx").on(t.resolved), lastSeenIdx: index("error_events_last_seen_idx").on(t.lastSeenAt) })
);

/** 第一方事件埋点(pageview + 关键交互),/admin-dashboard 数据地基 */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(), // 第一方会话
    visitorId: text("visitor_id"), // 匿名稳定 id
    userId: text("user_id"), // Clerk userId(登录后)
    type: text("type").notNull(), // pageview | click | signup | login | checkout_start | purchase | module_view | ...
    path: text("path"), // 页面路径
    referrer: text("referrer"),
    source: text("source"), // 归因来源(utm/referrer 归纳)
    meta: jsonb("meta").$type<Record<string, unknown>>(), // element/module/dwell 等
    ipCity: text("ip_city"), // 市级属地(来自边缘地理头)
    isSelf: boolean("is_self").notNull().default(false), // 自测流量过滤标记
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("events_session_idx").on(t.sessionId),
    typeIdx: index("events_type_idx").on(t.type),
    createdIdx: index("events_created_idx").on(t.createdAt),
    userIdx: index("events_user_idx").on(t.userId),
  })
);

/* ============================================================
   公开 API —— key 与逐次调用账单
   ============================================================ */

/**
 * API key。**只存哈希**,明文只在创建那一刻返回一次。
 * prefix 存明文前若干位,仅用于在列表里认出是哪一把 —— 它本身不足以调用。
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // 例:aeo_live_7f3a…
    keyHash: text("key_hash").notNull().unique(), // sha256(明文)
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("api_keys_user_idx").on(t.userId),
    hashIdx: index("api_keys_hash_idx").on(t.keyHash),
  })
);

/**
 * 一次 API 调用的完整账单。
 *
 * 金额一律用**微美元整数**(1 USD = 1_000_000):一次调用可能只花几十微美元,
 * 用浮点存会累出误差,用「分」存会全部归零。costBreakdown 保留逐笔明细,
 * usage 界面据此展开到"哪个供应商、哪个环节、多少 token"。
 */
export const apiRequests = pgTable(
  "api_requests",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id").notNull(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    input: text("input"), // 被审计的品牌/网址
    auditId: text("audit_id"), // 生成的报告 id(失败时为空)
    status: text("status").notNull(), // succeeded | failed
    httpStatus: integer("http_status"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** 供应商直接回的真实扣费(DataForSEO)—— 与按价目表估算的那部分分开存 */
    measuredMicroUsd: integer("measured_micro_usd").notNull().default(0),
    estimatedMicroUsd: integer("estimated_micro_usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costBreakdown: jsonb("cost_breakdown").$type<unknown[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("api_requests_user_idx").on(t.userId),
    keyIdx: index("api_requests_key_idx").on(t.keyId),
    createdIdx: index("api_requests_created_idx").on(t.createdAt),
  })
);

/* ============================================================
   SEO 审计(第二个产品面:与 AI 可见度审计并列,独立表、独立路由)
   ============================================================ */

/**
 * 一次 SEO 审计。刻意**不复用** audits 表:两个产品的 plan/unlocked 语义、
 * dashboard 链接、出题锚(lastCategoryFor 按 domain 查 audits)都会串台。
 *
 * unlocked 只由付款(markOrderPaid)置 true;plan 只在付费升级真正跑完后置 "full" ——
 * 两者分开才能发现"付了钱但完整报告没生成"这类事故。
 * ip_hash = sha256(ip + 盐) 前 32 位,只用于按 IP 限流,不存明文 IP。
 * cost_cents 累加每次运行的 DataForSEO 实测花费(免费轮恒为 0)。
 */
export const seoAudits = pgTable(
  "seo_audits",
  {
    id: text("id").primaryKey(),
    input: text("input").notNull(), // 用户原始输入
    url: text("url").notNull(), // 归一化后的入口 URL
    domain: text("domain").notNull(), // 去 www 的可注册域名
    status: text("status").notNull().default("pending"), // pending|running|complete|failed
    plan: text("plan").notNull().default("free"), // free | full
    score: integer("score"),
    grade: text("grade"),
    result: jsonb("result").$type<SeoAuditResult>(),
    error: text("error"),
    email: text("email"),
    unlocked: boolean("unlocked").notNull().default(false),
    userId: text("user_id"), // Clerk userId(若已登录或事后认领)
    source: text("source"), // 入口归因
    ipHash: text("ip_hash"),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    unlockedAt: timestamp("unlocked_at"),
    /* ---- v2(hardening):异步运行 + 缓存 + 升级状态机 + 重跑计数 ---- */
    /** 后台运行的实时阶段(报告页每 3s 轮询);complete 后保留最后一帧 */
    progress: jsonb("progress").$type<SeoAuditProgress>(),
    /** 免费层缓存:本行的 result 是从哪一行复制来的(6h 内同入口 URL 的完成报告) */
    cachedFrom: text("cached_from"),
    /** 付费升级 CAS 状态机:idle | running | done | failed | pending_provider */
    upgradeState: text("upgrade_state").default("idle"),
    upgradeStartedAt: timestamp("upgrade_started_at", { withTimezone: true }),
    /** 解锁后 30 天内的重跑次数(免费模块不限次) */
    rerunCount: integer("rerun_count").notNull().default(0),
    /** DataForSEO 模块被刷新的次数(上限 2 —— 每次都是真钱) */
    paidRefreshCount: integer("paid_refresh_count").notNull().default(0),
  },
  (t) => ({
    domainIdx: index("seo_audits_domain_idx").on(t.domain),
    userIdx: index("seo_audits_user_idx").on(t.userId),
    createdIdx: index("seo_audits_created_idx").on(t.createdAt),
    ipHashIdx: index("seo_audits_ip_hash_idx").on(t.ipHash),
  })
);

/**
 * SEO 审计的跨实例配额计数(固定窗口)。一行一个桶(ip:<hash>:1h / domain:<d>:1h /
 * global:1h / psi:24h …),`INSERT … ON CONFLICT DO UPDATE … RETURNING n` 一条语句原子完成
 * "窗口过期则重置、否则 +1" —— neon-http 没有交互式事务,只能靠单语句原子性。
 * 只对**真正触发抓取**的运行计数,缓存复用不计。
 */
export const seoQuota = pgTable("seo_quota", {
  bucket: text("bucket").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  n: integer("n").notNull().default(0),
});

export type SeoAudit = typeof seoAudits.$inferSelect;
export type NewSeoAudit = typeof seoAudits.$inferInsert;
export type SeoQuotaRow = typeof seoQuota.$inferSelect;

export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiRequest = typeof apiRequests.$inferSelect;

export type Audit = typeof audits.$inferSelect;
export type NewAudit = typeof audits.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Monitor = typeof monitors.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ErrorEvent = typeof errorEvents.$inferSelect;
export type Event = typeof events.$inferSelect;
