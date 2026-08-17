// 代理配置
export interface ProxyConfig {
  mode: 'none' | 'simple' | 'mihomo'
  server?: string
  mihomoConfig?: string
}

// 账号（对应一个淘宝中控台账号）
export interface Account {
  id: string
  name: string
  taobaoUsername: string
  profilePath: string
  proxyConfig?: ProxyConfig
  notes: string
  createdAt: string
  lastLoginAt?: string
  loginStatus: 'unknown' | 'logged-in' | 'logged-out' | 'verification-required' | 'risk-control'
  lastLoginCheckAt?: string
}

// 任务（定义一个自动化操作）
export interface Task {
  id: string
  name: string
  type: 'live-control' | 'product' | 'custom'
  script: string
  config: Record<string, unknown>
  version: number
  timeoutMs: number
  retryPolicy: RetryPolicy
  createdAt: string
  updatedAt: string
}

// 调度规则（定时执行配置）
export interface Schedule {
  id: string
  taskId: string
  accountIds: string[]
  cronExpression: string
  timezone: string
  enabled: boolean
  misfirePolicy: 'skip' | 'run-once'
  maxConcurrency: number
  lastRunAt?: string
  nextRunAt?: string
  createdAt: string
}

// 执行记录（一次任务执行的日志）
export interface ExecutionLog {
  id: string
  scheduleId?: string
  taskId: string
  accountId: string
  status: ExecutionStatus
  attempt: number
  startedAt: string
  finishedAt?: string
  duration?: number
  result?: Record<string, unknown>
  error?: string
  screenshots?: string[]
}

// 执行状态
export type ExecutionStatus =
  | 'queued'
  | 'starting'
  | 'launching-browser'
  | 'connecting-cdp'
  | 'checking-login'
  | 'waiting-page'
  | 'running'
  | 'waiting-user'
  | 'retrying'
  | 'cancelling'
  | 'cancelled'
  | 'success'
  | 'failed'
  | 'timeout'

// 重试策略
export interface RetryPolicy {
  maxAttempts: number
  backoffMs: number
}

// 账号运行时状态
export interface AccountRuntime {
  accountId: string
  status: 'stopped' | 'starting' | 'running' | 'waiting-login' | 'error'
  pid?: number
  debugPort?: number
  cdpConnected: boolean
  currentUrl?: string
  startedAt?: string
  lastError?: string
}

// IPC 接口类型
export interface DockAPI {
  getVersion: () => Promise<string>
  getAppInfo: () => Promise<AppInfo>
}

// 应用信息
export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
}
