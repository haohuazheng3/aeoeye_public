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
export const PILLARS: Pillar[] = []; // 2026-10-24 SEO 内容全部下线,主题拓扑清空

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
