import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import cron from 'node-cron'
import { getDatabase } from './store/database'
import { SCREENSHOTS_PATH } from './config'
import { getSettings } from './store/settings'
import logger from './logger'

/**
 * 保留期自动清理
 * @see 文档 9.3 删除和备份 / 2.3.1 设置
 *
 * - 执行日志：按 logRetentionDays 清理 execution_logs
 * - 截图 / DOM 快照：按 screenshotRetentionDays 清理 page_diagnostics 及文件
 * - 孤儿文件扫描：SCREENSHOTS_PATH 下超过保留期的文件按 mtime 删除
 *
 * 触发时机：应用启动时 + 每日 03:00 定时
 */

const CLEANUP_CRON = '0 0 3 * * *'

let cleanupTask: cron.ScheduledTask | null = null

export interface RetentionCleanupResult {
  logsDeleted: number
  diagnosticsDeleted: number
  filesDeleted: number
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function removeFileQuiet(path: string | null | undefined): boolean {
  if (!path || !existsSync(path)) return false
  try {
    unlinkSync(path)
    return true
  } catch (err) {
    logger.warn({ err, path }, 'Failed to remove expired file')
    return false
  }
}

/**
 * 扫描目录中修改时间早于 cutoff 的文件并删除（不递归）
 */
function sweepExpiredFiles(dir: string, cutoffMs: number): number {
  if (!existsSync(dir)) return 0
  let deleted = 0
  try {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name)
      try {
        const stat = statSync(file)
        if (!stat.isFile() && !stat.isSymbolicLink()) continue
        if (stat.mtimeMs < cutoffMs) {
          unlinkSync(file)
          deleted++
        }
      } catch (err) {
        logger.warn({ err, file }, 'Failed to sweep expired file')
      }
    }
  } catch (err) {
    logger.warn({ err, dir }, 'Failed to read directory for sweep')
  }
  return deleted
}

/**
 * 执行一次保留期清理
 */
export function runRetentionCleanup(): RetentionCleanupResult {
  const settings = getSettings()
  const db = getDatabase()
  const result: RetentionCleanupResult = {
    logsDeleted: 0,
    diagnosticsDeleted: 0,
    filesDeleted: 0
  }

  // 1. 过期页面诊断：先收集文件路径再删行（文档 9.3 截图/快照保留期）
  const diagCutoff = cutoffIso(settings.screenshotRetentionDays)
  const diagRows = db
    .prepare(
      `SELECT id, dom_snapshot_path, screenshot_path FROM page_diagnostics WHERE captured_at < ?`
    )
    .all(diagCutoff) as Array<{ id: string; dom_snapshot_path: string | null; screenshot_path: string | null }>
  if (diagRows.length > 0) {
    const deleteDiag = db.prepare('DELETE FROM page_diagnostics WHERE id = ?')
    for (const row of diagRows) {
      result.filesDeleted += removeFileQuiet(row.dom_snapshot_path) ? 1 : 0
      result.filesDeleted += removeFileQuiet(row.screenshot_path) ? 1 : 0
      deleteDiag.run(row.id)
    }
    result.diagnosticsDeleted = diagRows.length
  }

  // 2. 过期执行日志（screenshots 字段防御性收集文件引用）
  const logCutoff = cutoffIso(settings.logRetentionDays)
  const logRows = db
    .prepare(`SELECT id, screenshots FROM execution_logs WHERE started_at < ?`)
    .all(logCutoff) as Array<{ id: string; screenshots: string | null }>
  if (logRows.length > 0) {
    const deleteLog = db.prepare('DELETE FROM execution_logs WHERE id = ?')
    for (const row of logRows) {
      if (row.screenshots) {
        try {
          for (const path of JSON.parse(row.screenshots) as string[]) {
            result.filesDeleted += removeFileQuiet(path) ? 1 : 0
          }
        } catch {
          // screenshots 非法 JSON 时跳过文件清理，仅删行
        }
      }
      deleteLog.run(row.id)
    }
    result.logsDeleted = logRows.length
  }

  // 3. 孤儿文件扫描：诊断文件以执行 ID 命名，DB 行删除后可能残留
  const diagCutoffMs = Date.now() - settings.screenshotRetentionDays * 24 * 60 * 60 * 1000
  result.filesDeleted += sweepExpiredFiles(SCREENSHOTS_PATH, diagCutoffMs)
  result.filesDeleted += sweepExpiredFiles(join(SCREENSHOTS_PATH, 'dom'), diagCutoffMs)

  if (
    result.logsDeleted > 0 ||
    result.diagnosticsDeleted > 0 ||
    result.filesDeleted > 0
  ) {
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
