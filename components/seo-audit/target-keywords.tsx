"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";

/* ============================================================
   用户自填目标关键词(规格 v2 §5)—— 免费报告的解锁卡里可选填(付款前保存),
   完整报告的 "What we compared against" 块里查看 / 修改。

   接口(集成方):GET  /api/seo-audit/[id]/keywords → { keywords, changesLeft, canEdit }(changesLeft 为 0 时 canEdit 也是 false)
                 PUT  /api/seo-audit/[id]/keywords { keywords } → { ok, keywords, changesLeft, rerunStarted, note? }
   为什么是"攒一批再保存"而不是每加一个词就自动存:每次改动都扣一次 changesLeft(≤3 次),
   一个个自动存会让用户还没付钱就把改动次数用光。
   "付款前保存":解锁按钮外包一层捕获阶段的点击守卫 —— 有没存的词就先存,存好再放行去 Stripe;
   存失败就把原因摆出来,用户再点一次即放行(关键词是可选项,不能因为它卡住付款)。
   ============================================================ */

export const TARGET_KEYWORDS_MAX = 3;
export const TARGET_KEYWORD_MAX_CHARS = 80;

/** 与服务端同一口径:折叠空白、去首尾空格、小写(服务端会再规范化一次,这里只为即时校验与去重) */
export function normalizeKeyword(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 校验一条要新增的词;合法返回 "" */
export function keywordError(kw: string, list: readonly string[]): string {
  if (!kw) return "";
  if (kw.length > TARGET_KEYWORD_MAX_CHARS) return `Keep each keyword to ${TARGET_KEYWORD_MAX_CHARS} characters or fewer.`;
  if (list.includes(kw)) return "That keyword is already on the list.";
  if (list.length >= TARGET_KEYWORDS_MAX) return `Up to ${TARGET_KEYWORDS_MAX} keywords per report.`;
  return "";
}

/** 把一段输入(可用逗号 / 换行分隔多个)并进列表;返回新列表与第一条错误 */
export function mergeKeywords(input: string, list: readonly string[]): { list: string[]; error: string; added: number } {
  const out = [...list];
  let error = "";
  let added = 0;
  for (const kw of input.split(/[,\n]/).map(normalizeKeyword).filter(Boolean)) {
    const e = keywordError(kw, out);
    if (e) {
      error = error || e;
      continue;
    }
    out.push(kw);
    added++;
  }
  return { list: out, error, added };
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const kw = typeof x === "string" ? normalizeKeyword(x) : "";
    if (kw && !out.includes(kw)) out.push(kw);
  }
  return out.slice(0, TARGET_KEYWORDS_MAX);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

type KeywordsReply = {
  ok?: boolean;
  keywords?: string[];
  changesLeft?: number;
  canEdit?: boolean;
  rerunStarted?: boolean;
  /** 存好了但没重跑时的原因("A run is already in progress…") */
  note?: string;
  error?: string;
};

export interface TargetKeywordsState {
  /** 服务端已保存的词 */
  saved: string[];
  /** 正在编辑的列表(未保存) */
  draft: string[];
  input: string;
  /** 剩余改动次数;null = 还不知道(GET 未返回 / 接口没给) */
  changesLeft: number | null;
  canEdit: boolean;
  /** 接口在线;GET 回 404/405(还没上线)时整块隐藏,不摆一个存不进去的输入框 */
  available: boolean;
  loaded: boolean;
  saving: boolean;
  error: string;
  notice: string;
}

export function initialKeywordsState(initial: readonly string[] = []): TargetKeywordsState {
  const list = cleanList(initial);
  return {
    saved: list,
    draft: list,
    input: "",
    changesLeft: null,
    canEdit: true,
    available: true,
    loaded: false,
    saving: false,
    error: "",
    notice: "",
  };
}

export function useTargetKeywords(auditId: string, initial: readonly string[] = []) {
  const router = useRouter();
  const [state, setState] = useState<TargetKeywordsState>(() => initialKeywordsState(initial));
  // 守卫 / flush 在点击回调里读"此刻"的状态 —— 闭包里的 state 可能是旧的
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/seo-audit/${auditId}/keywords`, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 404 || res.status === 405) {
          setState((p) => ({ ...p, available: false, loaded: true }));
          return;
        }
        const data = (await res.json().catch(() => ({}))) as KeywordsReply;
        if (!alive) return;
        if (!res.ok) {
          setState((p) => ({ ...p, loaded: true }));
          return;
        }
        const kws = cleanList(data.keywords);
        setState((p) => ({
          ...p,
          loaded: true,
          saved: kws,
          // 用户在 GET 返回前已经动过列表就不覆盖他的草稿
          draft: sameList(p.draft, p.saved) ? kws : p.draft,
          changesLeft: typeof data.changesLeft === "number" ? Math.max(0, data.changesLeft) : p.changesLeft,
          canEdit: data.canEdit !== false,
        }));
      } catch {
        if (alive) setState((p) => ({ ...p, loaded: true }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [auditId]);

  const setInput = useCallback((input: string) => setState((p) => ({ ...p, input, error: "" })), []);

  /** 把输入框里的词并进草稿;有错误时保留输入让用户改 */
  const add = useCallback((): boolean => {
    const cur = ref.current;
    if (!cur.input.trim()) return true;
    const m = mergeKeywords(cur.input, cur.draft);
    setState((p) => ({ ...p, draft: m.list, input: m.error && m.added === 0 ? p.input : "", error: m.error, notice: "" }));
    return !m.error;
  }, []);

  const remove = useCallback((kw: string) => {
    setState((p) => ({ ...p, draft: p.draft.filter((x) => x !== kw), error: "", notice: "" }));
  }, []);

  const reset = useCallback(() => {
    setState((p) => ({ ...p, draft: p.saved, input: "", error: "", notice: "" }));
  }, []);

  const save = useCallback(
    async (list?: string[]): Promise<boolean> => {
      const keywords = list ?? ref.current.draft;
      setState((p) => ({ ...p, saving: true, error: "", notice: "" }));
      try {
        const res = await fetch(`/api/seo-audit/${auditId}/keywords`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords }),
        });
        const data = (await res.json().catch(() => ({}))) as KeywordsReply;
        const left = typeof data.changesLeft === "number" ? Math.max(0, data.changesLeft) : null;
        if (!res.ok || data.ok === false) {
          const fallback =
            res.status === 401 || res.status === 403
              ? "Only the account that unlocked this report can change its keywords."
              : res.status === 429
                ? "No keyword changes left for this report."
                : "Couldn't save your keywords — please try again.";
          setState((p) => ({ ...p, saving: false, error: data.error || fallback, changesLeft: left ?? p.changesLeft }));
          return false;
        }
        const kws = cleanList(data.keywords ?? keywords);
        setState((p) => ({
          ...p,
          saving: false,
          saved: kws,
          draft: kws,
          input: "",
          changesLeft: left ?? p.changesLeft,
          notice: data.rerunStarted
            ? "Saved. Re-scoring your report against these keywords — it takes about 2 minutes."
            : (typeof data.note === "string" && data.note.trim()) || "Saved.",
        }));
        // 完整报告保存后会触发重跑(行状态变 running):刷新让页面切到进度视图,跑完它会自己刷回报告
        if (data.rerunStarted) setTimeout(() => router.refresh(), 1200);
        return true;
      } catch {
        setState((p) => ({ ...p, saving: false, error: "Network hiccup — please try again." }));
        return false;
      }
    },
    [auditId, router]
  );

  /** 付款前:把输入框里还没点 Add 的词也并进来,有改动就保存。没东西要存返回 true */
  const flush = useCallback(async (): Promise<boolean> => {
    const cur = ref.current;
    let draft = cur.draft;
    if (cur.input.trim()) {
      const m = mergeKeywords(cur.input, cur.draft);
      if (m.error) {
        setState((p) => ({ ...p, error: m.error }));
        return false;
      }
      draft = m.list;
      setState((p) => ({ ...p, draft, input: "" }));
    }
    if (sameList(draft, cur.saved)) return true;
    return save(draft);
  }, [save]);

  const needsFlush = useCallback((): boolean => {
    const cur = ref.current;
    return cur.available && cur.canEdit && (!!cur.input.trim() || !sameList(cur.draft, cur.saved));
  }, []);

  return { state, setInput, add, remove, reset, save, flush, needsFlush };
}

/* ---------------- 视图(纯展示,可直接服务端渲染核对标记) ---------------- */

export function KeywordChips({ list, onRemove }: { list: readonly string[]; onRemove?: (kw: string) => void }) {
  if (list.length === 0) return null;
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Target keywords">
      {list.map((kw) => (
        <li
          key={kw}
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-iris/[0.08] py-1 pl-2.5 pr-1.5 text-xs font-medium text-iris"
        >
          <span className="min-w-0 break-words">{kw}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(kw)}
              aria-label={`Remove ${kw}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-iris/70 transition hover:bg-iris/10 hover:text-iris"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : (
            <span className="w-1" aria-hidden="true" />
          )}
        </li>
      ))}
    </ul>
  );
}

