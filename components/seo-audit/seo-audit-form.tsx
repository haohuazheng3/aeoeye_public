"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe, ArrowRight, Loader2, LogIn } from "lucide-react";
import { normalizeUrl } from "@/lib/utils";
import { fwEvent } from "@/components/flowglance";
import { FREE_CRAWL_PAGES } from "@/lib/seo-audit/types";

/* ============================================================
   SEO 审计入口表单。

   与首页 AuditForm 的区别:① 只收 URL/域名,不收品牌名(SEO 审计要抓真实站点);
   ② POST 只是**建行**(<1s 返回 id),真正的抓取在报告页上边跑边显示阶段进度 ——
   所以这里不做全屏 ScanOverlay,只给一个 "Starting your audit…" 的就地状态。

   匿名日配额用尽(401 requiresAuth,复审 C32):不再静默跳登录页 ——
   先把后端那句解释摆出来,再给一个 "Sign in to continue" 链接;输入的网址存进 sessionStorage,
   登录回到落地页时表单挂载即恢复。不走 ?url= 查询串:落地页读 searchParams 就会从静态渲染变成动态渲染。
   ============================================================ */

/** 登录前暂存的网址(同一标签页内有效;Clerk 登录 / 注册来回跳转后仍在) */
const PENDING_URL_KEY = "seoAuditPendingUrl";
/** 登录后回到落地页 —— 那里的表单一挂载就消费上面的暂存值 */
const SIGN_IN_HREF = "/login?redirect=/seo-audit";

function rememberPendingUrl(value: string) {
  const v = value.trim();
  if (!v) return;
  try {
    sessionStorage.setItem(PENDING_URL_KEY, v);
  } catch {
    /* 隐私模式 / 存储被禁:丢了就丢了,用户重新输入即可 */
  }
}

type Props = {
  source?: string;
  variant?: "hero" | "inline";
  cta?: string;
  placeholder?: string;
  /** 预填(报告失败页的重试);登录回来恢复网址走 sessionStorage,不走 ?url=(见文件头) */
  defaultValue?: string;
};

type ApiReply = { id?: string; reused?: boolean; error?: string; requiresAuth?: boolean; retryAfter?: number };

export function SeoAuditForm({
  source = "seo-audit",
  variant = "hero",
  cta = "Run free SEO audit",
  placeholder = "https://yourdomain.com",
  defaultValue = "",
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  /** 401 requiresAuth:错误下方给登录链接,主按钮不改成 "Try again"(再点只会再吃一次 401) */
  const [needsAuth, setNeedsAuth] = useState(false);

  // 登录回来:恢复刚才输入的网址。调用方已经预填(报告页重试)时不覆盖,也不消费暂存值。
  useEffect(() => {
    if (defaultValue) return;
    try {
      const saved = sessionStorage.getItem(PENDING_URL_KEY);
      if (saved) {
        sessionStorage.removeItem(PENDING_URL_KEY);
        setValue(saved);
      }
    } catch {
      /* 隐私模式:没有暂存值可恢复 */
    }
  }, [defaultValue]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const url = normalizeUrl(value);
    if (!url) {
      setError("Enter a full website address, like https://yourdomain.com");
      return;
    }
    setError("");
    setNeedsAuth(false);
    setPending(true);
    fwEvent("seo_audit_started", { source });
    try {
      const res = await fetch("/api/seo-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, source }),
      });
      // 网关超时/崩溃会返回非 JSON 文本 —— 先读文本再解析,任何异常都给干净提示
      const raw = await res.text();
      let data: ApiReply = {};
      try {
        data = raw ? (JSON.parse(raw) as ApiReply) : {};
      } catch {
        data = {};
      }

      if ((res.status === 200 || res.status === 201) && data.id) {
        router.push(`/seo-audit/${data.id}`);
        return;
      }
      if (res.status === 401 && data.requiresAuth) {
        // 匿名日配额用尽:说明原因 + 登录入口,不自动跳转;网址先存好,登录回来不用重填
        rememberPendingUrl(value);
        setNeedsAuth(true);
        setError(data.error || "You've used today's free audits from this network. Sign in to keep going.");
        return;
      }
      if (res.status === 403) {
        setError(data.error || "We can only audit public websites — private, local or blocked hosts are skipped.");
      } else if (res.status === 429) {
        const retry = res.headers.get("Retry-After");
        const mins = retry && /^\d+$/.test(retry) ? Math.max(1, Math.ceil(Number(retry) / 60)) : null;
        setError(
          data.error ||
            (mins
              ? `Too many audits right now. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`
              : "Too many audits right now. Please wait a few minutes and try again.")
        );
      } else if (res.status === 400) {
        setError(data.error || "That doesn't look like a valid website URL.");
      } else {
        setError(data.error || `We couldn't start this audit (${res.status}). Please try again.`);
      }
    } catch {
      setError("Network hiccup — please try again.");
    } finally {
      setPending(false);
    }
  }

  const isHero = variant === "hero";

  return (
    <form onSubmit={submit} className="w-full" aria-busy={pending}>
      <div
        className={`flex flex-col gap-2.5 sm:flex-row sm:items-stretch ${
          isHero ? "card !rounded-[1.9rem] p-2 focus-within:ring-2 focus-within:ring-iris/25 sm:!rounded-full" : ""
        }`}
      >
        <div className="relative flex-1">
          <Globe className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink/30" />
          <input
            type="text"
            inputMode="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            aria-label="Website URL"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            className={`w-full rounded-full py-4 pl-12 pr-4 text-base text-ink outline-none transition placeholder:text-ink/35 disabled:opacity-70 ${
              isHero ? "border-0 bg-transparent" : "rounded-2xl border border-paper-dim bg-white focus:border-iris"
            }`}
          />
        </div>
        <button type="submit" disabled={pending} className="btn-primary shrink-0 py-4 text-base sm:px-7">
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Starting your audit…
            </>
          ) : (
            <>
              {error && !needsAuth ? "Try again" : cta}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
      {error ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5" role="alert">
          <p className="text-sm font-medium text-coral-deep">{error}</p>
          {needsAuth && (
            <Link
              href={SIGN_IN_HREF}
              onClick={() => rememberPendingUrl(value)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-iris hover:underline"
            >
              <LogIn className="h-4 w-4" /> Sign in to continue
            </Link>
          )}
        </div>
      ) : (
        <p className="mt-2.5 text-xs text-ink/40">
          Free · no account · crawls up to {FREE_CRAWL_PAGES} pages and runs Google PageSpeed Insights. Usually 60–90
          seconds.
        </p>
      )}
    </form>
  );
}
