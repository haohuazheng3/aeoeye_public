import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TOOL_CATEGORIES, categoryItems } from "@/lib/content/tool-pages";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Free SEO & AEO Tools — Crawl, Index, Schema & AI Crawler Checks",
  description:
    "Free, no-signup tools that each check one thing live: AI crawler access, robots.txt, sitemaps, redirects, title tags, schema, Open Graph, Core Web Vitals and more.",
  path: "/tools",
});

export default function ToolsHub() {
  const groups = TOOL_CATEGORIES.map((c) => ({ ...c, items: categoryItems(c.slug) }));
  const all = groups.flatMap((g) => g.items);
  return (
    <div className="container-tight py-14 sm:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Free tools</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">One check, one tool, live results</h1>
        <p className="mt-4 text-ink/65">
          {all.length} free tools that fetch your page the way Google and AI crawlers do and tell you what&rsquo;s wrong — and
          what to change. No signup, no trial, no tracking subscription.
        </p>
      </div>

      <div className="mt-14 space-y-14">
        {groups.map((g) => (
          <section key={g.slug} aria-labelledby={`cat-${g.slug}`}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="max-w-2xl">
                <h2 id={`cat-${g.slug}`} className="font-display text-2xl font-semibold">{g.name}</h2>
                <p className="mt-1 text-sm text-ink/60">{g.intro}</p>
              </div>
              <Link href={`/tools/category/${g.slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-iris hover:underline">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((t) => (
                <li key={t.slug}>
                  <Link href={`/tools/${t.slug}`} className="card group flex h-full flex-col p-4 card-hover">
                    <h3 className="font-display text-[15px] font-semibold">{t.name}</h3>
                    <p className="mt-1 line-clamp-2 text-[13px] text-ink/55">{t.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">The biggest tool: your free AI audit</h2>
        <p className="mt-2 text-sm text-white/65">See whether ChatGPT recommends your brand when buyers ask.</p>
        <div className="mt-6">
          <AuditForm source="tools-hub" variant="inline" />
        </div>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Tools", path: "/tools" }]),
          itemListJsonLd("Free SEO & AEO tools", all.map((t) => ({ name: t.name, path: `/tools/${t.slug}` }))),
        ]}
      />
    </div>
  );
}
