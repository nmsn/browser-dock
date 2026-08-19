import type { PageAdapter } from '../../../shared/types'

/**
 * 等待选择器出现
 * @see 文档 7.1 automation/actions/wait.ts
 * 超时后抛出 PG_SELECTOR_NOT_FOUND。
 */
export async function waitFor(
  page: PageAdapter,
  selector: string,
  timeoutMs = 10_000
): Promise<void> {
  await page.waitForSelector(selector, timeoutMs)
}

/**
 * 固定延时等待（毫秒），受 AbortSignal 中断
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}