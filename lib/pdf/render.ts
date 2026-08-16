import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { ReportPdf } from "./report-pdf";
import type { AuditResult } from "@/lib/engine/types";

/** 把审计结果渲染成 PDF 二进制。失败抛错(由调用方决定是否降级)。 */
export async function renderReportPdf(result: AuditResult): Promise<Buffer> {
  // ReportPdf 返回的是 <Document>,但它自身的 props 是 { result } —— renderToBuffer
  // 的签名要求元素 props 为 DocumentProps,故在此收窄一次。
  const el = createElement(ReportPdf, { result }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(el);
}

/** 邮件附件/下载用的文件名:品牌 + 日期,可安全落盘 */
export function reportFileName(result: AuditResult): string {
  const slug =
    (result.domain || result.brand || "report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "report";
  const d = new Date(result.meta.generatedAt);
  const stamp = Number.isNaN(d.getTime()) ? "" : `-${d.toISOString().slice(0, 10)}`;
  return `aeoeye-${slug}${stamp}.pdf`;
}
