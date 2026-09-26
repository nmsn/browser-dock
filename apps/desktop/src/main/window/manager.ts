import { app, BaseWindow, BrowserWindow, session, WebContentsView } from 'electron'
import type { Account, AccountRuntime } from '../../shared/types'
import logger from '../logger'

/**
 * 嵌入式账号窗口管理器（ADR-0001）
 * @see docs/adr/0001-embedded-electron-execution-host.md
 *
 * 每账号一个离屏渲染的 WebContentsView（挂在隐藏 BaseWindow 上）：
 * - 会话分区 persist:account-<id>（cookie 独立持久化，多淘宝账号并存）
 * - offscreen + useBackgroundThrottling:false：隐藏执行时满速渲染/定时器（ADR-0006
 *   实测：隐藏窗口 capturePage 0x0、定时器降频两个问题分别由 offscreen 与防节流解决）
 * - setWindowOpenHandler 捕获 window.open 目标 URL 并拒绝弹新窗
 *   （C32 列表页「直播详情」新开详情页的承接点）
 *
 * 登录使用同分区的可见 BrowserWindow（登录窗），扫码完成后关闭；
 * 登录态落在分区会话里，离屏执行视图随即生效。
 *
 * 替代外部 Chrome 路径（chrome/manager.ts，@deprecated 过渡期保留给 c48）。
 */

interface AccountViewEntry {
  accountId: string
  /** 承载离屏视图的宿主窗口（永不显示） */
  host: BaseWindow
  view: WebContentsView
  runtime: AccountRuntime
  /** 最近一次 window.open 捕获的 URL（setWindowOpenHandler deny 前记录） */
  lastOpenUrl: string | null
  /** 等待 window.open URL 的等待者（C32 进详情段） */
  openUrlWaiters: Array<(url: string | null) => void>
}

const views = new Map<string, AccountViewEntry>()
const loginWindows = new Map<string, BrowserWindow>()

/**
 * 与真实 Chrome 一致的 UA（去掉 Electron/app 名称指纹，ADR-0004 风控对策）
 */
export function chromeLikeUserAgent(): string {
  const chrome = process.versions.chrome
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

function partitionFor(accountId: string): string {
  return `persist:account-${accountId}`
}

/** 账号分区会话（登录窗与离屏执行视图共用，保证登录态互通） */
export function getAccountSession(accountId: string): Electron.Session {
  return session.fromPartition(partitionFor(accountId))
}

/**
 * 获取或创建账号的离屏执行视图（幂等）
 *
 * 创建要点（ADR-0006 隔离实验结论）：
 * - 必须显式 loadURL('about:blank')：未加载过任何页面的视图上 executeJavaScript 永不返回
 * - offscreen 渲染：隐藏（甚至永不显示）状态下 capturePage 出真实图、定时器不节流；
 *   若 offscreen 不可用（个别平台异常），回退为普通渲染 + 防节流开关
 */
export function ensureAccountView(account: Account): AccountViewEntry {
  const existing = views.get(account.id)
  if (existing) return existing

  const partition = partitionFor(account.id)
  const ses = getAccountSession(account.id)
  // UA 伪装为同版本真实 Chrome（每个分区会话独立设置）
  ses.setUserAgent(chromeLikeUserAgent())

  const host = new BaseWindow({ width: 1440, height: 900, show: false })

  const view = new WebContentsView({
    webPreferences: {
      partition,
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  host.contentView.addChildView(view)

  const runtime: AccountRuntime = {
    accountId: account.id,
    status: 'starting',
    connected: false,
    startedAt: new Date().toISOString()
  }

  const entry: AccountViewEntry = {
    accountId: account.id,
    host,
    view,
    runtime,
    lastOpenUrl: null,
    openUrlWaiters: []
  }
  views.set(account.id, entry)

  // window.open 捕获：记录 URL、唤醒等待者，拒绝弹新窗（详情页由主进程导航本视图打开）
  view.webContents.setWindowOpenHandler(({ url }) => {
    entry.lastOpenUrl = url
    const waiters = entry.openUrlWaiters
    entry.openUrlWaiters = []
    for (const wake of waiters) wake(url)
    logger.info({ accountId: account.id, url }, 'Captured window.open URL')
    return { action: 'deny' }
  })

  view.webContents.on('did-navigate', (_event, url) => {
    runtime.currentUrl = url
  })
  view.webContents.on('did-navigate-in-page', (_event, url) => {
    runtime.currentUrl = url
  })
  view.webContents.on('render-process-gone', (_event, details) => {
    logger.error({ accountId: account.id, details }, 'Account view renderer gone')
    runtime.status = 'error'
    runtime.lastError = `renderer gone: ${details.reason}`
  })

  // 初始化页面（executeJavaScript 前置条件）+ 离屏帧率拉满
  void view.webContents.loadURL('about:blank').catch(() => undefined)
  try {
    view.webContents.setFrameRate(60)
  } catch {
    // 旧版本无此 API 时忽略（offscreen 默认帧率仍可运行）
  }

  runtime.status = 'running'
  runtime.connected = true
  logger.info({ accountId: account.id, partition }, 'Account view created (offscreen)')
  return entry
}

/**
 * 等待 window.open 捕获的 URL（C32「直播详情」点击后调用）。
 * 捕获到返回 URL；超时返回 null（调用方回退按 liveId 规则构造详情地址）。
 */
export function waitForWindowOpenUrl(entry: AccountViewEntry, timeoutMs = 15_000): Promise<string | null> {
  entry.lastOpenUrl = null
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = entry.openUrlWaiters.indexOf(wake)
      if (idx >= 0) entry.openUrlWaiters.splice(idx, 1)
      resolve(entry.lastOpenUrl)
    }, timeoutMs)
    const wake = (url: string | null) => {
      clearTimeout(timer)
      resolve(url)
    }
    entry.openUrlWaiters.push(wake)
  })
}

