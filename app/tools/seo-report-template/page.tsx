import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { SeoReportTemplate } from "@/components/tools/client/seo-report-template";

// 纯前端工具页:内容来自 content/tools/seo-report-template.json,只打包本页这一个工具
const SLUG = "seo-report-template";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <SeoReportTemplate />
    </ToolPageView>
  );
}
