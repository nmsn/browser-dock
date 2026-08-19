import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import logger from './logger'
import { initializeDatabase, closeDatabase } from './store/database'
import { registerIpcHandlers } from './ipc-handlers'
import { scanStaleChromeProcesses } from './chrome/manager'
import { clearAllAccountLocks, isAccountLocked } from './store/account-locks'
import { stopAllSchedules } from './scheduler/cron-scheduler'
import { executeTask } from './scheduler/task-executor'
import { createAccount as dbCreateAccount } from './store/accounts'
import { createTask as dbCreateTask } from './store/tasks'
import type { Account, Task } from '../shared/types'

let mainWindow: BrowserWindow | null = null

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

    createWindow()

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

    // 账号锁应已释放
    const locked = isAccountLocked(account.id)
    step('Lock released', !locked)
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

// 优雅退出
app.on('before-quit', () => {
  logger.info('Application is quitting...')
  stopAllSchedules()
  closeDatabase()
})
