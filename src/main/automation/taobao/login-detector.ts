import type { PageAdapter } from '../../../shared/types'

/**
 * 淘宝登录检测
 * @see 文档 7.1 taobao/login-detector.ts
 *
 * 检测依据（helperFunc）：
 * 1. 当前 URL 是否在登录域名
 * 2. 页面是否存在用户信息栏（.site-nav-user-info 等）
 * 3. 是否存在登录表单 / 验证码容器
 */

export type LoginStatus =
  | 'logged-in'
  | 'logged-out'
  | 'verification-required'
  | 'risk-control'
  | 'unknown'

export interface LoginDetectionResult {
  status: LoginStatus
  username?: string
}

/**
 * 检测淘宝登录状态
 */
export async function detectLoginStatus(page: PageAdapter): Promise<LoginDetectionResult> {
  const result = await page.evaluate<{
    href: string
    loggedIn: boolean
    hasLoginForm: boolean
    hasCaptcha: boolean
    hasRiskNotice: boolean
    loginNick: string
  }>(`
    (() => {
      const href = window.location.href;
      const isLoginUrl = /login\\.taobao\\.com|login\\.tmall\\.com/.test(href);

      // 用户信息栏（已登录）
      const userEl = document.querySelector(
        '.site-nav-user-info, .site-nav-login-info-nick, #site-nav .site-nav-user'
      );
      const loggedIn = !!(userEl && userEl.textContent && userEl.textContent.trim());

      // 登录表单
      const loginForm = document.querySelector(
        '#J_QRCodeImg, #login-form, .login-content, .qrcode-login'
      );

      // 验证码容器
      const captcha = document.querySelector(
        '#nc_1_wrapper, #nc_2_wrapper, .nc-container, #J_VerifyCode'
      );

      // 风控页面
      const risk = /passport\\.taobao\\.com\\/ac\\/\\?.*usernick|risk|限制|安全验证/.test(
        document.body?.innerText?.slice(0, 2000) ?? ''
      );

      const nick = userEl?.textContent?.trim()?.slice(0, 30) ?? '';

      return { href, loggedIn, hasLoginForm: !!loginForm, hasCaptcha: !!captcha, hasRiskNotice: risk, loginNick: nick };
    })()
  `)

  if (result.loggedIn) {
    return { status: 'logged-in', username: result.loginNick }
  }
  if (result.hasRiskNotice && (result.hasCaptcha || result.hasLoginForm)) {
    return { status: 'risk-control' }
  }
  if (result.hasCaptcha) {
    return { status: 'verification-required' }
  }
  if (result.isLoginUrl || result.hasLoginForm) {
    return { status: 'logged-out' }
  }
  return { status: 'unknown' }
}