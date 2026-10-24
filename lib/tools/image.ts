/* ============================================================
   图片探测:只取前 64 KB,从文件头读出格式与像素尺寸(PNG / JPEG / GIF / WebP / ICO / SVG / AVIF)。
   OG 图、favicon 检查用。不解码整张图,不依赖 sharp。
   ============================================================ */

import { safeFetch } from "@/lib/seo-audit/fetch";
import { BOTS } from "./bots";

export interface ImageProbe {
  url: string;
  ok: boolean;
  status: number;
  contentType: string;
  bytes: number | null;
  format: string | null;
  width: number | null;
  height: number | null;
  /** ICO 里包含的所有尺寸 */
  icoSizes?: string[];
  error?: string;
}

function u16be(b: Uint8Array, o: number) { return (b[o] << 8) | b[o + 1]; }
function u16le(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32be(b: Uint8Array, o: number) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
function u24le(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }

export function sniff(b: Uint8Array, contentType = ""): { format: string | null; width: number | null; height: number | null; icoSizes?: string[] } {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { format: "png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { format: "gif", width: u16le(b, 6), height: u16le(b, 8) };
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X") return { format: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === "VP8 ") return { format: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { format: "webp", width: null, height: null };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      const len = u16be(b, o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: "jpeg", height: u16be(b, o + 5), width: u16be(b, o + 7) };
      }
      o += 2 + len;
    }
    return { format: "jpeg", width: null, height: null };
  }
  if (b.length >= 6 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) {
    const n = u16le(b, 4);
    const sizes: string[] = [];
    let maxW = 0, maxH = 0;
    for (let i = 0; i < Math.min(n, 32); i++) {
      const o = 6 + i * 16;
      if (o + 2 > b.length) break;
      const w = b[o] || 256, h = b[o + 1] || 256;
      sizes.push(`${w}×${h}`);
      if (w > maxW) { maxW = w; maxH = h; }
    }
    return { format: "ico", width: maxW || null, height: maxH || null, icoSizes: sizes };
  }
  if (b.length >= 12 && String.fromCharCode(b[4], b[5], b[6], b[7]) === "ftyp") {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/avif|avis/.test(brand)) {
      // ispe 盒子里有尺寸
      for (let o = 12; o + 20 < b.length; o++) {
        if (b[o] === 0x69 && b[o + 1] === 0x73 && b[o + 2] === 0x70 && b[o + 3] === 0x65) {
          return { format: "avif", width: u32be(b, o + 8), height: u32be(b, o + 12) };
        }
      }
      return { format: "avif", width: null, height: null };
    }
  }
  const head = new TextDecoder("utf-8").decode(b.subarray(0, 2048));
  if (/<svg[\s>]/i.test(head) || /svg/i.test(contentType)) {
    const w = /\bwidth=["']?(\d+(?:\.\d+)?)/i.exec(head)?.[1];
    const h = /\bheight=["']?(\d+(?:\.\d+)?)/i.exec(head)?.[1];
    const vb = /viewBox=["']?\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
    return { format: "svg", width: w ? Number(w) : vb ? Number(vb[1]) : null, height: h ? Number(h) : vb ? Number(vb[2]) : null };
  }
  return { format: null, width: null, height: null };
}

export async function probeImage(url: string, botId = "browser"): Promise<ImageProbe> {
  const res = await safeFetch(url, { raw: true, maxBytes: 64 * 1024, timeoutMs: 10_000, maxRedirects: 5, accept: "image/avif,image/webp,image/*,*/*;q=0.8", userAgent: BOTS[botId]?.ua || BOTS.browser.ua });
  const len = res.headers?.get?.("content-length");
  const out: ImageProbe = {
    url: res.finalUrl || url,
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    contentType: res.contentType || "",
    bytes: len && /^\d+$/.test(len) ? Number(len) : res.truncated ? null : res.bytes,
    format: null,
    width: null,
    height: null,
  };
  if (res.status === 0) out.error = res.error || "unreachable";
  if (res.raw && out.ok) Object.assign(out, sniff(res.raw, res.contentType));
  return out;
}

export function kb(bytes: number | null): string {
  if (bytes === null) return "unknown size";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
