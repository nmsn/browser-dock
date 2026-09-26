import type {
  Account,
  AccountContext,
  NetworkAdapter,
  PageAdapter,
  StorageAdapter,
  TaskLogger
} from '../../../shared/types'
import { TaskStorageAdapter } from './storage-adapter'

/**
 * 构造 AutomationContext
 * @see 文档 7.2 AutomationContext
 *
 * 嵌入式架构（ADR-0001）：适配器由调用方按执行宿主构造后传入
 * （Electron 视图 → ElectronPageAdapter/ElectronNetworkAdapter；
 *  外部 Chrome 过渡路径见 @deprecated 的 CdpPageAdapter/CdpNetworkAdapter）。
 */
export function buildAutomationContext(
  account: Account,
  adapters: { page: PageAdapter; network: NetworkAdapter },
  logger: TaskLogger,
  signal: AbortSignal
): {
  account: AccountContext
  page: PageAdapter
  storage: StorageAdapter
  network: NetworkAdapter
  logger: TaskLogger
  signal: AbortSignal
} {
  return {
    account: {
      accountId: account.id,
      accountName: account.name,
      profilePath: account.profilePath,
      proxy: account.proxyConfig
    },
    page: adapters.page,
    storage: new TaskStorageAdapter(),
    network: adapters.network,
    logger,
    signal
  }
}
