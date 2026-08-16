import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { getAllPosts, getCategories, categoryPageCount } from "@/lib/content/blog";
import { GLOSSARY } from "@/lib/content/glossary";
import { TOOLS } from "@/lib/content/tools";
import { getPages } from "@/lib/content/pages";

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
    { path: "/blog", priority: 0.7, freq: "weekly" },
    { path: "/guides", priority: 0.8, freq: "weekly" },
    { path: "/answers", priority: 0.7, freq: "weekly" },
    { path: "/compare", priority: 0.7, freq: "monthly" },
    { path: "/vs", priority: 0.8, freq: "monthly" },
    { path: "/alternatives", priority: 0.8, freq: "monthly" },
    { path: "/for", priority: 0.7, freq: "monthly" },
    { path: "/glossary", priority: 0.6, freq: "monthly" },
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

  // 分类枢纽页 + 其可抓取分页 —— 枢纽页自己是排名目标,必须进 sitemap
  const hubs = getCategories().flatMap((c) => {
    const pages = categoryPageCount(c.slug);
    return Array.from({ length: pages }, (_, i) => ({
      url: i === 0 ? `${siteUrl}/blog/category/${c.slug}` : `${siteUrl}/blog/category/${c.slug}?page=${i + 1}`,
      changeFrequency: "weekly" as const,
      priority: i === 0 ? 0.7 : 0.4,
    }));
  });

  const posts = getAllPosts().map((p) => ({
    url: `${siteUrl}/blog/${p.slug}`,
    lastModified: new Date(p.date),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const glossary = GLOSSARY.map((t) => ({
    url: `${siteUrl}/glossary/${t.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.4,
  }));

  const tools = TOOLS.map((t) => ({
    url: `${siteUrl}/tools/${t.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const dyn = (["answers", "compare", "for", "vs", "alternatives", "guides"] as const).flatMap((type) =>
    getPages(type).map((p) => ({
      url: `${siteUrl}/${type}/${p.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }))
  );

  return [...staticEntries, ...tools, ...hubs, ...posts, ...glossary, ...dyn];
}
