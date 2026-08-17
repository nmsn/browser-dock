import type {
  NetworkAdapter,
  NetworkCookie,
  NetworkRequest,
  NetworkResponse
} from '../../../shared/types'

/**
 * 网络适配器（基于 CDP Network 域）
 * @see 文档 7.2 NetworkAdapter
 */

export class CdpNetworkAdapter implements NetworkAdapter {
  private requestListeners: Array<(req: NetworkRequest) => void> = []
  private responseListeners: Array<(res: NetworkResponse) => void> = []

  onRequest(callback: (request: NetworkRequest) => void): void {
    this.requestListeners.push(callback)
  }

  onResponse(callback: (response: NetworkResponse) => void): void {
    this.responseListeners.push(callback)
  }

  async getCookies(domain?: string): Promise<NetworkCookie[]> {
    // 实际实现：通过 CDP Network.getCookies
    void domain
    return []
  }

  // CDP 事件分发
  emitRequest(request: NetworkRequest): void {
    for (const cb of this.requestListeners) cb(request)
  }

  emitResponse(response: NetworkResponse): void {
    for (const cb of this.responseListeners) cb(response)
  }
}
