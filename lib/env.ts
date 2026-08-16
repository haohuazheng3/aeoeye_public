import { z } from "zod";

/**
 * 服务端环境变量(zod 校验)。
 * 仅 DATABASE_URL 为硬性必填;其余外部服务未配置时给宽松默认值,
 * 不阻断构建——相关能力在运行时按需检查 `features`。
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().default("https://aeoeye.com"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL 缺失"),

  // LLM —— 角色必须分开,详见 lib/anthropic.ts 顶部的角色表
  ANTHROPIC_API_KEY: z.string().default(""),
  /**
   * 付费报告的分析/判定/汇总 —— 最强档。
   * ⚠️ 刻意**不叫** LLM_MODEL:Vercel 上还挂着一条 `LLM_MODEL=claude-opus-5`,
   * 沿用旧名会被它静默覆盖(env 覆盖代码默认值,曾让付费模型错了 45 天)。
   * 换新名 ⇒ 生效值就是这里写的值,不依赖任何人去清理旧 env。
   */
  LLM_MODEL_FULL: z.string().default("gpt-5.6-sol"),
  /** 免费报告的分析/判定/汇总 */
  LLM_MODEL_FREE: z.string().default("gpt-5.6-luna"),
  /** 受测 ChatGPT 引擎 —— 对标真实免费 ChatGPT 用户默认拿到的那一档 */
  LLM_MODEL_ENGINE_GPT: z.string().default("gpt-5.6-luna"),
  /** 受测 Claude 引擎 —— 对标真实免费 Claude 用户默认拿到的那一档 */
  LLM_MODEL_ENGINE: z.string().default("claude-sonnet-5"),
  LLM_MODEL_CHEAP: z.string().default("gpt-5.6-luna"),

  // OpenAI(站长命名为 OPENAI_API,保持原名)—— 分析主模型 + 受测 ChatGPT 引擎的唯一通道
  OPENAI_API: z.string().default(""),

  // 抓站
  FIRECRAWL_API_KEY: z.string().default(""),

  // 移动性能:PageSpeed Insights(只取 CrUX 真实用户字段数据)
  PSI_API: z.string().default(""),

  // 真实多引擎查询(DataForSEO AI Optimization);余额耗尽时引擎自动降级为"未激活"
  DATAFORSEO_B64: z.string().default(""),

  // 交易邮件:付款后把完整报告 PDF 发到买家在 Stripe 填的邮箱
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("AEOeye <reports@aeoeye.com>"),
  EMAIL_REPLY_TO: z.string().default("contact@aeoeye.com"),

  // 计费(Stripe)
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_PRO_MONTHLY: z.string().default(""),
  STRIPE_PRICE_PRO_YEARLY: z.string().default(""),
  STRIPE_PRICE_REPORT: z.string().default(""),

  // Clerk
  CLERK_SECRET_KEY: z.string().default(""),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().default(""),

  // Cloudflare / R2
  CLOUDFLARE_API_TOKEN: z.string().default(""),
  CLOUDFLARE_ACCOUNT_ID: z.string().default(""),
  CLOUDFLARE_ZONE_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET: z.string().default("aeoeye-reports"),
  R2_PUBLIC_URL: z.string().default(""),

  // SEO / 提交
  GOOGLE_SERVICE_ACCOUNT_B64: z.string().default(""),
  INDEXNOW_KEY: z.string().default(""),

  // 安全 / 定时
  CRON_SECRET: z.string().default(""),

  // 公开 API —— 目前只对站长本人开放(不限额,但逐次记账)
  API_OWNER_EMAIL: z.string().default("haohuazheng001@gmail.com"),
});

function load() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`环境变量校验失败:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();

export const isProd = env.NODE_ENV === "production";

/** 各外部能力是否就绪(运行时按需判断) */
export const features = {
  // 出题 / 判卷 / 汇总现在全部由 OpenAI 承担 —— 审计能不能跑起来只取决于它。
  // 曾经写成 ANTHROPIC_API_KEY,Anthropic 欠费时会把整条免费审计一起判死,
  // 而那时免费轮其实一次 Anthropic 都不调。
  llm: !!env.OPENAI_API,
  openai: !!env.OPENAI_API,
  /** 受测 Claude 引擎的直连通道(缺席时该引擎走 DataForSEO,不影响审计) */
  anthropic: !!env.ANTHROPIC_API_KEY,
  firecrawl: !!env.FIRECRAWL_API_KEY,
  dataforseo: !!env.DATAFORSEO_B64,
  psi: !!env.PSI_API,
  stripe: !!env.STRIPE_SECRET_KEY,
  stripeWebhook: !!env.STRIPE_WEBHOOK_SECRET,
  clerk: !!env.CLERK_SECRET_KEY && !!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  r2: !!env.R2_ACCESS_KEY_ID && !!env.R2_SECRET_ACCESS_KEY,
  indexnow: !!env.INDEXNOW_KEY,
  email: !!env.RESEND_API_KEY,
};
