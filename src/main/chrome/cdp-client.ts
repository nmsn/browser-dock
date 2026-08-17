import WebSocket from 'ws'
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

export class CdpClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, (response: CDPResponse) => void>()

  constructor(private readonly debugUrl: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.debugUrl)
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as CDPResponse
        const cb = this.pending.get(msg.id)
        if (cb) {
          this.pending.delete(msg.id)
          cb(msg)
        }
      })
    })
  }

  async send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws) throw new Error('CDP client not connected')
    const id = this.nextId++
    const command: CDPCommand = { id, method, params }
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

  disconnect(): void {
    this.ws?.close()
    this.ws = null
    this.pending.clear()
  }
}

/**
 * 创建 CDP 客户端并连接到 Chrome 调试端口
 */
export async function createCdpClient(runtime: AccountRuntime): Promise<CdpClient> {
  if (!runtime.debugPort) {
    throw new Error('CDP_CONNECT_FAILED: account has no debugPort')
  }
  const client = new CdpClient(`ws://127.0.0.1:${runtime.debugPort}/devtools/browser`)
  await client.connect()
  return client
}
