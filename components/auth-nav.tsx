"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { LayoutDashboard, Settings, Code2 } from "lucide-react";

/**
 * 头像菜单。
 *
 * Clerk 的 <UserButton /> 默认只有它自己托管的两项(Manage account / Sign out)——
 * 我们的入口不塞进去,用户就找不到(站长 2026-08-10:"点头像找不到 API")。
 * UserButton.MenuItems 允许插入自定义项,顺序上放在 Clerk 自带项之前。
 *
 * 这里**不判断**是不是 API owner:那要读服务端 session,而 SiteHeader 在
 * layout 里每页渲染 —— 一旦调 auth() 就会把 122 个 SSG 页面全变成动态渲染。
 * 所以菜单统一进 /account,由那个页面(服务端)决定给谁看 API。
 */
export function AuthNav() {
  return (
    <>
      <SignedOut>
        <Link href="/login" className="btn-ghost hidden px-4 py-2 text-[13px] sm:inline-flex">
          Sign in
        </Link>
      </SignedOut>
      <SignedIn>
        <Link href="/dashboard" className="btn-ghost hidden gap-1.5 px-4 py-2 text-[13px] sm:inline-flex">
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </Link>
        <UserButton afterSignOutUrl="/">
          <UserButton.MenuItems>
            <UserButton.Link
              label="Account settings"
              labelIcon={<Settings className="h-4 w-4" />}
              href="/account"
            />
            <UserButton.Link label="API" labelIcon={<Code2 className="h-4 w-4" />} href="/account/api" />
            <UserButton.Link
              label="Dashboard"
              labelIcon={<LayoutDashboard className="h-4 w-4" />}
              href="/dashboard"
            />
          </UserButton.MenuItems>
        </UserButton>
      </SignedIn>
    </>
  );
}
