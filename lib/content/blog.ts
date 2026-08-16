import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type PostImage = { url: string; alt: string; photographer?: string; photographerUrl?: string } | null;

export type PostSource = { label: string; url: string };

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  category: string;
  readingTime: string;
  keywords: string[];
  faqs: { q: string; a: string }[];
  image: PostImage;
  sources: PostSource[];
};

export type Post = { meta: PostMeta; content: string };

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

function readDir(): string[] {
  try {
    return fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));
  } catch {
    return [];
  }
}

function toMeta(slug: string, data: Record<string, unknown>): PostMeta {
  return {
    slug,
    title: String(data.title || slug),
    description: String(data.description || ""),
    date: String(data.date || "2026-06-25"),
    category: String(data.category || "Fundamentals"),
    readingTime: String(data.readingTime || "5 min read"),
    keywords: Array.isArray(data.keywords) ? (data.keywords as string[]) : [],
    faqs: Array.isArray(data.faqs) ? (data.faqs as { q: string; a: string }[]) : [],
    image: (data.image as PostImage) ?? null,
    sources: Array.isArray(data.sources) ? (data.sources as PostSource[]) : [],
  };
}

/** 从 Markdown 正文提取 H2/H3 标题用于目录 */
export function extractHeadings(markdown: string): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  const re = /^(#{2,3})\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const text = m[2].replace(/[*_`]/g, "").trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    out.push({ id, text, level: m[1].length });
  }
  return out;
}

export function getAllPosts(): PostMeta[] {
  return readDir()
    .map((file) => {
      const slug = file.replace(/\.mdx?$/, "");
      const raw = fs.readFileSync(path.join(BLOG_DIR, file), "utf8");
      const { data } = matter(raw);
      return toMeta(slug, data);
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostSlugs(): string[] {
  return readDir().map((f) => f.replace(/\.mdx?$/, ""));
}

export function getPost(slug: string): Post | null {
  const candidates = [`${slug}.mdx`, `${slug}.md`];
  for (const c of candidates) {
    const p = path.join(BLOG_DIR, c);
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      const { data, content } = matter(raw);
      return { meta: toMeta(slug, data), content };
    }
  }
  return null;
}

/* ============================================================
   分类枢纽(Pillar/Hub)—— 291+ 篇不能堆在一个 /blog 长列表里:
   单页过长会让内链权重与抓取预算分配很差,枢纽页也拿不到自己的排名。
   这里把文章按分类归拢并做规范化(历史上出现过 "AI"/"AI Visibility"/
   "SEO"/"Tactics" 这类只有 1-5 篇的碎片分类,合并进主分类)。
   ============================================================ */

/** 碎片分类归并到主分类 —— 键为 frontmatter 原值,值为规范分类 */
const CATEGORY_ALIASES: Record<string, string> = {
  AI: "AI Search",
  "AI Visibility": "AI Search",
  SEO: "Fundamentals",
  Tactics: "Strategy",
};

export function canonicalCategory(raw: string): string {
  return CATEGORY_ALIASES[raw] || raw || "Fundamentals";
}

export function categorySlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type CategoryInfo = { name: string; slug: string; count: number };

/** 全部规范分类,按篇数降序 */
export function getCategories(): CategoryInfo[] {
  const counts = new Map<string, number>();
  for (const p of getAllPosts()) {
    const c = canonicalCategory(p.category);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, slug: categorySlug(name), count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 「Keep reading」的取数:同分类**环形取邻** —— 每篇链向分类内紧随其后的
 * 3 篇(稳定排序,末尾回绕)。
 *
 * 曾经是 getAllPosts().slice(0,3):全站 321 篇的相关阅读全部指向同样的
 * 3 篇最新文 —— 那 3 篇被链 300+ 次,其余新页一条内链拿不到。内链是
 * Googlebot 发现与回访页面的主要通路,这种分布等于把绝大多数页晾在孤岛上
 * (2026-08-10 SEO 根因调查的处置项)。
 *
 * 为什么是环不是哈希轮转:环上每个节点都被前 3 个节点指到,**分类内每篇
 * 恰好收到 3 条入链,零遗漏零堆积**(哈希起点实测会留下 9 篇零入链的空洞)。
 * 顺序用「日期倒序、同日按文件名」的既有稳定序 —— SSG 每次构建结果一致。
 */
export function relatedPosts(slug: string, category: string, n = 3): PostMeta[] {
  const all = getAllPosts();
  const cat = canonicalCategory(category);
  const ring = all.filter((p) => canonicalCategory(p.category) === cat);
  const idx = ring.findIndex((p) => p.slug === slug);
  const picked: PostMeta[] = [];
  if (idx >= 0 && ring.length > 1) {
    for (let i = 1; i < ring.length && picked.length < n; i++) picked.push(ring[(idx + i) % ring.length]);
  }
  // 小分类凑不满 3 篇 → 用全站环补齐(同样取邻,绝不留空、不重复)
  if (picked.length < n) {
    const gidx = all.findIndex((p) => p.slug === slug);
    for (let i = 1; i < all.length && picked.length < n; i++) {
      const cand = all[(gidx + i) % all.length];
      if (cand.slug !== slug && !picked.some((x) => x.slug === cand.slug)) picked.push(cand);
    }
  }
  return picked;
}

export function getPostsByCategory(slug: string): PostMeta[] {
  return getAllPosts().filter((p) => categorySlug(canonicalCategory(p.category)) === slug);
}

/** 枢纽页分页:每页 18 篇(底座要求约 ≤15-20,超出分页且分页可抓取) */
export const HUB_PAGE_SIZE = 18;

export function categoryPageCount(slug: string): number {
  return Math.max(1, Math.ceil(getPostsByCategory(slug).length / HUB_PAGE_SIZE));
}
