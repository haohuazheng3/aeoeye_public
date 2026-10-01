"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

/**
 * 三档定价:免费审计 + $29 一次性完整 AI 可见度报告 + $10 一次性完整 SEO 报告(2026-09-30 新增)。
 *
 * Pro 订阅已下线 —— 目前只做完整报告这一个付费产品,所以这里没有计费周期切换、
 * 没有登录门槛(完整报告支持匿名购买),也不再调用 /api/checkout:
 * 完整报告必须先跑出一份审计才能解锁,入口统一回到首页的审计框。
 */
export function PricingPlans() {
  const router = useRouter();
  const toAudit = () => router.push("/#audit");
  const toSeoAudit = () => router.push("/seo-audit");

  return (
    <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <Plan
        name="Free audit"
        price="$0"
        tagline="See where you stand, instantly."
        cta="Run free audit"
        onClick={toAudit}
        features={[
          "AI visibility score & grade",
          "3 buyer questions asked to ChatGPT, live",
          "The real answers, in full",
          "Competitors AI recommends instead",
          "Starter fix recommendations",
        ]}
      />

      <Plan
        name="Full report"
        highlighted
        price="$29"
        priceSuffix="one-time"
        tagline="The complete picture for one brand."
        cta="Run an audit to unlock"
        onClick={toAudit}
        features={[
          "Everything in Free",
          "Adds Claude, Gemini, Google AI & Perplexity",
          "10 buyer questions instead of 3",
          // 只承诺档位,不点名型号 —— 模型会换代,承诺不该跟着过期
          "Re-analysed by our most capable model",
          "5-layer SEO foundation audit",
          "Full fix roadmap, PDF emailed to you",
        ]}
      />

      {/* 第二个付费产品:技术 SEO 深审。与 $29 的分工写清楚 —— $29 回答"AI 推不推荐你",$10 回答"Google 能不能抓、抓了排不排" */}
      <Plan
        name="SEO report"
        price="$10"
        priceSuffix="one-time"
        tagline="Technical SEO score, with every fix."
        cta="Run free SEO audit"
        onClick={toSeoAudit}
        features={[
          "Free: score across 7 dimensions, top issues",
          "Every check with evidence and page-level fixes",
          "Backlinks, rankings and competitors (DataForSEO)",
          "Prioritized roadmap and page-by-page table",
          "Re-run free for 30 days after fixes",
        ]}
      />
    </div>
  );
}

function Plan({
  name,
  price,
  priceSuffix,
  tagline,
  features,
  cta,
  onClick,
  highlighted,
}: {
  name: string;
  price: string;
  priceSuffix?: string;
  tagline: string;
  features: string[];
  cta: string;
  onClick: () => void;
  highlighted?: boolean;
}) {
  return (
    <div className={`card relative flex flex-col p-7 ${highlighted ? "ring-1 ring-iris/30" : ""}`}>
      <h3 className="font-display text-lg font-semibold">{name}</h3>
      <p className="mt-1 text-sm text-ink/55">{tagline}</p>
      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-semibold">{price}</span>
        {priceSuffix && <span className="text-sm text-ink/50">{priceSuffix}</span>}
      </div>
      <ul className="mt-6 flex-1 space-y-3 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-mint" /> <span className="text-ink/75">{f}</span>
          </li>
        ))}
      </ul>
      <button onClick={onClick} className={`mt-7 ${highlighted ? "btn-primary" : "btn-ghost"} w-full`}>
        {cta}
      </button>
    </div>
  );
}
