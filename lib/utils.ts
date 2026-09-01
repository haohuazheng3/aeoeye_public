import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 类名合并 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
/** 生成短 ID(URL 安全,默认 11 位) */
export function shortId(len = 11): string {
  let out = "";
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 输入看起来像 URL / 域名吗(而非纯品牌名) */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (/\s/.test(s) && !/^https?:\/\//i.test(s)) return false; // 含空格且非 http 开头 → 当作品牌名
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(s);
}

/** 规范化为带协议的 URL;无法解析返回 null */
export function normalizeUrl(input: string): string | null {
  let s = (input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** 取裸域名(去 www、端口、路径) */
export function domainOf(input: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return input
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .trim();
  }
}

/** 从域名猜一个体面的品牌名(首字母大写,去 TLD) */
export function brandFromDomain(domain: string): string {
  const core = domain.replace(/^www\./, "").split(".")[0];
  return core
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * 去掉 AI 回答里的 Markdown 记号,只留可读正文。
 * 报告里摘录是以纯文本渲染的,不清理会看到 "# Best Hibachi ... 1. **Benihana** —" 这种噪音。
 */
export function stripMarkdown(text: string): string {
  return (text || "")
    .replace(/```[\s\S]*?```/g, " ") // 代码块
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题井号
    .replace(/^\s{0,3}>\s?/gm, "") // 引用
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // 无序列表符
    .replace(/^\s{0,3}\d+\.\s+/gm, "") // 有序列表序号
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片→ alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 链接→ 文字
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // 粗体
    .replace(/(^|[\s(])[*_](?=\S)([^*_]+?)[*_](?=[\s.,;:!?)]|$)/g, "$1$2") // 斜体(避开 a*b)
    .replace(/`([^`]+)`/g, "$1") // 行内代码
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ") // 分隔线
    .replace(/\|/g, " ") // 表格竖线
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 以品牌名为中心开窗截取:保证截出来的片段里一定含品牌名(这样荧光高亮才可见)。
 * 品牌名常出现在 AI 回答的中后段,从开头截会把它切掉。找不到品牌名时回退为从头截。
 */
export function excerptAroundBrand(text: string, brand: string, max = 700): string {
  const t = stripMarkdown(text);
  if (!t) return "";
  if (t.length <= max) return t;

  const b = (brand || "").trim();
  const idx = b.length >= 2 ? t.toLowerCase().indexOf(b.toLowerCase()) : -1;
  if (idx < 0) return t.slice(0, max).trimEnd() + "…";

  // 品牌名居中开窗,贴到右边界时回拉起点
  const half = Math.max(0, Math.floor((max - b.length) / 2));
  let start = Math.max(0, idx - half);
  let end = Math.min(t.length, start + max);
  start = Math.max(0, Math.min(start, end - max));

  // 对齐到句子/词边界,避免半截单词
  if (start > 0) {
    const seg = t.slice(start, idx);
    const sentence = seg.search(/[.!?]\s/);
    if (sentence >= 0) start += sentence + 2;
    else {
      const sp = seg.indexOf(" ");
      if (sp >= 0) start += sp + 1;
    }
  }
  if (end < t.length) {
    const sp = t.lastIndexOf(" ", end);
    if (sp > idx + b.length) end = sp;
  }

  return (start > 0 ? "…" : "") + t.slice(start, end).trim() + (end < t.length ? "…" : "");
}

/** 安全截断 */
export function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

/** 简单 slugify */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** 字母分级 */
export function gradeFor(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function formatDate(d: Date | string | number): string {
  // Content metadata is stored as a calendar date (YYYY-MM-DD), not an instant.
  // Parsing that form with new Date() treats it as UTC midnight, so a negative
  // timezone renders the previous day in the browser and can break hydration.
  const dateOnly = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const date = dateOnly ? new Date(`${d}T00:00:00Z`) : typeof d === "object" ? d : new Date(d);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  });
}
