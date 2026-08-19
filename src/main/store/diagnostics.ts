import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import type { PageDiagnostic } from '../../shared/types'

/**
 * 页面诊断 CRUD（文档 11.2 页面变更检测）
 *
 * 任务失败/选择器失效时自动保存：
 * - 当前 URL
 * - 页面标题
 * - DOM 快照（outerHTML）
 * - 截图（PNG）
 * - Console 错误
 */

interface DiagnosticRow {
  id: string
  execution_id: string
  url: string | null
  title: string | null
  dom_snapshot_path: string | null
  screenshot_path: string | null
  console_errors: string | null
  captured_at: string
}

interface CreateDiagnosticInput {
  executionId: string
  url?: string
  title?: string
  domSnapshotPath?: string
  screenshotPath?: string
  consoleErrors?: string[]
}

export function createDiagnostic(input: CreateDiagnosticInput): PageDiagnostic {
  const db = getDatabase()
  const row: DiagnosticRow = {
    id: `diag-${randomUUID()}`,
    execution_id: input.executionId,
    url: input.url ?? null,
    title: input.title ?? null,
    dom_snapshot_path: input.domSnapshotPath ?? null,
    screenshot_path: input.screenshotPath ?? null,
    console_errors: input.consoleErrors ? JSON.stringify(input.consoleErrors) : null,
    captured_at: new Date().toISOString()
  }
  db.prepare(
    `INSERT INTO page_diagnostics
      (id, execution_id, url, title, dom_snapshot_path, screenshot_path, console_errors, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.execution_id,
    row.url,
    row.title,
    row.dom_snapshot_path,
    row.screenshot_path,
    row.console_errors,
    row.captured_at
  )
  return {
    url: row.url ?? '',
    title: row.title ?? '',
    timestamp: row.captured_at,
    domSnapshot: row.dom_snapshot_path ?? undefined,
    screenshotPath: row.screenshot_path ?? undefined,
    consoleErrors: row.console_errors ? (JSON.parse(row.console_errors) as string[]) : undefined
  }
}

export function listDiagnostics(executionId: string): PageDiagnostic[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM page_diagnostics WHERE execution_id = ? ORDER BY captured_at DESC')
    .all(executionId) as DiagnosticRow[]
  return rows.map((row) => ({
    url: row.url ?? '',
    title: row.title ?? '',
    timestamp: row.captured_at,
    domSnapshot: row.dom_snapshot_path ?? undefined,
    screenshotPath: row.screenshot_path ?? undefined,
    consoleErrors: row.console_errors ? (JSON.parse(row.console_errors) as string[]) : undefined
  }))
}

export function getDiagnostic(id: string): PageDiagnostic | null {
  const row = getDatabase()
    .prepare('SELECT * FROM page_diagnostics WHERE id = ?')
    .get(id) as DiagnosticRow | undefined
  if (!row) return null
  return {
    url: row.url ?? '',
    title: row.title ?? '',
    timestamp: row.captured_at,
    domSnapshot: row.dom_snapshot_path ?? undefined,
    screenshotPath: row.screenshot_path ?? undefined,
    consoleErrors: row.console_errors ? (JSON.parse(row.console_errors) as string[]) : undefined
  }
}