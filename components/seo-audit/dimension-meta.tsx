import { Search, FileText, Gauge, Smartphone, Braces, ShieldCheck, Link2, Trophy, Eye, Users } from "lucide-react";
import type { DimensionId } from "@/lib/seo-audit/types";

/** 每个维度一个图标 —— 十张卡先在视觉上分得开,再谈内容(与地基层 MODULE_ICON 同思路) */
export const DIMENSION_ICON: Record<DimensionId, typeof Search> = {
  crawlability: Search,
  onpage: FileText,
  performance: Gauge,
  mobile: Smartphone,
  structured: Braces,
  security: ShieldCheck,
  architecture: Link2,
  authority: Trophy,
  visibility: Eye,
  competitors: Users,
};

/** 等级徽章配色:A/B 正向、C 中性、D/F 警示 —— amber 克制不用(设计基因:色彩精简) */
export function gradeChip(grade: string | null | undefined): string {
  if (grade === "A" || grade === "B") return "bg-mint/10 text-mint-deep";
  if (grade === "C") return "bg-ink/[0.05] text-ink/60";
  if (grade === "D" || grade === "F") return "bg-coral/10 text-coral-deep";
  return "bg-ink/[0.05] text-ink/45";
}

/** "2 min ago" —— 报告头部时间戳;服务端计算,避免水合不一致 */
export function timeAgo(input: Date | string | number | null | undefined): string {
  if (!input) return "";
  const t = typeof input === "object" ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
