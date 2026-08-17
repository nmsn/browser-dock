import { app } from 'electron'
import { join } from 'path'

// 应用数据目录
export const APP_DATA_PATH = app.getPath('userData')

// 数据库路径
export const DB_PATH = join(APP_DATA_PATH, 'browser-dock.db')

// Chrome 用户数据目录
export const PROFILES_PATH = join(APP_DATA_PATH, 'profiles')

// 日志目录
export const LOGS_PATH = join(APP_DATA_PATH, 'logs')

// 截图目录
export const SCREENSHOTS_PATH = join(APP_DATA_PATH, 'screenshots')

// 代理配置目录
export const PROXY_CONFIG_PATH = join(APP_DATA_PATH, 'proxy')

// 全局配置
export const DEFAULT_CONFIG = {
  maxConcurrency: 3,
  logRetentionDays: 30,
  screenshotRetentionDays: 30,
  defaultTimeoutMs: 120000,
  defaultRetryPolicy: {
    maxAttempts: 3,
    backoffMs: 5000
  }
}
