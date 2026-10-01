/**
 * 免费视图里 meta.lockedSections 的约定(V2-3):
 * 路线图只留三桶计数,形如 "roadmap:this_week=3,this_month=6,later=4"。
 * 解析失败返回 null —— 调用方回退到"没有数字"的文案,不显示 0。
 */
export function roadmapCounts(lockedSections: string[] | undefined): { this_week: number; this_month: number; later: number } | null {
  const raw = (lockedSections ?? []).find((s) => s.startsWith("roadmap:"));
  if (!raw) return null;
  const out = { this_week: 0, this_month: 0, later: 0 };
  let any = false;
  for (const part of raw.slice("roadmap:".length).split(",")) {
    const [k, v] = part.split("=");
    const n = Number(v);
    if ((k === "this_week" || k === "this_month" || k === "later") && Number.isFinite(n)) {
      out[k] = n;
      any = true;
    }
  }
  return any ? out : null;
}
