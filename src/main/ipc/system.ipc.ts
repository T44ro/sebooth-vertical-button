import { IpcMain, dialog, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, renameSync, readdirSync } from 'fs'
import { APIResponse } from '@shared/types'
import sharp from 'sharp'
// @ts-ignore - Ignore missing types for fluent-ffmpeg to prevent build failures
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import { getLocalIpAddress } from '../server'

ffmpeg.setFfmpegPath(ffmpegPath.path)

/**
 * Register all system-related IPC handlers
 */
export function registerSystemHandlers(ipcMain: IpcMain): void {

    // Open file dialog
    ipcMain.handle('system:open-file-dialog', async (_, options: {
        title?: string
        filters?: { name: string; extensions: string[] }[]
        multiple?: boolean
    }): Promise<APIResponse<string[]>> => {
        try {
            const result = await dialog.showOpenDialog({
                title: options.title || 'Select File',
                filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
                properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile']
            })

            if (result.canceled) {
                return { success: true, data: [] }
            }

            return { success: true, data: result.filePaths }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Get temp folder path
    ipcMain.handle('system:get-temp-path', async (): Promise<APIResponse<string>> => {
        const tempPath = join(app.getPath('userData'), 'temp')

        // Ensure temp folder exists
        if (!existsSync(tempPath)) {
            mkdirSync(tempPath, { recursive: true })
        }

        return { success: true, data: tempPath }
    })

    // Get user data path
    ipcMain.handle('system:get-user-data-path', async (): Promise<APIResponse<string>> => {
        return { success: true, data: app.getPath('userData') }
    })

    // Copy file to destination
    ipcMain.handle('system:copy-file', async (_, source: string, destination: string): Promise<APIResponse<string>> => {
        try {
            // Ensure destination directory exists
            const destDir = join(destination, '..')
            if (!existsSync(destDir)) {
                mkdirSync(destDir, { recursive: true })
            }

            copyFileSync(source, destination)
            return { success: true, data: destination }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Read JSON file
    ipcMain.handle('system:read-json', async (_, filePath: string): Promise<APIResponse<unknown>> => {
        try {
            if (!existsSync(filePath)) {
                return { success: false, error: 'File not found' }
            }

            const content = readFileSync(filePath, 'utf-8')
            const data = JSON.parse(content)
            return { success: true, data }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Write JSON file
    ipcMain.handle('system:write-json', async (_, filePath: string, data: unknown): Promise<APIResponse<void>> => {
        try {
            // Ensure directory exists
            const dir = join(filePath, '..')
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
            return { success: true }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Check if file exists
    ipcMain.handle('system:file-exists', async (_, filePath: string): Promise<APIResponse<boolean>> => {
        return { success: true, data: existsSync(filePath) }
    })

    // Read file as base64 string
    ipcMain.handle('system:read-file-base64', async (_, filePath: string): Promise<APIResponse<string>> => {
        try {
            if (!existsSync(filePath)) {
                return { success: false, error: `File not found: ${filePath}` }
            }
            const buffer = readFileSync(filePath)
            return { success: true, data: buffer.toString('base64') }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Generate High-Quality GIF using FFmpeg
    ipcMain.handle('system:generate-hq-gif', async (_, framesBase64: string[], delayMs: number): Promise<APIResponse<string>> => {
        try {
            const tempPath = join(app.getPath('userData'), 'temp', `hq_gif_${Date.now()}`)
            if (!existsSync(tempPath)) {
                mkdirSync(tempPath, { recursive: true })
            }

            // Save all frames
            const framePaths: string[] = []
            for (let i = 0; i < framesBase64.length; i++) {
                const matches = framesBase64[i].match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/)
                if (matches) {
                    const buffer = Buffer.from(matches[2], 'base64')
                    const framePath = join(tempPath, `frame_${i}.jpg`)
                    writeFileSync(framePath, buffer)
                    framePaths.push(framePath)
                }
            }

            if (framePaths.length === 0) {
                return { success: false, error: 'No valid frames provided' }
            }

            const outputPath = join(tempPath, 'output.gif')
            const fps = 1000 / delayMs

            await new Promise<void>((resolve, reject) => {
                const filterComplex = [
                    '[0:v]split[v1][v2]',
                    '[v1]palettegen=stats_mode=diff[pal]',
                    '[v2][pal]paletteuse=dither=bayer:bayer_scale=5[outv]'
                ].join(';')

                ffmpeg()
                    .input(join(tempPath, 'frame_%d.jpg'))
                    .inputOptions([`-framerate ${fps}`])
                    .complexFilter(filterComplex)
                    .outputOptions([
                        '-map [outv]',
                        '-loop 0'
                    ])
                    .save(outputPath)
                    .on('end', () => resolve())
                    .on('error', (err: Error) => reject(err))
            })

            // Read output gif as base64
            const resultBuffer = readFileSync(outputPath)
            const resultBase64 = `data:image/gif;base64,${resultBuffer.toString('base64')}`

            // Cleanup temp folder (background)
            setTimeout(() => {
                try {
                    rmSync(tempPath, { recursive: true, force: true })
                } catch (e) {
                    console.error('Failed to cleanup temp gif folder', e)
                }
            }, 5000)

            return { success: true, data: resultBase64 }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Save data URL as file
    ipcMain.handle('system:save-data-url', async (_, dataUrl: string, filename: string): Promise<APIResponse<string>> => {
        try {
            const tempPath = join(app.getPath('userData'), 'temp')

            // Ensure temp folder exists
            if (!existsSync(tempPath)) {
                mkdirSync(tempPath, { recursive: true })
            }

            // Parse data URL
            const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/)
            if (!matches) {
                return { success: false, error: 'Invalid data URL format' }
            }

            const base64Data = matches[2]
            const buffer = Buffer.from(base64Data, 'base64')

            const filePath = join(tempPath, filename)
            writeFileSync(filePath, buffer)

            return { success: true, data: filePath }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Save entire session locally for backup
    ipcMain.handle('system:save-session-locally', async (_, params: {
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
    }): Promise<APIResponse<{ path: string; filename: string; mimeType: string }[]>> => {
        try {
            const baseDir = join(app.getPath('documents'), 'Sebooth', 'Sessions', `Session_${params.sessionId}`)

            if (!existsSync(baseDir)) {
                mkdirSync(baseDir, { recursive: true })
            }

            const savedFiles: { path: string; filename: string; mimeType: string }[] = []

            let qrCodePath: string | null = null;

            // Save strip from base64
            if (params.stripDataUrl) {
                const matches = params.stripDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/)
                if (matches) {
                    const buffer = Buffer.from(matches[2], 'base64')
                    const filename = `strip_${params.sessionId}.jpg`
                    const destPath = join(baseDir, filename)
                    writeFileSync(destPath, buffer)
                    savedFiles.push({ path: destPath, filename, mimeType: 'image/jpeg' })
                }
            }

            // Save GIF from base64
            if (params.gifDataUrl) {
                const matches = params.gifDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/)
                if (matches) {
                    const buffer = Buffer.from(matches[2], 'base64')
                    const filename = `gif_${params.sessionId}.gif`
                    const destPath = join(baseDir, filename)
                    writeFileSync(destPath, buffer)
                    savedFiles.push({ path: destPath, filename, mimeType: 'image/gif' })
                }
            }

            // Save QR from base64 (if provided)
            if (params.qrCodeDataUrl) {
                const matches = params.qrCodeDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/)
                if (matches) {
                    const buffer = Buffer.from(matches[2], 'base64')
                    const filename = `temp_session_qr.png`
                    const destPath = join(baseDir, filename)
                    writeFileSync(destPath, buffer)
                    qrCodePath = destPath
                    savedFiles.push({ path: destPath, filename, mimeType: 'image/png' })
                }
            }

            // Copy photos (could be data URLs from webcam or file paths from DSLR)
            for (const photo of params.photos) {
                if (photo.path.startsWith('data:')) {
                    const matches = photo.path.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/)
                    if (matches) {
                        let buffer = Buffer.from(matches[2], 'base64')
                        const destPath = join(baseDir, photo.filename)
                        if (params.mirrorOutput) {
                            try {
                                buffer = Buffer.from(await sharp(buffer).flop().toBuffer())
                            } catch (sharpErr) {
                                console.error('Failed to mirror webcam photo base64:', sharpErr)
                            }
                        }
                        writeFileSync(destPath, buffer)
                        savedFiles.push({ path: destPath, filename: photo.filename, mimeType: 'image/jpeg' })
                    }
                } else {
                    // Strip file:/// if present
                    const cleanUrl = photo.path.startsWith('file:///') ? decodeURIComponent(new URL(photo.path).pathname.substring(process.platform === 'win32' ? 1 : 0)) : decodeURIComponent(photo.path)
                    if (existsSync(cleanUrl)) {
                        const destPath = join(baseDir, photo.filename)
                        if (params.mirrorOutput) {
                            try {
                                await sharp(cleanUrl).flop().toFile(destPath)
                            } catch (sharpErr) {
                                console.error('Failed to mirror local photo with sharp:', sharpErr)
                                copyFileSync(cleanUrl, destPath)
                            }
                        } else {
                            copyFileSync(cleanUrl, destPath)
                        }
                        savedFiles.push({ path: destPath, filename: photo.filename, mimeType: 'image/jpeg' })
                    } else {
                        console.warn(`Local save: Photo source not found: ${cleanUrl}`)
                    }
                }
            }

            // Copy videos (and compose WebM to MP4 strip)
            if (params.videos.length > 0 && params.frameConfig && params.overlay) {
                try {
                    const overlayUrl = params.overlay.path.startsWith('file:///') ? decodeURIComponent(new URL(params.overlay.path).pathname.substring(process.platform === 'win32' ? 1 : 0)) : decodeURIComponent(params.overlay.path)
                    const stripFilename = `live_video_${params.sessionId}.mp4`
                    const destPath = join(baseDir, stripFilename)

                    const validInputs: { path: string; slot: { width: number; height: number; x: number; y: number; rotation?: number }; index: number }[] = []
                    params.videos.forEach((v, i) => {
                        if (!v.path || !params.frameConfig!.slots[i]) return;
                        const cleanUrl = v.path.startsWith('file:///') ? decodeURIComponent(new URL(v.path).pathname.substring(process.platform === 'win32' ? 1 : 0)) : decodeURIComponent(v.path)
                        if (existsSync(cleanUrl)) {
                            validInputs.push({ path: cleanUrl, slot: params.frameConfig!.slots[i], index: validInputs.length })
                        }
                    })

                    console.log('DEBUG validInputs length:', validInputs.length, 'slots configured:', params.frameConfig?.slots?.length)

                    if (validInputs.length > 0 && existsSync(overlayUrl)) {
                        await new Promise<void>((resolve, reject) => {
                            let command = ffmpeg()

                            // Input 0: Create dynamic blank background
                            command = command.input(`color=c=black@0.0:s=${params.frameConfig!.width}x${params.frameConfig!.height}`)
                                .inputFormat('lavfi')

                            // Inputs 1..N: the videos
                            validInputs.forEach(input => {
                                command = command.input(input.path).inputOption('-stream_loop -1') // loop videos infinitely until shortest ends
                            })

                            // Input N+1: the overlay
                            command = command.input(overlayUrl)

                            // Resolve QR slots list for video
                            let activeQrSlots: { width: number; height: number; x: number; y: number }[] = []
                            if (params.frameConfig!.qrSlots && params.frameConfig!.qrSlots.length > 0) {
                                activeQrSlots = params.frameConfig!.qrSlots
                            } else if ((params.frameConfig as any).qrSlot && (params.frameConfig as any).qrSlot.enabled) {
                                activeQrSlots = [(params.frameConfig as any).qrSlot]
                            }

                            const hasQrSlots = qrCodePath && existsSync(qrCodePath) && activeQrSlots.length > 0
                            if (hasQrSlots) {
                                command = command.input(qrCodePath!)
                            }

                            // Construct complex filter graph
                            let filterGraph = ''

                            // 1. Scale all videos safely and map them (Object-fit: cover behavior + Rotation geometry)
                            const camRot = params.cameraRotation || 0
                            let camRotFilter = ''
                            if (camRot === 90) {
                                camRotFilter = 'transpose=1' // 90 deg CW
                            } else if (camRot === 270) {
                                camRotFilter = 'transpose=2' // 90 deg CCW
                            } else if (camRot === 180) {
                                camRotFilter = 'hflip,vflip' // 180 deg
                            }

                            validInputs.forEach((input, i) => {
                                const w = Math.round(input.slot.width)
                                const h = Math.round(input.slot.height)
                                const rot = input.slot.rotation || 0
                                const rotRad = `(${rot}*PI/180)`

                                // 1. Rotate raw video by camera physical tilt if mounted sideways
                                // 2. Scale video so it fills W x H straight (object-fit: cover)
                                // 3. Apply mirror if requested
                                // 4. Rotate by frame slot rotation
                                const rotFilter = rot ? `rotate=${rotRad}:ow='iw*abs(cos(${rotRad}))+ih*abs(sin(${rotRad}))':oh='iw*abs(sin(${rotRad}))+ih*abs(cos(${rotRad}))':c=black@0.0` : ''

                                let inputPipeline = `[${i + 1}:v]format=yuva420p`
                                if (camRotFilter) {
                                    inputPipeline += `,${camRotFilter}`
                                }
                                inputPipeline += `,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
                                if (params.mirrorOutput) {
                                    inputPipeline += `,hflip`
                                }
                                if (rotFilter) {
                                    inputPipeline += `,${rotFilter}`
                                }
                                filterGraph += `${inputPipeline}[v${i}];`
                            })

                            // 2. Begin overlaying videos onto background [0:v]
                            let lastOverlayNode = '[0:v]'
                            validInputs.forEach((input, i) => {
                                const w = Math.round(input.slot.width)
                                const h = Math.round(input.slot.height)
                                const rot = input.slot.rotation || 0
                                const rotRad = rot * Math.PI / 180

                                // Calculate the newly expanded bounding box width/height of the rotated frame
                                const wRot = w * Math.abs(Math.cos(rotRad)) + h * Math.abs(Math.sin(rotRad))
                                const hRot = w * Math.abs(Math.sin(rotRad)) + h * Math.abs(Math.cos(rotRad))

                                // The origin of the CSS rotated box shifts from the top-left to maintain the same center point
                                const offsetX = (wRot - w) / 2
                                const offsetY = (hRot - h) / 2

                                const finalX = Math.round(input.slot.x - offsetX)
                                const finalY = Math.round(input.slot.y - offsetY)

                                const nextNode = `[bg${i}]`
                                // Use shortest=1 in the FIRST overlay to restrict the infinite duration of lavfi and camera loops to the shortest real video length
                                filterGraph += `${lastOverlayNode}[v${i}]overlay=${finalX}:${finalY}:shortest=${i === 0 ? 1 : 0}${nextNode};`
                                lastOverlayNode = nextNode
                            })

                            // 3. Overlay the final frame image template
                            let finalNode = 'out'
                            if (hasQrSlots) {
                                finalNode = 'bg_with_frame'
                            }
                            filterGraph += `${lastOverlayNode}[${validInputs.length + 1}:v]overlay=0:0[${finalNode}]`

                            if (hasQrSlots) {
                                filterGraph += ';'
                                const qrInputIndex = validInputs.length + 2
                                const numQrSlots = activeQrSlots.length

                                // Split the QR input for reuse in overlaying multiple times
                                filterGraph += `[${qrInputIndex}:v]split=${numQrSlots}`
                                for (let i = 0; i < numQrSlots; i++) {
                                    filterGraph += `[qr_split${i}]`
                                }
                                filterGraph += ';'

                                // Scale and overlay each QR slot
                                let currentLastNode = 'bg_with_frame'
                                for (let i = 0; i < numQrSlots; i++) {
                                    const slot = activeQrSlots[i]
                                    const w = Math.round(slot.width)
                                    const h = Math.round(slot.height)
                                    const x = Math.round(slot.x)
                                    const y = Math.round(slot.y)

                                    // Scale the split QR input
                                    filterGraph += `[qr_split${i}]scale=${w}:${h}[qr_scaled${i}];`

                                    // Overlay scaled QR onto current background
                                    const nextBG = i === numQrSlots - 1 ? 'out' : `bg_qr${i}`
                                    filterGraph += `[${currentLastNode}][qr_scaled${i}]overlay=${x}:${y}[${nextBG}]`
                                    if (i < numQrSlots - 1) {
                                        filterGraph += ';'
                                    }
                                    currentLastNode = nextBG
                                }
                            }

                            command
                                .complexFilter(filterGraph, finalNode)
                                .outputOptions('-c:v libx264')
                                .outputOptions('-preset veryfast')
                                .outputOptions('-crf 28')
                                .outputOptions('-pix_fmt yuv420p')
                                .outputOptions('-movflags +faststart')
                                .outputOptions('-t 5') // Fallback safety limit (5s max)
                                .output(destPath)
                                .on('end', () => {
                                    savedFiles.push({ path: destPath, filename: stripFilename, mimeType: 'video/mp4' })
                                    resolve()
                                })
                                .on('error', (err: Error) => {
                                    console.error('FFmpeg strip conversion error:', err)
                                    // On error, let the frontend know (but we still resolve so photo copying succeeds)
                                    resolve()
                                })
                                .run()
                        })
                    }
                } catch (e) {
                    console.error('Failed to parse paths for video composite', e)
                }
            } else {
                // Fallback to legacy copy (if no frame template available)
                for (const video of params.videos) {
                    // Ignore blob urls since they can't be copied via fs
                    if (video.path.startsWith('blob:')) continue;

                    const cleanUrl = video.path.startsWith('file:///') ? decodeURIComponent(new URL(video.path).pathname.substring(process.platform === 'win32' ? 1 : 0)) : decodeURIComponent(video.path)

                    if (existsSync(cleanUrl)) {
                        // Force final filename to be .mp4 regardless of what frontend thinks
                        const mp4Filename = video.filename.replace(/\.webm$/, '.mp4')
                        const destPath = join(baseDir, mp4Filename)

                        const camRot = params.cameraRotation || 0
                        let camRotFilter = ''
                        if (camRot === 90) {
                            camRotFilter = 'transpose=1'
                        } else if (camRot === 270) {
                            camRotFilter = 'transpose=2'
                        } else if (camRot === 180) {
                            camRotFilter = 'hflip,vflip'
                        }

                        let videoFilter = ''
                        if (camRotFilter) videoFilter = camRotFilter
                        if (params.mirrorOutput) {
                            videoFilter += videoFilter ? ',hflip' : 'hflip'
                        }

                        // If source is mp4 and needs no transformation, copy directly
                        if (cleanUrl.endsWith('.mp4') && !videoFilter) {
                            copyFileSync(cleanUrl, destPath)
                            savedFiles.push({ path: destPath, filename: mp4Filename, mimeType: 'video/mp4' })
                        } else {
                            // Convert/Rotate webm or mp4 using ffmpeg
                            await new Promise<void>((resolve) => {
                                let command = ffmpeg(cleanUrl)
                                    .outputOptions('-c:v libx264')
                                    .outputOptions('-preset veryfast') // speed up conversion
                                    .outputOptions('-crf 28') // acceptable quality, smaller size
                                    .outputOptions('-pix_fmt yuv420p') // maximize compatibility

                                if (videoFilter) {
                                    command = command.outputOptions(`-vf ${videoFilter}`)
                                }

                                command.output(destPath)
                                    .on('end', () => {
                                        savedFiles.push({ path: destPath, filename: mp4Filename, mimeType: 'video/mp4' })
                                        resolve()
                                    })
                                    .on('error', (err: Error) => {
                                        console.error('FFmpeg conversion error:', err)
                                        // Fallback: just copy the original file, rename to .webm
                                        const fallbackDest = join(baseDir, video.filename)
                                        copyFileSync(cleanUrl, fallbackDest)
                                        savedFiles.push({ path: fallbackDest, filename: video.filename, mimeType: 'video/webm' })
                                        resolve() // Don't crash the whole save process
                                    })
                                    .run()
                            })
                        }
                    } else {
                        console.warn(`Local save: Video source not found: ${cleanUrl}`)
                    }
                }
            }

            // Overlay (frame template) is no longer exported as a standalone empty file

            return { success: true, data: savedFiles }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Get local machine IP address for local offline sharing
    ipcMain.handle('system:get-local-ip', async (): Promise<APIResponse<string | null>> => {
        try {
            const ip = getLocalIpAddress()
            return { success: true, data: ip }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message, data: null }
        }
    })

    // Rename session folder to include the email address
    ipcMain.handle('system:rename-session-folder', async (_, params: {
        sessionId: string
        email: string
    }): Promise<APIResponse<string>> => {
        try {
            const sessionsRoot = join(app.getPath('documents'), 'Sebooth', 'Sessions')
            const oldFolder = join(sessionsRoot, `Session_${params.sessionId}`)

            // Sanitize email for use in folder name (replace @ and . with safe chars)
            const safeEmail = params.email.replace(/@/g, '_at_').replace(/[^a-zA-Z0-9._-]/g, '_')
            const newFolderName = `Session_${safeEmail}_${params.sessionId}`
            const newFolder = join(sessionsRoot, newFolderName)

            if (existsSync(oldFolder) && !existsSync(newFolder)) {
                renameSync(oldFolder, newFolder)
                console.log(`Renamed session folder: ${newFolderName}`)
            }

            return { success: true, data: newFolderName }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Find strip file path from session folder (for printing)
    ipcMain.handle('system:find-session-strip', async (_, sessionId: string): Promise<APIResponse<string>> => {
        try {
            const sessionsRoot = join(app.getPath('documents'), 'Sebooth', 'Sessions')
            let sessionPath: string | null = null

            // Try exact match first
            const exactPath = join(sessionsRoot, `Session_${sessionId}`)
            if (existsSync(exactPath)) {
                sessionPath = exactPath
            } else if (existsSync(sessionsRoot)) {
                // Scan for folder ending with the sessionId
                const folders = readdirSync(sessionsRoot)
                const match = folders.find(f => f.startsWith('Session_') && f.endsWith(sessionId))
                if (match) sessionPath = join(sessionsRoot, match)
            }

            if (!sessionPath) {
                return { success: false, error: 'Session folder not found' }
            }

            // Find strip file
            const files = readdirSync(sessionPath)
            const stripFile = files.find(f => f.startsWith('strip_'))
            if (!stripFile) {
                return { success: false, error: 'Strip file not found in session folder' }
            }

            return { success: true, data: join(sessionPath, stripFile) }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })
}
