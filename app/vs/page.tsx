import type { Metadata } from "next";
import Link from "next/link";
import { getPages } from "@/lib/content/pages";
import { AuditForm } from "@/components/audit-form";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "AEOeye vs Other AI Visibility Tools — Honest Comparisons",
  description:
    "Honest, side-by-side comparisons of AEOeye against Profound, Otterly, Peec AI, Nightwatch and other AI visibility tools. See which fits your needs and budget.",
  path: "/vs",
});

export default function VsHub() {
  const pages = getPages("vs");
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Comparisons</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">AEOeye vs the alternatives</h1>
        <p className="mt-4 text-ink/65">No spin — clear comparisons against every major AI visibility tool, so you can pick what actually fits.</p>
      </div>
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.slug} href={`/vs/${p.slug}`} className="card p-5 card-hover">
            <h2 className="font-display text-lg font-semibold leading-snug">{p.title}</h2>
            <p className="mt-2 line-clamp-2 text-sm text-ink/60">{p.metaDescription}</p>
          </Link>
        ))}
      </div>
      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Try the free alternative</h2>
        <p className="mt-2 text-sm text-white/65">Run an AI visibility audit free — no card, no contract.</p>
        <div className="mt-6"><AuditForm source="vs-hub" /></div>
      </section>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Comparisons", path: "/vs" }]),
          itemListJsonLd("AEOeye comparisons", pages.map((p) => ({ name: p.title, path: `/vs/${p.slug}` }))),
        ]}
      />
    </div>
  );
}
