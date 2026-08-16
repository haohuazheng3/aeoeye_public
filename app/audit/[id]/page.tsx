import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { getAudit } from "@/lib/engine/repo";
import { confirmCheckoutSession } from "@/lib/orders";
import { ReportView } from "@/components/report/report-view";
import { FlowGlancePurchase, FlowGlanceUnlock } from "@/components/flowglance";
import { AuditForm } from "@/components/audit-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const audit = await getAudit(params.id);
  if (!audit) return { title: "Report not found", robots: { index: false, follow: false } };
  const title =
    audit.status === "complete" && audit.score !== null
      ? `${audit.brand} — AI visibility ${audit.score}/100`
      : `${audit.brand} — AI visibility audit`;
  return {
    title,
    description: `How AI assistants recommend ${audit.brand} when buyers ask. Grade ${audit.grade ?? "—"}.`,
    // 报告为用户专属,避免薄内容索引;可自由分享
    robots: { index: false, follow: false },
  };
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { session_id?: string };
}) {
  // 从 Stripe 返回时同步确认付款并立即解锁(消除 webhook 异步竞态)。
  // 顺带拿到实收金额 —— 分析里的营收数字要用 Stripe 实收,不是价目表标价。
  const checkout = searchParams?.session_id ? await confirmCheckoutSession(searchParams.session_id) : null;
  const audit = await getAudit(params.id);
  if (!audit) notFound();

  if (audit.status === "failed") {
    return (
      <StateShell
        icon={<AlertTriangle className="h-7 w-7 text-coral" />}
        title="We couldn’t finish this audit"
        body={audit.error || "Something went wrong. Please try again with a brand name or full website URL."}
      />
    );
  }

  if (audit.status !== "complete" || !audit.result) {
    return (
      <StateShell
        icon={<RefreshCw className="h-7 w-7 animate-spin text-iris" />}
        title="Your audit is still running"
        body="This usually takes under a minute. Refresh in a moment to see your report."
      />
    );
  }

  return (
    <>
      {/* 付款那一刻 */}
      {checkout?.paid && searchParams?.session_id && (
        <FlowGlancePurchase
          auditId={audit.id}
          amountCents={checkout.amountCents}
          currency={checkout.currency}
          sessionId={searchParams.session_id}
        />
      )}
      {/* 东西真的到手那一刻 —— 判据是内容到齐(plan=full),不是页面解锁了 */}
      <FlowGlanceUnlock auditId={audit.id} delivered={audit.unlocked && audit.result.meta.plan === "full"} />
      <ReportView result={audit.result} id={audit.id} unlocked={audit.unlocked} />
    </>
  );
}

function StateShell({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="container-tight flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center surface">{icon}</div>
      <h1 className="mt-5 font-display text-2xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-md text-ink/60">{body}</p>
      <div className="mt-6 w-full max-w-md">
        <AuditForm source="report-error" variant="inline" cta="Try again" />
      </div>
    </div>
  );
}
