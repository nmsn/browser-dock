import { powerSaveBlocker } from 'electron'
import { runInNewContext } from 'vm'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type {
  Account,
  AutomationContext,
  ExecutionLog,
  ExecutionStatus,
  PageAdapter,
  ScriptApi,
  StateTransition,
  Task
} from '../../shared/types'
import logger from '../logger'
import { SCREENSHOTS_PATH } from '../config'
import { startChromeForAccount, stopChromeForAccount, getRuntime as getChromeRuntime } from '../chrome/manager'
import { createPageCdpClient } from '../chrome/cdp-client'
import { ensureAccountView, getAccountView, waitForWindowOpenUrl, type AccountViewEntry } from '../window/manager'
import { ElectronPageAdapter } from '../automation/runtime/electron-page-adapter'
import { ElectronNetworkAdapter } from '../automation/runtime/electron-network-adapter'
import { buildAutomationContext } from '../automation/runtime/automation-context'
import { createExecutionLog as dbCreateLog, updateExecutionLog as dbUpdateLog, appendStateTransition as dbAppendTransition } from '../store/logs'
import { acquireAccountLock, releaseAccountLock } from '../store/account-locks'
import { createDiagnostic } from '../store/diagnostics'
import { emitExecutionStatus, emitExecutionLog } from '../execution-events'
import { registerCancellable, unregisterCancellable } from '../cancel-registry'
import { notifyExecutionResult, notifyExecutionStart } from '../notifier'
import { NetworkCaptureService } from '../automation/network-capture'
import type { CdpClient } from '../chrome/cdp-client'
import {
  getFeature,
  type EmbeddedFeatureContext,
  type ExternalFeatureContext,
  type FeatureRunResult
} from '../automation/features'
import { getSettings } from '../store/settings'

/**
 * 任务执行器
 * @see 文档 8.2 错误处理策略 / 8.3 重试原则 / 9.2 脚本权限边界
 * @see docs/adr/0001-embedded-electron-execution-host.md
 *
 * 双轨执行宿主（按 feature.runtime 分派）：
 * - embedded（默认基座）：嵌入式账号视图（BaseWindow + WebContentsView），
 *   视图跨执行持久（登录态在分区会话里），执行期 powerSaveBlocker 防系统休眠，
 *   backgroundThrottling:false 保证隐藏窗口全速运行。
 * - external-chrome（@deprecated 过渡期，仅 c48）：启动外部 Chrome + CDP，
 *   执行完关闭实例（旧行为不变）。
 *
 * 流程（文档 6.2 / 2.6.2）：
 * 1. 获取全局并发槽位 + 账号互斥锁
 * 2. 打开执行宿主（账号视图 / Chrome）
 * 3. 构造执行上下文（feature 直编 / vm 沙箱脚本）
 * 4. 更新执行日志状态，收尾释放（视图保留、Chrome 关闭、锁释放）
 */

export interface ExecuteOptions {
  signal?: AbortSignal
  onStateChange?: (status: ExecutionStatus) => void
  /** 执行来源：定时调度时发送开始通知并回填 schedule_id */
  source?: 'schedule' | 'manual' | 'inspection'
  scheduleId?: string
}

interface ExecutionRecord extends ExecutionLog {
  stateTransitions: StateTransition[]
}

/**
 * 执行单个任务（含执行宿主的完整生命周期）
 */
