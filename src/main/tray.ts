import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'path'
import logger from './logger'

/**
 * 系统托盘
 * @see 文档 10.3 应用退出和系统能力 / 2.3.1 设置（托盘行为）
 *
 * - 托盘菜单：显示主窗口 / 退出
 * - 点击托盘图标恢复主窗口
 */

let tray: Tray | null = null

function loadIcon(): Electron.NativeImage {
  // 打包后位于 process.resourcesPath，开发时位于项目 build/ 目录
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(app.getAppPath(), 'build', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    logger.warn({ iconPath }, 'Tray icon not found, using empty image')
  }
  icon.setTemplateImage(true)
  return icon
}

export function createTray(onShow: () => void): Tray {
  if (tray) return tray

  tray = new Tray(loadIcon())
  tray.setToolTip('Browser Dock')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => onShow()
    },
    { type: 'separator' },
    {
      label: '退出 Browser Dock',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)

  tray.on('click', () => onShow())
  logger.info('Tray created')
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
