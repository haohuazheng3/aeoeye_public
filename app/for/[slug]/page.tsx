import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getPageSlugs, relatedAcross } from "@/lib/content/pages";
import { ContentPageView } from "@/components/content-page";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, articleJsonLd } from "@/lib/seo";

export function generateStaticParams() {
  return getPageSlugs("for").map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getPage("for", params.slug);
  if (!p) return { title: "Not found", robots: { index: false } };
  return pageMeta({ title: p.metaTitle || p.title, description: p.metaDescription, path: `/for/${p.slug}` });
}

export default function ForPage({ params }: { params: { slug: string } }) {
  const page = getPage("for", params.slug);
  if (!page) notFound();
  const related = relatedAcross("for", page.slug, 3);

  return (
    <>
      <ContentPageView page={page} type="for" related={related} />
      <JsonLd
        data={[
          articleJsonLd({ title: page.title, description: page.metaDescription, path: `/for/${page.slug}`, date: "2026-06-25" }),
          breadcrumbJsonLd([{ name: "Solutions", path: "/for" }, { name: page.title, path: `/for/${page.slug}` }]),
          ...(page.faqs.length ? [faqJsonLd(page.faqs)] : []),
        ]}
      />
    </>
  );
}
