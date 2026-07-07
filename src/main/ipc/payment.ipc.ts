import { IpcMain } from 'electron'
import crypto from 'crypto'
import { configService } from '../services/ConfigService'

// Helper to generate signature according to Doku specification
function generateDokuSignature(
    method: 'POST' | 'GET',
    target: string,
    body: string,
    timestamp: string,
    requestId: string,
    config: any
): string {
    const clientId = config.dokuClientId
    const secretKey = config.dokuSecretKey

    let stringToSign = [
        `Client-Id:${clientId}`,
        `Request-Id:${requestId}`,
        `Request-Timestamp:${timestamp}`,
        `Request-Target:${target}`
    ].join('\n')

    if (method === 'POST' && body) {
        const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64')
        stringToSign += `\nDigest:${digest}`
    }

    const signature = crypto.createHmac('sha256', secretKey)
        .update(stringToSign)
        .digest('base64')

    return `HMACSHA256=${signature}`
}

export function registerPaymentHandlers(ipcMain: IpcMain): void {
    // 1. Create Doku Checkout Session
    ipcMain.handle('payment:doku-create-session', async (_, params: { orderId: string; amount: number }) => {
        const config = configService.getConfig()
        
        if (!config.dokuClientId || !config.dokuSecretKey) {
            return {
                success: false,
                error: 'DOKU Client ID atau Secret Key belum dikonfigurasi di Admin Panel.'
            }
        }

        const baseUrl = config.dokuSandbox 
            ? 'https://api-sandbox.doku.com' 
            : 'https://api.doku.com'
            
        const target = '/checkout/v1/payment'
        const url = `${baseUrl}${target}`

        const requestBody = {
            order: {
                invoice_number: params.orderId,
                amount: params.amount,
                line_items: [
                    {
                        name: 'Sebooth Photobooth Session',
                        price: params.amount,
                        quantity: 1
                    }
                ],
                callback_url: 'https://doku.com'
            },
            payment: {
                payment_due_date: 60,
                payment_method_types: ['QRIS']
            }
        }

        const bodyString = JSON.stringify(requestBody)
        const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z') // ISO format YYYY-MM-DDTHH:mm:ssZ
        const requestId = crypto.randomUUID()
        
        const signature = generateDokuSignature('POST', target, bodyString, timestamp, requestId, config)

        try {
            console.log(`[doku.ipc] Creating checkout session for order ${params.orderId}, amount: ${params.amount}...`)
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Client-Id': config.dokuClientId,
                    'Request-Id': requestId,
                    'Request-Timestamp': timestamp,
                    'Signature': signature,
                    'Content-Type': 'application/json'
                },
                body: bodyString
            })

            const data: any = await response.json()
            
            if (response.ok && data.response?.payment?.url) {
                console.log(`[doku.ipc] Checkout session created successfully. URL: ${data.response.payment.url}`)
                return {
                    success: true,
                    data: {
                        paymentUrl: data.response.payment.url,
                        invoiceNumber: params.orderId
                    }
                }
            } else {
                console.error('[doku.ipc] Doku API error response:', data)
                return {
                    success: false,
                    error: data.message || (data.error && data.error.message) || 'Gagal membuat sesi pembayaran DOKU'
                }
            }
        } catch (error: any) {
            console.error('[doku.ipc] Doku session creation network error:', error)
            return {
                success: false,
                error: error.message
            }
        }
    })

    // 2. Check Doku Checkout Payment Status
    ipcMain.handle('payment:doku-check-status', async (_, params: { invoiceNumber: string }) => {
        const config = configService.getConfig()
        
        if (!config.dokuClientId || !config.dokuSecretKey) {
            return {
                success: false,
                error: 'DOKU Client ID atau Secret Key belum dikonfigurasi.'
            }
        }

        const baseUrl = config.dokuSandbox 
            ? 'https://api-sandbox.doku.com' 
            : 'https://api.doku.com'
            
        const target = `/orders/v1/status/${params.invoiceNumber}`
        const url = `${baseUrl}${target}`

        const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
        const requestId = crypto.randomUUID()
        
        const signature = generateDokuSignature('GET', target, '', timestamp, requestId, config)

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Client-Id': config.dokuClientId,
                    'Request-Id': requestId,
                    'Request-Timestamp': timestamp,
                    'Signature': signature
                }
            })

            const data: any = await response.json()
            
            if (response.ok && data.transaction) {
                const status = data.transaction.status
                console.log(`[doku.ipc] Order ${params.invoiceNumber} status checked: ${status}`)
                return {
                    success: true,
                    data: {
                        status: status, // PENDING, SUCCESS, FAILED
                        raw: data
                    }
                }
            } else {
                console.error('[doku.ipc] Doku check status error:', data)
                return {
                    success: false,
                    error: data.message || 'Gagal memeriksa status pembayaran DOKU'
                }
            }
        } catch (error: any) {
            console.error('[doku.ipc] Doku check status network error:', error)
            return {
                success: false,
                error: error.message
            }
        }
    })

    console.log('[payment.ipc] Doku payment IPC handlers registered.')
}
