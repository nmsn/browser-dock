import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { APP_DATA_PATH } from '../config'
import type { AppSettings, UpdateSettingsInput } from '../../shared/types'
import logger from '../logger'

/**
 * 应用设置存储（JSON 文件持久化）
 * @see 文档 2.3.1 设置 / 10.3 应用退出和系统能力
 *
 * 设置项为全局低频配置，使用 JSON 文件而非 SQLite，
 * 与 Mirage 的 config.json 模式一致，避免引入额外迁移。
 */

const SETTINGS_PATH = join(APP_DATA_PATH, 'settings.json')

export const DEFAULT_SETTINGS: AppSettings = {
  chromePath: '',
  maxConcurrency: 3,
  logRetentionDays: 30,
  screenshotRetentionDays: 30,
  notifyOnExecution: true,
  launchAtLogin: false,
  closeToTray: false,
  enableInspection: false
}

let cached: AppSettings | null = null

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : NaN
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 校验并规范化设置补丁（IPC 入参在主进程重新校验，文档 10.1）
 */
export function normalizeSettingsPatch(patch: UpdateSettingsInput): UpdateSettingsInput {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid settings patch')
  const normalized: UpdateSettingsInput = {}

  if (patch.chromePath !== undefined) {
    if (typeof patch.chromePath !== 'string') throw new Error('chromePath must be a string')
    normalized.chromePath = patch.chromePath.trim()
  }
  if (patch.maxConcurrency !== undefined) {
    normalized.maxConcurrency = clampInt(patch.maxConcurrency, 1, 10, DEFAULT_SETTINGS.maxConcurrency)
  }
  if (patch.logRetentionDays !== undefined) {
    normalized.logRetentionDays = clampInt(patch.logRetentionDays, 1, 365, DEFAULT_SETTINGS.logRetentionDays)
  }
  if (patch.screenshotRetentionDays !== undefined) {
    normalized.screenshotRetentionDays = clampInt(
      patch.screenshotRetentionDays,
      1,
      365,
      DEFAULT_SETTINGS.screenshotRetentionDays
    )
  }
  if (patch.notifyOnExecution !== undefined) {
    normalized.notifyOnExecution = Boolean(patch.notifyOnExecution)
  }
  if (patch.launchAtLogin !== undefined) {
    normalized.launchAtLogin = Boolean(patch.launchAtLogin)
  }
  if (patch.closeToTray !== undefined) {
    normalized.closeToTray = Boolean(patch.closeToTray)
  }
  if (patch.enableInspection !== undefined) {
    normalized.enableInspection = Boolean(patch.enableInspection)
  }

  return normalized
}

/**
 * 读取设置（带缓存，未初始化时返回默认值）
 */
export function getSettings(): AppSettings {
  if (cached) return cached
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Partial<AppSettings>
      cached = { ...DEFAULT_SETTINGS, ...normalizeSettingsPatch(raw) } as AppSettings
      return cached
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read settings, using defaults')
  }
  cached = { ...DEFAULT_SETTINGS }
  return cached
}

/**
 * 更新设置（合并写入 JSON 文件）
 */
export function updateSettings(patch: UpdateSettingsInput): AppSettings {
  const current = getSettings()
  const normalized = normalizeSettingsPatch(patch)
  const next: AppSettings = { ...current, ...normalized }

  mkdirSync(APP_DATA_PATH, { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8')
  cached = next

  logger.info({ keys: Object.keys(normalized) }, 'Settings updated')
  return next
}

/**
 * 应用开机自启动设置（文档 10.3 系统能力）
 * 在 app ready 前后均可调用；openAtLogin 由系统管理
 */
export function applyLaunchAtLogin(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to set login item')
  }
}
