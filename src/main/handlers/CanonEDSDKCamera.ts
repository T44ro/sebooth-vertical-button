import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'

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
            'CameraControlCmd.exe'
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

    private async waitForCameraRelease(retries = 3): Promise<void> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            await this.killConflictingApps()
            await this.resetCanonUsbDevice()
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempt))
            }
        }
    }

    private async resetCanonUsbDevice(): Promise<void> {
        try {
            await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-PnpDevice -Class Camera | Where-Object { $_.FriendlyName -match 'Canon|EOS' } | ForEach-Object { Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }"`, { timeout: 20000 })
            console.log('[CanonEDSDK] Reset Canon USB device via PnP')
        } catch {
            // Ignore reset errors; not all systems expose the same PnP commands.
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
     */
    async listCameras(): Promise<CameraDevice[]> {
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
            $cam = $cameras.Item($i)
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

        if (this.connected && this.currentCamera?.id === cameraId) {
            console.log('[CanonEDSDK] Camera already connected, reusing session')
            return true
        }

        this.connected = false
        this.currentCamera = null
        this.detectedCameraName = ''
        await this.waitForCameraRelease()

        const maxAttempts = 3
        let lastError: Error | null = null

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()

    if ($cameras.Count -eq 0) {
        [Console]::WriteLine("===CANON_CONNECT_ERROR===Tidak ada kamera Canon terdeteksi. Pastikan: (1) Kabel USB terhubung, (2) Kamera ON, (3) Mode PTP aktif, (4) Tutup EOS Utility/EOS Webcam Utility")
        $framework.Dispose()
        exit
    }

    $index = ${cameraId.replace(/^canon_edsdk_/, '')}
    if ([int]::TryParse($index, [ref]$index)) {
        $cam = $cameras.Item([int]$index)
    } else {
        $cam = $cameras.Item(0)
    }

    $name = $cam.DeviceDescription
    $hostFolder = [System.IO.Path]::GetTempPath()

    # Open session
    # SavePicturesToHost requires both a photo folder and a temporary video folder path.
    $cam.SavePicturesToHostAndCamera($hostFolder, $hostFolder)

    [Console]::WriteLine("===CANON_CONNECTED===$name")

    $framework.Dispose()
} catch {
    [Console]::WriteLine("===CANON_CONNECT_ERROR===$($_.Exception.Message)")
}
`, 20000)

                console.log('[CanonEDSDK] Connect result:', result)

                if (result.includes('===CANON_CONNECTED===')) {
                    const nameMatch = result.match(/===CANON_CONNECTED===(.*)/m)
                    this.detectedCameraName = nameMatch?.[1]?.trim() || 'Canon Camera'
                    this.connected = true
                    this.currentCamera = {
                        id: cameraId,
                        name: `${this.detectedCameraName} (Canon EDSDK)`,
                        port: 'USB',
                        connected: true
                    }
                    console.log(`[CanonEDSDK] ✅ Connected: ${this.detectedCameraName}`)
                    return true
                }

                const errMatch = result.match(/===CANON_CONNECT_ERROR===(.*)/m)
                const errorMsg = errMatch?.[1] || 'Unknown connection error'
                lastError = new Error(errorMsg)

                if (attempt < maxAttempts && this.isPortInUseError(errorMsg)) {
                    console.warn(`[CanonEDSDK] Port busy, retrying connect (${attempt}/${maxAttempts})...`)
                    await new Promise(resolve => setTimeout(resolve, 2500 * attempt))
                    await this.waitForCameraRelease()
                    continue
                }

                this.connected = false
                this.currentCamera = null
                throw lastError
            } catch (error: any) {
                lastError = error
                this.connected = false
                this.currentCamera = null
                console.error('[CanonEDSDK] Connect error:', error.message)

                if (attempt < maxAttempts && this.isPortInUseError(error.message)) {
                    console.warn(`[CanonEDSDK] Port busy, retrying connect (${attempt}/${maxAttempts})...`)
                    await new Promise(resolve => setTimeout(resolve, 2500 * attempt))
                    await this.waitForCameraRelease()
                    continue
                }

                throw error
            }
        }

        throw lastError || new Error('Unknown connection error')
    }

    async disconnect(): Promise<void> {
        if (this.liveViewActive) {
            await this.stopLiveView()
        }
        this.connected = false
        this.currentCamera = null
        this.detectedCameraName = ''
        console.log('[CanonEDSDK] Disconnected')
    }

    /**
     * Capture a photo using Canon EDSDK
     * 
     * Flow:
     * 1. Initialize EDSDK framework
     * 2. Get camera → SavePicturesToHost (RAM mode)
     * 3. Register PictureTaken event handler
     * 4. TakePictureNoAf() — trigger shutter without autofocus (faster)
     * 5. Wait for PictureTaken event → receive image bytes
     * 6. Save to outputPath
     */
    async capture(outputPath: string, options?: { allowLiveViewFallback?: boolean }): Promise<CaptureResult> {
        try {
            console.log(`[CanonEDSDK] Capturing to: ${outputPath}`)

            const dir = dirname(outputPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            // Kill any USB-locking apps before capture
            await this.killConflictingApps()

            const escapedOutputPath = outputPath.replace(/\\/g, '\\\\').replace(/'/g, "''")

            const allowLV = options?.allowLiveViewFallback !== false
            const useHostSave = allowLV

            const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

$outputPath = '${escapedOutputPath}'
$allowLV = ${allowLV ? '$true' : '$false'}
$useHostSave = ${useHostSave ? '$true' : '$false'}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()

    if ($cameras.Count -eq 0) {
        [Console]::WriteLine("===CAPTURE_ERROR===Tidak ada kamera Canon terdeteksi")
        $framework.Dispose()
        exit
    }

    $cam = $cameras.Item(0)
    $camName = $cam.DeviceDescription
    [Console]::WriteLine("===CAPTURE_CAMERA===$camName")

    # Set save destination to Host + Camera only when using liveview/host save
    $hostFolder = [System.IO.Path]::GetDirectoryName($outputPath)
    [Console]::WriteLine("===HOST_FOLDER=== $hostFolder")
    if ($useHostSave) {
        try { $beforeFiles = Get-ChildItem -Path $hostFolder -Filter '*.jpg' -File -ErrorAction SilentlyContinue | Select-Object Name,LastWriteTime; [Console]::WriteLine("===HOST_BEFORE_COUNT=== $($beforeFiles.Count)") } catch { }
        $cam.SavePicturesToHostAndCamera($hostFolder, $hostFolder)
    } else {
        [Console]::WriteLine("===HOST_SAVE_DISABLED===LiveView/host save disabled")
    }

    # Create event synchronization objects
    $captureCompleted = New-Object System.Threading.ManualResetEvent($false)
    $capturedImageBytes = $null
    $captureError = ""

    # Register PictureTaken event handler — this fires when the image arrives
    $pictureHandler = [System.EventHandler[Canon.Eos.Framework.Eventing.EosImageEventArgs]] {
        param($sender, $e)
        try {
            # $e contains the image data from the Canon SDK event payload
            $script:capturedImageBytes = $e.ImageData
            [Console]::WriteLine("===CAPTURE_EVENT_FIRED===ImageSize: $($e.ImageData.Length)")
        } catch {
            $script:captureError = $_.Exception.Message
            [Console]::WriteLine("===CAPTURE_EVENT_ERROR===$($_.Exception.Message)")
        }
        $captureCompleted.Set()
    }

    # Also handle file-based events (some cameras use this instead)
    $fileHandler = [System.EventHandler[Canon.Eos.Framework.Eventing.EosFileImageEventArgs]] {
        param($sender, $e)
        try {
            $script:capturedImageBytes = [System.IO.File]::ReadAllBytes($e.ImageFilePath)
            [Console]::WriteLine("===CAPTURE_FILE_EVENT===File: $($e.ImageFilePath), Size: $($script:capturedImageBytes.Length)")
        } catch {
            $script:captureError = $_.Exception.Message
        }
        $captureCompleted.Set()
    }

    $cam.add_PictureTaken($pictureHandler)
    
    [Console]::WriteLine("===CAPTURE_TRIGGERING===")
    [Console]::WriteLine("===CAPTURE_OPTION_ALLOW_LV===$allowLV")
    [Console]::WriteLine("===CAPTURE_OPTION_USE_HOST_SAVE===$useHostSave")

    # Try TakePictureNoAf first (faster, no autofocus delay)
    $shutterSuccess = $false
    $lvSaved = $false
    try {
        $cam.TakePictureNoAf()
        [Console]::WriteLine("===CAPTURE_SHUTTER_OK===TakePictureNoAf")
        $shutterSuccess = $true
    } catch {
        # Fallback to TakePicture (with autofocus)
        [Console]::WriteLine("===CAPTURE_NOAF_FAILED===$($_.Exception.Message)")
        try {
            $cam.TakePicture()
            [Console]::WriteLine("===CAPTURE_SHUTTER_OK===TakePicture")
            $shutterSuccess = $true
        } catch {
            [Console]::WriteLine("===CAPTURE_ERROR_SHUTTER===$($_.Exception.Message)")

            # As a last-resort fallback, try to grab a LiveView frame if available.
            # Respect options: if allowLiveViewFallback is provided and false, skip liveview fallback to avoid forcing camera preview changes.
            if ($allowLV -eq $false) {
                [Console]::WriteLine("===CAPTURE_LIVEVIEW_SKIPPED===LiveView fallback disabled by options")
            }
            try {
                if ($allowLV) {
                    [Console]::WriteLine("===CAPTURE_LIVEVIEW_TRY===Starting LiveView for fallback frames")
                    try { $cam.StartLiveView() } catch {}
                    Start-Sleep -Milliseconds 200
                    $lvSaved = $false
                    for ($i = 0; $i -lt 12; $i++) {
                        try {
                            $lv = $cam.GetLiveViewImage()
                            if ($lv -ne $null -and $lv.Length -gt 1000) {
                                [System.IO.File]::WriteAllBytes($outputPath, $lv)
                                [Console]::WriteLine("===CAPTURE_SAVED_LV===Size: $($lv.Length)")
                                $lvSaved = $true
                                $shutterSuccess = $true
                                break
                            }
                        } catch {
                            # ignore intermittent liveview errors
                        }
                        Start-Sleep -Milliseconds 500
                    }
                    try { $cam.StopLiveView() } catch {}

                    if (-not $lvSaved) {
                        [Console]::WriteLine("===CAPTURE_LIVEVIEW_FAILED===No liveview image returned after attempts")
                    }
                }
            } catch {
                [Console]::WriteLine("===CAPTURE_LIVEVIEW_ERROR===$($_.Exception.Message)")
            }
        }
    }

    # Wait for the image to arrive (max 30 seconds) only if we triggered the shutter
    $gotImage = $false
    if ($shutterSuccess -and -not $lvSaved) {
        $gotImage = $captureCompleted.WaitOne(30000)
    }

    # Always remove handler if it was registered
    try { $cam.remove_PictureTaken($pictureHandler) } catch {}

    if ($gotImage -and $capturedImageBytes -ne $null -and $capturedImageBytes.Length -gt 1000) {
        # Save image to disk
        [System.IO.File]::WriteAllBytes($outputPath, $capturedImageBytes)
        [Console]::WriteLine("===CAPTURE_SAVED===Size: $($capturedImageBytes.Length)")
    } elseif ($captureError) {
        [Console]::WriteLine("===CAPTURE_ERROR===$captureError")
    } else {
        [Console]::WriteLine("===CAPTURE_TIMEOUT===Image did not arrive within 30 seconds, trying host folder poll fallback")

        # Poll host folder for recently written image files as a fallback
        try {
            $recent = Get-ChildItem -Path $hostFolder -Filter '*.jpg' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($recent -and $recent.Length -gt 1000) {
                # If the most recent file is already the output path, avoid copying onto itself
                if ($recent.FullName -ieq $outputPath) {
                    $size = $recent.Length
                    [Console]::WriteLine("===CAPTURE_SAVED_POLL===AlreadyAtOutput: $($recent.FullName) Size: $size")
                } else {
                    Copy-Item -Path $recent.FullName -Destination $outputPath -Force
                    $size = (Get-Item $outputPath).Length
                    [Console]::WriteLine("===CAPTURE_SAVED_POLL===Found: $($recent.FullName) Size: $size")
                }
            } else {
                [Console]::WriteLine("===CAPTURE_POLL_NONE===No recent file found in host folder")
                try { $afterFiles = Get-ChildItem -Path $hostFolder -Filter '*.jpg' -File -ErrorAction SilentlyContinue | Select-Object Name,LastWriteTime; [Console]::WriteLine("===HOST_AFTER_COUNT=== $($afterFiles.Count)") } catch {}
            }
        } catch {
            [Console]::WriteLine("===CAPTURE_POLL_ERROR===$($_.Exception.Message)")
        }
    }

    $framework.Dispose()
} catch {
    [Console]::WriteLine("===CAPTURE_ERROR===$($_.Exception.Message)")
}
`, 30000)

            console.log('[CanonEDSDK] Capture result:', result)

            // Treat any of the CAPTURE_SAVED markers as success (direct save, liveview save, or poll-copy)
            if (result.includes('===CAPTURE_SAVED===') || result.includes('===CAPTURE_SAVED_LV===') || result.includes('===CAPTURE_SAVED_POLL===')) {
                if (existsSync(outputPath)) {
                    const fileSize = require('fs').statSync(outputPath).size
                    console.log(`[CanonEDSDK] ✅ Photo saved: ${outputPath} (${fileSize} bytes)`)
                    return {
                        success: true,
                        imagePath: outputPath,
                        timestamp: Date.now()
                    }
                } else {
                    // Some code paths may report saved but the file was written elsewhere; attempt to parse size from output
                    const sizeMatch = result.match(/Size: (\d+)/)
                    const fileSize = sizeMatch ? sizeMatch[1] : 'unknown'
                    console.log(`[CanonEDSDK] Photo reported saved but file not found: ${outputPath} (reported ${fileSize} bytes)`)
                    return {
                        success: false,
                        error: `Canon EDSDK: reported saved but file missing (${fileSize} bytes)`,
                        timestamp: Date.now()
                    }
                }
            }

            // Extract error message
            const errMatch = result.match(/===CAPTURE_ERROR===(.*)/m)
            const timeoutMatch = result.match(/===CAPTURE_TIMEOUT===(.*)/m)
            const errorMsg = errMatch?.[1] || timeoutMatch?.[1] || 'Capture failed — unknown error'

            console.error(`[CanonEDSDK] Capture failed: ${errorMsg}`)
            return {
                success: false,
                error: `Canon EDSDK: ${errorMsg}`,
                timestamp: Date.now()
            }
        } catch (error: any) {
            console.error('[CanonEDSDK] Capture exception:', error.message)
            return {
                success: false,
                error: `Canon EDSDK Error: ${error.message}`,
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
        try {
            const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()
    if ($cameras.Count -eq 0) {
        [Console]::WriteLine("===LV_ERROR===No camera")
        $framework.Dispose()
        exit
    }
    $cam = $cameras.Item(0)
    $cam.StartLiveView()
    [Console]::WriteLine("===LV_STARTED===")
    $framework.Dispose()
} catch {
    [Console]::WriteLine("===LV_ERROR===$($_.Exception.Message)")
}
`, 10000)

            if (result.includes('===LV_STARTED===')) {
                this.liveViewActive = true
                console.log('[CanonEDSDK] Live view started')
                return true
            }

            console.warn('[CanonEDSDK] Failed to start live view:', result)
            return false
        } catch (error: any) {
            console.error('[CanonEDSDK] Live view start error:', error.message)
            return false
        }
    }

    /**
     * Stop EDSDK Live View
     */
    async stopLiveView(): Promise<boolean> {
        try {
            const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()
    if ($cameras.Count -eq 0) {
        [Console]::WriteLine("===LV_ERROR===No camera")
        $framework.Dispose()
        exit
    }
    $cam = $cameras.Item(0)
    $cam.StopLiveView()
    [Console]::WriteLine("===LV_STOPPED===")
    $framework.Dispose()
} catch {
    [Console]::WriteLine("===LV_ERROR===$($_.Exception.Message)")
}
`, 10000)

            this.liveViewActive = false
            console.log('[CanonEDSDK] Live view stopped')
            return true
        } catch (error: any) {
            console.error('[CanonEDSDK] Live view stop error:', error.message)
            this.liveViewActive = false
            return false
        }
    }

    /**
     * Get a single Live View frame from EDSDK and save to temp file.
     * Returns the path to the temp file.
     */
    async getLiveViewFrame(): Promise<string | null> {
        try {
            const escapedPath = this.liveViewTempPath.replace(/\\/g, '\\\\').replace(/'/g, "''")

            const result = await this.runPowerShell(`
${this.getEdsdkPreamble()}

try {
    $framework = New-Object Canon.Eos.Framework.EosFramework
    $cameras = $framework.GetCameraCollection()
    if ($cameras.Count -eq 0) {
        $framework.Dispose()
        exit
    }
    $cam = $cameras.Item(0)
    $imageBytes = $cam.GetLiveViewImage()
    if ($imageBytes -ne $null -and $imageBytes.Length -gt 100) {
        [System.IO.File]::WriteAllBytes('${escapedPath}', $imageBytes)
        [Console]::WriteLine("===LV_FRAME_OK===$($imageBytes.Length)")
    }
    $framework.Dispose()
} catch {
    # Silent fail for live view frames — they're ephemeral
}
`, 5000)

            if (result.includes('===LV_FRAME_OK===')) {
                return this.liveViewTempPath
            }
            return null
        } catch {
            return null
        }
    }

    /**
     * Get the URL for the live view JPEG frame.
     * For EDSDK, we use a temp file that gets updated by polling.
     */
    getLiveViewUrl(): string {
        return `file:///${this.liveViewTempPath.replace(/\\/g, '/')}`
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
        if (this.liveViewActive) {
            try { await this.stopLiveView() } catch { /* ignore */ }
        }

        // Clean up temp live view file
        try {
            if (existsSync(this.liveViewTempPath)) {
                unlinkSync(this.liveViewTempPath)
            }
        } catch { /* ignore */ }

        this.connected = false
        this.currentCamera = null
        this.detectedCameraName = ''
        console.log('[CanonEDSDK] Handler shutdown')
    }
}
