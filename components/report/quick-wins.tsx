import { FileCode2, FileText } from "lucide-react";
import type { AuditResult } from "@/lib/engine/types";

/**
 * $29 完整报告专属:按品牌定制的可复制修复代码(llms.txt + Organization JSON-LD)。
 * 确定性模板生成 —— 零额外 AI 成本,格式永远正确,买家拿去就能贴。
 */
export function QuickWins({ result }: { result: AuditResult }) {
  const { brand, domain, category } = result;
  const base = `https://${domain}`;
  const tagline = `${brand} — ${category}.`;

  const llmsTxt = `# ${brand}
> ${tagline}

## What we do
- ${category}

## Key pages
- ${base}/: What ${brand} is and who it's for
- ${base}/pricing: Plans and pricing
- ${base}/about: Company and team

## Facts AI can cite
- Official site: ${base}
- Category: ${category}
`;

  const jsonLd = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "${brand}",
  "url": "${base}",
  "description": "${tagline.replace(/"/g, "'")}"
}
</script>`;

  return (
    <section className="space-y-5">
      <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Copy-paste fixes</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <CodeCard
          icon={<FileText className="h-4 w-4" />}
          title="llms.txt"
          note={`Serve at ${base}/llms.txt — a curated map AI crawlers read first.`}
          code={llmsTxt}
        />
        <CodeCard
          icon={<FileCode2 className="h-4 w-4" />}
          title="Organization schema"
          note="Paste into your homepage <head> so AI can extract who you are."
          code={jsonLd}
        />
      </div>
    </section>
  );
}

function CodeCard({
  icon,
  title,
  note,
  code,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  code: string;
}) {
  return (
    <div className="card overflow-hidden p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-iris/10 text-iris">{icon}</span>
          <h3 className="font-display text-base font-semibold">{title}</h3>
        </div>
        <p className="mt-1.5 text-xs text-ink/50">{note}</p>
        <pre className="mt-3 max-h-64 overflow-auto rounded-2xl bg-ink/[0.04] p-4 text-xs leading-relaxed text-ink/75">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
