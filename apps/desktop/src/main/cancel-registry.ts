/**
 * 可取消执行注册表
 * @see 文档 8.3 任务取消必须支持 AbortSignal，确保 Chrome 和网络请求最终释放
 *
 * 通过 executionId -> AbortController 的映射，支持外部（IPC/UI）取消任务。
 */

type Aborter = AbortController

const controllers = new Map<string, Aborter>()

/**
 * 注册可取消执行
 */
export function registerCancellable(executionId: string, controller: Aborter): void {
  controllers.set(executionId, controller)
}

/**
 * 取消执行
 * @returns 是否存在该执行并已触发取消
 */
export function cancelExecution(executionId: string): boolean {
  const controller = controllers.get(executionId)
  if (!controller || controller.signal.aborted) return false
  controller.abort('cancelled')
  controllers.delete(executionId)
  return true
}

/**
 * 注销（执行结束时清理，避免泄漏）
 */
export function unregisterCancellable(executionId: string): void {
  controllers.delete(executionId)
}