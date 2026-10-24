"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";

const STOP = new Set("a an and the of to in on for at by with from or is are be how what why when your you our".split(" "));

export function toSlug(input: string, opts: { stop: boolean; max: number }): string {
  const base = input
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  let words = base.split(/\s+/).filter(Boolean);
  if (opts.stop && words.length > 3) words = words.filter((w, i) => i === 0 || !STOP.has(w));
  let slug = words.join("-");
  if (slug.length > opts.max) slug = slug.slice(0, opts.max).replace(/-[^-]*$/, "");
  return slug;
}

export function SlugGenerator() {
  const [text, setText] = useState("How to Fix a 301 Redirect Chain (Step-by-Step Guide) — 2026 Edition");
  const [stop, setStop] = useState(true);
  const [max, setMax] = useState(60);
  const [copied, setCopied] = useState("");
  const lines = useMemo(() => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 200), [text]);
  const slugs = lines.map((l) => toSlug(l, { stop, max }));
  return (
    <div className="rounded-3xl bg-white p-5 shadow-float">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/55">Titles (one per line, up to 200)</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full rounded-2xl border border-paper-dim bg-paper-soft/60 px-4 py-3 text-sm outline-none focus:border-iris focus:bg-white" />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} /> Remove stop words (a, the, of…)</label>
        <label className="inline-flex items-center gap-2">Max length <input type="number" min={20} max={120} value={max} onChange={(e) => setMax(Number(e.target.value) || 60)} className="w-20 rounded-lg border border-paper-dim px-2 py-1" /> chars</label>
      </div>
      <ul className="mt-4 divide-y divide-paper-dim">
        {slugs.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-2.5">
            <code className="break-all text-sm text-ink">/{s}</code>
            <span className="flex shrink-0 items-center gap-2">
              <span className={`text-xs ${s.length > 60 ? "text-amber-deep" : "text-ink/40"}`}>{s.length} chars · {s.split("-").filter(Boolean).length} words</span>
              <button type="button" onClick={() => navigator.clipboard.writeText(s).then(() => { setCopied(s); setTimeout(() => setCopied(""), 1200); })} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2 py-1 text-xs"><Copy className="h-3 w-3" /> {copied === s ? "Copied" : "Copy"}</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
