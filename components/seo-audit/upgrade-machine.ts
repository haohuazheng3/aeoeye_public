/* ============================================================
   付费生成页的状态机(纯逻辑、无 React;SeoUpgradeRunner 把回调接到 state 上,
   单独成文件好在 node 里用假计时器把每条路径走一遍)。

   两条腿并行:POST 触发升级(长请求,超时不代表失败);GET 只读轮询,后端写完就收尾。

   供应商不可用(POST 503 / 状态 pending_provider,复审 C34)是一个**明确的等待态**:
   - 后端此刻什么都没在跑 —— UI 必须冻结按秒推进的估算进度(onWaiting(true) 时由页面冻结秒表);
   - 后端没有自动重试,重试由本页每 60s 重新 POST 一次。dfsReady 的失败缓存是 60s、按检查**开始**
     时刻计,收到 503 之后再等 60s 必然越过它,不会只读到缓存;
   - POST 回 202 / 409(或轮询看到别处已经开跑)即退出等待,估算与轮询计数都从零算;
   - 等待不计入 maxPolls,另设 15 分钟上限,到点给 Try again。
   ============================================================ */

export type UpgradeReply = {
  done?: boolean;
  unlocked?: boolean;
  state?: string | null;
  running?: boolean;
  started?: boolean;
  pendingProvider?: boolean;
  error?: string;
};

export type PostResult = { status: number; data: UpgradeReply } | null;

export const UPGRADE_TIMING = {
  firstPollMs: 6_000,
  pollMs: 5_000,
  /** 正常生成时的轮询上限:6s + 41×5s ≈ 3.5 分钟 */
  maxPolls: 42,
  /** 等待供应商时自动重新 POST 的间隔 */
  providerRetryMs: 60_000,
  /** 等待态下的只读轮询放慢:只为发现"别的标签页已经开跑 / 跑完了" */
  waitPollMs: 15_000,
  /** 等待供应商的单独上限(不计入 maxPolls) */
  waitMaxMs: 15 * 60_000,
};

export const UPGRADE_MESSAGES = {
  unpaid: "This report isn't unlocked yet. If you just paid, wait a moment and refresh.",
  runFailed: "The full report run failed. Your payment is safe — hit Try again, or contact us if it keeps happening.",
  slow: "This is taking longer than usual. Your payment is safe — hit Try again, or come back in a few minutes.",
  providerStillDown:
    "Our ranking-data provider is still unavailable. Your payment is safe — hit Try again, or come back later; your report link keeps working.",
};

export interface UpgradeMachineDeps {
  /** POST /upgrade;网络中断返回 null 或抛错都行(都交给轮询) */
  post(): Promise<PostResult>;
  /** GET /upgrade(只读) */
  get(): Promise<UpgradeReply | null>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  /** 进入 / 退出等待供应商 —— 页面据此冻结秒表、换文案 */
  onWaiting(waiting: boolean): void;
  /** 下一次自动重试的时刻(null = 没有排定 / 正在重试) */
  onNextRetryAt(at: number | null): void;
  /** 失败文案;null = 清掉。终态失败之后不再有任何回调 */
  onFailed(message: string | null): void;
  /** 退出等待、真正开跑:页面把估算秒表归零 */
  onRunStarted(): void;
  /** 完整报告已生成:页面 reload(只一次) */
  onDone(): void;
  timing?: Partial<typeof UPGRADE_TIMING>;
}

export function startUpgradeMachine(deps: UpgradeMachineDeps): { stop(): void } {
  const t = { ...UPGRADE_TIMING, ...deps.timing };
  let alive = true; // stop() 之后所有在途回调直接作废(卸载 / Try again 换下一轮)
  let finished = false; // 已到终态(done / 终态失败)
  let pollTimer: unknown;
  let retryTimer: unknown;
  let tries = 0;
  let waiting = false;
  let waitStartedAt = 0;
  let posting = false;

  const active = () => alive && !finished;
  const clearTimers = () => {
    deps.clearTimer(pollTimer);
    deps.clearTimer(retryTimer);
  };
  const setWaiting = (v: boolean) => {
    if (waiting === v) return;
    waiting = v;
    deps.onWaiting(v);
  };
  const finish = () => {
    finished = true;
    clearTimers();
    setWaiting(false);
    deps.onNextRetryAt(null);
  };
  const fail = (message: string) => {
    finish();
    deps.onFailed(message);
  };
  const succeed = () => {
    finish();
    deps.onDone();
  };

  const post = async (): Promise<PostResult> => {
    posting = true;
    try {
      return await deps.post();
    } catch {
      return null; // 长请求被掐断很常见 —— 不判失败,让轮询决定
    } finally {
      posting = false;
    }
  };

  const scheduleRetry = () => {
    deps.clearTimer(retryTimer);
    deps.onNextRetryAt(deps.now() + t.providerRetryMs);
    retryTimer = deps.setTimer(() => {
      void (async () => {
        if (!active() || !waiting) return;
        deps.onNextRetryAt(null);
        handle(await post());
        if (!active() || !waiting) return;
        if (deps.now() - waitStartedAt >= t.waitMaxMs) return fail(UPGRADE_MESSAGES.providerStillDown);
        scheduleRetry();
      })();
    }, t.providerRetryMs);
  };

  const enterWaiting = () => {
    if (waiting) return;
    waitStartedAt = deps.now();
    deps.onFailed(null);
    setWaiting(true);
    scheduleRetry();
  };

  const leaveWaiting = () => {
    if (!waiting) return;
    deps.clearTimer(retryTimer);
    deps.onNextRetryAt(null);
    setWaiting(false);
    // 现在才真正开跑:估算进度从零算,轮询上限也从零算
    tries = 0;
    deps.onRunStarted();
  };

  function handle(r: PostResult) {
    if (!active() || !r) return;
    const { status, data } = r;
    if (data.done) return succeed();
    if (status === 202 || status === 409 || data.started || data.running) return leaveWaiting();
    if (status === 503 || data.pendingProvider) return enterWaiting();
    if (status === 402) return fail(UPGRADE_MESSAGES.unpaid);
    // 只有明确的业务错误才提示(不中断轮询);等待供应商期间的偶发错误不打断等待,下一分钟照常重试
    if (data.error && !waiting) deps.onFailed(data.error);
  }

  const poll = async () => {
    if (!active()) return;
    try {
      const data = await deps.get();
      if (!active()) return;
      if (data?.done) return succeed();
      if (data?.state === "failed") return fail(UPGRADE_MESSAGES.runFailed);
      if (data?.state === "pending_provider") enterWaiting();
      // 别的标签页 / 刷新后的页面已经把它跑起来了。自己的重试 POST 在途时 CAS 会短暂显示 running,那不算
      else if (waiting && data?.running && !posting) leaveWaiting();
    } catch {
      /* 轮询失败无所谓,下一轮再来 */
    }
    if (!active()) return;
    // 等待供应商的时间不计入 maxPolls —— 它有自己的 15 分钟上限
    if (!waiting && ++tries >= t.maxPolls) return fail(UPGRADE_MESSAGES.slow);
    pollTimer = deps.setTimer(() => void poll(), waiting ? t.waitPollMs : t.pollMs);
  };

  pollTimer = deps.setTimer(() => void poll(), t.firstPollMs); // 轮询独立于 POST,POST 断了也能收尾
  void post().then(handle);

  return {
    stop() {
      alive = false;
      clearTimers();
    },
  };
}