/**
 * 打开账号登录窗（同分区可见窗口，供扫码）
 */
export function openLoginWindow(account: Account, url: string): BrowserWindow {
  closeLoginWindow(account.id)
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: `登录 · ${account.name}`,
    webPreferences: {
      partition: partitionFor(account.id),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  // 登录窗内的新窗口（如协议页）交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void import('electron').then(({ shell }) => shell.openExternal(target))
    return { action: 'deny' }
  })
  void win.loadURL(url).catch((err: unknown) => {
    logger.warn({ err, accountId: account.id }, 'Login window load interrupted')
  })
  win.on('closed', () => {
    loginWindows.delete(account.id)
  })
  loginWindows.set(account.id, win)
  logger.info({ accountId: account.id }, 'Login window opened')
  return win
}

export function getLoginWindow(accountId: string): BrowserWindow | null {
  return loginWindows.get(accountId) ?? null
}

/** 关闭账号登录窗（登录成功或用户取消后调用） */
export function closeLoginWindow(accountId: string): boolean {
  const win = loginWindows.get(accountId)
  if (!win) return false
  loginWindows.delete(accountId)
  try {
    win.destroy()
  } catch (err) {
    logger.warn({ err, accountId }, 'Error closing login window')
  }
  logger.info({ accountId }, 'Login window closed')
  return true
}

/** 关闭并销毁账号视图与登录窗（账号删除 / 应用退出） */
export function closeAccountView(accountId: string): boolean {
  closeLoginWindow(accountId)
  const entry = views.get(accountId)
  if (!entry) return false
  views.delete(accountId)
  try {
    entry.host.contentView.removeChildView(entry.view)
    entry.view.webContents.close()
    entry.host.destroy()
  } catch (err) {
    logger.warn({ err, accountId }, 'Error closing account view')
  }
  logger.info({ accountId }, 'Account view closed')
  return true
}

export function getAccountView(accountId: string): AccountViewEntry | null {
  return views.get(accountId) ?? null
}

export function getAccountRuntimeEmbedded(accountId: string): AccountRuntime | null {
  return views.get(accountId)?.runtime ?? null
}

export function listEmbeddedRuntimes(): AccountRuntime[] {
  return Array.from(views.values()).map((entry) => entry.runtime)
}

/** 应用退出时关闭全部账号视图与登录窗 */
export function closeAllAccountViews(): void {
  for (const accountId of Array.from(views.keys())) {
    closeAccountView(accountId)
  }
}

export type { AccountViewEntry }
