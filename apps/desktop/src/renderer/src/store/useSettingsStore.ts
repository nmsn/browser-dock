import { create } from 'zustand'
import type { AppSettings, UpdateSettingsInput } from '../../../shared/types'

/**
 * 应用设置状态（renderer）
 */

interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  error: string | null

  load: () => Promise<void>
  update: (patch: UpdateSettingsInput) => Promise<AppSettings | null>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await window.dock.settingsGet()
      set({ settings, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  update: async (patch) => {
    set({ saving: true, error: null })
    try {
      const settings = await window.dock.settingsUpdate(patch)
      set({ settings, saving: false })
      return settings
    } catch (err) {
      set({ error: (err as Error).message, saving: false })
      return null
    }
  }
}))
