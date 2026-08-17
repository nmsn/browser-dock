import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('dock', api)
} else {
  // @ts-ignore
  window.dock = api
}
