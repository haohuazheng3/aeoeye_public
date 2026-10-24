import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { SlugGenerator } from "@/components/tools/client/slug-generator";

// 纯前端工具页:内容来自 content/tools/slug-generator.json,只打包本页这一个工具
const SLUG = "slug-generator";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <SlugGenerator />
    </ToolPageView>
  );
}
