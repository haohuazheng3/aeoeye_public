import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getPageSlugs, relatedAcross } from "@/lib/content/pages";
import { ContentPageView } from "@/components/content-page";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, articleJsonLd } from "@/lib/seo";

export function generateStaticParams() {
  return getPageSlugs("answers").map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getPage("answers", params.slug);
  if (!p) return { title: "Not found", robots: { index: false } };
  return pageMeta({ title: p.metaTitle || p.title, description: p.metaDescription, path: `/answers/${p.slug}` });
}

export default function AnswerPage({ params }: { params: { slug: string } }) {
  const page = getPage("answers", params.slug);
  if (!page) notFound();
  const related = relatedAcross("answers", page.slug, 3);

  return (
    <>
      <ContentPageView page={page} type="answers" related={related} />
      <JsonLd
        data={[
          articleJsonLd({ title: page.title, description: page.metaDescription, path: `/answers/${page.slug}`, date: "2026-06-25" }),
          breadcrumbJsonLd([{ name: "Answers", path: "/answers" }, { name: page.title, path: `/answers/${page.slug}` }]),
          ...(page.faqs.length ? [faqJsonLd(page.faqs)] : []),
        ]}
      />
    </>
  );
}
