import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getAllPosts } from "@/lib/content/blog";
import { JsonLd } from "@/components/json-ld";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = pageMeta({
  title: "Technical SEO Decisions, Tested: Redirects, HTTPS, AEO & More",
  description:
    "Head-to-head technical SEO decisions answered with our own measurements: 301 vs 302, HTTPS vs HTTP, subdomain vs subfolder, WebP vs AVIF, AEO vs SEO.",
  path: "/blog",
});

/* /blog = 决策页枢纽(SEO 底座 v2):只放 B 级"二选一"决策页,每篇首屏就是结论卡。
   篇数少,全量列出;超过 18 篇再按主题分组(底座要求每个枢纽 ≤15–20 条)。 */
export default function BlogIndex() {
  const posts = getAllPosts();
  return (
    <div className="container-tight py-14 sm:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Decisions, tested</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Technical SEO decisions with a straight answer</h1>
        <p className="mt-4 text-ink/65">
          Each page answers one &ldquo;this or that&rdquo; question up top, then shows the measurements behind it — from sites we
          actually scanned, not opinions recycled from 2019.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="mt-16 text-center text-ink/50">New decision guides are on the way.</p>
      ) : (
        <ul className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-2">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="card group flex h-full flex-col overflow-hidden card-hover">
                {p.image?.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image.url} alt={p.image.alt || p.title} className="h-40 w-full object-cover" width={600} height={300} loading="lazy" />
                )}
                <div className="flex flex-1 flex-col p-6">
                  <h2 className="font-display text-lg font-semibold leading-snug">{p.title}</h2>
                  <p className="mt-2 flex-1 text-sm text-ink/60">{p.verdict?.summary || p.description}</p>
                  <div className="mt-4 flex items-center gap-2 text-xs text-ink/45">
                    <span>Updated {formatDate(p.date)}</span>
                    <span>·</span>
                    <span>{p.readingTime}</span>
                    <ArrowRight className="ml-auto h-4 w-4 text-ink/40 transition group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mx-auto mt-12 max-w-4xl text-center text-sm text-ink/55">
        Want to test instead of read?{" "}
        <Link href="/tools" className="font-semibold text-iris hover:underline">Browse the free tools</Link>
      </div>

      <section className="mx-auto mt-14 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">See which of these your site gets wrong</h2>
        <p className="mt-2 text-sm text-white/65">The free SEO audit checks redirects, HTTPS, structure and images across your whole site.</p>
        <div className="mt-6">
          <SeoAuditForm source="blog-hub" variant="inline" />
        </div>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Blog", path: "/blog" }]),
          itemListJsonLd("Technical SEO decisions", posts.map((p) => ({ name: p.title, path: `/blog/${p.slug}` }))),
        ]}
      />
    </div>
  );
}
