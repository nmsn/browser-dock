import { ipcMain } from 'electron'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import logger from './logger'
import { Keyring } from './secrets/keyring'
import {
  createAccount as dbCreateAccount,
  listAccounts as dbListAccounts,
  updateAccount as dbUpdateAccount,
  deleteAccount as dbDeleteAccount
} from './store/accounts'
import {
  createTask as dbCreateTask,
  listTasks as dbListTasks,
  updateTask as dbUpdateTask,
  deleteTask as dbDeleteTask
} from './store/tasks'
import {
  createSchedule as dbCreateSchedule,
  listSchedules as dbListSchedules,
  updateSchedule as dbUpdateSchedule,
  deleteSchedule as dbDeleteSchedule
} from './store/schedules'
import { listExecutionLogs } from './store/logs'
import { listDiagnostics, getDiagnostic } from './store/diagnostics'
import { getSettings, updateSettings, applyLaunchAtLogin } from './store/settings'
import { listBackups, backupDatabase } from './store/backup'
import { restoreDatabaseFromBackup } from './store/restore'
import { statSync } from 'fs'
import { startChromeForAccount, stopChromeForAccount, getRuntime, listRuntimes } from './chrome/manager'
import { createPageCdpClient } from './chrome/cdp-client'
import { startLogin, waitForLoginComplete } from './automation/taobao/login'
import { registerSchedule, unregisterSchedule, runTaskNow, syncAllSchedules } from './scheduler/service'
import { getNextRunTime } from './scheduler/cron-scheduler'
import { cancelExecution } from './cancel-registry'
import { exportExecutionLogsCsv } from './log-export'
import { initInspection } from './inspection'
import { PROFILES_PATH, DEFAULT_CONFIG } from './config'
import type {
  CreateAccountInput,
  Account,
  AccountRuntime,
  CreateTaskInput,
  CreateScheduleInput,
  UpdateSettingsInput,
  ScriptApi
} from '../shared/types'

/**
 * IPC 处理器注册
 * @see 文档 10.1 Electron 安全基线
 * - IPC 入参在主进程重新校验，不能信任 Renderer 类型声明
 * - 不允许 Renderer 直接执行任意脚本或访问文件系统
 */

/**
 * 校验任务脚本 API 白名单（文档 9.2）
 * 过滤未知值；undefined 保持 undefined（允许全部白名单 API）
 */
function normalizeAllowedApis(input: unknown): ScriptApi[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) throw new Error('allowedApis must be an array')
  const known = new Set<string>([
    'page.navigate',
    'page.waitForSelector',
    'page.click',
    'page.input',
    'page.evaluate',
    'page.screenshot',
    'logger.info',
    'logger.warn',
    'logger.error',
    'storage.get',
    'storage.set',
    'storage.delete'
  ])
  return input.filter((v): v is ScriptApi => typeof v === 'string' && known.has(v))
}

/**
 * 基于 Chrome 实例的调试端口启动登录流程
 */
async function startLoginFromInstance(debugPort: number): Promise<void> {
  const pageCdp = await createPageCdpClient(debugPort)
  try {
    await startLogin(pageCdp)
  } finally {
    pageCdp.disconnect()
  }
}

