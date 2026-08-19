import { contextBridge, ipcRenderer } from 'electron'
import type {
  DockAPI,
  CreateAccountInput,
  Account,
  CreateTaskInput,
  Task,
  CreateScheduleInput,
  Schedule
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
    ipcRenderer.invoke('execution:list', filter ?? {})
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('dock', api)
} else {
  // @ts-ignore
  window.dock = api
}