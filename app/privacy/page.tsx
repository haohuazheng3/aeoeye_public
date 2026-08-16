import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Privacy Policy",
  description: `How ${site.name} collects, uses and protects your data.`,
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <article className="container-tight max-w-3xl py-16">
      <p className="eyebrow">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink/50">Last updated: June 25, 2026</p>

      <div className="prose mt-10">
        <p>
          This Privacy Policy explains how {site.name} (“we”, “us”) collects, uses and safeguards information when you use{" "}
          {site.domain} and our AI visibility audit service (the “Service”). We keep data collection to the minimum
          needed to run the Service.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Audit inputs.</strong> The brand name or website you submit, and the public web content and AI
            responses we gather to produce your report.
          </li>
          <li>
            <strong>Account data.</strong> If you create an account, your email address, managed by our authentication
            provider (Clerk). We do not store your password.
          </li>
          <li>
            <strong>Payment data.</strong> If you purchase a report or subscription, payments are processed by Stripe. We
            receive confirmation and limited metadata (amount, status) — never your full card number.
          </li>
          <li>
            <strong>Usage &amp; technical data.</strong> Product analytics covering page views, clicks, scrolling,
            journeys, business events (sign-in, purchase, report delivery) and JavaScript errors that occur in your
            browser. Our analytics provider also captures what you type into forms on this site, text you copy from it,
            and files you upload to it, so we can see where the product confuses people. We never capture passwords or
            payment card fields. This sits alongside standard request logs and IP-based rate-limiting handled by our
            infrastructure providers (Vercel, Cloudflare).
          </li>
        </ul>

        <h2>How we use information</h2>
        <ul>
          <li>To generate, store and display your AI visibility reports.</li>
          <li>To provide accounts, subscriptions, monitoring and email notifications you request.</li>
          <li>To secure the Service, prevent abuse and enforce rate limits.</li>
          <li>To improve the Service in aggregate. We do not sell your personal data.</li>
        </ul>

        <h2>Sub-processors</h2>
        <p>We rely on reputable providers to operate the Service, including:</p>
        <ul>
          <li>Vercel (hosting), Neon (database), Cloudflare (CDN, security, storage)</li>
          <li>Clerk (authentication and account verification emails), Stripe (payments)</li>
          <li>FlowGlance (product analytics and browser error monitoring)</li>
          <li>AI and data providers used to run audits (e.g. OpenAI, Anthropic, DataForSEO)</li>
        </ul>

        <h2>Data retention</h2>
        <p>
          Audit reports are retained so you can revisit them. You can request deletion of your audits and account data at
          any time by emailing{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a>. We delete or anonymize data we no longer need.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on your location, you may have rights to access, correct, export or delete your personal data, and to
          object to certain processing. To exercise them, contact us at{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a>.
        </p>

        <h2>Cookies</h2>
        <p>
          We use a minimal set of cookies and similar technologies. See our{" "}
          <a href="/cookies">Cookie Policy</a> for details.
        </p>

        <h2>Children</h2>
        <p>The Service is intended for businesses and is not directed to children under 16.</p>

        <h2>Changes</h2>
        <p>
          We may update this policy. Material changes will be reflected by the “Last updated” date above.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about privacy? Email <a href={`mailto:${site.email}`}>{site.email}</a>.
        </p>
      </div>
    </article>
  );
}