export function registerIpcHandlers(): void {
  // 应用信息
  ipcMain.handle('get-version', () => app.getVersion())
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }))

  // ============ 账号管理（文档 6.4 Profile 管理要求）============
  ipcMain.handle('accounts:list', () => dbListAccounts())

  ipcMain.handle('accounts:create', (_event, input: CreateAccountInput) => {
    // 主进程重新校验入参，不能信任 renderer
    if (!input || typeof input !== 'object') throw new Error('Invalid account input')
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new Error('Account name is required')
    }
    if (typeof input.taobaoUsername !== 'string') {
      throw new Error('taobaoUsername is required')
    }

    const id = randomUUID()
    // Profile 路径由应用生成，不允许脚本自定义（文档 6.4）
    const profilePath = join(PROFILES_PATH, id)

    const account: Account = {
      id,
      name: input.name.trim(),
      taobaoUsername: input.taobaoUsername.trim(),
      profilePath,
      proxyConfig: input.proxyConfig,
      notes: input.notes ?? '',
      createdAt: new Date().toISOString(),
      loginStatus: 'unknown'
    }
    const created = dbCreateAccount(account)
    logger.info({ accountId: created.id }, 'Account created')
    return created
  })

  ipcMain.handle('accounts:update', (_event, id: string, patch: Partial<Account>) => {
    if (typeof id !== 'string' || !id) throw new Error('Account id is required')
    if (!patch || typeof patch !== 'object') throw new Error('Invalid account patch')
    return dbUpdateAccount(id, patch)
  })

  ipcMain.handle('accounts:delete', (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('Account id is required')
    const deleted = dbDeleteAccount(id)
    if (deleted) logger.info({ accountId: id }, 'Account deleted')
    return deleted
  })

  // ============ 浏览器 / 登录流程（文档 6.2 启动流程 / 2.6.1 登录流程）============
  ipcMain.handle('browser:start', async (_event, accountId: string) => {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Account id is required')
    const account = dbListAccounts().find((a) => a.id === accountId)
    if (!account) throw new Error('ACCOUNT_NOT_FOUND')
    const instance = await startChromeForAccount(account)
    return instance.runtime
  })

  ipcMain.handle('browser:stop', async (_event, accountId: string) => {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Account id is required')
    await stopChromeForAccount(accountId)
    return true
  })

  ipcMain.handle('browser:get-runtime', (_event, accountId: string) => {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Account id is required')
    return getRuntime(accountId)
  })

  ipcMain.handle('browser:list-runtimes', () => listRuntimes())

  // 登录流程：打开淘宝登录页，等待用户手动完成登录
  ipcMain.handle('login:start', async (_event, accountId: string) => {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Account id is required')
    const account = dbListAccounts().find((a) => a.id === accountId)
    if (!account) throw new Error('ACCOUNT_NOT_FOUND')

    const runtime = getRuntime(accountId)
    if (!runtime?.debugPort) {
      // 自动先启动浏览器
      const instance = await startChromeForAccount(account)
      await startLoginFromInstance(instance.debugPort)
      return { started: true }
    }
    await startLoginFromInstance(runtime.debugPort)
    return { started: true }
  })

  ipcMain.handle('login:wait-result', async (_event, accountId: string, timeoutMs?: number) => {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Account id is required')
    const runtime = getRuntime(accountId)
    if (!runtime?.debugPort) throw new Error('BROWSER_NOT_RUNNING')
    const pageCdp = await createPageCdpClient(runtime.debugPort)
    try {
      const loggedIn = await waitForLoginComplete(pageCdp, timeoutMs ?? 120_000)
      if (loggedIn) {
        // 更新数据库登录状态（2.6.1 第 6 步）
        dbUpdateAccount(accountId, {
          loginStatus: 'logged-in',
          lastLoginAt: new Date().toISOString(),
          lastLoginCheckAt: new Date().toISOString()
        })
      }
      return { loggedIn }
    } finally {
      pageCdp.disconnect()
    }
  })

  // ============ 任务管理（文档 2.3.1 / 13.1）============
  ipcMain.handle('tasks:list', () => dbListTasks())

  ipcMain.handle('tasks:create', (_event, input: CreateTaskInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid task input')
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new Error('Task name is required')
    }
    if (typeof input.script !== 'string' || input.script.trim() === '') {
      throw new Error('Task script is required')
    }
    const task = dbCreateTask({
      id: `task-${randomUUID()}`,
      name: input.name.trim(),
      type: input.type ?? 'custom',
      script: input.script,
      config: input.config ?? {},
      allowedApis: normalizeAllowedApis(input.allowedApis),
      timeoutMs: input.timeoutMs ?? DEFAULT_CONFIG.defaultTimeoutMs,
      retryPolicy: input.retryPolicy ?? DEFAULT_CONFIG.defaultRetryPolicy
    })
    logger.info({ taskId: task.id }, 'Task created')
    return task
  })

  ipcMain.handle('tasks:update', (_event, id: string, patch: Partial<CreateTaskInput>) => {
    if (typeof id !== 'string' || !id) throw new Error('Task id is required')
    if (!patch || typeof patch !== 'object') throw new Error('Invalid task patch')
    const normalized: Partial<CreateTaskInput> = { ...patch }
    if (patch.allowedApis !== undefined) {
      normalized.allowedApis = normalizeAllowedApis(patch.allowedApis)
    }
    return dbUpdateTask(id, normalized)
  })

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('Task id is required')
    const deleted = dbDeleteTask(id)
    if (deleted) logger.info({ taskId: id }, 'Task deleted')
    return deleted
  })

  // ============ 调度管理（文档 2.3.1 / 5.2）============
  ipcMain.handle('schedules:list', () => {
    return dbListSchedules().map((s) => ({
      ...s,
      nextRunAt: getNextRunTime(s)?.toISOString() ?? s.nextRunAt
    }))
  })

  ipcMain.handle('schedules:create', (_event, input: CreateScheduleInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid schedule input')
    if (typeof input.taskId !== 'string' || !input.taskId) throw new Error('Task id is required')
    if (!Array.isArray(input.accountIds) || input.accountIds.length === 0) {
      throw new Error('At least one account is required')
    }
    const schedule = dbCreateSchedule({
      id: `schedule-${randomUUID()}`,
      taskId: input.taskId,
      accountIds: input.accountIds,
      cronExpression: input.cronExpression,
      timezone: input.timezone ?? 'Asia/Shanghai',
      enabled: input.enabled ?? true,
      misfirePolicy: input.misfirePolicy ?? 'skip',
      maxConcurrency: input.maxConcurrency ?? getSettings().maxConcurrency
    })
    logger.info({ scheduleId: schedule.id }, 'Schedule created')
    registerSchedule(schedule)
    return schedule
  })

  ipcMain.handle('schedules:update', (_event, id: string, patch: Partial<CreateScheduleInput>) => {
    if (typeof id !== 'string' || !id) throw new Error('Schedule id is required')
    if (!patch || typeof patch !== 'object') throw new Error('Invalid schedule patch')
    const updated = dbUpdateSchedule(id, patch)
    if (updated) registerSchedule(updated)
    return updated
  })

  ipcMain.handle('schedules:delete', (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('Schedule id is required')
    const deleted = dbDeleteSchedule(id)
    if (deleted) {
      unregisterSchedule(id)
      logger.info({ scheduleId: id }, 'Schedule deleted')
    }
    return deleted
  })

  // 密钥环操作（白名单 API）
  ipcMain.handle('keyring:set', (_event, key: string, value: string) => {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid keyring arguments')
    }
    Keyring.setPassword(key, value)
    logger.debug({ key }, 'Keyring set')
  })

  ipcMain.handle('keyring:get', (_event, key: string) => {
    if (typeof key !== 'string') throw new Error('Invalid keyring key')
    return Keyring.getPassword(key)
  })

  ipcMain.handle('keyring:delete', (_event, key: string) => {
    if (typeof key !== 'string') throw new Error('Invalid keyring key')
    return Keyring.deletePassword(key)
  })

  // ============ 任务执行（文档 2.6.2 定时任务执行流程 / 手工触发）============
  ipcMain.handle('execution:run', async (_event, taskId: string, accountIds: string[]) => {
    if (typeof taskId !== 'string') throw new Error('taskId is required')
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      throw new Error('At least one account is required')
    }
    const count = await runTaskNow(taskId, accountIds, getSettings().maxConcurrency)
    return { queued: count }
  })

  // 执行日志列表（用于执行监控页）
  ipcMain.handle('execution:list', (_event, filter?: { accountId?: string; taskId?: string; status?: string; limit?: number }) => {
    const { accountId, taskId, status, limit } = filter ?? {}
    return listExecutionLogs({
      accountId,
      taskId,
      status: status as NonNullable<Parameters<typeof listExecutionLogs>[0]>['status'],
      limit
    })
  })

  // 取消执行（文档 8.3 任务取消支持 AbortSignal）
  ipcMain.handle('execution:cancel', (_event, executionId: string) => {
    if (typeof executionId !== 'string' || !executionId) throw new Error('executionId is required')
    const cancelled = cancelExecution(executionId)
    if (cancelled) logger.info({ executionId }, 'Execution cancelled via IPC')
    return { cancelled }
  })

  // 导出执行日志（9.3 过滤敏感信息）
  ipcMain.handle('execution:export-csv', async () => {
    const path = await exportExecutionLogsCsv()
    return { path }
  })

  // 页面诊断（11.2 页面变更检测）
  ipcMain.handle('diagnostics:list', (_event, executionId: string) => {
    if (typeof executionId !== 'string' || !executionId) throw new Error('executionId is required')
    return listDiagnostics(executionId)
  })

  ipcMain.handle('diagnostics:get', (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('diagnostic id is required')
    return getDiagnostic(id)
  })

  // 应用设置（文档 2.3.1 设置）
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:update', (_event, patch: UpdateSettingsInput) => {
    const next = updateSettings(patch)
    if (patch.launchAtLogin !== undefined) {
      applyLaunchAtLogin(next.launchAtLogin)
    }
    if (patch.enableInspection !== undefined) {
      // 巡检开关变更后重新调度（文档 11.2）
      initInspection()
    }
    return next
  })

  // 数据库备份与恢复（文档 13.2）
  ipcMain.handle('backups:list', () => {
    return listBackups().map((b) => ({
      path: b.path,
      size: b.size,
      modifiedAt: b.modifiedAt.toISOString()
    }))
  })

  ipcMain.handle('backups:create', () => {
    const path = backupDatabase('manual')
    const stat = statSync(path)
    logger.info({ path }, 'Manual backup created via IPC')
    return { path, size: stat.size, modifiedAt: stat.mtime.toISOString() }
  })

  ipcMain.handle('backups:restore', (_event, backupPath: string) => {
    if (typeof backupPath !== 'string' || !backupPath) {
      throw new Error('Backup path is required')
    }
    restoreDatabaseFromBackup(backupPath)
    // 恢复后的调度可能与备份前不同，全量重新注册（5.2）
    syncAllSchedules()
    return true
  })

  logger.info('IPC handlers registered')
}
