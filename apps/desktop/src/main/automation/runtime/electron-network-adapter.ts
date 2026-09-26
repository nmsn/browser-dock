import type { WebContents } from 'electron'
import type {
  NetworkAdapter,
  NetworkCookie,
  NetworkRequest,
  NetworkResponse
} from '../../../shared/types'

/**
 * 网络适配器（嵌入式 Electron session.webRequest 实现，ADR-0001）
 * @see 文档 7.2 NetworkAdapter
 *
 * - 请求/响应事件经 session.webRequest（注意：webRequest 不提供响应体；
 *   响应体捕获属 c48 未来迁移课题，见 ADR-0005）
 * - cookie 读取经 session.cookies（比 CDP Network.getCookies 更直接）
 */
export class ElectronNetworkAdapter implements NetworkAdapter {
  private requestListeners: Array<(req: NetworkRequest) => void> = []
  private responseListeners: Array<(res: NetworkResponse) => void> = []
  private connected = false

  constructor(private readonly webContents: WebContents) {}

  connect(): void {
    if (this.connected) return
    const session = this.webContents.session

    session.webRequest.onBeforeSendHeaders((details, callback) => {
      for (const cb of this.requestListeners) {
        cb({ url: details.url, method: details.method, headers: details.requestHeaders ?? {} })
      }
      callback({})
    })

    session.webRequest.onCompleted((details) => {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
        headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
      }
      for (const cb of this.responseListeners) {
        cb({ url: details.url, status: details.statusCode ?? 0, headers })
      }
    })

    this.connected = true
  }

  onRequest(callback: (request: NetworkRequest) => void): void {
    this.requestListeners.push(callback)
  }

  onResponse(callback: (response: NetworkResponse) => void): void {
    this.responseListeners.push(callback)
  }

  async getCookies(domain?: string): Promise<NetworkCookie[]> {
    const cookies = await this.webContents.session.cookies.get(
      domain ? { domain } : {}
    )
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain ?? '',
      path: cookie.path ?? '/'
    }))
  }
}
