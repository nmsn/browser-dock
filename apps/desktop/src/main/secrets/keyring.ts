import { Entry } from '@napi-rs/keyring'

const SERVICE_NAME = 'browser-dock'

/**
 * 密钥环封装
 * 使用系统密钥环存储敏感信息（代理密码、订阅Token等）
 */
export class Keyring {
  /**
   * 保存密码
   * @param key 键名
   * @param password 密码值
   */
  static setPassword(key: string, password: string): void {
    const entry = new Entry(SERVICE_NAME, key)
    entry.setPassword(password)
  }

  /**
   * 获取密码
   * @param key 键名
   * @returns 密码值，如果不存在则返回 null
   */
  static getPassword(key: string): string | null {
    const entry = new Entry(SERVICE_NAME, key)
    return entry.getPassword()
  }

  /**
   * 删除密码
   * @param key 键名
   * @returns 是否成功删除
   */
  static deletePassword(key: string): boolean {
    const entry = new Entry(SERVICE_NAME, key)
    return entry.deletePassword()
  }

  /**
   * 检查密码是否存在
   * @param key 键名
   * @returns 是否存在
   */
  static hasPassword(key: string): boolean {
    try {
      const entry = new Entry(SERVICE_NAME, key)
      return entry.getPassword() !== null
    } catch {
      return false
    }
  }
}
