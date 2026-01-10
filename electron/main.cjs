const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

// Register local-resource protocol to allow loading local images
protocol.registerSchemesAsPrivileged([
    { scheme: 'erpimg', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true, corsEnabled: true } }
]);

// Suppress annoying upstream Electron/Chromium logs
const originalStderrWrite = process.stderr.write;
process.stderr.write = function (chunk, encoding, callback) {
    const str = chunk.toString();
    if (str.includes('Autofill.setAddresses') || str.includes('devtools://')) {
        return true;
    }
    return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
};

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            webSecurity: true
        }
    })

    const isDev = !app.isPackaged;

    if (isDev) {
        win.loadURL('http://localhost:5173')
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'))
    }
}

app.whenReady().then(() => {
    // Direct file reading via erpimg protocol
    protocol.handle('erpimg', async (request) => {
        try {
            const url = new URL(request.url);
            let filePath = decodeURIComponent(url.pathname);

            if (process.platform === 'win32' && filePath.startsWith('/') && filePath[2] === ':') {
                filePath = filePath.slice(1);
            }

            const normalizedPath = path.normalize(filePath);

            if (!fs.existsSync(normalizedPath)) {
                return new Response('Not Found', { status: 404 });
            }

            const data = fs.readFileSync(normalizedPath);
            const ext = path.extname(normalizedPath).toLowerCase();
            const mime = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp',
                '.gif': 'image/gif'
            }[ext] || 'application/octet-stream';

            return new Response(data, {
                headers: { 'Content-Type': mime }
            });
        } catch (error) {
            console.error('[erpimg] Error:', error);
            return new Response('Protocol Error', { status: 500 });
        }
    });

    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// IPC Handlers
ipcMain.handle('select-product-image', async (event, workspaceId) => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }]
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const sourcePath = result.filePaths[0];
    const ext = path.extname(sourcePath);
    const fileName = `${Date.now()}${ext}`;

    // Directory: AppData/ERP-System/product-images/<workspaceId>/
    const baseDir = path.join(app.getPath('userData'), 'product-images', workspaceId.toString());

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    const targetPath = path.join(baseDir, fileName);
    fs.copyFileSync(sourcePath, targetPath);

    return targetPath;
});

ipcMain.handle('is-electron', () => true);
