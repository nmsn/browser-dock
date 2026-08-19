import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { createServer, type Server } from 'net'
import { join } from 'path'
import type { Account, AccountRuntime } from '../../shared/types'
import { getOrCreateProfilePath, isProfileLocked, releaseProfile } from './profile'
import { createCdpClient, type CdpClient } from './cdp-client'
import logger from '../logger'

/**
 * Chrome 进程管理器
 * @see 文档 6.2 启动流程 / 6.3 关闭和异常清理
 *
 * 阶段：Phase 1 占位实现，Phase 2 从 Mirage Browser 复制完整实现
 */

interface ChromeInstance {
  accountId: string
  process: ChildProcess
  debugPort: number
  profilePath: string
  cdp: CdpClient | null
  runtime: AccountRuntime
}

const instances = new Map<string, ChromeInstance>()
let nextDebugPort = 9222

/**
 * 分配一个可用的调试端口（文档 6.2 第 3 步：分配 CDP 端口）
 * 从 nextDebugPort 开始，跳过已被占用的端口
 */
async function allocateDebugPort(): Promise<number> {
  let port = nextDebugPort
  for (let attempt = 0; attempt < 100; attempt++) {
    const inUse = await isPortInUse(port)
    if (!inUse) {
      nextDebugPort = port + 1
      return port
    }
    port++
  }
  throw new Error('CDP_PORT_EXHAUSTED: no free debug port available')
}

/**
 * 检查端口是否已被占用
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server: Server = createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close(() => resolve(false))
    })
    server.listen(port, '127.0.0.1')
  })
}

export async function startChromeForAccount(account: Account): Promise<ChromeInstance> {
  // 检查是否已在运行
  if (instances.has(account.id)) {
    throw new Error('CHROME_ALREADY_RUNNING')
  }

  // 检查 Profile 锁
  if (isProfileLocked(account.id)) {
    throw new Error('PROFILE_LOCKED')
  }

  const profilePath = getOrCreateProfilePath(account)
  const debugPort = await allocateDebugPort()

  // 6.2 启动流程：分配 CDP 端口 → 启动 Chrome → 等待 /json/version 可访问 → 建立 CDP 连接
  const chromePath = findChromePath()
  if (!chromePath) {
    throw new Error('CHROME_NOT_FOUND: Chrome executable not found')
  }

  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  // 收集 Chrome 输出用于诊断（6.3 异常清理）
  let chromeOut = ''
  let chromeErr = ''
  child.stdout?.on('data', (d) => {
    chromeOut += d.toString()
  })
  child.stderr?.on('data', (d) => {
    chromeErr += d.toString()
  })

  child.on('error', (err) => {
    logger.error({ accountId: account.id, err }, 'Chrome spawn error')
  })

  child.on('exit', (code, signal) => {
    logger.warn(
      { accountId: account.id, code, signal, stdout: chromeOut.slice(-500), stderr: chromeErr.slice(-500) },
      'Chrome process exited'
    )
    releaseProfile(account.id)
    instances.delete(account.id)
  })

  const runtime: AccountRuntime = {
    accountId: account.id,
    status: 'starting',
    pid: child.pid,
    debugPort,
    cdpConnected: false,
    startedAt: new Date().toISOString()
  }

  const instance: ChromeInstance = {
    accountId: account.id,
    process: child,
    debugPort,
    profilePath,
    cdp: null,
    runtime
  }
  instances.set(account.id, instance)

  // 等待 CDP 可用
  await waitForCdpAvailable(debugPort)
  instance.cdp = await createCdpClient(runtime)
  runtime.cdpConnected = true
  runtime.status = 'running'

  return instance
}

/**
 * 停止 Chrome 实例
 */
export async function stopChromeForAccount(accountId: string): Promise<void> {
  const instance = instances.get(accountId)
  if (!instance) return

  try {
    instance.cdp?.disconnect()
  } catch (err) {
    logger.warn({ err }, 'CDP disconnect error')
  }

  return new Promise((resolve) => {
    if (instance.process.exitCode !== null) {
      instances.delete(accountId)
      resolve()
      return
    }
    instance.process.once('exit', () => {
      instances.delete(accountId)
      resolve()
    })
    instance.process.kill('SIGTERM')
    // 兜底：5 秒后强制 kill
    setTimeout(() => {
      if (instance.process.exitCode === null) {
        instance.process.kill('SIGKILL')
      }
    }, 5000)
  })
}

/**
 * 获取账号运行时状态
 */
export function getRuntime(accountId: string): AccountRuntime | null {
  return instances.get(accountId)?.runtime ?? null
}

/**
 * 列出所有运行中的 Chrome 实例
 */
export function listRuntimes(): AccountRuntime[] {
  return Array.from(instances.values()).map((i) => i.runtime)
}

/**
 * 等待 CDP 端口可访问
 */
async function waitForCdpAvailable(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (resp.ok) return
    } catch {
      // 忽略错误，继续等待
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('CDP_TIMEOUT: Chrome did not become available in time')
}

/**
 * 查找系统中的 Chrome 路径
 * Phase 1: 简化实现，仅检查常见位置
 */
function findChromePath(): string | null {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    join(process.env.HOME ?? '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

/**
 * 应用启动时扫描异常退出留下的 Chrome 进程
 * @see 文档 6.3 异常结束
 */
export function scanStaleChromeProcesses(): string[] {
  // Phase 1 占位
  // 实际实现：扫描 chrome 进程列表，对比 instance 注册表，找出孤儿进程并 kill
  return []
}
