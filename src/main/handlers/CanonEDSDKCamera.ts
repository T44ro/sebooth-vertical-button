import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, statSync, rmSync, copyFileSync } from 'fs'
// @ts-ignore - Ignore missing types for fluent-ffmpeg to prevent build failures
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'

ffmpeg.setFfmpegPath(ffmpegPath.path)
import { dirname, join } from 'path'
import { app } from 'electron'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'
import { configService } from '../services/ConfigService'

const execAsync = promisify(exec)

/**
 * Canon EDSDK Camera Handler
 * 
 * Uses Canon's proprietary EDSDK (via Canon.Eos.Framework.dll) for direct
 * camera communication. This is the same engine used by dslrBooth and provides
 * the most reliable trigger mechanism for Canon cameras.
 * 
 * Architecture:
 *   Node.js → PowerShell → .NET Assembly (Canon.Eos.Framework.dll) → EDSDK.dll → Camera
 * 
 * Supported cameras: All Canon EOS DSLR/Mirrorless including:
 *   - Canon EOS 1300D (Rebel T6) ← PRIMARY TARGET
 *   - Canon EOS 60D, 70D, 80D, 90D
 *   - Canon EOS 5D series, 6D series
 *   - Canon EOS R series (mirrorless)
 * 
 * Requirements:
 *   - EDSDK.dll, EdsImage.dll, Canon.Eos.Framework.dll in lib/canon/
 *   - Camera connected via USB in PTP mode
 *   - No other camera software holding USB lock (EOSUtility, EOS Webcam Utility)
 */
export class CanonEDSDKCamera extends CameraHandler {
    private canonLibPath: string
    private liveViewActive: boolean = false
    private liveViewTempPath: string
    private detectedCameraName: string = ''
    private helperProcess: ChildProcess | null = null

    constructor() {
        super()
        // Determine the path to Canon DLLs
        // In development: src/main/lib/canon/
        // In production: resources/lib/canon/ (bundled)
        const isDev = !app.isPackaged
        if (isDev) {
            this.canonLibPath = join(__dirname, '..', 'lib', 'canon')
        } else {
            this.canonLibPath = join(process.resourcesPath, 'lib', 'canon')
        }

        // Fallback: check if files exist at the dev source path
        if (!existsSync(join(this.canonLibPath, 'Canon.Eos.Framework.dll'))) {
            // Try absolute path during development
            const devPath = join(app.getAppPath(), 'src', 'main', 'lib', 'canon')
            if (existsSync(join(devPath, 'Canon.Eos.Framework.dll'))) {
                this.canonLibPath = devPath
            }
        }

        // Live View temp file path
        this.liveViewTempPath = join(app.getPath('userData'), 'temp', 'edsdk_liveview.jpg')
        const lvDir = dirname(this.liveViewTempPath)
        if (!existsSync(lvDir)) {
            mkdirSync(lvDir, { recursive: true })
        }

        console.log(`[CanonEDSDK] Lib path: ${this.canonLibPath}`)
    }

