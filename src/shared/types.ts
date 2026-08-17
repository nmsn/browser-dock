/**
 * 共享类型定义
 * 依据 docs/project-architecture-design.md 第 2.4、6.4、7.2、8.1、9.2、11 节
 */

// ============================================================================
// 代理配置
// ============================================================================

/**
 * 代理配置
 * @see 文档 2.4 ProxyConfig
 */
export interface ProxyConfig {
  mode: 'none' | 'simple' | 'mihomo'
  server?: string
  mihomoConfig?: string
}

// ============================================================================
// 账号相关
// ============================================================================

/**
 * 登录状态
 * @see 文档 2.4 Account.loginStatus
 */
export type LoginStatus =
  | 'unknown'
  | 'logged-in'
  | 'logged-out'
  | 'verification-required'
  | 'risk-control'

/**
 * 账号（对应一个淘宝中控台账号）
 * @see 文档 2.4 Account
 */
export interface Account {
  id: string
  name: string
  taobaoUsername: string
  profilePath: string
  proxyConfig?: ProxyConfig
  notes: string
  createdAt: string
  lastLoginAt?: string
  loginStatus: LoginStatus
  lastLoginCheckAt?: string
}

/**
 * 账号运行时状态
 * @see 文档 2.4 AccountRuntime / 6.1
 */
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

// ============================================================================
// 任务相关
// ============================================================================

/**
 * 任务类型
 * @see 文档 2.4 Task.type
 */
export type TaskType = 'live-control' | 'product' | 'custom'

/**
 * 重试策略
 * @see 文档 2.4 RetryPolicy
 */
export interface RetryPolicy {
  maxAttempts: number
  backoffMs: number
}

/**
 * 任务（定义一个自动化操作）
 * @see 文档 2.4 Task
 */
export interface Task {
  id: string
  name: string
  type: TaskType
  script: string
  config: Record<string, unknown>
  version: number
  timeoutMs: number
  retryPolicy: RetryPolicy
  createdAt: string
  updatedAt: string
}

// ============================================================================
// 调度相关
// ============================================================================

/**
 * 错过执行策略
 * @see 文档 2.4 Schedule.misfirePolicy
 */
export type MisfirePolicy = 'skip' | 'run-once'

/**
 * 调度规则（定时执行配置）
 * @see 文档 2.4 Schedule / 5.2
 */
export interface Schedule {
  id: string
  taskId: string
  accountIds: string[]
  cronExpression: string
  timezone: string
  enabled: boolean
  misfirePolicy: MisfirePolicy
  maxConcurrency: number
  lastRunAt?: string
  nextRunAt?: string
  createdAt: string
}

/**
 * 执行批次
 * @see 文档 5.2 调度流程
 */
export interface ExecutionBatch {
  id: string
  scheduleId: string
  taskId: string
  accountIds: string[]
  startedAt: string
  finishedAt?: string
}

// ============================================================================
// 执行日志相关
// ============================================================================

/**
 * 执行状态
 * @see 文档 2.4 ExecutionStatus / 8.2
 */
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

/**
 * 执行记录（一次任务执行的日志）
 * @see 文档 2.4 ExecutionLog / 11.1
 */
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
  // 11.1 监控字段
  chromePid?: number
  cdpConnected?: boolean
  currentUrl?: string
  stateTransitions?: StateTransition[]
}

export interface StateTransition {
  from: ExecutionStatus | 'init'
  to: ExecutionStatus
  at: string
  message?: string
}

// ============================================================================
// 错误处理
// ============================================================================

/**
 * 错误分类（错误码前缀）
 * @see 文档 15.5
 */
export type ErrorCategory =
  | 'BR' // 浏览器
  | 'CDP' // CDP
  | 'PF' // Profile
  | 'LG' // 登录
  | 'PG' // 页面
  | 'NT' // 网络
  | 'TK' // 任务

/**
 * 错误类型
 * @see 文档 8.1 错误分类
 */
export type ErrorType =
  | 'browser-launch-failed'
  | 'cdp-connect-failed'
  | 'profile-locked'
  | 'login-expired'
  | 'verification-required'
  | 'risk-control'
  | 'selector-not-found'
  | 'network-timeout'
  | 'page-changed'
  | 'user-intervention-required'
  | 'task-timeout'
  | 'unknown'

