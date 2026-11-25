const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cuttingOptimizer', {
  setLanguage: (language) => ipcRenderer.send('app:language', language),
  optimise: (payload) => ipcRenderer.invoke('optimizer:run', payload),
  saveWorkbook: (bytes, defaultName, language) => ipcRenderer.invoke('workbook:save', bytes, defaultName, language),
});
