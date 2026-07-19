import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerCameraHandlers } from './ipc/camera.ipc'
import { registerPrinterHandlers } from './ipc/printer.ipc'
import { registerSystemHandlers } from './ipc/system.ipc'
import { registerImageHandlers } from './ipc/image.ipc'
import { registerEmailHandlers } from './ipc/email.ipc'
import { registerDriveHandlers } from './ipc/drive.ipc'
import { registerCloudHandlers } from './ipc/cloud.ipc'
import { registerQueueHandlers } from './ipc/queue.ipc'
import { registerPaymentHandlers } from './ipc/payment.ipc'
import './services/ConfigService' // Boot ConfigService natively

// Global safeguard to prevent Photobooth crash on USB/Hardware random disconnects
process.on('uncaughtException', (error) => {
    console.error('[System Fault] Prevented crash from uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[System Fault] Prevented crash from unhandled rejection. Reason:', reason);
});

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        autoHideMenuBar: true,
        fullscreen: false,
        frame: true,
        resizable: true,
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false // Allow loading local file:// images
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show()
    })

    // Forward renderer console logs to the main process terminal for easier debugging
    mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
        const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        const file = sourceId.split('/').pop()?.split('\\').pop() || sourceId;
        console.log(`[Renderer ${levels[level] || 'LOG'}] (${file}:${line}) ${message}`);
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // Load the renderer
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

// App lifecycle
app.whenReady().then(() => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.sebooth.app')

    // Watch for shortcuts in development
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    // Register all IPC handlers
    registerCameraHandlers(ipcMain)
    registerPrinterHandlers(ipcMain)
    registerSystemHandlers(ipcMain)
    registerImageHandlers(ipcMain)
    registerEmailHandlers(ipcMain)
    registerDriveHandlers(ipcMain)
    registerCloudHandlers()
    registerQueueHandlers()
    registerPaymentHandlers(ipcMain)
    
    // Auto-sweep old heavy media off SSD
    import('./services/Janitor').then(({ janitor }) => janitor.runCleanup())

    // Launch background sharing web server (port 5050)
    import('./server').then(({ startLocalServer }) => {
        startLocalServer(5050)
    }).catch(err => console.error('Failed to start local sharing server:', err))

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Handle fullscreen toggle
ipcMain.handle('window:toggle-fullscreen', () => {
    if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen())
        return mainWindow.isFullScreen()
    }
    return false
})

ipcMain.handle('window:toggle-kiosk', () => {
    if (mainWindow) {
        mainWindow.setKiosk(!mainWindow.isKiosk())
        return mainWindow.isKiosk()
    }
    return false
})
