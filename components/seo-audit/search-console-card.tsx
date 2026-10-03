"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, Eye, LineChart, Loader2, RefreshCw } from "lucide-react";
import type { GscData } from "@/lib/seo-audit/types";
import { GSC_PRIVACY_LINE } from "./ranking-meta";

/* ============================================================
   Search Console 连接卡(规格 v2 §3.6;只出现在已解锁的完整报告里)。

   接口(F,集成方 2026-10-02 安全修订版):
     GET  /api/seo-audit/[id]/gsc → { connected, property, state: none|pending|verified|revoked, signedIn, canConnect,
                                     serviceAccountEmail?, token?, metaTag?, dnsTxt?, reason? }
          (邮箱 / token / metaTag / dnsTxt 只在 pending、verified 状态下发)
     POST { action: "intent" }     → 200 { ok, state: "pending", serviceAccountEmail, token, metaTag, dnsTxt }
     POST { action: "verify" }     → 200 { ok, state: "verified", property, message }
                                     或 409 { ok:false, code: token_not_found|no_property_access|expired|no_intent|report_busy, error }
     POST { action: "disconnect" } → 200
     401 requiresAuth / 403 / 429 / 503 都带 { error }。错误原样显示 —— 文案是服务端写给用户的英文。
   为什么要 meta 标签:任何人都能把 Search Console 属性共享给我们的服务账号,只有能改网站的人才能发布这个
   每次申请独有的标签 —— 与 Google 自己的站点所有权验证同一个道理(集成方安全修订)。
   状态:加载中 → 未登录(登录链接,回跳带 #search-console)→ 无权连接(服务端原因)
        → 未连接(三步概览 + 隐私一句 + Connect)→ pending(三个编号步骤:① meta 标签 / 折叠的 DNS 方案 ② 服务账号邮箱
        ③ Verify)→ verified(属性、最近同步、合计、Disconnect)。
   验证 / 断开成功后分数当场更新(不重跑):收到 200 就刷新服务端数据(router.refresh)。
   隐私:报告凭链接公开 —— 连接前就要写明"持链接者都能看到这里显示的 Search Console 数据"(规格 v2 §0)。
   ============================================================ */

export type GscState = "none" | "pending" | "verified" | "revoked";

export interface GscStatus {
  connected: boolean;
  property: string | null;
  serviceAccountEmail: string | null;
  state: GscState;
  signedIn: boolean;
  canConnect: boolean;
  /** 不能连接时服务端给的一句原因 */
  reason?: string | null;
  /** 站点验证:每次申请独有的 token、要放进首页 <head> 的 meta 标签、或 DNS TXT 记录值(pending / verified 才有) */
  token?: string | null;
  metaTag?: string | null;
  dnsTxt?: string | null;
}

type GscReply = Partial<GscStatus> & {
  ok?: boolean;
  error?: string;
  message?: string;
  code?: string;
  requiresAuth?: boolean;
};
type Action = "intent" | "verify" | "disconnect";

