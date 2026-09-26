import type { CdpClient } from '../../chrome/cdp-client'
import pageBundle from './dist/page-bundle.js?raw'

/**
 * 页面脚本注入器
 * @see docs/c48-integration-plan.md A3
 *
 * bundle 由 scripts/build-page-scripts.mjs 生成（源码 vendor 自 freelive-browser-extension）。
 * 注入幂等：已检测到 window.__BD / window.__BDC48 时跳过。
 */

export const PAGE_SCRIPT_VERSION = 1

export async function injectPageScript(client: CdpClient, sessionId?: string): Promise<void> {
  const probe = await client.send<{ result?: { value?: boolean } }>(
    'Runtime.evaluate',
    { expression: 'Boolean(window.__BD && window.__BDC48)' },
    sessionId
  )
  if (probe.result?.value === true) return
  await client.send('Runtime.evaluate', { expression: pageBundle }, sessionId)
}

/** 页面主会话求值（带页面异常透出） */
export async function evaluateOnPage<T = unknown>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.send<{
    result?: { value?: T }
    exceptionDetails?: { exception?: { description?: string; value?: unknown } }
  }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ??
      String(result.exceptionDetails.exception?.value ?? 'unknown page exception')
    throw new Error(`PG_EVAL_FAILED: ${detail.slice(0, 500)}`)
  }
  return result.result?.value as T
}
