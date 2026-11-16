const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.protocol === 'data:') {
  const channel = 'somnus-runtime-profiles';
  contextBridge.exposeInMainWorld('somnusProfiles', {
    status: () => ipcRenderer.invoke(channel, 'status'),
    create: name => ipcRenderer.invoke(channel, 'create', name),
    select: id => ipcRenderer.invoke(channel, 'select', id),
    recover: operation => ipcRenderer.invoke(channel, operation),
    onRefresh: listener => ipcRenderer.on(channel + ':refresh', () => listener()),
  });
}
