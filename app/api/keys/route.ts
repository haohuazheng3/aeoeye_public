import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { createApiKey, isApiOwner, revokeApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * API key 的创建与撤销。走的是**会话**认证(登录态),不是 API key 认证 ——
 * 拿 key 去造新 key 会让一把泄漏的 key 无限自我延续。
 */

const CreateBody = z.object({ name: z.string().max(60).optional() });

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isApiOwner(session.email)) {
    return NextResponse.json({ error: "The API isn't open on this account yet." }, { status: 403 });
  }

  const body = CreateBody.safeParse(await req.json().catch(() => ({})));
  const name = body.success ? body.data.name : undefined;

  const key = await createApiKey({
    userId: session.userId,
    email: session.email,
    name: name?.trim() || "Default key",
  });

  // plaintext 只在这一次响应里出现,库里存的是 sha256
  return NextResponse.json(
    { id: key.id, key: key.plaintext, prefix: key.prefix },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing key id." }, { status: 400 });

  const ok = await revokeApiKey(session.userId, id);
  return NextResponse.json({ revoked: ok }, { status: ok ? 200 : 404 });
}
