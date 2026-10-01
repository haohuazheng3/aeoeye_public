import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // 方法论页在 /seo-audit/ 前缀下但是公开内容:显式 allow,最长匹配规则胜过下面的 disallow
        allow: ["/", "/seo-audit/how-we-score"],
        // "/seo-audit/" 只挡报告子路径(/seo-audit/<id>,按 id 分享的用户专属页);
        // 落地页 /seo-audit 不以 "/seo-audit/" 开头,仍可抓取可索引
        disallow: ["/api/", "/audit/", "/seo-audit/", "/dashboard/"],
      },
      // 欢迎 AI 抓取公开内容(本身就是 AEO 工具,身体力行)
      { userAgent: ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot", "Applebot-Extended"], allow: "/" },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
