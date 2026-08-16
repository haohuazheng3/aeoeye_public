import { env } from "@/lib/env";

// IndexNow key 验证文件(协议允许 keyLocation 指定任意 URL)
export function GET() {
  return new Response(env.INDEXNOW_KEY ?? "", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
