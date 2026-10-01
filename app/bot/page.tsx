import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { pageMeta, breadcrumbJsonLd } from "@/lib/seo";
import { site } from "@/lib/site";
import { FREE_CRAWL_PAGES, FULL_CRAWL_PAGES, SEO_BOT_MOBILE_UA, SEO_BOT_UA } from "@/lib/seo-audit/types";
import {
  BROKEN_INTERNAL_MAX,
  BROKEN_OUTBOUND_MAX,
  CANONICAL_TARGETS_MAX,
  ENRICH_CONCURRENCY,
  LARGE_IMAGES_MAX,
  MAX_CRAWL_DELAY_MS,
  MIN_HOST_INTERVAL_MS,
  OUTBOUND_TIMEOUT_MS,
  SITEMAP_SAMPLE_SIZE,
} from "@/lib/seo-audit/crawl";
import { MAX_SITEMAP_CANDIDATES, MAX_SITEMAP_CHILDREN } from "@/lib/seo-audit/sitemap";
import { DEFAULT_MAX_BYTES } from "@/lib/seo-audit/fetch";
import { QUOTA } from "@/lib/seo-audit/quota";
import { SEO_AUDIT_REUSE_MS, SEO_RERUN_WINDOW_MS } from "@/lib/seo-audit/repo";

/* ============================================================
   /bot —— 爬虫说明页。UA 里带着这个链接(+https://aeoeye.com/bot),
   站长在服务器日志里看到我们时,点进来 30 秒内要能知道:是谁、抓什么、多快、怎么挡、找谁。

   复审 C36:这页的每一句都必须和爬虫的真实行为对得上 —— 说"从不抓图片"却对图片发 HEAD、
   说"30–60 个请求"实际过百、承诺一个不存在的排除名单,站长对着日志一核对,我们就失去了被加白的机会。
   所以所有数字都从引擎的常量里导入(types / crawl / sitemap / fetch / quota / repo),改代码这页自动跟着变;
   个别没有导出的固定值(抓取并发 4、8 种 URL 变体、HEAD 失败时最多读 4 KB)在下面写明来源。
   静态渲染:这些 import 只在构建时求值,不连数据库。
   ============================================================ */

export const metadata: Metadata = pageMeta({
  title: "AEOeyeBot — Crawler Information",
  description:
    "What AEOeyeBot fetches, how often and how politely, how it treats robots.txt, and how to block it. AEOeyeBot runs on-demand technical SEO audits requested on aeoeye.com.",
  path: "/bot",
});

/**
 * 入口与站点级探针的固定开销(没有单独导出的常量):robots.txt ×2(抓取与探针各取一次)、
 * 入口页 ×3(探针桌面 UA、移动 UA、抓取本身)、8 种 URL 变体(VariantKind)、软 404 探针 1、
 * og:image 1、入口 canonical 目标 1。只用来给出"大约多少请求"的量级。
 */
const PROBE_OVERHEAD = 2 + 3 + 8 + 1 + 1 + 1;
/** 探针阶段先查入口页自己的 canonical 目标,补全阶段再查至多 CANONICAL_TARGETS_MAX 个 —— 合计上限要 +1 */
const CANONICAL_TARGETS = CANONICAL_TARGETS_MAX + 1;
const SITE_CHECKS = SITEMAP_SAMPLE_SIZE + CANONICAL_TARGETS_MAX + BROKEN_INTERNAL_MAX + LARGE_IMAGES_MAX;
const SITEMAP_FILES = MAX_SITEMAP_CANDIDATES + MAX_SITEMAP_CHILDREN;
const FREE_TOTAL = roundUp10(PROBE_OVERHEAD + SITEMAP_FILES + FREE_CRAWL_PAGES + SITE_CHECKS);
const FULL_TOTAL = roundUp10(PROBE_OVERHEAD + SITEMAP_FILES + FULL_CRAWL_PAGES + SITE_CHECKS);

