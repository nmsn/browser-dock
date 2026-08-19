import { runInNewContext } from 'vm'
import type {
  Account,
  AutomationContext,
  ExecutionLog,
  ExecutionStatus,
  StateTransition,
  Task
} from '../../shared/types'
import logger from '../logger'
import { startChromeForAccount, stopChromeForAccount, getRuntime } from '../chrome/manager'
import { createPageCdpClient } from '../chrome/cdp-client'
import { buildAutomationContext } from '../automation/runtime/automation-context'
import { createExecutionLog as dbCreateLog, updateExecutionLog as dbUpdateLog, appendStateTransition as dbAppendTransition } from '../store/logs'
import { acquireAccountLock, releaseAccountLock } from '../store/account-locks'
import { emitExecutionStatus, emitExecutionLog } from '../execution-events'
import { registerCancellable, unregisterCancellable } from '../cancel-registry'

/**
 * 任务执行器
 * @see 文档 8.2 错误处理策略 / 8.3 重试原则 / 9.2 脚本权限边界
 *
 * 流程（文档 6.2 / 2.6.2）：
 * 1. 获取账号互斥锁
 * 2. 启动 Chrome 实例
 * 3. 连接页面 CDP
 * 4. 构造 AutomationContext
 * 5. 在受限沙箱中执行用户脚本
 * 6. 更新执行日志状态
 * 7. 关闭 Chrome，释放锁
 *
 * 脚本权限（9.2）：仅暴露白名单 API，禁止访问 Node/fs/SQLite/密钥环/其他账号
 */

export interface ExecuteOptions {
  signal?: AbortSignal
  onStateChange?: (status: ExecutionStatus) => void
}

interface ExecutionRecord extends ExecutionLog {
  stateTransitions: StateTransition[]
}

/**
 * 执行单个任务（含浏览器的完整生命周期）
 */
export async function executeTask(
  account: Account,
  task: Task,
  options: ExecuteOptions = {}
): Promise<ExecutionLog> {
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // 创建执行日志
  const execution = dbCreateLog({
    id: executionId,
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

  // 账号互斥锁（5.3 同一账号同一时间只执行一个任务）
  if (!acquireAccountLock(account.id, executionId)) {
    const err = new Error('PROFILE_LOCKED: account is already running')
    record('failed', err.message)
    throw err
  }

  const startTime = Date.now()
  const abortController = new AbortController()
  const timeoutMs = task.timeoutMs ?? 120_000
  const timeoutId = setTimeout(() => abortController.abort('timeout'), timeoutMs)
  options.signal?.addEventListener('abort', () => abortController.abort(options.signal?.reason))

  // 注册到可取消控制器注册表（文档 8.3 任务取消支持 AbortSignal）
  registerCancellable(executionId, abortController)

  let cdp: Awaited<ReturnType<typeof createPageCdpClient>> | null = null

  try {
    record('starting', 'Starting task')
    record('launching-browser', 'Launching Chrome')

    await startChromeForAccount(account)
    const runtime = getRuntime(account.id)
    if (!runtime?.debugPort) throw new Error('CDP_CONNECT_FAILED: no debug port')

    record('connecting-cdp', 'Connecting to CDP')
    cdp = await createPageCdpClient(runtime.debugPort)

    // 初始化页面域
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    record('running', 'Running user script')
    const context = buildAutomationContext(account, cdp, taskLogger(executionId), abortController.signal)

    // 受限沙箱执行（9.2 脚本权限边界），带有限重试（8.3 重试原则）
    await runWithRetry(
      () => runScript(task.script, context, timeoutMs),
      task.retryPolicy?.maxAttempts ?? 1,
      task.retryPolicy?.backoffMs ?? 5000,
      {
        signal: abortController.signal,
        onRetry: (attempt, err) => {
          record('retrying', `Attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    )

    execution.duration = Date.now() - startTime
    record('success', `Completed in ${execution.duration}ms`)
    logger.info({ executionId, accountId: account.id, taskId: task.id, duration: execution.duration }, 'Task succeeded')
    emitExecutionLog(execution as ExecutionLog)
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

    // 保存诊断信息（11.2 页面变更检测）
    if (err instanceof Error && err.message.startsWith('PG_SELECTOR_NOT_FOUND')) {
      await savePageDiagnostic(cdp, executionId)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
    unregisterCancellable(executionId)
    // 关闭浏览器，释放锁（6.3 关闭和异常清理）
    try {
      await stopChromeForAccount(account.id)
    } catch (err) {
      logger.warn({ err, accountId: account.id }, 'Error stopping Chrome')
    }
    releaseAccountLock(account.id)
    dbUpdateLog(executionId, { duration: execution.duration })
  }

  return execution as ExecutionLog
}

/**
 * 受限沙箱执行用户脚本
 * @see 文档 9.2 脚本权限边界
 *
 * 仅暴露 context 中的白名单对象，不注入 Node 全局、fs、child_process 等。
 * 用 vm 的 timeout 做硬超时保护。
 */
function runScript(
  script: string,
  context: AutomationContext,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // 白名单 API（文档 9.2），全部用闭包包装，跨 vm 边界安全
      const page = {
        navigate: (...a: Parameters<typeof context.page.navigate>) => context.page.navigate(...a),
        waitForSelector: (...a: Parameters<typeof context.page.waitForSelector>) => context.page.waitForSelector(...a),
        click: (...a: Parameters<typeof context.page.click>) => context.page.click(...a),
        input: (...a: Parameters<typeof context.page.input>) => context.page.input(...a),
        evaluate: (...a: Parameters<typeof context.page.evaluate>) => context.page.evaluate(...a),
        screenshot: (...a: Parameters<typeof context.page.screenshot>) => context.page.screenshot(...a)
      }
      const storage = {
        get: (...a: Parameters<typeof context.storage.get>) => context.storage.get(...a),
        set: (...a: Parameters<typeof context.storage.set>) => context.storage.set(...a),
        delete: (...a: Parameters<typeof context.storage.delete>) => context.storage.delete(...a)
      }
      const loggerApi = context.logger
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
 * - CDP 连接失败（CDP_CONNECT_FAILED）
 * 有副作用的操作（页面提交、发送消息）不由引擎自动重试，需脚本自查幂等性
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  return (
    msg.includes('NT_TIMEOUT') ||
    msg.includes('PG_SELECTOR_NOT_FOUND') ||
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
async function runWithRetry(
  fn: () => Promise<void>,
  maxAttempts: number,
  backoffMs: number,
  options: RetryOptions = {}
): Promise<void> {
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
 * 保存页面诊断信息（11.2）
 */
async function savePageDiagnostic(
  cdp: Awaited<ReturnType<typeof createPageCdpClient>> | null,
  executionId: string
): Promise<void> {
  if (!cdp) return
  try {
    const [urlResult, titleResult, screenshotResult] = await Promise.allSettled([
      cdp.send('Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }),
      cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }),
      cdp.send('Page.captureScreenshot', { format: 'png' })
    ])
    const url = urlResult.status === 'fulfilled' ? urlResult.value.result?.value : undefined
    const title = titleResult.status === 'fulfilled' ? titleResult.value.result?.value : undefined
    if (url || title) {
      logger.warn({ executionId, url, title }, 'Page diagnostic captured')
    }
    void screenshotResult
  } catch {
    // 诊断失败不抛错
  }
}