import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, ExternalLink } from "lucide-react";
import { GLOSSARY, getTerm, TERM_SOURCES } from "@/lib/content/glossary";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta, breadcrumbJsonLd } from "@/lib/seo";
import { absoluteUrl, site } from "@/lib/site";

export function generateStaticParams() {
  return GLOSSARY.map((t) => ({ slug: t.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const term = getTerm(params.slug);
  if (!term) return { title: "Term not found", robots: { index: false } };
  return pageMeta({
    title: `${term.term} — AEO Glossary`,
    description: term.short,
    path: `/glossary/${term.slug}`,
  });
}

export default function GlossaryTerm({ params }: { params: { slug: string } }) {
  const term = getTerm(params.slug);
  if (!term) notFound();

  const related = term.related.map(getTerm).filter(Boolean);

  const definedTermJsonLd = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: term.term,
    description: term.short,
    inDefinedTermSet: { "@type": "DefinedTermSet", name: `${site.name} AEO Glossary`, url: absoluteUrl("/glossary") },
    url: absoluteUrl(`/glossary/${term.slug}`),
  };

  return (
    <article className="container-tight max-w-3xl py-14">
      <Link href="/glossary" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Glossary
      </Link>

      <h1 className="mt-6 font-display text-3xl font-semibold sm:text-4xl">{term.term}</h1>
      <p className="mt-2 text-sm text-ink/45">
        <span className="font-medium text-ink/60">AEOeye editorial team</span> · AEO Glossary
      </p>
      <p className="mt-4 rounded-2xl border border-iris/25 bg-iris/5 p-4 text-lg leading-relaxed text-ink">{term.short}</p>

      <div className="prose mt-8">
        {term.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {(TERM_SOURCES[term.slug]?.length ?? 0) > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <BookOpen className="h-4 w-4 text-iris" /> Authoritative sources
          </h2>
          <ul className="mt-3 space-y-2">
            {TERM_SOURCES[term.slug].map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-ink/35">{i + 1}.</span>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-iris hover:underline">
                  {s.label} <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-lg font-semibold">Related terms</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {related.map((t) => (
              <Link
                key={t!.slug}
                href={`/glossary/${t!.slug}`}
                className="rounded-full border border-paper-dim bg-white px-3 py-1.5 text-sm font-medium text-ink/70 transition hover:border-iris/40 hover:text-iris"
              >
                {t!.term}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-14 panel-dark p-8 text-center text-white">
        <h2 className="font-display text-xl font-semibold">Put the theory to work</h2>
        <p className="mt-2 text-sm text-white/65">Run a free AI visibility audit for your brand.</p>
        <div className="mx-auto mt-5 max-w-md">
          <AuditForm source={`glossary-${term.slug}`} />
        </div>
      </section>

      <JsonLd
        data={[
          definedTermJsonLd,
          breadcrumbJsonLd([
            { name: "Glossary", path: "/glossary" },
            { name: term.term, path: `/glossary/${term.slug}` },
          ]),
        ]}
      />
    </article>
  );
}
