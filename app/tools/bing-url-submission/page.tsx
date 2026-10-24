import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { IndexNowTool } from "@/components/tools/client/indexnow-tool";

// 纯前端工具页:内容来自 content/tools/bing-url-submission.json,只打包本页这一个工具
const SLUG = "bing-url-submission";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <IndexNowTool />
    </ToolPageView>
  );
}
