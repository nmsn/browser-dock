import type { Account, AccountRuntime } from '../../shared/types'
import { PROFILES_PATH } from '../config'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

/**
 * Profile 管理
 * @see 文档 6.4 Profile 管理要求
 *
 * 要求：
 * - 每个账号固定一个独立 Profile 目录
 * - Profile 路径由应用生成，不允许任务脚本自定义任意路径
 * - 不允许两个账号复用同一个 Profile
 */

const profileRegistry = new Map<string, string>() // accountId -> profilePath

/**
 * 为账号创建或获取 Profile 目录
 */
export function getOrCreateProfilePath(account: Pick<Account, 'id' | 'profilePath'>): string {
  if (profileRegistry.has(account.id)) {
    return profileRegistry.get(account.id)!
  }

  // 优先使用数据库中已有的路径
  if (account.profilePath && existsSync(account.profilePath)) {
    profileRegistry.set(account.id, account.profilePath)
    return account.profilePath
  }

  // 生成新路径：{PROFILES_PATH}/{accountId}
  const profilePath = join(PROFILES_PATH, account.id)
  if (!existsSync(profilePath)) {
    mkdirSync(profilePath, { recursive: true })
  }
  profileRegistry.set(account.id, profilePath)
  return profilePath
}

/**
 * 释放 Profile 注册
 */
export function releaseProfile(accountId: string): void {
  profileRegistry.delete(accountId)
}

/**
 * 检查 Profile 是否被占用（基于 lock 文件）
 * @see 文档 6.2 启动流程：检查 Profile 锁文件
 */
export function isProfileLocked(accountId: string): boolean {
  const profilePath = profileRegistry.get(accountId)
  if (!profilePath) return false
  // Chrome 使用 SingletonLock / SingletonCookie 等文件实现单实例
  const lockFile = join(profilePath, 'SingletonLock')
  return existsSync(lockFile)
}

/**
 * 删除账号 Profile 目录
 * 必须在停止 Chrome 实例后调用
 */
export function deleteProfile(accountId: string): boolean {
  const profilePath = profileRegistry.get(accountId)
  if (!profilePath) return false
  // 实际删除由调用方决定，这里只清理注册
  // import { rmSync } from 'fs'; rmSync(profilePath, { recursive: true, force: true })
  profileRegistry.delete(accountId)
  return true
}
