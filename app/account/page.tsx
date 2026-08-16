import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Code2, CreditCard, LayoutDashboard, Mail, ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { audits as auditsTable, subscriptions as subsTable } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { isApiOwner, getUsage, listApiKeys } from "@/lib/api-keys";
import { ManageBillingButton } from "@/components/manage-billing";

export const metadata: Metadata = {
  title: "Account settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * 个人设置中心 —— 头像菜单的落点(站长 2026-08-10 指定的入口路径)。
 *
 * 为什么 API 入口放这里而不是塞进头像菜单里判断权限:菜单在 SiteHeader,
 * 而 SiteHeader 在 layout 每页渲染 —— 在那里调 auth() 会把 122 个 SSG 页面
 * 全变成动态渲染。菜单统一进 /account,由这个服务端页面决定给谁看 API。
 */
export default async function AccountPage() {
  const session = await getSessionUser();

  if (!session) {
    return (
      <div className="container-tight flex min-h-[55vh] flex-col items-center justify-center py-20 text-center">
        <h1 className="font-display text-2xl font-semibold">Sign in to manage your account</h1>
        <Link href="/login?redirect=/account" className="btn-primary mt-6">
          Sign in
        </Link>
      </div>
    );
  }

  const apiEnabled = isApiOwner(session.email);

  const [myAudits, mySubs, keys, usage] = await Promise.all([
    db
      .select({ id: auditsTable.id })
      .from(auditsTable)
      .where(eq(auditsTable.userId, session.userId))
      .orderBy(desc(auditsTable.createdAt))
      .limit(100),
    db.select().from(subsTable).where(eq(subsTable.userId, session.userId)),
    apiEnabled ? listApiKeys(session.userId) : Promise.resolve([]),
    apiEnabled ? getUsage(session.userId, 1) : Promise.resolve(null),
  ]);
  const activeSub = mySubs.find((s) => s.status === "active" || s.status === "trialing");
  const activeKeys = keys.filter((k) => !k.revokedAt).length;

  return (
    <div className="container-tight space-y-8 py-12 sm:space-y-10 sm:py-16">
      <div>
        <p className="eyebrow">Account</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
      </div>

      {/* 身份 */}
      <section className="card p-6 sm:p-7">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-iris/10 text-iris">
              <Mail className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{session.email}</p>
              <p className="text-xs text-ink/45">
                Signed in with an email code · {myAudits.length} {myAudits.length === 1 ? "audit" : "audits"} run
              </p>
            </div>
          </div>
          <Link href="/dashboard" className="btn-ghost shrink-0">
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </Link>
        </div>
      </section>

      {/* API —— 站长要找的就是这块 */}
      <section className="card p-6 sm:p-7">
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-iris/10 text-iris">
                <Code2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">API</h2>
                <p className="mt-1 max-w-lg text-sm leading-relaxed text-ink/55">
                  {apiEnabled ? (
                    <>
                      One call returns a complete report as JSON — 10 buyer questions across 5 AI engines, plus the
                      5-layer site audit.
                    </>
                  ) : (
                    <>Programmatic access is in private testing and isn’t open on this account yet.</>
                  )}
                </p>
              </div>
            </div>
            {apiEnabled && (
              <Link href="/account/api" className="btn-primary shrink-0">
                Open API console <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          {apiEnabled ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <MiniStat icon={<KeyRound className="h-3.5 w-3.5" />} label="Active keys" value={String(activeKeys)} />
              <MiniStat
                icon={<Code2 className="h-3.5 w-3.5" />}
                label="Calls"
                value={String(usage?.totals.calls ?? 0)}
              />
              <MiniStat
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
                label="Spend"
                value={money(usage?.totals.costUsd ?? 0)}
              />
            </div>
          ) : (
            // 可诊断:直接把判定用的邮箱摆出来。不匹配时一眼就知道原因,
            // 不用去猜是"没开通"还是"登错账号"。
            <p className="mt-4 rounded-2xl bg-ink/[0.03] px-4 py-3 text-xs text-ink/45">
              Signed in as <span className="font-medium text-ink/70">{session.email}</span>. If you expected access
              here, you’re on a different account than the one the API is enabled for.
            </p>
          )}
        </div>
      </section>

      {/* 账单 —— 只对还有订阅的人出现(Pro 已下线,但历史订阅者要能自助管理) */}
      {activeSub && (
        <section className="card p-6 sm:p-7">
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-iris/10 text-iris">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Billing</h2>
                <p className="mt-0.5 text-sm text-ink/55">Legacy plan · manage or cancel any time.</p>
              </div>
            </div>
            <ManageBillingButton />
          </div>
        </section>
      )}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="surface p-4">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink/40">
        {icon}
        {label}
      </p>
      <p className="mt-1.5 font-display text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function money(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
