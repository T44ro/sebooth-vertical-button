import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'

const execAsync = promisify(exec)

/**
 * Direct Shutter Camera Handler (Truly Standalone)
 * 
 * Priority order:
 *   1. Native Windows WIA API (zero external apps needed)
 *   2. digiCamControl CLI (if installed)
 *   3. Breeze DSLR Remote Pro CLI (if installed)
 * 
 * WIA uses PowerShell COM interop to talk to the camera directly
 * via PTP protocol — no third-party software required.
 */
export class WIAShutterCamera extends CameraHandler {
    private DIGICAM_CLI = 'C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe'
    private BREEZE_CLI = 'C:\\Program Files (x86)\\BreezeSys\\DSLR Remote Pro\\DSlrRemote.exe'
    private deviceIndex: number = 1

    constructor() {
        super()
    }

    /**
     * Run a PowerShell script reliably using Base64 encoding.
     * This avoids all string escaping issues with exec().
     */
    private async runPowerShell(script: string, timeout = 30000): Promise<string> {
        const base64Script = Buffer.from(script, 'utf16le').toString('base64')
        try {
            const { stdout, stderr } = await execAsync(
                `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64Script}`,
                { timeout }
            )
            if (stderr) {
                console.warn('[DirectShutter/WIA] PowerShell stderr:', stderr.trim())
            }
            return stdout.trim()
        } catch (error: any) {
            console.error('[DirectShutter/WIA] PowerShell Execution Error:', error.message)
            if (error.stdout) console.error('[DirectShutter/WIA] stdout:', error.stdout)
            if (error.stderr) console.error('[DirectShutter/WIA] stderr:', error.stderr)
            throw error
        }
    }

    /**
     * List cameras: check WIA devices first, then fallback to a static placeholder
     */
    async listCameras(): Promise<CameraDevice[]> {
        console.log('[DirectShutter] Scanning for WIA cameras...')
        try {
            const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    if ($dm -eq $null) { [Console]::WriteLine("===WIA_EMPTY==="); exit }
    
    $results = @()
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
        $info = $dm.DeviceInfos.Item($i)
        $name = $info.Properties.Item("Name").Value
        $id = $info.DeviceID
        $results += "\${i}|\${name}|\${id}"
    }
    if ($results.Count -gt 0) {
        [Console]::WriteLine("===WIA_RESULTS===\$($results -join ';;')===")
    } else {
        [Console]::WriteLine("===WIA_EMPTY===")
    }
} catch {
    [Console]::WriteLine("===WIA_ERROR===\$($_.Exception.Message)")
}
`
            const rawOutput = await this.runPowerShell(psScript, 10000)
            console.log('[DirectShutter] WIA scan result:', rawOutput)

            if (rawOutput.includes('===WIA_EMPTY===')) {
                return [{
                    id: 'dslr_direct_shutter',
                    name: 'Canon DSLR (Direct Shutter - Menunggu koneksi...)',
                    port: 'USB',
                    connected: false
                }]
            }

            const match = rawOutput.match(/===WIA_RESULTS===(.*?)===/)
            if (match && match[1]) {
                const data = match[1].trim()
                const cameras: CameraDevice[] = data.split(';;').filter(s => s.trim()).map(entry => {
                    const [index, name] = entry.split('|')
                    return {
                        id: `wia_shutter_${index}`,
                        name: `${name || 'DSLR Camera'} (Direct Shutter)`,
                        port: 'USB (WIA)',
                        connected: false
                    }
                })
                console.log(`[DirectShutter] Found ${cameras.length} camera(s)`)
                return cameras
            }
        } catch (error) {
            console.error('[DirectShutter] WIA scan failed:', error)
        }

        // Fallback placeholder
        return [{
            id: 'dslr_direct_shutter',
            name: 'Canon DSLR (Direct Shutter Mode)',
            port: 'USB',
            connected: false
        }]
    }

    async connect(cameraId: string): Promise<boolean> {
        this.connected = true

        // Extract WIA device index from the camera ID
        const indexMatch = cameraId.match(/wia_shutter_(\d+)/)
        if (indexMatch) {
            this.deviceIndex = parseInt(indexMatch[1]) || 1
        }

        this.currentCamera = { id: cameraId, name: 'Canon DSLR (Direct Shutter)', port: 'USB', connected: true }
        
        // Kill conflicting utility apps like EOSUtility.exe upon connection so they release USB lock
        try {
            await execAsync('taskkill /f /im EOSUtility.exe', { timeout: 2000 })
        } catch (e) {
            // Ignore if not running
        }
        console.log(`[DirectShutter] Connected. WIA device index: ${this.deviceIndex}`)
        return true
    }

    async disconnect(): Promise<void> {
        this.connected = false
        this.currentCamera = null
    }

    async capture(outputPath: string): Promise<CaptureResult> {
        try {
            console.log('[DirectShutter] Preparing to trigger shutter...')
            
            const dir = dirname(outputPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            // ──────────────────────────────────────────────────────────
            // ENGINE 1: Native Windows WIA (Truly Standalone — no installs needed)
            // ──────────────────────────────────────────────────────────
            console.log(`[DirectShutter] ENGINE 1: Trying native WIA capture to: ${outputPath} (device index: ${this.deviceIndex})`)
            try {
                const escapedPath = outputPath.replace(/\\/g, '\\\\').replace(/'/g, "''")

                const result = await this.runPowerShell(`
$ErrorActionPreference = 'Stop'
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    $devCount = $dm.DeviceInfos.Count
    [Console]::WriteLine("===WIA_DEVICE_COUNT===$devCount")
    
    if ($devCount -eq 0) {
        [Console]::WriteLine("===WIA_ERROR===Tidak ada kamera WIA terdeteksi. Pastikan kabel USB terhubung.")
        exit
    }

