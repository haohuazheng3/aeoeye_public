import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 轻量登录态查询(供前端判断是否已登录)。 */
export async function GET() {
  const { userId } = await auth();
  return NextResponse.json(
    { user: userId ? { signedIn: true } : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
