import cron, { type ScheduledTask } from 'node-cron'
import type { Account, Task } from '../shared/types'
import { getSettings } from './store/settings'
import { listAccounts } from './store/accounts'
import { getTask, createTask } from './store/tasks'
import { executeTask } from './scheduler/task-executor'
import { runWithConcurrency } from './scheduler/task-runner'
import logger from './logger'

/**
 * 低频巡检
 * @see 文档 11.2 页面变更检测（第二段）
 *
 * 独立于业务任务运行，用于提前发现淘宝中控台页面变化和登录失效：
 * - 每日 04:00 对所有「已登录」账号执行巡检探针任务
 * - 探针导航到中控台并等待页面就绪，失败时自动保存诊断（复用 task-executor）
 * - 只负责发现和告警，不自动修改任务脚本
 *
 * 默认关闭（opt-in），在设置页开启。
 */

const INSPECTION_CRON = '0 0 4 * * *'
export const INSPECTION_TASK_ID = 'inspection-probe'

const INSPECTION_SCRIPT = `
await ctx.page.navigate('https://live.taobao.com/admin');
await ctx.page.waitForSelector('body', 20000);
const title = await ctx.page.evaluate('document.title');
ctx.logger.info('Inspection page title: ' + title);
`

let inspectionTask: ScheduledTask | null = null

/**
 * 确保巡检探针任务存在于数据库（execution_logs.task_id 有外键约束）
 */
function ensureInspectionTask(): Task | null {
  const existing = getTask(INSPECTION_TASK_ID)
  if (existing) return existing
  const now = new Date().toISOString()
  try {
    return createTask({
      id: INSPECTION_TASK_ID,
      name: '低频巡检探针',
      type: 'custom',
      script: INSPECTION_SCRIPT,
      config: {},
      timeoutMs: 60_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 }
    })
  } catch (err) {
    // id 冲突等异常不阻塞启动
    logger.warn({ err }, 'Failed to create inspection probe task')
    return getTask(INSPECTION_TASK_ID)
  }
}

/**
 * 执行一轮巡检：对所有已登录账号并行探针
 */
export async function runInspection(): Promise<number> {
  const task = ensureInspectionTask()
  if (!task) return 0

  const accounts = listAccounts().filter(
    (a): a is Account => a.loginStatus === 'logged-in'
  )
  if (accounts.length === 0) {
    logger.info('Inspection skipped: no logged-in accounts')
    return 0
  }

  logger.info({ count: accounts.length }, 'Inspection started')
  await runWithConcurrency(accounts, getSettings().maxConcurrency, async (account) => {
    try {
      await executeTask(account, task, { source: 'inspection' })
    } catch (err) {
      // 单账号失败不阻塞其他账号；失败详情已在执行日志和诊断中
      logger.warn(
        { accountId: account.id, err },
        'Inspection failed for account (page may have changed or login expired)'
      )
    }
  })
  return accounts.length
}

/**
 * 启动巡检调度（仅在设置开启时生效；设置变更后重新调用）
 */
export function initInspection(): void {
  stopInspection()
  if (!getSettings().enableInspection) return

  ensureInspectionTask()
  inspectionTask = cron.schedule(INSPECTION_CRON, () => {
    void runInspection()
  })
  logger.info({ cron: INSPECTION_CRON }, 'Inspection scheduled')
}

/**
 * 停止巡检调度（应用退出或设置关闭时调用）
 */
export function stopInspection(): void {
  inspectionTask?.stop()
  inspectionTask = null
}
