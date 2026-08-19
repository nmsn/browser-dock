import { getDatabase } from './database'
import type { AccountLock } from '../../shared/types'

/**
 * 账号锁（同一账号同一时间只能执行一个任务）
 * @see 文档 2.5 account_locks 表 / 5.3 并发规则 / 6.2 启动流程第 1 步
 *
 * 语义：
 * - account_id 为 PRIMARY KEY，天然保证唯一性
 * - 获取锁 = INSERT（若已存在则失败）
 * - 释放锁 = DELETE
 * - 应用启动时清空残留锁（文档 6.3 异常恢复）
 */

interface AccountLockRow {
  account_id: string
  execution_id: string
  acquired_at: string
}

function rowToLock(row: AccountLockRow): AccountLock {
  return {
    accountId: row.account_id,
    executionId: row.execution_id,
    acquiredAt: row.acquired_at
  }
}

/**
 * 尝试获取账号锁（原子操作）
 * @returns 获取成功返回 true；账号已被其他执行占用返回 false
 */
export function acquireAccountLock(accountId: string, executionId: string): boolean {
  const inserted = getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO account_locks (account_id, execution_id, acquired_at)
       VALUES (?, ?, ?)`
    )
    .run(accountId, executionId, new Date().toISOString())
  return inserted.changes > 0
}

/**
 * 释放账号锁
 */
export function releaseAccountLock(accountId: string): boolean {
  const result = getDatabase()
    .prepare('DELETE FROM account_locks WHERE account_id = ?')
    .run(accountId)
  return result.changes > 0
}

/**
 * 强制释放账号锁（用于异常恢复）
 * 仅当持有锁的执行已结束后调用
 */
export function forceReleaseAccountLock(accountId: string): boolean {
  return releaseAccountLock(accountId)
}

/**
 * 查询账号锁
 */
export function getAccountLock(accountId: string): AccountLock | null {
  const row = getDatabase()
    .prepare('SELECT * FROM account_locks WHERE account_id = ?')
    .get(accountId) as AccountLockRow | undefined
  return row ? rowToLock(row) : null
}

/**
 * 列出所有账号锁
 */
export function listAccountLocks(): AccountLock[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM account_locks')
    .all() as AccountLockRow[]
  return rows.map(rowToLock)
}

/**
 * 检查账号是否被锁定
 */
export function isAccountLocked(accountId: string): boolean {
  return getAccountLock(accountId) !== null
}

/**
 * 清空所有账号锁（应用启动时调用，处理上次异常退出残留）
 * @see 文档 6.3 异常结束 / 应用启动时应扫描上次异常退出留下的运行记录
 */
export function clearAllAccountLocks(): void {
  getDatabase().prepare('DELETE FROM account_locks').run()
}