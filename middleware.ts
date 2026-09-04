import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// /dashboard 与 /account(个人设置中心,含 API 控制台)需要登录;未登录会被 Clerk 重定向到登录页(NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login)
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/account(.*)"]);

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
