import Link from "next/link";
import Markdown from "markdown-to-jsx";
import { Sparkles, Check, ArrowRight, ExternalLink, BookOpen } from "lucide-react";
import type { ContentPage, PageType } from "@/lib/content/pages";
import { AuditForm } from "@/components/audit-form";
import { TableOfContents, type TocItem } from "@/components/toc";
import { PillarBacklink } from "@/components/topic-cluster";
import { pillarForCluster } from "@/lib/content/clusters";
import { slugify, formatDate } from "@/lib/utils";

const TYPE_LABEL: Record<PageType, string> = {
  answers: "Answers",
  compare: "Compare",
  for: "Solutions",
  vs: "Comparisons",
  alternatives: "Alternatives",
  guides: "Guides",
};

export function ContentPageView({
  page,
  type,
  related,
}: {
  page: ContentPage;
  type: PageType;
  related: { type: PageType; page: ContentPage }[];
}) {
  const sectionItems: TocItem[] = page.sections.map((s) => ({ id: slugify(s.heading), text: s.heading }));
  const toc: TocItem[] = [...sectionItems];
  if (page.howToSteps?.length) toc.push({ id: "how-to-steps", text: "Step-by-step" });
  if (page.keyTakeaways.length) toc.push({ id: "key-takeaways", text: "Key takeaways" });
  if (page.faqs.length) toc.push({ id: "faq", text: "FAQ" });
  if (page.sources?.length) toc.push({ id: "sources", text: "Sources" });

  return (
    <article className="pb-16">
      {/* 头部 */}
      <header className="border-b border-paper-dim bg-paper-soft">
        <div className="container-tight max-w-3xl py-10">
          <nav className="text-sm text-ink/45">
            <Link href={`/${type}`} className="hover:text-ink">
              {TYPE_LABEL[type]}
            </Link>
          </nav>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">{page.title}</h1>

          {/* 作者署名 + 更新日期(E-E-A-T) */}
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/45">
            <span className="font-medium text-ink/60">By the AEOeye editorial team</span>
            <span>·</span>
            <span>Updated {formatDate(page.updated || "2026-06-26")}</span>
          </p>

          {(() => {
            const pillar =
              pillarForCluster(`/${type}/${page.slug}`) ||
              (type === "vs" || type === "alternatives" ? pillarForCluster("/vs") : undefined);
            return pillar ? <PillarBacklink pillar={pillar} /> : null;
          })()}

          {page.image?.url && (
            <figure className="mt-6 overflow-hidden rounded-2xl border border-paper-dim">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={page.image.url} alt={page.image.alt || page.title} className="h-auto w-full object-cover" loading="eager" width={1200} height={600} />
              {page.image.photographer && (
                <figcaption className="bg-white px-3 py-1.5 text-[11px] text-ink/40">
                  Photo by{" "}
                  <a href={page.image.photographerUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    {page.image.photographer}
                  </a>{" "}
                  on Pexels
                </figcaption>
              )}
            </figure>
          )}
        </div>
      </header>

      <div className="container-tight max-w-3xl">
        {/* 直答框(Answer-First) */}
        {page.shortAnswer && (
          <div className="mt-8 rounded-2xl border border-iris/25 bg-iris/5 p-5">
            <p className="eyebrow flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> The short answer
            </p>
            <p className="mt-2 text-lg leading-relaxed text-ink">{page.shortAnswer}</p>
          </div>
        )}

        {/* 目录 */}
        <TableOfContents items={toc} />

        <div className="prose mt-8">
          {page.intro && <Markdown options={{ forceBlock: true }}>{page.intro}</Markdown>}

          {page.sections.map((s, i) => (
            <section key={i}>
              <h2 id={slugify(s.heading)} className="scroll-mt-24">
                {s.heading}
              </h2>
              <Markdown options={{ forceBlock: true }}>{s.body}</Markdown>
            </section>
          ))}
        </div>

        {/* 术语定义(dl/dt/dd,便于 AI 抽取) */}
        {page.definitions && page.definitions.length > 0 && (
          <div className="mt-10 rounded-2xl border border-paper-dim bg-white p-6">
            <h2 className="font-display text-lg font-semibold">Key terms</h2>
            <dl className="mt-3 space-y-4">
              {page.definitions.map((d, i) => (
                <div key={i}>
                  <dt className="font-semibold text-ink">{d.term}</dt>
                  <dd className="mt-1 text-sm text-ink/70">
                    {d.definition}{" "}
                    {d.sourceUrl && (
                      <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-iris underline-offset-2 hover:underline">
                        ↗
                      </a>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* HowTo 步骤 */}
        {page.howToSteps && page.howToSteps.length > 0 && (
          <section id="how-to-steps" className="mt-10 scroll-mt-24">
            <h2 className="font-display text-2xl font-semibold">Step-by-step</h2>
            <ol className="mt-5 space-y-4">
              {page.howToSteps.map((s, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-iris text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="pt-0.5">
                    <p className="font-display text-base font-semibold">{s.name}</p>
                    <p className="mt-1 text-sm text-ink/70">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* 对比表 */}
        {page.comparisonTable && page.comparisonTable.columns.length > 0 && (
          <div className="mt-10 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-paper-dim text-left">
                  <th className="py-2.5 pr-4 font-semibold"></th>
                  {page.comparisonTable.columns.map((c) => (
                    <th key={c} className="py-2.5 pr-4 font-semibold text-iris">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.comparisonTable.rows.map((r, i) => (
                  <tr key={i} className="border-b border-paper-dim/60">
                    <td className="py-2.5 pr-4 font-medium text-ink">{r.label}</td>
                    {r.values.map((v, j) => (
                      <td key={j} className="py-2.5 pr-4 text-ink/70">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 要点 */}
        {page.keyTakeaways.length > 0 && (
          <div id="key-takeaways" className="mt-10 scroll-mt-24 surface p-6">
            <h2 className="font-display text-lg font-semibold">Key takeaways</h2>
            <ul className="mt-3 space-y-2">
              {page.keyTakeaways.map((t, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-ink/75">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-mint" /> {t}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 panel-dark p-7 text-center text-white">
          <h2 className="font-display text-xl font-semibold">See how AI talks about your brand</h2>
          <p className="mt-2 text-sm text-white/65">Run a free AI visibility audit in under a minute.</p>
          <div className="mx-auto mt-5 max-w-md">
            <AuditForm source={`${type}-${page.slug}`} />
          </div>
        </div>

        {/* FAQ */}
        {page.faqs.length > 0 && (
          <section id="faq" className="mt-12 scroll-mt-24">
            <h2 className="font-display text-2xl font-semibold">FAQ</h2>
            <div className="mt-5 divide-y divide-paper-dim">
              {page.faqs.map((f) => (
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

        {/* 来源引用(可引用事实) */}
        {page.sources && page.sources.length > 0 && (
          <section id="sources" className="mt-12 scroll-mt-24">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <BookOpen className="h-4 w-4 text-iris" /> Sources
            </h2>
            <ul className="mt-4 space-y-2">
              {page.sources.map((s, i) => (
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

        {/* 内链 */}
        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-lg font-semibold">Related</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {related.map(({ type: t, page: p }) => (
                <Link key={`${t}-${p.slug}`} href={`/${t}/${p.slug}`} className="card p-4 card-hover">
                  <span className="text-xs font-semibold uppercase tracking-wide text-iris">{TYPE_LABEL[t]}</span>
                  <p className="mt-1 text-sm font-medium leading-snug">{p.title}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs text-ink/50">
                    Read <ArrowRight className="h-3 w-3" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </article>
  );
}
