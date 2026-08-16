import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getPageSlugs, relatedAcross } from "@/lib/content/pages";
import { ContentPageView } from "@/components/content-page";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, articleJsonLd } from "@/lib/seo";

export function generateStaticParams() {
  return getPageSlugs("compare").map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getPage("compare", params.slug);
  if (!p) return { title: "Not found", robots: { index: false } };
  return pageMeta({ title: p.metaTitle || p.title, description: p.metaDescription, path: `/compare/${p.slug}` });
}

export default function ComparePage({ params }: { params: { slug: string } }) {
  const page = getPage("compare", params.slug);
  if (!page) notFound();
  const related = relatedAcross("compare", page.slug, 3);

  return (
    <>
      <ContentPageView page={page} type="compare" related={related} />
      <JsonLd
        data={[
          articleJsonLd({ title: page.title, description: page.metaDescription, path: `/compare/${page.slug}`, date: "2026-06-25" }),
          breadcrumbJsonLd([{ name: "Compare", path: "/compare" }, { name: page.title, path: `/compare/${page.slug}` }]),
          ...(page.faqs.length ? [faqJsonLd(page.faqs)] : []),
        ]}
      />
    </>
  );
}
