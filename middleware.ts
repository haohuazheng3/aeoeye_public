import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /dashboard 与 /account(个人设置中心,含 API 控制台)需要登录;未登录会被 Clerk 重定向到登录页(NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login)
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/account(.*)"]);

export default clerkMiddleware(async (auth, req) => {
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
