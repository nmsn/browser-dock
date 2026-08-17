import type { Account, AccountContext } from '../../../shared/types'
import type { CdpClient } from '../../chrome/cdp-client'
import type { PageAdapter, StorageAdapter, NetworkAdapter, TaskLogger } from '../../../shared/types'
import { CdpPageAdapter } from './page-adapter'
import { TaskStorageAdapter } from './storage-adapter'
import { CdpNetworkAdapter } from './network-adapter'

/**
 * 构造 AutomationContext
 * @see 文档 7.2 AutomationContext
 */
export function buildAutomationContext(
  account: Account,
  cdp: CdpClient,
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
    page: new CdpPageAdapter(cdp),
    storage: new TaskStorageAdapter(),
    network: new CdpNetworkAdapter(),
    logger,
    signal
  }
}
