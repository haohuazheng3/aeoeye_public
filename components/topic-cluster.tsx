import Link from "next/link";
import { Layers, ArrowUpRight } from "lucide-react";
import type { Pillar } from "@/lib/content/clusters";

/** 支柱页:展示其覆盖的全部集群子页(内链 + 知识体系信号) */
export function ClusterNav({ pillar }: { pillar: Pillar }) {
  return (
    <section className="mt-12 rounded-2xl border border-iris/20 bg-iris/[0.04] p-6">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-iris">
        <Layers className="h-3.5 w-3.5" /> Explore the {pillar.name} cluster
      </p>
      <p className="mt-2 text-sm text-ink/60">{pillar.blurb}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {pillar.clusters.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="inline-flex items-center justify-between gap-2 rounded-lg border border-paper-dim bg-white px-3.5 py-2.5 text-sm font-medium text-ink/80 transition hover:border-iris/40 hover:text-iris"
          >
            {c.label}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Link>
        ))}
      </div>
    </section>
  );
}

/** 集群页:回到所属支柱的链接 */
export function PillarBacklink({ pillar }: { pillar: Pillar }) {
  return (
    <p className="mt-3 text-sm text-ink/55">
      Part of our pillar guide:{" "}
      <Link href={`/blog/${pillar.blogSlug}`} className="font-medium text-iris link-underline">
        {pillar.name}
      </Link>
    </p>
  );
}
