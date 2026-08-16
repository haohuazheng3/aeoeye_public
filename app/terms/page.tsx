import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Terms of Service",
  description: `The terms governing your use of ${site.name}.`,
  path: "/terms",
});

export default function TermsPage() {
  return (
    <article className="container-tight max-w-3xl py-16">
      <p className="eyebrow">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-semibold">Terms of Service</h1>
      <p className="mt-2 text-sm text-ink/50">Last updated: June 25, 2026</p>

      <div className="prose mt-10">
        <p>
          These Terms of Service (“Terms”) govern your access to and use of {site.name} at {site.domain} (the
          “Service”). By using the Service, you agree to these Terms.
        </p>

        <h2>The Service</h2>
        <p>
          {site.name} analyzes how AI assistants and answer engines reference brands, and produces visibility reports and
          recommendations. Reports are informational estimates based on AI outputs and public data at a point in time.
          They are not guarantees of ranking, traffic, revenue or any specific outcome.
        </p>

        <h2>Accounts</h2>
        <p>
          You are responsible for activity under your account and for keeping your login secure. You must provide
          accurate information and be authorized to submit any brand or website you audit.
        </p>

        <h2>Acceptable use</h2>
        <ul>
          <li>Don’t abuse, overload, scrape or attempt to disrupt the Service.</li>
          <li>Don’t use the Service to violate any law or third-party right.</li>
          <li>Don’t resell or redistribute reports as your own product without permission.</li>
          <li>Automated or excessive requests may be rate-limited or blocked.</li>
        </ul>

        <h2>Plans, billing &amp; refunds</h2>
        <p>
          Some features require a one-time purchase or a subscription, billed through Stripe. Subscriptions renew
          automatically until canceled; you can cancel anytime and retain access through the current period. For one-time
          report purchases, if the report fails to generate, contact us for a refund or re-run.
        </p>

        <h2>Intellectual property</h2>
        <p>
          The Service, including its software, design and content, is owned by {site.name}. Your report content about your
          own brand is yours to use. AI outputs quoted in reports belong to their respective providers.
        </p>

        <h2>Disclaimers</h2>
        <p>
          The Service is provided “as is” without warranties of any kind. AI systems change frequently and may produce
          inaccurate or inconsistent answers; we don’t control third-party AI engines.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, {site.name} will not be liable for indirect, incidental or consequential
          damages, or for amounts exceeding what you paid us in the 12 months before the claim.
        </p>

        <h2>Termination</h2>
        <p>We may suspend or terminate access for breach of these Terms. You may stop using the Service at any time.</p>

        <h2>Changes</h2>
        <p>We may update these Terms; continued use after changes constitutes acceptance.</p>

        <h2>Contact</h2>
        <p>
          Questions about these Terms? Email <a href={`mailto:${site.email}`}>{site.email}</a>.
        </p>
      </div>
    </article>
  );
}
