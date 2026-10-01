import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getSeoAudit } from "@/lib/seo-audit/repo";
import { toPublicView } from "@/lib/seo-audit/view";
import { dfsReady } from "@/lib/seo-audit/dataforseo";
import { confirmCheckoutSession } from "@/lib/orders";
import { FlowGlancePurchase, FlowGlanceUnlock } from "@/components/flowglance";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";
import { SeoProgress } from "@/components/seo-audit/seo-progress";
import { SeoUpgradeRunner } from "@/components/seo-audit/upgrade-runner";
import { SeoReportView } from "@/components/seo-audit/report-view";

/* ============================================================
   /seo-audit/[id] —— 报告页。凭 id 公开(与 $29 报告同口径),noindex,
   Cache-Control: private, no-store 由 API 层负责;页面本身 force-dynamic。

   状态机:failed → 失败壳(带重试表单);pending/running → 阶段进度(客户端每 3s 轮询);
   unlocked 但 plan≠full → 付费生成页;否则 → 报告(toPublicView 决定免费/付费视图)。
   ============================================================ */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const row = await getSeoAudit(params.id);
  if (!row) return { title: "Report not found", robots: { index: false, follow: false } };
  // 被 WAF 拦截的报告正文写着"不出分",标签页标题和分享预览就不能冒出一个数字(复审 C35)——
  // 落库的 score 可能是 robots/TLS 等探针类检查算出来的,看着像真分。历史行可能还带着分数,所以按 outcome 再判一次。
  const blocked = row.result?.meta?.outcome === "blocked";
  const scored = row.status === "complete" && row.score !== null && !blocked;
  const title = scored ? `${row.domain} — Technical SEO score ${row.score}/100` : `${row.domain} — Technical SEO audit`;
  const base = `Technical SEO audit of ${row.domain}: crawlability, on-page, Core Web Vitals, mobile, structured data, HTTPS and internal links.`;
  const description = blocked
    ? `${base} Our crawler was blocked by the site's firewall, so no score was given.`
    : scored && row.grade
      ? `${base} Grade ${row.grade}.`
      : base;
  return {
    title,
    description,
    // 报告为用户专属,凭 id 分享;不索引
    robots: { index: false, follow: false },
  };
}

export default async function SeoAuditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { session_id?: string };
}) {
  // 从 Stripe 返回时同步确认付款并解锁(消除 webhook 异步竞态);实收金额供分析
  const checkout = searchParams?.session_id ? await confirmCheckoutSession(searchParams.session_id) : null;
  const row = await getSeoAudit(params.id);
  if (!row) notFound();

  if (row.status === "failed") {
    return (
      <StateShell
        icon={<AlertTriangle className="h-7 w-7 text-coral" />}
        title="We couldn't finish this audit"
        body={row.error || "Something went wrong. Check the URL is public and online, then try again."}
        defaultValue={row.input}
      />
    );
  }

  if (row.status !== "complete" || !row.result) {
    // 已解锁报告的重跑固定是完整版(40 页 + 桌面 PSI + 站外模块),进度页文案与阶段行跟着变(复审 C33)
    return <SeoProgress id={row.id} domain={row.domain} full={row.unlocked} />;
  }

  const delivered = row.unlocked && row.result.plan === "full";
  // 解锁按钮渲染前预检 DataForSEO(凭据、连通、余额 ≥ $1;进程内缓存 10 分钟)——
  // 卖一份此刻交付不了的报告是事故。只在真的要摆按钮时才查:已解锁或被 WAF 拦截的报告没有按钮。
  const needsUnlockButton = !row.unlocked && row.result.meta.outcome !== "blocked";
  const dfs = needsUnlockButton ? await dfsReady().catch(() => ({ ok: false })) : { ok: true };

  return (
    <>
      {/* 付款那一刻 —— 与 $29 报告分账(item "seo-report") */}
      {checkout?.paid && searchParams?.session_id && (
        <FlowGlancePurchase
          auditId={row.id}
          amountCents={checkout.amountCents}
          currency={checkout.currency}
          sessionId={searchParams.session_id}
          item="seo-report"
        />
      )}
      {/* 东西真的到手那一刻 —— 判据是内容到齐(plan=full),不是页面解锁了 */}
      <FlowGlanceUnlock auditId={row.id} delivered={delivered} item="seo-report" />

      {row.unlocked && row.result.plan !== "full" ? (
        <SeoUpgradeRunner auditId={row.id} domain={row.domain} />
      ) : (
        <SeoReportView
          result={toPublicView(row.result, row.unlocked)}
          id={row.id}
          unlocked={row.unlocked}
          dfsReady={dfs.ok}
          completedAt={row.completedAt ?? row.createdAt}
          // complete 行上的 error 只来自重跑失败 / 超时 / 被拦(成功落库与开始重跑都会清空它)——
          // 不显示的话用户看到旧报告、旧时间戳,以为重跑没生效又去点一次(复审 C33)
          rerunError={row.error}
        />
      )}
    </>
  );
}

function StateShell({
  icon,
  title,
  body,
  defaultValue,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  defaultValue?: string;
}) {
  return (
    <div className="container-tight flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <div className="surface flex h-14 w-14 items-center justify-center">{icon}</div>
      <h1 className="mt-5 font-display text-2xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-md text-ink/60">{body}</p>
      <div className="mt-6 w-full max-w-md text-left">
        <SeoAuditForm source="seo-report-error" variant="inline" cta="Try again" defaultValue={defaultValue} />
      </div>
    </div>
  );
}
