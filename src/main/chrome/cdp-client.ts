import WebSocket from 'ws'
import type { RawData } from 'ws'
import type { AccountRuntime } from '../../shared/types'

/**
 * CDP 客户端
 * @see 文档 7.3 插件迁移：Content Script 注入 → CDP Runtime.evaluate
 *
 * 职责：
 * - 通过 WebSocket 连接 Chrome DevTools Protocol
 * - 发送 CDP 命令（Page.* / Runtime.* / Network.* 等）
 * - 维护消息 ID 与响应的映射
 *
 * Phase 2 阶段会从 Mirage Browser 直接复制 cdp-client.ts 实现
 */

export interface CDPCommand {
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface CDPResponse {
  id: number
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

export interface CDPEvent {
  method: string
  params?: Record<string, unknown>
  /** flat autoAttach 模式下子会话事件携带 sessionId */
  sessionId?: string
}

/** 已附加的子 target（OOPIF / 新窗口等） */
export interface AttachedTarget {
  targetId: string
  sessionId: string
  url: string
  type: string
}

export class CdpClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, (response: CDPResponse) => void>()
  private eventListeners = new Map<string, Set<(event: CDPEvent) => void>>()
  /** flat autoAttach 附着的子 target（sessionId → target 信息） */
  private attachedTargets = new Map<string, AttachedTarget>()

  constructor(private readonly debugUrl: string) {}

  /**
   * 订阅 CDP 事件（如 Network.requestWillBeSent, Page.loadEventFired 等）
   */
  onEvent(method: string, callback: (event: CDPEvent) => void): () => void {
    let set = this.eventListeners.get(method)
    if (!set) {
      set = new Set()
      this.eventListeners.set(method, set)
    }
    set.add(callback)
    return () => {
      set?.delete(callback)
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.debugUrl)
      this.ws.on('open', () => resolve())
      this.ws.on('error', (err: Error) => {
        reject(new Error(`CDP_CONNECT_FAILED: ${this.debugUrl} — ${err.message}`))
      })
      this.ws.on('message', (data: RawData) => {
        const msg = JSON.parse(data.toString()) as CDPResponse & CDPEvent
        // 有 id 则是命令响应
        if (typeof msg.id === 'number') {
          const cb = this.pending.get(msg.id)
          if (cb) {
            this.pending.delete(msg.id)
            cb(msg)
          }
          return
        }
        // 无 id 则是事件
        if (msg.method) {
          const listeners = this.eventListeners.get(msg.method)
          if (listeners) {
            for (const cb of listeners) cb(msg)
          }
        }
      })
    })
  }

  async send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<T> {
    if (!this.ws) throw new Error('CDP client not connected')
    const id = this.nextId++
    const command: CDPCommand & { sessionId?: string } = { id, method, params }
    if (sessionId) command.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, (response) => {
        if (response.error) {
          reject(new Error(`CDP ${method} failed: ${response.error.message}`))
        } else {
          resolve(response.result as T)
        }
      })
      this.ws!.send(JSON.stringify(command))
    })
  }

  /**
   * 启用 flat autoAttach：自动附着本页面的子 target（跨域 iframe / OOPIF）。
   * 之后可用 listAttachedSessions() / waitForSession() 按 URL 寻址子会话。
   */
  async enableAutoAttach(): Promise<void> {
    this.onEvent('Target.attachedToTarget', (event) => {
      const params = event.params as
        | { sessionId: string; targetInfo?: { targetId: string; url: string; type: string } }
        | undefined
      if (!params?.targetInfo) return
      this.attachedTargets.set(params.sessionId, {
        targetId: params.targetInfo.targetId,
        sessionId: params.sessionId,
        url: params.targetInfo.url ?? '',
        type: params.targetInfo.type ?? ''
      })
    })
    this.onEvent('Target.detachedFromTarget', (event) => {
      const params = event.params as { sessionId?: string } | undefined
      if (params?.sessionId) this.attachedTargets.delete(params.sessionId)
    })
    await this.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    })
  }

  listAttachedSessions(): AttachedTarget[] {
    return Array.from(this.attachedTargets.values())
  }

  /** 按 URL 子串查找已附着的子会话（大小写不敏感），未找到返回 undefined */
  session(urlSubstring: string): FrameSession | undefined {
    const want = urlSubstring.toLowerCase()
    if (!want) return undefined
    for (const target of this.attachedTargets.values()) {
      if (target.url.toLowerCase().includes(want)) {
        return new FrameSession(this, target.sessionId, target.url)
      }
    }
    return undefined
  }

  /** 等待 URL 匹配的子会话出现（iframe 晚于调用创建时使用） */
  async waitForSession(
    urlSubstring: string,
    timeoutMs: number,
    intervalMs = 300
  ): Promise<FrameSession> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const session = this.session(urlSubstring)
      if (session) return session
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new Error(
      `CDP_SESSION_WAIT_TIMEOUT: no attached target matching "${urlSubstring}" within ${timeoutMs}ms`
    )
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
    this.pending.clear()
    this.eventListeners.clear()
    this.attachedTargets.clear()
  }
}

