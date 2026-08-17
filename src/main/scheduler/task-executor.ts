/**
 * 任务执行器
 * @see 文档 7 自动化运行时抽象层
 *
 * 职责：
 * - 接收一个 ExecutionLog + Task + Account
 * - 构造 AutomationContext
 * - 执行任务脚本（带超时、AbortSignal）
 * - 捕获异常、更新日志状态
 *
 * Phase 3 完整实现
 */

import type {
  Account,
  AutomationContext,
  ExecutionLog,
  Task
} from '../../shared/types'
import logger from '../logger'

export interface ExecuteOptions {
  signal?: AbortSignal
  onStateChange?: (status: string) => void
}

/**
 * 执行单个任务
 */
export async function executeTask(
  account: Account,
  task: Task,
  execution: ExecutionLog,
  options: ExecuteOptions = {}
): Promise<void> {
  logger.info({ accountId: account.id, taskId: task.id, executionId: execution.id }, 'Task started')

  const startTime = Date.now()
  const abortController = new AbortController()
  const timeoutMs = task.timeoutMs ?? 120_000

  // 超时控制
  const timeoutId = setTimeout(() => {
    abortController.abort('timeout')
  }, timeoutMs)

  // 监听外部取消
  options.signal?.addEventListener('abort', () => abortController.abort(options.signal?.reason))

  try {
    options.onStateChange?.('starting')
    // 构造 AutomationContext
    const context = buildContext(account, abortController.signal)

    // 执行用户脚本
    // Phase 3: 通过 vm.Script 或 Function 构造在受限沙箱中执行 task.script
    // 当前为占位实现
    await runScript(task.script, context)

    options.onStateChange?.('success')
    logger.info(
      { accountId: account.id, taskId: task.id, duration: Date.now() - startTime },
      'Task succeeded'
    )
  } catch (err) {
    options.onStateChange?.('failed')
    logger.error({ accountId: account.id, taskId: task.id, err }, 'Task failed')
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 构造 AutomationContext
 */
function buildContext(account: Account, signal: AbortSignal): AutomationContext {
  return {
    account: {
      accountId: account.id,
      accountName: account.name,
      profilePath: account.profilePath,
      proxy: account.proxyConfig
    },
    page: {} as AutomationContext['page'], // Phase 2 实现
    storage: {} as AutomationContext['storage'],
    network: {} as AutomationContext['network'],
    logger: {
      info: (msg, data) => logger.info(data ?? {}, msg),
      warn: (msg, data) => logger.warn(data ?? {}, msg),
      error: (msg, err, data) => logger.error({ ...data, err }, msg),
      debug: (msg, data) => logger.debug(data ?? {}, msg)
    },
    signal
  }
}

/**
 * 在受限沙箱中运行任务脚本
 *
 * Phase 3: 改用 vm.Script + Contextify 实现真正的沙箱
 * 当前为占位实现
 */
async function runScript(script: string, context: AutomationContext): Promise<void> {
  // 占位：Phase 3 实现
  // - 构造沙箱，仅暴露 context 中允许的 API
  // - 通过 vm.runInContext 执行
  // - 实现超时和取消
  void script
  void context
}
