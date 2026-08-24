import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { LOGS_PATH } from './config'
import type { RunLogEntry } from '../shared/types'

/**
 * 运行日志读取：从 pino 按日期文件（app-YYYY-MM-DD.log）中
 * 按 executionId 过滤任务过程日志，供执行详情弹窗展示。
 *
 * - 文件名含日期，字典序即时间序；默认扫描最近 7 天
 * - pino JSON-lines：{"level":30,"time":1719...,"executionId":"exec-x","msg":"...",...}
 */

const LEVEL_NAMES: Record<number, RunLogEntry['level']> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error'
}

interface PinoLine {
  level?: number
  time?: number
  msg?: string
  executionId?: string
}

function sanitizeData(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (['level', 'time', 'msg', 'pid', 'hostname', 'executionId'].includes(key)) continue
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function readRunLogs(executionId: string, maxFiles = 7): RunLogEntry[] {
  if (!existsSync(LOGS_PATH)) return []

  const files = readdirSync(LOGS_PATH)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
    .sort()
    .slice(-maxFiles)

  const entries: RunLogEntry[] = []
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(join(LOGS_PATH, file), 'utf-8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      if (!line.includes(executionId)) continue
      try {
        const obj = JSON.parse(line) as PinoLine & Record<string, unknown>
        if (obj.executionId !== executionId) continue
        entries.push({
          time: obj.time ? new Date(obj.time).toISOString() : '',
          level: LEVEL_NAMES[obj.level ?? 30] ?? 'info',
          message: obj.msg ?? '',
          ...(sanitizeData(obj) ? { data: sanitizeData(obj) } : {})
        })
      } catch {
        // 跳过非 JSON 行
      }
    }
  }
  return entries
}
