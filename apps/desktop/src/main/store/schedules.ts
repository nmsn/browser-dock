import { getDatabase } from './database'
import type { Schedule, MisfirePolicy } from '../../shared/types'

/**
 * 调度规则 CRUD
 * @see 文档 2.5 schedules 表 / 5.2 调度流程 / 5.3 并发规则
 */

interface ScheduleRow {
  id: string
  task_id: string
  account_ids: string
  cron_expression: string
  timezone: string
  enabled: number
  misfire_policy: MisfirePolicy
  max_concurrency: number
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
}

function rowToSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    taskId: row.task_id,
    accountIds: JSON.parse(row.account_ids) as string[],
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    misfirePolicy: row.misfire_policy,
    maxConcurrency: row.max_concurrency,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    createdAt: row.created_at
  }
}

function scheduleToRow(schedule: Schedule): ScheduleRow {
  return {
    id: schedule.id,
    task_id: schedule.taskId,
    account_ids: JSON.stringify(schedule.accountIds),
    cron_expression: schedule.cronExpression,
    timezone: schedule.timezone,
    enabled: schedule.enabled ? 1 : 0,
    misfire_policy: schedule.misfirePolicy,
    max_concurrency: schedule.maxConcurrency,
    last_run_at: schedule.lastRunAt ?? null,
    next_run_at: schedule.nextRunAt ?? null,
    created_at: schedule.createdAt
  }
}

export function listSchedules(): Schedule[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM schedules ORDER BY created_at DESC')
    .all() as ScheduleRow[]
  return rows.map(rowToSchedule)
}

export function listEnabledSchedules(): Schedule[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM schedules WHERE enabled = 1')
    .all() as ScheduleRow[]
  return rows.map(rowToSchedule)
}

export function getSchedule(id: string): Schedule | null {
  const row = getDatabase()
    .prepare('SELECT * FROM schedules WHERE id = ?')
    .get(id) as ScheduleRow | undefined
  return row ? rowToSchedule(row) : null
}

export function createSchedule(schedule: Omit<Schedule, 'createdAt'>): Schedule {
  const full: Schedule = { ...schedule, createdAt: new Date().toISOString() }
  const row = scheduleToRow(full)
  getDatabase()
    .prepare(
      `INSERT INTO schedules
        (id, task_id, account_ids, cron_expression, timezone, enabled,
         misfire_policy, max_concurrency, last_run_at, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.task_id,
      row.account_ids,
      row.cron_expression,
      row.timezone,
      row.enabled,
      row.misfire_policy,
      row.max_concurrency,
      row.last_run_at,
      row.next_run_at,
      row.created_at
    )
  return full
}

export function updateSchedule(
  id: string,
  patch: Partial<Omit<Schedule, 'id' | 'createdAt'>>
): Schedule | null {
  const existing = getSchedule(id)
  if (!existing) return null
  const merged: Schedule = { ...existing, ...patch }
  const row = scheduleToRow(merged)
  getDatabase()
    .prepare(
      `UPDATE schedules SET
        task_id = ?, account_ids = ?, cron_expression = ?, timezone = ?,
        enabled = ?, misfire_policy = ?, max_concurrency = ?,
        last_run_at = ?, next_run_at = ?
       WHERE id = ?`
    )
    .run(
      row.task_id,
      row.account_ids,
      row.cron_expression,
      row.timezone,
      row.enabled,
      row.misfire_policy,
      row.max_concurrency,
      row.last_run_at,
      row.next_run_at,
      id
    )
  return merged
}

export function deleteSchedule(id: string): boolean {
  const result = getDatabase().prepare('DELETE FROM schedules WHERE id = ?').run(id)
  return result.changes > 0
}