function changesLeftText(n: number | null): string {
  if (n === null) return "";
  if (n <= 0) return "No changes left for this report";
  return `${n} change${n === 1 ? "" : "s"} left`;
}

export function KeywordEditor({
  draft,
  input,
  error,
  disabled,
  onInput,
  onAdd,
  onRemove,
  inputId,
}: {
  draft: readonly string[];
  input: string;
  error: string;
  disabled?: boolean;
  onInput: (v: string) => void;
  onAdd: () => void;
  onRemove: (kw: string) => void;
  inputId: string;
}) {
  const full = draft.length >= TARGET_KEYWORDS_MAX;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 逗号即分隔:输入 "crm, crm for startups" 时边打边成胶囊
    if (e.key === ",") {
      e.preventDefault();
      onAdd();
    }
  };
  return (
    <div className="min-w-0">
      <form onSubmit={submit} className="flex min-w-0 items-stretch gap-2">
        <label htmlFor={inputId} className="sr-only">
          Add a target keyword
        </label>
        <input
          id={inputId}
          type="text"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || full}
          placeholder={full ? `${TARGET_KEYWORDS_MAX} keywords added` : "e.g. crm for small business"}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="min-w-0 flex-1 rounded-full border border-white/70 bg-white/70 px-4 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-iris/40 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || full || !input.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink/[0.06] px-3.5 text-sm font-semibold text-ink/70 transition hover:bg-ink/10 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
        </button>
      </form>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs font-medium text-coral-deep">
          {error}
        </p>
      )}
      {draft.length > 0 && (
        <div className="mt-2.5">
          <KeywordChips list={draft} onRemove={disabled ? undefined : onRemove} />
        </div>
      )}
    </div>
  );
}

