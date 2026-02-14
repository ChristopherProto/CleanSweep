const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectCleanupDest: () => ipcRenderer.invoke('select-cleanup-dest'),
  scanFolder: (p) => ipcRenderer.invoke('scan-folder', p),
  deepScanFile: (p) => ipcRenderer.invoke('deep-scan-file', p),
  getSubfolders: (p) => ipcRenderer.invoke('get-subfolders', p),
  moveFile: (s, d) => ipcRenderer.invoke('move-file', { src: s, dest: d }),
  copyFile: (s, d) => ipcRenderer.invoke('copy-file', { src: s, dest: d }),
  deleteFile: (p) => ipcRenderer.invoke('delete-file', p),
  checkDiskSpace: (p) => ipcRenderer.invoke('check-disk-space', p),
  createFolder: (p) => ipcRenderer.invoke('create-folder', p),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  saveSweepLog: (d) => ipcRenderer.invoke('save-sweep-log', d),
  listSweepLogs: () => ipcRenderer.invoke('list-sweep-logs'),
  loadSweepLog: (d) => ipcRenderer.invoke('load-sweep-log', d),
  deleteSweepLog: (d) => ipcRenderer.invoke('delete-sweep-log', d),
  undoSweep: (d) => ipcRenderer.invoke('undo-sweep', d),
});
