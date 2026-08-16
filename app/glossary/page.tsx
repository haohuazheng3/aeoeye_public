import type { Metadata } from "next";
import Link from "next/link";
import { GLOSSARY } from "@/lib/content/glossary";
import { pageMeta } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "AEO Glossary — AI search & answer engine terms",
  description: `Plain-English definitions of the answer engine optimization and AI visibility terms that matter, from ${site.name}.`,
  path: "/glossary",
});

export default function GlossaryIndex() {
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Glossary</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">The language of AI visibility</h1>
        <p className="mt-4 text-ink/65">
          Clear definitions for the terms behind answer engine optimization — no jargon for its own sake.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {GLOSSARY.map((t) => (
          <Link key={t.slug} href={`/glossary/${t.slug}`} className="card p-5 card-hover">
            <h2 className="font-display text-lg font-semibold">{t.term}</h2>
            <p className="mt-1.5 text-sm text-ink/60">{t.short}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
