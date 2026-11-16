const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('island', {
  init: () => ipcRenderer.invoke('init'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onEnv: (cb) => ipcRenderer.on('env', (_e, s) => cb(s)),
  onCall: (cb) => ipcRenderer.on('call', (_e, c) => cb(c)),
  onCallEnd: (cb) => ipcRenderer.on('call-end', () => cb()),
  onNotif: (cb) => ipcRenderer.on('notif', (_e, n) => cb(n)),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  cmd: (action) => ipcRenderer.invoke('cmd', action),
  resize: (w, h) => ipcRenderer.send('resize', w, h),
  save: (patch) => ipcRenderer.invoke('save', patch),
  openApp: () => ipcRenderer.invoke('open-app'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  openPrivacy: () => ipcRenderer.invoke('open-privacy'),
  openAutomation: () => ipcRenderer.invoke('open-automation'),
  weatherSearch: (query) => ipcRenderer.invoke('weather-search', query),
  weatherSelect: (place) => ipcRenderer.invoke('weather-select', place),
  weatherRefresh: () => ipcRenderer.invoke('weather-refresh'),
  weatherFocus: (enabled) => ipcRenderer.send('weather-focus', enabled),
  quit: () => ipcRenderer.send('quit')
});
