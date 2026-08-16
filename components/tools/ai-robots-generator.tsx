"use client";

import { useMemo, useState } from "react";
import { Copy, Check, Download } from "lucide-react";

type Bot = { id: string; label: string; who: string; defaultAllow: boolean };

const BOTS: Bot[] = [
  { id: "GPTBot", label: "GPTBot", who: "OpenAI — trains ChatGPT", defaultAllow: true },
  { id: "OAI-SearchBot", label: "OAI-SearchBot", who: "OpenAI — ChatGPT Search", defaultAllow: true },
  { id: "ChatGPT-User", label: "ChatGPT-User", who: "OpenAI — live browsing in ChatGPT", defaultAllow: true },
  { id: "ClaudeBot", label: "ClaudeBot", who: "Anthropic — trains Claude", defaultAllow: true },
  { id: "Claude-Web", label: "Claude-Web", who: "Anthropic — live browsing", defaultAllow: true },
  { id: "PerplexityBot", label: "PerplexityBot", who: "Perplexity — indexing & citations", defaultAllow: true },
  { id: "Google-Extended", label: "Google-Extended", who: "Google — Gemini & AI training", defaultAllow: true },
  { id: "Applebot-Extended", label: "Applebot-Extended", who: "Apple Intelligence", defaultAllow: true },
  { id: "CCBot", label: "CCBot", who: "Common Crawl — feeds many LLMs", defaultAllow: true },
  { id: "Bytespider", label: "Bytespider", who: "ByteDance / TikTok", defaultAllow: false },
];

export function AiRobotsGenerator() {
  const [allow, setAllow] = useState<Record<string, boolean>>(
    Object.fromEntries(BOTS.map((b) => [b.id, b.defaultAllow]))
  );
  const [sitemap, setSitemap] = useState("");
  const [copied, setCopied] = useState(false);

  const output = useMemo(() => {
    const lines: string[] = [];
    for (const b of BOTS) {
      lines.push(`User-agent: ${b.id}`);
      lines.push(allow[b.id] ? "Allow: /" : "Disallow: /");
      lines.push("");
    }
    lines.push("User-agent: *");
    lines.push("Allow: /");
    lines.push("");
    if (sitemap.trim()) lines.push(`Sitemap: ${sitemap.trim()}`);
    return lines.join("\n").trim() + "\n";
  }, [allow, sitemap]);

  async function copy() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  function download() {
    const blob = new Blob([output], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "robots.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="space-y-2">
          {BOTS.map((b) => (
            <label key={b.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-paper-dim bg-white p-3">
              <span>
                <span className="font-mono text-sm font-semibold">{b.label}</span>
                <span className="block text-xs text-ink/50">{b.who}</span>
              </span>
              <span className="flex items-center gap-2 text-xs font-semibold">
                <span className={allow[b.id] ? "text-mint-deep" : "text-ink/30"}>Allow</span>
                <button
                  type="button"
                  onClick={() => setAllow((p) => ({ ...p, [b.id]: !p[b.id] }))}
                  className={`relative h-6 w-11 rounded-full transition ${allow[b.id] ? "bg-mint" : "bg-paper-dim"}`}
                  aria-label={`Toggle ${b.label}`}
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${allow[b.id] ? "left-6" : "left-1"}`} />
                </button>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-medium text-ink/70">Sitemap URL (optional)</label>
          <input value={sitemap} onChange={(e) => setSitemap(e.target.value)} placeholder="https://yourdomain.com/sitemap.xml" className="w-full rounded-xl border border-paper-dim bg-white px-4 py-2.5 text-sm outline-none focus:border-iris" />
        </div>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-ink/45">robots.txt</span>
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
        <pre className="mt-2 max-h-[560px] overflow-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-paper">{output}</pre>
        <p className="mt-2 text-xs text-ink/50">Place at <code className="rounded bg-paper-soft px-1">https://yourdomain.com/robots.txt</code>. Blocking trainers won&apos;t remove you from past training, but it controls future crawling.</p>
      </div>
    </div>
  );
}
