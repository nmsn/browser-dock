import type { PageAdapter } from '../../../shared/types'

/**
 * 淘宝账号身份检测
 * @see 文档 7.1 taobao/account-detector.ts
 *
 * Phase 2 完整实现
 */

export interface AccountIdentity {
  username: string
  nick: string
  avatarUrl?: string
}

/**
 * 检测当前登录的淘宝账号身份
 */
export async function detectAccountIdentity(page: PageAdapter): Promise<AccountIdentity | null> {
  const result = await page.evaluate<{ username?: string; nick?: string } | null>(`
    (() => {
      try {
        const username = document.querySelector('.site-nav-user-info .username')?.textContent?.trim()
        const nick = document.querySelector('.site-nav-user-info .nick')?.textContent?.trim()
        if (!username && !nick) return null
        return { username, nick }
      } catch {
        return null
      }
    })()
  `)
  if (!result) return null
  return {
    username: result.username ?? '',
    nick: result.nick ?? ''
  }
}
