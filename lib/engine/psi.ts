/* ============================================================
   移动性能 —— 只用真实用户数据(CrUX field data)

   刻意**不用** Lighthouse 实验室数据:
   实验室跑分是在 Google 机房用模拟网络跑出来的,和你的真实用户在
   什么设备、什么网络下打开你的站没有必然关系。报告里写「你的用户
   体验是 X」,数据就必须来自真实用户,否则是伪造数据来源。

   降级链(三级,每级都如实标注,绝不偷换):
     1. 页面级字段数据   loadingExperience
     2. 整站级字段数据   originLoadingExperience   —— 页面流量不够但整站够时能取到
     3. 都没有           如实说「真实流量还不足以让 Chrome 生成字段数据」

   第 3 级本身就是信息:说明这个站的真实访问量还很小。这个事实比
   编一个漂亮的实验室分数有用得多。
   ============================================================ */

import { env } from "@/lib/env";
import type { FieldMetric, PsiFieldData } from "./types";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** CrUX 指标 → 展示用元数据 */
const METRICS: Record<string, { label: string; unit: "ms" | "score" }> = {
  LARGEST_CONTENTFUL_PAINT_MS: { label: "Largest Contentful Paint", unit: "ms" },
  INTERACTION_TO_NEXT_PAINT: { label: "Interaction to Next Paint", unit: "ms" },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { label: "Cumulative Layout Shift", unit: "score" },
  FIRST_CONTENTFUL_PAINT_MS: { label: "First Contentful Paint", unit: "ms" },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { label: "Time to First Byte", unit: "ms" },
};

type CruxBlock = {
  overall_category?: string;
  metrics?: Record<string, { percentile?: number; category?: string }>;
};

function toMetrics(block: CruxBlock): FieldMetric[] {
  const out: FieldMetric[] = [];
  for (const [key, meta] of Object.entries(METRICS)) {
    const m = block.metrics?.[key];
    if (!m || typeof m.percentile !== "number") continue;
    out.push({
      metric: key,
      label: meta.label,
      // CLS 的 percentile 是放大 100 倍的整数,还原成标准写法(0.1 这种)
      p75: meta.unit === "score" ? m.percentile / 100 : m.percentile,
      unit: meta.unit,
      category: (m.category as FieldMetric["category"]) || "AVERAGE",
    });
  }
  return out;
}

/**
 * 取移动端真实用户字段数据。
 * 密钥只通过 env 引用,绝不打印、绝不写进任何会上传的文件。
 */
export async function fetchFieldData(url: string): Promise<PsiFieldData> {
  if (!env.PSI_API) {
    return { scope: "none", metrics: [], note: "PageSpeed Insights 未配置,本模块无数据。" };
  }
  try {
    const qs = new URLSearchParams({
      url,
      strategy: "mobile",
      key: env.PSI_API,
    });
    // category 参数可重复,URLSearchParams 单独 append
    qs.append("category", "performance");

    const res = await fetch(`${ENDPOINT}?${qs.toString()}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return {
        scope: "none",
        metrics: [],
        note: `PageSpeed Insights 返回 ${res.status},本轮拿不到真实用户数据。`,
      };
    }
    const json = (await res.json()) as {
      loadingExperience?: CruxBlock;
      originLoadingExperience?: CruxBlock;
    };

    // 一级:页面自身的字段数据
    const page = json.loadingExperience;
    if (page?.metrics && Object.keys(page.metrics).length) {
      return {
        scope: "page",
        overall: (page.overall_category as PsiFieldData["overall"]) || undefined,
        metrics: toMetrics(page),
      };
    }

    // 二级:整站聚合
    const origin = json.originLoadingExperience;
    if (origin?.metrics && Object.keys(origin.metrics).length) {
      return {
        scope: "origin",
        overall: (origin.overall_category as PsiFieldData["overall"]) || undefined,
        metrics: toMetrics(origin),
        note: "这个页面本身的访问量还不够,以下是整站聚合的真实用户数据。",
      };
    }

    // 三级:如实承认没有,并说明这件事本身的含义
    return {
      scope: "none",
      metrics: [],
      note: "Chrome 用户体验报告里没有这个站的数据 —— 说明真实访问量还没到 Google 的采样门槛。这本身就是一个信号:流量规模还不足以支撑 AI 引用所需的权威度。",
    };
  } catch {
    return { scope: "none", metrics: [], note: "PageSpeed Insights 请求超时,本轮无真实用户数据。" };
  }
}

/** 压成给 Claude 读的事实文本 */
export function psiToPrompt(psi: PsiFieldData): string {
  if (psi.scope === "none") {
    return `No Chrome UX Report field data available.\nReason: ${psi.note ?? "unknown"}`;
  }
  const scopeLabel = psi.scope === "page" ? "this exact page" : "the whole origin (site-wide aggregate)";
  return [
    `Source: Chrome UX Report — REAL users, ${scopeLabel}, mobile.`,
    `Overall: ${psi.overall ?? "unknown"}`,
    ...psi.metrics.map(
      (m) => `- ${m.label}: p75 = ${m.unit === "ms" ? `${Math.round(m.p75)}ms` : m.p75.toFixed(3)} (${m.category})`
    ),
    psi.note ? `Note: ${psi.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
