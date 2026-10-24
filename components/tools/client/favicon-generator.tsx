"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload, Copy } from "lucide-react";

/* Favicon 生成器:全部在浏览器里完成 —— 画布出各尺寸 PNG,手工拼 ICO(PNG 内嵌)与 zip(store,无压缩)。 */

const SIZES = { ico: [16, 32, 48], apple: 180, android: [192, 512] };

/* ---------- 最小 zip 写入器(store 模式) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

/* ---------- ICO:PNG 内嵌(Windows Vista 起与所有现代浏览器支持) ---------- */
function ico(pngs: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = 6 + 16 * pngs.length;
  const total = header + pngs.reduce((s, p) => s + p.data.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, pngs.length, true);
  let off = header;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    out[e] = p.size >= 256 ? 0 : p.size;
    out[e + 1] = p.size >= 256 ? 0 : p.size;
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, p.data.length, true);
    v.setUint32(e + 12, off, true);
    out.set(p.data, off);
    off += p.data.length;
  });
  return out;
}

async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b as Blob), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

type Shape = "square" | "rounded" | "circle";

function draw(c: HTMLCanvasElement, size: number, opts: { mode: "text" | "image"; text: string; bg: string; fg: string; shape: Shape; img: HTMLImageElement | null; padding: number }) {
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  if (opts.shape === "circle") ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  else if (opts.shape === "rounded") {
    const r = size * 0.22;
    ctx.moveTo(r, 0);
    ctx.arcTo(size, 0, size, size, r);
    ctx.arcTo(size, size, 0, size, r);
    ctx.arcTo(0, size, 0, 0, r);
    ctx.arcTo(0, 0, size, 0, r);
  } else ctx.rect(0, 0, size, size);
  ctx.closePath();
  ctx.clip();
  if (opts.mode === "text" || opts.bg !== "transparent") {
    ctx.fillStyle = opts.bg === "transparent" ? "rgba(0,0,0,0)" : opts.bg;
    ctx.fillRect(0, 0, size, size);
  }
  if (opts.mode === "image" && opts.img) {
    const pad = size * opts.padding;
    const box = size - pad * 2;
    const ratio = Math.min(box / opts.img.width, box / opts.img.height);
    const w = opts.img.width * ratio;
    const h = opts.img.height * ratio;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(opts.img, (size - w) / 2, (size - h) / 2, w, h);
  } else {
    const t = opts.text.slice(0, 2);
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(size * (t.length > 1 ? 0.5 : 0.64))}px Inter, ui-sans-serif, system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillText(t, size / 2, size / 2 + size * 0.04);
  }
  ctx.restore();
}

const SNIPPET = `<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">`;

