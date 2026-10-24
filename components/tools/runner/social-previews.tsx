/* eslint-disable @next/next/no-img-element */
import type { SocialPreview } from "@/lib/tools/types";

/* ============================================================
   各平台链接预览卡片(近似渲染)。每个平台读取的标签与裁切方式不同:
   - Facebook / LinkedIn:og:*,大图约 1.91:1;
   - X:twitter:* 优先、回退 og:*;summary_large_image 是大图,summary 是左侧小方图;
   - Slack / Discord:左侧色条 + 站点名 + 标题 + 描述 + 图;
   - iMessage:大图 + 标题 + 域名。
   这是"大致长什么样"的示意,不是像素级复刻 —— 页面里写明了这一点。
   ============================================================ */

function Img({ src, ratio, className = "" }: { src: string | null; ratio: string; className?: string }) {
  if (!src) return <div className={`flex items-center justify-center bg-paper-dim text-xs text-ink/40 ${className}`} style={{ aspectRatio: ratio }}>no image</div>;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={`w-full object-cover ${className}`} style={{ aspectRatio: ratio }} />;
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n - 1) + "…" : s) : "");

function Facebook({ d }: { d: SocialPreview }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#dddfe2] bg-white">
      <Img src={d.image} ratio="1.91/1" />
      <div className="bg-[#f0f2f5] px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-[#65676b]">{d.host}</div>
        <div className="mt-0.5 text-[15px] font-semibold leading-snug text-[#050505]">{clip(d.title, 88) || d.url}</div>
        <div className="mt-0.5 text-[13px] text-[#65676b]">{clip(d.description, 110)}</div>
      </div>
    </div>
  );
}

function LinkedIn({ d }: { d: SocialPreview }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#e0dfdc] bg-white">
      <Img src={d.image} ratio="1.91/1" />
      <div className="px-3 py-2">
        <div className="text-[14px] font-semibold leading-snug text-[#000000e6]">{clip(d.title, 70) || d.url}</div>
        <div className="mt-0.5 text-[12px] text-[#00000099]">{d.host}</div>
      </div>
    </div>
  );
}

function X({ d }: { d: SocialPreview }) {
  const title = d.twitterTitle || d.title;
  const image = d.twitterImage || d.image;
  if (d.twitterCard === "summary") {
    return (
      <div className="flex overflow-hidden rounded-2xl border border-[#cfd9de] bg-white">
        <div className="w-28 shrink-0"><Img src={image} ratio="1/1" /></div>
        <div className="min-w-0 px-3 py-2">
          <div className="text-[13px] text-[#536471]">{d.host}</div>
          <div className="text-[15px] leading-snug text-[#0f1419]">{clip(title, 70)}</div>
          <div className="text-[13px] text-[#536471]">{clip(d.twitterDescription || d.description, 100)}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#cfd9de] bg-white">
      <Img src={image} ratio="1.91/1" />
      <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[12px] text-white">{clip(title, 60) || d.host}</span>
      <div className="px-3 py-1.5 text-[13px] text-[#536471]">From {d.host}</div>
    </div>
  );
}

function Slack({ d }: { d: SocialPreview }) {
  return (
    <div className="flex gap-3 rounded bg-white p-2">
      <div className="w-1 shrink-0 rounded bg-[#dddddd]" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#1d1c1d]">
          {d.favicon && <img src={d.favicon} alt="" className="h-4 w-4" />}
          {d.siteName || d.host}
        </div>
        <div className="text-[15px] font-bold text-[#1264a3]">{clip(d.title, 90)}</div>
        <div className="text-[15px] text-[#1d1c1d]">{clip(d.description, 160)}</div>
        {d.image && <div className="mt-2 max-w-[360px] overflow-hidden rounded"><Img src={d.image} ratio="1.91/1" /></div>}
      </div>
    </div>
  );
}

function Discord({ d }: { d: SocialPreview }) {
  return (
    <div className="max-w-[432px] rounded border-l-4 border-[#202225] bg-[#2f3136] p-3 text-white">
      <div className="text-[12px] text-[#b9bbbe]">{d.siteName || d.host}</div>
      <div className="mt-1 text-[16px] font-semibold text-[#00aff4]">{clip(d.title, 90)}</div>
      <div className="mt-1 text-[14px] text-[#dcddde]">{clip(d.description, 200)}</div>
      {d.image && <div className="mt-3 overflow-hidden rounded"><Img src={d.image} ratio="1.91/1" /></div>}
    </div>
  );
}

function IMessage({ d }: { d: SocialPreview }) {
  return (
    <div className="max-w-[300px] overflow-hidden rounded-2xl bg-[#e9e9eb]">
      <Img src={d.image} ratio="1.91/1" />
      <div className="px-3 py-2">
        <div className="text-[14px] font-semibold leading-snug text-black">{clip(d.title, 60)}</div>
        <div className="text-[12px] text-[#8e8e93]">{d.host}</div>
      </div>
    </div>
  );
}

const MAP: Record<string, { label: string; C: (p: { d: SocialPreview }) => JSX.Element; bg: string }> = {
  facebook: { label: "Facebook", C: Facebook, bg: "bg-white" },
  linkedin: { label: "LinkedIn", C: LinkedIn, bg: "bg-[#f4f2ee]" },
  x: { label: "X (Twitter)", C: X, bg: "bg-white" },
  slack: { label: "Slack", C: Slack, bg: "bg-white" },
  discord: { label: "Discord", C: Discord, bg: "bg-[#36393f]" },
  imessage: { label: "iMessage", C: IMessage, bg: "bg-white" },
};

export function SocialPreviews({ platforms, data }: { platforms: string[]; data: SocialPreview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {platforms.filter((p) => MAP[p]).map((p) => {
        const { label, C, bg } = MAP[p];
        return (
          <figure key={p} className="min-w-0">
            <figcaption className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink/45">{label}</figcaption>
            <div className={`rounded-2xl border border-paper-dim p-3 ${bg}`}><C d={data} /></div>
          </figure>
        );
      })}
    </div>
  );
}
