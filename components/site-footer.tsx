import Link from "next/link";
import { LogoFull } from "@/components/logo";
import { site } from "@/lib/site";
import { FeaturedOn } from "@/components/featured-on";

const groups: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#audit", label: "Free AI audit" },
      { href: "/seo-audit", label: "SEO audit" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/example", label: "Example report" },
      { href: "/pricing", label: "Pricing" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Free tools",
    links: [
      { href: "/tools/category/ai-search", label: "AEO & AI crawler tools" },
      { href: "/tools/category/crawl-index", label: "Crawling & indexing" },
      { href: "/tools/category/on-page", label: "On-page & content" },
      { href: "/tools/category/social-schema", label: "Schema & social previews" },
      { href: "/tools/category/speed-security", label: "Speed, mobile & security" },
      { href: "/blog", label: "Technical SEO decisions" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
];

export function SiteFooter() {
  const year = 2026;
  return (
    <footer className="mt-28 pb-10">
      <div className="container-tight">
        <div className="card px-7 py-8 sm:px-9">
          <div className="grid gap-8 md:grid-cols-[1.4fr_repeat(4,1fr)]">
            <div>
              {/*
                Link 与下面的邮箱都是行内元素,会被排进同一行 —— 邮箱因此挤到 logo 右侧、
                且 mt-4 对行内元素无效(实测左边缘偏移 109px,正好是 logo 宽度)。
                两者都提升为块级,邮箱才会规规矩矩落在 logo 下方并左对齐。
              */}
              <Link href="/" className="inline-block text-ink">
                <LogoFull />
              </Link>
              <a
                href={`mailto:${site.email}`}
                className="mt-4 block text-[13px] font-medium text-iris link-underline"
              >
                {site.email}
              </a>
            </div>
            {groups.map((g) => (
              <div key={g.title}>
                <h3 className="text-[13px] font-semibold text-ink/70">{g.title}</h3>
                <ul className="mt-3 space-y-2">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-[13px] text-ink/45 transition hover:text-ink">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {/* 目录反链 —— 最底部一行小灰字,不起眼但真实可见可抓取 */}
          <FeaturedOn />

          <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-ink/[0.06] pt-5 text-xs text-ink/40 sm:flex-row">
            <p>© {year} {site.name}. All rights reserved.</p>
            <p>Built for the answer-engine era.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
