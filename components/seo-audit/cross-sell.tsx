import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

/* 报告末尾的交叉销售:技术 SEO 健康 ≠ AI 会推荐你。这是本站的主产品,一句话带过去就够 */
export function CrossSell({ domain }: { domain?: string }) {
  return (
    <section className="card p-6 sm:p-8">
      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-iris">
            <Sparkles className="h-3.5 w-3.5" /> Add the AI visibility report
          </p>
          <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
            A healthy site is step one. Does ChatGPT recommend {domain ? domain : "you"}?
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink/55">
            This report checks whether search engines can crawl and rank you. The AI visibility audit asks ChatGPT,
            Claude, Gemini, Google AI and Perplexity the questions your buyers ask — and shows who they name instead.
          </p>
        </div>
        <Link href="/" className="btn-primary shrink-0 self-start sm:self-auto">
          Run the free AI audit <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
