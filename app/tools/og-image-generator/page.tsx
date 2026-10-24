import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { OgImageGenerator } from "@/components/tools/client/og-image-generator";

// 纯前端工具页:内容来自 content/tools/og-image-generator.json,只打包本页这一个工具
const SLUG = "og-image-generator";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <OgImageGenerator />
    </ToolPageView>
  );
}
