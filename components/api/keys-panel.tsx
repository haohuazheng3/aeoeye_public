"use client";

import { useState } from "react";
import { Key, Plus, Copy, Check, Trash2, Loader2, ShieldAlert } from "lucide-react";

export type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/**
 * API key 管理。核心是那条不可逆的规矩:**明文只出现一次**。
 * 所以新建后的明文用一个显眼的、必须手动关掉的条带展示,而不是塞进列表里
 * 某一行 —— 用户滚过去就再也拿不回来了。
 */
export function KeysPanel({ initialKeys }: { initialKeys: KeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; prefix: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create the key.");
        return;
      }
      setFresh({ key: data.key, prefix: data.prefix });
      setCopied(false);
      setName("");
      setKeys((k) => [
        {
          id: data.id,
          name: name.trim() || "Default key",
          prefix: data.prefix,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...k,
      ]);
    } catch {
      setError("Network error — try again.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setKeys((k) => k.map((x) => (x.id === id ? { ...x, revokedAt: new Date().toISOString() } : x)));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时用户仍可手动选中 */
    }
  }

  const active = keys.filter((k) => !k.revokedAt);

  return (
    <section className="card p-7 sm:p-8">
      <div className="relative z-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Authentication</p>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">API keys</h2>
            <p className="mt-1.5 text-sm text-ink/50">
              {active.length === 0
                ? "Create a key to start calling the API."
                : `${active.length} active ${active.length === 1 ? "key" : "keys"}. Treat them like passwords.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name (optional)"
              maxLength={60}
              className="w-40 rounded-full border border-white/70 bg-white/60 px-4 py-2.5 text-sm outline-none transition focus:border-iris/40 sm:w-48"
            />
            <button onClick={create} disabled={creating} className="btn-primary shrink-0">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create key
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-2 text-sm text-coral-deep">
            <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {/* 一次性明文 —— 关掉就再也看不到 */}
        {fresh && (
          <div className="mt-6 rounded-[1.5rem] border border-iris/25 bg-iris/[0.06] p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Key className="h-4 w-4 text-iris" /> Copy it now — this is the only time it’s shown
            </p>
            <p className="mt-1 text-xs text-ink/55">
              We store a hash, not the key. If you lose it, revoke it and create a new one.
            </p>
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-2xl border border-white/70 bg-white/80 px-4 py-3 font-mono text-[13px] text-ink">
                {fresh.key}
              </code>
              <button onClick={() => copy(fresh.key)} className="btn-primary shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={() => setFresh(null)} className="btn-ghost shrink-0">
                Done
              </button>
            </div>
          </div>
        )}

        {keys.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-ink/[0.07] text-left text-[11px] uppercase tracking-wider text-ink/40">
                  <th className="pb-2.5 font-semibold">Name</th>
                  <th className="pb-2.5 font-semibold">Key</th>
                  <th className="pb-2.5 font-semibold">Created</th>
                  <th className="pb-2.5 font-semibold">Last used</th>
                  <th className="pb-2.5" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-ink/[0.05] last:border-0">
                    <td className="py-3 pr-3 font-medium text-ink/80">{k.name}</td>
                    <td className="py-3 pr-3">
                      <code className="font-mono text-[12.5px] text-ink/55">{k.prefix}…</code>
                    </td>
                    <td className="py-3 pr-3 text-ink/50">{fmtDate(k.createdAt)}</td>
                    <td className="py-3 pr-3 text-ink/50">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : "Never"}</td>
                    <td className="py-3 text-right">
                      {k.revokedAt ? (
                        <span className="text-xs text-ink/35">Revoked</span>
                      ) : (
                        <button
                          onClick={() => revoke(k.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/45 transition hover:text-coral-deep"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
