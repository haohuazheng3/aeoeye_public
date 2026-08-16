import { cn } from "@/lib/utils";

/**
 * AEOeye 标志:墨色液态玻璃方砖(与 btn-primary 同色)+ 星系(星球 + 轨道 + 卫星)。
 *
 * 几何要点:卫星圆心**精确落在轨道线上**(距中心 = 轨道半径 10),而不是飘在环外 ——
 * 白色卫星压断 iris 轨道线,才读得出"绕着转"的空间感。轨道线收细、星球放大,
 * 让主次分明;同时"环 + 实心中心点"仍保留 record 按钮的观感。
 */
const ORBIT_R = 11.5;
// 卫星落点:右上 45°,x = 24 + 10·cos45°,y = 24 − 10·sin45°
const SAT = { x: 24 + ORBIT_R * Math.SQRT1_2, y: 24 - ORBIT_R * Math.SQRT1_2 };
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("block h-8 w-8 shrink-0", className)} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="aeo-bg" x1="8" y1="2" x2="40" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#242a40" />
          <stop offset="0.62" stopColor="#0c0e16" />
        </linearGradient>
        <linearGradient id="aeo-iris" x1="14" y1="14" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8E80F8" />
          <stop offset="1" stopColor="#6D5BF6" />
        </linearGradient>
        <linearGradient id="aeo-sheen" x1="6" y1="3" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="14" fill="url(#aeo-bg)" />
      <rect x="2" y="2" width="44" height="44" rx="14" fill="url(#aeo-sheen)" />
      {/* 轨道:比原先细,退成背景元素 */}
      <circle cx="24" cy="24" r={ORBIT_R} stroke="url(#aeo-iris)" strokeWidth="2.2" />
      {/* 星球:比原先大,成为视觉重心 */}
      <circle cx="24" cy="24" r="5" fill="#FFFFFF" />
      {/* 卫星:骑在轨道线上,半径略大于线宽才能盖住线、产生"在前面"的层次 */}
      <circle cx={SAT.x} cy={SAT.y} r="2.7" fill="#FFFFFF" />
    </svg>
  );
}

export function LogoFull({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-[1.12rem] font-semibold leading-none tracking-tight", className)}>
      <LogoMark className={markClassName} />
      <span className="leading-none">
        AEO
        <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">eye</span>
      </span>
    </span>
  );
}
