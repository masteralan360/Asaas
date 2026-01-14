const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

// Register local-resource protocol to allow loading local images
protocol.registerSchemesAsPrivileged([
    { scheme: 'erpimg', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true, corsEnabled: true } }
]);

// Simple file logger for production debugging
function logToFile(message) {
    const logPath = path.join(app.getPath('userData'), 'debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

// Suppress annoying upstream Electron/Chromium logs
const originalStderrWrite = process.stderr.write;
process.stderr.write = function (chunk, encoding, callback) {
    const str = chunk.toString();
    if (str.includes('Autofill.setAddresses') || str.includes('devtools://')) {
        return true;
    }
    return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
};

let mainWindow;

function createWindow() {
    logToFile('createWindow called');
    const isDev = !app.isPackaged;
    logToFile(`isDev: ${isDev}`);

    try {
        // Use nativeImage for safer icon loading (doesn't throw if file missing)
        // Switch to .ico as requested (better for Windows)
        // In dev: ../public/logo.ico
        // In prod: ../dist/logo.ico (copied by vite)
        const iconPath = path.join(__dirname, isDev ? '../public/logo.ico' : '../dist/logo.ico');
        logToFile(`Icon path resolved to: ${iconPath}`);

        let icon = null;
        try {
            icon = nativeImage.createFromPath(iconPath);
            logToFile(`Icon created successfully: ${!icon.isEmpty()}`);
            if (icon.isEmpty()) {
                logToFile('WARNING: Icon is empty! Trying png fallback...');
                const pngPath = path.join(__dirname, isDev ? '../public/logo.png' : '../dist/logo.png');
                icon = nativeImage.createFromPath(pngPath);
                logToFile(`PNG fallback created: ${!icon.isEmpty()}`);
            }
        } catch (e) {
            logToFile(`Error creating icon: ${e.message}`);
        }

        mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            icon: icon,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.cjs'),
                webSecurity: true
            }
        });

        logToFile('BrowserWindow created');

        if (isDev) {
            logToFile('Loading URL: http://localhost:5173');
            mainWindow.loadURL('http://localhost:5173');
        } else {
            const filePath = path.join(__dirname, '../dist/index.html');
            logToFile(`Loading file: ${filePath}`);
            if (!fs.existsSync(filePath)) {
                logToFile('CRITICAL: dist/index.html does not exist!');
            }
            mainWindow.loadFile(filePath).catch(e => {
                logToFile(`Error loading file: ${e.message}`);
            });
        }
    } catch (error) {
        logToFile(`CRITICAL ERROR in createWindow: ${error.message}\n${error.stack}`);
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

    // Auto-updater configuration - Register listeners BEFORE checking
    autoUpdater.on('checking-for-update', () => {
        mainWindow?.webContents.send('update-status', { status: 'checking' });
    })

    autoUpdater.on('update-available', () => {
        mainWindow?.webContents.send('update-status', { status: 'available' });
    })

    autoUpdater.on('update-not-available', () => {
        mainWindow?.webContents.send('update-status', { status: 'not-available' });
    })

    autoUpdater.on('update-downloaded', () => {
        mainWindow?.webContents.send('update-status', { status: 'downloaded' });
        dialog.showMessageBox({
            type: 'info',
            title: 'Update Ready',
            message: 'A new version of the ERP System has been downloaded. Restart now to install?',
            buttons: ['Restart', 'Later']
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    })

    autoUpdater.on('download-progress', (progressObj) => {
        mainWindow?.webContents.send('update-status', {
            status: 'progress',
            progress: progressObj.percent
        });
    })

    autoUpdater.on('error', (err) => {
        console.error('[AutoUpdater] Error:', err)
        mainWindow?.webContents.send('update-status', {
            status: 'error',
            message: err.message
        });
    })

    // Check for updates on startup (with slight delay to ensure window is ready)
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 3000);

    // IPC to trigger manual check
    ipcMain.handle('check-for-updates', () => {
        if (process.env.NODE_ENV === 'development') {
            // Simulate check in dev
            setTimeout(() => {
                mainWindow?.webContents.send('update-status', { status: 'not-available', message: 'Dev mode: No updates.' });
            }, 1000);
            return;
        }
        autoUpdater.checkForUpdates();
    });

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

ipcMain.handle('fetch-exchange-rate', async (event, url) => {
    return new Promise((resolve, reject) => {
        const request = net.request(url);
        request.on('response', (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP Error ${response.statusCode}`));
                }
            });
        });
        request.on('error', (error) => {
            reject(error);
        });
        request.end();
    });
});
