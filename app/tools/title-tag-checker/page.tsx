import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { SerpEditor } from "@/components/tools/client/serp-editor";

// 纯前端工具页:内容来自 content/tools/title-tag-checker.json,只打包本页这一个工具
const SLUG = "title-tag-checker";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <SerpEditor />
    </ToolPageView>
  );
}
