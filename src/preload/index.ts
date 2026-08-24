import { contextBridge, ipcRenderer } from 'electron'
import type {
  DockAPI,
  CreateAccountInput,
  Account,
  CreateTaskInput,
  Task,
  CreateScheduleInput,
  Schedule,
  ExecutionLog,
  ExecutionStatus,
  PageDiagnostic,
  UpdateSettingsInput,
  BackupInfo
} from '../shared/types'

/**
 * 暴露到 renderer 的 API
 * @see 文档 10.1 Electron 安全基线
 * - 只暴露白名单 API
 * - 不允许 Renderer 直接访问文件系统 / Node
 */
const api: DockAPI = {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // 账号管理
  accountsList: () => ipcRenderer.invoke('accounts:list'),
  accountsCreate: (input: CreateAccountInput) => ipcRenderer.invoke('accounts:create', input),
  accountsUpdate: (id: string, patch: Partial<Omit<Account, 'id' | 'createdAt'>>) =>
    ipcRenderer.invoke('accounts:update', id, patch),
  accountsDelete: (id: string) => ipcRenderer.invoke('accounts:delete', id),

  // 浏览器 / Profile 生命周期
  browserStart: (accountId: string) => ipcRenderer.invoke('browser:start', accountId),
  browserStop: (accountId: string) => ipcRenderer.invoke('browser:stop', accountId),
  browserGetRuntime: (accountId: string) => ipcRenderer.invoke('browser:get-runtime', accountId),
  browserListRuntimes: () => ipcRenderer.invoke('browser:list-runtimes'),

  // 淘宝登录流程
  loginStart: (accountId: string) => ipcRenderer.invoke('login:start', accountId),
  loginWaitResult: (accountId: string, timeoutMs?: number) =>
    ipcRenderer.invoke('login:wait-result', accountId, timeoutMs),

  // 任务管理
  tasksList: () => ipcRenderer.invoke('tasks:list'),
  tasksCreate: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
  tasksUpdate: (id: string, patch: Partial<Omit<Task, 'id' | 'createdAt' | 'version'>>) =>
    ipcRenderer.invoke('tasks:update', id, patch),
  tasksDelete: (id: string) => ipcRenderer.invoke('tasks:delete', id),

  // 内置功能
  featuresList: () => ipcRenderer.invoke('features:list'),

  // 调度管理
  schedulesList: () => ipcRenderer.invoke('schedules:list'),
  schedulesCreate: (input: CreateScheduleInput) => ipcRenderer.invoke('schedules:create', input),
  schedulesUpdate: (id: string, patch: Partial<Omit<Schedule, 'id' | 'createdAt'>>) =>
    ipcRenderer.invoke('schedules:update', id, patch),
  schedulesDelete: (id: string) => ipcRenderer.invoke('schedules:delete', id),

  // 任务执行
  executionRun: (taskId: string, accountIds: string[]) =>
    ipcRenderer.invoke('execution:run', taskId, accountIds),
  executionList: (filter?: { accountId?: string; taskId?: string; status?: string; limit?: number }) =>
    ipcRenderer.invoke('execution:list', filter ?? {}),
  executionCancel: (executionId: string) =>
    ipcRenderer.invoke('execution:cancel', executionId),
  executionExportCsv: () => ipcRenderer.invoke('execution:export-csv'),

  // 页面诊断
  diagnosticsList: (executionId: string) =>
    ipcRenderer.invoke('diagnostics:list', executionId),
  diagnosticsGet: (id: string) => ipcRenderer.invoke('diagnostics:get', id),

  // 运行日志
  executionRunLogs: (executionId: string) => ipcRenderer.invoke('execution:run-logs', executionId),

  // 应用设置
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (patch: UpdateSettingsInput) => ipcRenderer.invoke('settings:update', patch),

  // 数据库备份与恢复
  backupsList: () => ipcRenderer.invoke('backups:list'),
  backupsCreate: () => ipcRenderer.invoke('backups:create'),
  backupsRestore: (backupPath: string) => ipcRenderer.invoke('backups:restore', backupPath),

  // 执行事件订阅（文档 11.3 实时状态）
  onExecutionStatus: (callback: (status: ExecutionStatus, log: Partial<ExecutionLog>) => void) => {
    const handler = (_e: unknown, payload: { status: ExecutionStatus; log: Partial<ExecutionLog> }) =>
      callback(payload.status, payload.log)
    ipcRenderer.on('execution:status', handler)
    return () => ipcRenderer.removeListener('execution:status', handler)
  },
  onExecutionLog: (callback: (log: ExecutionLog) => void) => {
    const handler = (_e: unknown, log: ExecutionLog) => callback(log)
    ipcRenderer.on('execution:log', handler)
    return () => ipcRenderer.removeListener('execution:log', handler)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('dock', api)
} else {
  // @ts-ignore
  window.dock = api
}