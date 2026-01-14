const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'electronAPI', {
    selectProductImage: (workspaceId) => ipcRenderer.invoke('select-product-image', workspaceId),
    isElectron: () => ipcRenderer.invoke('is-electron').catch(() => false),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    onUpdateStatus: (callback) => {
        const subscription = (_event, value) => callback(value)
        ipcRenderer.on('update-status', subscription)
        return () => ipcRenderer.removeListener('update-status', subscription)
    },
    fetchExchangeRate: (url) => ipcRenderer.invoke('fetch-exchange-rate', url)
}
)
