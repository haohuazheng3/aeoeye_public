"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

export function ShareButton() {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: "My AI visibility audit", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }
  return (
    // 移动端只留图标:带文字时和 PDF 按钮一起占满 200px,把 eyebrow 挤成三行
    <button onClick={share} aria-label="Share this report" className="btn-ghost px-3 py-2 text-sm sm:px-4">
      {copied ? <Check className="h-4 w-4 text-mint" /> : <Share2 className="h-4 w-4" />}
      <span className="hidden sm:inline">{copied ? "Copied" : "Share"}</span>
    </button>
  );
}
