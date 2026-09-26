import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import logger from './logger'
import { initializeDatabase, closeDatabase } from './store/database'
import { registerIpcHandlers } from './ipc-handlers'
import { scanStaleChromeProcesses } from './chrome/manager'
import { clearAllAccountLocks, isAccountLocked } from './store/account-locks'
import { initScheduler, stopAllSchedules } from './scheduler/service'
import { initNotifier } from './notifier'
import { getSettings, applyLaunchAtLogin } from './store/settings'
import { initRetentionCleanup, stopRetentionCleanup } from './retention'
import { createTray, destroyTray } from './tray'
import { initInspection, stopInspection } from './inspection'
import { executeTask } from './scheduler/task-executor'
import { runTaskNow } from './scheduler/service'
import { createAccount as dbCreateAccount } from './store/accounts'
import { createTask as dbCreateTask } from './store/tasks'
import { getTask } from './store/tasks'
import { backupDatabase } from './store/backup'
import { restoreDatabaseFromBackup } from './store/restore'
import { runInspection } from './inspection'
import { closeAllAccountViews, chromeLikeUserAgent } from './window/manager'
import type { Account, Task } from '../shared/types'

// ============================================================================
// 后台节流防护（ADR-0001"不节流不冷冻"）——必须在 app ready 前设置：
// - disable-background-timer-throttling：后台/隐藏页面定时器不降频
// - disable-backgrounding-occluded-windows：窗口被遮挡时不挂起 renderer
// - disable-renderer-backgrounding：不降级后台 renderer 进程优先级
// 页面级再叠加 webPreferences.backgroundThrottling:false（window/manager.ts），
// 执行期由 task-executor 叠加 powerSaveBlocker 防系统休眠。
// ============================================================================
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// UA 伪装为同版本真实 Chrome（ADR-0004 风控对策）；嵌入式分区会话另按会话设置
app.userAgentFallback = chromeLikeUserAgent()

