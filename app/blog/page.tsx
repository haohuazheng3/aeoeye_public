import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getAllPosts, getCategories } from "@/lib/content/blog";
import { AuditForm } from "@/components/audit-form";
import { pageMeta } from "@/lib/seo";
import { site } from "@/lib/site";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = pageMeta({
  title: "Blog — AI visibility & answer engine optimization",
  description: `Deep, practical writing on getting your brand recommended by ChatGPT, Perplexity and Google AI. From the ${site.name} team.`,
  path: "/blog",
});

export default function BlogIndex() {
  const posts = getAllPosts();
  const [featured, ...others] = posts;
  // /blog 只做分类导航 + 少量精选:全量长列表会把内链权重摊薄、抓取预算分配变差,
  // 也白白浪费分类词的排名机会。深度浏览走 /blog/category/<slug>。
  const rest = others.slice(0, 9);
  const categories = getCategories();

  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">The AEOeye blog</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Get found in the age of AI answers</h1>
        <p className="mt-4 text-ink/65">
          Practical, opinionated writing on answer engine optimization — how AI assistants pick brands, and how to
          become one they recommend.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="mt-16 text-center text-ink/50">New articles are on the way.</p>
      ) : (
        <div className="mt-14">
          {featured && (
            <Link
              href={`/blog/${featured.slug}`}
              className="card group grid gap-6 overflow-hidden card-hover md:grid-cols-2"
            >
              {featured.image?.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={featured.image.url} alt={featured.image.alt || featured.title} className="h-full max-h-72 w-full object-cover md:max-h-none" width={800} height={500} />
              )}
              <div className="p-8">
                <span className="eyebrow">{featured.category}</span>
                <h2 className="mt-3 font-display text-2xl font-semibold sm:text-3xl">{featured.title}</h2>
                <p className="mt-3 text-ink/65">{featured.description}</p>
                <div className="mt-5 flex items-center gap-3 text-sm text-ink/45">
                  <span>{formatDate(featured.date)}</span>
                  <span>·</span>
                  <span>{featured.readingTime}</span>
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          )}

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} className="card group flex flex-col overflow-hidden card-hover">
                {p.image?.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image.url} alt={p.image.alt || p.title} className="h-40 w-full object-cover" width={400} height={200} loading="lazy" />
                )}
                <div className="flex flex-1 flex-col p-6">
                  <span className="text-xs font-semibold uppercase tracking-wide text-iris">{p.category}</span>
                  <h3 className="mt-2 font-display text-lg font-semibold leading-snug">{p.title}</h3>
                  <p className="mt-2 flex-1 text-sm text-ink/60">{p.description}</p>
                  <div className="mt-4 flex items-center gap-2 text-xs text-ink/45">
                    <span>{formatDate(p.date)}</span>
                    <span>·</span>
                    <span>{p.readingTime}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 分类枢纽导航 —— 每个分类页自己去吃排名,并把权重导向其子文章;
          深度浏览走 /blog/category/<slug>,而不是无限长的单页列表。 */}
      <div className="mt-16">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Browse by topic</h2>
        <p className="mt-2 text-sm text-ink/55">
          {posts.length} guides, organised so you can go deep on one thing instead of scrolling forever.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((c) => (
            <Link key={c.slug} href={`/blog/category/${c.slug}`} className="card card-hover p-6">
              <div className="relative z-10">
                <h3 className="font-display text-base font-semibold">{c.name}</h3>
                <p className="mt-1 text-sm text-ink/45">{c.count} guides</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <section className="mx-auto mt-20 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">See where you stand</h2>
        <p className="mt-2 text-sm text-white/65">Reading about AI visibility is good. Measuring yours is better.</p>
        <div className="mt-6">
          <AuditForm source="blog" />
        </div>
      </section>
    </div>
  );
}
