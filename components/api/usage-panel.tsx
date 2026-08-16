"use client";

import { useState } from "react";
import { ChevronDown, CircleCheck, CircleX, Info } from "lucide-react";
import type { UsageOverview, UsageRow } from "@/lib/api-keys";
import type { CostEntry } from "@/lib/cost";

/**
 * 用量与花费。设计目标只有一条:**站长能一眼看清这次调用到底花了多少、花在哪**。
 *
 * 所以每一处金额都标出它是实测还是估算:
 *   · measured  = 供应商在响应里直接回的扣费(DataForSEO 的 task.cost);
 *   · estimated = 我们拿实测 token 数 × 本地价目表算的。
 * 把两者混成一个数字很好看,但那是个假账单 —— 供应商调价时你不会知道。
 */
export function UsagePanel({ usage }: { usage: UsageOverview }) {
  const t = usage.totals;
  return (
    <section className="space-y-5">
      <div>
        <p className="eyebrow">Usage</p>
        <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">What your calls cost</h2>
        <p className="mt-1.5 text-sm text-ink/50">
          Every call is metered down to the individual provider request. Your account is unmetered — this is what it
          costs us to serve it.
        </p>
      </div>

      {/* 总览 —— 四个数,不堆更多 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total spend" value={money(t.costUsd)} sub={`${t.calls} ${t.calls === 1 ? "call" : "calls"}`} big />
        <Stat label="Avg per call" value={money(t.avgCostUsd)} sub={`${Math.round(t.avgDurationMs / 1000)}s average`} />
        <Stat
          label="Tokens"
          value={compact(t.inputTokens + t.outputTokens)}
          sub={`${compact(t.inputTokens)} in · ${compact(t.outputTokens)} out`}
        />
        <Stat
          label="Outcome"
          value={`${t.succeeded} ok`}
          sub={t.failed > 0 ? `${t.failed} failed (still billed)` : "no failures"}
          tone={t.failed > 0 ? "warn" : "ok"}
        />
      </div>

      {/* 实测 vs 估算 —— 这块必须显眼,它决定上面那个总数有多可信 */}
      <div className="surface flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink/40">Measured</p>
          <p className="mt-0.5 font-display text-lg font-semibold">{money(t.measuredUsd)}</p>
          <p className="text-xs text-ink/45">Billed amounts returned by the provider</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink/40">Estimated</p>
          <p className="mt-0.5 font-display text-lg font-semibold">{money(t.estimatedUsd)}</p>
          <p className="text-xs text-ink/45">Real token counts × our price table</p>
        </div>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink/45 sm:max-w-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Token counts come straight from the API responses. The per-token prices are ours to maintain, so the estimated
          half moves if a provider changes pricing before we update the table.
        </p>
      </div>

      {usage.daily.length > 0 && <DailyChart daily={usage.daily} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="By provider" rows={usage.byProvider.map((p) => ({ label: p.provider, ...p }))} total={t.costUsd} />
        <Breakdown title="By stage" rows={usage.byStage.map((s) => ({ label: s.stage, ...s }))} total={t.costUsd} />
      </div>

      <CallLog rows={usage.rows} />
    </section>
  );
}

function DailyChart({ daily }: { daily: { day: string; calls: number; costUsd: number }[] }) {
  const max = Math.max(...daily.map((d) => d.costUsd), 0.000001);
  return (
    <div className="card p-6">
      <div className="relative z-10">
        <p className="text-[11px] uppercase tracking-wider text-ink/40">Last 30 days</p>
        <div className="mt-5 flex h-28 items-end gap-1.5">
          {daily.map((d) => (
            <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-indigo-400 to-violet-500 transition group-hover:opacity-80"
                style={{ height: `${Math.max(4, (d.costUsd / max) * 100)}%` }}
              />
              {/* 悬浮读数 —— 柱子太窄放不下文字,又不想为此加图表库 */}
              <span className="pointer-events-none absolute -top-9 z-10 hidden whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] font-medium text-white group-hover:block">
                {d.day.slice(5)} · {money(d.costUsd)} · {d.calls}×
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; usd: number; calls: number }[];
  total: number;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.usd), 0.000001);
  return (
    <div className="card p-6">
      <div className="relative z-10">
        <p className="text-[11px] uppercase tracking-wider text-ink/40">{title}</p>
        <div className="mt-4 space-y-3">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium text-ink/75">{r.label}</span>
                <span className="shrink-0 tabular-nums text-ink/55">
                  {money(r.usd)}
                  <span className="ml-2 text-xs text-ink/35">
                    {total > 0 ? `${Math.round((r.usd / total) * 100)}%` : "—"}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500"
                  style={{ width: `${(r.usd / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CallLog({ rows }: { rows: UsageRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="relative z-10 text-sm text-ink/45">No API calls yet. Your first request will show up here.</p>
      </div>
    );
  }
  return (
    <div className="card p-6 sm:p-7">
      <div className="relative z-10">
        <p className="text-[11px] uppercase tracking-wider text-ink/40">Every call</p>
        <div className="mt-4 divide-y divide-ink/[0.05]">
          {rows.map((r) => {
            const isOpen = open === r.id;
            const entries = (r.costBreakdown ?? []) as CostEntry[];
            return (
              <div key={r.id}>
                <button
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="flex w-full items-center gap-3 py-3.5 text-left"
                >
                  {r.status === "succeeded" ? (
                    <CircleCheck className="h-4 w-4 shrink-0 text-mint-deep" />
                  ) : (
                    <CircleX className="h-4 w-4 shrink-0 text-coral-deep" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink/80">{r.input || r.endpoint}</span>
                    <span className="block text-xs text-ink/40">
                      {new Date(r.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}
                      {r.error ? ` · ${r.error.slice(0, 60)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-sm font-semibold tabular-nums">
                      {money(r.costMicroUsd / 1e6)}
                    </span>
                    <span className="block text-xs text-ink/40">{compact(r.inputTokens + r.outputTokens)} tok</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-ink/30 transition ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOpen && (
                  <div className="pb-4 pl-7">
                    {entries.length === 0 ? (
                      <p className="text-xs text-ink/40">No provider calls were recorded for this request.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[30rem] text-xs">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-ink/35">
                              <th className="pb-2 font-semibold">Provider</th>
                              <th className="pb-2 font-semibold">Resource</th>
                              <th className="pb-2 font-semibold">Stage</th>
                              <th className="pb-2 text-right font-semibold">Tokens</th>
                              <th className="pb-2 text-right font-semibold">Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mergeEntries(entries).map((e, i) => (
                              <tr key={i} className="border-t border-ink/[0.04]">
                                <td className="py-1.5 pr-3 text-ink/60">{e.provider}</td>
                                <td className="py-1.5 pr-3 font-mono text-[11px] text-ink/50">{e.resource}</td>
                                <td className="py-1.5 pr-3 text-ink/50">
                                  {e.stage}
                                  <span className="ml-1.5 text-ink/30">×{e.count}</span>
                                </td>
                                <td className="py-1.5 pr-3 text-right tabular-nums text-ink/50">
                                  {e.inputTokens + e.outputTokens > 0
                                    ? compact(e.inputTokens + e.outputTokens)
                                    : "—"}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-ink/70">
                                  {money(e.usd)}
                                  <span
                                    className={`ml-1.5 text-[10px] ${
                                      e.accuracy === "measured" ? "text-mint-deep" : "text-ink/35"
                                    }`}
                                  >
                                    {e.accuracy === "measured" ? "measured" : "est."}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 同一个(供应商 × 资源 × 环节)合成一行 —— 一次审计有 40+ 笔,原样列出来没法读 */
function mergeEntries(entries: CostEntry[]) {
  const map = new Map<
    string,
    { provider: string; resource: string; stage: string; inputTokens: number; outputTokens: number; usd: number; count: number; accuracy: string }
  >();
  for (const e of entries) {
    const k = `${e.provider}|${e.resource}|${e.stage}`;
    const cur = map.get(k) ?? {
      provider: e.provider,
      resource: e.resource,
      stage: e.stage,
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      count: 0,
      accuracy: e.accuracy,
    };
    cur.inputTokens += e.inputTokens ?? 0;
    cur.outputTokens += e.outputTokens ?? 0;
    cur.usd += e.usd;
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.usd - a.usd);
}

function Stat({
  label,
  value,
  sub,
  big,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="card p-5">
      <div className="relative z-10">
        <p className="text-[11px] uppercase tracking-wider text-ink/40">{label}</p>
        <p
          className={`mt-2 font-display font-semibold tabular-nums ${big ? "text-3xl" : "text-2xl"} ${
            tone === "warn" ? "text-coral-deep" : "text-ink"
          }`}
        >
          {value}
        </p>
        {sub && <p className="mt-1 text-xs text-ink/45">{sub}</p>}
      </div>
    </div>
  );
}

/** 一次调用可能只花几美分,$0.00 会让人以为免费 —— 小额多给几位小数 */
function money(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
