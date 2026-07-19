import fs from 'fs'
import path from 'path'
import { app, ipcMain } from 'electron'
import { AppConfig } from '@shared/types'

export class ConfigService {
    private configPath: string
    private config: AppConfig | null = null
    
    // Default fallback configurations
    private readonly defaultConfig: AppConfig = {
        countdownDuration: 5,
        previewDuration: 2,
        sessionTimeout: 120,
        activeFrameIds: [],
        timerEnabled: true,
        printerEnabled: false,
        printerName: '',
        frameSelectionTimeout: 60,
        captureTimeout: 120,
        postProcessingTimeout: 90,
        sessionTimerEnabled: true,
        paymentEnabled: false,
        paymentGateway: 'midtrans',
        sessionPrice: 25000,
        additionalPrintPrice: 5000,
        midtransClientKey: '',
        midtransServerKey: '',
        dokuClientId: '',
        dokuSecretKey: '',
        dokuSandbox: true,
        paymentInstructions: 'Scan QR code dengan aplikasi e-wallet atau mobile banking Anda.',
        paymentTimeout: 300,
        sharingMode: 'cloud',
        cloudPortalUrl: '',
        cameraMode: 'mock',
        selectedCameraId: undefined,
        // Queue Integration
        queueEnabled: false,
        queueEventId: '',
        queueWebhookSecret: 'sebooth-queue-webhook-2026',
        queueApiUrl: 'https://www.sebooth.in',
        appOrientation: 'landscape',
        mirrorOutput: false,
        cameraZoom: 1.0,
        cameraScaleX: 1.0,
        cameraScaleY: 1.0,
        cameraOffsetX: 0,
        cameraOffsetY: 0
    }

    constructor() {
        const userDataPath = app.getPath('userData')
        this.configPath = path.join(userDataPath, 'sebooth_server_config.json')
        this.loadConfig()
        this.registerIpcHandlers()
    }

    public getConfig(): AppConfig {
        if (!this.config) {
            this.loadConfig()
        }
        return this.config || this.defaultConfig
    }

    public updateConfig(updates: Partial<AppConfig>): AppConfig {
        const current = this.getConfig()
        this.config = { ...current, ...updates }
        this.saveConfig()
        
        // Broadcast the update to all webContents (the Local Kiosk Electron screens)
        const windows = require('electron').BrowserWindow.getAllWindows()
        for (const win of windows) {
            win.webContents.send('config:updated', this.config)
        }
        
        return this.config
    }

    private loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8')
                const diskConfig = JSON.parse(data)
                // Merge with default to catch any newly added schema fields
                this.config = { ...this.defaultConfig, ...diskConfig }
            } else {
                this.config = this.defaultConfig
                this.saveConfig()
            }
            console.log('[ConfigService] Loaded configuration from disk successfully.')
        } catch (error) {
            console.error('[ConfigService] Failed to parse config file, falling back to defaults:', error)
            this.config = this.defaultConfig
        }
    }

    private saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
        } catch (error) {
            console.error('[ConfigService] Failed to write config to disk:', error)
        }
    }

    private registerIpcHandlers() {
        ipcMain.handle('config:get', () => {
            return { success: true, data: this.getConfig() }
        })
        
        ipcMain.handle('config:update', (_, updates: Partial<AppConfig>) => {
            const newConfig = this.updateConfig(updates)
            return { success: true, data: newConfig }
        })
    }
}

// Export a singleton instance
export const configService = new ConfigService()
