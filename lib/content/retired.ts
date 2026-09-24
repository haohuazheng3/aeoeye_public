import retired from "@/content/retired.json";

/* ============================================================
   已下线的博客 URL(2026-09-24 站长指令:删掉/合并"主题稀释、跑题且没流量"的页)
   - gone   → middleware 直接回 410(诚实告诉 Google 这页没了,不做假 301)
   - merged → next.config 301 到吸收它的页(同意图重复合并)
   这份名单是**永久**的:内容门禁(scripts/verify-content-quality.mjs)会拒绝任何
   同名 slug 被重新创建 —— 否则定时管线下次又把同一批页写回来。
   ============================================================ */

export const RETIRED_GONE: ReadonlySet<string> = new Set<string>(retired.gone);
export const RETIRED_MERGED: Readonly<Record<string, string>> = retired.merged;

export function isRetiredSlug(slug: string): boolean {
  return RETIRED_GONE.has(slug) || Object.prototype.hasOwnProperty.call(RETIRED_MERGED, slug);
}

/** 合并目标的完整路径(名单里既可以写 slug,也可以写以 / 开头的任意站内路径) */
export function retiredTarget(slug: string): string | null {
  const t = RETIRED_MERGED[slug];
  if (!t) return null;
  return t.startsWith("/") ? t : `/blog/${t}`;
}

/**
 * 站内链接解析:文章正文里指向已下线页的链接,渲染时统一处理 ——
 * 指向已合并页 → 改指目标;指向已删除页 → 返回 null,调用方把它渲染成纯文本。
 * 之所以在渲染层做而不是改 300 篇 mdx:改正文会触发编辑证据门禁(基线指纹失效),
 * 为一条死链去伪造"编辑复核"是不诚实的;渲染层一处改、全站生效、内容基线不动。
 */
export function resolveRetiredHref(href: string | undefined): string | null | undefined {
  if (!href) return href;
  const m = href.match(/^(?:https?:\/\/(?:www\.)?aeoeye\.com)?\/blog\/([a-z0-9-]+)\/?(?:[#?].*)?$/i);
  if (!m) return href;
  const slug = m[1].toLowerCase();
  if (RETIRED_GONE.has(slug)) return null;
  return retiredTarget(slug) ?? href;
}
