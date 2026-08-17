import { ipcMain } from 'electron'
import { app } from 'electron'
import logger from './logger'
import { Keyring } from './secrets/keyring'

/**
 * IPC 处理器注册
 * @see 文档 10.1 Electron 安全基线
 * - IPC 入参在主进程重新校验，不能信任 Renderer 类型声明
 * - 不允许 Renderer 直接执行任意脚本或访问文件系统
 */

export function registerIpcHandlers(): void {
  // 应用信息
  ipcMain.handle('get-version', () => app.getVersion())
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }))

  // 密钥环操作（白名单 API）
  ipcMain.handle('keyring:set', (_event, key: string, value: string) => {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid keyring arguments')
    }
    Keyring.setPassword(key, value)
    logger.debug({ key }, 'Keyring set')
  })

  ipcMain.handle('keyring:get', (_event, key: string) => {
    if (typeof key !== 'string') throw new Error('Invalid keyring key')
    return Keyring.getPassword(key)
  })

  ipcMain.handle('keyring:delete', (_event, key: string) => {
    if (typeof key !== 'string') throw new Error('Invalid keyring key')
    return Keyring.deletePassword(key)
  })

  logger.info('IPC handlers registered')
}
