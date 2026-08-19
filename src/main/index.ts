import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import logger from './logger'
import { initializeDatabase, closeDatabase } from './store/database'
import { registerIpcHandlers } from './ipc-handlers'
import { scanStaleChromeProcesses } from './chrome/manager'
import { clearAllAccountLocks } from './store/account-locks'
import { stopAllSchedules } from './scheduler/cron-scheduler'

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
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
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