const GSC_STATES: readonly GscState[] = ["none", "pending", "verified", "revoked"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseStatus(d: GscReply): GscStatus {
  const state = GSC_STATES.includes(d.state as GscState) ? (d.state as GscState) : "none";
  return {
    connected: d.connected === true || state === "verified",
    property: str(d.property),
    serviceAccountEmail: str(d.serviceAccountEmail),
    state,
    signedIn: d.signedIn === true,
    canConnect: d.canConnect === true,
    reason: str(d.reason),
    token: str(d.token),
    metaTag: str(d.metaTag),
    dnsTxt: str(d.dnsTxt),
  };
}

export function useGscConnection(auditId: string) {
  const router = useRouter();
  const [status, setStatus] = useState<GscStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/seo-audit/${auditId}/gsc`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as GscReply;
      if (!alive.current) return;
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setStatus(parseStatus(data));
    } catch {
      if (alive.current) setLoadError(true);
    }
  }, [auditId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (action: Action) => {
      setBusy(action);
      setMessage(null);
      try {
        const res = await fetch(`/api/seo-audit/${auditId}/gsc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = (await res.json().catch(() => ({}))) as GscReply;
        if (!alive.current) return;
        const text = str(data.error) ?? str(data.message);
        const next = GSC_STATES.includes(data.state as GscState) ? (data.state as GscState) : null;
        if (res.status === 401) {
          setStatus((s) => (s ? { ...s, signedIn: false } : s));
          setMessage({ tone: "error", text: text ?? "Sign in to connect Search Console." });
          return;
        }
        if (!res.ok || data.ok === false) {
          // 409(标签没找到、属性没共享、申请过期…)与其他错误:服务端那句话原样显示,视图停在原状态
          if (next) setStatus((s) => (s ? { ...s, state: next, connected: next === "verified" ? s.connected : false } : s));
          setMessage({ tone: "error", text: text ?? "Something went wrong — please try again." });
          return;
        }
        const state: GscState = next ?? (action === "intent" ? "pending" : action === "verify" ? "verified" : "none");
        setStatus((s) =>
          s
            ? {
                ...s,
                state,
                connected: state === "verified",
                property: action === "disconnect" ? null : (str(data.property) ?? s.property),
                serviceAccountEmail: str(data.serviceAccountEmail) ?? s.serviceAccountEmail,
                token: str(data.token) ?? (action === "disconnect" ? null : s.token),
                metaTag: str(data.metaTag) ?? (action === "disconnect" ? null : s.metaTag),
                dnsTxt: str(data.dnsTxt) ?? (action === "disconnect" ? null : s.dnsTxt),
              }
            : s
        );
        if (action === "intent") {
          // 标签与邮箱随 intent 一起下发;万一没带,再取一次状态
          if (!str(data.metaTag) || !str(data.serviceAccountEmail)) void load();
          return;
        }
        setMessage({
          tone: "info",
          text:
            str(data.message) ??
            (action === "verify"
              ? "Connected. Your scores now use your Search Console data."
              : "Disconnected. Search Console data was removed from this report and your scores were updated."),
        });
        // 验证 / 断开后分数当场在服务端更新(不重跑):刷新服务端组件,板块里的分数与合计随之换新
        router.refresh();
      } catch {
        if (alive.current) setMessage({ tone: "error", text: "Network hiccup — please try again." });
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [auditId, load, router]
  );

  return { status, loadError, busy, message, load, act };
}

export function SearchConsoleCard({ auditId, domain, gsc }: { auditId: string; domain: string; gsc: GscData | null }) {
  const c = useGscConnection(auditId);
  return (
    <SearchConsoleView
      auditId={auditId}
      domain={domain}
      gsc={gsc}
      status={c.status}
      loadError={c.loadError}
      busy={c.busy}
      message={c.message}
      onRetry={() => void c.load()}
      onAction={(a) => void c.act(a)}
    />
  );
}

/* ---------------- 纯展示(每个状态都能直接服务端渲染核对) ---------------- */

export interface SearchConsoleViewProps {
  auditId: string;
  domain: string;
  gsc: GscData | null;
  /** null = 还在加载 */
  status: GscStatus | null;
  loadError?: boolean;
  busy?: Action | null;
  message?: { tone: "error" | "info"; text: string } | null;
  onRetry?: () => void;
  onAction?: (a: Action) => void;
}

export function SearchConsoleView(p: SearchConsoleViewProps) {
  const s = p.status;
  const connected = !!s && (s.state === "verified" || s.connected);
  // 加载中的标题不能与 eyebrow 重复("Search Console" 两遍);用一句对连上 / 没连上都成立的话
  const title = !s
    ? p.loadError
      ? "Couldn't check the connection"
      : "Real clicks from Google"
    : connected
      ? "Your real search data"
      : s.state === "pending" && s.signedIn && s.canConnect
        ? "Verify the site, then share it"
        : "Score your real clicks";

  return (
    <section id="search-console" aria-labelledby="gsc-title" className="card min-w-0 scroll-mt-28 p-6 sm:p-7">
      <div className="relative z-10 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <p className="eyebrow flex items-center gap-2">
            <LineChart className="h-3.5 w-3.5" aria-hidden="true" /> Search Console
          </p>
          {connected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-mint/10 px-2.5 py-0.5 text-[11px] font-semibold text-mint-deep">
              <Check className="h-3 w-3" aria-hidden="true" /> Connected
            </span>
          )}
        </div>
        <h3 id="gsc-title" className="mt-1.5 font-display text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h3>
        <div className="mt-2 min-w-0">
          <Body {...p} connected={connected} />
        </div>
        {p.message && (
          <p
            role={p.message.tone === "error" ? "alert" : "status"}
            className={`mt-3 break-words text-xs font-medium leading-relaxed ${p.message.tone === "error" ? "text-coral-deep" : "text-mint-deep"}`}
          >
            {p.message.text}
          </p>
        )}
      </div>
    </section>
  );
}

