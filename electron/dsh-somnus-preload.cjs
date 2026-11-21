'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Narrow bridge for Somnus domain pages rendered inside the DSH shell.
 * Only loopback API paths are accepted by the main process handler.
 */
contextBridge.exposeInMainWorld('somnusApi', {
  request: (path, init = {}) => ipcRenderer.invoke('somnus:api:request', {
    path,
    method: init.method || 'GET',
    headers: init.headers || {},
    body: init.body === undefined ? undefined : init.body,
  }),
  configuration: (method, args = []) => ipcRenderer.invoke('somnus:configuration', method, args),
  origin: () => ipcRenderer.invoke('somnus:origin'),
  acp: () => ipcRenderer.invoke('somnus:acp:info'),
  setAcpModel: modelId => ipcRenderer.invoke('somnus:acp:model', modelId),
  setAcpApproval: mode => ipcRenderer.invoke('somnus:acp:approval', mode),
  purgeSession: sessionId => ipcRenderer.invoke('somnus:session:purge', sessionId),  menu: (kind, x, y) => ipcRenderer.send('somnus:menu:popup', { kind, x, y }),
});
