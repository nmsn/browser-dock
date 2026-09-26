import type {
  NetworkAdapter,
  NetworkCookie,
  NetworkRequest,
  NetworkResponse
} from '../../../shared/types'
import type { CdpClient } from '../../chrome/cdp-client'

/**
 * 网络适配器（基于 CDP Network 域）
 * @see 文档 7.2 NetworkAdapter
 *
 * 通过 CDP Network 域事件获取请求/响应信息，支持 cookie 读取。
 */

export class CdpNetworkAdapter implements NetworkAdapter {
  private requestListeners: Array<(req: NetworkRequest) => void> = []
  private responseListeners: Array<(res: NetworkResponse) => void> = []
  private unsubscribers: Array<() => void> = []

  constructor(private readonly cdp: CdpClient) {}

  /**
   * 启用 CDP Network 域并订阅事件
   */
  async connect(): Promise<void> {
    await this.cdp.send('Network.enable')

    this.unsubscribers.push(
      this.cdp.onEvent('Network.requestWillBeSent', (event) => {
        const params = event.params as {
          request?: { url?: string; method?: string; headers?: Record<string, string> }
        }
        if (!params?.request?.url) return
        this.emitRequest({
          url: params.request.url,
          method: params.request.method ?? 'GET',
          headers: params.request.headers ?? {}
        })
      })
    )

    this.unsubscribers.push(
      this.cdp.onEvent('Network.responseReceived', (event) => {
        const params = event.params as {
          response?: { url?: string; status?: number; headers?: Record<string, string> }
        }
        if (!params?.response?.url) return
        this.emitResponse({
          url: params.response.url,
          status: params.response.status ?? 0,
          headers: params.response.headers ?? {}
        })
      })
    )
  }

  onRequest(callback: (request: NetworkRequest) => void): void {
    this.requestListeners.push(callback)
  }

  onResponse(callback: (response: NetworkResponse) => void): void {
    this.responseListeners.push(callback)
  }

  async getCookies(domain?: string): Promise<NetworkCookie[]> {
    // 通过 Network.getCookies（page target 作用域）获取
    const result = await this.cdp.send<{ cookies?: NetworkCookie[] }>('Network.getCookies', {
      urls: domain ? [`https://${domain}`, `http://${domain}`] : undefined
    })
    return result.cookies ?? []
  }

  /**
   * 清理订阅
   */
  disconnect(): void {
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers = []
    this.requestListeners = []
    this.responseListeners = []
  }

  private emitRequest(request: NetworkRequest): void {
    for (const cb of this.requestListeners) cb(request)
  }

  private emitResponse(response: NetworkResponse): void {
    for (const cb of this.responseListeners) cb(response)
  }
}