/* ---------------- 完整报告:"What we compared against" 里的目标词行 ---------------- */

export function TargetKeywordsPanel({ auditId, initial = [] }: { auditId: string; initial?: readonly string[] }) {
  const kw = useTargetKeywords(auditId, initial);
  const [editing, setEditing] = useState(false);
  const s = kw.state;
  const dirty = !sameList(s.draft, s.saved) || !!s.input.trim();
  const canChange = s.available && s.canEdit && s.changesLeft !== 0;

  // 接口不在线又没有已存的词:整行不出现,不摆一个用不了的入口
  if (!s.available && s.saved.length === 0) return null;

  const commit = async () => {
    // 输入框里还有没点 Add 的词:一并带上
    let list = s.draft;
    if (s.input.trim()) {
      const m = mergeKeywords(s.input, s.draft);
      if (m.error) {
        kw.add();
        return;
      }
      list = m.list;
    }
    if (sameList(list, s.saved)) {
      setEditing(false);
      kw.reset();
      return;
    }
    if (await kw.save(list)) setEditing(false);
  };

  return (
    <div className="mt-5 min-w-0 rounded-2xl bg-ink/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Your target keywords</p>
        {!editing && canChange && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-iris hover:underline"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" /> {s.saved.length ? "Edit" : "Add keywords"}
          </button>
        )}
      </div>

      {!editing ? (
        s.saved.length > 0 ? (
          <div className="mt-2">
            <KeywordChips list={s.saved} />
          </div>
        ) : (
          <p className="mt-1.5 text-sm leading-relaxed text-ink/55">
            None yet. Add up to {TARGET_KEYWORDS_MAX} searches you want to win and we&rsquo;ll compare your pages with their
            top Google results.
          </p>
        )
      ) : (
        <div className="mt-2.5">
          <KeywordEditor
            draft={s.draft}
            input={s.input}
            error={s.error}
            disabled={s.saving}
            onInput={kw.setInput}
            onAdd={kw.add}
            onRemove={kw.remove}
            inputId={`kw-full-${auditId}`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => void commit()}
              disabled={s.saving || !dirty}
              className="btn-primary px-4 py-2 text-xs"
            >
              {s.saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Save &amp; re-score
            </button>
            <button
              type="button"
              onClick={() => {
                kw.reset();
                setEditing(false);
              }}
              disabled={s.saving}
              className="text-xs font-medium text-ink/50 hover:text-ink"
            >
              Cancel
            </button>
            {changesLeftText(s.changesLeft) && <span className="text-xs text-ink/40">{changesLeftText(s.changesLeft)}</span>}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/45">
            Saving re-runs the comparison for new keywords only — about 2 minutes. Everything else stays as it is.
          </p>
        </div>
      )}

      {!editing && s.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-coral-deep">
          {s.error}
        </p>
      )}
      {s.notice && (
        <p role="status" className="mt-2 text-xs font-medium text-mint-deep">
          {s.notice}
        </p>
      )}
      {!editing && s.loaded && s.available && s.changesLeft === 0 && (
        <p className="mt-2 text-xs text-ink/40">No keyword changes left for this report.</p>
      )}
    </div>
  );
}

