"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { PROFILES_HREF } from "./ranking-meta";

/* ============================================================
   "Scored as: Online store" —— 排名板块标题旁的站点类型胶囊(规格 v2 §1)。

   支柱权重随站点类型变,买家需要知道"为什么我的技术分占 15%"。原因一句话放在弹层里:
   桌面悬停即看,手机点一下展开(iOS Safari 点按钮不给焦点,纯 CSS 的 focus-within 方案在手机上打不开,
   所以用状态控制)。弹层里给一个链接去方法论页的权重表(#ranking-profiles)。
   点外面 / Esc 关闭;点过一次就"钉住",鼠标移开也不收起,再点一次收起。
   ============================================================ */

export function ProfileChip({ label, reason }: { label: string; reason: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
    };
    const onPointer = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex max-w-full"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          // 手机上点按会先模拟 mouseenter(已打开、未钉住)→ 这里钉住;再点一次才收起
          const next = !(open && pinned);
          setPinned(next);
          setOpen(next);
        }}
        className="chip max-w-full gap-1.5 px-3 py-1 text-xs font-normal text-ink/55 transition hover:bg-white/80"
      >
        <span className="shrink-0">Scored as:</span>
        <span className="min-w-0 truncate font-semibold text-ink/80">{label}</span>
        <Info className="h-3.5 w-3.5 shrink-0 text-ink/35" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="region"
          aria-label={`Why this report is scored as ${label}`}
          className="absolute left-0 top-full z-30 mt-2 block w-[min(18rem,calc(100vw-2.5rem))] rounded-2xl border border-white/70 bg-white p-3.5 text-left text-xs leading-relaxed text-ink/65 shadow-float-lg"
        >
          {/* ranking.ts 的 reason 去掉了句末标点;单独成段时补一个句号 */}
          {reason ? <span className="block">{/[.!?…]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`}</span> : null}
          <span className="mt-1.5 block text-ink/45">Pillar weights change with the type of site.</span>
          <Link href={PROFILES_HREF} className="mt-2 inline-block font-medium text-iris hover:underline">
            See the weights for each site type
          </Link>
        </span>
      )}
    </span>
  );
}
