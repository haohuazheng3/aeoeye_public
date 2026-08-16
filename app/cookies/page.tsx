import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Cookie Policy",
  description: `How ${site.name} uses cookies and similar technologies.`,
  path: "/cookies",
});

export default function CookiesPage() {
  return (
    <article className="container-tight max-w-3xl py-16">
      <p className="eyebrow">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-semibold">Cookie Policy</h1>
      <p className="mt-2 text-sm text-ink/50">Last updated: June 25, 2026</p>

      <div className="prose mt-10">
        <p>
          {site.name} uses a minimal set of cookies and similar technologies to run the Service, keep you signed in and
          understand aggregate usage. We do not use advertising or cross-site tracking cookies.
        </p>

        <h2>Types of cookies we use</h2>
        <ul>
          <li>
            <strong>Essential.</strong> Required for core functionality such as authentication (Clerk) and security. The
            Service won’t work properly without these.
          </li>
          <li>
            <strong>Preferences.</strong> Remember choices like your cookie consent.
          </li>
          <li>
            <strong>Analytics.</strong> Privacy-friendly, aggregate analytics (Vercel Analytics, Cloudflare Web
            Analytics) that help us improve the Service. These don’t identify you personally.
          </li>
        </ul>

        <h2>Managing cookies</h2>
        <p>
          You can accept or decline non-essential cookies via our consent banner, and control cookies through your
          browser settings. Blocking essential cookies may break parts of the Service.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Email <a href={`mailto:${site.email}`}>{site.email}</a>.
        </p>
      </div>
    </article>
  );
}
