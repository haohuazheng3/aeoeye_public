import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentLink } from "@/components/content-link";
import Markdown from "markdown-to-jsx";
import { ArrowLeft, BookOpen, ExternalLink, CheckCircle2 } from "lucide-react";
import { getPost, getPostSlugs, getAllPosts, extractHeadings, relatedPosts } from "@/lib/content/blog";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";
import { getToolPage } from "@/lib/content/tool-pages";
import { TOOLS as LEGACY_TOOLS } from "@/lib/content/tools";
import { TableOfContents } from "@/components/toc";
import { pageMeta, articleJsonLd, faqJsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { formatDate } from "@/lib/utils";

// 只渲染构建时已知的文章;未知 slug 直接 404(不再渲染 "Post not found" 却回 200 的软 404)
export const dynamicParams = false;

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
// 正文配图:固定 16:9 框 + object-cover + 懒加载 —— Pexels 原图比例各异,不固定框会在加载后撑高页面(CLS)
const ProseImg = ({ src, alt }: { src?: string; alt?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt={alt ?? ""} width={1200} height={675} loading="lazy" decoding="async" className="aspect-video h-auto w-full rounded-3xl object-cover shadow-float" />
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
  const tools = post.meta.relatedTools
    .map((slug) => {
      const t = getToolPage(slug);
      if (t) return { slug, name: t.name, description: t.description };
      const l = LEGACY_TOOLS.find((x) => x.slug === slug);
      return l ? { slug, name: l.name, description: l.description } : null;
    })
    .filter((x): x is { slug: string; name: string; description: string } => x !== null);

  return (
    <article className="py-14">
      <div className="container-tight max-w-3xl">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> All decision guides
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

        {post.meta.verdict && (
          <aside aria-label="The short answer" className="mt-8 rounded-3xl bg-white p-6 shadow-float sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-iris">The short answer</p>
            <p className="mt-2 font-display text-lg font-semibold leading-snug text-ink sm:text-xl">{post.meta.verdict.summary}</p>
            <ul className="mt-4 space-y-2.5">
              {post.meta.verdict.picks.map((p) => (
                <li key={p.when} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-deep" />
                  <span>
                    <span className="text-ink/60">{p.when}</span> <strong className="text-ink">→ {p.pick}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-paper-dim pt-4">
              <p className="mb-2 text-xs text-ink/50">{post.meta.cta === "seo" ? "Check what your own site does today — free:" : "See whether AI assistants mention your brand — free:"}</p>
              {post.meta.cta === "seo" ? <SeoAuditForm source={`blog-verdict-${post.meta.slug}`} variant="inline" /> : <AuditForm source={`blog-verdict-${post.meta.slug}`} variant="inline" />}
            </div>
          </aside>
        )}

        {post.meta.image?.url && (
          <figure className="mt-8 overflow-hidden rounded-3xl border border-white/60 shadow-float">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.meta.image.url} alt={post.meta.image.alt || post.meta.title} className="aspect-[2/1] h-auto w-full object-cover" width={1200} height={600} />
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
          <Markdown options={{ forceBlock: true, overrides: { h2: { component: H2 }, h3: { component: H3 }, a: { component: ContentLink }, img: { component: ProseImg } } }}>
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

        {tools.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-xl font-semibold">Test it on your own site</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {tools.map((t) => (
                <Link key={t.slug} href={`/tools/${t.slug}`} className="card p-5 card-hover">
                  <h3 className="font-display text-base font-semibold">{t.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink/55">{t.description}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-14 panel-dark p-8 text-center text-white">
          {post.meta.cta === "seo" ? (
            <>
              <h2 className="font-display text-xl font-semibold">Find out what your site actually does</h2>
              <p className="mt-2 text-sm text-white/65">The free SEO audit crawls your site and scores ~90 checks, with evidence and fixes.</p>
              <div className="mx-auto mt-5 max-w-md">
                <SeoAuditForm source={`blog-${post.meta.slug}`} variant="inline" />
              </div>
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold">Is AI recommending you?</h2>
              <p className="mt-2 text-sm text-white/65">Run a free AI visibility audit and find out in under a minute.</p>
              <div className="mx-auto mt-5 max-w-md">
                <AuditForm source={`blog-${post.meta.slug}`} variant="inline" />
              </div>
            </>
          )}
        </section>

        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="font-display text-xl font-semibold">More decisions, tested</h2>
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
          articleJsonLd({ title: post.meta.title, description: post.meta.description, path: `/blog/${post.meta.slug}`, date: post.meta.date, published: post.meta.published }),
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
