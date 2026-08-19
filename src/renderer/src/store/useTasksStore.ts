import { create } from 'zustand'
import type { Task, CreateTaskInput } from '../../../shared/types'

/**
 * 任务管理状态（renderer）
 */

interface TasksState {
  tasks: Task[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task | null>
  updateTask: (id: string, patch: Partial<Omit<Task, 'id' | 'createdAt' | 'version'>>) => Promise<Task | null>
  deleteTask: (id: string) => Promise<boolean>
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const tasks = await window.dock.tasksList()
      set({ tasks, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  createTask: async (input) => {
    try {
      const task = await window.dock.tasksCreate(input)
      await useTasksStore.getState().load()
      return task
    } catch (err) {
      set({ error: (err as Error).message })
      return null
    }
  },

  updateTask: async (id, patch) => {
    try {
      const task = await window.dock.tasksUpdate(id, patch)
      await useTasksStore.getState().load()
      return task
    } catch (err) {
      set({ error: (err as Error).message })
      return null
    }
  },

  deleteTask: async (id) => {
    try {
      const ok = await window.dock.tasksDelete(id)
      if (ok) {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }))
      }
      return ok
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  }
}))