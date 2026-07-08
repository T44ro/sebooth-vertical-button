import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'
import http from 'http'

const execAsync = promisify(exec)

/**
 * DigiCamControl HTTP API Camera Handler
 * 
 * Uses digiCamControl's built-in web server (port 5513) for full camera control:
 * - Capture photos
 * - Set/Get ISO, Aperture, Shutter Speed, White Balance
 * - Live View via MJPEG stream (port 5514) or polling liveview.jpg
 * 
 * digiCamControl already bundles EDSDK.dll — Canon cameras are natively supported.
 * 
 * Requirements:
 * - digiCamControl installed at C:\Program Files (x86)\digiCamControl
 * - Webserver enabled in digiCamControl Settings → Webserver
 */
export class DigiCamHTTPCamera extends CameraHandler {
    private DIGICAM_APP = 'C:\\Program Files (x86)\\digiCamControl\\CameraControl.exe'
    private BASE_URL = 'http://localhost:5513'
    private LIVEVIEW_URL = 'http://localhost:5513/liveview.jpg'
    private isAppRunning: boolean = false
    private liveViewActive: boolean = false

    constructor() {
        super()
    }

    /**
     * Make an HTTP GET request and return the response body as a string.
     */
    private httpGet(url: string, timeout = 10000): Promise<string> {
        return new Promise((resolve, reject) => {
            const req = http.get(url, { timeout }, (res) => {
                let data = ''
                res.on('data', (chunk) => { data += chunk })
                res.on('end', () => resolve(data))
            })
            req.on('error', (err) => reject(err))
            req.on('timeout', () => {
                req.destroy()
                reject(new Error(`HTTP request timed out: ${url}`))
            })
        })
    }

