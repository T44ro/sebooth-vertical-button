import { ipcMain } from 'electron'
import { queueService } from '../services/QueueService'
import { QueueWebhookPayload } from '@shared/types'

/**
 * Register all Queue-related IPC handlers.
 * These bridge the Renderer process to the QueueService in Main.
 */
export function registerQueueHandlers(): void {
    // Start polling queue status
    ipcMain.handle('queue:start-polling', (_, config: {
        eventId: string
        secret: string
        apiUrl: string
    }) => {
        try {
            queueService.startPolling(config.eventId, config.secret, config.apiUrl)
            return { success: true }
        } catch (error: any) {
            console.error('[queue.ipc] Failed to start polling:', error)
            return { success: false, error: error.message }
        }
    })

    // Stop polling
    ipcMain.handle('queue:stop-polling', () => {
        try {
            queueService.stopPolling()
            return { success: true }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    // Get current queue status (synchronous snapshot)
    ipcMain.handle('queue:get-status', () => {
        try {
            const status = queueService.getStatus()
            return { success: true, data: status }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    // Send session_started webhook
    ipcMain.handle('queue:send-session-started', async (_, payload: QueueWebhookPayload) => {
        try {
            const result = await queueService.sendWebhook({
                ...payload,
                event: 'session_started'
            })
            return { success: true, data: result }
        } catch (error: any) {
            console.error('[queue.ipc] session_started webhook failed:', error)
            return { success: false, error: error.message }
        }
    })

    // Send session_completed webhook
    ipcMain.handle('queue:send-session-completed', async (_, payload: QueueWebhookPayload) => {
        try {
            const result = await queueService.sendWebhook({
                ...payload,
                event: 'session_completed'
            })
            return { success: true, data: result }
        } catch (error: any) {
            console.error('[queue.ipc] session_completed webhook failed:', error)
            return { success: false, error: error.message }
        }
    })

    // Auto-skip ticket on expiration
    ipcMain.handle('queue:skip-ticket', async (_, payload: { eventId: string, ticketId?: string }) => {
        try {
            const result = await queueService.operatorAction(payload.eventId, 'call_next', payload.ticketId)
            return { success: true, data: result }
        } catch (error: any) {
            console.error('[queue.ipc] skip-ticket failed:', error)
            return { success: false, error: error.message }
        }
    })

    // Generate session token for QR code
    ipcMain.handle('queue:generate-token', async (_, params: {
        eventId: string
        sessionId: string
    }) => {
        try {
            const result = await queueService.generateSessionToken(params.eventId, params.sessionId)
            return { success: true, data: result }
        } catch (error: any) {
            console.error('[queue.ipc] generate-token failed:', error)
            return { success: false, error: error.message }
        }
    })

    console.log('[queue.ipc] All queue IPC handlers registered.')
}
