import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { dialog, app } from 'electron'
import type { ExecutionLog } from '../shared/types'
import { listExecutionLogs } from './store/logs'
import logger from './logger'

/**
 * 执行日志导出
 * @see 文档 9.3 导出日志前过滤 Cookie、Token 和个人信息；Phase 4 日志导出
 *
 * 导出为 CSV，仅包含安全字段（不含页面/账号敏感数据）。
 */

const SAFE_FIELDS = [
  { key: 'id', label: '执行ID' },
  { key: 'startedAt', label: '开始时间' },
  { key: 'finishedAt', label: '结束时间' },
  { key: 'duration', label: '耗时(ms)' },
  { key: 'status', label: '状态' },
  { key: 'accountId', label: '账号ID' },
  { key: 'taskId', label: '任务ID' },
  { key: 'attempt', label: '重试次数' },
  { key: 'error', label: '错误信息' }
] as const

/**
 * 弹出保存对话框并导出日志为 CSV
 * @returns 导出文件的路径，取消返回 null
 */
export async function exportExecutionLogsCsv(): Promise<string | null> {
  const logs = listExecutionLogs({ limit: 1000 })

  const defaultPath = join(app.getPath('downloads'), `browser-dock-execution-logs-${Date.now()}.csv`)
  const result = await dialog.showSaveDialog({
    title: '导出执行日志',
    defaultPath,
    filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
  })

  if (result.canceled || !result.filePath) return null

  const csv = buildCsv(logs)
  writeFileSync(result.filePath, csv, 'utf-8')
  logger.info({ path: result.filePath, count: logs.length }, 'Execution logs exported')
  return result.filePath
}

/**
 * 构建 CSV 内容（9.3：仅导出安全字段，过滤敏感信息）
 */
export function buildCsv(logs: ExecutionLog[]): string {
  const header = SAFE_FIELDS.map((f) => `"${f.label}"`).join(',')
  const rows = logs.map((log) =>
    SAFE_FIELDS.map((f) => {
      const value = (log as unknown as Record<string, unknown>)[f.key]
      return `"${String(value ?? '').replace(/"/g, '""')}"`
    }).join(',')
  )
  return [header, ...rows].join('\n')
}