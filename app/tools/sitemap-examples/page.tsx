import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { SitemapExamples } from "@/components/tools/client/sitemap-examples";

// 纯前端工具页:内容来自 content/tools/sitemap-examples.json,只打包本页这一个工具
const SLUG = "sitemap-examples";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <SitemapExamples />
    </ToolPageView>
  );
}
