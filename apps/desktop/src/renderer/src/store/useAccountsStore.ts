import { create } from 'zustand'
import type { Account, AccountRuntime, CreateAccountInput } from '../../../shared/types'

/**
 * 账号管理状态（renderer）
 */

interface AccountsState {
  accounts: Account[]
  runtimes: Record<string, AccountRuntime>
  loading: boolean
  error: string | null

  load: () => Promise<void>
  createAccount: (input: CreateAccountInput) => Promise<Account | null>
  deleteAccount: (id: string) => Promise<boolean>
  startBrowser: (id: string) => Promise<boolean>
  stopBrowser: (id: string) => Promise<boolean>
  startLogin: (id: string) => Promise<boolean>
  refreshRuntimes: () => Promise<void>
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  runtimes: {},
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const list = await window.dock.accountsList()
      set({ accounts: list, loading: false })
      await get().refreshRuntimes()
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
          accounts: state.accounts.filter((a) => a.id !== id),
          runtimes: { ...state.runtimes, [id]: undefined } as Record<string, AccountRuntime>
        }))
      }
      return ok
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  },

  startBrowser: async (id) => {
    try {
      const runtime = await window.dock.browserStart(id)
      set((state) => ({ runtimes: { ...state.runtimes, [id]: runtime } }))
      const account = get().accounts.find((a) => a.id === id)
      if (account) await window.dock.loginStart(id)
      return true
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  },

  stopBrowser: async (id) => {
    try {
      await window.dock.browserStop(id)
      set((state) => {
        const next = { ...state.runtimes }
        delete next[id]
        return { runtimes: next }
      })
      return true
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  },

  startLogin: async (id) => {
    try {
      await window.dock.loginStart(id)
      return true
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  },

  refreshRuntimes: async () => {
    try {
      const runtimes = await window.dock.browserListRuntimes()
      const map: Record<string, AccountRuntime> = {}
      for (const r of runtimes) map[r.accountId] = r
      set({ runtimes: map })
    } catch (err) {
      set({ error: (err as Error).message })
    }
  }
}))