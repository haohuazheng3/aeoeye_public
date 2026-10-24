import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { TOOL_CATEGORIES, getCategory, categoryItems } from "@/lib/content/tool-pages";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return TOOL_CATEGORIES.map((c) => ({ slug: c.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const c = getCategory(params.slug);
  if (!c) return { title: "Not found", robots: { index: false } };
  return pageMeta({ title: c.title, description: c.description, path: `/tools/category/${c.slug}` });
}

export default function CategoryHub({ params }: { params: { slug: string } }) {
  const c = getCategory(params.slug);
  if (!c) notFound();
  const items = categoryItems(c.slug);
  const path = `/tools/category/${c.slug}`;
  const others = TOOL_CATEGORIES.filter((x) => x.slug !== c.slug);

  return (
    <div className="container-tight py-12 sm:py-16">
      <nav aria-label="Breadcrumb" className="text-sm text-ink/45">
        <Link href="/tools" className="hover:text-ink">Tools</Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink/60">{c.name}</span>
      </nav>
      <header className="mt-4 max-w-3xl">
        <h1 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{c.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink/70 sm:text-lg">{c.intro}</p>
      </header>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((t) => (
          <li key={t.slug}>
            <Link href={`/tools/${t.slug}`} className="card group flex h-full flex-col p-5 card-hover">
              <h2 className="font-display text-base font-semibold">{t.name}</h2>
              <p className="mt-1.5 flex-1 text-sm text-ink/60">{t.description}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-ink">
                Open tool <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="mx-auto mt-14 max-w-xl panel-dark p-8 text-center text-white">
        {c.slug === "ai-search" ? (
          <>
            <h2 className="font-display text-2xl font-semibold">Check what AI actually says about you</h2>
            <p className="mt-2 text-sm text-white/65">Crawler access is the prerequisite. The free AI visibility audit tests the outcome.</p>
            <div className="mt-6">
              <AuditForm source={`tools-hub-${c.slug}`} variant="inline" />
            </div>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl font-semibold">Run every check at once</h2>
            <p className="mt-2 text-sm text-white/65">The free SEO audit crawls your site and scores ~90 checks — evidence and fixes included.</p>
            <div className="mt-6">
              <SeoAuditForm source={`tools-hub-${c.slug}`} variant="inline" />
            </div>
          </>
        )}
      </section>

      <nav aria-label="Other tool categories" className="mt-14">
        <h2 className="font-display text-lg font-semibold">More free tools</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {others.map((o) => (
            <Link key={o.slug} href={`/tools/category/${o.slug}`} className="rounded-full bg-white px-4 py-2 text-sm text-ink/70 shadow-card hover:text-iris">
              {o.name}
            </Link>
          ))}
          <Link href="/blog" className="rounded-full bg-white px-4 py-2 text-sm text-ink/70 shadow-card hover:text-iris">
            Technical SEO decisions
          </Link>
        </div>
      </nav>

      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Tools", path: "/tools" },
            { name: c.name, path },
          ]),
          itemListJsonLd(c.title, items.map((t) => ({ name: t.name, path: `/tools/${t.slug}` }))),
        ]}
      />
    </div>
  );
}
