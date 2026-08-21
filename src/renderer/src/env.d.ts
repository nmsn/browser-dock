import type { DockAPI } from '../../shared/types'

declare global {
  interface Window {
    dock: DockAPI
  }
}

export {}