export async function executeTask(
  account: Account,
  task: Task,
  options: ExecuteOptions = {}
): Promise<ExecutionLog> {
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // 全局并发槽位是否已获得（finally 中按需释放）
  let slotAcquired = false

  // 创建执行日志
  const execution = dbCreateLog({
    id: executionId,
    scheduleId: options.scheduleId,
    taskId: task.id,
    accountId: account.id,
    status: 'queued',
    attempt: 1,
    startedAt: new Date().toISOString()
  }) as ExecutionRecord
  execution.stateTransitions = [{ from: 'init', to: 'queued', at: execution.startedAt }]

  const record = (status: ExecutionStatus, message?: string): void => {
    const now = new Date().toISOString()
    const from = execution.status
    execution.status = status
    execution.stateTransitions.push({ from, to: status, at: now, message })
    dbUpdateLog(executionId, { status })
    for (const t of execution.stateTransitions) dbAppendTransition(executionId, t)
    options.onStateChange?.(status)
    // 实时推送状态到 UI（文档 11.3）
    emitExecutionStatus(status, { id: executionId, taskId: task.id, accountId: account.id, status })
  }

  // 取消控制器先于排队注册，等待槽位期间也可取消（文档 8.3）
  const abortController = new AbortController()
  options.signal?.addEventListener('abort', () => abortController.abort(options.signal?.reason))
  registerCancellable(executionId, abortController)

  // 全局并发闸门：跨调度/手动/巡检统一限制同时执行的账号数；
  // 排队时间不计入任务超时（timeout 在获得槽位后起算）
  try {
    await acquireGlobalSlot(abortController.signal)
  } catch (err) {
    record('cancelled', 'Cancelled while queued')
    dbUpdateLog(executionId, { finishedAt: new Date().toISOString() })
    unregisterCancellable(executionId)
    throw err
  }
  slotAcquired = true

  // 账号互斥锁（5.3 同一账号同一时间只执行一个任务）
  if (!acquireAccountLock(account.id, executionId)) {
    const err = new Error('PROFILE_LOCKED: account is already running')
    record('failed', err.message)
    throw err
  }

  const startTime = Date.now()
  const timeoutMs = task.timeoutMs ?? 120_000
  const timeoutId = setTimeout(() => abortController.abort('timeout'), timeoutMs)

  // 执行宿主分派：feature.runtime 标注执行宿主；custom 脚本走嵌入式基座
  const feature = task.type === 'feature' && task.featureId ? getFeature(task.featureId) : null
  if (task.type === 'feature' && !feature) {
    const err = new Error(`TK_FEATURE_NOT_FOUND: ${task.featureId ?? '(no featureId)'}`)
    record('failed', err.message)
    releaseGlobalSlot()
    slotAcquired = false
    unregisterCancellable(executionId)
    releaseAccountLock(account.id)
    throw err
  }
  const useEmbedded = task.type === 'custom' || feature!.runtime === 'embedded'

  let cdp: Awaited<ReturnType<typeof createPageCdpClient>> | null = null
  let powerSaveId = -1

  try {
    record('starting', 'Starting task')
    // 定时调度触发的执行发送开始通知（手动/巡检不发，避免刷屏）
    if (options.source === 'schedule') {
      notifyExecutionStart(execution as ExecutionLog, { taskName: task.name, accountName: account.name })
    }

    if (useEmbedded) {
      // ============ 嵌入式执行宿主（ADR-0001，新基座）============
      record('opening-view', 'Opening account view')
      const entry = ensureAccountView(account)
      // 执行期防系统休眠（配合视图 backgroundThrottling:false）
      powerSaveId = powerSaveBlocker.start('prevent-app-suspension')

      record('connecting-page', 'Preparing account page')
      const page = new ElectronPageAdapter(entry.view.webContents)

      if (task.type === 'feature') {
        record('running', `Running feature ${task.featureId ?? ''}`)
        const featureResult = await runFeatureTaskEmbedded(task, {
          page,
          entry,
          executionId,
          signal: abortController.signal,
          timeoutMs,
          onAttemptFail: (attempt, message) => record('retrying', `Attempt ${attempt} failed: ${message}`)
        })
        execution.result = { featureId: task.featureId, ...featureResult }
        dbUpdateLog(executionId, { result: execution.result })
        emitExecutionLog(execution as ExecutionLog)
        // 业务失败（ok:false）不重试、直接走失败路径，避免副作用段重复执行
        if (!featureResult.ok) {
          throw new Error(featureResult.detail || `feature ${task.featureId ?? ''} failed`)
        }
      } else {
        record('running', 'Running user script')
        const network = new ElectronNetworkAdapter(entry.view.webContents)
        network.connect()
        const context = buildAutomationContext(account, { page, network }, taskLogger(executionId), abortController.signal)

        // 受限沙箱执行（9.2 脚本权限边界），带有限重试（8.3 重试原则）
        await runWithRetry(
          () => runScript(task.script, context, timeoutMs, task.allowedApis),
          task.retryPolicy?.maxAttempts ?? 1,
          task.retryPolicy?.backoffMs ?? 5000,
          {
            signal: abortController.signal,
            onRetry: (attempt, err) => {
              record('retrying', `Attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
        )
      }
    } else {
      // ============ 外部 Chrome 执行宿主（@deprecated 过渡期，仅 c48）============
      record('launching-browser', 'Launching Chrome')

      await startChromeForAccount(account)
      const runtime = getChromeRuntime(account.id)
      if (!runtime?.debugPort) throw new Error('CDP_CONNECT_FAILED: no debug port')

      record('connecting-cdp', 'Connecting to CDP')
      cdp = await createPageCdpClient(runtime.debugPort)

      // 初始化页面域
      await cdp.send('Page.enable')
      await cdp.send('Runtime.enable')

      record('running', `Running feature ${task.featureId ?? ''}`)
      const featureResult = await runFeatureTaskExternal(task, {
        cdp,
        executionId,
        signal: abortController.signal,
        timeoutMs,
        onAttemptFail: (attempt, message) => record('retrying', `Attempt ${attempt} failed: ${message}`)
      })
      execution.result = { featureId: task.featureId, ...featureResult }
      dbUpdateLog(executionId, { result: execution.result })
      emitExecutionLog(execution as ExecutionLog)
      if (!featureResult.ok) {
        throw new Error(featureResult.detail || `feature ${task.featureId ?? ''} failed`)
      }
    }

    execution.duration = Date.now() - startTime
    record('success', `Completed in ${execution.duration}ms`)
    logger.info({ executionId, accountId: account.id, taskId: task.id, duration: execution.duration }, 'Task succeeded')
    emitExecutionLog(execution as ExecutionLog)
    notifyExecutionResult(execution as ExecutionLog, { taskName: task.name, accountName: account.name })
  } catch (err) {
    execution.duration = Date.now() - startTime
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ executionId, accountId: account.id, taskId: task.id, err }, 'Task failed')

    // 8.2 任务超时 → cancelled；其他 → failed
    if (abortController.signal.aborted && abortController.signal.reason === 'timeout') {
      record('timeout', message)
    } else if (abortController.signal.aborted) {
      record('cancelled', message)
    } else {
      record('failed', message)
    }
    execution.error = message
    dbUpdateLog(executionId, { error: message })
    emitExecutionLog(execution as ExecutionLog)
    notifyExecutionResult(execution as ExecutionLog, { taskName: task.name, accountName: account.name })

    // 保存诊断信息（11.2 页面变更检测）
    if (err instanceof Error && err.message.startsWith('PG_SELECTOR_NOT_FOUND')) {
      if (useEmbedded) {
        const entry = getAccountView(account.id)
        if (entry) {
          await savePageDiagnosticEmbedded(new ElectronPageAdapter(entry.view.webContents), executionId)
        }
      } else {
        await savePageDiagnostic(cdp, executionId)
      }
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
    unregisterCancellable(executionId)
    if (slotAcquired) releaseGlobalSlot()
    if (powerSaveId >= 0) {
      try {
        powerSaveBlocker.stop(powerSaveId)
      } catch {
        // 已停止时忽略
      }
    }
    // 收尾释放：嵌入式视图跨执行持久（登录态在分区会话），仅外部 Chrome 路径关闭实例
    if (!useEmbedded) {
      try {
        await stopChromeForAccount(account.id)
      } catch (err) {
        logger.warn({ err, accountId: account.id }, 'Error stopping Chrome')
      }
    }
    releaseAccountLock(account.id)
    dbUpdateLog(executionId, { duration: execution.duration })
  }

  return execution as ExecutionLog
}

/**
 * 内置功能任务执行——嵌入式宿主（docs/adr/0001）
 * 主进程直接编排（不经 vm 沙箱）；重试仅针对抛出的基础设施异常，
 * 业务失败（ok:false）由调用方直接判失败，避免副作用段重复执行。
 */
async function runFeatureTaskEmbedded(
  task: Task,
  deps: {
    page: PageAdapter
    entry: AccountViewEntry
    executionId: string
    signal: AbortSignal
    timeoutMs: number
    onAttemptFail: (attempt: number, message: string) => void
  }
): Promise<FeatureRunResult> {
  const feature = task.featureId ? getFeature(task.featureId) : null
  if (!feature) {
    throw new Error(`TK_FEATURE_NOT_FOUND: ${task.featureId ?? '(no featureId)'}`)
  }

  const ctx: EmbeddedFeatureContext = {
    page: deps.page,
    waitForWindowOpenUrl: (timeoutMs?: number) => waitForWindowOpenUrl(deps.entry, timeoutMs),
    logger: taskLogger(deps.executionId),
    signal: deps.signal
  }

  return runWithRetry(
    () => feature.run(ctx, task.payload ?? {}),
    task.retryPolicy?.maxAttempts ?? 1,
    task.retryPolicy?.backoffMs ?? 5000,
    {
      signal: deps.signal,
      onRetry: (attempt, err) =>
        deps.onAttemptFail(attempt, err instanceof Error ? err.message : String(err))
    }
  )
}

/**
 * 内置功能任务执行——外部 Chrome 宿主（@deprecated 过渡期，仅 c48）
 * docs/c48-integration-plan.md Phase C
 */
async function runFeatureTaskExternal(
  task: Task,
  deps: {
    cdp: CdpClient
    executionId: string
    signal: AbortSignal
    timeoutMs: number
    onAttemptFail: (attempt: number, message: string) => void
  }
): Promise<FeatureRunResult> {
  const feature = task.featureId ? getFeature(task.featureId) : null
  if (!feature) {
    throw new Error(`TK_FEATURE_NOT_FOUND: ${task.featureId ?? '(no featureId)'}`)
  }

  const network = new NetworkCaptureService()
  network.attach(deps.cdp)
  await network.enable(deps.cdp)
  // 跨域 iframe（coupon / smf）按需自动附着
  await deps.cdp.enableAutoAttach()

  const ctx: ExternalFeatureContext = {
    cdp: deps.cdp,
    network,
    logger: taskLogger(deps.executionId),
    signal: deps.signal
  }

  return runWithRetry(
    () => feature.run(ctx, task.payload ?? {}),
    task.retryPolicy?.maxAttempts ?? 1,
    task.retryPolicy?.backoffMs ?? 5000,
    {
      signal: deps.signal,
      onRetry: (attempt, err) =>
        deps.onAttemptFail(attempt, err instanceof Error ? err.message : String(err))
    }
  )
}

/**
 * 受限沙箱执行用户脚本
 * @see 文档 9.2 脚本权限边界
 *
 * 仅暴露 context 中的白名单对象，不注入 Node 全局、fs、child_process 等。
 * allowedApis 为任务级白名单（undefined = 允许全部白名单 API），
 * 未授权的 API 调用抛出 TK_API_NOT_ALLOWED。
 * 用 vm 的 timeout 做硬超时保护。
 */
function runScript(
  script: string,
  context: AutomationContext,
  timeoutMs: number,
  allowedApis?: ScriptApi[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const allowed = allowedApis === undefined ? null : new Set<string>(allowedApis)

      // 未授权的 API 替换为抛错函数（9.2 任务级白名单）
      const guard = <A extends unknown[], R>(
        api: ScriptApi,
        fn: (...args: A) => R
      ): ((...args: A) => R) => {
        if (allowed === null || allowed.has(api)) return fn
        return (..._args: A): R => {
          throw new Error(`TK_API_NOT_ALLOWED: ${api} is not permitted for this task`)
        }
      }

      // 白名单 API（文档 9.2），全部用闭包包装，跨 vm 边界安全
      const page = {
        navigate: guard('page.navigate', (...a: Parameters<typeof context.page.navigate>) => context.page.navigate(...a)),
        waitForSelector: guard('page.waitForSelector', (...a: Parameters<typeof context.page.waitForSelector>) => context.page.waitForSelector(...a)),
        click: guard('page.click', (...a: Parameters<typeof context.page.click>) => context.page.click(...a)),
        input: guard('page.input', (...a: Parameters<typeof context.page.input>) => context.page.input(...a)),
        evaluate: guard('page.evaluate', (...a: Parameters<typeof context.page.evaluate>) => context.page.evaluate(...a)),
        screenshot: guard('page.screenshot', (...a: Parameters<typeof context.page.screenshot>) => context.page.screenshot(...a))
      }
      const storage = {
        get: guard('storage.get', (...a: Parameters<typeof context.storage.get>) => context.storage.get(...a)),
        set: guard('storage.set', (...a: Parameters<typeof context.storage.set>) => context.storage.set(...a)),
        delete: guard('storage.delete', (...a: Parameters<typeof context.storage.delete>) => context.storage.delete(...a))
      }
      const loggerApi = {
        info: guard('logger.info', (...a: Parameters<typeof context.logger.info>) => context.logger.info(...a)),
        warn: guard('logger.warn', (...a: Parameters<typeof context.logger.warn>) => context.logger.warn(...a)),
        error: guard('logger.error', (...a: Parameters<typeof context.logger.error>) => context.logger.error(...a)),
        debug: (...a: Parameters<typeof context.logger.debug>) => context.logger.debug(...a) // debug 不在白名单内，始终可用（仅内部日志）
      }
      const account = context.account

      // 构造纯对象的 ctx（避免类实例跨 vm 边界）
      const sandbox = {
        ctx: { page, storage, logger: loggerApi, account, signal: context.signal },
        page,
        storage,
        logger: loggerApi,
        account,
        console,
        setTimeout,
        clearTimeout,
        Promise,
        __done__: () => resolve(),
        __error__: (e: unknown) => reject(e instanceof Error ? e : new Error(String(e)))
      }

      // 包装用户脚本为 async 函数调用
      const wrapped = `
        (async function() {
          ${script}
        })().then(() => __done__(), (e) => __error__(e));
      `

      runInNewContext(
        wrapped,
        sandbox,
        { timeout: timeoutMs, filename: 'task-script.js' }
      )
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/**
 * 是否可重试的错误（8.3 只对明确可恢复的错误重试）
 * - 网络超时（NT_TIMEOUT）
 * - 选择器未找到（PG_SELECTOR_NOT_FOUND）
 * - 页面/连接失败（PG_NAVIGATE_FAILED / CDP_CONNECT_FAILED）
 * 有副作用的操作（页面提交、发送消息）不由引擎自动重试，需脚本自查幂等性
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  return (
    msg.includes('NT_TIMEOUT') ||
    msg.includes('PG_SELECTOR_NOT_FOUND') ||
    msg.includes('PG_NAVIGATE_FAILED') ||
    msg.includes('CDP_CONNECT_FAILED') ||
    msg.includes('CDP_TIMEOUT') ||
    msg.includes('fetch failed') ||
    msg.includes('NetworkError')
  )
}

interface RetryOptions {
  signal?: AbortSignal
  onRetry?: (attempt: number, err: unknown) => void
}

/**
 * 有限重试执行（8.3 重试原则）
 * - 只对可恢复错误重试
 * - 每次重试记录 attempt，禁止无限重试
 * - 取消信号到达时立即中止
 */
async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  backoffMs: number,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, maxAttempts)
  let lastErr: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error(String(options.signal.reason ?? 'cancelled'))
    }
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // 非可恢复错误或最后一次尝试，直接抛出
      if (!isRetryableError(err) || attempt >= attempts) throw err
      options.onRetry?.(attempt, err)
      // 退避等待（可被取消中断）
      await wait(backoffMs * attempt, options.signal)
    }
  }
  throw lastErr
}

/**
 * 可取消的延时等待
 */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

/**
 * 任务日志（9.2 只允许 page 相关和 logger）
 */
function taskLogger(executionId: string) {
  return {
    info: (message: string, data?: Record<string, unknown>) =>
      logger.info({ executionId, ...data }, message),
    warn: (message: string, data?: Record<string, unknown>) =>
      logger.warn({ executionId, ...data }, message),
    error: (message: string, error?: unknown, data?: Record<string, unknown>) =>
      logger.error({ executionId, ...data, err: error }, message),
    debug: (message: string, data?: Record<string, unknown>) =>
      logger.debug({ executionId, ...data }, message)
  }
}

/**
 * 保存页面诊断信息（11.2 页面变更检测）——嵌入式宿主
 *
 * 采集：URL、title、DOM 快照（outerHTML）、截图、Console 错误
 * 保存到：screenshots/ + page_diagnostics 表
 */
async function savePageDiagnosticEmbedded(
  page: PageAdapter,
  executionId: string
): Promise<void> {
  try {
    const [urlResult, titleResult, domResult, consoleResult, screenshotBase64] = await Promise.allSettled([
      page.evaluate<string>('window.location.href'),
      page.evaluate<string>('document.title'),
      page.evaluate<string>('document.documentElement.outerHTML'),
      page.evaluate<string[]>('window.__collectedConsoleErrors || []'),
      page.screenshot(executionId)
    ])

    const url = urlResult.status === 'fulfilled' ? String(urlResult.value ?? '') : ''
    const title = titleResult.status === 'fulfilled' ? String(titleResult.value ?? '') : ''
    const domHtml =
      domResult.status === 'fulfilled' ? String(domResult.value ?? '').slice(0, 1_000_000) : ''

    // 截图 / DOM 快照按日期目录存储（screenshots/YYYY-MM-DD/），开发者手动删除
    const dayDir = join(SCREENSHOTS_PATH, new Date().toISOString().slice(0, 10))

    let domSnapshotPath: string | undefined
    if (domHtml) {
      const dir = join(dayDir, 'dom')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${executionId}.html`)
      writeFileSync(file, domHtml, 'utf-8')
      domSnapshotPath = file
    }

    let screenshotPath: string | undefined
    if (screenshotBase64.status === 'fulfilled' && screenshotBase64.value) {
      mkdirSync(dayDir, { recursive: true })
      const file = join(dayDir, `${executionId}.png`)
      writeFileSync(file, Buffer.from(screenshotBase64.value, 'base64'))
      screenshotPath = file
    }

    let consoleErrors: string[] | undefined
    if (consoleResult.status === 'fulfilled' && Array.isArray(consoleResult.value)) {
      consoleErrors = consoleResult.value
    }

    createDiagnostic({
      executionId,
      url,
      title,
      domSnapshotPath,
      screenshotPath,
      consoleErrors
    })

    logger.warn({ executionId, url, title }, 'Page diagnostic captured')
  } catch (err) {
    logger.warn({ executionId, err }, 'Failed to save page diagnostic')
  }
}

/**
 * 保存页面诊断信息（11.2）——外部 Chrome 宿主（@deprecated 过渡期，仅 c48）
 */
async function savePageDiagnostic(
  cdp: Awaited<ReturnType<typeof createPageCdpClient>> | null,
  executionId: string
): Promise<void> {
  if (!cdp) return
  try {
    const [urlResult, titleResult, domResult, consoleResult, screenshotResult] = await Promise.allSettled([
      cdp.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }),
      cdp.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: 'document.title', returnByValue: true }),
      cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: 'document.documentElement.outerHTML',
        returnByValue: true
      }),
      cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } }>('Runtime.evaluate', {
        expression: 'window.__collectedConsoleErrors || []',
        returnByValue: true
      }),
      cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    ])

    const url =
      urlResult.status === 'fulfilled' ? String(urlResult.value.result?.value ?? '') : ''
    const title =
      titleResult.status === 'fulfilled' ? String(titleResult.value.result?.value ?? '') : ''
    const domHtml =
      domResult.status === 'fulfilled' ? String(domResult.value.result?.value ?? '').slice(0, 1_000_000) : ''

    // 截图 / DOM 快照按日期目录存储（screenshots/YYYY-MM-DD/），开发者手动删除
    const dayDir = join(SCREENSHOTS_PATH, new Date().toISOString().slice(0, 10))

    let domSnapshotPath: string | undefined
    if (domHtml) {
      const dir = join(dayDir, 'dom')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${executionId}.html`)
      writeFileSync(file, domHtml, 'utf-8')
      domSnapshotPath = file
    }

    let screenshotPath: string | undefined
    if (screenshotResult.status === 'fulfilled' && screenshotResult.value.data) {
      mkdirSync(dayDir, { recursive: true })
      const file = join(dayDir, `${executionId}.png`)
      writeFileSync(file, Buffer.from(screenshotResult.value.data, 'base64'))
      screenshotPath = file
    }

    let consoleErrors: string[] | undefined
    if (consoleResult.status === 'fulfilled' && consoleResult.value?.result?.value) {
      consoleErrors = consoleResult.value.result.value as string[]
    }

    createDiagnostic({
      executionId,
      url,
      title,
      domSnapshotPath,
      screenshotPath,
      consoleErrors
    })

    logger.warn({ executionId, url, title }, 'Page diagnostic captured')
  } catch (err) {
    logger.warn({ executionId, err }, 'Failed to save page diagnostic')
  }
}

// ============================================================================
// 全局并发闸门（docs 计划 Phase I）
// 容量 = settings.maxConcurrency，跨定时调度/手动/巡检统一限制同时执行的
// 账号数；动态容量（设置变更后对后续准入即时生效）
// ============================================================================

let activeSlots = 0
const slotWaiters: Array<() => void> = []

function pumpGlobalSlots(): void {
  const capacity = Math.max(1, getSettings().maxConcurrency)
  while (activeSlots < capacity && slotWaiters.length > 0) {
    const wake = slotWaiters.shift()!
    activeSlots += 1
    wake()
  }
}

async function acquireGlobalSlot(signal?: AbortSignal): Promise<void> {
  const capacity = Math.max(1, getSettings().maxConcurrency)
  if (activeSlots < capacity && slotWaiters.length === 0) {
    activeSlots += 1
    return
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const idx = slotWaiters.indexOf(wake)
      if (idx >= 0) slotWaiters.splice(idx, 1)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const wake = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    slotWaiters.push(wake)
    signal?.addEventListener('abort', onAbort, { once: true })
    // 排队期间容量被调大时立即放行
    pumpGlobalSlots()
  })
}

function releaseGlobalSlot(): void {
  activeSlots = Math.max(0, activeSlots - 1)
  pumpGlobalSlots()
}
