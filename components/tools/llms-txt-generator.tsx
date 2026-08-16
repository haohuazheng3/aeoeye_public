"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Copy, Check, Download } from "lucide-react";

type Link = { title: string; url: string; note: string };
type Section = { name: string; links: Link[] };

const emptyLink = (): Link => ({ title: "", url: "", note: "" });

export function LlmsTxtGenerator() {
  const [siteName, setSiteName] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [sections, setSections] = useState<Section[]>([
    { name: "Docs", links: [emptyLink()] },
    { name: "Optional", links: [emptyLink()] },
  ]);
  const [copied, setCopied] = useState(false);

  const output = useMemo(() => {
    const lines: string[] = [];
    lines.push(`# ${siteName || "Your Site Name"}`);
    lines.push("");
    if (summary.trim()) {
      lines.push(`> ${summary.trim()}`);
      lines.push("");
    }
    if (details.trim()) {
      lines.push(details.trim());
      lines.push("");
    }
    for (const s of sections) {
      const valid = s.links.filter((l) => l.title.trim() && l.url.trim());
      if (!s.name.trim() || valid.length === 0) continue;
      lines.push(`## ${s.name.trim()}`);
      lines.push("");
      for (const l of valid) {
        lines.push(`- [${l.title.trim()}](${l.url.trim()})${l.note.trim() ? `: ${l.note.trim()}` : ""}`);
      }
      lines.push("");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }, [siteName, summary, details, sections]);

  function updateLink(si: number, li: number, key: keyof Link, val: string) {
    setSections((prev) => prev.map((s, i) => (i === si ? { ...s, links: s.links.map((l, j) => (j === li ? { ...l, [key]: val } : l)) } : s)));
  }
  function addLink(si: number) {
    setSections((prev) => prev.map((s, i) => (i === si ? { ...s, links: [...s.links, emptyLink()] } : s)));
  }
  function removeLink(si: number, li: number) {
    setSections((prev) => prev.map((s, i) => (i === si ? { ...s, links: s.links.filter((_, j) => j !== li) } : s)));
  }
  function addSection() {
    setSections((prev) => [...prev, { name: "", links: [emptyLink()] }]);
  }
  function removeSection(si: number) {
    setSections((prev) => prev.filter((_, i) => i !== si));
  }

  async function copy() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  function download() {
    const blob = new Blob([output], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "llms.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* 输入 */}
      <div className="space-y-5">
        <Field label="Site / brand name" value={siteName} onChange={setSiteName} placeholder="Acme Analytics" />
        <Field
          label="One-line summary"
          value={summary}
          onChange={setSummary}
          placeholder="Privacy-first product analytics for SaaS teams."
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink/70">Short description (optional)</label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            placeholder="A couple of sentences AI can use to describe what you do, for whom, and why you're different."
            className="w-full rounded-xl border border-paper-dim bg-white px-4 py-3 text-sm outline-none transition focus:border-iris"
          />
        </div>

        {sections.map((s, si) => (
          <div key={si} className="rounded-xl border border-paper-dim p-4">
            <div className="mb-3 flex items-center gap-2">
              <input
                value={s.name}
                onChange={(e) => setSections((prev) => prev.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)))}
                placeholder="Section (e.g. Docs, Guides, Products)"
                className="flex-1 rounded-lg border border-paper-dim bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-iris"
              />
              <button onClick={() => removeSection(si)} className="text-ink/30 transition hover:text-coral" aria-label="Remove section">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {s.links.map((l, li) => (
                <div key={li} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input value={l.title} onChange={(e) => updateLink(si, li, "title", e.target.value)} placeholder="Page title" className="rounded-lg border border-paper-dim bg-white px-3 py-2 text-sm outline-none focus:border-iris" />
                  <input value={l.url} onChange={(e) => updateLink(si, li, "url", e.target.value)} placeholder="https://…" className="rounded-lg border border-paper-dim bg-white px-3 py-2 text-sm outline-none focus:border-iris" />
                  <button onClick={() => removeLink(si, li)} className="text-ink/30 transition hover:text-coral" aria-label="Remove link">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <input value={l.note} onChange={(e) => updateLink(si, li, "note", e.target.value)} placeholder="Optional note" className="col-span-2 rounded-lg border border-paper-dim bg-white px-3 py-2 text-sm outline-none focus:border-iris" />
                </div>
              ))}
            </div>
            <button onClick={() => addLink(si)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-iris">
              <Plus className="h-3.5 w-3.5" /> Add link
            </button>
          </div>
        ))}
        <button onClick={addSection} className="btn-ghost w-full py-2.5 text-sm">
          <Plus className="h-4 w-4" /> Add section
        </button>
      </div>

      {/* 输出 */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-ink/45">llms.txt</span>
          <div className="flex gap-2">
            <button onClick={copy} className="btn-ghost px-3 py-1.5 text-xs">
              {copied ? <Check className="h-3.5 w-3.5 text-mint" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={download} className="btn-primary px-3 py-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </div>
        </div>
        <pre className="mt-2 max-h-[560px] overflow-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-paper">
          {output}
        </pre>
        <p className="mt-2 text-xs text-ink/50">Place this file at <code className="rounded bg-paper-soft px-1">https://yourdomain.com/llms.txt</code>.</p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink/70">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-paper-dim bg-white px-4 py-3 text-sm outline-none transition focus:border-iris"
      />
    </div>
  );
}
