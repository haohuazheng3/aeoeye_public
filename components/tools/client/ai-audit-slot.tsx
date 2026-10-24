"use client";

import { AuditForm } from "@/components/audit-form";

/** AI 可见度检查器首屏:直接就是主产品的免费审计表单(3 个买家问题 × ChatGPT) */
export function AiAuditSlot({ source }: { source: string }) {
  return (
    <div className="rounded-3xl bg-white p-4 shadow-float sm:p-6">
      <AuditForm source={source} placeholder="yourbrand.com or “Your Brand”" cta="Check my AI visibility" />
      <ul className="mt-4 grid gap-2 text-xs text-ink/55 sm:grid-cols-3">
        <li className="rounded-xl bg-paper-soft px-3 py-2"><strong className="text-ink/75">3 buyer questions</strong> written for your category</li>
        <li className="rounded-xl bg-paper-soft px-3 py-2"><strong className="text-ink/75">Asked to ChatGPT</strong> on the free default model, not a tuned one</li>
        <li className="rounded-xl bg-paper-soft px-3 py-2"><strong className="text-ink/75">Full answers shown</strong> — who got named instead of you</li>
      </ul>
    </div>
  );
}
