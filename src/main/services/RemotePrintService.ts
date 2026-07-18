import http from 'http'
import https from 'https'
import { URL } from 'url'

export interface RemotePrintRequest {
    imageData: string      // base64 data URL
    copies: number
    sessionId: string
    deviceName: string
}

export interface RemotePrintResponse {
    success: boolean
    jobId?: string
    error?: string
}

export interface PrintServerStatus {
    online: boolean
    printerName?: string
    printerConnected?: boolean
    queueLength?: number
    error?: string
}

/**
 * RemotePrintService — Sends print jobs to a remote Sebooth Print Server over LAN.
 * Used by Device B (Print Client) to print on Device A's (Print Server) physically connected printer.
 */
export class RemotePrintService {
    private serverUrl: string = ''

    public setServerUrl(url: string): void {
        // Normalize: remove trailing slash
        this.serverUrl = url.replace(/\/+$/, '')
    }

    /**
     * Send a print job to the remote print server
     */
    public async sendPrintJob(request: RemotePrintRequest): Promise<RemotePrintResponse> {
        if (!this.serverUrl) {
            return { success: false, error: 'Print Server URL not configured' }
        }

        const endpoint = `${this.serverUrl}/api/remote-print`
        console.log(`[RemotePrintService] Sending print job to ${endpoint}`)
        console.log(`[RemotePrintService] Session: ${request.sessionId}, Device: ${request.deviceName}, Copies: ${request.copies}`)

        try {
            const result = await this.httpPost(endpoint, request)
            console.log(`[RemotePrintService] Response:`, result)
            return result
        } catch (err: any) {
            console.error(`[RemotePrintService] Failed to send print job:`, err)

            // Retry once after 1 second
            console.log(`[RemotePrintService] Retrying in 1 second...`)
            await new Promise(resolve => setTimeout(resolve, 1000))

            try {
                const retryResult = await this.httpPost(endpoint, request)
                console.log(`[RemotePrintService] Retry response:`, retryResult)
                return retryResult
            } catch (retryErr: any) {
                console.error(`[RemotePrintService] Retry also failed:`, retryErr)
                return {
                    success: false,
                    error: `Gagal mengirim ke Print Server: ${retryErr.message || 'Connection failed'}`
                }
            }
        }
    }

    /**
     * Check if the remote print server is online and ready
     */
    public async checkServerStatus(): Promise<PrintServerStatus> {
        if (!this.serverUrl) {
            return { online: false, error: 'Print Server URL not configured' }
        }

        const endpoint = `${this.serverUrl}/api/remote-print/status`
        console.log(`[RemotePrintService] Checking print server status at ${endpoint}`)

        try {
            const result = await this.httpGet(endpoint, 5000) // 5s timeout for health check
            return result
        } catch (err: any) {
            console.error(`[RemotePrintService] Health check failed:`, err)
            return {
                online: false,
                error: `Tidak dapat terhubung ke Print Server: ${err.message || 'Connection refused'}`
            }
        }
    }

    /**
     * HTTP POST helper using native Node.js http/https
     */
    private httpPost(url: string, body: any, timeoutMs: number = 30000): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const parsed = new URL(url)
                const isHttps = parsed.protocol === 'https:'
                const transport = isHttps ? https : http

                const postData = JSON.stringify(body)

                const options = {
                    hostname: parsed.hostname,
                    port: parsed.port || (isHttps ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: timeoutMs
                }

                const req = transport.request(options, (res) => {
                    let data = ''
                    res.on('data', (chunk) => { data += chunk })
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data)
                            resolve(json)
                        } catch {
                            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`))
                        }
                    })
                })

                req.on('error', (err) => reject(err))
                req.on('timeout', () => {
                    req.destroy()
                    reject(new Error('Request timed out'))
                })

                req.write(postData)
                req.end()
            } catch (err) {
                reject(err)
            }
        })
    }

    /**
     * HTTP GET helper
     */
    private httpGet(url: string, timeoutMs: number = 10000): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const parsed = new URL(url)
                const isHttps = parsed.protocol === 'https:'
                const transport = isHttps ? https : http

                const options = {
                    hostname: parsed.hostname,
                    port: parsed.port || (isHttps ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: 'GET',
                    timeout: timeoutMs
                }

                const req = transport.request(options, (res) => {
                    let data = ''
                    res.on('data', (chunk) => { data += chunk })
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data)
                            resolve(json)
                        } catch {
                            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`))
                        }
                    })
                })

                req.on('error', (err) => reject(err))
                req.on('timeout', () => {
                    req.destroy()
                    reject(new Error('Request timed out'))
                })

                req.end()
            } catch (err) {
                reject(err)
            }
        })
    }
}

// Singleton
export const remotePrintService = new RemotePrintService()
