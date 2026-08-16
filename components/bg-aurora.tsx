/**
 * 蒸汽磨砂背景:多色光斑(蓝/紫/粉/青/黄/绿)+ 磨砂噪点颗粒。
 * fixed 定位——雾气固定在视口上,内容滚动时背景不动(浴室雾玻璃感);
 * 颜色轻微但可见,全部 radial-gradient + 静态噪点(零 filter 成本)。
 */
const FROST_NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function BgAurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          // 尺寸用视口百分比:手机上光斑等比缩小,不会叠加变浓
          // 色斑加浓:模块 backdrop-blur + 30% 白纱后,模块内外的色彩差异才肉眼可见
          background: [
            "radial-gradient(55% 50% at 14% -6%, rgba(147,197,253,0.58), transparent 66%)",
            "radial-gradient(52% 48% at 90% 0%, rgba(196,181,253,0.58), transparent 66%)",
            "radial-gradient(45% 42% at -4% 40%, rgba(249,168,212,0.46), transparent 64%)",
            "radial-gradient(46% 42% at 104% 48%, rgba(153,246,228,0.46), transparent 64%)",
            "radial-gradient(50% 45% at 4% 98%, rgba(253,224,71,0.36), transparent 64%)",
            "radial-gradient(46% 42% at 98% 98%, rgba(134,239,172,0.42), transparent 64%)",
            "radial-gradient(40% 34% at 50% 30%, rgba(255,255,255,0.45), transparent 72%)",
            "#F5F7FB",
          ].join(","),
        }}
      />
      {/* 手机端追加一层白纱,小屏色彩更收敛 */}
      <div className="absolute inset-0 bg-white/25 sm:hidden" />
      {/* 磨砂玻璃颗粒 —— 这层是模块磨砂感的关键:
          模块 backdrop-blur 把颗粒糊平,模块外颗粒清晰,内外对比 = 肉眼可见的磨砂 */}
      <div
        className="absolute inset-0 opacity-[0.26] mix-blend-overlay"
        style={{ backgroundImage: FROST_NOISE }}
      />
    </div>
  );
}
