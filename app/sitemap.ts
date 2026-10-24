import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { TOOLS } from "@/lib/content/tools";
import { getToolPages, TOOL_CATEGORIES } from "@/lib/content/tool-pages";
import { getAllPosts } from "@/lib/content/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  /*
   * ⚠️ 不要给"没有真实修改日期"的条目写 lastModified。
   *
   * 曾经这里是 `const now = new Date()`,静态路由/枢纽/glossary/工具/answers 等
   * 162 个 URL 每次构建都被盖成"今天改过"。迁到 GitHub Actions 后一天部署可达
   * 10 次 —— 从 Google 视角:sitemap 里三分之一的 URL 天天在"变",抓过来却发现
   * 内容没变。Google 官方口径是 lastmod 只在"始终如实"时才被当信号;持续说谎的
   * 结果是整份 sitemap 的 lastmod 失去参考价值(2026-08-10 SEO 根因调查实锤:
   * 老页 10+ 天不被重抓、7/25 批次 16 天不被抓,lastmod churn 是恶化因素之一)。
   *
   * 规则:知道真实日期的(博客 p.date)才写;不知道的一律省略 —— 缺失优于撒谎。
   */
  const staticRoutes: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "/", priority: 1, freq: "weekly" },
    { path: "/how-it-works", priority: 0.8, freq: "monthly" },
    { path: "/example", priority: 0.7, freq: "monthly" },
    { path: "/pricing", priority: 0.8, freq: "monthly" },
    { path: "/tools", priority: 0.8, freq: "monthly" },
    { path: "/seo-audit", priority: 0.8, freq: "weekly" },
    { path: "/seo-audit/how-we-score", priority: 0.4, freq: "monthly" },
    { path: "/bot", priority: 0.2, freq: "yearly" },
    { path: "/about", priority: 0.6, freq: "monthly" },
    { path: "/contact", priority: 0.4, freq: "yearly" },
    { path: "/privacy", priority: 0.2, freq: "yearly" },
    { path: "/terms", priority: 0.2, freq: "yearly" },
    { path: "/cookies", priority: 0.2, freq: "yearly" },
  ];

  const staticEntries = staticRoutes.map((r) => ({
    url: `${siteUrl}${r.path}`,
    changeFrequency: r.freq,
    priority: r.priority,
  }));

  const tools = TOOLS.map((t) => ({
    url: `${siteUrl}/tools/${t.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  // 2026-10-24 SEO 底座 v2:工具优先页(有真实发布/修订日期)+ 5 个工具枢纽 + /blog 决策页。
  // 老栏目(answers / guides / compare / vs / alternatives / for / glossary)仍整树 410,不进 sitemap。
  const toolPages = getToolPages().map((p) => ({
    url: `${siteUrl}/tools/${p.slug}`,
    lastModified: p.updated,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));
  const hubs = TOOL_CATEGORIES.map((c) => ({
    url: `${siteUrl}/tools/category/${c.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  const posts = getAllPosts();
  const blog = posts.length
    ? [
        { url: `${siteUrl}/blog`, changeFrequency: "weekly" as const, priority: 0.6 },
        ...posts.map((p) => ({ url: `${siteUrl}/blog/${p.slug}`, lastModified: p.date, changeFrequency: "monthly" as const, priority: 0.6 })),
      ]
    : [];
  return [...staticEntries, ...tools, ...toolPages, ...hubs, ...blog];
}
