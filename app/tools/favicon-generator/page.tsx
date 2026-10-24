import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { FaviconGenerator } from "@/components/tools/client/favicon-generator";

// 纯前端工具页:内容来自 content/tools/favicon-generator.json,只打包本页这一个工具
const SLUG = "favicon-generator";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <FaviconGenerator />
    </ToolPageView>
  );
}
