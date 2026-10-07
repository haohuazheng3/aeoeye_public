/**
 * Pillar(支柱)+ Cluster(集群)主题拓扑。
 * 支柱页(博客 slug)→ 其覆盖的集群子页。用于在支柱页渲染集群导航、
 * 在集群页渲染回到支柱的链接,形成完整知识体系(利于 Google/AI 理解主题结构与传权重)。
 */
export type ClusterLink = { href: string; label: string };
export type Pillar = {
  blogSlug: string; // 支柱页(/blog/<slug>)
  name: string;
  blurb: string;
  clusters: ClusterLink[];
};

// 2026-10-03 清理后重排:所有链接都指向合并后的规范页(被合并的页已 301,不再进拓扑)
export const PILLARS: Pillar[] = [
  {
    blogSlug: "what-is-answer-engine-optimization",
    name: "Answer Engine Optimization (AEO)",
    blurb: "The complete guide to getting recommended by AI answer engines — and every sub-topic that matters.",
    clusters: [
      { href: "/blog/aeo-vs-seo", label: "AEO vs SEO" },
      { href: "/compare/aeo-vs-geo-vs-seo", label: "AEO vs GEO vs SEO" },
      { href: "/blog/aeo-strategy", label: "Build an AEO strategy" },
      { href: "/blog/aeo-audit-checklist", label: "AEO audit checklist" },
      { href: "/blog/answer-engine-optimization-agency", label: "Choose an AEO agency" },
    ],
  },
  {
    blogSlug: "generative-engine-optimization",
    name: "Generative Engine Optimization (GEO)",
    blurb: "What GEO is, how it differs from SEO, and the tactics that get you cited by generative engines.",
    clusters: [
      { href: "/compare/aeo-vs-geo-vs-seo", label: "AEO vs GEO vs SEO" },
      { href: "/blog/geo-examples", label: "GEO examples" },
      { href: "/blog/answer-engine-optimization-agency", label: "What AEO / GEO agencies deliver" },
      { href: "/blog/most-aeo-advice-is-recycled-seo", label: "Most AEO advice is recycled SEO" },
    ],
  },
  {
    blogSlug: "measuring-ai-visibility",
    name: "AI Visibility & Measurement",
    blurb: "How to measure whether AI recommends you — the metrics, tools and tracking that matter.",
    clusters: [
      { href: "/answers/what-is-ai-visibility", label: "What is AI visibility?" },
      { href: "/answers/what-is-ai-citation-tracking", label: "AI citation tracking" },
      { href: "/blog/free-ai-visibility-checker", label: "Free AI visibility check" },
      { href: "/blog/ai-visibility-tracker", label: "AI visibility trackers" },
      { href: "/blog/ai-visibility-score-methodology", label: "How AI visibility scores work" },
      { href: "/blog/ai-traffic-analytics", label: "Track AI referral traffic" },
      { href: "/blog/ai-brand-recommendation-measurement", label: "Measure AI brand recommendations" },
    ],
  },
  {
    blogSlug: "chatgpt-seo",
    name: "Getting Recommended by AI Engines",
    blurb: "Engine-by-engine playbooks for getting named and cited by ChatGPT, Perplexity, Gemini, Claude and Google AI.",
    clusters: [
      { href: "/blog/how-to-get-your-business-recommended-by-ai", label: "Get your business recommended by AI" },
      { href: "/guides/how-to-rank-in-ai-overviews", label: "How to rank in AI Overviews" },
      { href: "/blog/how-to-rank-in-google-ai-mode", label: "How to show up in Google AI Mode" },
      { href: "/blog/how-to-rank-in-perplexity", label: "How to rank in Perplexity" },
      { href: "/blog/how-to-rank-in-gemini", label: "How to rank in Gemini" },
      { href: "/blog/claude-seo", label: "How to get cited by Claude" },
      { href: "/answers/does-chatgpt-use-my-website", label: "Does ChatGPT use my website?" },
      { href: "/blog/why-ai-doesnt-mention-your-brand", label: "Why AI recommends your competitors, not you" },
    ],
  },
  {
    blogSlug: "structured-data-for-ai",
    name: "Content & Technical AEO",
    blurb: "The content structure, schema, crawler access and files that make your site machine-readable and quotable.",
    clusters: [
      { href: "/guides/how-to-optimize-content-for-ai-search", label: "Optimize content for AI search" },
      { href: "/answers/what-makes-content-quotable-by-ai", label: "What makes content quotable" },
      { href: "/blog/what-is-llms-txt", label: "What is llms.txt?" },
      { href: "/guides/how-to-add-llms-txt", label: "How to add llms.txt" },
      { href: "/blog/ai-crawler-user-agent-directory", label: "AI crawler directory" },
      { href: "/blog/blocking-gptbot-is-usually-a-mistake", label: "Should you block GPTBot?" },
    ],
  },
  {
    blogSlug: "best-ai-visibility-tools",
    name: "AI Visibility Tools",
    blurb: "Honest comparisons and alternatives across every major AI visibility platform.",
    clusters: [
      { href: "/blog/ai-search-optimization-tools-buyers-guide", label: "How to choose an AI visibility tool" },
      { href: "/blog/ai-visibility-tracker", label: "AI visibility trackers" },
      { href: "/vs/profound", label: "AEOeye vs Profound" },
      { href: "/vs/otterly", label: "AEOeye vs Otterly" },
      { href: "/alternatives/profound", label: "Profound alternatives" },
      { href: "/vs", label: "All comparisons" },
      { href: "/alternatives", label: "All alternatives" },
    ],
  },
];

const PILLAR_BY_BLOG: Record<string, Pillar> = Object.fromEntries(PILLARS.map((p) => [p.blogSlug, p]));

/** 取某博客 slug 对应的支柱(若它是支柱页) */
export function pillarForBlog(slug: string): Pillar | undefined {
  return PILLAR_BY_BLOG[slug];
}

// 反向索引:集群页 href → 它所属的支柱
const PILLAR_BY_CLUSTER: Record<string, Pillar> = {};
for (const p of PILLARS) for (const c of p.clusters) if (!PILLAR_BY_CLUSTER[c.href]) PILLAR_BY_CLUSTER[c.href] = p;

/** 取某集群页(by href,如 "/guides/how-to-rank-in-ai-overviews")所属的支柱 */
export function pillarForCluster(href: string): Pillar | undefined {
  return PILLAR_BY_CLUSTER[href];
}
