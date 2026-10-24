import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "markdown-to-jsx";
import { ArrowRight, BookOpen, ExternalLink, ShieldCheck } from "lucide-react";
import { getToolPages, getToolPage, getCategory, splitSections, headingId, type ToolPage, type ToolImage } from "@/lib/content/tool-pages";
import { TOOLS as LEGACY_TOOLS } from "@/lib/content/tools";
import { ToolSlot } from "@/components/tools/tool-slot";
import { TableOfContents } from "@/components/toc";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { SeoAuditForm } from "@/components/seo-audit/seo-audit-form";
import { pageMeta, faqJsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { absoluteUrl, site, siteUrl } from "@/lib/site";
import { formatDate } from "@/lib/utils";

export const dynamicParams = false;

export function generateStaticParams() {
  return getToolPages().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getToolPage(params.slug);
  if (!p) return { title: "Tool not found", robots: { index: false } };
  return pageMeta({ title: p.title, description: p.description, path: `/tools/${p.slug}` });
}

function text(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(text).join("");
  if (children && typeof children === "object" && "props" in (children as { props?: { children?: React.ReactNode } })) {
    return text((children as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

const H3 = ({ children }: { children?: React.ReactNode }) => <h3 id={headingId(text(children))} className="scroll-mt-24">{children}</h3>;

function ProseLink({ href = "", children }: { href?: string; children?: React.ReactNode }) {
  const external = /^https?:\/\//.test(href) && !href.startsWith(siteUrl);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <Link href={href.replace(siteUrl, "") || "/"}>{children}</Link>;
}

const MD_OPTS = { forceBlock: true, overrides: { h3: { component: H3 }, a: { component: ProseLink } } };

function Figure({ img }: { img: ToolImage }) {
  return (
    <figure className="not-prose my-8 overflow-hidden rounded-3xl bg-white shadow-float">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.url} alt={img.alt} width={1200} height={675} loading="lazy" decoding="async" className="h-auto w-full object-cover" />
      <figcaption className="px-4 py-2 text-[11px] text-ink/40">
        Photo by{" "}
        <a href={img.photographerUrl} target="_blank" rel="noopener noreferrer" className="underline">
          {img.photographer}
        </a>{" "}
        on{" "}
        <a href={img.pexelsUrl || "https://www.pexels.com"} target="_blank" rel="noopener noreferrer" className="underline">
          Pexels
        </a>
      </figcaption>
    </figure>
  );
}

type Card = { slug: string; name: string; description: string };

function relatedCards(p: ToolPage): Card[] {
  const all = getToolPages();
  return p.related
    .map((slug): Card | null => {
      const t = all.find((x) => x.slug === slug);
      if (t) return { slug, name: t.name, description: t.description };
      const legacy = LEGACY_TOOLS.find((x) => x.slug === slug);
      return legacy ? { slug, name: legacy.name, description: legacy.description } : null;
    })
    .filter((c): c is Card => c !== null)
    .slice(0, 5);
}

export default function ToolPageView({ params }: { params: { slug: string } }) {
  const p = getToolPage(params.slug);
  if (!p) notFound();
  const cat = getCategory(p.category)!;
  const sections = splitSections(p.body);
  const toc = [
    ...sections.filter((s) => s.heading).map((s) => ({ id: headingId(s.heading!), text: s.heading! })),
    { id: "faq", text: "FAQ" },
  ];
  // 图片插在第 1、3 个 H2 段之后,第 3 张(若有)放在 FAQ 前 —— 不打断首屏工具,也不堆在一起
  const imageAfter = new Map<number, ToolImage>();
  const headed = sections.map((s, i) => (s.heading ? i : -1)).filter((i) => i >= 0);
  if (p.images[0] && headed[0] !== undefined) imageAfter.set(headed[0], p.images[0]);
  if (p.images[1] && headed[2] !== undefined) imageAfter.set(headed[2], p.images[1]);
  else if (p.images[1] && headed[1] !== undefined) imageAfter.set(headed[1], p.images[1]);
  const tailImage = p.images[2];
  const cards = relatedCards(p);
  const path = `/tools/${p.slug}`;

  return (
    <div className="container-tight py-10 sm:py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-ink/45">
        <Link href="/tools" className="hover:text-ink">Tools</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/tools/category/${cat.slug}`} className="hover:text-ink">{cat.name}</Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink/60">{p.name}</span>
      </nav>

      <header className="mt-4 max-w-3xl">
        <h1 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{p.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink/70 sm:text-lg">{p.answer}</p>
      </header>

      <section aria-label={p.name} className="mt-6">
        <ToolSlot config={p.runner} slug={p.slug} />
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink/45">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-mint-deep" />
          <span>
            {p.trust} Free, no signup. Updated {formatDate(p.updated)} by the {site.name} team.
          </span>
        </p>
      </section>

      <div className="mx-auto mt-14 max-w-3xl">
        <TableOfContents items={toc} />

        <div className="prose">
          {sections.map((s, i) => (
            <div key={i}>
              {s.heading && (
                <h2 id={headingId(s.heading)} className="scroll-mt-24">
                  {s.heading}
                </h2>
              )}
              {s.body && <Markdown options={MD_OPTS}>{s.body}</Markdown>}
              {imageAfter.has(i) && <Figure img={imageAfter.get(i)!} />}
            </div>
          ))}
          {tailImage && <Figure img={tailImage} />}
        </div>

        <section className="mt-12 panel-dark p-7 text-center text-white sm:p-8">
          {p.cta === "seo" ? (
            <>
              <h2 className="font-display text-xl font-semibold sm:text-2xl">One page checked. What about the rest of your site?</h2>
              <p className="mt-2 text-sm text-white/65">The free SEO audit crawls your site and scores ~90 checks across 7 areas — with the evidence and the fix for each problem.</p>
              <div className="mx-auto mt-5 max-w-md">
                <SeoAuditForm source={`tool-${p.slug}`} variant="inline" />
              </div>
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold sm:text-2xl">Reachable is step one. Does AI actually recommend you?</h2>
              <p className="mt-2 text-sm text-white/65">Run a free AI visibility audit: we ask ChatGPT the questions your buyers ask and show whether your brand comes up.</p>
              <div className="mx-auto mt-5 max-w-md">
                <AuditForm source={`tool-${p.slug}`} variant="inline" />
              </div>
            </>
          )}
        </section>

        <section id="faq" className="mt-12 scroll-mt-24">
          <h2 className="font-display text-2xl font-semibold">FAQ</h2>
          <div className="mt-4 divide-y divide-paper-dim">
            {p.faqs.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  <h3 className="text-base font-medium">{f.q}</h3>
                  <span className="text-iris transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-ink/65">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {p.sources.length > 0 && (
          <section id="sources" className="mt-10">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <BookOpen className="h-4 w-4 text-iris" /> Sources
            </h2>
            <ul className="mt-3 space-y-2">
              {p.sources.map((s, i) => (
                <li key={s.url} className="flex items-start gap-2 text-sm">
                  <span className="text-ink/35">{i + 1}.</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-iris hover:underline">
                    {s.label} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {cards.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-xl font-semibold">Related free tools</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {cards.map((c) => (
                <Link key={c.slug} href={`/tools/${c.slug}`} className="card group p-5 card-hover">
                  <h3 className="font-display text-base font-semibold">{c.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink/55">{c.description}</p>
                </Link>
              ))}
            </div>
            <Link href={`/tools/category/${cat.slug}`} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-iris hover:underline">
              All {cat.name.toLowerCase()} tools <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        )}
      </div>

      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: p.name,
            url: absoluteUrl(path),
            description: p.description,
            applicationCategory: p.appCategory || "DeveloperApplication",
            operatingSystem: "Any (web browser)",
            browserRequirements: "Requires JavaScript",
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            dateModified: p.updated,
            datePublished: p.published,
            publisher: { "@type": "Organization", name: site.name, url: siteUrl },
          },
          breadcrumbJsonLd([
            { name: "Tools", path: "/tools" },
            { name: cat.name, path: `/tools/category/${cat.slug}` },
            { name: p.name, path },
          ]),
          faqJsonLd(p.faqs),
        ]}
      />
    </div>
  );
}
