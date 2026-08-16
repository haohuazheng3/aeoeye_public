import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{md,mdx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.25rem",
      screens: { "2xl": "1180px" },
    },
    extend: {
      colors: {
        // 品牌色板 —— "the eye that watches your AI visibility"
        ink: {
          DEFAULT: "#0C0E16", // 近黑,英雄区背景 / 正文
          soft: "#161A28",
          muted: "#3A4055",
        },
        paper: {
          DEFAULT: "#F6F7FB", // 冷调亮白,配蒸汽磨砂背景
          soft: "#EEF1F7",
          dim: "#E2E6F0",
        },
        iris: {
          DEFAULT: "#6D5BF6", // 主色:电光靛蓝(虹膜 + AI)
          soft: "#8E80F8",
          deep: "#4B38D6",
        },
        mint: { DEFAULT: "#16C79A", deep: "#0E9E7B" }, // 正向:被推荐
        coral: { DEFAULT: "#FF5A6E", deep: "#E23A50" }, // 警示:缺席
        amber: { DEFAULT: "#F6A93B", deep: "#D9881A" },
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-poppins)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(12,14,22,0.04), 0 8px 30px rgba(12,14,22,0.06)",
        glow: "0 0 0 1px rgba(109,91,246,0.25), 0 12px 40px rgba(109,91,246,0.25)",
        // 悬浮模块阴影:0 偏移四向均匀光晕(上下左右等距延伸,不向下偏),范围大、色轻
        float: "0 0 2px rgba(12,14,22,0.05), 0 0 40px rgba(12,14,22,0.13)",
        "float-lg": "0 0 3px rgba(12,14,22,0.06), 0 0 56px rgba(12,14,22,0.16)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "scan-sweep": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(400%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        shimmer: "shimmer 1.6s infinite",
        "scan-sweep": "scan-sweep 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
