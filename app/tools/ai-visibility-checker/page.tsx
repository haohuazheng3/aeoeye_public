import { getToolPage } from "@/lib/content/tool-pages";
import { ToolPageView, toolMetadata } from "@/components/tools/tool-page-view";
import { AiAuditSlot } from "@/components/tools/client/ai-audit-slot";

// 纯前端工具页:内容来自 content/tools/ai-visibility-checker.json,只打包本页这一个工具
const SLUG = "ai-visibility-checker";
export const metadata = toolMetadata(SLUG);

export default function Page() {
  return (
    <ToolPageView p={getToolPage(SLUG)!}>
      <AiAuditSlot source="tool-ai-visibility-checker" />
    </ToolPageView>
  );
}
