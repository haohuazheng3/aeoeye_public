/* ============================================================
   站内检查入口 —— 按 V2-0 的 7 个维度顺序拼接

   V2 取消了 Content Quality 维度(没有 content.ts):词数/薄页/近重复
   在 onpage.ts,通用锚文本在 architecture.ts,新鲜度在 crawlability.ts。
   ============================================================ */

import type { SeoCheck } from "../types";
import type { CheckContext } from "./helpers";
import { checkCrawlability } from "./crawlability";
import { checkOnPage } from "./onpage";
import { checkPerformance } from "./performance";
import { checkMobile } from "./mobile";
import { checkStructured } from "./structured";
import { checkSecurity } from "./security";
import { checkArchitecture } from "./architecture";

export type { CheckContext } from "./helpers";
export { checkCrawlability, checkOnPage, checkPerformance, checkMobile, checkStructured, checkSecurity, checkArchitecture };
/** 标题表(中性名 / 达标句 / 问题句):站内与付费检查共用,UI 或导出需要按 id 取名时从这里拿 */
export { CHECK_TITLES, checkTitle, checkName, type CheckTitle } from "./titles";

export function runAllOnsiteChecks(ctx: CheckContext): SeoCheck[] {
  return [
    ...checkCrawlability(ctx),
    ...checkOnPage(ctx),
    ...checkPerformance(ctx),
    ...checkMobile(ctx),
    ...checkStructured(ctx),
    ...checkSecurity(ctx),
    ...checkArchitecture(ctx),
  ];
}
