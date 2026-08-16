import type { Metadata } from "next";
import { Mail, MessageSquare, Clock, Link2, ExternalLink } from "lucide-react";
import { ContactForm } from "@/components/contact-form";
import { pageMeta } from "@/lib/seo";
import { site } from "@/lib/site";
import { officialAccounts } from "@/lib/official-accounts";

export const metadata: Metadata = pageMeta({
  title: "Contact",
  description: `Get in touch with the ${site.name} team. Questions about AI visibility, your audit, or partnerships — we’re happy to help.`,
  path: "/contact",
});

export default function ContactPage() {
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Contact</p>
        <h1 className="mt-3 font-display text-4xl font-semibold">Let’s talk</h1>
        <p className="mt-3 text-ink/65">
          Questions about your audit, AI visibility, or working together? Send a note — a real person reads every one.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <InfoCard icon={Mail} title="Email us">
            <a href={`mailto:${site.email}`} className="font-medium text-iris link-underline">
              {site.email}
            </a>
          </InfoCard>
          <InfoCard icon={MessageSquare} title="What we can help with">
            Audit questions, AEO strategy, agency & partnership inquiries, press.
          </InfoCard>
          <InfoCard icon={Clock} title="Response time">
            We usually reply within one business day.
          </InfoCard>
          <InfoCard icon={Link2} title="Official accounts">
            <ul className="space-y-2">
              {officialAccounts.map((account) => (
                <li key={account.id}>
                  <a
                    href={account.url}
                    target="_blank"
                    rel="me noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-iris link-underline"
                  >
                    {account.label}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </InfoCard>
        </div>
        <ContactForm />
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-iris/10 text-iris">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 font-display text-base font-semibold">{title}</h3>
      <div className="mt-1 text-sm text-ink/60">{children}</div>
    </div>
  );
}
