import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'

/**
 * Mock Camera Handler for Development/Testing
 * Uses sample images instead of actual camera capture
 */
export class MockCamera extends CameraHandler {
    private mockImagePath: string | null = null
    private captureCount: number = 0

    constructor(mockImagePath?: string) {
        super()
        this.mockImagePath = mockImagePath || null
    }

    async listCameras(): Promise<CameraDevice[]> {
        // Return a mock camera for development
        return [
            {
                id: 'mock_camera_1',
                name: 'Mock Camera (Development)',
                port: 'VIRTUAL',
                connected: false
            },
            {
                id: 'mock_camera_2',
                name: 'Mock Fujifilm XS10',
                port: 'VIRTUAL',
                connected: false
            }
        ]
    }

    async connect(cameraId: string): Promise<boolean> {
        const cameras = await this.listCameras()
        const camera = cameras.find(c => c.id === cameraId)

        if (camera) {
            this.currentCamera = { ...camera, connected: true }
            this.connected = true
            console.log(`[MockCamera] Connected to ${camera.name}`)
            return true
        }
        return false
    }

    async disconnect(): Promise<void> {
        console.log('[MockCamera] Disconnected')
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

        // Simulate capture delay
        await new Promise(resolve => setTimeout(resolve, 500))

        try {
            // Ensure output directory exists
            const dir = join(outputPath, '..')
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            // If a mock image is provided, copy it to the output path
            if (this.mockImagePath && existsSync(this.mockImagePath)) {
                copyFileSync(this.mockImagePath, outputPath)
            } else {
                // Write a tiny 1x1 valid JPEG to prevent broken image icons
                const dummyJpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
                const buffer = Buffer.from(dummyJpegBase64, 'base64')
                require('fs').writeFileSync(outputPath, buffer)
                console.log(`[MockCamera] Captured dummy image to: ${outputPath}`)
            }

            this.captureCount++

            return {
                success: true,
                imagePath: outputPath,
                timestamp: Date.now()
            }
        } catch (error) {
            const err = error as Error
            return {
                success: false,
                error: err.message,
                timestamp: Date.now()
            }
        }
    }

    /**
     * Set a mock image to use for captures
     */
    setMockImage(imagePath: string): void {
        this.mockImagePath = imagePath
    }

    /**
     * Get the number of captures made
     */
    getCaptureCount(): number {
        return this.captureCount
    }
}