function Body(p: SearchConsoleViewProps & { connected: boolean }) {
  const s = p.status;
  const busy = p.busy ?? null;

  if (!s) {
    if (p.loadError) {
      return (
        <div className="text-sm leading-relaxed text-ink/60">
          <p>We couldn&rsquo;t load the Search Console status for this report.</p>
          <button
            type="button"
            onClick={p.onRetry}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-iris hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
          </button>
        </div>
      );
    }
    return (
      <p className="flex items-center gap-2 text-sm text-ink/45" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Checking the connection…
      </p>
    );
  }

  if (p.connected) return <Connected {...p} />;

  if (!s.signedIn) {
    const back = `/seo-audit/${p.auditId}#search-console`;
    return (
      <div className="text-sm leading-relaxed text-ink/65">
        <p>
          Connect Google Search Console (read-only) and we score click-through and momentum from your real clicks instead
          of estimates. Connecting needs a free sign-in, so the data stays tied to your account.
        </p>
        <Privacy />
        <Link href={`/login?redirect=${encodeURIComponent(back)}`} className="btn-ghost mt-4 px-4 py-2 text-sm">
          Sign in to connect
        </Link>
      </div>
    );
  }

  if (!s.canConnect) {
    return (
      <p className="text-sm leading-relaxed text-ink/60">
        {s.reason || "Only the account that unlocked this report can connect Search Console to it."}
      </p>
    );
  }

  if (s.state === "pending") return <Pending {...p} />;

  // 已登录、可连接、还没开始(none),或之前断开过(revoked)
  return (
    <div className="text-sm leading-relaxed text-ink/65">
      {s.state === "revoked" && (
        <p className="mb-2 text-xs text-ink/45">Search Console was disconnected from this report. You can connect it again.</p>
      )}
      <p>
        Read-only access lets us score click-through against the expected curve, ranking momentum and pages competing for the
        same query from your real data — instead of estimating them.
      </p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 marker:text-ink/35">
        <li>Press Connect — we create a verification tag that&rsquo;s unique to your request.</li>
        <li>
          Add the tag to your homepage (or a DNS record), and add our service account in Search Console as a Restricted
          user.
        </li>
        <li>Press Verify. We pull your last 28 days and your scores update straight away.</li>
      </ol>
      <Privacy />
      <button
        type="button"
        onClick={() => p.onAction?.("intent")}
        disabled={busy !== null}
        className="btn-primary mt-4 px-5 py-2.5 text-sm"
      >
        {busy === "intent" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Connect Search Console
      </button>
    </div>
  );
}

/** pending:三个编号步骤 —— ① 首页 meta 标签(或折叠的 DNS TXT)② 服务账号邮箱 ③ Verify */
function Pending(p: SearchConsoleViewProps) {
  const s = p.status!;
  const busy = p.busy ?? null;
  return (
    <div className="text-sm leading-relaxed text-ink/65">
      <ol className="space-y-5">
        <Step n={1} title="Prove you control the site">
          <p>
            Add this tag inside the <code className="rounded bg-paper-soft px-1 py-0.5 text-[12px]">&lt;head&gt;</code> of your
            homepage:
          </p>
          <CopyField value={s.metaTag} label="the meta tag" />
          {s.dnsTxt && (
            <details className="group mt-2 min-w-0">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-ink/55 hover:text-ink [&::-webkit-details-marker]:hidden">
                Use DNS instead
                <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-ink/55">
                Add a TXT record to <span className="font-medium text-ink">{p.domain}</span> with this value:
              </p>
              <CopyField value={s.dnsTxt} label="the DNS TXT record" />
            </details>
          )}
          <p className="mt-2 text-xs text-ink/45">You can remove the meta tag after verification.</p>
        </Step>
        <Step n={2} title="Share the property with us">
          <p>
            In Search Console → Settings → Users and permissions → Add user, paste this email and choose{" "}
            <span className="font-medium text-ink">Restricted</span>:
          </p>
          <CopyField value={s.serviceAccountEmail} label="the service account email" />
        </Step>
        <Step n={3} title="Verify">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => p.onAction?.("verify")}
              disabled={busy !== null}
              className="btn-primary px-5 py-2.5 text-sm"
            >
              {busy === "verify" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Verify
            </button>
            <button
              type="button"
              onClick={() => p.onAction?.("disconnect")}
              disabled={busy !== null}
              className="text-xs font-medium text-ink/50 hover:text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-ink/45">New users can take a minute to show up in Search Console — if it fails, wait and try again.</p>
        </Step>
      </ol>
      <Privacy />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-iris/10 text-xs font-semibold tabular-nums text-iris"
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">
          <span className="sr-only">Step {n}: </span>
          {title}
        </p>
        <div className="mt-1 min-w-0">{children}</div>
      </div>
    </li>
  );
}

function Privacy() {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-2xl bg-ink/[0.03] p-3 text-xs leading-relaxed text-ink/60">
      <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/40" aria-hidden="true" />
      <span>
        <span className="font-semibold text-ink/75">{GSC_PRIVACY_LINE}</span> Report links aren&rsquo;t listed anywhere,
        but they aren&rsquo;t private either — share yours the way you&rsquo;d share these numbers.{" "}
        <Link href="/seo-audit/how-we-score#search-console" className="font-medium text-iris hover:underline">
          What we read
        </Link>
      </span>
    </p>
  );
}

