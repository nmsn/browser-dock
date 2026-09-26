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
  handleEvent: (status: ExecutionStatus, log: Partial<ExecutionLog>) => void
  handleLog: (log: ExecutionLog) => void
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
  },

  // 实时事件处理（文档 11.3）：状态变化时更新对应记录，无需整表刷新
  handleEvent: (status, log) => {
    set((state) => {
      if (!log.id) return state
      const exists = state.logs.some((l) => l.id === log.id)
      if (exists) {
        return {
          logs: state.logs.map((l) => (l.id === log.id ? { ...l, status: status ?? l.status } : l))
        }
      }
      // 新记录加入顶部
      const entry: ExecutionLog = {
        id: log.id,
        taskId: log.taskId ?? '',
        accountId: log.accountId ?? '',
        status: status,
        attempt: 1,
        startedAt: new Date().toISOString()
      }
      return { logs: [entry, ...state.logs].slice(0, 100) }
    })
  },

  handleLog: (log) => {
    set((state) => {
      const exists = state.logs.some((l) => l.id === log.id)
      if (exists) {
        return { logs: state.logs.map((l) => (l.id === log.id ? log : l)) }
      }
      return { logs: [log, ...state.logs].slice(0, 100) }
    })
  }
}))