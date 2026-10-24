import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { MetaGenerator } from "@/components/tools/client/meta-generator";

// 纯前端工具页:内容来自 content/tools/meta-tag-generator.json,只打包本页这一个工具
const SLUG = "meta-tag-generator";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <MetaGenerator />
    </ToolPageView>
  );
}
