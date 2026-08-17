import { getDatabase } from './database'
import type { Task, TaskType, RetryPolicy } from '../../shared/types'

/**
 * 任务 CRUD
 * @see 文档 2.5 tasks 表 / 13.1 任务和脚本版本
 */

interface TaskRow {
  id: string
  name: string
  type: TaskType
  script: string
  config: string | null
  version: number
  timeout_ms: number
  retry_policy: string
  created_at: string
  updated_at: string
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    script: row.script,
    config: row.config ? (JSON.parse(row.config) as Record<string, unknown>) : {},
    version: row.version,
    timeoutMs: row.timeout_ms,
    retryPolicy: JSON.parse(row.retry_policy) as RetryPolicy,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listTasks(): Task[] {
  const rows = getDatabase().prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all() as TaskRow[]
  return rows.map(rowToTask)
}

export function getTask(id: string): Task | null {
  const row = getDatabase().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
  return row ? rowToTask(row) : null
}

export function createTask(task: Omit<Task, 'createdAt' | 'updatedAt' | 'version'>): Task {
  const now = new Date().toISOString()
  const full: Task = { ...task, version: 1, createdAt: now, updatedAt: now }
  getDatabase()
    .prepare(
      `INSERT INTO tasks (id, name, type, script, config, version, timeout_ms, retry_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      full.id,
      full.name,
      full.type,
      full.script,
      JSON.stringify(full.config),
      full.version,
      full.timeoutMs,
      JSON.stringify(full.retryPolicy),
      full.createdAt,
      full.updatedAt
    )
  return full
}

export function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Task | null {
  const existing = getTask(id)
  if (!existing) return null
  const merged: Task = {
    ...existing,
    ...patch,
    version: existing.version + 1,
    updatedAt: new Date().toISOString()
  }
  getDatabase()
    .prepare(
      `UPDATE tasks SET
        name = ?, type = ?, script = ?, config = ?, version = ?,
        timeout_ms = ?, retry_policy = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      merged.name,
      merged.type,
      merged.script,
      JSON.stringify(merged.config),
      merged.version,
      merged.timeoutMs,
      JSON.stringify(merged.retryPolicy),
      merged.updatedAt,
      id
    )
  return merged
}

export function deleteTask(id: string): boolean {
  const result = getDatabase().prepare('DELETE FROM tasks WHERE id = ?').run(id)
  return result.changes > 0
}
