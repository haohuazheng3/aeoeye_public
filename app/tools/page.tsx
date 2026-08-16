import type { Metadata } from "next";
import Link from "next/link";
import { FileCode2, Braces, Bot, Calculator, ArrowRight } from "lucide-react";
import { TOOLS } from "@/lib/content/tools";
import { JsonLd } from "@/components/json-ld";
import { AuditForm } from "@/components/audit-form";
import { pageMeta, breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Free AEO Tools — llms.txt, Schema & AI Robots.txt Generators",
  description:
    "Free tools to make your site AI-friendly: an llms.txt generator, JSON-LD schema generator, and AI robots.txt generator. No signup, instant copy & download.",
  path: "/tools",
});

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "llms-txt-generator": FileCode2,
  "schema-generator": Braces,
  "ai-robots-txt-generator": Bot,
  "seo-roi-calculator": Calculator,
};

export default function ToolsHub() {
  return (
    <div className="container-tight py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Free tools</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Make your site AI-friendly</h1>
        <p className="mt-4 text-ink/65">
          Free, no-signup tools that solve one AEO problem each — instantly. Build the files and markup that help AI
          assistants find, understand and cite your brand.
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {TOOLS.map((t) => {
          const Icon = ICONS[t.slug] || FileCode2;
          return (
            <Link key={t.slug} href={`/tools/${t.slug}`} className="card group flex flex-col p-6 card-hover">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-iris/10 text-iris">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold">{t.name}</h2>
              <p className="mt-1 text-sm font-medium text-iris">{t.tagline}</p>
              <p className="mt-2 flex-1 text-sm text-ink/60">{t.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink">
                Open tool <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </Link>
          );
        })}
      </div>

      <section className="mx-auto mt-16 max-w-xl panel-dark p-8 text-center text-white">
        <h2 className="font-display text-2xl font-semibold">The biggest tool: your free audit</h2>
        <p className="mt-2 text-sm text-white/65">See exactly how AI assistants talk about your brand right now.</p>
        <div className="mt-6">
          <AuditForm source="tools-hub" />
        </div>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Tools", path: "/tools" }]),
          itemListJsonLd("Free AEO tools", TOOLS.map((t) => ({ name: t.name, path: `/tools/${t.slug}` }))),
        ]}
      />
    </div>
  );
}
