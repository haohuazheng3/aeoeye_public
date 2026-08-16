import type { Metadata } from "next";
import Link from "next/link";
import { getPages } from "@/lib/content/pages";
import { AuditForm } from "@/components/audit-form";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Compare — AEO vs SEO vs GEO & AI Engine Differences",
  description:
    "Clear, opinionated comparisons: AEO vs SEO, GEO vs SEO, and how ChatGPT, Perplexity and Gemini differ for brand visibility. Understand what to optimize for.",
  path: "/compare",
});

export default function CompareHub() {
  const pages = getPages("compare");
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Compare</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Make sense of the acronyms</h1>
        <p className="mt-4 text-ink/65">AEO, GEO, SEO — and how the AI engines actually differ. Side-by-side, no hype.</p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.slug} href={`/compare/${p.slug}`} className="card p-5 card-hover">
            <h2 className="font-display text-lg font-semibold leading-snug">{p.title}</h2>
            <p className="mt-2 line-clamp-2 text-sm text-ink/60">{p.metaDescription}</p>
          </Link>
        ))}
      </div>

      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">See where you stand</h2>
        <p className="mt-2 text-sm text-white/65">A free audit shows how AI ranks you against competitors.</p>
        <div className="mt-6"><AuditForm source="compare-hub" /></div>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Compare", path: "/compare" }]),
          itemListJsonLd("AEO concept comparisons", pages.map((p) => ({ name: p.title, path: `/compare/${p.slug}` }))),
        ]}
      />
    </div>
  );
}
