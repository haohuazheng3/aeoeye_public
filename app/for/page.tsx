import type { Metadata } from "next";
import Link from "next/link";
import { getPages } from "@/lib/content/pages";
import { AuditForm } from "@/components/audit-form";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "AI Visibility Solutions by Industry — SaaS, Ecommerce & More",
  description:
    "How AI search visibility works for your business — SaaS, ecommerce, agencies, B2B, local and Shopify. Tailored AEO playbooks for getting recommended by AI.",
  path: "/for",
});

export default function ForHub() {
  const pages = getPages("for");
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Solutions</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">AI visibility, tailored to you</h1>
        <p className="mt-4 text-ink/65">The stakes and the playbook look different for each business. Find yours.</p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pages.map((p) => (
          <Link key={p.slug} href={`/for/${p.slug}`} className="card p-5 card-hover">
            <h2 className="font-display text-base font-semibold leading-snug">{p.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm text-ink/60">{p.metaDescription}</p>
          </Link>
        ))}
      </div>

      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Audit your brand free</h2>
        <p className="mt-2 text-sm text-white/65">See how AI describes your business in under a minute.</p>
        <div className="mt-6"><AuditForm source="for-hub" /></div>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Solutions", path: "/for" }]),
          itemListJsonLd("AI visibility by industry", pages.map((p) => ({ name: p.title, path: `/for/${p.slug}` }))),
        ]}
      />
    </div>
  );
}
