import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "markdown-to-jsx";
import { ArrowLeft, BookOpen, ExternalLink } from "lucide-react";
import { getPost, getPostSlugs, getAllPosts, extractHeadings, relatedPosts } from "@/lib/content/blog";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { TableOfContents } from "@/components/toc";
import { ClusterNav } from "@/components/topic-cluster";
import { pillarForBlog } from "@/lib/content/clusters";
import { pageMeta, articleJsonLd, faqJsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { formatDate } from "@/lib/utils";

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getPost(params.slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  return pageMeta({ title: post.meta.title, description: post.meta.description, path: `/blog/${post.meta.slug}` });
}

function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function childText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childText).join("");
  if (children && typeof children === "object" && "props" in (children as { props?: { children?: React.ReactNode } })) {
    return childText((children as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

const H2 = ({ children }: { children?: React.ReactNode }) => (
  <h2 id={headingId(childText(children))} className="scroll-mt-24">
    {children}
  </h2>
);
const H3 = ({ children }: { children?: React.ReactNode }) => (
  <h3 id={headingId(childText(children))} className="scroll-mt-24">
    {children}
  </h3>
);

export default function BlogPost({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();

  const headings = extractHeadings(post.content).filter((h) => h.level === 2);
  const toc = [
    ...headings.map((h) => ({ id: h.id, text: h.text })),
    ...(post.meta.faqs.length ? [{ id: "faq", text: "FAQ" }] : []),
    ...(post.meta.sources.length ? [{ id: "sources", text: "Sources" }] : []),
  ];

  // 同分类优先 + 确定性轮转 —— 见 lib/content/blog.ts 的 relatedPosts 注释
  const related = relatedPosts(post.meta.slug, post.meta.category);
  const pillar = pillarForBlog(post.meta.slug);

  return (
    <article className="py-14">
      <div className="container-tight max-w-3xl">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> All articles
        </Link>

        <div className="mt-6">
          <span className="eyebrow">{post.meta.category}</span>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">{post.meta.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/45">
            <span className="font-medium text-ink/60">By the AEOeye editorial team</span>
            <span>·</span>
            <span>Updated {formatDate(post.meta.date)}</span>
            <span>·</span>
            <span>{post.meta.readingTime}</span>
          </div>
        </div>

        {post.meta.image?.url && (
          <figure className="mt-8 overflow-hidden rounded-3xl border border-white/60 shadow-float">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.meta.image.url} alt={post.meta.image.alt || post.meta.title} className="h-auto w-full object-cover" width={1200} height={600} />
            {post.meta.image.photographer && (
              <figcaption className="bg-white px-3 py-1.5 text-[11px] text-ink/40">
                Photo by{" "}
                <a href={post.meta.image.photographerUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {post.meta.image.photographer}
                </a>{" "}
                on Pexels
              </figcaption>
            )}
          </figure>
        )}

        <TableOfContents items={toc} />

        <div className="prose mt-6">
          <Markdown options={{ forceBlock: true, overrides: { h2: { component: H2 }, h3: { component: H3 }, a: { props: { rel: "noopener" } } } }}>
            {post.content}
          </Markdown>
        </div>

        {post.meta.faqs.length > 0 && (
          <section id="faq" className="mt-14 scroll-mt-24">
            <h2 className="font-display text-2xl font-semibold">FAQ</h2>
            <div className="mt-5 divide-y divide-paper-dim">
              {post.meta.faqs.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <span className="text-iris transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 text-sm text-ink/65">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {post.meta.sources.length > 0 && (
          <section id="sources" className="mt-12 scroll-mt-24">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <BookOpen className="h-4 w-4 text-iris" /> Sources
            </h2>
            <ul className="mt-4 space-y-2">
              {post.meta.sources.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-ink/35">{i + 1}.</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-iris hover:underline">
                    {s.label} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pillar && <ClusterNav pillar={pillar} />}

        <section className="mt-14 panel-dark p-8 text-center text-white">
          <h2 className="font-display text-xl font-semibold">Is AI recommending you?</h2>
          <p className="mt-2 text-sm text-white/65">Run a free AI visibility audit and find out in under a minute.</p>
          <div className="mx-auto mt-5 max-w-md">
            <AuditForm source={`blog-${post.meta.slug}`} />
          </div>
        </section>

        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="font-display text-xl font-semibold">Keep reading</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {related.map((p) => (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="card p-5 card-hover">
                  <span className="text-xs font-semibold uppercase tracking-wide text-iris">{p.category}</span>
                  <h3 className="mt-1.5 font-display text-base font-semibold leading-snug">{p.title}</h3>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <JsonLd
        data={[
          articleJsonLd({ title: post.meta.title, description: post.meta.description, path: `/blog/${post.meta.slug}`, date: post.meta.date }),
          breadcrumbJsonLd([
            { name: "Blog", path: "/blog" },
            { name: post.meta.title, path: `/blog/${post.meta.slug}` },
          ]),
          ...(post.meta.faqs.length ? [faqJsonLd(post.meta.faqs)] : []),
        ]}
      />
    </article>
  );
}
