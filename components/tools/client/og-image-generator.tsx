"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus } from "lucide-react";

/* OG 图片生成器:浏览器内 canvas 直接画 1200×630 PNG,不上传任何东西。 */

const W = 1200;
const H = 630;
const THEMES = [
  { id: "ink", name: "Ink", bg: ["#0c0e16", "#232646"], fg: "#ffffff", sub: "rgba(255,255,255,0.68)", accent: "#8b8bf5" },
  { id: "paper", name: "Paper", bg: ["#f7f6f2", "#ecebf7"], fg: "#0c0e16", sub: "rgba(12,14,22,0.62)", accent: "#5b5bd6" },
  { id: "iris", name: "Iris", bg: ["#4f46e5", "#7c3aed"], fg: "#ffffff", sub: "rgba(255,255,255,0.75)", accent: "#fde68a" },
  { id: "mint", name: "Mint", bg: ["#ecfdf5", "#d1fae5"], fg: "#064e3b", sub: "rgba(6,78,59,0.7)", accent: "#059669" },
  { id: "sunset", name: "Sunset", bg: ["#fb7185", "#f59e0b"], fg: "#ffffff", sub: "rgba(255,255,255,0.8)", accent: "#111827" },
];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + "…").width > maxW && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = last.trimEnd() + "…";
  }
  return lines;
}

export function OgImageGenerator() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [title, setTitle] = useState("How we cut our page load time in half");
  const [sub, setSub] = useState("A practical teardown of the 6 fixes that moved our Core Web Vitals");
  const [brand, setBrand] = useState("yourbrand.com");
  const [theme, setTheme] = useState(THEMES[0].id);
  const [align, setAlign] = useState<"left" | "center">("left");
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [kb, setKb] = useState<number | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const t = THEMES.find((x) => x.id === theme) ?? THEMES[0];
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, t.bg[0]);
    g.addColorStop(1, t.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 柔和光斑
    const r = ctx.createRadialGradient(W * 0.85, H * 0.1, 10, W * 0.85, H * 0.1, 520);
    r.addColorStop(0, "rgba(255,255,255,0.18)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, H);

    const pad = 88;
    const x = align === "center" ? W / 2 : pad;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    // 安全区:主体文字保持在中间 ~1000×500 内,被裁成方形/窄卡时也不丢字
    ctx.fillStyle = t.accent;
    ctx.font = "600 28px Inter, ui-sans-serif, system-ui, sans-serif";
    let y = 150;
    if (logo) {
      const h = 64;
      const w = (logo.width / logo.height) * h;
      ctx.drawImage(logo, align === "center" ? W / 2 - w / 2 : pad, 70, w, h);
      y = 210;
    }
    ctx.fillStyle = t.fg;
    let size = 72;
    ctx.font = `700 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
    let lines = wrap(ctx, title, W - pad * 2, 3);
    if (lines.length === 3) {
      size = 60;
      ctx.font = `700 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
      lines = wrap(ctx, title, W - pad * 2, 3);
    }
    lines.forEach((l, i) => ctx.fillText(l, x, y + size + i * size * 1.15));
    y = y + size + (lines.length - 1) * size * 1.15 + 54;
    ctx.fillStyle = t.sub;
    ctx.font = "400 32px Inter, ui-sans-serif, system-ui, sans-serif";
    wrap(ctx, sub, W - pad * 2, 2).forEach((l, i) => ctx.fillText(l, x, y + i * 44));
    ctx.fillStyle = t.accent;
    ctx.fillRect(align === "center" ? W / 2 - 40 : pad, H - 104, 80, 6);
    ctx.fillStyle = t.fg;
    ctx.font = "600 30px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(brand, x, H - 58);
    c.toBlob((b) => b && setKb(Math.round(b.size / 1024)), "image/png");
  }, [title, sub, brand, theme, align, logo]);

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => setLogo(img);
    img.src = URL.createObjectURL(f);
  }

  function download() {
    ref.current?.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "og-image-1200x630.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  }

  const inp = "w-full rounded-2xl border border-paper-dim px-4 py-2.5 text-sm outline-none focus:border-iris";
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-3 rounded-3xl bg-white p-5 shadow-float">
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Title</span><textarea className={inp} rows={2} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Subtitle</span><textarea className={inp} rows={2} value={sub} onChange={(e) => setSub(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Site or brand</span><input className={inp} value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
        <div>
          <span className="mb-1 block text-xs font-medium text-ink/55">Theme</span>
          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <button key={t.id} type="button" onClick={() => setTheme(t.id)} aria-pressed={theme === t.id} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${theme === t.id ? "border-iris text-iris" : "border-paper-dim text-ink/60"}`}>
                <span className="h-3.5 w-3.5 rounded-full" style={{ background: `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})` }} /> {t.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-2"><input type="radio" checked={align === "left"} onChange={() => setAlign("left")} /> Left</label>
          <label className="inline-flex items-center gap-2"><input type="radio" checked={align === "center"} onChange={() => setAlign("center")} /> Centered</label>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-paper-dim px-2.5 py-1.5 text-xs"><ImagePlus className="h-3.5 w-3.5" /> Logo<input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" onChange={onLogo} /></label>
        </div>
      </div>
      <div className="rounded-3xl bg-white p-4 shadow-float">
        <canvas ref={ref} width={W} height={H} className="h-auto w-full rounded-2xl" aria-label="Open Graph image preview" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink/50">1200 × 630 PNG{kb !== null && ` · ${kb} KB`} · made in your browser, nothing uploaded</p>
          <button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-2xl bg-iris px-4 py-2.5 text-sm font-semibold text-white shadow-glow hover:bg-iris-deep"><Download className="h-4 w-4" /> Download PNG</button>
        </div>
      </div>
    </div>
  );
}
