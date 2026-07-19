import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
    CameraDevice,
    CaptureResult,
    CameraPropertyValues,
    PrinterDevice,
    PrintResult,
    PhotoSlot,
    APIResponse
} from '../shared/types'

// Custom APIs for renderer
const api = {
    // Camera APIs
    camera: {
        list: (): Promise<APIResponse<CameraDevice[]>> =>
            ipcRenderer.invoke('camera:list'),

        connect: (cameraId: string): Promise<APIResponse<boolean>> =>
            ipcRenderer.invoke('camera:connect', cameraId),

        disconnect: (): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('camera:disconnect'),

        capture: (slotId?: string, options?: any): Promise<APIResponse<CaptureResult>> =>
            ipcRenderer.invoke('camera:capture', slotId, options),

        status: (): Promise<APIResponse<{ connected: boolean; camera: CameraDevice | null }>> =>
            ipcRenderer.invoke('camera:status'),

        useMock: (): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('camera:use-mock'),

        useReal: (): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('camera:use-real'),

        useDirectPtp: (): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('camera:use-direct-ptp'),

        useCanonEdsdk: (): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('camera:use-canon-edsdk'),

        // Camera Property Control (ISO, Aperture, Shutter Speed)
        setProperty: (property: string, value: string): Promise<APIResponse<boolean>> =>
            ipcRenderer.invoke('camera:set-property', property, value),

        getProperty: (property: string): Promise<APIResponse<string | null>> =>
            ipcRenderer.invoke('camera:get-property', property),

        getAvailableValues: (property: string): Promise<APIResponse<CameraPropertyValues>> =>
            ipcRenderer.invoke('camera:get-available-values', property),

        // Live View Control
        startLiveView: (): Promise<APIResponse<boolean>> =>
            ipcRenderer.invoke('camera:start-liveview'),

        stopLiveView: (): Promise<APIResponse<boolean>> =>
            ipcRenderer.invoke('camera:stop-liveview'),

        getLiveViewUrl: (): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('camera:get-liveview-url'),

        startRecordingLivePhoto: (slotId: string): Promise<APIResponse<boolean>> =>
            ipcRenderer.invoke('camera:start-recording-live-photo', slotId),

        stopRecordingLivePhoto: (slotId: string): Promise<APIResponse<string | null>> =>
            ipcRenderer.invoke('camera:stop-recording-live-photo', slotId)
    },

    // Printer APIs
    printer: {
        list: (): Promise<APIResponse<PrinterDevice[]>> =>
            ipcRenderer.invoke('printer:list'),

        getDefault: (): Promise<APIResponse<PrinterDevice | null>> =>
            ipcRenderer.invoke('printer:default'),

        print: (filePath: string, printerName?: string): Promise<APIResponse<PrintResult>> =>
            ipcRenderer.invoke('printer:print', filePath, printerName),

        printWithOptions: (options: { printerName: string; data: string; copies: number; options?: any }): Promise<APIResponse<PrintResult>> =>
            ipcRenderer.invoke('printer:print-with-options', options),
            
        getQueue: (): Promise<APIResponse<any[]>> =>
            ipcRenderer.invoke('printer:get-queue'),
            
        getHistory: (): Promise<APIResponse<any[]>> =>
            ipcRenderer.invoke('printer:get-history'),
            
        onQueueUpdate: (callback: (queue: any[]) => void) => {
            const sub = (_: any, data: any[]) => callback(data)
            ipcRenderer.on('printer:queue-updated', sub)
            return () => ipcRenderer.removeListener('printer:queue-updated', sub)
        },
        
        onHistoryUpdate: (callback: (history: any[]) => void) => {
            const sub = (_: any, data: any[]) => callback(data)
            ipcRenderer.on('printer:history-updated', sub)
            return () => ipcRenderer.removeListener('printer:history-updated', sub)
        },

        // Remote Printing (Double Device)
        remotePrint: (options: { imageData: string; copies: number; sessionId: string }): Promise<APIResponse<{ jobId?: string }>> =>
            ipcRenderer.invoke('printer:remote-print', options),

        checkPrintServer: (serverUrl?: string): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('printer:check-print-server', serverUrl)
    },

    // System APIs
    system: {
        openFileDialog: (options: {
            title?: string
            filters?: { name: string; extensions: string[] }[]
            multiple?: boolean
        }): Promise<APIResponse<string[]>> =>
            ipcRenderer.invoke('system:open-file-dialog', options),

        getTempPath: (): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:get-temp-path'),

        getLocalIp: (): Promise<APIResponse<string | null>> =>
            ipcRenderer.invoke('system:get-local-ip'),

        getUserDataPath: (): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:get-user-data-path'),

        copyFile: (source: string, destination: string): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:copy-file', source, destination),

        readJson: <T>(filePath: string): Promise<APIResponse<T>> =>
            ipcRenderer.invoke('system:read-json', filePath),

        writeJson: (filePath: string, data: unknown): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('system:write-json', filePath, data),

        fileExists: (filePath: string): Promise<APIResponse<boolean>> =>
            ipcRenderer.invoke('system:file-exists', filePath),

        readFileAsBase64: (filePath: string): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:read-file-base64', filePath),

        saveDataUrl: (dataUrl: string, filename: string): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:save-data-url', dataUrl, filename),

        saveSessionLocally: (params: {
            sessionId: string
            stripDataUrl?: string
            gifDataUrl?: string
            qrCodeDataUrl?: string
            photos: { path: string; filename: string }[]
            videos: { path: string; filename: string }[]
            overlay?: { path: string; filename: string }
            mirrorOutput?: boolean
            cameraRotation?: 0 | 90 | 180 | 270
            frameConfig?: {
                width: number
                height: number
                slots: { width: number; height: number; x: number; y: number; rotation?: number }[]
                qrSlots?: { width: number; height: number; x: number; y: number }[]
            }
        }): Promise<APIResponse<{ path: string; filename: string; mimeType: string }[]>> =>
            ipcRenderer.invoke('system:save-session-locally', params),

        generateHqGif: (framesBase64: string[], delayMs: number): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:generate-hq-gif', framesBase64, delayMs),

        renameSessionFolder: (params: { sessionId: string; email: string }): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:rename-session-folder', params),

        findSessionStrip: (sessionId: string): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('system:find-session-strip', sessionId)
    },

    // Image APIs
    image: {
        composite: (options: {
            photos: { path: string; slot: PhotoSlot }[]
            framePath: string
            outputPath: string
            canvasWidth: number
            canvasHeight: number
        }): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('image:composite', options),

        resize: (options: {
            inputPath: string
            outputPath: string
            width: number
            height: number
            fit?: 'cover' | 'contain' | 'fill'
        }): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('image:resize', options),

        applyFilter: (options: {
            inputPath: string
            outputPath: string
            filter: {
                brightness?: number
                contrast?: number
                saturation?: number
                grayscale?: boolean
                sepia?: boolean
            }
        }): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('image:apply-filter', options),

        generateGif: (options: {
            imagePaths: string[]
            outputPath: string
            delay?: number
            width?: number
            height?: number
        }): Promise<APIResponse<string>> =>
            ipcRenderer.invoke('image:generate-gif', options),

        metadata: (imagePath: string): Promise<APIResponse<{
            width: number
            height: number
            format: string
        }>> =>
            ipcRenderer.invoke('image:metadata', imagePath)
    },

    // Email APIs
    email: {
        send: (params: {
            to: string
            sessionId: string
            galleryUrl: string
            photoStripUrl?: string
            photoUrls?: string[]
        }): Promise<{ success: boolean; error?: string; messageId?: string }> =>
            ipcRenderer.invoke('email:send', params),

        isConfigured: (): Promise<boolean> =>
            ipcRenderer.invoke('email:is-configured')
    },

    // Drive APIs
    drive: {
        uploadSession: (params: {
            sessionId: string
            files: { path: string; filename: string; mimeType: string }[]
        }): Promise<{ success: boolean; error?: string; folderUrl?: string; folderId?: string; files?: { filename: string; url: string; id: string }[] }> =>
            ipcRenderer.invoke('drive:upload-session', params)
    },

    // Cloud APIs
    cloud: {
        uploadFile: (params: {
            bucketName: string;
            destinationPath: string; // e.g. sessionId/photo.png
            filePath?: string;
            base64Data?: string;
            mimeType: string;
        }): Promise<{ success: boolean; url?: string; error?: string }> =>
            ipcRenderer.invoke('cloud:upload-file', params),
            
        getQueue: (): Promise<APIResponse<any[]>> =>
            ipcRenderer.invoke('cloud:get-queue')
    },

    // Queue APIs (Website Queue Integration)
    queue: {
        startPolling: (config: { eventId: string; secret: string; apiUrl: string }): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('queue:start-polling', config),

        stopPolling: (): Promise<APIResponse<void>> =>
            ipcRenderer.invoke('queue:stop-polling'),

        getStatus: (): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('queue:get-status'),

        sendSessionStarted: (payload: {
            event_id: string
            ticket_number: number
        }): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('queue:send-session-started', payload),

        sendSessionCompleted: (payload: {
            event_id: string
            ticket_number: number
            session_id?: string
        }): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('queue:send-session-completed', payload),

        generateToken: (params: {
            eventId: string
            sessionId: string
        }): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('queue:generate-token', params),

        skipTicket: (payload: any): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('queue:skip-ticket', payload),

        onStatusUpdate: (callback: (data: {
            status: any
            connected: boolean
            error: string | null
        }) => void) => {
            const sub = (_: any, data: any) => callback(data)
            ipcRenderer.on('queue:status-update', sub)
            return () => ipcRenderer.removeListener('queue:status-update', sub)
        }
    },

    // Window APIs
    window: {
        toggleFullscreen: (): Promise<boolean> =>
            ipcRenderer.invoke('window:toggle-fullscreen'),

        toggleKiosk: (): Promise<boolean> =>
            ipcRenderer.invoke('window:toggle-kiosk')
    },

    // Config APIs (Phase 1 Remote Control)
    config: {
        get: (): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('config:get'),

        update: (updates: any): Promise<APIResponse<any>> =>
            ipcRenderer.invoke('config:update', updates),
            
        onUpdate: (callback: (config: any) => void): (() => void) => {
            const subscription = (_: any, newConfig: any) => callback(newConfig)
            ipcRenderer.on('config:updated', subscription)
            // Return unsubscribe function
            return () => {
                ipcRenderer.removeListener('config:updated', subscription)
            }
        }
    },

    // Payment APIs (Doku Integration)
    payment: {
        dokuCreateSession: (params: { orderId: string; amount: number }): Promise<APIResponse<{ paymentUrl: string; invoiceNumber: string }>> =>
            ipcRenderer.invoke('payment:doku-create-session', params),
        
        dokuCheckStatus: (params: { invoiceNumber: string }): Promise<APIResponse<{ status: string; raw: any }>> =>
            ipcRenderer.invoke('payment:doku-check-status', params)
    }
}

// Expose APIs to renderer
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI
    // @ts-ignore (define in dts)
    window.api = api
}
