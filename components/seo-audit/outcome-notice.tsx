import Link from "next/link";
import { ShieldAlert, Code } from "lucide-react";
import type { SeoAuditResult } from "@/lib/seo-audit/types";
import { SEO_BOT_UA } from "@/lib/seo-audit/types";
import { RerunLink } from "./rerun-link";

/* ============================================================
   两道前置门的解释卡。

   blocked:WAF / 挑战页 / 403 把爬虫拦在门外 —— 不出分、不放锁定卡,
   只说清楚原因、怎么把 AEOeyeBot 加白、然后重跑。给一个假分数比不给更糟。
   重跑提示只说真话(复审 C31):配额在开跑前就扣了,被拦的那次照样计数,
   所以不能承诺"不算额度";如实告诉用户规则生效要一会儿、免费强制重跑每站每小时 1 次。
   limited:入口页依赖 JS 渲染 —— 总分照出。文案必须与检查层(checks/onpage.ts)一致:
   title / meta description / lang 在原始 HTML 里,照常评;只有渲染后才存在的内容类检查
   (H1、标题层级、title/H1/slug 重合、图片 alt、薄内容、近重复、内链 nofollow)在空壳页上判 not measured。
   证书 / TLS 失败不是 blocked(分工契约第 4 条,复审 C20):它由 probe.entryError 承载,
   走 sec.https / sec.tls.expired 的 gate 出一份正常计分的报告 —— 这里没有、也不该有按 blocked.kind 分出的 TLS 分支,
   被拦说明里的"把 AEOeyeBot 加白"只给真正的防火墙 / 挑战页 / 403 / 429。
   ============================================================ */

export function OutcomeNotice({ result, id, unlocked }: { result: SeoAuditResult; id: string; unlocked: boolean }) {
  const outcome = result.meta.outcome;
  if (outcome === "blocked") {
    const b = result.probe.blocked;
    const kind =
      b?.kind === "challenge"
        ? "a bot challenge page"
        : b?.kind === "rate-limited"
          ? "rate limiting"
          : b?.kind === "forbidden"
            ? "a 403 Forbidden response"
            : "a firewall";
    return (
      <section className="card p-7 sm:p-9" aria-labelledby="blocked-title">
        <div className="relative z-10">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-coral-deep">
            <ShieldAlert className="h-3.5 w-3.5" /> No score this time
          </p>
          <h2 id="blocked-title" className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Your site&rsquo;s firewall blocked our crawler
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/65">
            We hit {kind} before we could fetch a single page, so any score would be fiction. This is not an SEO problem
            by itself — Googlebot is usually allow-listed where third-party crawlers are not.
          </p>
          {b?.evidence && (
            <p className="mt-3 rounded-2xl bg-ink/[0.03] p-3.5 font-mono text-xs leading-relaxed text-ink/60">{b.evidence}</p>
          )}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="surface p-5">
              <p className="text-sm font-semibold text-ink">1 · Allow-list the user agent</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/60">
                Allow user agents containing <span className="font-medium text-ink">AEOeyeBot</span> in your WAF / CDN
                (Cloudflare, Vercel Firewall, AWS WAF, Sucuri…). Our main one is:
              </p>
              <code className="mt-2 block break-all rounded-xl bg-paper-soft px-3 py-2 text-xs text-ink">{SEO_BOT_UA}</code>
              <p className="mt-2 text-xs text-ink/45">
                What it fetches and how politely: <Link href="/bot" className="text-iris hover:underline">aeoeye.com/bot</Link>
              </p>
            </div>
            <div className="surface p-5">
              <p className="text-sm font-semibold text-ink">2 · Re-run the audit</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/60">
                {unlocked
                  ? "Rules can take a minute to propagate, so give yours a moment before you re-run."
                  : "Rules can take a minute to propagate, so give yours a moment before you re-run — free re-runs are limited to one per hour per site."}
              </p>
              <p className="mt-3 text-sm">
                <RerunLink id={id} url={result.entryUrl} unlocked={unlocked} />
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (outcome === "limited") {
    return (
      <div className="surface flex items-start gap-3 p-4 sm:p-5" role="note">
        <Code className="mt-0.5 h-4 w-4 shrink-0 text-iris" />
        <div className="text-sm leading-relaxed text-ink/65">
          <p className="font-medium text-ink">This site renders its content with JavaScript.</p>
          <p className="mt-1">
            Our crawler reads raw HTML, the same first pass Google makes before rendering. Title, meta description and
            lang are still graded from it. Checks that need the rendered page — H1, heading order, title / H1 / slug
            overlap, image alt text, thin content, near-duplicates and internal nofollow links — are marked{" "}
            <span className="font-medium">not measured</span> on JavaScript-shell pages and don&rsquo;t count toward the
            score{result.meta.scoreNote ? ` (${result.meta.scoreNote})` : ""}.
          </p>
        </div>
      </div>
    );
  }
  return null;
}
