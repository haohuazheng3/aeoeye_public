/* ============================================================
   外链与品牌权威 —— DataForSEO Backlinks

   为什么这个模块必须用真实数据而不是问 LLM:
   LLM 看不到任何外链档案。你问它"这个站的外链质量如何",它只会
   根据品牌名的耳熟程度编一个答案 —— 这正是我们整个产品在反对的事。

   所以这里的数字全部来自 DataForSEO,Claude 只负责**解读**这些数字
   对 AI 引用意味着什么,不负责产出数字。
   ============================================================ */

import { env, features } from "@/lib/env";
import type { BacklinkData } from "./types";

const BASE = "https://api.dataforseo.com/v3";

function authHeader() {
  return { Authorization: `Basic ${env.DATAFORSEO_B64}`, "Content-Type": "application/json" };
}

/**
 * 取域名级外链概览。仅付费报告调用。
 * 拿不到数据一律返回 available:false —— 宁可在报告里说"这项没数据",
 * 也不能拿 0 当成"这个站没有外链"(两者含义完全不同)。
 */
export async function fetchBacklinks(domain: string): Promise<BacklinkData> {
  if (!features.dataforseo) {
    return { available: false, note: "外链数据源未配置,本模块无数据。" };
  }
  try {
    const res = await fetch(`${BASE}/backlinks/summary/live`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify([
        {
          target: domain,
          internal_list_limit: 1,
          backlinks_status_type: "live",
          include_subdomains: true,
        },
      ]),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return { available: false, note: `外链数据源返回 ${res.status},本轮无数据。` };
    }
    const json = (await res.json()) as {
      tasks?: {
        status_code?: number;
        status_message?: string;
        result?: Record<string, unknown>[];
      }[];
    };
    const task = json.tasks?.[0];
    const r = task?.result?.[0];
    if (!r) {
      return {
        available: false,
        note: task?.status_message ? `外链数据源:${task.status_message}` : "外链数据源没有返回这个域名的数据。",
      };
    }

    const backlinks = num(r.backlinks);
    // 实测确认:没有直接的 nofollow 外链计数字段,rel 属性分布在
    // referring_links_attributes 里(形如 {"nofollow": 12, "noopener": 3})。
    // dofollow = 总数 − 带 nofollow 的那些。
    const attrs = (r.referring_links_attributes ?? {}) as Record<string, unknown>;
    const noFollow = num(attrs["nofollow"]) ?? 0;
    const dofollowRatio =
      typeof backlinks === "number" && backlinks > 0
        ? Math.max(0, Math.min(1, (backlinks - noFollow) / backlinks))
        : null;

    return {
      available: true,
      rank: num(r.rank),
      referringDomains: num(r.referring_domains),
      referringMainDomains: num(r.referring_main_domains),
      backlinks,
      dofollowRatio,
      brokenBacklinks: num(r.broken_backlinks),
      spamScore: num(r.backlinks_spam_score),
      firstSeen: typeof r.first_seen === "string" ? r.first_seen : undefined,
    };
  } catch {
    return { available: false, note: "外链数据源请求超时,本轮无数据。" };
  }
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/** 压成给 Claude 读的事实文本 */
export function backlinksToPrompt(b: BacklinkData, domain: string): string {
  if (!b.available) {
    return `No backlink data available for ${domain}.\nReason: ${b.note ?? "unknown"}`;
  }
  return [
    `Source: DataForSEO Backlinks — live index, domain-level, subdomains included.`,
    `Domain: ${domain}`,
    `DataForSEO rank (0-1000, log scale): ${b.rank ?? "n/a"}`,
    `Referring domains: ${b.referringDomains ?? "n/a"}`,
    `Referring main domains: ${b.referringMainDomains ?? "n/a"}`,
    `Total backlinks: ${b.backlinks ?? "n/a"}`,
    `Dofollow share: ${b.dofollowRatio === null || b.dofollowRatio === undefined ? "n/a" : `${Math.round(b.dofollowRatio * 100)}%`}`,
    `Broken backlinks: ${b.brokenBacklinks ?? "n/a"}`,
    `Spam score (0-100, higher is worse): ${b.spamScore ?? "n/a"}`,
    `First seen in the link graph: ${b.firstSeen ?? "n/a"}`,
  ].join("\n");
}
