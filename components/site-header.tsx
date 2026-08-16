import Link from "next/link";
import { LogoFull } from "@/components/logo";
import { AuthNav } from "@/components/auth-nav";

const nav = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/guides", label: "Guides" },
  { href: "/tools", label: "Tools" },
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

          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-[13.5px] font-medium text-ink/55 transition hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <AuthNav />
            <Link href="/#audit" className="btn-primary px-4 py-2 text-[13px]">
              Free audit
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
