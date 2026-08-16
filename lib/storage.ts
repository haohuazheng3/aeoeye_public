import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env, features } from "./env";

let client: S3Client | null = null;

function r2(): S3Client | null {
  if (!features.r2 || !env.CLOUDFLARE_ACCOUNT_ID) return null;
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

/** 上传对象到 R2。未配置时返回 null(优雅降级)。 */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<string | null> {
  const c = r2();
  if (!c) return null;
  try {
    await c.send(
      new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType })
    );
    return env.R2_PUBLIC_URL ? `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}` : key;
  } catch (e) {
    console.error("r2 put failed", e);
    return null;
  }
}
