import type { PageAdapter } from '../../../shared/types'

/**
 * 淘宝登录检测
 * @see 文档 7.1 taobao/login-detector.ts
 *
 * Phase 2 完整实现
 */

export type LoginDetectionResult =
  | { status: 'logged-in'; username?: string }
  | { status: 'logged-out' }
  | { status: 'verification-required' }
  | { status: 'risk-control' }
  | { status: 'unknown' }

/**
 * 检测淘宝登录状态
 */
export async function detectLoginStatus(page: PageAdapter): Promise<LoginDetectionResult> {
  // 占位实现：实际需要根据淘宝页面 DOM 判断
  const url = await page.evaluate<string>('window.location.href')
  if (url.includes('login.taobao.com')) {
    return { status: 'logged-out' }
  }
  return { status: 'unknown' }
}
