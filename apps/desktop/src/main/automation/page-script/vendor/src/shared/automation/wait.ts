/**
 * 条件轮询原语 waitUntil；无条件拟人延时见 delay.ts；精确 sleep 见 sleep.ts。
 *
 * browser-dock 版本：自 freelive-browser-extension shared/automation/wait.ts 移植，
 * 相对旧版新增 waitRequiredValue / waitUntilLive（MutationObserver+轮询混合，最小化
 * 后台执行专用）与扩展的超时档位。取消守卫（扩展 abort-registry）在嵌入式架构下
 * 由主进程在每次 evaluate 调用间检查 AbortSignal，页面侧降级为 no-op。
 */

import { formatDuration } from './format-duration';
import { sleepMs } from './sleep';

export const WaitTimeout = {
  default: 15_000,
  short: 2_000,
  medium: 15_000,
  long: 20_000,
  xlong: 25_000,
} as const;

export const WaitInterval = {
  default: 200,
  slow: 400,
} as const;

export type WaitUntilOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  /** Reserved for future timing stats; unused this iteration. */
  label?: string;
};

/** 执行日志级别（与 AutomationLogEntry.level 对齐的最小子集） */
export type AutomationLogLevel = 'debug' | 'info' | 'success' | 'warning' | 'error';

export type AutomationLogSink = (level: AutomationLogLevel, message: string) => void;

export type AutomationDomOptions = {
  log?: AutomationLogSink;
};

/** 严格路径 DOM 入参：执行日志 sink 必填（handler 传 addLog，测试传 noop）。 */
export type AutomationDomContext = {
  log: AutomationLogSink;
};

export type WaitRequiredOptions = {
  label: string;
  failureReason: string;
  timeoutMs?: number;
  intervalMs?: number;
  log: AutomationLogSink;
};

export type WaitRequiredResult<T> =
  | { ok: true; value: T; elapsedMs: number }
  | { ok: false; elapsedMs: number; reason: string };

// 页面侧取消守卫：嵌入式架构下取消由主进程编排层处理，页面侧恒为未取消。
const isPageAutomationAborted = (): boolean => false;

/**
 * 严格等待并返回命中值；超时返回 undefined（日志由 waitRequired 写入）。
 */
export async function waitRequiredValue<T>(
  getter: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  options: WaitRequiredOptions,
): Promise<T | undefined> {
  const result = await waitRequired(getter, options);
  return result.ok ? result.value : undefined;
}

/**
 * Poll until getter returns a truthy value (not undefined/null/false), or timeout.
 * Returns undefined on timeout. Getter may be sync or async.
 */
export async function waitUntil<T>(
  getter: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  options?: WaitUntilOptions,
): Promise<T | undefined> {
  const timeoutMs = options?.timeoutMs ?? WaitTimeout.default;
  const intervalMs = options?.intervalMs ?? WaitInterval.default;
  const start = Date.now();

  const read = async () => Promise.resolve(getter());

  while (Date.now() - start < timeoutMs) {
    const value = await read();
    if (value !== undefined && value !== null && value !== false) {
      return value;
    }
    await sleepMs(intervalMs);
  }

  const last = await read();
  if (last !== undefined && last !== null && last !== false) {
    return last;
  }
  return undefined;
}

export type WaitUntilLiveOptions = WaitUntilOptions & {
  /** 观察根节点；默认 document.body。跨 frame 场景由调用方自行处理（原语只在当前 frame 生效）。 */
  observeRoot?: ParentNode;
  /**
   * 需要观察的属性名（如 ['class','style']）。
   * 页面侧通过属性变化切换状态（如按钮禁用态）时提供；纯插入/移除类检查可不传。
   */
  attributeFilter?: string[];
};

/**
 * MutationObserver + 轮询混合等待（最小化/后台执行专用原语）：
 * - 首次立即执行 predicate；
 * - Observer 监听 observeRoot 子树 childList（微任务级，不受后台定时器节流；
 *   最小化下 setInterval/setTimeout 被节流到 ≥1s，MutationObserver 回调是微任务不节流）；
 * - 提供 attributeFilter 时同时监听 attributes，覆盖按钮禁用态等属性变化；
 * - 保留 intervalMs 轮询兜底（覆盖节点复用/class 显隐等 childList 不触发的场景）；
 * - predicate 每次被唤醒后重新求值，命中即返回；超时返回 undefined（与 waitUntil 一致）。
 */
export async function waitUntilLive<T>(
  predicate: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  options?: WaitUntilLiveOptions,
): Promise<T | undefined> {
  const timeoutMs = options?.timeoutMs ?? WaitTimeout.default;
  const intervalMs = options?.intervalMs ?? WaitInterval.default;
  const observeRoot: ParentNode | undefined =
    options?.observeRoot ?? (typeof document !== 'undefined' ? document.body : undefined);
  const attributeFilter = options?.attributeFilter;

  const evaluate = async (): Promise<T | undefined> => {
    const v = await predicate();
    return v !== undefined && v !== null && v !== false ? (v as T) : undefined;
  };

  const immediate = await evaluate();
  if (immediate !== undefined) return immediate;

  if (!observeRoot) {
    return waitUntil(predicate, { timeoutMs, intervalMs });
  }

  if (isPageAutomationAborted()) {
    throw new DOMException('自动化已取消', 'AbortError');
  }

  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let hardTimeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      observer?.disconnect();
      if (pollTimer) clearInterval(pollTimer);
      if (hardTimeout) clearTimeout(hardTimeout);
    };
    const finish = (value: T | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const check = () => {
      void evaluate().then((v) => {
        if (v !== undefined) finish(v);
      });
    };
    try {
      observer = new MutationObserver(check);
      observer.observe(observeRoot, {
        childList: true,
        subtree: true,
        ...(attributeFilter ? { attributes: true, attributeFilter } : {}),
      });
    } catch {
      // 环境不支持则退化为纯轮询
    }
    pollTimer = setInterval(check, intervalMs);
    hardTimeout = setTimeout(() => finish(undefined), timeoutMs);
  });
}

/**
 * 严格等待：命中继续、超时失败；轮询机制同 waitUntil。
 * 通过 log 写入执行日志（成功记耗时，失败记原因）。
 */
export async function waitRequired<T>(
  getter: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  options: WaitRequiredOptions,
): Promise<WaitRequiredResult<T>> {
  const timeoutMs = options.timeoutMs ?? WaitTimeout.default;
  const intervalMs = options.intervalMs ?? WaitInterval.default;
  const startedAt = Date.now();
  const value = await waitUntil(getter, { timeoutMs, intervalMs });
  const elapsedMs = Date.now() - startedAt;

  if (value !== undefined && value !== null && value !== false) {
    options.log('info', `[等待] 命中 ${formatDuration(elapsedMs)} · ${options.label}`);
    return { ok: true, value, elapsedMs };
  }

  options.log(
    'warning',
    `[等待] 超时 ${formatDuration(elapsedMs)} / 限额 ${formatDuration(timeoutMs)} · ${options.label}：${options.failureReason}`,
  );
  return { ok: false, elapsedMs, reason: options.failureReason };
}
