import { BrowserWindow } from 'electron'
import {
    QueueStatusResponse,
    QueueWebhookPayload,
    QueueWebhookResponse,
    QueueSessionTokenResponse
} from '@shared/types'

/**
 * QueueService — Main Process service for communicating with the
 * Sebooth website queue system (https://www.sebooth.in).
 * 
 * Responsibilities:
 * - Polling GET /api/queue/{eventId}/status every 5 seconds
 * - Sending webhook POST requests (session_started, session_completed)
 * - Generating session tokens for QR code linking
 * - Broadcasting queue status updates to renderer windows
 */
export class QueueService {
    private pollingInterval: NodeJS.Timeout | null = null
    private currentStatus: QueueStatusResponse | null = null
    private apiUrl: string = ''
    private eventId: string = ''
    private secret: string = ''
    private consecutiveFailures: number = 0

    private readonly POLL_INTERVAL_MS = 5000
    private readonly MAX_RETRIES = 3
    private readonly RETRY_BASE_DELAY_MS = 1000

    // ─── Polling ──────────────────────────────────────────────────

    startPolling(eventId: string, secret: string, apiUrl: string): void {
        this.stopPolling()
        this.eventId = eventId
        this.secret = secret
        this.apiUrl = apiUrl.replace(/\/$/, '') // Trim trailing slash
        this.consecutiveFailures = 0

        console.log(`[QueueService] Starting polling for event ${eventId} at ${this.apiUrl}`)

        // Immediate first fetch
        this.pollOnce()

        this.pollingInterval = setInterval(() => {
            this.pollOnce()
        }, this.POLL_INTERVAL_MS)
    }

    stopPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
            this.pollingInterval = null
        }
        this.currentStatus = null
        this.consecutiveFailures = 0
        console.log('[QueueService] Polling stopped')
    }

    isPolling(): boolean {
        return this.pollingInterval !== null
    }

    getStatus(): QueueStatusResponse | null {
        return this.currentStatus
    }

    // ─── Webhook ──────────────────────────────────────────────────

    async sendWebhook(payload: QueueWebhookPayload): Promise<QueueWebhookResponse> {
        const url = `${this.apiUrl}/api/queue/webhook`
        console.log(`[QueueService] Sending webhook: ${payload.event}`, payload)

        const response = await this.fetchWithRetry(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': this.secret
            },
            body: JSON.stringify(payload)
        })

        const data = await response.json()
        console.log(`[QueueService] Webhook response:`, data)
        return data as QueueWebhookResponse
    }

    // ─── Session Token ────────────────────────────────────────────

    async generateSessionToken(eventId: string, sessionId: string): Promise<QueueSessionTokenResponse> {
        const url = `${this.apiUrl}/api/queue/generate-session-token`
        console.log(`[QueueService] Generating session token for event=${eventId}, session=${sessionId}`)

        const response = await this.fetchWithRetry(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': this.secret
            },
            body: JSON.stringify({ event_id: eventId, session_id: sessionId })
        })

        const data = await response.json()
        console.log(`[QueueService] Session token response:`, data)
        return data as QueueSessionTokenResponse
    }

    async operatorAction(eventId: string, action: 'call_next' | 'cancel_ticket', ticketId?: string): Promise<any> {
        const url = `${this.apiUrl}/api/queue/operator/action`
        console.log(`[QueueService] Operator action: ${action} for event=${eventId}`)

        const response = await this.fetchWithRetry(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': this.secret
            },
            body: JSON.stringify({ eventId, action, ticketId })
        })

        const data = await response.json()
        console.log(`[QueueService] Operator action response:`, data)
        return data
    }

    // ─── Internal ─────────────────────────────────────────────────

    private async pollOnce(): Promise<void> {
        try {
            const url = `${this.apiUrl}/api/queue/${this.eventId}/status`
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(8000) // 8 second timeout
            })

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const data = (await response.json()) as QueueStatusResponse
            this.currentStatus = data
            this.consecutiveFailures = 0

            // Broadcast to all renderer windows
            this.broadcastToRenderer('queue:status-update', {
                status: data,
                connected: true,
                error: null
            })
        } catch (error: any) {
            this.consecutiveFailures++
            const errorMsg = error?.message || 'Unknown polling error'
            console.error(`[QueueService] Poll failed (${this.consecutiveFailures}x):`, errorMsg)

            this.broadcastToRenderer('queue:status-update', {
                status: this.currentStatus,
                connected: false,
                error: `Koneksi gagal: ${errorMsg}`
            })
        }
    }

    private async fetchWithRetry(url: string, options: RequestInit, retries = this.MAX_RETRIES): Promise<Response> {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: AbortSignal.timeout(10000) // 10 second timeout
                })

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
                }

                return response
            } catch (error: any) {
                const isLastAttempt = attempt === retries
                if (isLastAttempt) {
                    console.error(`[QueueService] All ${retries + 1} attempts failed for ${url}`)
                    throw error
                }

                const delay = this.RETRY_BASE_DELAY_MS * Math.pow(2, attempt) // 1s, 2s, 4s
                console.warn(`[QueueService] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }

        // Should never reach here
        throw new Error('fetchWithRetry exhausted')
    }

    private broadcastToRenderer(channel: string, data: any): void {
        try {
            const windows = BrowserWindow.getAllWindows()
            for (const win of windows) {
                if (!win.isDestroyed()) {
                    win.webContents.send(channel, data)
                }
            }
        } catch (error) {
            console.error('[QueueService] Failed to broadcast:', error)
        }
    }
}

// Singleton export
export const queueService = new QueueService()
