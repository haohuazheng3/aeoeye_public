import { captureError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { getAudit } from "@/lib/engine/repo";
import { renderReportPdf, reportFileName } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * 下载完整报告 PDF。与邮件里那份是同一渲染器,用户不必等邮件也能自取。
 * 授权与 upgrade 一致:已解锁即可(报告 ID 随机不可枚举);绑定账户的须本人。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const audit = await getAudit(params.id);
  if (!audit?.result) return new Response("Not found.", { status: 404 });
  if (!audit.unlocked) return new Response("This report hasn't been unlocked yet.", { status: 403 });
  if (audit.userId) {
    const session = await getSessionUser();
    if (audit.userId !== session?.userId) return new Response("Not allowed.", { status: 403 });
  }

  try {
    const pdf = await renderReportPdf(audit.result);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportFileName(audit.result)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    await captureError({
      name: "report_pdf_download",
      message: String((e as Error)?.message ?? e),
      stack: (e as Error)?.stack,
      route: "/api/audit/[id]/pdf",
      source: "server",
    });
    return new Response("Couldn't build the PDF. Please try again.", { status: 500 });
  }
}
