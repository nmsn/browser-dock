import { contextBridge, ipcRenderer } from 'electron'
import type { DockAPI, CreateAccountInput, Account } from '../shared/types'

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
    ipcRenderer.invoke('login:wait-result', accountId, timeoutMs)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('dock', api)
} else {
  // @ts-ignore
  window.dock = api
}