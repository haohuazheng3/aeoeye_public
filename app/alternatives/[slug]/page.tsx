import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getPageSlugs, relatedAcross } from "@/lib/content/pages";
import { ContentPageView } from "@/components/content-page";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, articleJsonLd } from "@/lib/seo";

export function generateStaticParams() {
  return getPageSlugs("alternatives").map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getPage("alternatives", params.slug);
  if (!p) return { title: "Not found", robots: { index: false } };
  return pageMeta({ title: p.metaTitle || p.title, description: p.metaDescription, path: `/alternatives/${p.slug}` });
}

export default function AlternativesPage({ params }: { params: { slug: string } }) {
  const page = getPage("alternatives", params.slug);
  if (!page) notFound();
  const related = relatedAcross("alternatives", page.slug, 3);
  return (
    <>
      <ContentPageView page={page} type="alternatives" related={related} />
      <JsonLd
        data={[
          articleJsonLd({ title: page.title, description: page.metaDescription, path: `/alternatives/${page.slug}`, date: "2026-06-25" }),
          breadcrumbJsonLd([{ name: "Alternatives", path: "/alternatives" }, { name: page.title, path: `/alternatives/${page.slug}` }]),
          ...(page.faqs.length ? [faqJsonLd(page.faqs)] : []),
        ]}
      />
    </>
  );
}
