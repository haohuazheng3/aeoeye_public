import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { audits, orders } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { sendEmail, reportEmailHtml, reportEmailText } from "@/lib/email";
import { renderReportPdf, reportFileName } from "@/lib/pdf/render";
import { features } from "@/lib/env";
import { siteUrl } from "@/lib/site";
import type { AuditResult } from "@/lib/engine/types";

/** 买家邮箱:优先该报告对应的已付款订单(匿名购买时那是唯一来源),其次审计自身记录 */
export async function buyerEmailFor(auditId: string): Promise<string | null> {
  const rows = await db
    .select({ email: orders.email })
    .from(orders)
    .where(and(eq(orders.auditId, auditId), eq(orders.status, "paid")))
    .orderBy(desc(orders.paidAt))
    .limit(1);
  const fromOrder = (rows[0]?.email || "").trim();
  if (fromOrder.includes("@")) return fromOrder;
  const a = await db.select({ email: audits.email }).from(audits).where(eq(audits.id, auditId)).limit(1);
  const fromAudit = (a[0]?.email || "").trim();
  return fromAudit.includes("@") ? fromAudit : null;
}

/**
 * 把完整报告以 PDF 附件发到买家邮箱。
 *
 * 幂等:先用「pdf_sent_at 仍为空」作为条件抢占,抢到才发 —— 避免 webhook 与
 * 页面回跳同时触发时发两封。发送失败会把标记清回 null,以便下次重试。
 * 一切失败都只记录、绝不向上抛 —— 邮件发不出去不该让付费流程报错。
 */
export async function deliverReportPdf(args: {
  auditId: string;
  result: AuditResult;
  to?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const { auditId, result } = args;

  if (!features.email) return { sent: false, reason: "email_not_configured" };

  const to = (args.to || (await buyerEmailFor(auditId)) || "").trim();
  if (!to.includes("@")) return { sent: false, reason: "no_recipient" };

  // 抢占发送权(同时也是"已发送"标记)
  const claimed = await db
    .update(audits)
    .set({ pdfSentAt: new Date() })
    .where(and(eq(audits.id, auditId), isNull(audits.pdfSentAt)))
    .returning({ id: audits.id });
  if (!claimed.length) return { sent: false, reason: "already_sent" };

  try {
    const pdf = await renderReportPdf(result);
    const engineCount = result.engines.filter((e) => e.status === "ok").length;
    const reportUrl = `${siteUrl}/audit/${auditId}`;
    const res = await sendEmail({
      to,
      subject: `Your AI visibility report — ${result.brand} (${result.overallScore}/100)`,
      html: reportEmailHtml({
        brand: result.brand,
        domain: result.domain,
        score: result.overallScore,
        grade: result.grade,
        summary: result.summary,
        reportUrl,
        engineCount,
      }),
      text: reportEmailText({
        brand: result.brand,
        score: result.overallScore,
        grade: result.grade,
        summary: result.summary,
        reportUrl,
      }),
      attachments: [{ filename: reportFileName(result), content: pdf }],
    });
    if (!res.ok) throw new Error(res.error || "send failed");
    return { sent: true };
  } catch (e) {
    // 释放标记,下次可重试
    await db.update(audits).set({ pdfSentAt: null }).where(eq(audits.id, auditId));
    await captureError({
      name: "report_pdf_delivery",
      message: String((e as Error)?.message ?? e),
      stack: (e as Error)?.stack,
      route: "/lib/report-delivery",
      source: "server",
    });
    return { sent: false, reason: "send_failed" };
  }
}
