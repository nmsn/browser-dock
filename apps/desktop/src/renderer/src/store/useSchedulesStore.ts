import { create } from 'zustand'
import type { Schedule, CreateScheduleInput } from '../../../shared/types'

/**
 * 调度管理状态（renderer）
 */

interface SchedulesState {
  schedules: Schedule[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  createSchedule: (input: CreateScheduleInput) => Promise<Schedule | null>
  updateSchedule: (id: string, patch: Partial<Omit<Schedule, 'id' | 'createdAt'>>) => Promise<Schedule | null>
  deleteSchedule: (id: string) => Promise<boolean>
}

export const useSchedulesStore = create<SchedulesState>((set) => ({
  schedules: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const schedules = await window.dock.schedulesList()
      set({ schedules, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  createSchedule: async (input) => {
    try {
      const schedule = await window.dock.schedulesCreate(input)
      await useSchedulesStore.getState().load()
      return schedule
    } catch (err) {
      set({ error: (err as Error).message })
      return null
    }
  },

  updateSchedule: async (id, patch) => {
    try {
      const schedule = await window.dock.schedulesUpdate(id, patch)
      await useSchedulesStore.getState().load()
      return schedule
    } catch (err) {
      set({ error: (err as Error).message })
      return null
    }
  },

  deleteSchedule: async (id) => {
    try {
      const ok = await window.dock.schedulesDelete(id)
      if (ok) {
        set((state) => ({ schedules: state.schedules.filter((s) => s.id !== id) }))
      }
      return ok
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    }
  }
}))