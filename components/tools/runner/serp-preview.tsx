"use client";

import { useEffect, useMemo, useState } from "react";

/* ============================================================
   SERP 片段预览:用 canvas 按 Google 的字体实测像素宽度(标题 Arial 20px、描述 Arial 14px),
   而不是数字符。截断阈值是经验值(桌面标题约 600px、描述约 920px;移动描述约 680px),
   Google 从未公布官方像素上限 —— 页面正文里写明了这一点。
   ============================================================ */

export const LIMITS = { titleDesktop: 600, titleMobile: 600, descDesktop: 920, descMobile: 680 };

let ctx: CanvasRenderingContext2D | null = null;
export function measure(text: string, font: string): number {
  if (typeof document === "undefined") return text.length * 9;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * 9;
  ctx.font = font;
  return Math.round(ctx.measureText(text).width);
}

export function truncateToPx(text: string, font: string, max: number): { text: string; cut: boolean } {
  if (measure(text, font) <= max) return { text, cut: false };
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + " …", font) <= max) lo = mid; else hi = mid - 1;
  }
  const cut = text.slice(0, lo).replace(/\s+\S*$/, "");
  return { text: (cut || text.slice(0, lo)) + " …", cut: true };
}

const TITLE_FONT = "20px Arial, sans-serif";
const DESC_FONT = "14px Arial, sans-serif";

export function PixelMeter({ label, px, max, chars }: { label: string; px: number; max: number; chars: number }) {
  const pct = Math.min(100, (px / max) * 100);
  const over = px > max;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="font-medium text-ink/60">{label}</span>
        <span className={over ? "font-semibold text-coral-deep" : px > max * 0.9 ? "text-amber-deep" : "text-mint-deep"}>{px}px / {max}px · {chars} chars</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-dim">
        <div className={`h-full rounded-full ${over ? "bg-coral" : px > max * 0.9 ? "bg-amber" : "bg-mint"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function crumbs(url: string) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean).slice(0, 3);
    return { host: u.hostname.replace(/^www\./, ""), path: parts.length ? " › " + parts.join(" › ") : "" };
  } catch {
    return { host: url, path: "" };
  }
}

export function SerpPreview({ title, description, url }: { title: string; description: string; url: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const m = useMemo(() => {
    if (!ready) return null;
    return {
      tPx: measure(title, TITLE_FONT),
      dPx: measure(description, DESC_FONT),
      tD: truncateToPx(title, TITLE_FONT, LIMITS.titleDesktop),
      dD: truncateToPx(description, DESC_FONT, LIMITS.descDesktop),
      dM: truncateToPx(description, DESC_FONT, LIMITS.descMobile),
    };
  }, [ready, title, description]);
  const c = crumbs(url);
  if (!m) return null;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <PixelMeter label="Title (desktop)" px={m.tPx} max={LIMITS.titleDesktop} chars={title.length} />
        <PixelMeter label="Description (desktop)" px={m.dPx} max={LIMITS.descDesktop} chars={description.length} />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink/45">Desktop</p>
        <div className="max-w-[600px] rounded-2xl border border-paper-dim bg-white p-4" style={{ fontFamily: "Arial, sans-serif" }}>
          <div className="text-[14px] text-[#202124]">{c.host}<span className="text-[#4d5156]">{c.path}</span></div>
          <div className="mt-1 text-[20px] leading-[1.3] text-[#1a0dab]">{m.tD.text || "(no title — Google will make one up)"}</div>
          <div className="mt-1 text-[14px] leading-[1.58] text-[#4d5156]">{m.dD.text || "(no meta description — Google will pick text from the page)"}</div>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink/45">Mobile</p>
        <div className="max-w-[360px] rounded-2xl border border-paper-dim bg-white p-4" style={{ fontFamily: "Arial, sans-serif" }}>
          <div className="text-[12px] text-[#202124]">{c.host}</div>
          <div className="mt-1 text-[18px] leading-[1.35] text-[#1a0dab]">{title || "(no title)"}</div>
          <div className="mt-1 text-[14px] leading-[1.5] text-[#4d5156]">{m.dM.text}</div>
        </div>
      </div>
      {(m.tD.cut || m.dD.cut) && (
        <p className="text-xs text-amber-deep">
          {m.tD.cut && "Your title is wider than ~600px and will likely be cut on desktop. "}
          {m.dD.cut && "Your description will likely be truncated on desktop."}
        </p>
      )}
    </div>
  );
}
