import type { Account, Schedule } from '../../shared/types'
import logger from '../logger'
import { listEnabledSchedules, getSchedule, updateSchedule } from '../store/schedules'
import { getTask } from '../store/tasks'
import { getAccount } from '../store/accounts'
import { executeTask } from './task-executor'
import { dispatchSchedule as runBatch, runWithConcurrency } from './task-runner'
import { startSchedule, stopSchedule, stopAllSchedules } from './cron-scheduler'

/**
 * 调度服务：关联 DB、cron 调度器与任务执行引擎
 * @see 文档 5.2 调度流程 / 5.3 并发规则
 *
 * 流程：
 * Cron 触发 -> 读取 Schedule -> 校验 enabled、时区和任务版本
 * -> 为每个账号创建执行 -> 交给并发控制器 -> 更新 lastRunAt / nextRunAt
 */

let initialized = false

/**
 * 应用启动时初始化：注册所有已启用的调度
 */
export function initScheduler(): void {
  if (initialized) return
  initialized = true
  syncAllSchedules()
  logger.info('Scheduler initialized')
}

/**
 * 重新同步所有调度（start 时全量注册，update/delete 时调用）
 */
export function syncAllSchedules(): void {
  const schedules = listEnabledSchedules()
  for (const schedule of schedules) {
    registerSchedule(schedule)
  }
  logger.info({ count: schedules.length }, 'Schedules synced')
}

/**
 * 注册单个调度（调用方负责先校验）
 */
export function registerSchedule(schedule: Schedule): void {
  if (!schedule.enabled) {
    stopSchedule(schedule.id)
    return
  }
  startSchedule(schedule, {
    onTrigger: async (s) => {
      await handleCronTriggered(s.id)
    }
  })
}

/**
 * 移除调度（删除或停用）
 */
export function unregisterSchedule(scheduleId: string): void {
  stopSchedule(scheduleId)
}

/**
 * Cron 触发后的处理逻辑
 * @see 文档 5.4 调度器伪代码
 */
async function handleCronTriggered(scheduleId: string): Promise<void> {
  const schedule = getSchedule(scheduleId)
  if (!schedule) return

  // 5.3 调度重入：上一批次未结束时跳过（由 task-runner 处理）
  // 5.1 仅应用运行期间触发；应用未启动时不补执行

  // 关联任务
  const task = getTask(schedule.taskId)
  if (!task) {
    logger.warn({ scheduleId }, 'Schedule task not found, skipping')
    return
  }

  // 目标账号
  const accounts = schedule.accountIds
    .map((id) => getAccount(id))
    .filter((a): a is Account => a !== null)

  if (accounts.length === 0) {
    logger.warn({ scheduleId }, 'Schedule has no valid accounts, skipping')
    return
  }

  logger.info(
    { scheduleId, taskId: task.id, accountCount: accounts.length },
    'Schedule triggered'
  )

  // 交给并发控制器执行
  const startedAt = new Date().toISOString()
  updateSchedule(scheduleId, { lastRunAt: startedAt })

  await runBatch(
    schedule,
    accounts,
    async (account) => {
      // 每个账号独立执行，失败不阻塞其他账号（5.3 单账号失败规则）
      try {
        await executeTask(account, task)
      } catch (err) {
        logger.error(
          { accountId: account.id, taskId: task.id, scheduleId, err },
          'Scheduled task execution failed for account'
        )
      }
    }
  )

  updateSchedule(scheduleId, {
    lastRunAt: startedAt,
    nextRunAt: new Date().toISOString()
  })
}

/**
 * 手动触发任务（供 IPC 或 UI 使用，不受 cron 限制）
 * @returns 执行过的账号数
 */
export async function runTaskNow(taskId: string, accountIds: string[], maxConcurrency = 3): Promise<number> {
  const task = getTask(taskId)
  if (!task) throw new Error('TASK_NOT_FOUND')

  const accounts = accountIds
    .map((id) => getAccount(id))
    .filter((a): a is Account => a !== null)

  if (accounts.length === 0) throw new Error('NO_VALID_ACCOUNTS')

  await runWithConcurrency(
    accounts,
    maxConcurrency,
    async (account) => {
      try {
        await executeTask(account, task)
      } catch (err) {
        logger.error({ accountId: account.id, taskId, err }, 'Manual task execution failed')
      }
    }
  )
  return accounts.length
}

/**
 * 列出所有调度及下次运行时间（供 UI）
 */
export function getSchedulesWithStatus(): Array<Schedule & { running: boolean }> {
  const schedules = listEnabledSchedules()
  return schedules.map((s) => ({
    ...s,
    running: false // Phase 3 简化：运行状态由 task-runner 内部维护
  }))
}

export { stopAllSchedules }