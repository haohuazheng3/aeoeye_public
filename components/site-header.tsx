import Link from "next/link";
import { LogoFull } from "@/components/logo";
import { AuthNav } from "@/components/auth-nav";
import { MobileMenu } from "@/components/mobile-menu";

const nav = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/guides", label: "Guides" },
  { href: "/tools", label: "Tools" },
  { href: "/seo-audit", label: "SEO Audit" },
  { href: "/blog", label: "Blog" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-3 z-50">
      <div className="container-tight">
        <div className="glass-bar flex h-14 items-center justify-between gap-3 pl-4 pr-2">
          <Link href="/" aria-label="AEOeye home" className="flex items-center text-ink">
            <LogoFull />
          </Link>

          {/*
            桌面导航从 lg(1024px)起才出现(复审 C29):加了第 6 项 "SEO Audit" 后,768–约 900px
            的胶囊页头放不下 logo + 6 个链接 + 登录/Free audit,链接和按钮会被挤成两行(已登录更宽)。
            这个区间交给汉堡菜单;whitespace-nowrap 是第二道保险 —— 以后再加项时宁可溢出也不静默折行。
          */}
          <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="whitespace-nowrap text-[13.5px] font-medium text-ink/55 transition hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <AuthNav />
            <Link href="/#audit" className="btn-primary whitespace-nowrap px-4 py-2 text-[13px]">
              Free audit
            </Link>
            {/* <1024px 的菜单入口;面板绝对定位在这只胶囊之下,桌面端不渲染任何东西 */}
            <MobileMenu items={nav} />
          </div>
        </div>
      </div>
    </header>
  );
}
