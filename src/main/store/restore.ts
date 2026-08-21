import { copyFileSync, existsSync, rmSync } from 'fs'
import { resolve } from 'path'
import { DB_PATH, DB_BACKUP_PATH } from '../config'
import { backupDatabase } from './backup'
import { closeDatabase, initializeDatabase } from './database'
import logger from '../logger'

/**
 * 从备份恢复数据库
 * @see 文档 13.2 数据库迁移 / 9.3 删除和备份
 *
 * 流程：
 * 1. 校验备份路径（必须在备份目录内）
 * 2. 先对当前数据库做安全备份（pre-restore）
 * 3. 关闭连接，清理 WAL/SHM 边车文件（避免旧 WAL 覆盖恢复数据）
 * 4. 复制备份文件到 DB_PATH
 * 5. 重新打开并执行迁移（老版本备份会自动补齐 schema）
 */

export function restoreDatabaseFromBackup(backupPath: string): void {
  const resolved = resolve(backupPath)
  if (!resolved.startsWith(resolve(DB_BACKUP_PATH))) {
    throw new Error('INVALID_BACKUP_PATH: backup must be inside the backup directory')
  }
  if (!existsSync(resolved)) {
    throw new Error('BACKUP_NOT_FOUND')
  }

  // 恢复前先备份当前状态，误操作可回退
  try {
    backupDatabase('pre-restore')
  } catch (err) {
    logger.warn({ err }, 'Safety backup before restore failed, continuing')
  }

  closeDatabase()
  for (const suffix of ['-wal', '-shm']) {
    rmSync(DB_PATH + suffix, { force: true })
  }
  copyFileSync(resolved, DB_PATH)
  initializeDatabase()
  logger.info({ backupPath: resolved }, 'Database restored from backup')
}
