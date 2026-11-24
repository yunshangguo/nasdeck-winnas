'use strict';
// 设置窗口通过 contextBridge 拿到的最小 API；主窗口（Web 桌面）也会加载本文件，
// 但它不会使用这些接口，互不影响。nodeIntegration=false / contextIsolation=true。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nasdeckDesktop', {
  isDesktop: true,
  getSettings: () => ipcRenderer.invoke('nasdeck:get-settings'),
  getStatus: () => ipcRenderer.invoke('nasdeck:get-status'),
  getLogs: () => ipcRenderer.invoke('nasdeck:get-logs'),
  saveSettings: data => ipcRenderer.invoke('nasdeck:save-settings', data),
  apiGet: p => ipcRenderer.invoke('nasdeck:api', p),
  pickDir: () => ipcRenderer.invoke('nasdeck:pick-dir'),
  openMain: () => ipcRenderer.invoke('nasdeck:open-main'),
  reloadMain: () => ipcRenderer.invoke('nasdeck:reload-main'),
  openDataDir: () => ipcRenderer.invoke('nasdeck:open-data-dir'),
  openExternal: url => ipcRenderer.invoke('nasdeck:open-external', url),
  restartApp: () => ipcRenderer.invoke('nasdeck:restart-app'),
  onStatus: cb => {
    const listener = (e, payload) => { try { cb(payload); } catch (err) { /* 渲染层异常不打断推送 */ } };
    ipcRenderer.on('nasdeck:status', listener);
    return () => ipcRenderer.removeListener('nasdeck:status', listener);
  }
});