/** 一行可复制的值(meta 标签 / DNS 记录 / 服务账号邮箱);值还没到时给一句提示,不摆空框 */
function CopyField({ value, label }: { value: string | null | undefined; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return (
      <p className="mt-2 rounded-2xl bg-ink/[0.03] p-3 text-xs text-ink/50">
        Loading {label} — refresh if it doesn&rsquo;t appear.
      </p>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板被拒(非 https / 权限):值本身可选中,手动复制即可 */
    }
  };
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-2xl bg-white/60 p-2 pl-3.5 ring-1 ring-inset ring-ink/[0.06]">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[12px] text-ink">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink/[0.05] px-3 py-1.5 text-xs font-semibold text-ink/65 transition hover:bg-ink/10"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-mint-deep" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ---------------- 已连接:属性、最近同步、合计 ---------------- */

function fmtDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return "";
  // 纯日期按 UTC 解析,服务端与浏览器输出一致(避免水合差异)
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function int(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

/** 两期对比:变化百分比;前一期为 0 或缺失 → null */
function change(cur: number, prev: number | null | undefined): number | null {
  if (typeof prev !== "number" || !Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur)) return null;
  return ((cur - prev) / prev) * 100;
}

function Delta({ pct, lowerIsBetter = false }: { pct: number | null; lowerIsBetter?: boolean }) {
  if (pct === null || Math.abs(pct) < 0.5) return null;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${good ? "text-mint-deep" : "text-coral-deep"}`}>
      {pct > 0 ? "+" : "−"}
      {Math.abs(Math.round(pct))}%
    </span>
  );
}

function Connected(p: SearchConsoleViewProps & { connected: boolean }) {
  const s = p.status!;
  const g = p.gsc;
  const [confirm, setConfirm] = useState(false);
  const busy = p.busy ?? null;
  const property = g?.property || s.property;

  return (
    <div className="min-w-0 text-sm leading-relaxed text-ink/65">
      {property && (
        <p className="break-all font-mono text-[12px] text-ink/55" title="Search Console property">
          {property}
        </p>
      )}
      {g ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Clicks" value={int(g.totals.clicks)} delta={<Delta pct={change(g.totals.clicks, g.previous?.clicks)} />} />
            <Stat
              label="Impressions"
              value={int(g.totals.impressions)}
              delta={<Delta pct={change(g.totals.impressions, g.previous?.impressions)} />}
            />
            <Stat label="CTR" value={`${(g.totals.ctr * 100).toFixed(1)}%`} />
            <Stat
              label="Avg. position"
              value={g.totals.position.toFixed(1)}
              delta={<Delta pct={change(g.totals.position, g.previous?.position)} lowerIsBetter />}
            />
          </dl>
          <p className="mt-3 text-xs text-ink/45">
            {fmtDate(g.range.from)} – {fmtDate(g.range.to, true)}
            {g.previous ? " vs the 28 days before" : ""} · last synced {fmtDate(g.fetchedAt, true)}
          </p>
        </>
      ) : (
        <p className="mt-2">Connected — your Search Console data is on its way into this report. Refresh in a moment.</p>
      )}
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink/50">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/35" aria-hidden="true" /> {GSC_PRIVACY_LINE}
      </p>
      {s.canConnect &&
        (confirm ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="text-ink/60">Remove the Search Console data from this report? Your scores update right away.</span>
            <button
              type="button"
              onClick={() => p.onAction?.("disconnect")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 font-semibold text-coral-deep hover:underline disabled:opacity-60"
            >
              {busy === "disconnect" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />} Disconnect
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="font-medium text-ink/50 hover:text-ink">
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="mt-3 text-xs font-medium text-ink/45 hover:text-ink">
            Disconnect
          </button>
        ))}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: React.ReactNode }) {
  return (
    <div className="surface min-w-0 p-3">
      <dt className="text-[11px] font-semibold text-ink/50">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-display text-lg font-semibold tabular-nums text-ink">{value}</span>
        {delta}
      </dd>
    </div>
  );
}
