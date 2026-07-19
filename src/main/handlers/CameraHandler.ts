import { CameraDevice, CaptureResult } from '@shared/types'

/**
 * Abstract Camera Handler Interface
 * This modular design allows swapping camera drivers without changing application code.
 * Implement this interface for different camera systems (digiCamControl, gPhoto2, etc.)
 */
export abstract class CameraHandler {
    protected connected: boolean = false
    protected currentCamera: CameraDevice | null = null

    /**
     * List all available cameras connected via USB
     */
    abstract listCameras(): Promise<CameraDevice[]>

    /**
     * Connect to a specific camera by ID
     */
    abstract connect(cameraId: string): Promise<boolean>

    /**
     * Disconnect from the current camera
     */
    abstract disconnect(): Promise<void>

    /**
     * Capture a photo and save to the specified path
     * This should trigger the physical shutter of the camera
     */
    abstract capture(outputPath: string, options?: any): Promise<CaptureResult>

    /**
     * Get the current connection status
     */
    isConnected(): boolean {
        return this.connected
    }

    /**
     * Get the currently connected camera
     */
    getCurrentCamera(): CameraDevice | null {
        return this.currentCamera
    }
}
