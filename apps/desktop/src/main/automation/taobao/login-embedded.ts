import type { Account, PageAdapter } from '../../../shared/types'
import { detectLoginStatus } from './login-detector'
import { ElectronPageAdapter } from '../runtime/electron-page-adapter'
import { closeLoginWindow, getAccountSession, getLoginWindow, openLoginWindow } from '../../window/manager'
import { updateAccount } from '../../store/accounts'
import logger from '../../logger'

/**
 * 淘宝登录流程（嵌入式架构，ADR-0001/0004）
 * @see 文档 2.6.1 账号登录流程
 *
 * 流程：
 * 1. 打开同分区可见「登录窗」（离屏执行视图的窗口内容不可见，扫码需可见窗口；
 *    两者共用分区会话，登录态互通）
 * 2. 导航到淘宝登录页，用户手动完成登录（扫码/密码）
 * 3. 轮询 detectLoginStatus（复用外部 Chrome 版选择器逻辑，仅换传输）
 * 4. 登录成功后经页面 fetch 重放 mtop.user.getusersimple JSONP 捕获 userNumId
 *   （等待期间由分区会话 webRequest 记录页面自身发出的该请求 URL）
 * 5. 更新数据库 login_status / user_num_id，关闭登录窗
 *
 * 安全（9.1）：应用不保存淘宝密码；cookie 由分区会话持久化。
 */

export const TAOBAO_LOGIN_URL = 'https://login.taobao.com/member/login.jhtml'

const MTOP_USER_SIMPLE_PATTERN = /mtop\.user\.getusersimple/i

/** 等待期间记录的 mtop getusersimple 请求 URL（JSONP 重放用） */
const mtopUrlLog = new Map<string, string>()

/**
 * 启动登录：打开（或复用）登录窗并导航到淘宝登录页
 */
export async function startEmbeddedLogin(account: Account): Promise<void> {
  const existing = getLoginWindow(account.id)
  if (existing) {
    existing.show()
    existing.focus()
    return
  }
  openLoginWindow(account, TAOBAO_LOGIN_URL)
}

/**
 * 等待登录完成；成功时回写登录状态并尽力捕获 userNumId，随后关闭登录窗。
 * 超时不关闭登录窗（用户可能仍在操作），返回 loggedIn:false。
 */
export async function waitEmbeddedLoginResult(
  account: Account,
  timeoutMs = 300_000
): Promise<{ loggedIn: boolean }> {
  const win = getLoginWindow(account.id)
  if (!win) return { loggedIn: false }

  // 记录页面自身发出的 mtop.user.getusersimple 请求（含 JSONP 回调参数），供重放
  const ses = getAccountSession(account.id)
  ses.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
    if (MTOP_USER_SIMPLE_PATTERN.test(details.url)) {
      mtopUrlLog.set(account.id, details.url)
    }
  })

  const page: PageAdapter = new ElectronPageAdapter(win.webContents)

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    let status: Awaited<ReturnType<typeof detectLoginStatus>>
    try {
      status = await detectLoginStatus(page)
    } catch {
      // 页面跳转过渡期 evaluate 可能失败
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    if (status.status === 'logged-in') {
      logger.info({ accountId: account.id }, 'Taobao login detected (embedded)')
      const userNumId = await captureUserNumId(page, account.id)
      updateAccount(account.id, {
        loginStatus: 'logged-in',
        lastLoginAt: new Date().toISOString(),
        lastLoginCheckAt: new Date().toISOString(),
        ...(userNumId ? { userNumId } : {})
      })
      closeLoginWindow(account.id)
      return { loggedIn: true }
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  logger.warn({ accountId: account.id }, 'Embedded login wait timed out')
  return { loggedIn: false }
}

/**
 * 重放最近一次 mtop.user.getusersimple JSONP 请求，解析 userNumId。
 * 失败不影响登录结论（userNumId 为 server 直播间绑定字段，可后续补采）。
 */
async function captureUserNumId(page: PageAdapter, accountId: string): Promise<string | null> {
  const url = mtopUrlLog.get(accountId)
  if (!url) {
    logger.warn({ accountId }, 'No mtop.user.getusersimple request captured; skip userNumId')
    return null
  }
  try {
    const raw = await page.evaluate<string>(
      `(async () => {
        const resp = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
        return resp.text();
      })()`
    )
    const start = raw.indexOf('(')
    const end = raw.lastIndexOf(')')
    if (start < 0 || end <= start) return null
    const parsed = JSON.parse(raw.slice(start + 1, end)) as {
      data?: { userNumId?: string | number; nick?: string }
    }
    const userNumId = parsed.data?.userNumId != null ? String(parsed.data.userNumId) : null
    logger.info({ accountId, userNumId }, 'Captured taobao userNumId')
    return userNumId
  } catch (err) {
    logger.warn({ accountId, err: err instanceof Error ? err.message : String(err) }, 'userNumId capture failed')
    return null
  }
}
