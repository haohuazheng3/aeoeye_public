"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { AuditResult, EngineBreakdown } from "@/lib/engine/types";
import { LadderCompact } from "./ladder-compact";
import { RivalCard, QnaCard, CompetitorTable, type RivalRow } from "./question-cards";

/**
 * 完整报告的逐引擎区。
 *
 * 排版决策:5 个引擎 × 4 个模块 = 20 个区块,平铺会让报告彻底读不下去。
 * 所以做成引擎切换 —— 一次只看一个引擎的完整分析,切换成本极低,且因为
 * 所有引擎问的是同一批 5 道题,来回切换天然形成对比。切换器本身用 glass-bar
 * 质感,与站点 UI 一致。
 */
export function EngineSections({ result }: { result: AuditResult }) {
  // 没返回内容的引擎不进切换器 —— 否则会显示成"它推荐了别人",那是假话
  const failed = new Set(result.engines.filter((e) => e.status === "error").map((e) => e.engine));
  const breakdown = (result.breakdown ?? []).filter((b) => !failed.has(b.engine));
  const [active, setActive] = useState(breakdown[0]?.engine ?? "chatgpt");
  const current = breakdown.find((b) => b.engine === active) ?? breakdown[0];
  if (!current) return null;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Engine by engine</h2>
        <p className="mt-1 text-sm text-ink/45">
          All {breakdown.length} engines answered the same {result.questions.length} buyer questions. Switch to see how
          each one talks about you.
        </p>
      </div>

      {/*
        引擎切换器 —— 每颗按钮带该引擎的提及数,未选中也能一眼比出强弱。

        粘顶:逐引擎区块很长(单引擎就有阶梯+竞品+5 道问答),读到下面再想换引擎
        得一路滚回来。改成 sticky 吸附在 headbar 正下方(header 是 sticky top-3、
        高 56 → 底边 68,故这里取 76 留 8px 呼吸),滚出本区块时自然归位。
        z-30 低于 header 的 z-50,所以是"塞进 headbar 下面"而不是盖住它。

        390px 下 5 颗按钮会折成 3 行、把 rounded-full 胶囊撑成 146px 高的怪形状,
        故移动端单行横向滑动(原生 tab 手感,省 90px 纵向),桌面宽度够时铺满一行。
      */}
      {/*
        top-[80px]:header 底边 68 + 12px 呼吸。原来是 76(8px),两条玻璃条几乎粘在
        一起,吸附时读起来像 headbar 自己长高了一截。
      */}
      <div className="sticky top-[80px] z-30">
        {/*
          滚动**必须**发生在内层。rim light(.glass-bar::after)是 absolute inset-0,
          包含块是 padding box —— 一旦让 .glass-bar 自己横向滚动,那条 1px 描边就
          跟着内容一起走,在按钮中间划出一道线(390px 下滚到 Gemini 位置最明显,
          实测 scrollWidth 702 > clientWidth 333)。外层只负责玻璃与描边,内层负责滚。
        */}
        <div className="glass-bar p-1.5">
          <div className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            {breakdown.map((b) => {
              const rows = result.matrix.filter((m) => m.engine === b.engine);
              const hits = rows.filter((m) => m.mentioned).length;
              const isActive = b.engine === active;
              return (
                <button
                  key={b.engine}
                  onClick={() => setActive(b.engine)}
                  aria-pressed={isActive}
                  /*
                    选中态 = 墨色胶囊(站长 2026-08-10 指定保留这个风格)。
                    它与 btn-primary 是同一套墨色语言,选中感最强。
                    曾经出现的"headbar 下方多一条黑条"不是配色的锅,是这条 bar 吸附时
                    只离 header 8px —— 两条玻璃粘在一起,墨色胶囊就像长在 header 上。
                    间距已拉到 12px(top-[80px]),配色照旧。
                  */
                  className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                    isActive ? "text-white shadow-[0_6px_16px_-6px_rgba(12,14,22,0.5)]" : "text-ink/55 hover:text-ink"
                  }`}
                  style={isActive ? { backgroundImage: "linear-gradient(180deg, #242a40, #0c0e16 62%)" } : undefined}
                >
                  {b.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      isActive
                        ? "bg-white/20 text-white"
                        : hits > 0
                          ? "bg-mint/15 text-mint-deep"
                          : "bg-coral/10 text-coral-deep"
                    }`}
                  >
                    {hits}/{rows.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <EnginePanel result={result} b={current} />
    </section>
  );
}

function EnginePanel({ result, b }: { result: AuditResult; b: EngineBreakdown }) {
  const rows = result.matrix.filter((m) => m.engine === b.engine);
  const gapByQuestion = new Map(b.gaps.map((g) => [g.question, g]));
  const rivalRows: RivalRow[] = rows.map((m) => {
    const gap = gapByQuestion.get(m.question);
    return {
      question: m.question,
      mentioned: m.mentioned,
      why: gap?.why,
      competitors: gap?.competitorsPresent ?? m.competitorsMentioned.slice(0, 6),
    };
  });
  const hits = rows.filter((m) => m.mentioned).length;

  return (
    <div className="space-y-8">
      {/* 该引擎的阶梯 + 一句结论 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <LadderCompact v={b.visibility} engineLabel={b.label} />
        <div className="surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/40">Verdict on {b.label}</p>
            {/* 自证测的是哪一档模型 —— 真实用户默认拿到的版本,不是便宜小模型 */}
            {b.modelName && (
              <span className="rounded-full bg-ink/[0.05] px-2.5 py-0.5 font-mono text-[10px] text-ink/45">
                {b.modelName}
              </span>
            )}
          </div>
          <p className="mt-2.5 flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            {hits > 0 ? (
              <>
                <CheckCircle2 className="h-5 w-5 shrink-0 text-mint" />
                Named in {hits} of {rows.length}
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 shrink-0 text-coral" />
                Never named
              </>
            )}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink/60">
            {hits === rows.length
              ? `${b.label} recommended you on every question we asked.`
              : hits > 0
                ? `${b.label} left you out of ${rows.length - hits} of ${rows.length} answers${
                    b.competitors[0] ? ` — ${b.competitors[0].name} took the most of them.` : "."
                  }`
                : `${b.label} recommended other brands on all ${rows.length} questions${
                    b.competitors[0] ? `, led by ${b.competitors[0].name}.` : "."
                  }`}
          </p>
        </div>
      </div>

      <SubSection title="Where competitors win" sub={`Every question, and whether ${b.label} put you in the answer.`}>
        <div className="space-y-3.5">
          {rivalRows.map((r, i) => (
            <RivalCard key={i} row={r} />
          ))}
        </div>
      </SubSection>

      {b.competitors.length > 0 && (
        <SubSection
          title="Who AI recommends instead"
          sub={`Brands ${b.label} named${
            b.competitors.some((c) => c.winsVsYou > 0) ? " — and how often they took a question you missed." : "."
          }`}
        >
          <CompetitorTable competitors={b.competitors} />
        </SubSection>
      )}

      <SubSection title="The questions, the answers" sub={`What ${b.label} actually said, word for word.`}>
        <div className="space-y-3.5">
          {rows.map((m) => (
            <QnaCard
              key={m.questionId}
              question={m.question}
              excerpt={m.answerExcerpt}
              full={m.answerFull}
              mentioned={m.mentioned}
              note={m.note}
              brand={result.brand}
              domain={result.domain}
            />
          ))}
        </div>
      </SubSection>
    </div>
  );
}

function SubSection({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
        {sub && <p className="mt-0.5 text-sm text-ink/45">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
