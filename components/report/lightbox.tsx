"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Maximize2 } from "lucide-react";

/* ============================================================
   灯箱 —— 报告里"还有更多内容"的统一出口

   为什么不用原地展开:报告是长页面,原地展开会把下方内容一次推走几百像素,
   用户读完还得找回原来的位置。灯箱把长内容抬到一个安静的层里,关掉就回到原处。

   两条硬要求(站长 2026-08-10):
   1. **必须让人看出来能点** —— 卡片上要有明确的文字与视觉提示,
      否则用户以为这就是全部,根本不会去点;
   2. 折叠态的摘录要短(1-2 句),长段落留给灯箱。
   ============================================================ */

export function Lightbox({
  open,
  onClose,
  eyebrow,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Esc 关闭 + 打开时锁住背景滚动(否则滚轮会穿透到底层长报告上)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 焦点移进面板,键盘用户不会还停在背后的页面上
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* 背景:磨砂压暗,不是纯黑遮罩 —— 与全站玻璃语言一致,也不违反"不要黑色大块" */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-md"
      />
      {/*
        面板刻意**不用** .card。card 是 bg-white/30 的磨砂玻璃 —— 它悬浮在纸白页面上
        才显得亮;这里底下是压暗的遮罩,半透明会把暗色吸上来,整块看着发灰(站长
        2026-08-10 指出)。灯箱要的是实白纸面,玻璃语言留给页面里的模块。
      */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-[1.75rem] border border-white/70 bg-white shadow-float-lg outline-none sm:max-h-[82vh] sm:rounded-[1.75rem]"
      >
        <div className="relative z-10 flex items-start justify-between gap-4 border-b border-ink/[0.06] p-6 pb-4 sm:p-7 sm:pb-4">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h3 className="mt-1.5 font-display text-lg font-semibold leading-snug tracking-tight sm:text-xl">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.05] text-ink/50 transition hover:bg-ink/10 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative z-10 overflow-y-auto overscroll-contain p-6 pt-5 sm:p-7 sm:pt-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/**
 * 「点开看全部」的统一提示条。
 * 单独抽出来是因为**每一处可点的模块都必须有它** —— 站长明确说过,
 * 没有提示用户就以为没有更多内容了。文案由调用方给,形态全站一致。
 */
export function MoreAffordance({ label }: { label: string }) {
  return (
    <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-iris/[0.07] px-3 py-1.5 text-xs font-semibold text-iris transition group-hover:bg-iris/12">
      <Maximize2 className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

/**
 * 把长回答压成 1-2 句。
 *
 * 折叠态出现整段原文是站长明确指出的问题。按句子边界截 —— 硬截字符会把
 * 半个单词留在末尾,读起来像坏掉了。
 */
export function firstSentences(text: string, max = 2, hardCap = 190): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const parts = clean.match(/[^.!?]+[.!?]+(\s|$)/g);
  let out = parts ? parts.slice(0, max).join(" ").trim() : clean;
  // 没有标点的长句(列表式回答常见)按 hardCap 兜底,并退回最近的词边界
  if (out.length > hardCap) {
    out = out.slice(0, hardCap);
    const sp = out.lastIndexOf(" ");
    if (sp > hardCap * 0.6) out = out.slice(0, sp);
    out = `${out.trimEnd()}…`;
  } else if (parts && parts.length > max) {
    out = `${out} …`;
  }
  return out;
}

/** 受控灯箱的最小 hook —— 每个用到的模块都要自己的开关,免得共用一个串台 */
export function useLightbox(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  return [open, useCallback(() => setOpen(true), []), useCallback(() => setOpen(false), [])];
}
