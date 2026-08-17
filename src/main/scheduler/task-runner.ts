import type { Account, Schedule } from '../../shared/types'
import logger from '../logger'

/**
 * 多账号并行执行器（并发池）
 * @see 文档 5.3 并发规则 / 5.4 调度器伪代码
 *
 * 规则：
 * - 不同账号可以并行执行
 * - 同一账号同一时间只允许一个任务执行
 * - 全局并发上限（schedule.maxConcurrency，默认 3）
 * - 调度重入：上一批次未结束则跳过下次重复触发
 *
 * Phase 3 完整实现
 */

const runningBatches = new Map<string, boolean>() // scheduleId -> isRunning
const accountLocks = new Map<string, string>() // accountId -> executionId

/**
 * 检查批次是否在运行（防重入）
 */
export function isBatchRunning(scheduleId: string): boolean {
  return runningBatches.get(scheduleId) === true
}

/**
 * 调度器主入口
 */
export async function dispatchSchedule(
  schedule: Schedule,
  accounts: Account[],
  runner: (account: Account) => Promise<void>
): Promise<void> {
  // 5.3 调度重入：上一批次未结束时跳过下次
  if (isBatchRunning(schedule.id)) {
    logger.warn({ scheduleId: schedule.id }, 'Batch already running, skip duplicate trigger')
    return
  }

  runningBatches.set(schedule.id, true)
  try {
    await runForAccounts(schedule, accounts, runner)
  } finally {
    runningBatches.delete(schedule.id)
  }
}

/**
 * 并发池：执行多个账号的任务
 */
async function runForAccounts(
  schedule: Schedule,
  accounts: Account[],
  runner: (account: Account) => Promise<void>
): Promise<void> {
  const concurrency = Math.max(1, schedule.maxConcurrency ?? 3)
  const queue = accounts.filter((a) => !accountLocks.has(a.id))

  const workers: Array<Promise<void>> = []
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(worker(queue, runner))
  }
  await Promise.all(workers)
}

/**
 * 单个 worker：从队列中取出账号并执行
 */
async function worker(
  queue: Account[],
  runner: (account: Account) => Promise<void>
): Promise<void> {
  while (queue.length > 0) {
    const account = queue.shift()!
    if (accountLocks.has(account.id)) continue
    const executionId = `exec-${account.id}-${Date.now()}`
    accountLocks.set(account.id, executionId)
    try {
      await runner(account)
    } catch (err) {
      logger.error({ accountId: account.id, err }, 'Account task runner failed')
    } finally {
      accountLocks.delete(account.id)
    }
  }
}

/**
 * 检查账号是否被锁定
 */
export function isAccountLocked(accountId: string): boolean {
  return accountLocks.has(accountId)
}

/**
 * 强制释放账号锁（用于异常恢复）
 */
export function forceReleaseAccountLock(accountId: string): void {
  accountLocks.delete(accountId)
}

/**
 * 应用启动时清理残留锁
 * @see 文档 6.3 异常结束
 */
export function clearAllAccountLocks(): void {
  accountLocks.clear()
}
