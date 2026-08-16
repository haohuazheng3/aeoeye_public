import { CheckCircle2, XCircle, Minus, Zap, Download } from "lucide-react";
import type { AuditResult, Recommendation } from "@/lib/engine/types";
import { ScoreGauge } from "./score-gauge";
import { EngineCard } from "./engine-card";
import { UnlockBanner, LockedSection, UnlockButton } from "./unlock";
import { UpgradeRunner } from "./upgrade-runner";
import { VisibilityLadder } from "./visibility-ladder";
import { QuickWins } from "./quick-wins";
import { ShareButton } from "./share-button";
import { EngineSections } from "./engine-sections";
import { FoundationSection, FoundationHook } from "./foundation";
import { RivalCard, QnaCard, CompetitorTable, type RivalRow } from "./question-cards";
import { AuditForm } from "@/components/audit-form";

const FREE_RECS = 2;

export function ReportView({ result, id, unlocked }: { result: AuditResult; id: string; unlocked: boolean }) {
  // 已付费解锁但报告还是免费版 → 需要后台生成完整报告。
  // 判据只能是报告自己的 plan,**不能**是"还有引擎 status==inactive":引擎可能
  // 永久不可用(通道没配、DataForSEO 欠费),那样升级跑完它依然 inactive,
  // UpgradeRunner 就会再次出现 → 又 reload → 页面刷成频闪。
  const needsUpgrade = unlocked && result.meta.plan !== "full";

  /*
    付款后到报告生成完之间:整页只给进度,**不渲染旧报告**(站长 2026-08-10)。
    那份旧的只有 3 题、一个引擎,用户刚花钱买的是另一份东西 —— 先让他翻旧的,
    只会以为自己买了个寂寞。生成完页面自己刷新,一次性展示完整报告。
  */
  if (needsUpgrade) {
    return <UpgradeRunner auditId={id} brand={result.brand} />;
  }
  const liveEngine = result.engines.find((e) => e.status === "ok");
  const mainRows = result.matrix.filter((m) => m.engine === (liveEngine?.engine ?? "chatgpt"));
  // 竞品缺口全部展示(免费/付费一致,不设上限、不做锁定区)—— 让用户完整看到丢在哪
  const visibleGaps = result.gaps;
  const visibleRecs = unlocked ? result.recommendations : result.recommendations.slice(0, FREE_RECS);
  const lockedRecs = unlocked ? [] : result.recommendations.slice(FREE_RECS);
  // 主引擎(ChatGPT)侧数据全开放(问答全展示);付费卖点 = 另外 4 个引擎 + 7 道新题
  const visibleMatrix = mainRows;
  const lockedEngineCount = result.engines.filter((e) => e.status === "inactive").length;
  const showEngineUpsell = !unlocked && lockedEngineCount > 0;
  const liveLabel = liveEngine?.label ?? "ChatGPT";
  // 你每题都被推荐时,竞品并没有"取代"你 —— 标题要跟着变,否则自相矛盾
  const anyRivalWins = result.competitors.some((c) => c.winsVsYou > 0);
  // 竞争视角:每一道题都要有交代。只列"有竞品赢你"的那几条会让 5 题变 4 条,
  // 读者会以为漏了数据 —— 你被提及的题、以及 AI 谁也没点名的题,同样要出现。
  const gapByQuestion = new Map(result.gaps.map((g) => [g.question, g]));
  const rivalRows: RivalRow[] = mainRows.map((m) => {
    const gap = gapByQuestion.get(m.question);
    return {
      question: m.question,
      mentioned: m.mentioned,
      why: gap?.why,
      // 缺口行用引擎侧算好的(已过滤通用 AI 模型);被提及的行直接读该题竞品
      competitors: gap?.competitorsPresent ?? m.competitorsMentioned.slice(0, 6),
    };
  });
  // 完整报告:逐引擎区块接管"竞品/缺口/问答"三块,总览区只留跨引擎结论,
  // 否则同样的内容会先按汇总出现一次、再按引擎出现五次。
  const perEngine = unlocked && (result.breakdown?.length ?? 0) > 1;
  // 地基层只在付费且模块真的生成出来时才展示。生成失败时静默降级回站点信号,
  // 不给用户看空壳模块。
  const hasFoundation = unlocked && (result.foundation?.modules.length ?? 0) > 0;

  // 透明容器 —— 露出全站 BgAurora 蒸汽背景;一切内容都是悬浮玻璃模块,模块间大留白
  return (
    <div className="container-tight space-y-8 py-10 sm:space-y-10 sm:py-16">
      {/* 头部模块 —— 品牌 · 总分,一个悬浮玻璃 card */}
      <div className="card p-7 sm:p-9">
        <div className="relative z-10">
          {/* 390px 下 eyebrow 曾被两颗按钮挤到 80px 宽、折成三行 —— 让它整行独占,按钮另起一行 */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
            <p className="eyebrow shrink-0">AI Visibility Report</p>
            <div className="flex items-center gap-2">
              {/* 已付费:随时自取 PDF,不必等邮件 */}
              {unlocked && (
                <a
                  href={`/api/audit/${id}/pdf`}
                  className="btn-ghost px-3 py-2 text-sm sm:px-4"
                  download
                  aria-label="Download the full report as PDF"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">PDF</span>
                </a>
              )}
              <ShareButton />
            </div>
          </div>

          {/*
            两列两行栅格:桌面左栏(品牌 → 裁决)+ 右栏跨行的分数盘;
            移动端塌成单列,顺序变成 品牌 → 分数 → 裁决 ——
            分数是全页最重要的数字,之前它排在长段裁决之后、要滚到 637px 才看见。
          */}
          <div className="mt-6 grid items-center gap-x-8 gap-y-6 sm:grid-cols-[1fr_auto]">
            <div className="sm:col-start-1 sm:row-start-1">
              <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{result.brand}</h1>
              <p className="mt-1.5 text-sm text-ink/45">
                {result.domain} · {result.category}
              </p>
            </div>
            <div className="mx-auto sm:col-start-2 sm:row-span-2 sm:row-start-1">
              <ScoreGauge score={result.overallScore} />
              <p className="mt-1 text-center text-[11px] text-ink/40">AI visibility score</p>
            </div>
            <div className="sm:col-start-1 sm:row-start-2">
              <p className="max-w-xl leading-relaxed text-ink/70">{result.summary}</p>
              {!unlocked && result.meta.engineNote && (
                <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-iris/10 px-3.5 py-1.5 text-xs font-medium text-iris">
                  <Zap className="h-3.5 w-3.5" /> {result.meta.engineNote}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI 可见度阶梯 —— 你在 AI 眼里到了哪一层 */}
      <VisibilityLadder result={result} />

      {/* 引擎表现 */}
      <section className="space-y-5">
        <SectionHead title="How each AI sees you" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.engines.map((e) => (
            <EngineCard key={e.engine} engine={e} unlocked={unlocked} />
          ))}
        </div>
        {/* 未解锁:引擎卡区就地转化(免费只实时查 ChatGPT,其余 4 个锁着)。
            这里同时给出"最强档判卷"的钩子 —— 只承诺档位,不点名型号。 */}
        {!unlocked && lockedEngineCount > 0 && (
          <div className="surface flex flex-wrap items-center justify-between gap-4 p-5">
            <p className="text-sm text-ink/60">
              <span className="font-semibold text-ink">{lockedEngineCount} more engines</span>, 10 questions instead of
              3, re-analysed by our most capable model.
            </p>
            <UnlockButton auditId={id} className="btn-primary shrink-0">
              Unlock full report
            </UnlockButton>
          </div>
        )}
      </section>

      {/* 竞争视角:每一道买家问题的胜负,一题不漏(完整报告交给逐引擎区) */}
      {!perEngine && rivalRows.length > 0 && (
        <section className="space-y-5">
          <SectionHead
            title="Where competitors win"
            sub={`All ${rivalRows.length} buyer questions — who ${liveLabel} named, and whether you were in the answer.`}
          />
          <div className="space-y-3.5">
            {rivalRows.map((r, i) => (
              <RivalCard key={i} row={r} />
            ))}
            {showEngineUpsell && (
              <EngineUpsell auditId={id}>
                <div className="space-y-3.5">
                  {rivalRows.slice(0, 2).map((r, i) => (
                    <RivalCard key={i} row={r} />
                  ))}
                </div>
              </EngineUpsell>
            )}
          </div>
        </section>
      )}

      {/* 竞品排行(完整报告交给逐引擎区) */}
      {!perEngine && result.competitors.length > 0 && (
        <section className="space-y-5">
          <SectionHead
            title={anyRivalWins ? "Who AI recommends instead" : "Who else AI recommends"}
            sub={
              anyRivalWins
                ? `Brands ${liveLabel} named — and how often they took a question you missed.`
                : `Brands ${liveLabel} named alongside you. You appeared in every question, so nobody displaced you.`
            }
          />
          <CompetitorTable competitors={result.competitors} />
          {showEngineUpsell && (
            <EngineUpsell auditId={id}>
              <CompetitorTable competitors={result.competitors} limit={3} />
            </EngineUpsell>
          )}
        </section>
      )}

      {/* 问答矩阵(完整报告交给逐引擎区) */}
      {!perEngine && (
      <section className="space-y-5">
        <SectionHead
          title="The questions, the answers"
          sub={`Every buyer question we asked ${liveLabel}, answered exactly as a buyer would see it.`}
        />
        <div className="space-y-3.5">
          {visibleMatrix.map((m) => (
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
          {showEngineUpsell && (
            <EngineUpsell auditId={id}>
              <div className="space-y-3.5">
                {visibleMatrix.slice(0, 2).map((m) => (
                  <QnaCard
                    key={m.questionId}
                    question={m.question}
                    excerpt={m.answerExcerpt}
                    full={m.answerFull}
                    mentioned={m.mentioned}
                    brand={result.brand}
                    domain={result.domain}
                  />
                ))}
              </div>
            </EngineUpsell>
          )}
        </div>
      </section>
      )}

      {/* 完整报告:逐引擎完整分析(切换器 + 每个引擎的 4 个模块) */}
      {perEngine && <EngineSections result={result} />}

      {/* 地基层五个模块 —— 与其余区块同级顺排,不分 AEO/SEO 区。
          免费只放一个带真实数字的钩子,不是五个锁。 */}
      {hasFoundation && <FoundationSection foundation={result.foundation!} />}
      {!unlocked && result.foundation && <FoundationHook foundation={result.foundation} auditId={id} />}

      {/* 站点信号 —— 免费报告的技术部分就靠它;
          付费时地基层已经把这 8 条全部覆盖且更深,再放一遍就是同一件事说两次 */}
      {result.site?.reachable && !hasFoundation && (
        <section className="space-y-5">
          <SectionHead title="Your AEO readiness" />
          <div className="card overflow-hidden">
            <div className="relative z-10">
              {result.site.signals.map((s, i) => (
                <div key={s.id} className={`flex items-start gap-3 p-4 ${i > 0 ? "border-t border-ink/[0.06]" : ""}`}>
                  <SignalIcon status={s.status} />
                  <div>
                    <p className="text-sm font-medium text-ink">{s.label}</p>
                    <p className="text-xs text-ink/50">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 建议 */}
      <section className="space-y-5">
        <SectionHead title="Your fix roadmap" />
        <div className="space-y-3.5">
          {visibleRecs.map((r, i) => (
            <RecCard key={i} rec={r} n={i + 1} />
          ))}
          {!unlocked && lockedRecs.length > 0 && (
            <LockedSection
              auditId={id}
              title={`${lockedRecs.length} more fixes, ranked by impact`}
              blurb="The complete roadmap — every action, prioritized, with exactly what to change."
            >
              {/* 骨架占位,不是真内容:blur 只是 CSS,把付费建议渲染进 DOM 等于
                  查看源码就能白读(实测泄漏过 3 条完整建议)。付费墙必须挡在
                  数据层,不能靠视觉。 */}
              <div className="space-y-3.5 p-1">
                {lockedRecs.slice(0, 3).map((_, i) => (
                  <RecCardSkeleton key={i} n={FREE_RECS + i + 1} />
                ))}
              </div>
            </LockedSection>
          )}
        </div>
      </section>

      {/* 可复制修复代码 —— $29 完整报告专属 */}
      {unlocked && result.url && <QuickWins result={result} />}

      {/* 付费墙 */}
      {!unlocked && <UnlockBanner auditId={id} questionCount={result.questions.length} />}

      {/* 再测一个 */}
      <div className="card p-8 text-center sm:p-10">
        <div className="relative z-10">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Check another brand</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/55">Audit a competitor, or a client. Free.</p>
          <div className="mx-auto mt-6 max-w-lg">
            <AuditForm source="report" variant="inline" cta="Audit" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      {sub && <p className="mt-1 text-sm text-ink/45">{sub}</p>}
    </div>
  );
}

/**
 * 付费卖点统一入口:主引擎(ChatGPT)侧数据全开放,锁的是"另外 4 个引擎的同款分析"。
 * 模糊预览用本模块的真实内容做视觉占位,风格与 How each AI sees you 一致。
 */
function EngineUpsell({ auditId, children }: { auditId: string; children: React.ReactNode }) {
  return (
    <LockedSection
      auditId={auditId}
      title="See Claude, Gemini, Google AI & Perplexity"
      blurb="Same questions, four more engines — plus 7 more buyer questions."
    >
      <div className="p-1">{children}</div>
    </LockedSection>
  );
}

/**
 * 锁定区的建议占位。与 RecCard 同构(编号、标题行、两行正文),但**不含任何真实文案** ——
 * 用户看到的是"还有内容"的形状,而不是内容本身。
 */
function RecCardSkeleton({ n }: { n: number }) {
  return (
    <div className="card p-5">
      <div className="relative z-10 flex items-start gap-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-iris/10 text-xs font-bold text-iris">
          {n}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-4 w-2/5 rounded-full bg-ink/[0.08]" />
            <div className="h-3.5 w-20 rounded-full bg-iris/10" />
          </div>
          <div className="h-2.5 w-full rounded-full bg-ink/[0.06]" />
          <div className="h-2.5 w-3/4 rounded-full bg-ink/[0.06]" />
        </div>
      </div>
    </div>
  );
}

function RecCard({ rec, n }: { rec: Recommendation; n: number }) {
  const highImpact = rec.impact === "high";
  return (
    <div className="card p-5">
      <div className="relative z-10 flex items-start gap-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-iris/10 text-xs font-bold text-iris">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-semibold">{rec.title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                highImpact ? "bg-iris/10 text-iris" : "bg-ink/[0.05] text-ink/50"
              }`}
            >
              {rec.impact} impact
            </span>
            <span className="rounded-full bg-ink/[0.05] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink/45">
              {rec.effort}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-ink/60">{rec.detail}</p>
        </div>
      </div>
    </div>
  );
}

function SignalIcon({ status }: { status: "pass" | "warn" | "fail" }) {
  if (status === "pass") return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-mint" />;
  if (status === "warn") return <Minus className="mt-0.5 h-5 w-5 shrink-0 text-ink/30" />;
  return <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-coral" />;
}
