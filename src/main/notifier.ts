import { Notification, app } from 'electron'
import type { ExecutionLog } from '../shared/types'
import { getSettings } from './store/settings'

/**
 * 执行结果通知
 * @see 文档 Phase 4 执行结果通知
 *
 * 通过系统通知 API 在任务完成时弹出系统通知，点击通知聚焦主窗口。
 */

let initialized = false

function notify(title: string, body: string): boolean {
  if (!getSettings().notifyOnExecution) return false
  if (!Notification.isSupported()) return false
  try {
    const notification = new Notification({ title, body, silent: false })
    notification.show()
    return true
  } catch (err) {
    // 通知失败不应阻塞主流程
    // eslint-disable-next-line no-console
    console.warn('Failed to show notification:', err)
    return false
  }
}

/**
 * 初始化通知（确保 app 已 ready + 设置 appId）
 */
export function initNotifier(): void {
  if (initialized) return
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setAppUserModelId('com.nmsn.browser-dock')
  }
  initialized = true
}

/**
 * 发送执行结果通知
 */
export function notifyExecutionResult(
  log: ExecutionLog,
  options: { taskName: string; accountName: string }
): void {
  if (!getSettings().notifyOnExecution) return
  if (!Notification.isSupported()) return

  const { taskName, accountName } = options
  let title = ''
  let body = ''

  switch (log.status) {
    case 'success':
      title = '✓ 任务执行成功'
      body = `${taskName} · ${accountName} · ${log.duration ? `${(log.duration / 1000).toFixed(1)}s` : ''}`
      break
    case 'failed':
    case 'timeout':
      title = log.status === 'timeout' ? '⏱ 任务超时' : '✕ 任务失败'
      body = `${taskName} · ${accountName} · ${log.error ?? '未知错误'}`
      break
    case 'cancelled':
      title = '⊘ 任务已取消'
      body = `${taskName} · ${accountName}`
      break
    default:
      return // 其他状态不发通知
  }

  notify(title, body)
}

/**
 * 定时任务开始通知（仅调度来源调用）
 */
export function notifyExecutionStart(
  _log: Partial<ExecutionLog>,
  options: { taskName: string; accountName: string }
): void {
  notify('▶ 定时任务开始', `${options.taskName} · ${options.accountName}`)
}

/**
 * 定时批次汇总通知（全部账号执行完毕后调用）
 */
export function notifyExecutionSummary(
  options: { taskName: string; success: number; failed: number }
): void {
  const total = options.success + options.failed
  notify(
    options.failed === 0 ? '✓ 定时任务完成' : '⚠ 定时任务完成（部分失败）',
    `${options.taskName} · 共 ${total} 个账号：成功 ${options.success} / 失败 ${options.failed}`
  )
}