/**
 * 子会话句柄（flat autoAttach 附着的 OOPIF/iframe target）
 * 在同一 WebSocket 连接上以 sessionId 区分命令路由
 */
export class FrameSession {
  constructor(
    private readonly client: CdpClient,
    readonly sessionId: string,
    readonly url: string
  ) {}

  async send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.client.send<T>(method, params, this.sessionId)
  }

  /** 在该 target 的主世界执行表达式；异常时抛出（含页面异常描述） */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<{
      result?: { value?: T }
      exceptionDetails?: { exception?: { description?: string; value?: unknown } }
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ??
        String(result.exceptionDetails.exception?.value ?? 'unknown page exception')
      throw new Error(`PG_EVAL_FAILED: ${detail.slice(0, 500)}`)
    }
    return result.result?.value as T
  }

  async detach(): Promise<void> {
    try {
      await this.client.send('Target.detachFromTarget', { sessionId: this.sessionId })
    } catch {
      // 已断开等场景忽略
    }
  }
}

/**
 * 创建 CDP 客户端并连接到 Chrome 调试端口（browser target）
 * browser 的 webSocketDebuggerUrl 必须从 /json/version 获取（包含 UUID）
 */
export async function createCdpClient(runtime: AccountRuntime): Promise<CdpClient> {
  if (!runtime.debugPort) {
    throw new Error('CDP_CONNECT_FAILED: account has no debugPort')
  }
  const resp = await fetch(`http://127.0.0.1:${runtime.debugPort}/json/version`)
  if (!resp.ok) {
    throw new Error(`CDP_CONNECT_FAILED: cannot reach /json/version (HTTP ${resp.status})`)
  }
  const version = (await resp.json()) as { webSocketDebuggerUrl?: string }
  if (!version.webSocketDebuggerUrl) {
    throw new Error('CDP_CONNECT_FAILED: /json/version has no webSocketDebuggerUrl')
  }
  const client = new CdpClient(normalizeWsUrl(version.webSocketDebuggerUrl, runtime.debugPort))
  await client.connect()
  return client
}

interface TargetInfo {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl?: string
}

/**
 * 列出调试端口上的页面 target
 */
async function listPageTargets(debugPort: number): Promise<TargetInfo[]> {
  const resp = await fetch(`http://127.0.0.1:${debugPort}/json`)
  if (!resp.ok) throw new Error(`CDP_TARGET_LIST_FAILED: HTTP ${resp.status}`)
  const targets = (await resp.json()) as TargetInfo[]
  return targets.filter((t) => t.type === 'page')
}

/**
 * 将 webSocketDebuggerUrl 的 host 规范化为 127.0.0.1
 * Chrome 返回的可能是 ws://localhost:PORT/...，localhost 在 IPv6 下解析
 * 可能导致 WebSocket 连接 404/握手失败
 */
function normalizeWsUrl(url: string, port: number): string {
  return url.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`)
}

/**
 * 等待并获取页面 target 的 WebSocket 地址
 * 优先复用已有页面 target；若没有则创建一个新的空白页
 */
export async function getOrCreatePageTarget(debugPort: number): Promise<TargetInfo> {
  let targets = await listPageTargets(debugPort)
  if (targets.length === 0) {
    // 创建一个空白页 target
    const resp = await fetch(`http://127.0.0.1:${debugPort}/json/new`, { method: 'PUT' })
    if (!resp.ok) throw new Error('CDP_NEW_TARGET_FAILED')
    targets = await listPageTargets(debugPort)
  }
  const page = targets.find((t) => t.webSocketDebuggerUrl)
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('CDP_PAGE_TARGET_MISSING: no page target available')
  }
  // 归一化 host，避免 IPv6 localhost 解析问题
  return { ...page, webSocketDebuggerUrl: normalizeWsUrl(page.webSocketDebuggerUrl, debugPort) }
}

/**
 * 创建连接到浏览器页面 target 的 CDP 客户端
 * 类似于连接 Page 级别，可直接使用 Page.navigate / Runtime.evaluate / Network.*
 */
export async function createPageCdpClient(debugPort: number): Promise<CdpClient> {
  const page = await getOrCreatePageTarget(debugPort)
  const client = new CdpClient(page.webSocketDebuggerUrl!)
  await client.connect()
  return client
}
