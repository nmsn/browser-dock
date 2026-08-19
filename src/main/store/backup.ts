import { mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { DB_PATH, DB_BACKUP_PATH } from '../config'
import { getDatabase } from './database'
import logger from '../logger'

/**
 * 数据库备份机制
 * @see 文档 13.2 数据库迁移
 *
 * 策略：
 * - 每次迁移前自动备份（迁移失败可回滚）
 * - 使用 VACUUM INTO 生成独立副本（WAL 模式下安全）
 * - 默认保留最近 7 份备份，自动清理更早的
 */

const BACKUP_RETENTION_COUNT = 7

/**
 * 创建数据库备份
 * @param reason 备份原因（如 pre-migration）
 * @returns 备份文件的绝对路径
 */
export function backupDatabase(reason = 'manual'): string {
  mkdirSync(DB_BACKUP_PATH, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(DB_BACKUP_PATH, `browser-dock-${reason}-${timestamp}.db`)

  // VACUUM INTO 生成一致性快照（WAL 模式下线程安全）
  const db = getDatabase()
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)

  cleanupOldBackups()
  logger.info({ path: backupPath }, 'Database backup created')
  return backupPath
}

/**
 * 清理超出保留数量的旧备份
 */
function cleanupOldBackups(): void {
  let files: string[]
  try {
    files = readdirSync(DB_BACKUP_PATH).filter((f) => f.startsWith('browser-dock-') && f.endsWith('.db'))
  } catch {
    return
  }

  // 按修改时间排序，保留最新的 BACKUP_RETENTION_COUNT 份
  files.sort((a, b) => {
    const timeA = statSync(join(DB_BACKUP_PATH, a)).mtimeMs
    const timeB = statSync(join(DB_BACKUP_PATH, b)).mtimeMs
    return timeB - timeA
  })

  for (const file of files.slice(BACKUP_RETENTION_COUNT)) {
    rmSync(join(DB_BACKUP_PATH, file), { force: true })
    logger.debug({ file }, 'Removed old database backup')
  }
}

/**
 * 列出现有备份
 */
export function listBackups(): { path: string; size: number; modifiedAt: Date }[] {
  try {
    return readdirSync(DB_BACKUP_PATH)
      .filter((f) => f.startsWith('browser-dock-') && f.endsWith('.db'))
      .map((f) => {
        const full = join(DB_BACKUP_PATH, f)
        const stat = statSync(full)
        return { path: full, size: stat.size, modifiedAt: stat.mtime }
      })
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
  } catch {
    return []
  }
}