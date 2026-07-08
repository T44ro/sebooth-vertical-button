import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'
import { app } from 'electron'

const execAsync = promisify(exec)

/**
 * Lightweight Camera Handler
 * Uses a small CLI tool or optimized PowerShell for Shutter Trigger.
 * Preview is handled by Canon EOS Webcam Utility (detected as a webcam).
 */
export class GPhotoCamera extends CameraHandler {
    private toolsPath: string

    constructor() {
        super()
        // Path to portable tools in the user's roaming directory or a fixed 'C:\tools'
        this.toolsPath = join(app.getPath('userData'), 'tools')
        if (!existsSync(this.toolsPath)) {
            mkdirSync(this.toolsPath, { recursive: true })
        }
    }

    /**
     * List cameras using a lightweight check.
     */
    async listCameras(): Promise<CameraDevice[]> {
        console.log('[Lightweight] Scanning for DSLR via CLI...')
        // For simplicity in the initial lightweight rollout, we look for any Canon PTP device
        // This is a placeholder that will be refined once the specific CLI is chosen.
        return [{
            id: 'dslr_lightweight',
            name: 'DSLR (Canon 60D - Lightweight Mode)',
            port: 'USB',
            connected: false
        }]
    }

    async connect(cameraId: string): Promise<boolean> {
        this.connected = true
        this.currentCamera = {
            id: cameraId,
            name: 'Canon 60D (Lightweight)',
            port: 'USB',
            connected: true
        }
        console.log('[Lightweight] Connected to DSLR')
        return true
    }

    async disconnect(): Promise<void> {
        this.connected = false
        this.currentCamera = null
        console.log('[Lightweight] Disconnected')
    }

    async capture(outputPath: string, options?: any): Promise<CaptureResult> {
        try {
            const dir = dirname(outputPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            console.log(`[DSLRRemotePro] Triggering shutter to: ${outputPath}`)
            
            // Standard path for Breeze Systems DSLR Remote Pro
            const cliPath = 'C:\\Program Files (x86)\\BreezeSys\\DSLR Remote Pro\\DSLRRemote.exe'
            
            if (!existsSync(cliPath)) {
                console.warn('[DSLRRemotePro] DSLRRemote.exe not found at', cliPath)
                return {
                    success: false,
                    error: `Aplikasi 'DSLR Remote Pro' tidak ditemukan di ${cliPath}. Silakan install aplikasi tersebut terlebih dahulu.`,
                    timestamp: Date.now()
                }
            }

            // Command: DSLRRemote.exe -c "C:\path\to\save.jpg"
            // Breeze Systems CLI documentation: -c [filename] captures an image
            await execAsync(`"${cliPath}" -c "${outputPath}"`, { timeout: 15000 })

            // Give it a moment to save
            await new Promise(resolve => setTimeout(resolve, 1000))

            if (existsSync(outputPath)) {
                console.log(`[DSLRRemotePro] Capture successful: ${outputPath}`)
                return {
                    success: true,
                    imagePath: outputPath,
                    timestamp: Date.now()
                }
            }

            return {
                success: false,
                error: 'Capture finished but image not found in the output path.',
                timestamp: Date.now()
            }
        } catch (error: any) {
            console.error('[DSLRRemotePro] Capture error:', error.message)
            return {
                success: false,
                error: `DSLR Remote Pro Error: ${error.message}`,
                timestamp: Date.now()
            }
        }
    }
}
