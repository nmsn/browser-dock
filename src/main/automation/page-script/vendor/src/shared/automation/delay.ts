import { sleepMs } from './sleep';
import { throwIfAborted } from './step-guards';

export type DelayRange = { minMs: number; maxMs: number };

export const Delay = {
  // 原 pace 阶段
  beforeAction: { minMs: 120, maxMs: 320 },
  afterInput: { minMs: 150, maxMs: 400 },
  afterNavigation: { minMs: 400, maxMs: 900 },
  // 原 settle 档位（映射用）
  tick: { minMs: 80, maxMs: 160 },
  short: { minMs: 120, maxMs: 280 },
  mid: { minMs: 200, maxMs: 450 },
  long: { minMs: 350, maxMs: 700 },
} as const;

export type DelayKey = keyof typeof Delay;

export type DelayLogFn = (message: string) => void;

export type DelayOptions = {
  log?: DelayLogFn;
  label?: string;
  /** Checked before and after the wait; throws AutomationCancelledError if aborted. */
  signal?: AbortSignal;
};

export function getRandomDelayMs(range: DelayRange): number {
  const minMs = Math.max(0, Math.floor(range.minMs));
  const maxMs = Math.max(minMs, Math.floor(range.maxMs));

  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

export async function delay(
  key: DelayKey,
  options?: DelayOptions,
): Promise<number> {
  throwIfAborted(options?.signal);
  const range = Delay[key];
  const delayMs = getRandomDelayMs(range);
  await sleepMs(delayMs);
  throwIfAborted(options?.signal);
  options?.log?.(`等待 ${delayMs}ms`);
  return delayMs;
}
