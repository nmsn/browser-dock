import type { CdpClient } from '../chrome/cdp-client'
import logger from '../logger'

/**
 * 网络响应捕获（CDP Network domain）
 * @see docs/c48-integration-plan.md A2
 *
 * 替代扩展的 MAIN world fetch/XHR hook 方案：
 * - 对页面主会话或子会话（iframe）Network.enable 后，responseReceived 事件统一进入有界缓存
 * - 查询时按 URL 子串过滤，惰性取响应体并解析，经调用方提供的 extractor 抽取业务行
 */

interface CachedResponseRef {
  url: string
  requestId: string
  /** undefined 表示页面主会话 */
  sessionId?: string
  receivedAt: number
}

export interface QueryOptions<T> {
  /** URL 子串匹配（大小写不敏感） */
  urlPattern: string
  /** 从解析后的响应体抽取业务行 */
  extract: (body: unknown) => T[]
  /** 行去重键（可选） */
  dedupeKey?: (row: T) => string
}

interface WaitOptions<T> extends QueryOptions<T> {
  /** 谓词命中时提前返回；默认任一行出现即返回 */
  predicate?: (rows: T[]) => boolean
  timeoutMs: number
  intervalMs?: number
}

export class NetworkCaptureService {
  private cache: CachedResponseRef[] = []
  private readonly maxCache = 50
  private unsubscribe: (() => void) | null = null
  private enabledSessionIds = new Set<string>()

  /**
   * 绑定客户端并注册事件监听（幂等）
   */
  attach(client: CdpClient): void {
    if (this.unsubscribe) return
    const off = client.onEvent('Network.responseReceived', (event) => {
      const params = event.params as
        | { requestId?: string; response?: { url?: string } }
        | undefined
      if (!params?.requestId || !params.response?.url) return
      this.cache.push({
        url: params.response.url,
        requestId: params.requestId,
        sessionId: event.sessionId,
        receivedAt: Date.now()
      })
      if (this.cache.length > this.maxCache) this.cache.shift()
    })
    this.unsubscribe = off
  }

  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.cache = []
    this.enabledSessionIds.clear()
  }

  /**
   * 在指定会话上启用 Network 域；sessionId 省略表示页面主会话
   */
  async enable(client: CdpClient, sessionId?: string): Promise<void> {
    await client.send('Network.enable', {}, sessionId)
    this.enabledSessionIds.add(sessionId ?? '')
  }

  hasEnabled(sessionId?: string): boolean {
    return this.enabledSessionIds.has(sessionId ?? '')
  }

  clearCache(): void {
    this.cache = []
  }

  /** 查询匹配响应并抽取行（惰性取体，失败跳过该条） */
  async query<T>(client: CdpClient, options: QueryOptions<T>): Promise<T[]> {
    const want = options.urlPattern.toLowerCase()
    const rows = new Map<string, T>()
    for (let i = this.cache.length - 1; i >= 0; i--) {
      const entry = this.cache[i]
      if (!entry.url.toLowerCase().includes(want)) continue
      let body: unknown
      try {
        const result = await client.send<{ body: string; base64Encoded: boolean }>(
          'Network.getResponseBody',
          { requestId: entry.requestId },
          entry.sessionId
        )
        body = result.base64Encoded
          ? Buffer.from(result.body, 'base64').toString('utf-8')
          : JSON.parse(result.body)
      } catch (err) {
        logger.debug(
          { url: entry.url, err: err instanceof Error ? err.message : String(err) },
          'Network.getResponseBody failed, skip'
        )
        continue
      }
      for (const row of options.extract(body)) {
        const key = options.dedupeKey ? options.dedupeKey(row) : JSON.stringify(row)
        if (!rows.has(key)) rows.set(key, row)
      }
    }
    return Array.from(rows.values())
  }

  /** 轮询查询直到谓词命中或超时；超时抛 NETWORK_CAPTURE_WAIT_TIMEOUT */
  async waitFor<T>(client: CdpClient, options: WaitOptions<T>): Promise<T[]> {
    const start = Date.now()
    const interval = options.intervalMs ?? 300
    let last: T[] = []
    while (Date.now() - start < options.timeoutMs) {
      last = await this.query(client, options)
      if (last.length > 0 && (!options.predicate || options.predicate(last))) return last
      await new Promise((r) => setTimeout(r, interval))
    }
    throw new Error(
      `NETWORK_CAPTURE_WAIT_TIMEOUT: no rows matching "${options.urlPattern}" within ${options.timeoutMs}ms`
    )
  }
}
