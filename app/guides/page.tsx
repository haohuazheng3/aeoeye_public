import type { Metadata } from "next";
import Link from "next/link";
import { getPages } from "@/lib/content/pages";
import { AuditForm } from "@/components/audit-form";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "AEO Guides — Step-by-Step AI Visibility How-Tos",
  description:
    "Actionable, step-by-step guides to get your brand recommended by AI: rank in AI Overviews, get cited by ChatGPT, run an AEO audit, track AI brand mentions and more.",
  path: "/guides",
});

export default function GuidesHub() {
  const pages = getPages("guides");
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Guides</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Step-by-step AI visibility guides</h1>
        <p className="mt-4 text-ink/65">No theory for its own sake — practical, do-this-then-that guides to get recommended by AI assistants.</p>
      </div>
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.slug} href={`/guides/${p.slug}`} className="card p-5 card-hover">
            <h2 className="font-display text-lg font-semibold leading-snug">{p.title}</h2>
            <p className="mt-2 line-clamp-2 text-sm text-ink/60">{p.shortAnswer || p.metaDescription}</p>
          </Link>
        ))}
      </div>
      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Start with a free audit</h2>
        <p className="mt-2 text-sm text-white/65">See where you stand before you start fixing.</p>
        <div className="mt-6"><AuditForm source="guides-hub" /></div>
      </section>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Guides", path: "/guides" }]),
          itemListJsonLd("AEO guides", pages.map((p) => ({ name: p.title, path: `/guides/${p.slug}` }))),
        ]}
      />
    </div>
  );
}
