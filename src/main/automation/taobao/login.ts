import type { CdpClient } from '../../chrome/cdp-client'
import logger from '../../logger'

/**
 * 淘宝账号登录流程
 * @see 文档 2.6.1 账号登录流程 / 6.2 启动流程
 *
 * 流程：
 * 1. 创建独立 Chrome 实例（独立 --user-data-dir）
 * 2. 导航到淘宝登录页面
 * 3. 用户手动完成登录（扫码/密码）
 * 4. 检测登录成功（页面跳转/cookie 写入）
 * 5. 关闭 Chrome，保存登录状态
 * 6. 更新数据库 is_logged_in = true
 *
 * 安全（9.1）：应用不保存淘宝密码，用户在独立 Chrome 窗口中手动登录
 */

export const TAOBAO_LOGIN_URL = 'https://login.taobao.com/member/login.jhtml'

export interface LoginSession {
  cdp: CdpClient
}

/**
 * 启动登录流程：打开淘宝登录页等待用户手动登录
 * @param cdp 已连接的页面 CDP 客户端
 * @returns 登录会话（调用方负责管理 CDP 生命周期）
 */
export async function startLogin(cdp: CdpClient): Promise<LoginSession> {
  logger.info('Starting Taobao login flow')
  // 导航到淘宝登录页（2.6.1 第 3 步）
  await cdp.send('Page.navigate', { url: TAOBAO_LOGIN_URL })
  // 等待页面加载
  await waitForPageLoad(cdp)
  return { cdp }
}

/**
 * 等待页面加载完成
 */
async function waitForPageLoad(cdp: CdpClient, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const state = await cdp
      .send<{ readyState: string }>('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      })
    if (state?.readyState === 'complete') return
    await new Promise((r) => setTimeout(r, 200))
  }
  logger.warn('Page load wait timed out')
}

/**
 * 检查登录是否已完成
 * @param cdp 页面 CDP 客户端
 * @param timeoutMs 最长等待时间
 * @returns 最终登录状态
 */
export async function waitForLoginComplete(
  cdp: CdpClient,
  timeoutMs = 120_000,
  onPoll?: (status: string) => void
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await detectLoginStatusViaCdp(cdp)
    onPoll?.(status)
    if (status === 'logged-in') {
      logger.info('Taobao login detected')
      return true
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  logger.warn('Login wait timed out')
  return false
}

/**
 * 基于 CDP 检测登录状态（复用 login-detector 的配置逻辑）
 */
async function detectLoginStatusViaCdp(cdp: CdpClient): Promise<string> {
  const result = await cdp.send<{ result: { value?: { status?: string } } }>('Runtime.evaluate', {
    expression: `(() => {
      const href = window.location.href;
      if (href.includes('login.taobao.com') || href.includes('login.tmall.com')) {
        return { status: 'logged-out' };
      }
      const userEl = document.querySelector('.site-nav-user-info, #site-nav .site-nav-login-info-nick');
      if (userEl && userEl.textContent && userEl.textContent.trim()) {
        return { status: 'logged-in' };
      }
      return { status: 'unknown' };
    })()`,
    returnByValue: true
  })
  return result?.result?.value?.status ?? 'unknown'
}