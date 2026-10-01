"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { Menu, X, LayoutDashboard, Settings, Code2, LogIn } from "lucide-react";

/* ============================================================
   移动端页头菜单(汉堡)

   为什么单独成文件:SiteHeader 是 layout 里每页渲染的**服务端**组件,
   一旦它自己拿 useState 就得整个变客户端,122 个 SSG 页的页头都跟着水合。
   把状态收进这个小客户端子组件,页头其余部分保持服务端渲染、零 JS。

   形态:<1024px 时右侧多一颗玻璃圆钮(断点与 site-header 的 lg:flex 成对,复审 C29);展开后在胶囊页头**正下方**悬浮一块
   同配方的 glass-bar 面板(absolute,不推挤页面,桌面导航完全不受影响)。
   面板列出全部导航 + 登录态入口 + Free audit —— 390px 上此前只有 logo 和
   一颗按钮,SEO Audit 等入口在手机上根本不可达(走查早就指出的问题)。
   ============================================================ */

export function MobileMenu({ items }: { items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();

  // 路由变化即收起:用户点了菜单里的链接,新页面不该还顶着一块打开的面板
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape 关闭 —— 键盘用户的退出口
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const linkClass =
    "flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[15px] font-medium text-ink/75 transition hover:bg-white/60 hover:text-ink";

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/45 text-ink transition hover:bg-white/90"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/*
        面板挂在 .glass-bar(position: relative)之下:absolute + top-full,手机上宽度与胶囊页头对齐;
        768–1023px(复审 C29 后平板也走汉堡)胶囊宽到 ~1000px,整宽面板会把一列链接拉成长条,
        所以 md 起收成贴右的 20rem 悬浮模块。
        玻璃配方原是 30% 白 —— 页头悬在页面顶部空白处没问题,但菜单会盖在 H1 上,
        30% 白透出大标题后一行菜单都读不清(390px 实测),所以这里提到 90% 白、保留磨砂。
        不用 portal:header 本身 z-50,面板天然压在页面内容之上;关闭时直接不渲染,
        不留任何占位,桌面导航也感受不到它的存在(无布局位移)。
      */}
      {open && (
        <div
          id={panelId}
          className="glass-bar absolute inset-x-0 top-full z-50 mt-2 !rounded-[1.5rem] !bg-white/90 p-2 md:left-auto md:w-80"
          role="dialog"
          aria-label="Site menu"
        >
          <nav aria-label="Mobile" className="flex flex-col">
            {items.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={linkClass}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="my-2 border-t border-ink/[0.06]" />
          <div className="flex flex-col">
            <SignedOut>
              <Link href="/login" onClick={() => setOpen(false)} className={linkClass}>
                <LogIn className="h-4 w-4 text-ink/45" /> Sign in
              </Link>
            </SignedOut>
            <SignedIn>
              <Link href="/dashboard" onClick={() => setOpen(false)} className={linkClass}>
                <LayoutDashboard className="h-4 w-4 text-ink/45" /> Dashboard
              </Link>
              <Link href="/account" onClick={() => setOpen(false)} className={linkClass}>
                <Settings className="h-4 w-4 text-ink/45" /> Account settings
              </Link>
              <Link href="/account/api" onClick={() => setOpen(false)} className={linkClass}>
                <Code2 className="h-4 w-4 text-ink/45" /> API
              </Link>
            </SignedIn>
          </div>
          <div className="p-2 pt-3">
            <Link href="/#audit" onClick={() => setOpen(false)} className="btn-primary w-full justify-center py-3">
              Free audit
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
