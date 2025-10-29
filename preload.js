const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getServerInfo: () => ipcRenderer.invoke('get-server-info'),
    onServerInfo: (callback) => ipcRenderer.on('server-info', (event, info) => callback(info))
});