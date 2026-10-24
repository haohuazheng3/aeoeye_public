"use client";

import { useState } from "react";
import { Loader2, Download as Fetch } from "lucide-react";
import { SerpPreview } from "../runner/serp-preview";
import type { ToolResult } from "@/lib/tools/types";

/** 标题标签检查器:输入或从 URL 拉取标题与描述,实时按像素预览 */
export function SerpEditor() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("Title Tag Checker: Real Pixel Width & SERP Preview");
  const [desc, setDesc] = useState("Free title tag checker with real pixel width, not just characters: preview your title and meta description on desktop and mobile, then fix truncation.");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    if (!url.trim()) { setErr("Enter a URL to load its live title and description."); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/tools/title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = (await res.json()) as ToolResult;
      if (!data.ok) throw new Error(data.error || "Couldn't load that page.");
      const s = data.sections.find((x) => x.kind === "serp")?.serp;
      if (s) { setTitle(s.title); setDesc(s.description); setUrl(s.url); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-3xl bg-white p-4 shadow-float sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yoursite.com/page (optional: load the live tags)" className="flex-1 rounded-2xl border border-paper-dim bg-paper-soft/60 px-4 py-3 text-sm outline-none focus:border-iris focus:bg-white" />
        <button type="button" onClick={load} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-iris px-5 py-3 text-sm font-semibold text-white shadow-glow hover:bg-iris-deep disabled:opacity-70">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fetch className="h-4 w-4" />} Load from URL
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-coral-deep">{err}</p>}
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-ink/55">Title tag</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-2xl border border-paper-dim px-4 py-3 text-sm outline-none focus:border-iris" />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-ink/55">Meta description</span>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="w-full rounded-2xl border border-paper-dim px-4 py-3 text-sm outline-none focus:border-iris" />
      </label>
      <div className="mt-5">
        <SerpPreview title={title} description={desc} url={url || "https://example.com/page"} />
      </div>
    </div>
  );
}
