/* ============================================================
   免费工具页(/tools/<slug>)的统一结果格式。

   每个检查器(lib/tools/checks/*)都返回 ToolResult;前端只有一个通用渲染器
   (components/tools/runner/result-view.tsx),按 section.kind 画清单 / 表格 / 代码 / 预览。
   这样 40 多个工具共享同一套解读样式,而检查逻辑各自独立 —— 每页的"工具"是真不同的,
   不是同一个表单换皮(那会被判门页,见 seo.md《三轮规则》第一轮)。
   ============================================================ */

export type Status = "pass" | "warn" | "fail" | "info";

export interface CheckItem {
  label: string;
  status: Status;
  /** 实测值(原样展示,如 "301 → https://…") */
  value?: string;
  /** 这一项对你意味着什么 / 怎么修 */
  detail?: string;
}

export interface SocialPreview {
  url: string;
  host: string;
  title: string | null;
  description: string | null;
  image: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  siteName: string | null;
  twitterCard?: string | null;
  twitterTitle?: string | null;
  twitterDescription?: string | null;
  twitterImage?: string | null;
  favicon?: string | null;
}

export interface ResultSection {
  title: string;
  kind: "checks" | "table" | "code" | "kv" | "previews" | "image" | "text" | "serp";
  items?: CheckItem[];
  table?: { columns: string[]; rows: (string | number | null)[][] };
  code?: { lang: string; text: string; filename?: string };
  kv?: { key: string; value: string }[];
  previews?: { platforms: string[]; data: SocialPreview };
  image?: { src: string; alt: string; width?: number; height?: number };
  text?: string;
  serp?: { title: string; description: string; url: string };
  note?: string;
}

export interface ToolResult {
  ok: boolean;
  tool: string;
  input: string;
  url?: string;
  fetchedAt: string;
  verdict?: Status;
  headline?: string;
  /** 0–100;没有评分的工具为 null */
  score?: number | null;
  sections: ResultSection[];
  download?: { filename: string; mime: string; content: string };
  error?: string;
}

export function worst(statuses: Status[]): Status {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.includes("pass")) return "pass";
  return "info";
}

export function errorResult(tool: string, input: string, message: string): ToolResult {
  return { ok: false, tool, input, fetchedAt: new Date().toISOString(), sections: [], error: message };
}
