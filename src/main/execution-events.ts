import { BrowserWindow } from 'electron'
import type { ExecutionLog, ExecutionStatus } from '../shared/types'

/**
 * 执行事件推送
 * @see 文档 11.3 执行监控 UI 实时状态
 *
 * 主进程通过 webContents.send 向 renderer 推送执行状态变化事件。
 * renderer 通过 preload 暴露的订阅机制接收。
 */

const EVENT_CHANNEL = 'execution:status'

/**
 * 推送执行状态变化
 */
export function emitExecutionStatus(status: ExecutionStatus, log: Partial<ExecutionLog>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(EVENT_CHANNEL, { status, log })
  }
}

/**
 * 推送执行日志（含最终结果）
 */
export function emitExecutionLog(log: ExecutionLog): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('execution:log', log)
  }
}