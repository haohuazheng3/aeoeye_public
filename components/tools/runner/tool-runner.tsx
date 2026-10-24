"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Globe } from "lucide-react";
import type { ToolResult } from "@/lib/tools/types";
import { fwEvent } from "@/components/flowglance";
import dynamic from "next/dynamic";

// 结果视图只在跑完检查后才需要:按需加载,工具页首屏少下载一大块 JS(移动端 LCP)
const ResultView = dynamic(() => import("./result-view").then((m) => m.ResultView), {
  loading: () => <div className="h-40 animate-pulse rounded-3xl bg-white/60" />,
});

/* ============================================================
   通用工具运行器:首屏输入框 → POST /api/tools/<tool> → ResultView。
   每个工具页只传自己的 tool id、字段和静态选项(例如要测的爬虫列表),
   检查逻辑完全在服务端各自的检查器里。
   ============================================================ */

export type RunnerField = {
  name: string;
  label: string;
  placeholder?: string;
  type?: "url" | "text" | "textarea" | "select";
  options?: { value: string; label: string }[];
  optional?: boolean;
};

type Props = {
  tool: string;
  submitLabel: string;
  fields?: RunnerField[];
  extra?: Record<string, unknown>;
  examples?: string[];
  busyText?: string;
  footnote?: string;
};

const DEFAULT_FIELDS: RunnerField[] = [{ name: "url", label: "URL", placeholder: "https://example.com", type: "url" }];

export function ToolRunner({ tool, submitLabel, fields = DEFAULT_FIELDS, extra, examples, busyText = "Fetching and checking…", footnote }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.type === "select" && f.options?.length ? f.options[0].value : ""])));
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState("");

  async function run(e?: React.FormEvent, override?: Record<string, string>) {
    e?.preventDefault();
    const v = { ...values, ...override };
    const main = fields[0];
    if (!main.optional && !String(v[main.name] ?? "").trim()) { setError(`Enter ${main.label.toLowerCase()}.`); return; }
    setError("");
    setState("busy");
    setResult(null);
    try {
      const res = await fetch(`/api/tools/${tool}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...extra, ...v }) });
      const text = await res.text();
      let data: ToolResult;
      try { data = JSON.parse(text) as ToolResult; } catch { throw new Error(res.status === 504 ? "The check took too long. Try a lighter page or try again." : "The server returned an unexpected response."); }
      setResult(data);
      fwEvent("tool_run", { tool, ok: data.ok, verdict: data.verdict ?? null });
    } catch (err) {
      setResult({ ok: false, tool, input: v.url ?? "", fetchedAt: new Date().toISOString(), sections: [], error: (err as Error).message });
    } finally {
      setState("idle");
    }
  }

  return (
    <div>
      <form onSubmit={run} className="rounded-3xl bg-white p-4 shadow-float sm:p-5">
        <div className={`grid gap-3 ${fields.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {fields.map((f, i) => (
            <label key={f.name} className={`block ${f.type === "textarea" || (i === 0 && fields.length > 1 && fields.length % 2 === 1) ? "sm:col-span-2" : ""}`}>
              <span className="mb-1 block text-xs font-medium text-ink/55">{f.label}{f.optional && <span className="text-ink/35"> (optional)</span>}</span>
              {f.type === "textarea" ? (
                <textarea value={values[f.name]} onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))} placeholder={f.placeholder} rows={5} className="w-full rounded-2xl border border-paper-dim bg-paper-soft/60 px-4 py-3 text-sm outline-none transition focus:border-iris focus:bg-white" />
              ) : f.type === "select" ? (
                <select value={values[f.name]} onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))} className="w-full rounded-2xl border border-paper-dim bg-paper-soft/60 px-4 py-3 text-sm outline-none focus:border-iris">
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <div className="relative">
                  {f.type === "url" && <Globe className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" />}
                  <input value={values[f.name]} onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))} placeholder={f.placeholder} inputMode={f.type === "url" ? "url" : undefined} autoComplete="off" spellCheck={false} className={`w-full rounded-2xl border border-paper-dim bg-paper-soft/60 py-3 pr-4 text-sm outline-none transition focus:border-iris focus:bg-white ${f.type === "url" ? "pl-10" : "pl-4"}`} />
                </div>
              )}
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={state === "busy"} className="inline-flex items-center gap-2 rounded-2xl bg-iris px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-iris-deep disabled:opacity-70">
            {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {state === "busy" ? busyText : submitLabel}
            {state !== "busy" && <ArrowRight className="h-4 w-4" />}
          </button>
          {examples && examples.length > 0 && (
            <span className="text-xs text-ink/45">
              Try:{" "}
              {examples.map((ex, i) => (
                <button key={ex} type="button" onClick={() => { setValues((s) => ({ ...s, [fields[0].name]: ex })); void run(undefined, { [fields[0].name]: ex }); }} className="break-all underline decoration-dotted underline-offset-2 hover:text-iris">
                  {ex}{i < examples.length - 1 ? ", " : ""}
                </button>
              ))}
            </span>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-coral-deep">{error}</p>}
        {footnote && <p className="mt-3 text-[11px] leading-relaxed text-ink/40">{footnote}</p>}
      </form>
      {result && <div className="mt-6" aria-live="polite"><ResultView result={result} /></div>}
    </div>
  );
}
