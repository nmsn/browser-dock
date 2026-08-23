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
 * @see 文档 2.4 Task.type / docs/c48-integration-plan.md Phase C
 * - feature：内置功能（主进程编排，payload 参数化）
 * - custom：用户手写 JS（vm 沙箱 + allowedApis 白名单）
 */
export type TaskType = 'feature' | 'custom'

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
  /** 任务级脚本 API 白名单（文档 9.2）；undefined 表示允许全部白名单 API（仅 custom 生效） */
  allowedApis?: ScriptApi[]
  /** type === 'feature' 时使用的内置功能 id */
  featureId?: string
  /** type === 'feature' 时的功能参数 */
  payload?: Record<string, unknown>
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

// ============================================================================
// 应用设置
// ============================================================================

/**
 * 应用设置（全局配置，持久化到 userData/settings.json）
 * @see 文档 2.3.1 设置 / 10.3 应用退出和系统能力
 */
export interface AppSettings {
  /** Chrome 可执行文件路径，空字符串表示自动检测 */
  chromePath: string
  /** 全局并发上限（同时执行的账号数） */
  maxConcurrency: number
  /** 执行日志保留天数 */
  logRetentionDays: number
  /** 截图 / DOM 快照保留天数（文档 9.3 默认 30 天） */
  screenshotRetentionDays: number
  /** 任务结束时发送系统通知 */
  notifyOnExecution: boolean
  /** 开机自启动 */
  launchAtLogin: boolean
  /** 关闭窗口时最小化到系统托盘（文档 10.3） */
  closeToTray: boolean
  /** 低频巡检：每日检查已登录账号中控台页面可用性（文档 11.2） */
  enableInspection: boolean
}

/**
 * 设置更新输入（Partial，主进程校验）
 */
export type UpdateSettingsInput = Partial<AppSettings>

/**
 * 数据库备份信息
 * @see 文档 13.2 / 9.3
 */
export interface BackupInfo {
  path: string
  size: number
  modifiedAt: string
}

/**
 * 创建账号输入
 * id 由主进程生成，createdAt/loginStatus 由主进程初始化
 */
export interface CreateAccountInput {
  name: string
  taobaoUsername: string
  proxyConfig?: ProxyConfig
  notes?: string
}

/**
 * IPC 接口契约
 * hand-written types + contextBridge（文档 15.3 IPC 选型）
 */
export interface DockAPI {
  getVersion: () => Promise<string>
  getAppInfo: () => Promise<AppInfo>

  // 账号管理
  accountsList: () => Promise<Account[]>
  accountsCreate: (input: CreateAccountInput) => Promise<Account>
  accountsUpdate: (id: string, patch: Partial<Omit<Account, 'id' | 'createdAt'>>) => Promise<Account | null>
  accountsDelete: (id: string) => Promise<boolean>

  // 浏览器 / Profile 生命周期（文档 6.2 / 6.3）
  browserStart: (accountId: string) => Promise<AccountRuntime>
  browserStop: (accountId: string) => Promise<boolean>
  browserGetRuntime: (accountId: string) => Promise<AccountRuntime | null>
  browserListRuntimes: () => Promise<AccountRuntime[]>

  // 淘宝登录流程（文档 2.6.1）
  loginStart: (accountId: string) => Promise<{ started: boolean }>
  loginWaitResult: (accountId: string, timeoutMs?: number) => Promise<{ loggedIn: boolean }>

  // 任务管理（文档 2.3.1 任务管理 / 13.1 版本管理）
  tasksList: () => Promise<Task[]>
  tasksCreate: (input: CreateTaskInput) => Promise<Task>
  tasksUpdate: (id: string, patch: Partial<Omit<Task, 'id' | 'createdAt' | 'version'>>) => Promise<Task | null>
  tasksDelete: (id: string) => Promise<boolean>

  // 内置功能
  featuresList: () => Promise<FeatureInfo[]>

  // 调度管理（文档 2.3.1 调度管理）
  schedulesList: () => Promise<Schedule[]>
  schedulesCreate: (input: CreateScheduleInput) => Promise<Schedule>
  schedulesUpdate: (id: string, patch: Partial<Omit<Schedule, 'id' | 'createdAt'>>) => Promise<Schedule | null>
  schedulesDelete: (id: string) => Promise<boolean>

  // 任务执行（文档 2.6.2）
  executionRun: (taskId: string, accountIds: string[]) => Promise<{ queued: number }>
  executionList: (filter?: ExecutionLogFilter) => Promise<ExecutionLog[]>
  executionCancel: (executionId: string) => Promise<{ cancelled: boolean }>
  executionExportCsv: () => Promise<{ path: string | null }>

  // 页面诊断（文档 11.2）
  diagnosticsList: (executionId: string) => Promise<PageDiagnostic[]>
  diagnosticsGet: (id: string) => Promise<PageDiagnostic | null>

  // 应用设置（文档 2.3.1 设置）
  settingsGet: () => Promise<AppSettings>
  settingsUpdate: (patch: UpdateSettingsInput) => Promise<AppSettings>

  // 数据库备份与恢复（文档 13.2）
  backupsList: () => Promise<BackupInfo[]>
  backupsCreate: () => Promise<BackupInfo>
  backupsRestore: (backupPath: string) => Promise<boolean>

  // 执行事件订阅（文档 11.3 实时状态）
  onExecutionStatus: (callback: (status: ExecutionStatus, log: Partial<ExecutionLog>) => void) => () => void
  onExecutionLog: (callback: (log: ExecutionLog) => void) => () => void
}

/**
 * 执行日志筛选
 */
export interface ExecutionLogFilter {
  accountId?: string
  taskId?: string
  status?: ExecutionStatus
  limit?: number
}

/**
 * 创建任务输入
 * id/version/createdAt/updatedAt 由主进程生成
 */
export interface CreateTaskInput {
  name: string
  type: TaskType
  script: string
  config?: Record<string, unknown>
  allowedApis?: ScriptApi[]
  featureId?: string
  payload?: Record<string, unknown>
  timeoutMs?: number
  retryPolicy?: RetryPolicy
}

// ============================================================================
// 内置功能（feature 任务）
// ============================================================================

/** 功能表单选项（级联树节点） */
export interface FeatureFieldOption {
  label: string
  value: string
  children?: FeatureFieldOption[]
}

/** 功能参数字段描述（驱动 UI 动态表单） */
export interface FeatureField {
  key: string
  label: string
  type: 'string' | 'cascader'
  required?: boolean
  placeholder?: string
  help?: string
  /** type === 'cascader' 时的选项树 */
  options?: FeatureFieldOption[]
}

export interface FeatureInfo {
  id: string
  label: string
  fields: FeatureField[]
}

/**
 * 创建调度规则输入
 * id/createdAt 由主进程生成
 */
export interface CreateScheduleInput {
  taskId: string
  accountIds: string[]
  cronExpression: string
  timezone?: string
  enabled?: boolean
  misfirePolicy?: MisfirePolicy
  maxConcurrency?: number
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
