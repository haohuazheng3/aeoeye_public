import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Poppins } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { BgAurora } from "@/components/bg-aurora";
import { JsonLd } from "@/components/json-ld";
import { CookieConsent } from "@/components/cookie-consent";
import { ErrorReporter } from "@/components/error-reporter";
import { EventTracker } from "@/components/event-tracker";
import { FlowGlanceIdentity } from "@/components/flowglance";
import { organizationJsonLd, websiteJsonLd, softwareJsonLd } from "@/lib/seo";
import { site, siteUrl } from "@/lib/site";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // 标题模板不再追加品牌后缀,保证每页 <title> ≤60 且关键词靠前(品牌在 OG/Logo 体现)
  title: { default: `${site.name} — ${site.tagline}`, template: `%s` },
  description: site.description,
  applicationName: site.name,
  keywords: [
    "AI visibility",
    "AI search audit",
    "answer engine optimization",
    "AEO",
    "ChatGPT recommendations",
    "Perplexity visibility",
    "Google AI Overview",
    "brand visibility in AI",
    "generative engine optimization",
    "GEO",
  ],
  authors: [{ name: site.name }],
  creator: site.name,
  alternates: { canonical: siteUrl },
  openGraph: {
    type: "website",
    siteName: site.name,
    locale: site.locale,
    url: siteUrl,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  twitter: { card: "summary_large_image", creator: site.twitter },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#F6F7FB",
  width: "device-width",
  initialScale: 1,
};

const cf = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
    <html lang="en" className={poppins.variable}>
      <head>
        <meta name="p:domain_verify" content="6f536d2617be26812f839f0f7fa0637d" />
        <link rel="preconnect" href="https://images.pexels.com" />
        <link rel="dns-prefetch" href="https://images.pexels.com" />
        {/*
          FlowGlance —— 访客行为与浏览器端错误分析。
          data-site 是**公开**标识(本来就要出现在 HTML 里),不是密钥;
          真正的密钥是服务端的 account key 与 data token,都不在浏览器里。
          放在 <head> 且 defer:官方要求装在每页 head,defer 保证不阻塞渲染 ——
          代价是它执行之前抛出的错误看不到(spec 里明说的盲区)。
        */}
        <script defer src="https://flowglance.com/fw.js" data-site="fw_pub_0RhRIVhDYuA5HPAFW39ESEUf" />
      </head>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <BgAurora />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <CookieConsent />
        <ErrorReporter />
        <EventTracker />
        <FlowGlanceIdentity />
        <JsonLd data={[organizationJsonLd(), websiteJsonLd(), softwareJsonLd()]} />
        <Analytics />
        {cf ? (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={`{"token": "${cf}"}`}
          />
        ) : null}
      </body>
    </html>
    </ClerkProvider>
  );
}
