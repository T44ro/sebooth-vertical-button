import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'

const execAsync = promisify(exec)

/**
 * DigiCamControl Camera Handler
 * Uses digiCamControl CLI for PTP communication on Windows
 * Download: http://digicamcontrol.com/download
 * 
 * IMPORTANT: CameraControlCmd.exe (CLI) requires the main CameraControl.exe
 * application to be running. This handler automatically starts it minimized.
 */
export class DigiCamControlCamera extends CameraHandler {
    private digiCamCmdPath: string
    private digiCamAppPath: string
    private isAppRunning: boolean = false

    constructor(digiCamPath?: string) {
        super()
        const basePath = digiCamPath ||
            process.env.DIGICAM_PATH ||
            'C:\\Program Files (x86)\\digiCamControl'
        
        // If a full path to CameraControlCmd.exe was provided, extract the directory
        if (basePath.endsWith('.exe')) {
            this.digiCamCmdPath = basePath
            this.digiCamAppPath = join(dirname(basePath), 'CameraControl.exe')
        } else {
            this.digiCamCmdPath = join(basePath, 'CameraControlCmd.exe')
            this.digiCamAppPath = join(basePath, 'CameraControl.exe')
        }
    }

    /**
     * Ensure CameraControl.exe is running in the background (minimized).
     * The CLI tool communicates with this running instance.
     */
    private async ensureRunning(): Promise<void> {
        if (this.isAppRunning) return

        try {
            // Check if CameraControl.exe is already running
            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq CameraControl.exe" /NH')
            if (stdout.includes('CameraControl.exe')) {
                console.log('[DigiCam] CameraControl.exe is already running')
                this.isAppRunning = true
                return
            }
        } catch {
            // tasklist failed, proceed to launch
        }

        // Check if the app exists
        if (!existsSync(this.digiCamAppPath)) {
            throw new Error(`digiCamControl not found at: ${this.digiCamAppPath}`)
        }

        console.log('[DigiCam] Starting CameraControl.exe minimized (no live view)...')
        
        // Launch CameraControl.exe minimized using PowerShell
        // We do NOT use live view to minimize CPU/USB overhead
        try {
            await execAsync(
                `powershell -Command "Start-Process -FilePath '${this.digiCamAppPath}' -ArgumentList '/minimized' -WindowStyle Minimized"`,
                { timeout: 10000 }
            )
            
            // Wait for the application to initialize (it needs time to connect to the camera)
            console.log('[DigiCam] Waiting for CameraControl.exe to initialize...')
            await new Promise(resolve => setTimeout(resolve, 5000))
            
            // Disable live view to save resources
            try {
                await execAsync(
                    `"${this.digiCamCmdPath}" /c set liveview 0`,
                    { timeout: 10000 }
                )
                console.log('[DigiCam] Live view disabled for performance')
            } catch {
                // Not critical if this fails
            }
            
            this.isAppRunning = true
            console.log('[DigiCam] CameraControl.exe started successfully')
        } catch (error) {
            const err = error as Error
            throw new Error(`Failed to start CameraControl.exe: ${err.message}`)
        }
    }

    private async runCommand(args: string): Promise<string> {
        // Ensure the main app is running before sending CLI commands
        await this.ensureRunning()

        try {
            const { stdout, stderr } = await execAsync(
                `"${this.digiCamCmdPath}" ${args}`,
                { timeout: 30000 }
            )
            if (stderr && !stdout) {
                throw new Error(stderr)
            }
            return stdout.trim()
        } catch (error) {
            const err = error as Error
            throw new Error(`DigiCamControl error: ${err.message}`)
        }
    }

    async listCameras(): Promise<CameraDevice[]> {
        try {
            const result = await this.runCommand('/c list cameras')
            const lines = result.split('\n').filter(line => line.trim())

            // Filter out status/info messages from digiCamControl
            const cameraLines = lines.filter(line => 
                !line.includes('digiCamControl') && 
                !line.includes('command') &&
                !line.includes('Exiting') &&
                line.trim().length > 0
            )

            const cameras: CameraDevice[] = cameraLines.map((line, index) => ({
                id: `dslr_${index}`,
                name: line.trim(),
                port: 'USB',
                connected: false
            }))

            // If no cameras detected but app is running, return a placeholder
            if (cameras.length === 0) {
                return [{
                    id: 'dslr_0',
                    name: 'DSLR Camera (waiting for connection...)',
                    port: 'USB',
                    connected: false
                }]
            }

            return cameras
        } catch (error) {
            console.error('[DigiCam] Failed to list cameras:', error)
            // Return a placeholder entry so user knows DSLR mode is active
            return [{
                id: 'dslr_0',
                name: 'DSLR Camera (digiCamControl starting...)',
                port: 'USB',
                connected: false
            }]
        }
    }

    async connect(cameraId: string): Promise<boolean> {
        try {
            await this.ensureRunning()

            const cameras = await this.listCameras()
            const camera = cameras.find(c => c.id === cameraId)

            if (camera) {
                this.currentCamera = { ...camera, connected: true }
                this.connected = true
                console.log(`[DigiCam] Connected to ${camera.name}`)
                return true
            }
            return false
        } catch (error) {
            console.error('[DigiCam] Failed to connect to camera:', error)
            return false
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false
        this.currentCamera = null
    }

    async capture(outputPath: string, options?: any): Promise<CaptureResult> {
        if (!this.connected) {
            return {
                success: false,
                error: 'Camera not connected',
                timestamp: Date.now()
            }
        }

        try {
            const dir = dirname(outputPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            console.log(`[DigiCam] Capturing to: ${outputPath}`)
            await this.runCommand(`/c capture /filename "${outputPath}"`)

            if (existsSync(outputPath)) {
                console.log(`[DigiCam] Capture successful: ${outputPath}`)
                return {
                    success: true,
                    imagePath: outputPath,
                    timestamp: Date.now()
                }
            } else {
                return {
                    success: false,
                    error: 'Capture completed but file not found',
                    timestamp: Date.now()
                }
            }
        } catch (error) {
            const err = error as Error
            console.error('[DigiCam] Capture error:', err.message)
            return {
                success: false,
                error: err.message,
                timestamp: Date.now()
            }
        }
    }

    async setProperty(property: string, value: string): Promise<boolean> {
        try {
            await this.runCommand(`/c set ${property} ${value}`)
            return true
        } catch (error) {
            console.error(`[DigiCam] Failed to set ${property}:`, error)
            return false
        }
    }

    async getProperty(property: string): Promise<string | null> {
        try {
            const result = await this.runCommand(`/c get ${property}`)
            return result
        } catch (error) {
            console.error(`[DigiCam] Failed to get ${property}:`, error)
            return null
        }
    }

    /**
     * Shutdown CameraControl.exe background process.
     * Call this when switching away from DSLR mode.
     */
    async shutdown(): Promise<void> {
        if (this.isAppRunning) {
            try {
                await execAsync('taskkill /IM CameraControl.exe /F')
                console.log('[DigiCam] CameraControl.exe terminated')
            } catch {
                // Process might have already exited
            }
            this.isAppRunning = false
        }
        this.connected = false
        this.currentCamera = null
    }
}
