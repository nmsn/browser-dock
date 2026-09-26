import type { StorageAdapter } from '../../../shared/types'

/**
 * 任务上下文存储适配器
 * @see 文档 7.2 StorageAdapter
 *
 * 限制（文档 9.2）：
 * - 仅允许在任务上下文中存储
 * - 禁止访问其他账号的数据
 */

export class TaskStorageAdapter implements StorageAdapter {
  private store = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}