/* ---------------- 免费报告:解锁卡里的可选目标词 + 付款前保存的守卫 ---------------- */

export function UnlockWithKeywords({ auditId, children }: { auditId: string; children: ReactNode }) {
  const kw = useTargetKeywords(auditId);
  const s = kw.state;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skipHint, setSkipHint] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  /** 守卫自己"再点一次"时放行 */
  const bypass = useRef(false);
  /** 保存失败过一次:用户再点即放行(不让可选项卡住付款) */
  const failedOnce = useRef(false);

  const open = expanded || s.saved.length > 0 || s.draft.length > 0;
  const editable = s.available && s.canEdit && s.changesLeft !== 0;

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (bypass.current) {
      bypass.current = false;
      return;
    }
    const target = e.target instanceof Element ? e.target.closest("button") : null;
    if (!target || failedOnce.current || !kw.needsFlush()) return;
    // 捕获阶段拦下:React 不会再把这次点击派发给解锁按钮自己的 onClick
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    void kw.flush().then((ok) => {
      setBusy(false);
      if (!ok) {
        failedOnce.current = true;
        setSkipHint(true);
        setExpanded(true);
        return;
      }
      bypass.current = true;
      wrap.current?.querySelector("button")?.click();
    });
  };

  const dirty = !sameList(s.draft, s.saved) || !!s.input.trim();
  /** 用户一改词,"再点即放行"的豁免就作废 —— 改好的词下次点击要先存 */
  const edited = () => {
    failedOnce.current = false;
    setSkipHint(false);
  };

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-3">
      <div ref={wrap} onClickCapture={onClickCapture} className="flex min-w-0 flex-col items-stretch" aria-busy={busy || undefined}>
        {children}
      </div>
      <p className="text-center text-xs text-ink/45">
        {busy ? "Saving your keywords…" : "One-time. No account needed."}
      </p>

      {/* 改动次数用完(或无权改)但已经存过词:只读展示,让买家知道付款后会先比这几个词 */}
      {s.available && !editable && s.saved.length > 0 && (
        <div className="min-w-0 border-t border-ink/[0.06] pt-3">
          <p className="text-xs font-semibold text-ink/70">Target keywords</p>
          <div className="mt-2">
            <KeywordChips list={s.saved} />
          </div>
        </div>
      )}

      {s.available && editable && (
        <div className="min-w-0 border-t border-ink/[0.06] pt-3">
          {!open ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-iris hover:underline"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add target keywords (optional)
            </button>
          ) : (
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink/70">
                Target keywords <span className="font-normal text-ink/40">· optional</span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink/45">
                Up to {TARGET_KEYWORDS_MAX} searches you want to win. The full report compares your pages with their top
                Google results first.
              </p>
              <div className="mt-2.5">
                <KeywordEditor
                  draft={s.draft}
                  input={s.input}
                  error={s.error}
                  disabled={s.saving || busy}
                  onInput={(v) => {
                    edited();
                    kw.setInput(v);
                  }}
                  onAdd={() => {
                    edited();
                    kw.add();
                  }}
                  onRemove={(k) => {
                    edited();
                    kw.remove(k);
                  }}
                  inputId={`kw-unlock-${auditId}`}
                />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {dirty && (
                  <button
                    type="button"
                    onClick={() => void kw.flush()}
                    disabled={s.saving || busy}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-iris hover:underline disabled:opacity-60"
                  >
                    {s.saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />} Save keywords
                  </button>
                )}
                {changesLeftText(s.changesLeft) && <span className="text-xs text-ink/40">{changesLeftText(s.changesLeft)}</span>}
                {!dirty && s.notice && (
                  <span role="status" className="text-xs font-medium text-mint-deep">
                    {s.notice}
                  </span>
                )}
              </div>
              {skipHint && s.error && (
                <p className="mt-1.5 text-xs leading-relaxed text-ink/50">
                  Fix it, or press the button above again to unlock without these keywords — you can add them later.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