    $devIdx = ${this.deviceIndex}
    if ($devIdx -gt $devCount) { $devIdx = 1 }
    
    $devInfo = $dm.DeviceInfos.Item($devIdx)
    $devName = $devInfo.Properties.Item("Name").Value
    [Console]::WriteLine("===WIA_CONNECTING===$devName")
    $dev = $devInfo.Connect()
    
    $wiaFormatJPEG = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
    $WIA_COMMAND_TAKE_PICTURE = '{AF933CAC-ACAD-11D2-A093-00C04F72DC3C}'

    # Attempt Shutter Trigger with Retries
    $shutterError = ""
    $item = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        [Console]::WriteLine("===WIA_ATTEMPT===$attempt")
        $oldCount = $dev.Items.Count
        try {
            $item = $dev.ExecuteCommand($WIA_COMMAND_TAKE_PICTURE)
            if ($item -ne $null) { 
                [Console]::WriteLine("===WIA_SHUTTER_OK===Attempt $attempt")
                break 
            }
        } catch {
            $shutterError = $_.Exception.Message
            [Console]::WriteLine("===WIA_ATTEMPT_FAIL===$shutterError")
        }
        
        # Wait a bit and check if a new item appeared anyway
        Start-Sleep -Milliseconds 1500
        if ($dev.Items.Count -gt $oldCount) {
            $item = $dev.Items.Item($dev.Items.Count)
            [Console]::WriteLine("===WIA_ITEM_APPEARED===")
            break
        }
    }

    if ($item -ne $null) {
        $img = $item.Transfer($wiaFormatJPEG)
        $img.SaveFile('${escapedPath}')
        [Console]::WriteLine("===WIA_CAPTURE_OK===")
    } else {
        [Console]::WriteLine("===WIA_ERROR===Shutter gagal trigger setelah 3 percobaan: $shutterError")
    }
} catch {
    [Console]::WriteLine("===WIA_ERROR===$($_.Exception.Message)")
}
`, 30000)

                console.log('[DirectShutter] WIA capture response:', result)

                if (result.includes('===WIA_CAPTURE_OK===')) {
                    if (existsSync(outputPath)) {
                        console.log(`[DirectShutter] ✅ WIA Photo saved: ${outputPath}`)
                        return {
                            success: true,
                            imagePath: outputPath,
                            timestamp: Date.now()
                        }
                    }
                }

                // Extract meaningful error for user
                const errorMatch = result.match(/===WIA_ERROR===(.*)/)
                const wiaError = errorMatch ? errorMatch[1] : 'Unknown WIA error'
                console.warn(`[DirectShutter] WIA capture failed: ${wiaError}`)

                // If no WIA device found at all, fall through to CLI engines
                if (!result.includes('===WIA_DEVICE_COUNT===0')) {
                    // WIA device was found but capture failed — report the specific error
                    // Still try CLI engines as fallback below
                    console.warn('[DirectShutter] WIA device found but capture failed, trying CLI engines...')
                }
            } catch (error: any) {
                console.warn('[DirectShutter] WIA engine exception:', error.message)
            }

            // ──────────────────────────────────────────────────────────
            // ENGINE 2: digiCamControl CLI (Optional — if installed)
            // ──────────────────────────────────────────────────────────
            if (existsSync(this.DIGICAM_CLI)) {
                console.log(`[DirectShutter] ENGINE 2: Trying digiCamControl to: ${outputPath}`)
                try {
                    // Kill previous CLI instances first
                    try {
                        await execAsync('taskkill /f /im CameraControlCmd.exe', { timeout: 1000 })
                    } catch (e) { /* ignore */ }

                    await execAsync(`"${this.DIGICAM_CLI}" /capture /filename "${outputPath}"`, { timeout: 15000 })
                    
                    if (existsSync(outputPath)) {
                        console.log(`[DirectShutter] ✅ digiCamControl capture success`)
                        return { success: true, imagePath: outputPath, timestamp: Date.now() }
                    } else {
                        console.warn('[DirectShutter] digiCamControl completed but file not found.')
                    }
                } catch (error: any) {
                    console.warn('[DirectShutter] digiCamControl failed:', error.message)
                }
            }

            // ──────────────────────────────────────────────────────────
            // ENGINE 3: Breeze DSLR Remote Pro (Optional — if installed)
            // ──────────────────────────────────────────────────────────
            if (existsSync(this.BREEZE_CLI)) {
                console.log(`[DirectShutter] ENGINE 3: Trying DSLR Remote Pro to: ${outputPath}`)
                try {
                    await execAsync(`"${this.BREEZE_CLI}" -c "${outputPath}"`, { timeout: 15000 })
                    
                    if (existsSync(outputPath)) {
                        console.log(`[DirectShutter] ✅ DSLR Remote Pro capture success`)
                        return { success: true, imagePath: outputPath, timestamp: Date.now() }
                    } else {
                        console.warn('[DirectShutter] DSLR Remote Pro completed but file not found.')
                    }
                } catch (error: any) {
                    console.warn('[DirectShutter] DSLR Remote Pro failed:', error.message)
                }
            }

            return {
                success: false,
                error: 'Gagal memicu shutter. Pastikan: (1) Kabel USB terhubung ke kamera, (2) Kamera dalam mode "PC Connect" / PTP (bukan MTP), (3) Live View di kamera MATI, (4) Tutup semua aplikasi kamera lainnya (EOS Utility, dll).',
                timestamp: Date.now()
            }
        } catch (error: any) {
            console.error('[DirectShutter] Global Capture error:', error.message)
            return {
                success: false,
                error: `System Error: ${error.message}`,
                timestamp: Date.now()
            }
        }
    }
}
