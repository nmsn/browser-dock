import { create } from 'zustand'
import type { Account, CreateAccountInput } from '../../../shared/types'

/**
 * 账号管理状态（renderer）
 *
 * 嵌入式架构（ADR-0001）：执行用离屏视图（无可见窗口），登录通过同分区登录窗扫码；
 * 登录态持久化在分区会话中，执行不依赖任何可见窗口。
 */

interface AccountsState {
  accounts: Account[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  createAccount: (input: CreateAccountInput) => Promise<Account | null>
  deleteAccount: (id: string) => Promise<boolean>
  startLogin: (id: string) => Promise<boolean>
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const list = await window.dock.accountsList()
      set({ accounts: list, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  createAccount: async (input) => {
    try {
      const account = await window.dock.accountsCreate(input)
      await get().load()
      return account
    } catch (err) {
      set({ error: (err as Error).message })
      return null
    }
  },

  deleteAccount: async (id) => {
    try {
      const ok = await window.dock.accountsDelete(id)
      if (ok) {
        set((state) => ({
          accounts: state.accounts.filter((a) => a.id !== id)
        }))
      }
      return ok
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  },

  /**
   * 登录：打开同分区登录窗并导航到淘宝登录页；后台等待扫码结果（最长 5 分钟），
   * 完成后自动刷新账号列表（登录状态 / 淘宝账号ID）。
   */
  startLogin: async (id) => {
    try {
      await window.dock.loginStart(id)
      void window.dock
        .loginWaitResult(id, 300_000)
        .finally(() => {
          void get().load()
        })
      return true
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  }
}))
