import cron, { type ScheduledTask } from 'node-cron'
import { getDatabase } from './store/database'
import { getSettings } from './store/settings'
import logger from './logger'

/**
 * 保留期自动清理
 * @see 文档 9.3 删除和备份 / 2.3.1 设置
 *
 * - 执行日志：按 logRetentionDays 清理 execution_logs 表行
 *
 * 不再自动清理的资源（开发者手动删除）：
 * - pino 日志文件（app-YYYY-MM-DD.log，按日期存储）
 * - 截图 / DOM 快照文件（screenshots/YYYY-MM-DD/ 目录，按日期存储）
 * - page_diagnostics 诊断行（随文件永久保留）
 */

const CLEANUP_CRON = '0 0 3 * * *'

let cleanupTask: ScheduledTask | null = null

export interface RetentionCleanupResult {
  logsDeleted: number
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * 执行一次保留期清理
 */
export function runRetentionCleanup(): RetentionCleanupResult {
  const settings = getSettings()
  const db = getDatabase()
  const result: RetentionCleanupResult = {
    logsDeleted: 0
  }

  // 过期执行日志表行（结果数据随行删除；截图/DOM 文件独立保留）
  const logCutoff = cutoffIso(settings.logRetentionDays)
  const logRows = db
    .prepare(`SELECT id FROM execution_logs WHERE started_at < ?`)
    .all(logCutoff) as Array<{ id: string }>
  if (logRows.length > 0) {
    const deleteLog = db.prepare('DELETE FROM execution_logs WHERE id = ?')
    for (const row of logRows) {
      deleteLog.run(row.id)
    }
    result.logsDeleted = logRows.length
  }

  if (result.logsDeleted > 0) {
    logger.info(result, 'Retention cleanup completed')
  }
  return result
}

/**
 * 启动清理：应用启动时立即执行一次 + 每日定时
 */
export function initRetentionCleanup(): void {
  if (cleanupTask) return
  try {
    runRetentionCleanup()
  } catch (err) {
    logger.error({ err }, 'Retention cleanup failed on startup')
  }
  cleanupTask = cron.schedule(CLEANUP_CRON, () => {
    try {
      runRetentionCleanup()
    } catch (err) {
      logger.error({ err }, 'Retention cleanup failed')
    }
  })
  logger.info({ cron: CLEANUP_CRON }, 'Retention cleanup scheduled')
}

/**
 * 停止定时清理（应用退出前调用）
 */
export function stopRetentionCleanup(): void {
  cleanupTask?.stop()
  cleanupTask = null
}
