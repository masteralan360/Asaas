const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'electronAPI', {
    selectProductImage: (workspaceId) => ipcRenderer.invoke('select-product-image', workspaceId),
    isElectron: () => ipcRenderer.invoke('is-electron').catch(() => false)
}
)
