import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'

const execAsync = promisify(exec)

/**
 * WIA (Windows Image Acquisition) Camera Handler
 * Uses native Windows WIA API via PowerShell COM interop.
 * No third-party software required (no digiCamControl).
 * Supports Canon, Nikon, Sony, and most PTP-capable DSLRs.
 */
export class WIACamera extends CameraHandler {
    private deviceIndex: number = 1

    /**
     * Run a PowerShell script reliably using Base64 encoding.
     * This avoids all string escaping issues with exec().
     */
    private async runPowerShell(script: string, timeout = 15000): Promise<string> {
        const base64Script = Buffer.from(script, 'utf16le').toString('base64')
        try {
            const { stdout, stderr } = await execAsync(
                `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64Script}`,
                { timeout }
            )
            if (stderr) {
                console.warn('[WIA] PowerShell stderr:', stderr.trim())
            }
            return stdout.trim()
        } catch (error: any) {
            console.error('[WIA] PowerShell Execution Error:', error.message)
            if (error.stdout) console.error('[WIA] stdout:', error.stdout)
            if (error.stderr) console.error('[WIA] stderr:', error.stderr)
            throw error
        }
    }

    /**
     * List all WIA-compatible cameras connected via USB.
     */
    async listCameras(): Promise<CameraDevice[]> {
        console.log('[WIA] Scanning for cameras...')
        try {
            const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    if ($dm -eq $null) { [Console]::WriteLine("===WIA_ERROR===Failed to create DeviceManager"); exit }
    
    $results = @()
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
        $info = $dm.DeviceInfos.Item($i)
        $name = $info.Properties.Item("Name").Value
        $id = $info.DeviceID
        $results += "\${i}|\${name}|\${id}"
    }
    if ($results.Count -gt 0) {
        [Console]::WriteLine("===WIA_RESULTS===$($results -join ';;')===")
    } else {
        [Console]::WriteLine("===WIA_EMPTY===")
    }
} catch {
    [Console]::WriteLine("===WIA_ERROR===$($_.Exception.Message)")
}
`
            const rawOutput = await this.runPowerShell(psScript)
            console.log(`[WIA] Raw output from PS:`, rawOutput)

            if (rawOutput.includes('===WIA_EMPTY===')) {
                console.log('[WIA] Zero cameras found')
                return []
            }

            const match = rawOutput.match(/===WIA_RESULTS===(.*?)===/)
            if (!match || !match[1]) {
                const errorMatch = rawOutput.match(/===WIA_ERROR===(.*)/)
                console.warn('[WIA] Detection failed or no results:', errorMatch ? errorMatch[1] : 'Unknown error')
                return []
            }

            const data = match[1].trim()
            const cameras: CameraDevice[] = data.split(';;').filter(s => s.trim()).map(entry => {
                const [index, name] = entry.split('|')
                return {
                    id: `wia_${index}`,
                    name: name || 'Unknown Camera',
                    port: 'USB (WIA)',
                    connected: false
                }
            })

            console.log(`[WIA] Found ${cameras.length} camera(s):`, cameras.map(c => c.name).join(', '))
            return cameras
        } catch (error) {
            console.error('[WIA] Failed to list cameras:', error)
            return []
        }
    }

    async connect(cameraId: string): Promise<boolean> {
        try {
            const cameras = await this.listCameras()
            const camera = cameras.find(c => c.id === cameraId)

            if (camera) {
                const indexStr = cameraId.replace('wia_', '')
                this.deviceIndex = parseInt(indexStr) || 1

                this.currentCamera = { ...camera, connected: true }
                this.connected = true
                console.log(`[WIA] Connected to ${camera.name} (device index: ${this.deviceIndex})`)
                return true
            }

            console.warn('[WIA] Camera not found:', cameraId)
            return false
        } catch (error) {
            console.error('[WIA] Failed to connect:', error)
            return false
        }
    }

    async disconnect(): Promise<void> {
        console.log('[WIA] Disconnected')
        this.connected = false
        this.currentCamera = null
    }

    /**
     * Capture a photo using WIA.
     * Triggers the camera shutter via ExecuteCommand, then transfers the JPEG.
     */
    async capture(outputPath: string, options?: any): Promise<CaptureResult> {
        // Lazy connection: if not connected, try to find and connect to the first camera
        if (!this.connected) {
            console.log('[WIA] Not connected. Attempting lazy connection...')
            const cameras = await this.listCameras()
            if (cameras.length > 0) {
                const success = await this.connect(cameras[0].id)
                if (!success) {
                    return { success: false, error: 'Failed to auto-connect to camera', timestamp: Date.now() }
                }
            } else {
                return { success: false, error: 'Camera not connected and none found', timestamp: Date.now() }
            }
        }

        try {
            const dir = dirname(outputPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            console.log(`[WIA v2.1-FIXED] Capturing to: ${outputPath} (Index: ${this.deviceIndex})`)

            const escapedPath = outputPath.replace(/\\/g, '\\\\').replace(/'/g, "''")

            const result = await this.runPowerShell(`
$ErrorActionPreference = 'Stop'
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    $devInfo = $dm.DeviceInfos.Item(${this.deviceIndex})
    $dev = $devInfo.Connect()
    
    $wiaFormatJPEG = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
    $WIA_COMMAND_TAKE_PICTURE = '{AF933CAC-ACAD-11D2-A093-00C04F72DC3C}'

    # Attempt Shutter Trigger with Retries
    $shutterError = ""
    $item = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $oldCount = $dev.Items.Count
        try {
            $item = $dev.ExecuteCommand($WIA_COMMAND_TAKE_PICTURE)
            if ($item -ne $null) { break }
        } catch {
            $shutterError = $_.Exception.Message
        }
        
        # Wait a bit and check if a new item appeared anyway
        Start-Sleep -Milliseconds 1000
        if ($dev.Items.Count -gt $oldCount) {
            $item = $dev.Items.Item($dev.Items.Count)
            break
        }
    }

    if ($item -ne $null) {
        $img = $item.Transfer($wiaFormatJPEG)
        $img.SaveFile('${escapedPath}')
        [Console]::WriteLine("===WIA_CAPTURE_OK===")
    } else {
        [Console]::WriteLine("===WIA_ERROR===Shutter failed to trigger or no item appeared: $shutterError")
    }
} catch {
    [Console]::WriteLine("===WIA_ERROR===$($_.Exception.Message)")
}
`, 30000)

            console.log(`[WIA] Capture response:`, result)

            if (result.includes('===WIA_CAPTURE_OK===') || result.includes('===WIA_TRANSFER_OK===')) {
                if (existsSync(outputPath)) {
                    console.log(`[WIA] Photo saved: ${outputPath}`)
                    return {
                        success: true,
                        imagePath: outputPath,
                        timestamp: Date.now()
                    }
                }
            }

            return {
                success: false,
                error: `WIA capture failed: ${result}`,
                timestamp: Date.now()
            }
        } catch (error) {
            const err = error as Error
            console.error('[WIA] Capture exception:', err.message)
            return {
                success: false,
                error: err.message,
                timestamp: Date.now()
            }
        }
    }
}
