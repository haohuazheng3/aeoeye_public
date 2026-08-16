import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getPageSlugs, relatedAcross } from "@/lib/content/pages";
import { ContentPageView } from "@/components/content-page";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, articleJsonLd } from "@/lib/seo";

export function generateStaticParams() {
  return getPageSlugs("vs").map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getPage("vs", params.slug);
  if (!p) return { title: "Not found", robots: { index: false } };
  return pageMeta({ title: p.metaTitle || p.title, description: p.metaDescription, path: `/vs/${p.slug}` });
}

export default function VsPage({ params }: { params: { slug: string } }) {
  const page = getPage("vs", params.slug);
  if (!page) notFound();
  const related = relatedAcross("vs", page.slug, 3);
  return (
    <>
      <ContentPageView page={page} type="vs" related={related} />
      <JsonLd
        data={[
          articleJsonLd({ title: page.title, description: page.metaDescription, path: `/vs/${page.slug}`, date: "2026-06-25" }),
          breadcrumbJsonLd([{ name: "Comparisons", path: "/vs" }, { name: page.title, path: `/vs/${page.slug}` }]),
          ...(page.faqs.length ? [faqJsonLd(page.faqs)] : []),
        ]}
      />
    </>
  );
}
