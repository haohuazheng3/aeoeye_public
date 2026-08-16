import { env } from "./env";

/** 站点品牌与全局配置(单一事实源) */
export const site = {
  name: "AEOeye",
  legalName: "AEOeye",
  tagline: "See your brand the way AI does",
  domain: "aeoeye.com",
  description:
    "AEOeye shows you whether ChatGPT, Claude, Gemini, Google AI and Perplexity recommend your brand — or your competitors — when buyers ask. Run a free AI visibility audit in seconds.",
  locale: "en_US",
  twitter: "@aeoeye",
  email: "contact@aeoeye.com",
  // 报告覆盖的五家引擎。live=true 的是免费审计就实时查的那家(ChatGPT),
  // 其余四家是付费完整报告才跑 —— 顺序即报告里的展示顺序。
  engines: [
    { id: "chatgpt", label: "ChatGPT", live: true },
    { id: "claude", label: "Claude", live: false },
    { id: "gemini", label: "Gemini", live: false },
    { id: "google_ai", label: "Google AI", live: false },
    { id: "perplexity", label: "Perplexity", live: false },
  ],
} as const;

/** 站点根 URL(去掉末尾斜杠) */
export const siteUrl = (env.APP_URL || "https://aeoeye.com").replace(/\/$/, "");

export function absoluteUrl(path = "/"): string {
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
