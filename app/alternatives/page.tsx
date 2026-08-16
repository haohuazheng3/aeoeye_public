import type { Metadata } from "next";
import Link from "next/link";
import { getPages } from "@/lib/content/pages";
import { AuditForm } from "@/components/audit-form";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "AI Visibility Tool Alternatives — Compare Your Options",
  description:
    "Looking for an alternative to Profound, Otterly, Peec AI or another AI visibility tool? Compare the real options, why people switch, and find the right fit.",
  path: "/alternatives",
});

export default function AlternativesHub() {
  const pages = getPages("alternatives");
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Alternatives</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Find the right AI visibility tool</h1>
        <p className="mt-4 text-ink/65">Why teams look elsewhere, and the best alternatives to each major platform — including a free one.</p>
      </div>
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.slug} href={`/alternatives/${p.slug}`} className="card p-5 card-hover">
            <h2 className="font-display text-lg font-semibold leading-snug">{p.title}</h2>
            <p className="mt-2 line-clamp-2 text-sm text-ink/60">{p.metaDescription}</p>
          </Link>
        ))}
      </div>
      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Start free in under a minute</h2>
        <p className="mt-2 text-sm text-white/65">See how AI describes your brand — no signup required.</p>
        <div className="mt-6"><AuditForm source="alternatives-hub" /></div>
      </section>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Alternatives", path: "/alternatives" }]),
          itemListJsonLd("AI visibility tool alternatives", pages.map((p) => ({ name: p.title, path: `/alternatives/${p.slug}` }))),
        ]}
      />
    </div>
  );
}
