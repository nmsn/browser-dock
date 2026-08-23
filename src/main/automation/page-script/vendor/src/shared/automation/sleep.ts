/**
 * Exact-duration sleep (caller-specified ms).
 * Distinct from delay(key): no config table, no randomness, no overlay log.
 * Use for poll intervals, message retries, UI auto-hide, etc.
 */

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, ms));
  });
}
