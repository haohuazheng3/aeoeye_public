import { NextResponse } from "next/server";
import { getSeoAudit } from "@/lib/seo-audit/repo";
import { toExportView } from "@/lib/seo-audit/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * 完整报告的 JSON 导出 —— 付费权益。未解锁 402;解锁了但完整版还没生成完 409
 * (导出一份只有免费内容的"完整报告"会让买家以为就这么多)。
 * 只含派生指标(V2-0):DataForSEO 的原始 keyword / backlink / competitor 行由 toExportView 剥掉,聚合数保留。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const row = await getSeoAudit(params.id);
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  if (!row.unlocked) {
    return NextResponse.json({ error: "Unlock the full report to export it." }, { status: 402, headers: NO_STORE });
  }
  if (!row.result || row.result.plan !== "full") {
    return NextResponse.json({ error: "Your full report is still being generated. Try again in a minute." }, { status: 409, headers: NO_STORE });
  }
  const safeDomain = row.domain.replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
  const filename = `aeoeye-seo-audit-${safeDomain}-${row.id}.json`;
  return new NextResponse(JSON.stringify(toExportView(row.result), null, 2), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
