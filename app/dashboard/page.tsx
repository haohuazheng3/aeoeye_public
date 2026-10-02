import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ExternalLink, Crown, Plus, Code2 } from "lucide-react";
import { db } from "@/lib/db";
import { audits as auditsTable, subscriptions as subsTable } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { isApiOwner } from "@/lib/api-keys";
import { confirmCheckoutSession, claimAnonymousAudits } from "@/lib/orders";
import { listSeoAuditsForUser } from "@/lib/seo-audit/repo";
import { usableRanking } from "@/components/seo-audit/ranking-meta";
import { AuditForm } from "@/components/audit-form";
import { ManageBillingButton } from "@/components/manage-billing";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: { session_id?: string } }) {
  // 从 Stripe 返回时同步确认订单(消除 webhook 竞态)
  if (searchParams?.session_id) {
    await confirmCheckoutSession(searchParams.session_id);
  }
  const session = await getSessionUser();
  const userId = session?.userId ?? null;

  if (!userId) {
    return (
      <div className="container-tight flex min-h-[55vh] flex-col items-center justify-center py-20 text-center">
        <h1 className="font-display text-2xl font-semibold">Sign in to view your dashboard</h1>
        <p className="mt-2 max-w-md text-ink/60">See every audit you’ve run and open your full reports.</p>
        <Link href="/login" className="btn-primary mt-6">
          Sign in
        </Link>
      </div>
    );
  }

  // 认领匿名购买:用同一邮箱在 Stripe 付过款的报告,登录后自动归到本账号。
  // 放在查询之前,这样第一次登录就能看到,不需要刷新第二次。
  if (session?.email) {
    try {
      await claimAnonymousAudits(userId, session.email);
    } catch {
      /* 认领失败不该挡住 dashboard */
    }
  }

  const [myAudits, mySubs, mySeoAudits] = await Promise.all([
    db.select().from(auditsTable).where(eq(auditsTable.userId, userId)).orderBy(desc(auditsTable.createdAt)).limit(30),
    db.select().from(subsTable).where(eq(subsTable.userId, userId)),
    // 第二个产品面的列表。它出问题不该拖垮整个 dashboard(关键路径 #4),失败就当没有
    listSeoAuditsForUser(userId).catch(() => []),
  ]);
  const activeSub = mySubs.find((s) => s.status === "active" || s.status === "trialing");
  const apiEnabled = isApiOwner(session?.email);

  return (
    <div className="container-tight py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Your dashboard</h1>
          <p className="mt-1 text-sm text-ink/55">Your AI visibility, all in one place.</p>
        </div>
        {/*
          Pro 订阅已下线,不再推销。但历史订阅用户仍要能看到自己的状态并自助管理账单 ——
          直接抹掉入口等于把还在扣费的人锁在外面。没有订阅的用户只看到"跑新审计"。
        */}
        <div className="flex items-center gap-3">
          {/* API 入口只对开通了的账号出现 —— 给别人看一个点进去说"未开放"的链接毫无意义 */}
          {apiEnabled && (
            <Link href="/account/api" className="btn-ghost">
              <Code2 className="h-4 w-4" /> API
            </Link>
          )}
          {activeSub ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-iris/10 px-3 py-1.5 text-sm font-semibold text-iris">
                <Crown className="h-4 w-4" /> Legacy plan
              </span>
              <ManageBillingButton />
            </>
          ) : null}
        </div>
      </div>

      {/* 新审计 */}
      <div className="card mt-8 p-6">
        <h2 className="font-display text-lg font-semibold">Run a new audit</h2>
        <div className="mt-4 max-w-xl">
          <AuditForm source="dashboard" variant="inline" cta="Audit" />
        </div>
      </div>

      {/* 历史 */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold">Recent audits</h2>
        {myAudits.length === 0 ? (
          <div className="card mt-4 flex flex-col items-center gap-3 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center surface text-iris">
              <Plus className="h-6 w-6" />
            </div>
            <p className="text-sm text-ink/60">No audits yet. Run your first one above.</p>
          </div>
        ) : (
          <div className="card mt-4 divide-y divide-paper-dim">
            {myAudits.map((a) => (
              <Link
                key={a.id}
                href={`/audit/${a.id}`}
                className="flex items-center justify-between gap-4 p-4 transition hover:bg-paper-soft"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{a.brand}</p>
                  <p className="text-xs text-ink/50">
                    {a.domain} · {formatDate(a.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {a.score !== null ? (
                    <span className="font-display text-lg font-semibold text-iris">{a.score}</span>
                  ) : (
                    <span className="text-xs text-ink/40 capitalize">{a.status}</span>
                  )}
                  <ExternalLink className="h-4 w-4 text-ink/30" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* SEO 审计(独立产品面,独立表)。空态也给入口 —— 很多用户是在这里第一次知道有它 */}
      <div className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-semibold">SEO audits</h2>
          <Link href="/seo-audit" className="text-sm font-medium text-iris hover:underline">
            Run an SEO audit
          </Link>
        </div>
        {mySeoAudits.length === 0 ? (
          <div className="card mt-4 p-6 text-sm text-ink/60">
            No SEO audits yet.{" "}
            <Link href="/seo-audit" className="font-medium text-iris hover:underline">
              Score any site’s SEO health
            </Link>{" "}
            — free, takes about a minute.
          </div>
        ) : (
          <div className="card mt-4 divide-y divide-paper-dim">
            {mySeoAudits.map((a) => {
              // 被 WAF 拦截的报告不出分(复审 C35):落库的 score 可能是探针类检查算出的数字,不能在这里冒出来
              const blocked = a.result?.meta?.outcome === "blocked";
              // 已解锁的完整版以 SEO Ranking Score 为头条(与报告首屏同一个数);其余仍是技术分
              const ranking = a.unlocked && a.result?.plan === "full" && !blocked ? usableRanking(a.result?.ranking) : null;
              const shown = ranking ? ranking.overall.score : a.score;
              return (
                <Link
                  key={a.id}
                  href={`/seo-audit/${a.id}`}
                  className="flex items-center justify-between gap-4 p-4 transition hover:bg-paper-soft"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{a.domain}</p>
                    <p className="text-xs text-ink/50">
                      {formatDate(a.createdAt)} ·{" "}
                      {a.unlocked ? <span className="font-semibold text-iris">Unlocked</span> : "Free"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {shown !== null && !blocked ? (
                      <span
                        className="font-display text-lg font-semibold text-iris"
                        title={ranking ? "SEO Ranking Score" : "Technical SEO score"}
                      >
                        {shown}
                      </span>
                    ) : (
                      <span className="text-xs text-ink/40 capitalize">{blocked ? "Blocked" : a.status}</span>
                    )}
                    <ExternalLink className="h-4 w-4 text-ink/30" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
