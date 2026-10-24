import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getToolPages, getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { ToolRunner } from "@/components/tools/runner/tool-runner";

/* 服务端检查器类工具页(runner)。纯前端工具各有自己的静态路由(app/tools/<slug>/page.tsx)。 */
export const dynamicParams = false;

export function generateStaticParams() {
  return getToolPages()
    .filter((p) => p.runner.component === "runner")
    .map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  return toolMetadata(params.slug);
}

export default function Page({ params }: { params: { slug: string } }) {
  const p = getToolPage(params.slug);
  if (!p || p.runner.component !== "runner") notFound();
  const r = p.runner;
  return (
    <ToolPageView p={p}>
      <ToolRunner tool={r.tool} submitLabel={r.submitLabel} fields={r.fields} extra={r.extra} examples={r.examples} busyText={r.busyText} footnote={r.footnote} />
    </ToolPageView>
  );
}
