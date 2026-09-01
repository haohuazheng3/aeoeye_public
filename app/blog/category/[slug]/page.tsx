import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight } from "lucide-react";
import {
  getCategories,
  getPostsByCategory,
  categorySlug,
  HUB_PAGE_SIZE,
} from "@/lib/content/blog";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { formatDate } from "@/lib/utils";

/**
 * 分类枢纽页(Pillar/Hub)。
 *
 * 为什么存在:291+ 篇文章堆在一个 /blog 长列表里,内链权重与抓取预算分配都很差,
 * 而且白白浪费了分类词本身的排名机会。每个枢纽页有自己的导读框架、链向全部子文章、
 * 带面包屑与 BreadcrumbList —— 让它自己去吃排名,而不只是做导航。
 * 超过 HUB_PAGE_SIZE 篇分页,分页可抓取(?page=N,不加 noindex)。
 */

/** 每个分类的导读框架 —— 枢纽页不能是裸列表,得先给读者一个判断框架 */
const INTROS: Record<string, { lead: string; frame: string[] }> = {
  tools: {
    lead: "Every tool in this category is making one architectural bet, and each bet has a real cost. Before you compare feature lists, decide which bet matches your situation.",
    frame: [
      "Does it ask real buyer questions, or only track your brand name as a string? String-matching is cheap and tells you nothing about whether an AI would recommend you.",
      "Does it separate “the AI found me after searching” from “the AI knew me already”? These are different problems with different fixes.",
      "Does it show the actual answer text, or only a score? A single number is easy to report and easy to game.",
      "Does it name the exact model version it queried? An answer from a cheap small model is not what your buyers see.",
      "Is it reproducible — same audit twice, same number? If not, you cannot tell improvement from noise.",
    ],
  },
  strategy: {
    lead: "AEO strategy is not a checklist. It is a small set of decisions where each option costs you something, and pretending otherwise is why most programmes stall after the first audit.",
    frame: [
      "Which buyer questions you compete on — you cannot be recommended for everything.",
      "Memory or retrieval: being named from the model’s own knowledge is durable but slow; being cited after a live search is faster but fragile.",
      "Own pages or third-party proof — for a low-authority brand, earned mentions usually move the answer faster than another blog post.",
      "What you measure: mention rate on real buyer questions, or impressions and rank. Pick one north star.",
    ],
  },
  "ai-search": {
    lead: "AI answer engines do not behave like search engines, and the differences are measurable. Across 90 AEOeye audits the same brand was named by Claude in 31% of buyer questions but by Google AI Overviews in only 2% — checking one engine tells you very little.",
    frame: [
      "How each engine sources its answer: live retrieval, training memory, or a blend.",
      "Why the same question returns different brands on different engines.",
      "What causes an answer to change run-to-run, and how to tell drift from a real improvement.",
    ],
  },
  fundamentals: {
    lead: "Start here if you are new to answer-engine visibility. These pieces define the terms precisely and in the order they actually matter.",
    frame: [
      "What AEO and GEO mean, and where SEO genuinely differs.",
      "How an AI decides which brands to name in a recommendation.",
      "What has to be true technically before any of the content work can pay off.",
    ],
  },
  comparisons: {
    lead: "Side-by-side pages, written to be quotable. Comparison tables are the format AI answer engines lift most often — which is exactly why the details in them have to be right.",
    frame: [
      "What each option actually optimises for, not what its marketing says.",
      "Where the honest trade-off sits, including where our own category is weak.",
      "Who should pick which, and what they give up.",
    ],
  },
  reviews: {
    lead: "Tool reviews with the trade-offs left in. A review that lists only strengths is an ad.",
    frame: [
      "What the tool measures, and what it cannot tell you.",
      "Pricing structure and where the cost surprises are.",
      "Who it fits, and who should look elsewhere.",
    ],
  },
  technical: {
    lead: "The plumbing: crawlability for AI agents, structured data, and entity clarity. An AI that cannot reach or parse you cannot cite you — necessary, but never sufficient.",
    frame: [
      "Which crawlers matter, and what blocking them actually costs.",
      "Which schema types earn extraction, and which are decoration.",
      "How to make one brand entity unambiguous across the web.",
    ],
  },
  opinion: {
    lead: "Arguments, not summaries. These take positions we are willing to defend with data.",
    frame: [
      "Where the industry consensus is wrong.",
      "What the numbers actually support.",
      "What we would do differently.",
    ],
  },
};

