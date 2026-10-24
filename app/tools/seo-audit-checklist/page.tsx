import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { SeoChecklist } from "@/components/tools/client/seo-checklist";

// 纯前端工具页:内容来自 content/tools/seo-audit-checklist.json,只打包本页这一个工具
const SLUG = "seo-audit-checklist";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <SeoChecklist />
    </ToolPageView>
  );
}
