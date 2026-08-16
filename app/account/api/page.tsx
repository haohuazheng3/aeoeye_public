import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getUsage, isApiOwner, listApiKeys } from "@/lib/api-keys";
import { KeysPanel, type KeyRow } from "@/components/api/keys-panel";
import { UsagePanel } from "@/components/api/usage-panel";
import { GuidePanel } from "@/components/api/guide-panel";

export const metadata: Metadata = {
  title: "API",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * API 控制台 —— 三个悬浮模块:钥匙、花费、指南。
 * 目前只对站长本人开放(API_OWNER_EMAIL);其他账号看到的是一句诚实的"还没开放",
 * 而不是一个点了会报 403 的假界面。
 */
export default async function ApiConsolePage() {
  const session = await getSessionUser();

  if (!session) {
    return (
      <Shell>
        <div className="card p-10 text-center">
          <div className="relative z-10">
            <h1 className="font-display text-2xl font-semibold">Sign in to manage your API</h1>
            <Link href="/login?redirect=/account/api" className="btn-primary mt-6">
              Sign in
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!isApiOwner(session.email)) {
    return (
      <Shell>
        <div className="card p-10 text-center">
          <div className="relative z-10">
            <h1 className="font-display text-2xl font-semibold">The API isn’t open yet</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/55">
              Programmatic access is in private testing. Reports are available in the browser today — run one from your
              dashboard.
            </p>
            <Link href="/account" className="btn-ghost mt-6">
              Back to settings
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  const [keys, usage] = await Promise.all([listApiKeys(session.userId), getUsage(session.userId)]);

  const keyRows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
  }));

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Developers</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">API</h1>
          <p className="mt-2 max-w-xl text-ink/55">
            One call returns a complete report as JSON — 10 buyer questions across 5 AI engines, plus the SEO foundation
            audit.
          </p>
        </div>
        <Link href="/account" className="btn-ghost shrink-0">
          Settings
        </Link>
      </div>

      <KeysPanel initialKeys={keyRows} />
      <UsagePanel usage={usage} />
      <GuidePanel />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="container-tight space-y-8 py-12 sm:space-y-10 sm:py-16">{children}</div>;
}
