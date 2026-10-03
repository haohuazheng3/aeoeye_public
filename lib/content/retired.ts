import retired from "@/content/retired.json";

/* ============================================================
   永久下线的内容 URL(2026-09-24 第一轮、2026-10-03 第二轮清理)
   - gone   → middleware 直接回 410(诚实告诉 Google 这页没了,不做假 301)
   - merged → next.config 301 到吸收它的页(同意图重复合并)
   名单里的键是完整站内路径("/answers/x");没有前导斜杠的老条目一律视为 "/blog/<slug>"。
   这份名单是**永久**的:内容门禁(scripts/verify-content-quality.mjs)会拒绝任何
   同名页被重新创建 —— 否则定时管线下次又把同一批页写回来。
   ============================================================ */

/** 名单键 → 完整路径 */
export function retiredPath(key: string): string {
  return key.startsWith("/") ? key.toLowerCase() : `/blog/${key.toLowerCase()}`;
}

export const RETIRED_GONE: ReadonlySet<string> = new Set<string>(retired.gone.map(retiredPath));
const MERGED: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(retired.merged as Record<string, string>).map(([from, to]) => [retiredPath(from), retiredPath(to)])
);

/** 合并目标:沿链走到最终页(名单里已展平,这里再防一手);终点若已删除 → null */
export function retiredTarget(path: string): string | null {
  let p = retiredPath(path);
  for (let hop = 0; hop < 10; hop++) {
    const next = MERGED[p];
    if (!next) break;
    p = next;
  }
  if (p === retiredPath(path)) return null;
  return RETIRED_GONE.has(p) ? null : p;
}

export function isRetiredPath(path: string): boolean {
  const p = retiredPath(path);
  return RETIRED_GONE.has(p) || Object.prototype.hasOwnProperty.call(MERGED, p);
}

/** 博客 slug 是否已下线(blog.ts 的列表 / 静态参数 / sitemap 都靠它挡) */
export function isRetiredSlug(slug: string): boolean {
  return isRetiredPath(`/blog/${slug}`);
}

/** 其它栏目(answers / guides / compare / vs / alternatives / for / glossary)的页是否已下线 */
export function isRetiredPage(section: string, slug: string): boolean {
  return isRetiredPath(`/${section}/${slug}`);
}

/** 会被清理的内容栏目(middleware 的 410 与正文链接改写只认这些) */
export const CONTENT_SECTIONS = ["blog", "answers", "guides", "compare", "vs", "alternatives", "for", "glossary"] as const;
const SECTION_PATH = new RegExp(`^(?:https?://(?:www\\.)?aeoeye\\.com)?(/(?:${CONTENT_SECTIONS.join("|")})/[a-z0-9-]+)/?(?:[#?].*)?$`, "i");

/**
 * 站内链接解析:正文里指向已下线页的链接,渲染时统一处理 ——
 * 指向已合并页 → 改指目标;指向已删除页 → 返回 null,调用方把它渲染成纯文本。
 * 之所以在渲染层做而不是改几百篇正文:改正文会触发编辑证据门禁(基线指纹失效),
 * 为一条死链去伪造"编辑复核"是不诚实的;渲染层一处改、全站生效、内容基线不动。
 */
export function resolveRetiredHref(href: string | undefined): string | null | undefined {
  if (!href) return href;
  const m = href.match(SECTION_PATH);
  if (!m) return href;
  const p = m[1].toLowerCase();
  if (RETIRED_GONE.has(p)) return null;
  return retiredTarget(p) ?? href;
}