export function FaviconGenerator() {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("A");
  const [bg, setBg] = useState("#5b5bd6");
  const [fg, setFg] = useState("#ffffff");
  const [shape, setShape] = useState<Shape>("rounded");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [padding, setPadding] = useState(0.1);
  const [name, setName] = useState("My Site");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const previews = useRef<Record<number, HTMLCanvasElement | null>>({});
  const opts = { mode, text, bg, fg, shape, img, padding };

  useEffect(() => {
    for (const s of [16, 32, 48, 180]) {
      const c = previews.current[s];
      if (c) draw(c, s, opts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, text, bg, fg, shape, img, padding]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const i = new Image();
    i.onload = () => { setImg(i); setMode("image"); };
    i.src = URL.createObjectURL(f);
  }

  async function build() {
    setBusy(true);
    try {
      const c = document.createElement("canvas");
      const icoPngs = [];
      for (const s of SIZES.ico) { draw(c, s, opts); icoPngs.push({ size: s, data: await canvasPng(c) }); }
      draw(c, SIZES.apple, { ...opts, shape: "square", bg: bg === "transparent" ? "#ffffff" : bg });
      const apple = await canvasPng(c);
      draw(c, 192, opts); const a192 = await canvasPng(c);
      draw(c, 512, opts); const a512 = await canvasPng(c);
      const manifest = JSON.stringify({ name, short_name: name.slice(0, 12), icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }], theme_color: bg === "transparent" ? "#ffffff" : bg, background_color: "#ffffff", display: "standalone" }, null, 2);
      const enc = new TextEncoder();
      const blob = zip([
        { name: "favicon.ico", data: ico(icoPngs) },
        { name: "apple-touch-icon.png", data: apple },
        { name: "icon-192.png", data: a192 },
        { name: "icon-512.png", data: a512 },
        { name: "site.webmanifest", data: enc.encode(manifest) },
        { name: "favicon-snippet.html", data: enc.encode(SNIPPET + "\n") },
      ]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "favicons.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally {
      setBusy(false);
    }
  }

  const inp = "w-full rounded-2xl border border-paper-dim px-4 py-2.5 text-sm outline-none focus:border-iris";
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="min-w-0 space-y-4 rounded-3xl bg-white p-5 shadow-float">
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("text")} aria-pressed={mode === "text"} className={`rounded-full px-4 py-1.5 text-sm ${mode === "text" ? "bg-ink text-white" : "bg-paper-soft text-ink/60"}`}>Letter or emoji</button>
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-sm ${mode === "image" ? "bg-ink text-white" : "bg-paper-soft text-ink/60"}`}><Upload className="h-3.5 w-3.5" /> Upload image<input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" onChange={onFile} /></label>
        </div>
        {mode === "text" ? (
          <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">1–2 characters</span><input className={inp} value={text} maxLength={4} onChange={(e) => setText(e.target.value)} /></label>
        ) : (
          <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Padding {Math.round(padding * 100)}%</span><input type="range" min={0} max={0.3} step={0.02} value={padding} onChange={(e) => setPadding(Number(e.target.value))} className="w-full" /></label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Background</span><input type="color" value={bg === "transparent" ? "#ffffff" : bg} onChange={(e) => setBg(e.target.value)} className="h-10 w-full rounded-xl border border-paper-dim" /></label>
          {mode === "text" ? (
            <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Letter colour</span><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="h-10 w-full rounded-xl border border-paper-dim" /></label>
          ) : (
            <label className="mt-6 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={bg === "transparent"} onChange={(e) => setBg(e.target.checked ? "transparent" : "#ffffff")} /> Transparent</label>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {(["square", "rounded", "circle"] as Shape[]).map((s) => (
            <button key={s} type="button" onClick={() => setShape(s)} aria-pressed={shape === s} className={`rounded-full border px-3 py-1 capitalize ${shape === s ? "border-iris text-iris" : "border-paper-dim text-ink/60"}`}>{s}</button>
          ))}
        </div>
        <label className="block"><span className="mb-1 block text-xs font-medium text-ink/55">Site name (for the web manifest)</span><input className={inp} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button type="button" onClick={build} disabled={busy || (mode === "image" && !img)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-iris px-5 py-3 text-sm font-semibold text-white shadow-glow hover:bg-iris-deep disabled:opacity-60"><Download className="h-4 w-4" /> {busy ? "Building…" : "Download favicons.zip"}</button>
        <p className="text-[11px] text-ink/45">Includes favicon.ico (16/32/48), apple-touch-icon.png (180), icon-192.png, icon-512.png, site.webmanifest and the HTML snippet. Generated in your browser; nothing is uploaded.</p>
      </div>
      <div className="min-w-0 space-y-4">
        <div className="rounded-3xl bg-white p-5 shadow-float">
          <p className="text-sm font-semibold">Preview at real sizes</p>
          <div className="mt-3 flex items-end gap-5">
            {[16, 32, 48, 180].map((s) => (
              <div key={s} className="text-center">
                <canvas ref={(el) => { previews.current[s] = el; }} width={s} height={s} style={{ width: s === 180 ? 90 : s, height: s === 180 ? 90 : s }} className="rounded-sm bg-[conic-gradient(#eee_25%,#fff_0_50%,#eee_0_75%,#fff_0)] bg-[length:8px_8px]" />
                <p className="mt-1 text-[10px] text-ink/45">{s}px</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-float">
          <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">Add to your &lt;head&gt;</span><button type="button" onClick={() => navigator.clipboard.writeText(SNIPPET).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1 text-xs"><Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}</button></div>
          <pre className="overflow-auto rounded-2xl bg-ink p-3 text-[11.5px] leading-relaxed text-white/85"><code>{SNIPPET}</code></pre>
        </div>
      </div>
    </div>
  );
}
