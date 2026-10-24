"use client";

/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, Copy, Download, Search } from "lucide-react";
import type { ToolResult, ResultSection, Status, CheckItem } from "@/lib/tools/types";
import { SocialPreviews } from "./social-previews";
import { SerpPreview } from "./serp-preview";

const TONE: Record<Status, { icon: typeof Info; text: string; bg: string; ring: string; label: string }> = {
  pass: { icon: CheckCircle2, text: "text-mint-deep", bg: "bg-mint/10", ring: "ring-mint/30", label: "Pass" },
  warn: { icon: AlertTriangle, text: "text-amber-deep", bg: "bg-amber/10", ring: "ring-amber/30", label: "Warning" },
  fail: { icon: XCircle, text: "text-coral-deep", bg: "bg-coral/10", ring: "ring-coral/30", label: "Fail" },
  info: { icon: Info, text: "text-iris", bg: "bg-iris/5", ring: "ring-iris/20", label: "Info" },
};

function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Checks({ items }: { items: CheckItem[] }) {
  return (
    <ul className="divide-y divide-paper-dim">
      {items.map((it, i) => {
        const T = TONE[it.status];
        return (
          <li key={i} className="flex gap-3 py-3">
            <T.icon className={`mt-0.5 h-4 w-4 shrink-0 ${T.text}`} aria-label={T.label} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-ink">{it.label}</span>
                {it.value && <span className="break-all text-sm text-ink/60">{it.value}</span>}
              </div>
              {it.detail && <p className="mt-0.5 text-xs leading-relaxed text-ink/50">{it.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Table({ t }: { t: NonNullable<ResultSection["table"]> }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead>
          <tr className="border-b border-paper-dim text-ink/45">
            {t.columns.map((c) => <th key={c} className="px-2 py-2 font-semibold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className="border-b border-paper-dim/60 align-top">
              {r.map((c, j) => {
                const v = c === null ? "—" : String(c);
                const tone = /^(Blocked|fail|noindex)/i.test(v) ? "text-coral-deep" : /^(Allowed|OK|loads)$/i.test(v) ? "text-mint-deep" : "text-ink/70";
                return <td key={j} className={`max-w-[360px] break-words px-2 py-2 ${tone}`}>{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {t.rows.length === 0 && <p className="px-2 py-3 text-xs text-ink/45">Nothing to show.</p>}
    </div>
  );
}

function Code({ c }: { c: NonNullable<ResultSection["code"]> }) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => c.text.split("\n"), [c.text]);
  const long = lines.length > 40;
  const hits = q ? lines.map((l, i) => (l.toLowerCase().includes(q.toLowerCase()) ? i : -1)).filter((i) => i >= 0) : [];
  const shown = q ? hits.slice(0, 400).map((i) => [i, lines[i]] as const) : lines.slice(0, 4000).map((l, i) => [i, l] as const);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {long && (
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-paper-dim bg-white px-3 py-1.5 text-xs">
            <Search className="h-3.5 w-3.5 text-ink/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the source (e.g. canonical, og:image, ld+json)" className="w-full outline-none" />
            {q && <span className="shrink-0 text-ink/45">{hits.length} lines</span>}
          </label>
        )}
        <button type="button" onClick={() => { navigator.clipboard.writeText(c.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim bg-white px-2.5 py-1.5 text-xs font-medium text-ink/70 hover:text-ink">
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
        </button>
        {c.filename && (
          <button type="button" onClick={() => download(c.filename!, "text/plain", c.text)} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim bg-white px-2.5 py-1.5 text-xs font-medium text-ink/70 hover:text-ink">
            <Download className="h-3.5 w-3.5" /> {c.filename}
          </button>
        )}
      </div>
      <pre className="max-h-[520px] overflow-auto rounded-2xl bg-ink p-3 text-[11.5px] leading-relaxed text-white/85">
        {shown.map(([i, l]) => (
          <div key={i} className="flex">
            <span className="mr-3 w-10 shrink-0 select-none text-right text-white/30">{i + 1}</span>
            <code className="whitespace-pre-wrap break-all">{l || " "}</code>
          </div>
        ))}
      </pre>
      {!q && lines.length > 4000 && <p className="mt-1 text-xs text-ink/45">Showing the first 4,000 of {lines.length.toLocaleString()} lines. Use search or download for the rest.</p>}
    </div>
  );
}

function Section({ s }: { s: ResultSection }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-float">
      <h3 className="font-display text-base font-semibold text-ink">{s.title}</h3>
      <div className="mt-3">
        {s.kind === "checks" && s.items && <Checks items={s.items} />}
        {s.kind === "table" && s.table && <Table t={s.table} />}
        {s.kind === "code" && s.code && <Code c={s.code} />}
        {s.kind === "kv" && s.kv && (
          <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[minmax(140px,220px)_1fr]">
            {s.kv.map((x, i) => (
              <div key={i} className="contents">
                <dt className="font-medium text-ink/55">{x.key}</dt>
                <dd className="break-all text-ink/80">{x.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {s.kind === "previews" && s.previews && <SocialPreviews platforms={s.previews.platforms} data={s.previews.data} />}
        {s.kind === "image" && s.image && (
          <div className="flex justify-center rounded-2xl bg-paper-soft p-4">
            <img src={s.image.src} alt={s.image.alt} width={s.image.width} height={s.image.height} className="h-auto max-h-[640px] w-auto rounded-xl border border-paper-dim shadow-card" />
          </div>
        )}
        {s.kind === "text" && s.text && <p className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-2xl bg-paper-soft p-3 text-xs leading-relaxed text-ink/70">{s.text}</p>}
        {s.kind === "serp" && s.serp && <SerpPreview title={s.serp.title} description={s.serp.description} url={s.serp.url} />}
        {s.note && <p className="mt-3 text-xs leading-relaxed text-ink/45">{s.note}</p>}
      </div>
    </section>
  );
}

export function ResultView({ result }: { result: ToolResult }) {
  if (!result.ok) {
    return <div className="rounded-3xl bg-coral/10 p-5 text-sm text-coral-deep ring-1 ring-coral/30">{result.error || "Something went wrong."}</div>;
  }
  const T = TONE[result.verdict ?? "info"];
  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-3xl p-5 ring-1 ${T.bg} ${T.ring}`}>
        <T.icon className={`mt-0.5 h-5 w-5 shrink-0 ${T.text}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{result.headline}</p>
          {result.url && <p className="mt-0.5 break-all text-xs text-ink/45">{result.url} · checked {new Date(result.fetchedAt).toLocaleString()}</p>}
        </div>
        {typeof result.score === "number" && (
          <div className="shrink-0 text-right">
            <div className={`font-display text-3xl font-semibold ${T.text}`}>{result.score}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink/40">/ 100</div>
          </div>
        )}
      </div>
      {result.download && (
        <button type="button" onClick={() => download(result.download!.filename, result.download!.mime, result.download!.content)} className="inline-flex items-center gap-2 rounded-xl bg-iris px-4 py-2 text-sm font-semibold text-white shadow-glow hover:bg-iris-deep">
          <Download className="h-4 w-4" /> Download {result.download.filename}
        </button>
      )}
      {result.sections.map((s, i) => <Section key={i} s={s} />)}
    </div>
  );
}
