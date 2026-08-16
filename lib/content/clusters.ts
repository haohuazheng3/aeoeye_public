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

export const PILLARS: Pillar[] = [
  {
    blogSlug: "what-is-answer-engine-optimization",
    name: "Answer Engine Optimization (AEO)",
    blurb: "The complete guide to getting recommended by AI answer engines — and every sub-topic that matters.",
    clusters: [
      { href: "/blog/aeo-vs-seo", label: "AEO vs SEO" },
      { href: "/compare/aeo-vs-geo-vs-seo", label: "AEO vs GEO vs SEO" },
      { href: "/answers/what-is-an-answer-engine", label: "What is an answer engine?" },
      { href: "/answers/what-is-an-aeo-strategy", label: "What is an AEO strategy?" },
      { href: "/answers/can-you-do-seo-for-chatgpt", label: "Can you do SEO for ChatGPT?" },
      { href: "/guides/how-to-do-an-aeo-audit", label: "How to do an AEO audit" },
      { href: "/glossary/answer-engine-optimization", label: "AEO — glossary" },
    ],
  },
  {
    blogSlug: "generative-engine-optimization",
    name: "Generative Engine Optimization (GEO)",
    blurb: "What GEO is, how it differs from SEO, and the tactics that get you cited by generative engines.",
    clusters: [
      { href: "/compare/geo-vs-seo", label: "GEO vs SEO" },
      { href: "/blog/llm-seo", label: "LLM SEO" },
      { href: "/answers/what-is-ai-content-optimization", label: "AI content optimization" },
      { href: "/blog/most-aeo-advice-is-recycled-seo", label: "Most AEO advice is recycled SEO" },
      { href: "/glossary/generative-engine-optimization", label: "GEO — glossary" },
    ],
  },
  {
    blogSlug: "measuring-ai-visibility",
    name: "AI Visibility & Measurement",
    blurb: "How to measure whether AI recommends you — the metrics, tools and tracking that matter.",
    clusters: [
      { href: "/answers/what-is-ai-visibility", label: "What is AI visibility?" },
      { href: "/answers/what-is-llm-visibility", label: "What is LLM visibility?" },
      { href: "/answers/what-is-ai-citation-tracking", label: "AI citation tracking" },
      { href: "/answers/how-to-check-if-ai-mentions-your-brand", label: "Check if AI mentions you" },
      { href: "/guides/how-to-track-brand-mentions-in-ai", label: "Track brand mentions in AI" },
      { href: "/glossary/ai-visibility", label: "AI visibility — glossary" },
    ],
  },
  {
    blogSlug: "how-to-get-recommended-by-chatgpt",
    name: "Getting Recommended by AI Engines",
    blurb: "Engine-by-engine playbooks for getting named and cited by ChatGPT, Perplexity and Google AI.",
    clusters: [
      { href: "/guides/how-to-rank-in-chatgpt", label: "How to rank in ChatGPT" },
      { href: "/guides/how-to-rank-in-ai-overviews", label: "How to rank in AI Overviews" },
      { href: "/answers/how-to-get-cited-by-perplexity", label: "Get cited by Perplexity" },
      { href: "/answers/how-to-appear-in-google-ai-overviews", label: "Appear in Google AI Overviews" },
      { href: "/guides/how-to-optimize-for-ai-search", label: "Optimize for AI search" },
      { href: "/answers/does-chatgpt-use-my-website", label: "Does ChatGPT use my website?" },
    ],
  },
  {
    blogSlug: "structured-data-for-ai",
    name: "Content & Technical AEO",
    blurb: "The content structure, schema and files that make your site machine-readable and quotable.",
    clusters: [
      { href: "/guides/how-to-optimize-content-for-ai-search", label: "Optimize content for AI search" },
      { href: "/guides/how-to-add-llms-txt", label: "How to add llms.txt" },
      { href: "/answers/do-ai-assistants-use-schema-markup", label: "Do AI assistants use schema?" },
      { href: "/answers/what-makes-content-quotable-by-ai", label: "What makes content quotable" },
      { href: "/blog/llms-txt-explained", label: "llms.txt explained" },
      { href: "/glossary/structured-data", label: "Structured data — glossary" },
    ],
  },
  {
    blogSlug: "best-ai-visibility-tools",
    name: "AI Visibility Tools",
    blurb: "Honest comparisons and alternatives across every major AI visibility platform.",
    clusters: [
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

/** 取某集群页(by href,如 "/guides/how-to-rank-in-chatgpt")所属的支柱 */
export function pillarForCluster(href: string): Pillar | undefined {
  return PILLAR_BY_CLUSTER[href];
}
