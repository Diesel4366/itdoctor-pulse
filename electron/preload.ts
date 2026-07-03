import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  openRdp: (ip: string, username?: string, password?: string) =>
    ipcRenderer.invoke('open-rdp', ip, username, password),

  openRustdesk: (id: string) =>
    ipcRenderer.invoke('open-rustdesk', id),

  fetchNetbirdPeers: (config: { url: string; token: string }) =>
    ipcRenderer.invoke('fetch-netbird-peers', config),

  fetchRustdeskPeers: (config: { url: string; token: string }) =>
    ipcRenderer.invoke('fetch-rustdesk-peers', config),

  checkNetbird: () =>
    ipcRenderer.invoke('check-netbird'),

  // Setup wizard APIs
  getHostname: () =>
    ipcRenderer.invoke('get-hostname'),

  getSetupNetworks: (config: { url: string; token: string }) =>
    ipcRenderer.invoke('get-setup-networks', config),

  runClientSetup: (params: any) =>
    ipcRenderer.invoke('run-client-setup', params),

  onSetupStep: (cb: (data: { step: string; label: string; progress: number; sublabel?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('setup-step', handler)
    return () => ipcRenderer.removeListener('setup-step', handler)
  },

  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterDownload: () => ipcRenderer.invoke('updater-download'),
  updaterInstall: () => ipcRenderer.invoke('updater-install'),
  onUpdaterEvent: (cb: (payload: { event: string; data?: any }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: any) => cb(payload)
    ipcRenderer.on('updater-event', handler)
    return () => ipcRenderer.removeListener('updater-event', handler)
  },

  appVersion: () => ipcRenderer.invoke('get-app-version'),
})
