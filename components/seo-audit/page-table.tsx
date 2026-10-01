import type { ReactNode } from "react";

/* ============================================================
   横向滚动表格 —— 页面级表、PSI 审计表、关键词/竞品表共用。

   390px 守则:滚动发生在**内层容器**,外层 card 的圆角与描边不跟着滚;
   第一列 sticky,横向滚到最右仍看得见"这一行是哪个页面"。
   父级若是 grid/flex 子项,记得给 min-w-0,否则表格会把整页撑出横向滚动条。
   ============================================================ */

export interface PageTableColumn {
  key: string;
  label: string;
  /** 附加到该列所有单元格(如 text-right / tabular-nums / min-w) */
  className?: string;
}

export function PageTable({
  columns,
  rows,
  caption,
  minWidth = 720,
  empty = "Nothing to show.",
}: {
  columns: PageTableColumn[];
  rows: Record<string, ReactNode>[];
  caption?: string;
  /** 表格最小宽度(px);小于容器时表格铺满,大于时容器横向滚动 */
  minWidth?: number;
  empty?: string;
}) {
  if (!rows.length) return <p className="text-sm text-ink/45">{empty}</p>;
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-white/60 bg-white/40">
      <table className="w-full border-collapse text-left text-[13px]" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink/[0.06]">
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                className={`whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 ${
                  i === 0 ? "sticky left-0 z-10 bg-white/90 backdrop-blur" : ""
                } ${c.className ?? ""}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-ink/[0.05] last:border-0">
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`px-3 py-2.5 align-top text-ink/75 ${
                    i === 0 ? "sticky left-0 z-10 max-w-[220px] bg-white/90 font-medium text-ink backdrop-blur" : ""
                  } ${c.className ?? ""}`}
                >
                  {r[c.key] ?? <span className="text-ink/30">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
