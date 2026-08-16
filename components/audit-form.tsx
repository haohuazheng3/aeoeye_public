"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Loader2 } from "lucide-react";
import { ScanOverlay } from "./scan-overlay";

type Props = {
  source?: string;
  placeholder?: string;
  variant?: "hero" | "inline";
  cta?: string;
};

export function AuditForm({ source, placeholder = "yourbrand.com or “Your Brand”", variant = "hero", cta = "Run free audit" }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [state, setState] = useState<"idle" | "scanning" | "error">("idle");
  const [error, setError] = useState("");
  const abortRef = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = input.trim();
    if (value.length < 2) {
      setError("Enter a brand name or website.");
      setState("error");
      return;
    }
    setError("");
    setState("scanning");
    abortRef.current = false;
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: value, source }),
      });
      // 安全解析:服务端超时/崩溃时会返回非 JSON 文本,直接 res.json() 会抛
      // "Unexpected token" —— 先读文本再尝试解析,任何异常都给干净提示。
      const raw = await res.text();
      let data: { id?: string; error?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: "The audit took too long. Please try again in a moment." };
      }
      if (!res.ok || !data.id) {
        throw new Error(data.error || `We couldn't finish this audit (${res.status}). Please try again.`);
      }
      if (abortRef.current) return;
      router.push(`/audit/${data.id}`);
    } catch (err) {
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg.includes("fetch") || msg.includes("network") ? "Network hiccup — please try again." : msg);
      setState("error");
    }
  }

  const isHero = variant === "hero";

  return (
    <>
      <form onSubmit={submit} className="w-full">
        <div
          className={`flex flex-col gap-2.5 sm:flex-row sm:items-stretch ${
            isHero
              ? "card !rounded-[1.9rem] p-2 focus-within:ring-2 focus-within:ring-iris/25 sm:!rounded-full"
              : ""
          }`}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink/30" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              aria-label="Brand name or website"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={`w-full rounded-full py-4 pl-12 pr-4 text-base text-ink outline-none transition placeholder:text-ink/35 ${
                isHero
                  ? "border-0 bg-transparent"
                  : "rounded-2xl border border-paper-dim bg-white focus:border-iris"
              }`}
            />
          </div>
          <button type="submit" className="btn-primary shrink-0 py-4 text-base sm:px-7">
            {cta}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        {state === "error" && error ? (
          <p className="mt-2.5 text-sm font-medium text-coral-deep" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {state === "scanning" && (
        <ScanOverlay
          brand={input.trim()}
          onCancel={() => {
            abortRef.current = true;
            setState("idle");
          }}
        />
      )}
    </>
  );
}
