import type { Metadata } from "next";
import Link from "next/link";
import { getPages } from "@/lib/content/pages";
import { AuditForm } from "@/components/audit-form";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "AI Search Answers — AEO & AI Visibility Questions",
  description:
    "Straight answers to the real questions about AI search visibility: does ChatGPT use your site, how to get cited by Perplexity, how to appear in Google AI Overviews, and more.",
  path: "/answers",
});

export default function AnswersHub() {
  const pages = getPages("answers");
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Answers</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Your AI search questions, answered</h1>
        <p className="mt-4 text-ink/65">Direct, expert answers to how AI assistants find, describe and recommend brands — and what you can do about it.</p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.slug} href={`/answers/${p.slug}`} className="card p-5 card-hover">
            <h2 className="font-display text-lg font-semibold leading-snug">{p.title}</h2>
            <p className="mt-2 line-clamp-2 text-sm text-ink/60">{p.shortAnswer}</p>
          </Link>
        ))}
      </div>

      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">Stop guessing — measure it</h2>
        <p className="mt-2 text-sm text-white/65">Run a free AI visibility audit for your brand.</p>
        <div className="mt-6"><AuditForm source="answers-hub" /></div>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Answers", path: "/answers" }]),
          itemListJsonLd("AI search answers", pages.map((p) => ({ name: p.title, path: `/answers/${p.slug}` }))),
        ]}
      />
    </div>
  );
}