let mainWindow: BrowserWindow | null = null
let quitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Browser Dock',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 10.3 托盘行为：开启 closeToTray 时关闭窗口仅隐藏，任务继续执行
  mainWindow.on('close', (event) => {
    if (getSettings().closeToTray && !quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 应用启动
 */
function bootstrap(): void {
  // 6.3 应用启动时扫描上一次异常退出留下的运行记录
  const staleChrome = scanStaleChromeProcesses()
  if (staleChrome.length > 0) {
    logger.warn({ count: staleChrome.length }, 'Found stale Chrome processes')
  }
  clearAllAccountLocks()

  // 数据库初始化
  initializeDatabase()
  registerIpcHandlers()
  initNotifier()

  // 应用设置：开机自启动（文档 10.3 系统能力）
  // 仅在启用时应用，避免开发环境未打包时的系统权限报错
  if (getSettings().launchAtLogin) {
    applyLaunchAtLogin(true)
  }

  // 保留期清理：启动时执行一次 + 每日定时（文档 9.3）
  initRetentionCleanup()

  // 低频巡检：仅在设置开启时调度（文档 11.2）
  initInspection()

  // 调度器初始化（注册所有启用的 cron 任务，文档 5.2）
  initScheduler()
}

// 单实例锁
// @see 文档 10.3 应用退出和系统能力
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    bootstrap()

    // 端到端自测模式：BROWSER_DOCK_SMOKE=1 electron .
    if (process.env['BROWSER_DOCK_SMOKE'] === '1') {
      runSmokeTest().finally(() => {
        app.exit(0)
      })
      return
    }

    // C32 fixture 全链路验证模式（ADR-0006）：
    // BROWSER_DOCK_C32_FIXTURE=1 + BROWSER_DOCK_FIXTURE_BASE=<本地 mock 页地址>
    if (process.env['BROWSER_DOCK_C32_FIXTURE'] === '1') {
      runC32FixtureTest()
        .catch((err) => {
          console.error('C32 fixture test threw:', err)
          console.log(JSON.stringify({ pass: false }))
        })
        .finally(() => {
          app.exit(0)
        })
      return
    }

    createWindow()
    createTray(() => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
}

/**
 * 端到端自测：创建账号+任务 → 启动 Chrome → 执行脚本 → 写日志
 * 验证：Chrome 启动 / CDP / 自动化上下文 / 沙箱脚本 / 数据库 / 锁释放
 */
async function runSmokeTest(): Promise<void> {
  const result = { pass: true, steps: [] as string[] }
  const step = (name: string, ok: boolean): void => {
    result.steps.push(`${ok ? '✓' : '✗'} ${name}`)
    if (!ok) result.pass = false
  }

  try {
    console.log('=== Browser Dock smoke test ===')

    const account: Account = {
      id: `smoke-account-${Date.now()}`,
      name: '冒烟账号',
      taobaoUsername: 'smoke@test.local',
      profilePath: join(app.getPath('userData'), `smoke-profile-${Date.now()}`),
      notes: '',
      createdAt: new Date().toISOString(),
      loginStatus: 'unknown'
    }
    dbCreateAccount(account)
    step('DB: create account', true)

    const task: Task = {
      id: `smoke-task-${Date.now()}`,
      name: '冒烟任务',
      type: 'custom',
      script: `
        const title = await ctx.page.evaluate('document.title');
        ctx.logger.info('Page title: ' + title);
      `,
      config: {},
      version: 1,
      timeoutMs: 30000,
      retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    dbCreateTask(task)
    step('DB: create task', true)

    const execution = await executeTask(account, task)
    step(`Executor: status=${execution.status}`, execution.status === 'success')

    // 脚本 API 白名单（文档 9.2）：未授权 API 应抛 TK_API_NOT_ALLOWED
    try {
      const restrictedTask: Task = {
        ...task,
        id: `smoke-task-restricted-${Date.now()}`,
        name: '冒烟受限任务',
        allowedApis: ['logger.info'],
        script: `await ctx.page.navigate('about:blank');`
      }
      dbCreateTask(restrictedTask)
      await executeTask(account, restrictedTask)
      step('API guard: no error thrown', false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      step(`API guard: ${message.slice(0, 50)}`, message.includes('TK_API_NOT_ALLOWED'))
    }

    // 账号锁应已释放
    const locked = isAccountLocked(account.id)
    step('Lock released', !locked)

    // 数据库备份与恢复（文档 13.2）：恢复后应回退到备份点
    try {
      const backupPath = backupDatabase('smoke')
      const postBackupTask: Task = {
        ...task,
        id: `smoke-task-postbackup-${Date.now()}`,
        name: '备份后任务'
      }
      dbCreateTask(postBackupTask)
      restoreDatabaseFromBackup(backupPath)
      const rolledBack = getTask(postBackupTask.id) === null
      const originalKept = getTask(task.id) !== null
      step(`Restore: rollback ok (kept=${originalKept})`, rolledBack && originalKept)
    } catch (err) {
      step(`Restore threw: ${err instanceof Error ? err.message : String(err)}`, false)
    }

    // 低频巡检（文档 11.2）：无已登录账号时应跳过且不启动浏览器
    try {
      const inspected = await runInspection()
      step(`Inspection: skipped (${inspected} logged-in accounts)`, inspected === 0)
    } catch (err) {
      step(`Inspection threw: ${err instanceof Error ? err.message : String(err)}`, false)
    }

    // 多账号并行执行验证（文档 5.3 不同账号可以并行执行）
    try {
      const account2: Account = {
        id: `smoke-account-2-${Date.now()}`,
        name: '冒烟账号2',
        taobaoUsername: 'smoke2@test.local',
        profilePath: join(app.getPath('userData'), `smoke-profile2-${Date.now()}`),
        notes: '',
        createdAt: new Date().toISOString(),
        loginStatus: 'unknown'
      }
      dbCreateAccount(account2)
      const count = await runTaskNow(task.id, [account.id, account2.id], 2)
      step(`runTaskNow: executed ${count}/2 accounts`, count === 2)
    } catch (err) {
      step(`runTaskNow threw: ${err instanceof Error ? err.message : String(err)}`, false)
    }
  } catch (err) {
    step(`executor threw: ${err instanceof Error ? err.message : String(err)}`, false)
  }

  console.log(result.steps.join('\n'))
  console.log(result.pass ? 'SMOKE PASS' : 'SMOKE FAIL')
  console.log(JSON.stringify({ pass: result.pass }))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * C32 fixture 全链路验证（ADR-0006，无登录态环境）：
 * fixture 页由测试脚本起本地 HTTP 服务（BROWSER_DOCK_FIXTURE_BASE），
 * 这里创建账号 + C32 任务并经嵌入式执行宿主真实跑一遍编排。
 * 验证：账号视图 / page-script 注入 / 列表搜索→进详情→逐商品置顶 / 弹窗状态机 / 执行日志。
 */
async function runC32FixtureTest(): Promise<void> {
  const result = { pass: false, detail: '' }
  try {
    const account: Account = {
      id: `c32-fixture-account-${Date.now()}`,
      name: 'C32 fixture 账号',
      taobaoUsername: 'c32-fixture@test.local',
      profilePath: join(app.getPath('userData'), `c32-fixture-profile-${Date.now()}`),
      notes: '',
      createdAt: new Date().toISOString(),
      loginStatus: 'unknown'
    }
    dbCreateAccount(account)

    const task: Task = {
      id: `c32-fixture-task-${Date.now()}`,
      name: 'C32 fixture 置顶任务',
      type: 'feature',
      script: '',
      config: {},
      featureId: 'c32HotProductPin',
      payload: {
        liveRoomId: String(process.env['C32_FIXTURE_ROOM_ID'] ?? '260000000000000'),
        productIds: (process.env['C32_FIXTURE_PRODUCT_IDS'] ?? '8152947823').split(',').map((id) => id.trim()).filter(Boolean)
      },
      version: 1,
      timeoutMs: 180_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    dbCreateTask(task)

    const execution = await executeTask(account, task)
    result.pass = execution.status === 'success'
    result.detail = JSON.stringify({ status: execution.status, result: execution.result, error: execution.error })
    console.log('=== C32 fixture test ===')
    console.log(`status=${execution.status}`)
    console.log(`result=${JSON.stringify(execution.result)}`)
    if (execution.error) console.log(`error=${execution.error}`)
  } catch (err) {
    result.detail = err instanceof Error ? err.message : String(err)
    console.error('C32 fixture test error:', result.detail)
  }
  console.log(result.pass ? 'PASS: c32 fixture test passed' : 'FAIL: c32 fixture test failed')
  console.log(JSON.stringify({ pass: result.pass }))
}

// 优雅退出
app.on('before-quit', () => {
  quitting = true
  logger.info('Application is quitting...')
  destroyTray()
  stopAllSchedules()
  stopRetentionCleanup()
  stopInspection()
  closeAllAccountViews()
  closeDatabase()
})
