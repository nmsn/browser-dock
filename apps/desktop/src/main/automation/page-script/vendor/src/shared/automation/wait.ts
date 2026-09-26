/**
 * 条件轮询原语 waitUntil；无条件拟人延时见 delay.ts；精确 sleep 见 sleep.ts。
 */

import { sleepMs } from './sleep';

export const WaitTimeout = {
  default: 5_000,
  short: 2_000,
  medium: 5_000,
  long: 8_000,
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
