import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage, getPageSlugs, relatedAcross } from "@/lib/content/pages";
import { ContentPageView } from "@/components/content-page";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, faqJsonLd, breadcrumbJsonLd, articleJsonLd, howToJsonLd } from "@/lib/seo";

export function generateStaticParams() {
  return getPageSlugs("guides").map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getPage("guides", params.slug);
  if (!p) return { title: "Not found", robots: { index: false } };
  return pageMeta({ title: p.metaTitle || p.title, description: p.metaDescription, path: `/guides/${p.slug}` });
}

export default function GuidePage({ params }: { params: { slug: string } }) {
  const page = getPage("guides", params.slug);
  if (!page) notFound();
  const related = relatedAcross("guides", page.slug, 3);
  return (
    <>
      <ContentPageView page={page} type="guides" related={related} />
      <JsonLd
        data={[
          articleJsonLd({ title: page.title, description: page.metaDescription, path: `/guides/${page.slug}`, date: page.updated || "2026-06-26" }),
          breadcrumbJsonLd([{ name: "Guides", path: "/guides" }, { name: page.title, path: `/guides/${page.slug}` }]),
          ...(page.howToSteps?.length
            ? [howToJsonLd({ name: page.title, description: page.metaDescription, path: `/guides/${page.slug}`, steps: page.howToSteps })]
            : []),
          ...(page.faqs.length ? [faqJsonLd(page.faqs)] : []),
        ]}
      />
    </>
  );
}