/**
 * 应用错误
 * @see 文档 8.1 错误分类 + 15.5 错误码字典
 */
export interface AppError {
  code: string // 错误码，如 BR_LAUNCH_FAILED
  category: ErrorCategory
  type: ErrorType
  message: string
  cause?: unknown
  stack?: string
  context?: Record<string, unknown>
}

// ============================================================================
// 自动化运行时抽象层
// ============================================================================

/**
 * 任务日志接口
 * @see 文档 7.2 AutomationContext
 */
export interface TaskLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, error?: unknown, data?: Record<string, unknown>): void
  debug(message: string, data?: Record<string, unknown>): void
}

/**
 * 页面适配器
 * @see 文档 7.2 PageAdapter
 */
export interface PageAdapter {
  navigate(url: string): Promise<void>
  waitForSelector(selector: string, timeoutMs: number): Promise<void>
  click(selector: string): Promise<void>
  input(selector: string, value: string): Promise<void>
  evaluate<T>(expression: string): Promise<T>
  screenshot(name: string): Promise<string>
}

/**
 * 存储适配器
 * @see 文档 7.2 StorageAdapter
 */
export interface StorageAdapter {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * 网络适配器
 * @see 文档 7.2 NetworkAdapter
 */
export interface NetworkAdapter {
  onRequest(callback: (request: NetworkRequest) => void): void
  onResponse(callback: (response: NetworkResponse) => void): void
  getCookies(domain?: string): Promise<NetworkCookie[]>
}

export interface NetworkRequest {
  url: string
  method: string
  headers: Record<string, string>
}

export interface NetworkResponse {
  url: string
  status: number
  headers: Record<string, string>
}

export interface NetworkCookie {
  name: string
  value: string
  domain: string
  path: string
}

/**
 * 账号上下文
 * @see 文档 7.2 AccountContext
 */
export interface AccountContext {
  accountId: string
  accountName: string
  profilePath: string
  proxy?: ProxyConfig
}

/**
 * 自动化上下文（提供给任务脚本的运行时）
 * @see 文档 7.2 AutomationContext
 */
export interface AutomationContext {
  account: AccountContext
  page: PageAdapter
  storage: StorageAdapter
  network: NetworkAdapter
  logger: TaskLogger
  signal: AbortSignal
}

// ============================================================================
// 脚本权限边界
// ============================================================================

/**
 * 允许的脚本 API 白名单
 * @see 文档 9.2 脚本权限边界
 */
export type ScriptApi =
  | 'page.navigate'
  | 'page.waitForSelector'
  | 'page.click'
  | 'page.input'
  | 'page.evaluate'
  | 'page.screenshot'
  | 'logger.info'
  | 'logger.warn'
  | 'logger.error'
  | 'storage.get'
  | 'storage.set'
  | 'storage.delete'

// ============================================================================
// 应用信息
// ============================================================================

/**
 * 应用信息（IPC: get-app-info）
 */
export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
}

/**
 * IPC 接口契约
 */
export interface DockAPI {
  getVersion: () => Promise<string>
  getAppInfo: () => Promise<AppInfo>
}

// ============================================================================
// 数据库相关
// ============================================================================

/**
 * 数据库迁移记录
 * @see 文档 2.5 schema_migrations / 13.2
 */
export interface SchemaMigration {
  version: number
  appliedAt: string
}

/**
 * 账号锁（同一账号同一时间只能有一个执行）
 * @see 文档 2.5 account_locks / 5.3
 */
export interface AccountLock {
  accountId: string
  executionId: string
  acquiredAt: string
}

// ============================================================================
// 页面诊断（用于异常恢复）
// ============================================================================

/**
 * 页面诊断信息（任务失败时自动保存）
 * @see 文档 11.2 页面变更检测
 */
export interface PageDiagnostic {
  url: string
  title: string
  timestamp: string
  domSnapshot?: string
  screenshotPath?: string
  consoleErrors?: string[]
  networkErrors?: NetworkResponse[]
}
