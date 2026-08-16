"use client";

import {
  Layers,
  Search,
  AlertTriangle,
  Wrench,
  LayoutList,
  FileText,
  Gauge,
  Link2,
  ShieldCheck,
  Quote,
} from "lucide-react";
import type { SeoFinding, SeoFoundation, SeoModule, SeoModuleId } from "@/lib/engine/types";
import { LockedSection } from "./unlock";
import { Lightbox, MoreAffordance, firstSentences, useLightbox } from "./lightbox";

/* ============================================================
   地基层 · SEO —— 五个维度

   改版要点(站长 2026-08-10):文字精炼保持不变,但每个维度要有自己的**形状**。
   原来五个模块长得一模一样(标题 + 一列相同的小卡),读起来像同一份东西重复五遍。
   现在:一个维度 = 一张卡,左边是分数环与图标,右边是结论与严重度分布,
   点开灯箱看全部发现与原文证据。
   ============================================================ */

const SEVERITY: Record<SeoFinding["severity"], { label: string; chip: string; dot: string; rank: number }> = {
  critical: { label: "Critical", chip: "bg-coral/10 text-coral-deep", dot: "bg-coral", rank: 0 },
  important: { label: "Important", chip: "bg-amber-500/10 text-amber-700", dot: "bg-amber-500", rank: 1 },
  minor: { label: "Minor", chip: "bg-ink/[0.05] text-ink/55", dot: "bg-ink/25", rank: 2 },
  ok: { label: "Solid", chip: "bg-mint/10 text-mint-deep", dot: "bg-mint", rank: 3 },
};

/** 每个维度一个图标 —— 让五张卡在视觉上先分得开,再谈内容 */
const MODULE_ICON: Record<SeoModuleId, typeof Wrench> = {
  technical: Wrench,
  structure: LayoutList,
  content: FileText,
  performance: Gauge,
  authority: Link2,
};

function scoreTone(score: number | null): { ring: string; text: string } {
  if (score === null) return { ring: "stroke-ink/15", text: "text-ink/35" };
  if (score >= 70) return { ring: "stroke-mint", text: "text-mint-deep" };
  if (score >= 40) return { ring: "stroke-amber-500", text: "text-amber-700" };
  return { ring: "stroke-coral", text: "text-coral-deep" };
}