export async function generateStaticParams() {
  return getCategories().map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { page?: string };
}): Promise<Metadata> {
  const cat = getCategories().find((c) => c.slug === params.slug);
  if (!cat) return {};
  const pageCount = Math.max(1, Math.ceil(cat.count / HUB_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(searchParams?.page) || 1), pageCount);
  const pageSuffix = page > 1 ? ` — Page ${page}` : "";
  const path = page > 1 ? `/blog/category/${cat.slug}?page=${page}` : `/blog/category/${cat.slug}`;
  return pageMeta({
    title: `${cat.name} — AI Visibility & AEO Guides${pageSuffix}`,
    description: `${page > 1 ? `Page ${page} of ${pageCount}. ` : ""}${cat.count} in-depth ${cat.name.toLowerCase()} guides on getting recommended by ChatGPT, Claude, Perplexity, Gemini and Google AI — with the trade-offs left in.`,
    path,
  });
}

export default function CategoryHub({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { page?: string };
}) {
  const cat = getCategories().find((c) => c.slug === params.slug);
  if (!cat) notFound();

  const all = getPostsByCategory(params.slug);
  const pageCount = Math.max(1, Math.ceil(all.length / HUB_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(searchParams?.page) || 1), pageCount);
  const posts = all.slice((page - 1) * HUB_PAGE_SIZE, page * HUB_PAGE_SIZE);
  const pagePath = page > 1 ? `/blog/category/${cat.slug}?page=${page}` : `/blog/category/${cat.slug}`;
  const pageName = page > 1 ? `${cat.name} — Page ${page}` : cat.name;
  const intro = INTROS[params.slug] ?? {
    lead: `Everything we've published on ${cat.name.toLowerCase()}.`,
    frame: [],
  };
  const others = getCategories().filter((c) => c.slug !== params.slug);

  return (
    <div className="container-tight py-12 sm:py-16">
      {/* 面包屑 —— 与下方 BreadcrumbList schema 一一对应 */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-ink/45">
        <Link href="/" className="hover:text-ink">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/blog" className="hover:text-ink">Blog</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-ink/70">{cat.name}</span>
      </nav>

      <header className="mt-6 max-w-2xl">
        <p className="eyebrow">
          {cat.count} guides{page > 1 ? ` · Page ${page} of ${pageCount}` : ""}
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{cat.name}</h1>
        <p className="mt-4 leading-relaxed text-ink/70">{intro.lead}</p>
      </header>

      {/* 导读框架 —— 枢纽页自己要有价值,不是裸列表 */}
      {intro.frame.length > 0 && (
        <div className="card mt-8 p-7">
          <div className="relative z-10">
            <h2 className="font-display text-lg font-semibold">How to read this section</h2>
            <ul className="mt-4 space-y-3">
              {intro.frame.map((f, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink/70">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-iris/10 text-[11px] font-bold text-iris">
                    {i + 1}
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 子文章 —— 全部可达,无孤儿页 */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {posts.map((p) => (
          <Link key={p.slug} href={`/blog/${p.slug}`} className="card card-hover p-6">
            <div className="relative z-10">
              <p className="text-xs font-semibold uppercase tracking-wide text-iris">{p.category}</p>
              <h3 className="mt-2 font-display text-base font-semibold leading-snug">{p.title}</h3>
              <p className="mt-2 line-clamp-2 text-sm text-ink/55">{p.description}</p>
              <p className="mt-3 text-xs text-ink/40">
                {formatDate(new Date(p.date))} · {p.readingTime}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* 分页 —— 可抓取的真实链接,不是 JS 切换 */}
      {pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={n === 1 ? `/blog/category/${cat.slug}` : `/blog/category/${cat.slug}?page=${n}`}
              aria-current={n === page ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                n === page ? "btn-primary" : "btn-ghost"
              }`}
            >
              {n}
            </Link>
          ))}
        </nav>
      )}

      {/* 横向枢纽互链 */}
      <div className="mt-14">
        <h2 className="font-display text-lg font-semibold">Other sections</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {others.map((c) => (
            <Link key={c.slug} href={`/blog/category/${c.slug}`} className="chip">
              {c.name} <span className="text-ink/35">{c.count}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="card mt-12 p-8 text-center">
        <div className="relative z-10">
          <h2 className="font-display text-xl font-semibold">See where you actually stand</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/55">
            Run a free audit and find out whether AI names you — or a competitor — when buyers ask.
          </p>
          <div className="mx-auto mt-6 max-w-lg">
            <AuditForm source={`hub-${cat.slug}`} variant="inline" cta="Audit" />
          </div>
        </div>
      </div>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
            { "@type": "ListItem", position: 2, name: "Blog", item: `${siteUrl}/blog` },
            { "@type": "ListItem", position: 3, name: pageName, item: `${siteUrl}${pagePath}` },
          ],
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${cat.name} — AI Visibility & AEO Guides${page > 1 ? ` — Page ${page}` : ""}`,
          url: `${siteUrl}${pagePath}`,
          hasPart: posts.map((p) => ({
            "@type": "Article",
            headline: p.title,
            url: `${siteUrl}/blog/${p.slug}`,
            datePublished: p.date,
          })),
        }}
      />
    </div>
  );
}
