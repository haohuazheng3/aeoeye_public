import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { captureError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import {
  getSeoAudit,
  setTargetKeywords,
  startRerun,
  runRerunInBackground,
  rerunAllowed,
  upgradeRunning,
  SEO_TARGET_CHANGES_MAX,
  SEO_TARGET_KEYWORDS_MAX,
} from "@/lib/seo-audit/repo";
import { consumeRerunQuotas, QuotaUnavailableError } from "@/lib/seo-audit/quota";
import { SeoAuditError } from "@/lib/seo-audit/url";
import type { SeoAuditRow } from "@/lib/seo-audit/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/* ============================================================
   /api/seo-audit/[id]/keywords —— 用户自填的目标关键词(v4,≤3 个,每份报告最多改 3 次)。

   谁能改:
   - 未解锁(付款前在解锁卡里填):持有报告链接即可 —— 报告本来就凭链接公开,改动次数封顶 3 次;
   - 已解锁:行上绑了账户就必须是本人(与重跑同一口径);匿名购买的行凭链接即可。
   已是完整版时,改动后自动重跑一次:新词只为自己调 SERP(≤3 次),其余沿用,花费有界。
   ============================================================ */

const Body = z.object({
  keywords: z.array(z.string().max(200)).max(10),
});

function inBackground(p: Promise<unknown>): void {
  try {
    waitUntil(p);
  } catch {
    /* 本地 dev 无 Vercel 上下文:promise 已在跑 */
  }
}

async function editAllowed(row: SeoAuditRow): Promise<{ ok: true } | { ok: false; status: number; error: string; requiresAuth?: boolean }> {
  if (row.result?.meta?.outcome === "blocked") {
    return { ok: false, status: 403, error: "This report was blocked by the site's firewall, so there is nothing to compare keywords against." };
  }
  if (!row.unlocked || !row.userId) return { ok: true };
  const session = await getSessionUser();
  if (row.userId !== session?.userId) {
    return { ok: false, status: 403, error: "Sign in with the account that owns this report to change its keywords.", requiresAuth: true };
  }
  return { ok: true };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const row = await getSeoAudit(params.id);
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  const allowed = await editAllowed(row);
  const changesLeft = Math.max(0, SEO_TARGET_CHANGES_MAX - (row.targetChanges ?? 0));
  return NextResponse.json(
    {
      keywords: row.targetKeywords ?? [],
      changesLeft,
      max: SEO_TARGET_KEYWORDS_MAX,
      canEdit: allowed.ok && changesLeft > 0,
    },
    { headers: NO_STORE }
  );
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const row = await getSeoAudit(id);
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });

  const allowed = await editAllowed(row);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.error, requiresAuth: allowed.requiresAuth ?? false }, { status: allowed.status, headers: NO_STORE });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: `Send up to ${SEO_TARGET_KEYWORDS_MAX} keywords.` }, { status: 400, headers: NO_STORE });
  }

  const saved = await setTargetKeywords(id, body.keywords);
  if (!saved.ok) return NextResponse.json({ error: saved.error, changesLeft: saved.changesLeft }, { status: 409, headers: NO_STORE });

  // 已是完整版且这次真的改了 → 重跑一次,让排名分按新词重新对比。起不来(在跑 / 频率闸)不算失败:
  // 词已经存好,下一次重跑自然会用上
  let rerunStarted = false;
  let note: string | undefined;
  const isFull = row.unlocked && row.result?.plan === "full";
  if (saved.changed && isFull && rerunAllowed(row)) {
    if (row.status === "pending" || row.status === "running" || upgradeRunning(row)) {
      note = "Saved. A run is already in progress; the next re-run will use these keywords.";
    } else {
      try {
        const q = await consumeRerunQuotas(id);
        if (!q.ok) {
          note = "Saved. Re-run limits are reached for now; re-run the report later to compare against these keywords.";
        } else {
          const plan = await startRerun(id, { refreshPaid: false });
          inBackground(runRerunInBackground(id, plan));
          rerunStarted = true;
        }
      } catch (e) {
        if (e instanceof SeoAuditError && e.code === "timeout") {
          note = "Saved. A run is already in progress; the next re-run will use these keywords.";
        } else if (!(e instanceof QuotaUnavailableError)) {
          await captureError({
            name: "seo_audit_keywords_rerun",
            message: String((e as Error)?.message ?? e),
            stack: (e as Error)?.stack,
            route: "/api/seo-audit/[id]/keywords",
            source: "server",
            level: "warn",
            meta: { id },
          });
          note = "Saved. The re-run could not start; re-run the report to compare against these keywords.";
        } else {
          note = "Saved. Re-run the report to compare against these keywords.";
        }
      }
    }
  } else if (saved.changed && isFull) {
    note = "Saved. The re-run window for this report has closed, so the score was not recomputed.";
  }

  return NextResponse.json(
    { ok: true, keywords: saved.keywords, changed: saved.changed, changesLeft: saved.changesLeft, rerunStarted, ...(note ? { note } : {}) },
    { headers: NO_STORE }
  );
}
