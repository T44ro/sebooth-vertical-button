import { IpcMain, app, ipcMain } from 'electron'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { CameraHandler } from '../handlers/CameraHandler'
import { GPhotoCamera } from '../handlers/GPhotoCamera'
import { DigiCamHTTPCamera } from '../handlers/DigiCamHTTPCamera'
import { CanonEDSDKCamera } from '../handlers/CanonEDSDKCamera'
import { MockCamera } from '../handlers/MockCamera'
import { CameraDevice, CaptureResult, CameraPropertyValues, APIResponse } from '@shared/types'

// Use GPhoto (Lightweight) in production, Mock in development
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let cameraHandler: CameraHandler = isDev
    ? new MockCamera()
    : new GPhotoCamera()

let isCapturingActive = false

/**
 * Switch camera handler implementation
 */
export function setCameraHandler(handler: CameraHandler): void {
    cameraHandler = handler
}

/**
 * Get temp folder path for captured images
 */
function getTempPath(): string {
    return join(app.getPath('userData'), 'temp')
}

/**
 * Register all camera-related IPC handlers
 */
export function registerCameraHandlers(ipcMain: IpcMain): void {

    // List available cameras
    ipcMain.handle('camera:list', async (): Promise<APIResponse<CameraDevice[]>> => {
        try {
            const cameras = await cameraHandler.listCameras()
            return { success: true, data: cameras }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Connect to a camera
    ipcMain.handle('camera:connect', async (_, cameraId: string): Promise<APIResponse<boolean>> => {
        try {
            const result = await cameraHandler.connect(cameraId)
            return { success: true, data: result }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Disconnect from current camera
    ipcMain.handle('camera:disconnect', async (): Promise<APIResponse<void>> => {
        try {
            await cameraHandler.disconnect()
            return { success: true }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Capture a photo
    ipcMain.handle('camera:capture', async (_, slotId?: string, options?: any): Promise<APIResponse<CaptureResult>> => {
        if (isCapturingActive) {
            console.warn('[Camera IPC] Blocked concurrent capture request!')
            return { success: false, error: 'A capture is already in progress' }
        }
        isCapturingActive = true
        const captureStartTime = Date.now()
        try {
            const handlerName = cameraHandler.constructor.name
            console.log(`[Camera IPC] 🟢 CAPTURE STARTED. Handler: ${handlerName}, SlotId: ${slotId}`)
            
            const filename = `capture_${slotId || uuidv4()}_${Date.now()}.jpg`
            const outputPath = join(getTempPath(), filename)

            const result = await (cameraHandler as any).capture(outputPath, options)
            const elapsedMs = Date.now() - captureStartTime
            console.log(`[Camera IPC] 🟢 CAPTURE COMPLETED in ${elapsedMs}ms:`, { success: result.success, imagePath: result.imagePath, error: result.error })

            if (!result.success && cameraHandler.constructor.name === 'GPhotoCamera' && result.error?.includes('not found')) {
                console.warn('[Camera IPC] GPhoto fallback could not capture; returning actionable error')
            }

            return { success: result.success, data: result, error: result.error }
        } catch (error) {
            const elapsedMs = Date.now() - captureStartTime
            const err = error as Error
            console.error(`[Camera IPC] ❌ CAPTURE ERROR after ${elapsedMs}ms:`, err.message)
            return { success: false, error: err.message }
        } finally {
            isCapturingActive = false
        }
    })

    // Get camera connection status
    ipcMain.handle('camera:status', async (): Promise<APIResponse<{ connected: boolean; camera: CameraDevice | null }>> => {
        return {
            success: true,
            data: {
                connected: cameraHandler.isConnected(),
                camera: cameraHandler.getCurrentCamera()
            }
        }
    })

    // Switch to mock camera (for development/testing)
    ipcMain.handle('camera:use-mock', async (): Promise<APIResponse<void>> => {
        // Shutdown existing DSLR handler if it has a shutdown method
        if (cameraHandler && 'shutdown' in cameraHandler) {
            await (cameraHandler as any).shutdown()
        }
        cameraHandler = new MockCamera()
        console.log('[Camera IPC] Switched to Mock Camera')
        return { success: true }
    })

    // Switch to real camera (CLI)
    ipcMain.handle('camera:use-real', async (): Promise<APIResponse<void>> => {
        // Shutdown existing DSLR handler if it has a shutdown method
        if (cameraHandler && 'shutdown' in cameraHandler) {
            await (cameraHandler as any).shutdown()
        }
        cameraHandler = new GPhotoCamera()
        console.log('[Camera IPC] Switched to GPhoto Camera (Ultra-Lightweight mode)')
        return { success: true }
    })

    // Switch to DigiCamControl HTTP API (Full Camera Control)
    ipcMain.handle('camera:use-direct-ptp', async (): Promise<APIResponse<void>> => {
        // Shutdown existing handler if it has a shutdown method
        if (cameraHandler && 'shutdown' in cameraHandler) {
            await (cameraHandler as any).shutdown()
        }
        cameraHandler = new DigiCamHTTPCamera()
        console.log('[Camera IPC] Switched to DigiCamControl HTTP Camera (Full Control mode)')
        return { success: true }
    })

    // Switch to Canon EDSDK (Native Canon SDK — fastest, most reliable for Canon cameras)
    ipcMain.handle('camera:use-canon-edsdk', async (): Promise<APIResponse<void>> => {
        // Shutdown existing handler if it has a shutdown method
        if (cameraHandler && 'shutdown' in cameraHandler) {
            await (cameraHandler as any).shutdown()
        }
        const handler = new CanonEDSDKCamera()
        cameraHandler = handler
        console.log('[Camera IPC] Switched to Canon EDSDK Camera (Native Canon SDK mode)')

        // Auto-connect: spawn the persistent CanonHelper.exe process immediately
        // so that live view and capture work without a separate connect step.
        try {
            const connected = await handler.connect('canon_edsdk_0')
            if (connected) {
                console.log('[Camera IPC] Canon EDSDK auto-connected successfully')
            } else {
                console.warn('[Camera IPC] Canon EDSDK auto-connect returned false')
            }
        } catch (err: any) {
            console.error('[Camera IPC] Canon EDSDK auto-connect failed:', err.message)
        }

        return { success: true }
    })

    // ══════════════════════════════════════════════════════════
    // Camera Property Control (ISO, Aperture, Shutter Speed)
    // ══════════════════════════════════════════════════════════

    ipcMain.handle('camera:set-property', async (_, property: string, value: string): Promise<APIResponse<boolean>> => {
        try {
            if ('setProperty' in cameraHandler) {
                const result = await (cameraHandler as DigiCamHTTPCamera).setProperty(property, value)
                return { success: true, data: result }
            }
            return { success: false, error: 'Current camera handler does not support property control' }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('camera:get-property', async (_, property: string): Promise<APIResponse<string | null>> => {
        try {
            if ('getProperty' in cameraHandler) {
                const result = await (cameraHandler as DigiCamHTTPCamera).getProperty(property)
                return { success: true, data: result }
            }
            return { success: false, error: 'Current camera handler does not support property control' }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('camera:get-available-values', async (_, property: string): Promise<APIResponse<CameraPropertyValues>> => {
        try {
            if ('getAvailableValues' in cameraHandler) {
                const result = await (cameraHandler as DigiCamHTTPCamera).getAvailableValues(property)
                return { success: true, data: result }
            }
            return { success: false, error: 'Current camera handler does not support property control' }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    // ══════════════════════════════════════════════════════════
    // Live View Control
    // ══════════════════════════════════════════════════════════

    ipcMain.handle('camera:start-liveview', async (): Promise<APIResponse<boolean>> => {
        try {
            if ('startLiveView' in cameraHandler) {
                const result = await (cameraHandler as DigiCamHTTPCamera).startLiveView()
                return { success: true, data: result }
            }
            return { success: false, error: 'Current camera handler does not support live view' }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('camera:stop-liveview', async (): Promise<APIResponse<boolean>> => {
        try {
            if ('stopLiveView' in cameraHandler) {
                const result = await (cameraHandler as DigiCamHTTPCamera).stopLiveView()
                return { success: true, data: result }
            }
            return { success: false, error: 'Current camera handler does not support live view' }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('camera:get-liveview-url', async (): Promise<APIResponse<string>> => {
        try {
            if ('getLiveViewUrl' in cameraHandler) {
                const url = (cameraHandler as DigiCamHTTPCamera).getLiveViewUrl()
                return { success: true, data: url }
            }
            return { success: false, error: 'Current camera handler does not support live view' }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('camera:start-recording-live-photo', async (_, slotId: string): Promise<APIResponse<boolean>> => {
        try {
            if ('startRecordingLivePhoto' in cameraHandler) {
                const res = await (cameraHandler as any).startRecordingLivePhoto(slotId)
                return { success: true, data: res }
            }
            return { success: true, data: false }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('camera:stop-recording-live-photo', async (_, slotId: string): Promise<APIResponse<string | null>> => {
        try {
            if ('stopRecordingLivePhoto' in cameraHandler) {
                const videoPath = await (cameraHandler as any).stopRecordingLivePhoto(slotId)
                return { success: true, data: videoPath }
            }
            return { success: true, data: null }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })
}