    /**
     * Make an HTTP GET request and return raw binary buffer.
     */
    private httpGetBuffer(url: string, timeout = 15000): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const req = http.get(url, { timeout }, (res) => {
                const chunks: Buffer[] = []
                res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
                res.on('end', () => resolve(Buffer.concat(chunks)))
            })
            req.on('error', (err) => reject(err))
            req.on('timeout', () => {
                req.destroy()
                reject(new Error(`HTTP request timed out: ${url}`))
            })
        })
    }

    /**
     * Send a command via web interface
     * e.g. sendCommand('Capture'), sendCommand('LiveViewWnd_Show')
     */
    private async sendCommand(cmd: string): Promise<string> {
        const url = `${this.BASE_URL}/?CMD=${encodeURIComponent(cmd)}`
        console.log(`[DigiCamHTTP] CMD: ${cmd}`)
        return this.httpGet(url)
    }

    /**
     * Send a Single Line Command (SLC)
     * e.g. sendSLC('capture'), sendSLC('set', 'iso', '400')
     */
    private async sendSLC(action: string, param1: string = '', param2: string = ''): Promise<string> {
        const url = `${this.BASE_URL}/?slc=${encodeURIComponent(action)}&param1=${encodeURIComponent(param1)}&param2=${encodeURIComponent(param2)}`
        console.log(`[DigiCamHTTP] SLC: ${action} ${param1} ${param2}`)
        return this.httpGet(url)
    }

    /**
     * Wait for the web server to become available
     */
    private async waitForWebServer(maxWaitMs = 30000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < maxWaitMs) {
            try {
                await this.httpGet(`${this.BASE_URL}/session.json`, 3000)
                console.log('[DigiCamHTTP] Web server is ready!')
                return true
            } catch {
                // Server not ready yet
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }
        return false
    }

    /**
     * Auto-configure Webserver settings inside digiCamControl ProgramData config
     */
    private autoConfigureWebserver(): void {
        const settingsPath = 'C:\\ProgramData\\digiCamControl\\settings.json'
        if (existsSync(settingsPath)) {
            try {
                const raw = readFileSync(settingsPath, 'utf8')
                const settings = JSON.parse(raw)
                let dirty = false
                if (settings.UseWebserver !== true) {
                    settings.UseWebserver = true
                    dirty = true
                }
                if (settings.WebserverPort !== 5513) {
                    settings.WebserverPort = 5513
                    dirty = true
                }
                if (settings.AllowWebserverActions !== true) {
                    settings.AllowWebserverActions = true
                    dirty = true
                }
                if (dirty) {
                    console.log('[DigiCamHTTP] settings.json updated: Enabling Webserver on port 5513')
                    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
                }
            } catch (err: any) {
                console.error('[DigiCamHTTP] Failed to auto-configure settings.json:', err.message)
            }
        }
    }

    /**
     * Ensure CameraControl.exe is running. Start it if not.
     * Auto-heals configuration if the web server is disabled.
     */
    private async ensureRunning(): Promise<void> {
        // First, check if the web server is already active and responding
        try {
            await this.httpGet(`${this.BASE_URL}/session.json`, 2000)
            console.log('[DigiCamHTTP] CameraControl.exe web server is already active')
            this.isAppRunning = true
            return
        } catch (err) {
            // Not responding (connection refused, timeout, etc.)
            console.log('[DigiCamHTTP] Web server not responding, checking process status...')
        }

        // Check if the process is running
        let isProcessRunning = false
        try {
            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq CameraControl.exe" /NH', { timeout: 3000 })
            if (stdout.includes('CameraControl.exe')) {
                isProcessRunning = true
            }
        } catch {
            // tasklist failed
        }

        // If process is running but web server is NOT responding, it means
        // either the app is starting up or the web server is disabled in settings.
        // We will terminate it, correct the settings, and start it clean.
        if (isProcessRunning) {
            console.log('[DigiCamHTTP] CameraControl.exe is running but web server is inactive. Killing it to apply correct settings...')
            try {
                await execAsync('taskkill /f /im CameraControl.exe', { timeout: 5000 })
                await new Promise(resolve => setTimeout(resolve, 2000))
            } catch (e) {
                // Ignore if kill failed
            }
        }

        // Auto-configure Webserver settings
        this.autoConfigureWebserver()

        // Check if installed
        if (!existsSync(this.DIGICAM_APP)) {
            throw new Error(`digiCamControl not found at: ${this.DIGICAM_APP}. Please install from http://digicamcontrol.com/download`)
        }

        console.log('[DigiCamHTTP] Starting CameraControl.exe...')
        try {
            // Start minimized
            await execAsync(
                `powershell -NoProfile -Command "Start-Process -FilePath '${this.DIGICAM_APP}' -WindowStyle Minimized"`,
                { timeout: 10000 }
            )
            
            // Wait for web server to be ready
            console.log('[DigiCamHTTP] Waiting for web server to start...')
            const ready = await this.waitForWebServer(30000)
            if (!ready) {
                throw new Error('digiCamControl web server did not start in time. Please ensure "Use web server" is enabled in Settings → Webserver.')
            }
            
            this.isAppRunning = true
            console.log('[DigiCamHTTP] CameraControl.exe started and web server ready')
        } catch (error: any) {
            throw new Error(`Failed to start CameraControl.exe: ${error.message}`)
        }
    }

    /**
     * List available cameras via digiCamControl
     */
    async listCameras(): Promise<CameraDevice[]> {
        try {
            await this.ensureRunning()
            
            // Try to get camera name via SLC
            try {
                const cameraName = await this.sendSLC('get', 'camera.name')
                if (cameraName && !cameraName.includes('null') && cameraName.trim().length > 0 && 
                    !cameraName.toLowerCase().includes('error') && !cameraName.toLowerCase().includes('no camera')) {
                    return [{
                        id: 'digicam_http_0',
                        name: `${cameraName.trim()} (digiCamControl)`,
                        port: 'USB',
                        connected: true
                    }]
                }
            } catch {
                // Camera name query failed
            }

            return [{
                id: 'digicam_http_0',
                name: 'DSLR Camera (Tidak ada kamera terhubung ke digiCamControl)',
                port: 'USB',
                connected: false
            }]
        } catch (error: any) {
            console.error('[DigiCamHTTP] listCameras error:', error.message)
            return [{
                id: 'digicam_http_0',
                name: 'DSLR Camera (digiCamControl starting...)',
                port: 'USB',
                connected: false
            }]
        }
    }

    async connect(cameraId: string): Promise<boolean> {
        try {
            await this.ensureRunning()
            
            // Get camera name to check connection
            let cameraName = ''
            try {
                cameraName = await this.sendSLC('get', 'camera.name')
            } catch (e) {
                // query failed
            }

            if (!cameraName || cameraName.includes('null') || cameraName.trim().length === 0 || 
                cameraName.toLowerCase().includes('error') || cameraName.toLowerCase().includes('no camera')) {
                this.connected = false
                this.currentCamera = null
                throw new Error('Kamera tidak terdeteksi di digiCamControl. Pastikan kabel USB terhubung, kamera menyala (ON), dan baterai terisi.')
            }

            this.connected = true
            this.currentCamera = {
                id: cameraId,
                name: `${cameraName.trim()} (digiCamControl)`,
                port: 'USB',
                connected: true
            }

            console.log(`[DigiCamHTTP] Connected: ${this.currentCamera.name}`)
            return true
        } catch (error: any) {
            this.connected = false
            this.currentCamera = null
            console.error('[DigiCamHTTP] Connect error:', error.message)
            throw error
        }
    }

    async disconnect(): Promise<void> {
        if (this.liveViewActive) {
            await this.stopLiveView()
        }
        this.connected = false
        this.currentCamera = null
    }

    async capture(outputPath: string, options?: any): Promise<CaptureResult> {
        try {
            await this.ensureRunning()

            const dir = dirname(outputPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            console.log(`[DigiCamHTTP] Capturing to: ${outputPath}`)

            // Stop live view briefly to avoid USB conflicts during capture
            const wasLiveViewActive = this.liveViewActive
            if (wasLiveViewActive) {
                try {
                    await this.sendCommand('LiveViewWnd_Hide')
                    await new Promise(resolve => setTimeout(resolve, 300))
                } catch { /* ignore */ }
            }

            // Trigger capture via CMD
            await this.sendCommand('Capture')

            // Wait for capture to complete
            // Poll "lastcaptured" until it returns a valid filename
            let capturedFile = ''
            const captureStart = Date.now()
            while (Date.now() - captureStart < 15000) {
                try {
                    const result = await this.sendSLC('get', 'lastcaptured')
                    if (result && result.trim() !== '-' && result.trim().length > 0 && !result.toLowerCase().includes('error')) {
                        capturedFile = result.trim()
                        break
                    }
                } catch { /* still capturing */ }
                await new Promise(resolve => setTimeout(resolve, 500))
            }

            // Re-enable live view if it was active
            if (wasLiveViewActive) {
                try {
                    await this.sendCommand('LiveViewWnd_Show')
                } catch { /* ignore */ }
            }

            // Download the captured image from digiCamControl
            if (capturedFile) {
                try {
                    // Download via preview.jpg (always the last captured image)
                    const imageBuffer = await this.httpGetBuffer(`${this.BASE_URL}/preview.jpg`, 15000)
                    if (imageBuffer && imageBuffer.length > 1000) {
                        writeFileSync(outputPath, imageBuffer)
                        console.log(`[DigiCamHTTP] ✅ Photo saved: ${outputPath} (${imageBuffer.length} bytes)`)
                        return {
                            success: true,
                            imagePath: outputPath,
                            timestamp: Date.now()
                        }
                    }
                } catch (downloadErr: any) {
                    console.warn('[DigiCamHTTP] Failed to download preview.jpg:', downloadErr.message)
                }

                // Fallback: try downloading by filename
                try {
                    const encodedName = encodeURIComponent(capturedFile.split('\\').pop() || capturedFile)
                    const imageBuffer = await this.httpGetBuffer(`${this.BASE_URL}/image/${encodedName}`, 15000)
                    if (imageBuffer && imageBuffer.length > 1000) {
                        writeFileSync(outputPath, imageBuffer)
                        console.log(`[DigiCamHTTP] ✅ Photo saved (by name): ${outputPath}`)
                        return {
                            success: true,
                            imagePath: outputPath,
                            timestamp: Date.now()
                        }
                    }
                } catch (nameErr: any) {
                    console.warn('[DigiCamHTTP] Failed to download by name:', nameErr.message)
                }
            }

            // Final fallback: just try preview.jpg even if lastcaptured was unclear
            try {
                await new Promise(resolve => setTimeout(resolve, 2000))
                const imageBuffer = await this.httpGetBuffer(`${this.BASE_URL}/preview.jpg`, 15000)
                if (imageBuffer && imageBuffer.length > 1000) {
                    writeFileSync(outputPath, imageBuffer)
                    console.log(`[DigiCamHTTP] ✅ Photo saved (fallback preview): ${outputPath}`)
                    return {
                        success: true,
                        imagePath: outputPath,
                        timestamp: Date.now()
                    }
                }
            } catch { /* last resort failed */ }

            return {
                success: false,
                error: 'Capture completed but failed to download image from digiCamControl. Pastikan kamera terhubung dan dikenali di digiCamControl.',
                timestamp: Date.now()
            }
        } catch (error: any) {
            console.error('[DigiCamHTTP] Capture error:', error.message)
            return {
                success: false,
                error: `Capture error: ${error.message}`,
                timestamp: Date.now()
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // Camera Settings API
    // ══════════════════════════════════════════════════════════

    /**
     * Set a camera property (iso, shutterspeed, aperture, whitebalance, etc.)
     */
    async setProperty(property: string, value: string): Promise<boolean> {
        try {
            await this.ensureRunning()
            const result = await this.sendSLC('set', property, value)
            console.log(`[DigiCamHTTP] Set ${property} = ${value}: ${result}`)
            return !result.toLowerCase().includes('error')
        } catch (error: any) {
            console.error(`[DigiCamHTTP] Failed to set ${property}:`, error.message)
            return false
        }
    }

    /**
     * Get a camera property value
     */
    async getProperty(property: string): Promise<string | null> {
        try {
            await this.ensureRunning()
            const result = await this.sendSLC('get', property)
            if (result && !result.toLowerCase().includes('error')) {
                return result.trim()
            }
            return null
        } catch (error: any) {
            console.error(`[DigiCamHTTP] Failed to get ${property}:`, error.message)
            return null
        }
    }

    /**
     * Get available values for a camera property.
     * Returns an object with { current, available } values.
     */
    async getAvailableValues(property: string): Promise<{ current: string; available: string[] }> {
        try {
            await this.ensureRunning()
            
            // Get current value
            const current = await this.getProperty(property) || ''
            
            // Get list of available values
            // digiCamControl SLC 'list' command returns available values
            let available: string[] = []
            try {
                const result = await this.sendSLC('list', property)
                if (result && !result.toLowerCase().includes('error')) {
                    // Parse the list — digiCamControl returns values separated by newlines or commas
                    available = result.split(/[\n,]/)
                        .map(s => s.trim())
                        .filter(s => s.length > 0 && !s.toLowerCase().includes('error') && !s.toLowerCase().includes('ok'))
                }
            } catch {
                // List might not be supported for this property
            }

            return { current, available }
        } catch (error: any) {
            console.error(`[DigiCamHTTP] getAvailableValues(${property}) error:`, error.message)
            return { current: '', available: [] }
        }
    }

    // ══════════════════════════════════════════════════════════
    // Live View
    // ══════════════════════════════════════════════════════════

    /**
     * Start live view in digiCamControl
     */
    async startLiveView(): Promise<boolean> {
        try {
            await this.ensureRunning()
            await this.sendCommand('LiveViewWnd_Show')
            this.liveViewActive = true
            console.log('[DigiCamHTTP] Live view started')
            return true
        } catch (error: any) {
            console.error('[DigiCamHTTP] Failed to start live view:', error.message)
            return false
        }
    }

    /**
     * Stop live view in digiCamControl
     */
    async stopLiveView(): Promise<boolean> {
        try {
            await this.sendCommand('LiveViewWnd_Hide')
            this.liveViewActive = false
            console.log('[DigiCamHTTP] Live view stopped')
            return true
        } catch (error: any) {
            console.error('[DigiCamHTTP] Failed to stop live view:', error.message)
            return false
        }
    }

    /**
     * Get the URL for the live view JPEG frame.
     * This URL can be polled by the renderer to show a preview.
     */
    getLiveViewUrl(): string {
        return this.LIVEVIEW_URL
    }

    /**
     * Check if live view is currently active
     */
    isLiveViewActive(): boolean {
        return this.liveViewActive
    }

    // ══════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════

    /**
     * Shutdown CameraControl.exe when switching away from this mode.
     */
    async shutdown(): Promise<void> {
        if (this.liveViewActive) {
            try { await this.stopLiveView() } catch { /* ignore */ }
        }
        
        // Don't kill CameraControl.exe automatically — user might want it running
        // Only reset our internal state
        this.isAppRunning = false
        this.connected = false
        this.currentCamera = null
        console.log('[DigiCamHTTP] Handler shutdown (CameraControl.exe left running)')
    }
}