    /**
     * Run a PowerShell script by writing it to a temporary .ps1 file.
     * This avoids Windows command-line length limits that can occur with very large
     * inline scripts used by the Canon capture flow.
     */
    private async runPowerShell(script: string, timeout = 30000): Promise<string> {
        const scriptDir = join(app.getPath('userData'), 'temp', 'canon_scripts')
        if (!existsSync(scriptDir)) {
            mkdirSync(scriptDir, { recursive: true })
        }

        const scriptPath = join(scriptDir, `canon_${Date.now()}_${Math.random().toString(16).slice(2)}.ps1`)
        writeFileSync(scriptPath, script, 'utf8')

        try {
            const { stdout, stderr } = await execAsync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
                { timeout, maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for image data
            )
            if (stderr) {
                console.warn('[CanonEDSDK] PowerShell stderr:', stderr.trim())
            }
            return stdout.trim()
        } catch (error: any) {
            console.error('[CanonEDSDK] PowerShell Execution Error:', error.message)
            if (error.stdout) console.error('[CanonEDSDK] stdout:', error.stdout)
            if (error.stderr) console.error('[CanonEDSDK] stderr:', error.stderr)
            throw error
        } finally {
            try {
                unlinkSync(scriptPath)
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Kill conflicting camera applications that hold USB lock.
     * We intentionally include EOS Webcam Utility as well because it can keep the camera
     * session busy and cause the Canon SDK to fail with "Comm Port Is In Use".
     */
    private async killConflictingApps(): Promise<void> {
        const appsToKill = [
            'EOSUtility.exe',
            'EOS Utility.exe',
            'EOSWebcamUtility.exe',
            'CanonCameraWindow.exe',
            'CameraWindow.exe',
            'RemoteShooting.exe',
            'WiaDriverTool.exe',
            'digiCamControl.exe',
            'CameraControl.exe',
            'CameraControlCmd.exe',
            'CanonHelper.exe'
        ]

        for (const appName of appsToKill) {
            try {
                await execAsync(`taskkill /f /im "${appName}"`, { timeout: 3000 })
                console.log(`[CanonEDSDK] Killed ${appName}`)
                await new Promise(resolve => setTimeout(resolve, 500))
            } catch {
                // App not running — ignore
            }
        }

        try {
            await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match \"(EOS|Canon|CameraControl|digiCam|Wia)\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', { timeout: 10000 })
            console.log('[CanonEDSDK] Cleared extra Canon-related Windows processes')
        } catch {
            // Ignore cleanup errors
        }
    }

    private isPortInUseError(message: string): boolean {
        const normalized = message.toLowerCase()
        return normalized.includes('comm port is in use')
            || normalized.includes('failed to open session')
            || normalized.includes('device is in use')
            || normalized.includes('already open')
    }

    private async waitForCameraRelease(retries = 3, resetUsb = false): Promise<void> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            await this.killConflictingApps()
            if (resetUsb) {
                await this.resetCanonUsbDevice()
            }
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempt))
            }
        }
    }

    private async resetCanonUsbDevice(): Promise<void> {
        try {
            // Attempt to reset Canon-related USB devices via Windows Device Manager
            await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-PnpDevice -Class Camera | Where-Object { $_.FriendlyName -match 'Canon|EOS|USB' } | ForEach-Object { try { Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue } catch {} }"`, { timeout: 20000 })
            console.log('[CanonEDSDK] Reset Canon USB device via PnP')
            
            // Additional: Force re-enumerate USB devices
            try {
                await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-PnpDevice -FriendlyName '*Canon*' | ForEach-Object { Restart-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }"`, { timeout: 10000 })
                console.log('[CanonEDSDK] USB device re-enumeration attempted')
            } catch {
                // Ignore if restart not available
            }
        } catch (error: any) {
            console.warn('[CanonEDSDK] USB reset attempt failed (may not have admin rights):', error.message)
        }
    }

    /**
     * Get the common PowerShell preamble that loads EDSDK assemblies
     */
    private getEdsdkPreamble(): string {
        const frameworkDll = join(this.canonLibPath, 'Canon.Eos.Framework.dll').replace(/\\/g, '\\\\')
        const edsdkDll = join(this.canonLibPath, 'EDSDK.dll').replace(/\\/g, '\\\\')
        const edsImageDll = join(this.canonLibPath, 'EdsImage.dll').replace(/\\/g, '\\\\')

        return `
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

# Ensure EDSDK.dll and EdsImage.dll are in the same directory
# Canon.Eos.Framework.dll will P/Invoke EDSDK.dll from its own directory
$canonDir = '${this.canonLibPath.replace(/\\/g, '\\\\')}'

# Set DLL search path to include Canon lib directory
[System.Environment]::SetEnvironmentVariable('PATH', "$canonDir;$env:PATH")

# Load the .NET wrapper assembly
try {
    [System.Reflection.Assembly]::LoadFrom('${frameworkDll}') | Out-Null
    [Console]::WriteLine("===EDSDK_LOADED===")
} catch {
    [Console]::WriteLine("===EDSDK_LOAD_ERROR===$($_.Exception.Message)")
    exit
}
`
    }

    /**
     * List available Canon cameras via EDSDK
     * If the helper process is already connected, return cached camera info
     * to avoid opening a second EDSDK session that would lock the COM port.
     */
    async listCameras(): Promise<CameraDevice[]> {
        // If the helper is already running and connected, return cached info
        // to avoid COM port conflicts from multiple EDSDK sessions
        if (this.connected && this.helperProcess && this.currentCamera) {
            console.log('[CanonEDSDK] Returning cached camera info (helper already connected)')
            return [this.currentCamera]
        }

        console.log('[CanonEDSDK] Scanning for Canon cameras...')

        // Verify DLLs exist
        const frameworkDll = join(this.canonLibPath, 'Canon.Eos.Framework.dll')
        if (!existsSync(frameworkDll)) {
            console.error(`[CanonEDSDK] Canon.Eos.Framework.dll not found at: ${frameworkDll}`)
            return [{
                id: 'canon_edsdk_0',
                name: 'Canon DSLR (EDSDK DLL tidak ditemukan)',
                port: 'USB',
                connected: false
            }]
        }

        try {
            const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()
    $count = $cameras.Count

    if ($count -eq 0) {
        [Console]::WriteLine("===CANON_NO_CAMERA===")
    } else {
        for ($i = 0; $i -lt $count; $i++) {
            $cam = $null
            $retryCount = 0
            while ($retryCount -lt 3) {
                try {
                    [System.GC]::Collect()
                    [System.GC]::WaitForPendingFinalizers()
                    $cam = $cameras.Item($i)
                    break
                } catch {
                    $retryCount++
                    if ($retryCount -eq 3) { throw }
                    Start-Sleep -Milliseconds 500
                }
            }
            $name = $cam.DeviceDescription
            $port = $cam.PortName
            [Console]::WriteLine("===CANON_CAMERA===$i|$name|$port")
        }
    }
    
    # Cleanup
    $framework.Dispose()
} catch {
    [Console]::WriteLine("===CANON_ERROR===$($_.Exception.Message)")
}
`, 15000)

            console.log('[CanonEDSDK] Scan result:', result)

            if (result.includes('===EDSDK_LOAD_ERROR===')) {
                const errMatch = result.match(/===EDSDK_LOAD_ERROR===(.*)/m)
                return [{
                    id: 'canon_edsdk_0',
                    name: `Canon DSLR (EDSDK error: ${errMatch?.[1] || 'unknown'})`,
                    port: 'USB',
                    connected: false
                }]
            }

            if (result.includes('===CANON_NO_CAMERA===')) {
                return [{
                    id: 'canon_edsdk_0',
                    name: 'Canon DSLR (Tidak ada kamera terdeteksi — pastikan USB terhubung & kamera ON)',
                    port: 'USB',
                    connected: false
                }]
            }

            const cameraLines = result.match(/===CANON_CAMERA===(.+)/gm)
            if (cameraLines && cameraLines.length > 0) {
                return cameraLines.map(line => {
                    const data = line.replace('===CANON_CAMERA===', '')
                    const [index, name, port] = data.split('|')
                    return {
                        id: `canon_edsdk_${index}`,
                        name: `${name || 'Canon Camera'} (Canon EDSDK)`,
                        port: port || 'USB',
                        connected: false
                    }
                })
            }

            if (result.includes('===CANON_ERROR===')) {
                const errMatch = result.match(/===CANON_ERROR===(.*)/m)
                return [{
                    id: 'canon_edsdk_0',
                    name: `Canon DSLR (Error: ${errMatch?.[1] || 'unknown'})`,
                    port: 'USB',
                    connected: false
                }]
            }
        } catch (error: any) {
            console.error('[CanonEDSDK] listCameras error:', error.message)
        }

        return [{
            id: 'canon_edsdk_0',
            name: 'Canon DSLR (Canon EDSDK — scanning...)',
            port: 'USB',
            connected: false
        }]
    }

    async connect(cameraId: string): Promise<boolean> {
        console.log(`[CanonEDSDK] Connecting to camera: ${cameraId}`)

        if (this.connected && this.helperProcess) {
            console.log('[CanonEDSDK] Camera already connected and helper is running, reusing session')
            return true
        }

        this.connected = false
        this.currentCamera = null
        this.detectedCameraName = ''
        
        // Clean up any existing helper process
        await this.disconnect()

        await this.killConflictingApps()
        await new Promise(resolve => setTimeout(resolve, 500))

        const exePath = join(this.canonLibPath, 'CanonHelper.exe')
        console.log(`[CanonEDSDK] Spawning helper process: ${exePath}`)

        const helperArgs = ['--live-view', this.liveViewTempPath]
        console.log(`[CanonEDSDK] Helper args: ${JSON.stringify(helperArgs)}`)

        return new Promise<boolean>((resolve, reject) => {
            try {
                const helper = spawn(exePath, helperArgs, {
                    cwd: this.canonLibPath,
                    stdio: ['pipe', 'pipe', 'pipe'] // pipe stderr, stdout, stdin
                })

                this.helperProcess = helper
                let isResolved = false
                let buffer = ''

                helper.stderr?.on('data', (data) => {
                    console.error(`[CanonHelper stderr] ${data.toString().trim()}`)
                })

                helper.stdout.on('data', (data) => {
                    buffer += data.toString()
                    let index = buffer.indexOf('\n')
                    while (index > -1) {
                        const line = buffer.substring(0, index).trim()
                        buffer = buffer.substring(index + 1)
                        index = buffer.indexOf('\n')

                        console.log(`[CanonHelper] stdout: ${line}`)

                        if (line.startsWith('STATUS:CONNECTED:')) {
                            const name = line.substring(17).trim()
                            this.detectedCameraName = name
                            this.connected = true
                            this.currentCamera = {
                                id: cameraId,
                                name: `${this.detectedCameraName} (Canon EDSDK)`,
                                port: 'USB',
                                connected: true
                            }
                            isResolved = true
                            resolve(true)
                        } else if (line.startsWith('ERROR:')) {
                            const err = line.substring(6).trim()
                            if (!isResolved) {
                                isResolved = true
                                reject(new Error(err))
                            }
                        }
                    }
                })

                helper.on('error', (err) => {
                    console.error('[CanonEDSDK] Helper process failed to start:', err)
                    if (!isResolved) {
                        isResolved = true
                        reject(err)
                    }
                })

                helper.on('close', (code) => {
                    console.log(`[CanonEDSDK] Helper process exited with code ${code}`)
                    this.connected = false
                    this.currentCamera = null
                    this.helperProcess = null
                    if (!isResolved) {
                        isResolved = true
                        reject(new Error(`Helper process exited unexpectedly with code ${code}`))
                    }
                })
            } catch (err) {
                reject(err)
            }
        })
    }

    async disconnect(): Promise<void> {
        if (this.helperProcess) {
            console.log('[CanonEDSDK] Disconnecting helper process...')
            try {
                this.helperProcess.stdin?.write('EXIT\n')
            } catch (e) {}
            
            const processToKill = this.helperProcess
            setTimeout(() => {
                try {
                    processToKill.kill()
                } catch (e) {}
            }, 1000)
            
            this.helperProcess = null
        }
        this.connected = false
        this.currentCamera = null
        this.detectedCameraName = ''
        this.liveViewActive = false
        console.log('[CanonEDSDK] Disconnected')
    }

    /**
     * Capture a photo using Canon EDSDK with timeout guarantee
     * 
     * Flow:
     * 1. Initialize EDSDK framework with retry on COM port lock
     * 2. Get camera → SavePicturesToHost (RAM mode)
     * 3. Register PictureTaken event handler
     * 4. TakePictureNoAf() — trigger shutter without autofocus (faster)
     * 5. Wait for PictureTaken event → receive image bytes
     * 6. Save to outputPath
     */
    async capture(outputPath: string, options?: { allowLiveViewFallback?: boolean }): Promise<CaptureResult> {
        // Wrap entire capture in timeout promise race to guarantee response
        return Promise.race([
            this.captureInternal(outputPath, options),
            new Promise<CaptureResult>((_, reject) =>
                setTimeout(() => reject(new Error('Capture timeout: PowerShell script did not complete within 65 seconds')), 65000)
            )
        ]).catch((error: Error) => ({
            success: false,
            error: error.message || 'Unknown capture error',
            timestamp: Date.now()
        }))
    }

    private async captureInternal(outputPath: string, options?: { allowLiveViewFallback?: boolean }): Promise<CaptureResult> {
        const helper = this.helperProcess
        if (!helper) {
            return {
                success: false,
                error: 'Canon EDSDK: Helper process is not connected',
                timestamp: Date.now()
            }
        }

        try {
            console.log(`[CanonEDSDK] Capturing to: ${outputPath}`)

            const dir = dirname(outputPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            return new Promise<CaptureResult>((resolve, reject) => {
                let resolved = false
                const stdoutListener = (data: Buffer) => {
                    const lines = data.toString().split('\n')
                    for (const line of lines) {
                        const trimmed = line.trim()
                        console.log(`[CanonHelper capture] stdout: ${trimmed}`)
                        if (trimmed.startsWith('SUCCESS:')) {
                            resolved = true
                            cleanup()
                            resolve({
                                success: true,
                                imagePath: outputPath,
                                timestamp: Date.now()
                            })
                            break
                        } else if (trimmed.startsWith('ERROR:')) {
                            resolved = true
                            cleanup()
                            resolve({
                                success: false,
                                error: trimmed.substring(6).trim(),
                                timestamp: Date.now()
                            })
                            break;
                        }
                    }
                }

                const cleanup = () => {
                    helper.stdout?.removeListener('data', stdoutListener)
                }

                helper.stdout?.on('data', stdoutListener)

                // 20 seconds capture timeout
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true
                        cleanup()
                        resolve({
                            success: false,
                            error: 'Capture timeout waiting for C# helper response',
                            timestamp: Date.now()
                        })
                    }
                }, 20000)

                // Send capture command
                console.log(`[CanonEDSDK] Sending CAPTURE command to helper: ${outputPath}`)
                helper.stdin?.write(`CAPTURE ${outputPath}\n`)
            })

        } catch (error: any) {
            console.error('[CanonEDSDK] Capture exception:', error.message)
            return {
                success: false,
                error: `Canon EDSDK Capture Error: ${error.message}`,
                timestamp: Date.now()
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // Camera Settings API
    // ══════════════════════════════════════════════════════════

    /**
     * Set a camera property (iso, shutterspeed, aperture, etc.)
     * EDSDK uses its own property enums — we map common names
     */
    async setProperty(property: string, value: string): Promise<boolean> {
        try {
            const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()
    if ($cameras.Count -eq 0) {
        [Console]::WriteLine("===SET_ERROR===No camera")
        $framework.Dispose()
        exit
    }
    $cam = $cameras.Item(0)
    
    $property = '${property}'
    $value = '${value}'

    switch ($property) {
        'iso' { $cam.SetProperty(0x00000102, [int]$value) }
        'shutterspeed' { $cam.SetProperty(0x00000106, [int]$value) }
        'aperture' { $cam.SetProperty(0x00000103, [int]$value) }
        default { [Console]::WriteLine("===SET_ERROR===Unknown property: $property") }
    }
    
    [Console]::WriteLine("===SET_OK===")
    $framework.Dispose()
} catch {
    [Console]::WriteLine("===SET_ERROR===$($_.Exception.Message)")
}
`, 10000)

            return result.includes('===SET_OK===')
        } catch (error: any) {
            console.error(`[CanonEDSDK] Failed to set ${property}:`, error.message)
            return false
        }
    }

    /**
     * Get a camera property value
     */
    async getProperty(property: string): Promise<string | null> {
        try {
            const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()
    if ($cameras.Count -eq 0) {
        [Console]::WriteLine("===GET_ERROR===No camera")
        $framework.Dispose()
        exit
    }
    $cam = $cameras.Item(0)
    
    $property = '${property}'
    $val = ""

    switch ($property) {
        'camera.name' { $val = $cam.DeviceDescription }
        'battery' { $val = $cam.BatteryLevel.ToString() }
        default { $val = "unsupported" }
    }
    
    [Console]::WriteLine("===GET_VALUE===$val")
    $framework.Dispose()
} catch {
    [Console]::WriteLine("===GET_ERROR===$($_.Exception.Message)")
}
`, 10000)

            const match = result.match(/===GET_VALUE===(.*)/m)
            return match?.[1]?.trim() || null
        } catch (error: any) {
            console.error(`[CanonEDSDK] Failed to get ${property}:`, error.message)
            return null
        }
    }

    /**
     * Get available values for a camera property
     */
    async getAvailableValues(property: string): Promise<{ current: string; available: string[] }> {
        const current = await this.getProperty(property) || ''
        return { current, available: [] }
    }

    // ══════════════════════════════════════════════════════════
    // Live View
    // ══════════════════════════════════════════════════════════

    /**
     * Start EDSDK Live View
     */
    async startLiveView(): Promise<boolean> {
        if (!this.helperProcess) {
            console.log('[CanonEDSDK] Helper process not running in startLiveView. Attempting to auto-connect...')
            try {
                const connected = await this.connect('canon_edsdk_0')
                if (!connected) {
                    console.warn('[CanonEDSDK] Auto-connect failed in startLiveView')
                    return false
                }
            } catch (err: any) {
                console.error('[CanonEDSDK] Auto-connect threw exception in startLiveView:', err.message)
                return false
            }
        }
        
        return new Promise<boolean>((resolve) => {
            const helper = this.helperProcess!
            let resolved = false
            const hasCaptureCard = !!configService.getConfig().selectedCameraId
            const expectedStatus = hasCaptureCard ? 'STATUS:LV_STARTED_TFT' : 'STATUS:LV_STARTED'
            
            const stdoutListener = (data: Buffer) => {
                const lines = data.toString().split('\n')
                for (const line of lines) {
                    const trimmed = line.trim()
                    console.log(`[CanonHelper liveview] stdout: ${trimmed}`)
                    if (trimmed === expectedStatus) {
                        resolved = true
                        cleanup()
                        resolve(true)
                        break
                    } else if (trimmed.startsWith('ERROR:')) {
                        resolved = true
                        cleanup()
                        resolve(false)
                        break
                    }
                }
            }

            const cleanup = () => {
                helper.stdout?.removeListener('data', stdoutListener)
            }

            helper.stdout?.on('data', stdoutListener)

            // 5 seconds timeout
            setTimeout(() => {
                if (!resolved) {
                    resolved = true
                    cleanup()
                    console.warn(`[CanonEDSDK] Timeout waiting for live view start (${expectedStatus})`)
                    resolve(false)
                }
            }, 5000)

            if (hasCaptureCard) {
                console.log('[CanonEDSDK] Starting live view in TFT (Camera/HDMI) mode (capture card active)...')
                helper.stdin?.write('START_LV_TFT\n')
            } else {
                console.log('[CanonEDSDK] Starting live view in Host (USB) mode...')
                helper.stdin?.write('START_LV\n')
            }
            this.liveViewActive = true
        })
    }

    async stopLiveView(): Promise<boolean> {
        if (!this.helperProcess) return false
        
        return new Promise<boolean>((resolve) => {
            const helper = this.helperProcess!
            let resolved = false
            
            const stdoutListener = (data: Buffer) => {
                const lines = data.toString().split('\n')
                for (const line of lines) {
                    const trimmed = line.trim()
                    console.log(`[CanonHelper liveview] stdout: ${trimmed}`)
                    if (trimmed === 'STATUS:LV_STOPPED') {
                        resolved = true
                        cleanup()
                        resolve(true)
                        break
                    } else if (trimmed.startsWith('ERROR:')) {
                        resolved = true
                        cleanup()
                        resolve(false)
                        break
                    }
                }
            }

            const cleanup = () => {
                helper.stdout?.removeListener('data', stdoutListener)
            }

            helper.stdout?.on('data', stdoutListener)

            // 5 seconds timeout
            setTimeout(() => {
                if (!resolved) {
                    resolved = true
                    cleanup()
                    console.warn('[CanonEDSDK] Timeout waiting for live view stop')
                    resolve(false)
                }
            }, 5000)

            console.log('[CanonEDSDK] Stopping live view...')
            helper.stdin?.write('STOP_LV\n')
            this.liveViewActive = false
        })
    }

    async startPolling(): Promise<boolean> {
        if (!this.helperProcess) return false

        return new Promise<boolean>((resolve) => {
            const helper = this.helperProcess!
            let resolved = false

            const stdoutListener = (data: Buffer) => {
                const lines = data.toString().split('\n')
                for (const line of lines) {
                    const trimmed = line.trim()
                    console.log(`[CanonHelper polling] stdout: ${trimmed}`)
                    if (trimmed === 'STATUS:POLLING_STARTED') {
                        resolved = true
                        cleanup()
                        resolve(true)
                        break
                    } else if (trimmed.startsWith('ERROR:')) {
                        resolved = true
                        cleanup()
                        resolve(false)
                        break
                    }
                }
            }

            const cleanup = () => {
                helper.stdout?.removeListener('data', stdoutListener)
            }

            helper.stdout?.on('data', stdoutListener)

            setTimeout(() => {
                if (!resolved) {
                    resolved = true
                    cleanup()
                    console.warn('[CanonEDSDK] Timeout waiting for polling start')
                    resolve(false)
                }
            }, 3000)

            console.log('[CanonEDSDK] Starting USB live view polling in helper...')
            helper.stdin?.write('START_POLLING\n')
        })
    }

    async stopPolling(): Promise<boolean> {
        if (!this.helperProcess) return false

        return new Promise<boolean>((resolve) => {
            const helper = this.helperProcess!
            let resolved = false

            const stdoutListener = (data: Buffer) => {
                const lines = data.toString().split('\n')
                for (const line of lines) {
                    const trimmed = line.trim()
                    console.log(`[CanonHelper polling] stdout: ${trimmed}`)
                    if (trimmed === 'STATUS:POLLING_STOPPED') {
                        resolved = true
                        cleanup()
                        resolve(true)
                        break
                    } else if (trimmed.startsWith('ERROR:')) {
                        resolved = true
                        cleanup()
                        resolve(false)
                        break
                    }
                }
            }

            const cleanup = () => {
                helper.stdout?.removeListener('data', stdoutListener)
            }

            helper.stdout?.on('data', stdoutListener)

            setTimeout(() => {
                if (!resolved) {
                    resolved = true
                    cleanup()
                    console.warn('[CanonEDSDK] Timeout waiting for polling stop')
                    resolve(false)
                }
            }, 3000)

            console.log('[CanonEDSDK] Stopping USB live view polling in helper...')
            helper.stdin?.write('STOP_POLLING\n')
        })
    }

    async getLiveViewFrame(): Promise<string | null> {
        if (existsSync(this.liveViewTempPath)) {
            try {
                const size = require('fs').statSync(this.liveViewTempPath).size
                if (size > 100) {
                    return this.liveViewTempPath
                }
            } catch {}
        }
        return null
    }

    /**
     * Get the URL for the live view JPEG frame.
     * For EDSDK, we use a temp file that gets updated by polling.
     */
    getLiveViewUrl(): string {
        return 'http://localhost:5050/api/camera/liveview'
    }

    private recordingTimer: NodeJS.Timeout | null = null
    private recordedFrames: Buffer[] = []
    private recordingSlotId: string | null = null

    async startRecordingLivePhoto(slotId: string): Promise<boolean> {
        if (!this.helperProcess) return false
        
        console.log(`[CanonEDSDK] Starting memory-buffered Live Photo recording for slot: ${slotId}`)
        
        // Start helper polling in TFT mode if capture card is active
        const hasCaptureCard = !!configService.getConfig().selectedCameraId
        if (hasCaptureCard) {
            await this.startPolling()
        }
        
        this.recordedFrames = []
        this.recordingSlotId = slotId
        
        // Start reading the edsdk_liveview.jpg frame to memory unconditionally every 42ms (24 FPS)
        this.recordingTimer = setInterval(() => {
            const liveViewFile = this.liveViewTempPath
            if (existsSync(liveViewFile)) {
                try {
                    const buf = readFileSync(liveViewFile)
                    if (buf.length > 100) {
                        this.recordedFrames.push(buf)
                    }
                } catch (e) {
                    // Ignore transient read locks
                }
            }
        }, 42) // Poll every 42ms (exactly 24 FPS)
        
        return true
    }

    async stopRecordingLivePhoto(slotId: string): Promise<string | null> {
        console.log(`[CanonEDSDK] Stopping Live Photo recording for slot: ${slotId}`)
        
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer)
            this.recordingTimer = null
        }
        
        // Stop helper polling in TFT mode if capture card is active
        const hasCaptureCard = !!configService.getConfig().selectedCameraId
        if (hasCaptureCard) {
            await this.stopPolling()
        }
        
        const frames = this.recordedFrames
        this.recordedFrames = []
        const currentSlotId = this.recordingSlotId || slotId
        this.recordingSlotId = null
        
        const framesCount = frames.length
        if (framesCount === 0) {
            console.warn('[CanonEDSDK] No frames recorded in memory for live photo')
            return null
        }

        console.log(`[CanonEDSDK] Recorded ${framesCount} frames in memory. Writing to disk for compilation...`)
        
        // Ensure clean directory for this slot's frames
        const tempDir = join(app.getPath('userData'), 'temp', `recording_${currentSlotId}`)
        try {
            if (existsSync(tempDir)) {
                rmSync(tempDir, { recursive: true, force: true })
            }
            mkdirSync(tempDir, { recursive: true })
            
            // Batch write frames to disk
            for (let i = 0; i < framesCount; i++) {
                writeFileSync(join(tempDir, `frame_${i}.jpg`), frames[i])
            }
        } catch (e: any) {
            console.error('[CanonEDSDK] Failed to write frames to disk:', e.message)
            return null
        }
        
        // Compile the frames using FFmpeg
        const outputPath = join(app.getPath('userData'), 'temp', `live_photo_${currentSlotId}_${Date.now()}.mp4`)
        
        try {
            await new Promise<void>((resolve, reject) => {
                const fps = 24 // Exactly 24 FPS
                
                ffmpeg()
                    .input(join(tempDir, 'frame_%d.jpg'))
                    .inputOptions([`-framerate ${fps}`])
                    .outputOptions([
                        '-c:v libx264',
                        '-preset veryfast',
                        '-crf 28',
                        '-pix_fmt yuv420p',
                        '-movflags +faststart'
                    ])
                    .save(outputPath)
                    .on('end', () => resolve())
                    .on('error', (err: Error) => reject(err))
            })
            
            console.log(`[CanonEDSDK] Compiled 24fps live photo video to: ${outputPath}`)
            
            // Clean up the temp frames directory asynchronously
            setTimeout(() => {
                try {
                    rmSync(tempDir, { recursive: true, force: true })
                } catch {}
            }, 3000)
            
            return outputPath
        } catch (error: any) {
            console.error('[CanonEDSDK] Failed to compile live photo video:', error.message)
            return null
        }
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
     * Shutdown the Canon EDSDK handler
     */
    async shutdown(): Promise<void> {
        await this.disconnect()

        // Clean up temp live view file
        try {
            if (existsSync(this.liveViewTempPath)) {
                unlinkSync(this.liveViewTempPath)
            }
        } catch { /* ignore */ }

        console.log('[CanonEDSDK] Handler shutdown')
    }
}
