import { auth, currentUser } from "@clerk/nextjs/server";

/**
 * 当前登录用户(基于 Clerk)。返回 { userId, email } 或 null。
 * 登录/注册完全由 Clerk 托管(仅邮箱验证码,无密码、无姓名)。
 * 保持此函数签名不变,使支付/审计/仪表盘等调用方无需改动。
 */
export async function getSessionUser(): Promise<{ userId: string; email: string } | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    "";
  return { userId, email };
}
