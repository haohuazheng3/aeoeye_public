import { ONSITE_DIMENSIONS, type SeoAuditResult } from "@/lib/seo-audit/types";
import { DimensionCard } from "./dimension-card";

/* 7 个站内维度,3 列栅格;站外 3 个付费维度在 PaidSections 里单独展示,不混在这。
   dfsReady 一路透传到灯箱里每条锁定检查的预告:供应商不可用时那里也不能摆解锁按钮(复审 C28) */
export function DimensionGrid({
  result,
  id,
  unlocked,
  dfsReady = true,
}: {
  result: SeoAuditResult;
  id: string;
  unlocked: boolean;
  dfsReady?: boolean;
}) {
  const dims = ONSITE_DIMENSIONS.map((d) => result.dimensions.find((x) => x.id === d)).filter(
    (d): d is NonNullable<typeof d> => !!d
  );
  if (!dims.length) return null;
  const low = new Set(result.meta.confidence?.lowConfidence ?? []);
  const unmeasured = new Set(result.meta.confidence?.unmeasured ?? []);
  const total = result.checks.filter((c) => c.status === "fail" || c.status === "warn").length;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Score by dimension</h2>
        <p className="mt-1 text-sm text-ink/45">
          {total > 0 ? `${total} things to fix across 7 dimensions.` : "Nothing failing across 7 dimensions."} Tap any card
          for every check we ran.
        </p>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dims.map((d) => (
          <DimensionCard
            key={d.id}
            dim={d}
            checks={result.checks.filter((c) => c.dimension === d.id)}
            auditId={id}
            unlocked={unlocked}
            dfsReady={dfsReady}
            lowConfidence={low.has(d.id)}
            unmeasured={unmeasured.has(d.id)}
          />
        ))}
      </div>
    </section>
  );
}
