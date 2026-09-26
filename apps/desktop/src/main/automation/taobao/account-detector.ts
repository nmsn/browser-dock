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
 * 返回 null 表示未登录。
 */
export async function detectAccountIdentity(page: PageAdapter): Promise<AccountIdentity | null> {
  const result = await page.evaluate<{ username?: string; nick?: string; avatarUrl?: string } | null>(`
    (() => {
      try {
        // 常见用户信息 DOM 结构兜底匹配
        const nickEl = document.querySelector(
          '.site-nav-user-info .nick, .site-nav-login-info-nick, .site-nav-user-info [class*=nick]'
        );
        const usernameEl = document.querySelector(
          '.site-nav-user-info .username, .site-nav-login-info-nick'
        );
        const avatarEl = document.querySelector(
          '.site-nav-user-info img[src*=alicdn], .site-nav-user-info .avatar img, #site-nav .site-nav-user img'
        );
        const nick = nickEl?.textContent?.trim() ?? '';
        const username = usernameEl?.textContent?.trim() ?? '';
        const avatarUrl = avatarEl?.getAttribute('src') ?? undefined;
        if (!nick && !username) return null;
        return { username, nick, avatarUrl };
      } catch {
        return null;
      }
    })()
  `)
  if (!result) return null
  return {
    username: result.username ?? '',
    nick: result.nick ?? '',
    avatarUrl: result.avatarUrl
  }
}
