"use client";

import dynamic from "next/dynamic";
import type { RunnerConfig } from "@/lib/content/tool-pages";
import { ToolRunner } from "./runner/tool-runner";

/* 首屏工具槽:按 content/tools/<slug>.json 的 runner.component 选组件。
   纯前端工具按需分包加载(每页只下载自己的那一个),服务端渲染照常输出首屏 HTML。 */

const SerpEditor = dynamic(() => import("./client/serp-editor").then((m) => m.SerpEditor));
const MetaGenerator = dynamic(() => import("./client/meta-generator").then((m) => m.MetaGenerator));
const SlugGenerator = dynamic(() => import("./client/slug-generator").then((m) => m.SlugGenerator));
const IndexNowTool = dynamic(() => import("./client/indexnow-tool").then((m) => m.IndexNowTool));
const OgImageGenerator = dynamic(() => import("./client/og-image-generator").then((m) => m.OgImageGenerator));
const FaviconGenerator = dynamic(() => import("./client/favicon-generator").then((m) => m.FaviconGenerator));
const SeoChecklist = dynamic(() => import("./client/seo-checklist").then((m) => m.SeoChecklist));
const SeoReportTemplate = dynamic(() => import("./client/seo-report-template").then((m) => m.SeoReportTemplate));
const SitemapExamples = dynamic(() => import("./client/sitemap-examples").then((m) => m.SitemapExamples));
const AiAuditSlot = dynamic(() => import("./client/ai-audit-slot").then((m) => m.AiAuditSlot));

export function ToolSlot({ config, slug }: { config: RunnerConfig; slug: string }) {
  switch (config.component) {
    case "runner":
      return (
        <ToolRunner
          tool={config.tool}
          submitLabel={config.submitLabel}
          fields={config.fields}
          extra={config.extra}
          examples={config.examples}
          busyText={config.busyText}
          footnote={config.footnote}
        />
      );
    case "serp-editor":
      return <SerpEditor />;
    case "meta-generator":
      return <MetaGenerator />;
    case "slug-generator":
      return <SlugGenerator />;
    case "indexnow":
      return <IndexNowTool />;
    case "og-image-generator":
      return <OgImageGenerator />;
    case "favicon-generator":
      return <FaviconGenerator />;
    case "seo-checklist":
      return <SeoChecklist />;
    case "seo-report":
      return <SeoReportTemplate />;
    case "sitemap-examples":
      return <SitemapExamples />;
    case "ai-audit":
      return <AiAuditSlot source={`tool-${slug}`} />;
    default:
      return null;
  }
}
