/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PDF 报告用 Poppins 复刻站点字体 —— TTF 是运行时按路径读取的,
  // 必须显式告诉 Vercel 把字体文件打进这些函数,否则线上 Font.register 找不到文件。
  outputFileTracingIncludes: {
    "/api/audit/**": ["./lib/pdf/fonts/**"],
    "/api/webhooks/**": ["./lib/pdf/fonts/**"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "img.clerk.com" },
    ],
  },
  async redirects() {
    return [
      // 第四轮:删减稀释页面后,301 到最贴近的相关页,避免死链
      {
        source: "/compare/chatgpt-vs-perplexity-vs-gemini",
        destination: "/compare/perplexity-vs-chatgpt-for-brand-visibility",
        permanent: true,
      },
      { source: "/for/local-business", destination: "/for", permanent: true },
    ];
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      // ⚠️ 装任何第三方脚本都必须同时改这里和 connect-src,否则脚本会被 CSP 静默
      // 拦掉:标签在 HTML 里、控制台只有一行 CSP 报错,后台一直显示"未安装",
      // 很容易被当成对方服务的问题查半天(FlowGlance 就这么栽过一次)。
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.aeoeye.com https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com https://static.cloudflareinsights.com https://va.vercel-scripts.com https://flowglance.com https://*.flowglance.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // flowglance 要连**主域和子域**:fw.js 与配置在 flowglance.com,
      // 但事件上报发往 collect.flowglance.com —— 只放行主域的话,脚本跑得起来、
      // 配置也拉得到,唯独一条数据都传不出去(实测控制台报的就是 collect 子域被拦)。
      "connect-src 'self' https://*.aeoeye.com https://*.clerk.accounts.dev https://*.clerk.com https://api.aeoeye.com https://cloudflareinsights.com https://*.vercel-insights.com https://vitals.vercel-insights.com https://flowglance.com https://*.flowglance.com",
      "frame-src 'self' https://*.aeoeye.com https://*.clerk.accounts.dev https://challenges.cloudflare.com https://js.stripe.com https://checkout.stripe.com",
      "worker-src 'self' blob: https://*.aeoeye.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
