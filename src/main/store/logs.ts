import { getDatabase } from './database'
import type {
  ExecutionLog,
  ExecutionStatus,
  StateTransition
} from '../../shared/types'

/**
 * 执行日志 CRUD
 * @see 文档 2.5 execution_logs 表 / 11.1 每次任务至少记录
 */

interface ExecutionLogRow {
  id: string
  schedule_id: string | null
  task_id: string
  account_id: string
  status: ExecutionStatus
  attempt: number
  started_at: string
  finished_at: string | null
  duration: number | null
  result: string | null
  error: string | null
  screenshots: string | null
}

function rowToExecutionLog(row: ExecutionLogRow): ExecutionLog {
  return {
    id: row.id,
    scheduleId: row.schedule_id ?? undefined,
    taskId: row.task_id,
    accountId: row.account_id,
    status: row.status,
    attempt: row.attempt,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    duration: row.duration ?? undefined,
    result: row.result ? (JSON.parse(row.result) as Record<string, unknown>) : undefined,
    error: row.error ?? undefined,
    screenshots: row.screenshots ? (JSON.parse(row.screenshots) as string[]) : undefined
  }
}

export interface ExecutionLogFilter {
  accountId?: string
  taskId?: string
  status?: ExecutionStatus
  startTime?: string
  endTime?: string
  limit?: number
}

export function listExecutionLogs(filter: ExecutionLogFilter = {}): ExecutionLog[] {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter.accountId) {
    conditions.push('account_id = ?')
    params.push(filter.accountId)
  }
  if (filter.taskId) {
    conditions.push('task_id = ?')
    params.push(filter.taskId)
  }
  if (filter.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter.startTime) {
    conditions.push('started_at >= ?')
    params.push(filter.startTime)
  }
  if (filter.endTime) {
    conditions.push('started_at <= ?')
    params.push(filter.endTime)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter.limit ?? 100
  const sql = `SELECT * FROM execution_logs ${where} ORDER BY started_at DESC LIMIT ?`
  params.push(limit)

  const rows = getDatabase().prepare(sql).all(...params) as ExecutionLogRow[]
  return rows.map(rowToExecutionLog)
}

export function getExecutionLog(id: string): ExecutionLog | null {
  const row = getDatabase()
    .prepare('SELECT * FROM execution_logs WHERE id = ?')
    .get(id) as ExecutionLogRow | undefined
  return row ? rowToExecutionLog(row) : null
}

export function createExecutionLog(log: Omit<ExecutionLog, 'finishedAt' | 'duration'>): ExecutionLog {
  getDatabase()
    .prepare(
      `INSERT INTO execution_logs (id, schedule_id, task_id, account_id, status, attempt, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      log.id,
      log.scheduleId ?? null,
      log.taskId,
      log.accountId,
      log.status,
      log.attempt,
      log.startedAt
    )
  return log as ExecutionLog
}

export function updateExecutionLog(
  id: string,
  patch: Partial<Pick<ExecutionLog, 'status' | 'finishedAt' | 'duration' | 'result' | 'error' | 'screenshots'>>
): ExecutionLog | null {
  const existing = getExecutionLog(id)
  if (!existing) return null
  const merged = { ...existing, ...patch }
  getDatabase()
    .prepare(
      `UPDATE execution_logs SET
        status = ?, finished_at = ?, duration = ?, result = ?, error = ?, screenshots = ?
       WHERE id = ?`
    )
    .run(
      merged.status,
      merged.finishedAt ?? null,
      merged.duration ?? null,
      merged.result ? JSON.stringify(merged.result) : null,
      merged.error ?? null,
      merged.screenshots ? JSON.stringify(merged.screenshots) : null,
      id
    )
  return merged
}

export function appendStateTransition(executionId: string, transition: StateTransition): void {
  // 简化实现：stateTransitions 暂存到 result 字段的扩展中
  const existing = getExecutionLog(executionId)
  if (!existing) return
  const transitions = (existing.result?.['_transitions'] as StateTransition[] | undefined) ?? []
  transitions.push(transition)
  updateExecutionLog(executionId, {
    result: { ...(existing.result ?? {}), _transitions: transitions }
  })
}
