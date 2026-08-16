import { List } from "lucide-react";

export type TocItem = { id: string; text: string };

/** 目录(Table of Contents)—— 提升结构信号与 AI 可解析性 */
export function TableOfContents({ items }: { items: TocItem[] }) {
  if (items.length < 3) return null;
  return (
    <nav aria-label="Table of contents" className="my-8 surface p-5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">
        <List className="h-3.5 w-3.5" /> On this page
      </p>
      <ol className="mt-3 space-y-1.5">
        {items.map((it, i) => (
          <li key={it.id} className="text-sm">
            <a href={`#${it.id}`} className="text-ink/70 transition hover:text-iris">
              <span className="mr-2 text-ink/30">{String(i + 1).padStart(2, "0")}</span>
              {it.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
