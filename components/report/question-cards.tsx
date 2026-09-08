"use client";

import { Trophy, AlertTriangle, CheckCircle2, XCircle, Minus } from "lucide-react";
import Markdown from "markdown-to-jsx";
import type { CompetitorStat } from "@/lib/engine/types";
import { stripMarkdown } from "@/lib/utils";
import { HighlightedText } from "./highlight";
import { Lightbox, MoreAffordance, firstSentences, useLightbox } from "./lightbox";

/**
 * 报告的三种基础卡片。抽到独立文件是因为完整报告的逐引擎区块(客户端组件,
 * 需要 tab 切换)与总览区(服务端组件)必须渲染得一模一样 —— 同一份组件,
 * 不能各写一套。
 */

export type RivalRow = { question: string; mentioned: boolean; why?: string; competitors: string[] };

/**
 * 单题竞争结果。三种结局都要能一眼分辨:
 * 你缺席且有人被推荐(输了)/ 你缺席但 AI 谁也没点名(没人赢)/ 你在答案里(守住了)。
 */
export function RivalCard({ row }: { row: RivalRow }) {
  const lost = !row.mentioned && row.competitors.length > 0;
  const nobody = !row.mentioned && row.competitors.length === 0;
  return (
    <div className="card p-5">
      <div className="relative z-10 flex items-start gap-3">
        {lost ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral" />
        ) : nobody ? (
          <Minus className="mt-0.5 h-5 w-5 shrink-0 text-ink/30" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-mint" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">“{row.question}”</p>
          {row.why && lost && <p className="mt-1.5 text-sm text-ink/55">{row.why}</p>}
          {nobody && <p className="mt-1.5 text-sm text-ink/55">AI named no brand at all — nobody won this one.</p>}
          {row.competitors.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink/40">{row.mentioned ? "Named alongside you:" : "AI picked:"}</span>
              {row.competitors.map((c) => (
                <span
                  key={c}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    row.mentioned ? "bg-ink/[0.05] text-ink/55" : "bg-coral/10 text-coral-deep"
                  }`}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {row.mentioned && row.competitors.length === 0 && (
            <p className="mt-1.5 text-sm text-ink/55">You were the only brand AI named here.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function QnaCard({
  question,
  excerpt,
  full,
  mentioned,
  note,
  brand,
  domain,
  competitors,
}: {
  question: string;
  excerpt: string;
  /** 回答完整原文(answerFull)。有它才显示"展开完整回答";旧报告没存全文,只有摘录 */
  full?: string;
  mentioned: boolean;
  note?: string;
  brand: string;
  domain?: string;
  competitors?: string[];
}) {
  const [open, show, hide] = useLightbox();
  // 灯箱里放最完整的那份;卡片上只留 1-2 句。折叠态出现整段原文是站长指出的问题。
  const fullText = (full || excerpt || "").trim();
  const hasMore = fullText.length > 0;
  // 引擎原文在落库时最多保留 6000 字符。达到上限说明用户看到的可能不是完整回答,
  // 不能再静默把半截单词/句子当成完整研究结果。
  const answerWasTrimmed = Boolean(full && full.length >= 6000);
  const displayText = answerWasTrimmed ? stripMarkdown(fullText).replace(/[*_`~]+/g, "") : fullText;
  const teaser = firstSentences(excerpt || fullText);

  const card = (
    <>
      {/* 移动端徽章独占一行:同排时问题文字只剩 193px、会折成 3-4 行窄条 */}
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="font-medium text-ink">“{question}”</p>
        {mentioned ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-mint/10 px-2.5 py-0.5 text-xs font-semibold text-mint-deep">
            <CheckCircle2 className="h-3.5 w-3.5" /> Mentioned
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/10 px-2.5 py-0.5 text-xs font-semibold text-coral-deep">
            <XCircle className="h-3.5 w-3.5" /> Absent
          </span>
        )}
      </div>
      {teaser && (
        <div className="mt-3 border-l-2 border-iris/25 pl-3">
          <p className="text-sm italic text-ink/55">
            <HighlightedText text={teaser} brand={brand} competitors={competitors} />
          </p>
          {/* 荧光标的是哪个实体 —— 同名品牌很常见,域名让用户确认"这就是我" */}
          {mentioned && domain && (
            <span className="mt-2 flex items-center gap-1.5 text-[11px] text-ink/40">
              <span className="h-2 w-2 shrink-0 rounded-full bg-mint/70" />
              {brand} <span className="text-ink/30">· {domain}</span>
            </span>
          )}
        </div>
      )}
      {hasMore && <MoreAffordance label="Read the full answer" />}
      {note && <p className="mt-2 text-xs text-ink/45">{note}</p>}
    </>
  );

  // 没有可看的全文时就不该是个按钮 —— 点了没反应比不能点更糟
  if (!hasMore) {
    return (
      <div className="card p-5">
        <div className="relative z-10">{card}</div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={show}
        className="card group w-full p-5 text-left transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-float-lg"
        aria-haspopup="dialog"
      >
        <div className="relative z-10">{card}</div>
      </button>

      <Lightbox open={open} onClose={hide} eyebrow={mentioned ? "Mentioned" : "Absent"} title={question}>
        {/* 原文中的标题、表格、链接必须按 Markdown 语义呈现,不能把模型标记直接倒给用户。 */}
        <div className="overflow-x-auto text-[15px] leading-relaxed text-ink/75 [&_a]:text-iris [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-display [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol]:space-y-1 [&_p]:mb-3 [&_table]:min-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-ink/10 [&_td]:p-2 [&_th]:border [&_th]:border-ink/10 [&_th]:bg-ink/[0.03] [&_th]:p-2 [&_ul]:mb-3 [&_ul]:space-y-1">
          <Markdown
            options={{
              forceBlock: true,
              overrides: {
                a: { props: { rel: "noopener noreferrer", target: "_blank" } },
              },
            }}
          >
            {displayText}
          </Markdown>
        </div>
        {answerWasTrimmed && (
          <p role="note" className="mt-5 border-t border-amber-500/20 pt-4 text-sm leading-relaxed text-amber-700">
            This answer was shortened for display because the source response exceeded the report limit.
          </p>
        )}
        {note && (
          <p className="mt-5 border-t border-ink/[0.06] pt-4 text-sm text-ink/50">{note}</p>
        )}
      </Lightbox>
    </>
  );
}

/** 竞品榜。你每题都被推荐时,"Beat you" 一列全零没有意义 —— 该列随数据出现/消失。 */
export function CompetitorTable({ competitors, limit = 8 }: { competitors: CompetitorStat[]; limit?: number }) {
  const anyWins = competitors.some((c) => c.winsVsYou > 0);
  return (
    <div className="card overflow-hidden">
      <table className="relative z-10 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink/40">
            <th className="px-4 py-3.5 font-medium sm:px-5">Brand</th>
            <th className="px-2 py-3.5 text-center font-medium sm:px-5">Questions</th>
            {anyWins && <th className="px-2 py-3.5 text-center font-medium sm:px-5">Beat you</th>}
          </tr>
        </thead>
        <tbody>
          {competitors.slice(0, limit).map((c, i) => (
            <tr key={c.name} className="border-t border-ink/[0.06]">
              <td className="px-4 py-3.5 font-medium sm:px-5">
                <span className="mr-2 text-ink/30">{i + 1}</span>
                {c.name}
              </td>
              <td className="px-2 py-3.5 text-center text-ink/60 sm:px-5">{c.appearsInQuestions}</td>
              {anyWins && (
                <td className="px-2 py-3.5 text-center sm:px-5">
                  {c.winsVsYou > 0 ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-coral-deep">
                      <Trophy className="h-3.5 w-3.5" />
                      {c.winsVsYou}
                    </span>
                  ) : (
                    <span className="text-ink/25">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
