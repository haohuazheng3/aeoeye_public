import { Resend } from "resend";
import { env, features } from "./env";

/**
 * 交易邮件。未配置 RESEND_API_KEY 时**不静默假装成功** ——
 * 返回 skipped,让调用方能把"没发出去"如实记录下来。
 */
export type SendResult = { ok: boolean; skipped?: boolean; id?: string; error?: string };

let client: Resend | null = null;
function resend(): Resend | null {
  if (!features.email) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<SendResult> {
  const c = resend();
  if (!c) return { ok: false, skipped: true, error: "Email provider not configured (RESEND_API_KEY missing)." };
  const to = (args.to || "").trim();
  if (!to || !to.includes("@")) return { ok: false, error: "Invalid recipient." };
  try {
    const res = await c.emails.send({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
      to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      attachments: args.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    if (res.error) return { ok: false, error: res.error.message || "Send failed." };
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/* ============================================================
   报告投递邮件 —— 与站点 UI 同一套观感:纸白底、白卡、墨色标题、iris 主色。
   邮件客户端对 CSS 支持很差,故全部用内联样式 + 表格安全的简单结构,
   不用 flex/grid、不用背景图、不依赖外链资源。
   ============================================================ */
const C = { ink: "#0C0E16", muted: "#3A4055", faint: "#8A90A6", paper: "#F6F7FB", line: "#E2E6F0", iris: "#6D5BF6" };

export function reportEmailHtml(args: {
  brand: string;
  domain: string;
  score: number;
  grade: string;
  summary: string;
  reportUrl: string;
  engineCount: number;
}): string {
  const { brand, domain, score, grade, summary, reportUrl, engineCount } = args;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;">Your full AI visibility report for ${esc(brand)} — PDF attached.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};padding:28px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 6px 18px;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
      AEO<span style="color:${C.iris};">eye</span>
    </td></tr>
    <tr><td style="background:#fff;border:1px solid ${C.line};border-radius:16px;padding:26px 24px;">
      <p style="margin:0 0 4px;font:600 10px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:${C.iris};">Your full report is ready</p>
      <h1 style="margin:6px 0 2px;font:700 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">${esc(brand)}</h1>
      <p style="margin:0 0 16px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.faint};">${esc(domain)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
        <tr>
          <td style="background:${C.paper};border-radius:12px;padding:12px 16px;font:700 22px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
            ${score}<span style="font:400 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.faint};"> / 100 · Grade ${esc(grade)}</span>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 20px;font:400 14px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.muted};">${esc(summary)}</p>
      <a href="${esc(reportUrl)}" style="display:inline-block;background:${C.ink};color:#fff;text-decoration:none;border-radius:999px;padding:13px 26px;font:600 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Open the live report</a>
      <p style="margin:18px 0 0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.faint};">
        The complete PDF is attached — ${engineCount} engine${engineCount === 1 ? "" : "s"}, every buyer question, and your full fix roadmap.
      </p>
    </td></tr>
    <tr><td style="padding:16px 6px 0;font:400 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.faint};">
      You received this because you purchased this report on aeoeye.com.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function reportEmailText(args: {
  brand: string;
  score: number;
  grade: string;
  summary: string;
  reportUrl: string;
}): string {
  return [
    `Your full AI visibility report for ${args.brand} is ready.`,
    ``,
    `Score: ${args.score}/100 (Grade ${args.grade})`,
    ``,
    args.summary,
    ``,
    `Open the live report: ${args.reportUrl}`,
    `The complete PDF is attached.`,
    ``,
    `— AEOeye`,
  ].join("\n");
}

function esc(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
