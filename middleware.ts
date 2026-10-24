import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { CONTENT_SECTIONS, RETIRED_GONE } from "@/lib/content/retired";

// /dashboard 与 /account(个人设置中心,含 API 控制台)需要登录;未登录会被 Clerk 重定向到登录页(NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login)
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/account(.*)"]);

// 2026-10-24 上午停做 SEO 内容时,整个内容栏目树一律 410;同日下午 SEO 底座 v2 重启,只重开 /blog(决策页)。
// 其余老栏目(answers / guides / compare / vs / alternatives / for / glossary)仍整树 410。
// /blog 下:老分类页与分页整树 410;单篇文章按 content/retired.json 逐条 410,新文章正常渲染,不存在的 slug 走 404。
// 合并条目(含指向新工具页的同意图旧 URL)由 next.config 的 301 先于 middleware 处理。
const RETIRED_TREE = new RegExp(`^/(?:${CONTENT_SECTIONS.filter((s) => s !== "blog").join("|")})(?:/.*)?$`, "i");
const RETIRED_BLOG_TREE = /^\/blog\/(?:category|page|tag|author)(?:\/.*)?$/i;

const GONE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>This page was retired — AEOeye</title><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#0c0e16;line-height:1.5}a{color:#5b5bd6}</style></head><body><h1>This page was retired</h1><p>This article is no longer published. AEOeye checks whether ChatGPT, Claude, Gemini, Google AI and Perplexity recommend your brand — and whether Google can crawl your site.</p><p><a href="/">Run a free AI visibility audit</a> · <a href="/tools">Free SEO &amp; AEO tools</a></p></body></html>`;

export default clerkMiddleware(async (auth, req) => {
  // Some referrers percent-encode Chrome text fragments into the pathname
  // (`/post%23:~:text=...`). Next then treats the fragment as part of the
  // dynamic slug and renders a soft-404/Suspense recovery page. Strip only
  // this malformed suffix; correctly formed `#:~:text=` fragments never
  // reach the server and are unaffected.
  const textFragmentIndex = req.nextUrl.pathname.toLowerCase().indexOf("%23:~:text=");
  if (textFragmentIndex > 0) {
    const canonicalUrl = req.nextUrl.clone();
    canonicalUrl.pathname = req.nextUrl.pathname.slice(0, textFragmentIndex);
    canonicalUrl.hash = "";
    return NextResponse.redirect(canonicalUrl, 308);
  }

  // 清理下线的内容页(2026-09-24 博客、2026-10-03 起覆盖全部内容栏目):直接 410。404 也能让 Google 移除,
  // 但 410 更快、也更诚实 —— 这页是有意删掉的,不是坏了。已合并的页由 next.config 的 301 处理(先于 middleware)。
  const path = req.nextUrl.pathname;
  if (RETIRED_TREE.test(path) || RETIRED_BLOG_TREE.test(path) || RETIRED_GONE.has(path.toLowerCase().replace(/\/$/, ""))) {
    return new NextResponse(GONE_HTML, {
      status: 410,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", "x-robots-tag": "noindex" },
    });
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // 跳过 Next 内部与静态资源;其余页面与 API 都经过 Clerk(使 auth() 在路由处理器中可用)
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
