import type { AnchorHTMLAttributes } from "react";
import { resolveRetiredHref } from "@/lib/content/retired";

/**
 * 文章/内容页正文里的链接。指向已下线页的链接在这里被"拆掉"或改指合并目标,
 * 所以 Googlebot 看到的渲染结果里没有任何指向 410 页的站内链接(见 lib/content/retired.ts)。
 */
export function ContentLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const resolved = resolveRetiredHref(href);
  if (resolved === null) return <span {...rest}>{children}</span>;
  return (
    <a href={resolved ?? href} rel="noopener" {...rest}>
      {children}
    </a>
  );
}