/** 小分数环 —— 与总分表盘同族,但更小、更安静,不抢主分数的戏 */
function ScoreRing({ score }: { score: number | null }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const tone = scoreTone(score);
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r={r} className="fill-none stroke-ink/[0.07]" strokeWidth="5" />
        {pct > 0 && (
          <circle
            cx="34"
            cy="34"
            r={r}
            className={`fill-none ${tone.ring}`}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-display text-lg font-semibold tabular-nums ${tone.text}`}>
          {score === null ? "—" : score}
        </span>
      </div>
    </div>
  );
}

/** 严重度分布条 —— 不用读完所有发现,先看出这个维度有多糟 */
function SeverityBar({ findings }: { findings: SeoFinding[] }) {
  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const order: SeoFinding["severity"][] = ["critical", "important", "minor", "ok"];
  const present = order.filter((s) => counts[s] > 0);
  if (!present.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {present.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink/50">
          <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY[s].dot}`} />
          {counts[s]} {SEVERITY[s].label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

function FindingRow({ f }: { f: SeoFinding }) {
  const sev = SEVERITY[f.severity];
  return (
    <div className="border-t border-ink/[0.06] py-4 first:border-0 first:pt-0">
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="font-medium text-ink">{f.title}</p>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${sev.chip}`}>
          {sev.label}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/60">{f.detail}</p>
      {/* observed 的发现必须能引用它看到的原文 —— 这是防幻觉机制,展示出来才有意义 */}
      {f.quote && (
        <div className="mt-2.5 flex gap-2 rounded-xl bg-ink/[0.03] p-3">
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/25" />
          <p className="text-xs italic leading-relaxed text-ink/50">{f.quote}</p>
        </div>
      )}
    </div>
  );
}

/** 一个维度 = 一张可点开的卡 */
function ModuleCard({ m }: { m: SeoModule }) {
  const [open, show, hide] = useLightbox();
  const findings = [...(m.findings ?? [])].sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank);
  const Icon = MODULE_ICON[m.id] ?? ShieldCheck;
  const worst = findings[0];

  return (
    <>
      <button
        onClick={show}
        aria-haspopup="dialog"
        className="card group w-full p-5 text-left transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-float-lg sm:p-6"
      >
        <div className="relative z-10 flex items-start gap-4 sm:gap-5">
          <ScoreRing score={m.score} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 text-iris" />
              <span className="eyebrow">{m.label}</span>
            </div>
            {/* verdict 是答案前置的一句话结论 —— 它就是这张卡的标题 */}
            <p className="mt-1.5 font-display text-[15px] font-semibold leading-snug text-ink sm:text-base">
              {m.verdict}
            </p>
            {worst && <p className="mt-1.5 text-sm leading-relaxed text-ink/55">{firstSentences(worst.detail, 1, 120)}</p>}
            <SeverityBar findings={findings} />
            {(findings.length > 0 || m.dataGap) && (
              <MoreAffordance
                label={findings.length > 0 ? `See all ${findings.length} findings` : "See the detail"}
              />
            )}
          </div>
        </div>
      </button>

      <Lightbox open={open} onClose={hide} eyebrow={m.label} title={m.verdict}>
        {m.score !== null && (
          <div className="mb-5 flex items-center gap-4 rounded-2xl bg-ink/[0.03] p-4">
            <ScoreRing score={m.score} />
            <div>
              <p className="text-sm font-semibold text-ink">{m.score}/100 on this layer</p>
              {m.sources?.length > 0 && (
                <p className="mt-0.5 text-xs text-ink/45">Analysed by {m.sources.join(" · ")}</p>
              )}
            </div>
          </div>
        )}
        {m.dataGap && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl bg-amber-500/[0.07] p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm leading-relaxed text-ink/60">{m.dataGap}</p>
          </div>
        )}
        <div>
          {findings.map((f, i) => (
            <FindingRow key={i} f={f} />
          ))}
        </div>
      </Lightbox>
    </>
  );
}

/** 完整报告:五个维度并排成网格,一眼看全,细节进灯箱 */
export function FoundationSection({ foundation }: { foundation: SeoFoundation }) {
  const modules = (foundation.modules ?? []).filter((m) => (m.findings?.length ?? 0) > 0 || m.dataGap);
  if (!modules.length) return null;

  const total = modules.reduce((n, m) => n + (m.findings ?? []).filter((f) => f.severity !== "ok").length, 0);

  return (
    <section className="space-y-5">
      <div>
        <p className="eyebrow flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" /> The foundation
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
          What your site does to your AI visibility
        </h2>
        <p className="mt-1 text-sm text-ink/45">
          {total > 0
            ? `${total} things to fix across ${modules.length} layers. Tap any layer for the full findings.`
            : `${modules.length} layers checked. Tap any layer for the full findings.`}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {modules.map((m) => (
          <ModuleCard key={m.id} m={m} />
        ))}
      </div>
    </section>
  );
}

/**
 * 免费报告:**一个**锁定钩子。数字由代码从实测事实包数出,付费后每条都会展开。
 */
export function FoundationHook({ foundation, auditId }: { foundation: SeoFoundation; auditId: string }) {
  const n = foundation.issueCount;
  const dims = [
    "Technical SEO",
    "Page structure & keywords",
    "Content quality & E-E-A-T",
    "Mobile performance (real-user data)",
    "Backlinks & brand authority",
  ];
  return (
    <section className="space-y-5">
      <div>
        <p className="eyebrow flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" /> The foundation
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
          {n > 0 ? (
            <>
              We found <span className="text-iris">{n}</span> technical issues holding your AI visibility down
            </>
          ) : (
            <>Your technical foundation checks out — here’s the full breakdown</>
          )}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/55">
          AI reads your site through crawlers and cites what it can parse. We already crawled yours. The full report
          covers five layers — three models audit each one, merged into a single list of what to fix.
        </p>
      </div>
      <LockedSection
        auditId={auditId}
        title={n > 0 ? `${n} issues found across 5 layers` : "Full foundation breakdown"}
        blurb="Unlock to see exactly what’s broken and what to fix first."
      >
        <div className="grid gap-3 p-6 sm:grid-cols-2">
          {dims.map((d) => (
            <div key={d} className="rounded-2xl bg-white/50 p-4">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-iris" />
                <span className="text-sm font-semibold text-ink/80">{d}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="h-2 w-full rounded-full bg-ink/[0.06]" />
                <div className="h-2 w-4/5 rounded-full bg-ink/[0.06]" />
              </div>
            </div>
          ))}
        </div>
      </LockedSection>
    </section>
  );
}