function roundUp10(n: number): number {
  return Math.ceil(n / 10) * 10;
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;
const hours = (ms: number) => Math.round(ms / 3_600_000);
const days = (ms: number) => Math.round(ms / 86_400_000);
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-paper-soft px-1.5 py-0.5 text-xs">{children}</code>;
}

export default function BotPage() {
  return (
    <div className="container-tight py-12 sm:py-16">
      <header className="max-w-2xl">
        <p className="eyebrow flex items-center gap-2">
          <Bot className="h-3.5 w-3.5" /> Crawler information
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold">AEOeyeBot</h1>
        <p className="mt-3 text-lg text-ink/65">
          AEOeyeBot fetches a sample of a website when someone requests a{" "}
          <Link href="/seo-audit" className="font-medium text-iris hover:underline">
            technical SEO audit
          </Link>{" "}
          of it on {site.name}. It never crawls on its own schedule.
        </p>
      </header>

      <section className="card mt-8 p-6 sm:p-7" aria-labelledby="agents">
        <div className="relative z-10">
          <h2 id="agents" className="font-display text-xl font-semibold tracking-tight">
            User agents
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/65">
            Both contain <span className="font-medium text-ink">AEOeyeBot</span>, so one rule matches both. It never sends a
            plain browser or Googlebot user agent.
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Main user agent</p>
          <code className="mt-1.5 block break-all rounded-xl bg-paper-soft px-3 py-2 text-sm text-ink">{SEO_BOT_UA}</code>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
            Mobile — one extra request for the audited page, to compare mobile and desktop HTML
          </p>
          <code className="mt-1.5 block break-all rounded-xl bg-paper-soft px-3 py-2 text-sm text-ink">{SEO_BOT_MOBILE_UA}</code>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-6 sm:p-7" aria-labelledby="fetches">
          <div className="relative z-10">
            <h2 id="fetches" className="font-display text-xl font-semibold tracking-tight">
              What it requests
            </h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink/75 marker:text-ink/25">
              <li>
                <Code>/robots.txt</Code>
              </li>
              <li>
                Up to {MAX_SITEMAP_CANDIDATES} sitemap files (those in robots.txt, <Code>/sitemap.xml</Code> and{" "}
                <Code>/sitemap_index.xml</Code>) plus up to {MAX_SITEMAP_CHILDREN} child sitemaps of one index
              </li>
              <li>
                Up to {FREE_CRAWL_PAGES} HTML pages for a free report, {FULL_CRAWL_PAGES} for a full one — found through
                your links and a sample of your sitemap
              </li>
              <li>
                Variants of the audited URL — http / https, www / apex, trailing slash, upper case,{" "}
                <Code>/index.html</Code> and a utm-tagged copy — to check redirects
              </li>
              <li>
                One random path such as <Code>/aeoeye-404-probe-1a2b3c4d</Code>, to check that missing pages return 404
              </li>
              <li>
                The start of up to {SITEMAP_SAMPLE_SIZE} sitemap URLs it didn&rsquo;t crawl and up to {CANONICAL_TARGETS}{" "}
                canonical targets — enough to read status, noindex and canonical
              </li>
              <li>HEAD requests to up to {BROKEN_INTERNAL_MAX} internal link targets it didn&rsquo;t crawl, to find broken links</li>
              <li>HEAD requests to up to {LARGE_IMAGES_MAX} images and the og:image, to read their file size</li>
              <li>
                HEAD requests to up to {BROKEN_OUTBOUND_MAX} links pointing to other sites ({OUTBOUND_TIMEOUT_MS / 1000}-second
                timeout), to find dead outbound links
              </li>
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-ink/45">
              Pages are read as raw HTML, up to {megabytes(DEFAULT_MAX_BYTES)} each. It never runs JavaScript, submits forms
              or logs in, and doesn&rsquo;t download scripts, stylesheets or images. When a HEAD request fails it may retry
              with a GET that stops after the first 4 KB.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink/45">
              In all, roughly {FREE_TOTAL} requests at most to your site for a free audit and {FULL_TOTAL} for a full one,
              spread over a minute or two.
            </p>
          </div>
        </section>

        <section className="card p-6 sm:p-7" aria-labelledby="rate">
          <div className="relative z-10">
            <h2 id="rate" className="font-display text-xl font-semibold tracking-tight">
              How politely
            </h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink/75 marker:text-ink/25">
              <li>
                Crawls pages 4 at a time and checks links {ENRICH_CONCURRENCY} at a time; page fetches and link checks on the
                same host start at least {MIN_HOST_INTERVAL_MS} ms apart
              </li>
              <li>
                Follows the <Code>robots.txt</Code> rules for <Code>AEOeyeBot</Code> (or <Code>*</Code>) for every page it
                crawls and every sitemap URL or internal link it samples
              </li>
              <li>
                Honours <Code>Crawl-delay</Code> while crawling pages, up to {seconds(MAX_CRAWL_DELAY_MS)}; a longer delay is
                capped at {seconds(MAX_CRAWL_DELAY_MS)} and the number of pages is halved
              </li>
              <li>
                Stops on a 429, a challenge page or 403 responses and skips the remaining checks on your host. If the audited
                URL itself is refused, the audit stops there and the report says the site blocked us. It never retries with a
                different user agent.
              </li>
              <li>
                Free audits: at most {QUOTA.domainHour.limit} fresh runs of the same site per hour across all users, and the
                same URL audited again within {hours(SEO_AUDIT_REUSE_MS)} hours reuses the earlier result unless a re-run is
                forced. Paid reports can also be re-run for {days(SEO_RERUN_WINDOW_MS)} days after purchase.
              </li>
            </ul>
          </div>
        </section>

        <section className="card p-6 sm:p-7" aria-labelledby="block">
          <div className="relative z-10">
            <h2 id="block" className="font-display text-xl font-semibold tracking-tight">
              How to block it
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/65">
              <span className="font-medium text-ink">Stop the crawl</span> with robots.txt:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-paper-soft p-4 text-sm text-ink">{`User-agent: AEOeyeBot\nDisallow: /`}</pre>
            <p className="mt-2 text-xs leading-relaxed text-ink/45">
              AEOeyeBot then fetches none of your pages beyond the URL the audit was requested for. Each audit still makes
              the site-level requests above: robots.txt, sitemaps, that URL with its variants and canonical target, the 404
              probe, and size checks on that page&rsquo;s images.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink/65">
              <span className="font-medium text-ink">Refuse every request</span> by blocking user agents containing{" "}
              <Code>AEOeyeBot</Code> at your firewall or CDN.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink/45">
              The audit then reports the site as blocked instead of giving it a score. Neither option affects Google.
            </p>
          </div>
        </section>

        <section className="card p-6 sm:p-7" aria-labelledby="contact">
          <div className="relative z-10">
            <h2 id="contact" className="font-display text-xl font-semibold tracking-tight">
              Contact
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/65">
              Questions, or traffic you didn&rsquo;t expect? Email{" "}
              <a href={`mailto:${site.email}`} className="font-medium text-iris hover:underline">
                {site.email}
              </a>{" "}
              with your domain and the time of the requests, and we&rsquo;ll look into it.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-ink/45">
              Requests come from Vercel&rsquo;s cloud and the IP range isn&rsquo;t fixed, so please match on the user agent.
              The PageSpeed Insights part of an audit is run by Google: those visits come from Google&rsquo;s servers with a
              Chrome-Lighthouse user agent, not from AEOeyeBot.
            </p>
          </div>
        </section>
      </div>

      <JsonLd data={breadcrumbJsonLd([{ name: "AEOeyeBot", path: "/bot" }])} />
    </div>
  );
}
