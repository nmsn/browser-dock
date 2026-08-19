import { create } from 'zustand'
import type { ExecutionLog, ExecutionStatus } from '../../../shared/types'

/**
 * 执行监控状态（renderer）
 * @see 文档 11.3 UI 状态
 */

export interface ExecutionFilter {
  accountId?: string
  taskId?: string
  status?: ExecutionStatus
}

interface ExecutionState {
  logs: ExecutionLog[]
  loading: boolean
  error: string | null
  filter: ExecutionFilter

  load: () => Promise<void>
  setFilter: (patch: Partial<ExecutionFilter>) => void
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  logs: [],
  loading: false,
  error: null,
  filter: {},

  load: async () => {
    set({ loading: true, error: null })
    try {
      const { filter } = get()
      const logs = await window.dock.executionList({
        accountId: filter.accountId,
        taskId: filter.taskId,
        status: filter.status,
        limit: 100
      })
      set({ logs, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  setFilter: (patch) => {
    set({ filter: { ...get().filter, ...patch } })
    get().load()
  }
}))