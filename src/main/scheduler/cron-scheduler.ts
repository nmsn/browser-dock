import cron, { type ScheduledTask } from 'node-cron'
import type { Schedule } from '../../shared/types'

/**
 * Cron 调度器
 * @see 文档 5.2 调度流程
 *
 * 职责：
 * - 维护 scheduleId → node-cron Task 的映射
 * - 启动/停止 cron 触发
 * - 支持时区
 *
 * Phase 3 完整实现
 */

const tasks = new Map<string, ScheduledTask>()

export interface CronSchedulerOptions {
  onTrigger: (schedule: Schedule) => Promise<void>
}

/**
 * 注册并启动 cron 任务
 */
export function startSchedule(schedule: Schedule, options: CronSchedulerOptions): void {
  stopSchedule(schedule.id)

  if (!schedule.enabled) return

  // 校验 cron 表达式
  if (!cron.validate(schedule.cronExpression)) {
    throw new Error(`Invalid cron expression: ${schedule.cronExpression}`)
  }

  const task = cron.schedule(
    schedule.cronExpression,
    async () => {
      await options.onTrigger(schedule)
    },
    {
      timezone: schedule.timezone
    }
  )

  task.start()
  tasks.set(schedule.id, task)
}

/**
 * 停止 cron 任务
 */
export function stopSchedule(scheduleId: string): void {
  const existing = tasks.get(scheduleId)
  if (existing) {
    existing.stop()
    tasks.delete(scheduleId)
  }
}

/**
 * 停止所有 cron 任务
 */
export function stopAllSchedules(): void {
  for (const task of tasks.values()) {
    task.stop()
  }
  tasks.clear()
}

/**
 * 检查调度是否在运行
 */
export function isScheduleRunning(scheduleId: string): boolean {
  return tasks.has(scheduleId)
}

/**
 * 计算下次触发时间
 */
export function getNextRunTime(schedule: Schedule): Date | null {
  // node-cron 没有内置 API，需要另行计算
  // Phase 3: 可使用 cron-parser 库
  return null
}
