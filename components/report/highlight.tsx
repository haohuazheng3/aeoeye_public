import { Fragment } from "react";

/**
 * "荧光笔"文本高亮:AI 回答原文里,你的品牌涂 mint、竞品涂 coral。
 * 纯函数渲染,服务端组件可直接用。
 */
export function HighlightedText({
  text,
  brand,
  competitors = [],
}: {
  text: string;
  brand: string;
  competitors?: string[];
}) {
  const marks: { name: string; tone: "brand" | "rival" }[] = [];
  if (brand?.trim().length >= 2) marks.push({ name: brand.trim(), tone: "brand" });
  for (const c of competitors) {
    const n = (c || "").trim();
    if (n.length >= 3 && n.toLowerCase() !== brand.toLowerCase()) marks.push({ name: n, tone: "rival" });
  }
  if (!marks.length || !text) return <>{text}</>;

  // 长名优先匹配,避免 "Photofeeler Pro" 被 "Photofeeler" 截断
  const sorted = [...marks].sort((a, b) => b.name.length - a.name.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 词边界:短品牌名不能命中更长的词(如 "Cal" 不该点亮 "Calendly")
  const re = new RegExp(`\\b(${sorted.map((m) => esc(m.name)).join("|")})\\b`, "gi");
  const toneOf = (part: string): "brand" | "rival" | null => {
    const p = part.toLowerCase();
    const hit = sorted.find((m) => m.name.toLowerCase() === p);
    return hit?.tone ?? null;
  };

  return (
    <>
      {text.split(re).map((part, i) => {
        const tone = i % 2 === 1 ? toneOf(part) : null;
        if (tone === "brand")
          return (
            <mark key={i} className="rounded-[0.3rem] bg-mint/25 px-1 py-0.5 font-semibold text-mint-deep">
              {part}
            </mark>
          );
        if (tone === "rival")
          return (
            <mark key={i} className="rounded-[0.3rem] bg-coral/15 px-1 py-0.5 font-medium text-coral-deep">
              {part}
            </mark>
          );
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
