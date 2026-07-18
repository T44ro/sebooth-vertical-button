import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { printerHandler } from '../handlers/PrinterHandler'

export interface PrintJob {
    id: string
    sessionId: string
    filePath: string
    printerName: string
    copies: number
    status: 'QUEUED' | 'PRINTING' | 'COMPLETED' | 'FAILED'
    createdAt: number
    completedAt?: number
    errorMessage?: string
    sourceDevice?: string // e.g. 'Booth A', 'Booth B' — identifies which device sent the job
}

export class PrintQueueService {
    private queue: PrintJob[] = []
    private history: PrintJob[] = []
    private isProcessing: boolean = false
    private historyPath: string

    constructor() {
        const userDataPath = app.getPath('userData')
        this.historyPath = path.join(userDataPath, 'sebooth_print_history.json')
        this.loadHistory()
    }

    private loadHistory() {
        try {
            if (fs.existsSync(this.historyPath)) {
                const data = fs.readFileSync(this.historyPath, 'utf8')
                this.history = JSON.parse(data)
                
                // Keep only the last 500 history items to prevent unbounded file growth
                if (this.history.length > 500) {
                    this.history = this.history.slice(-500)
                }
            }
        } catch (e) {
            console.error('[PrintQueueService] Failed to load history:', e)
        }
    }

    private saveHistory() {
        try {
            fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf8')
        } catch (e) {
            console.error('[PrintQueueService] Failed to save history:', e)
        }
    }

    public addJob(sessionId: string, filePath: string, printerName: string, copies: number = 1, sourceDevice?: string): PrintJob {
        const job: PrintJob = {
            id: `print_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            sessionId,
            filePath,
            printerName,
            copies,
            status: 'QUEUED',
            createdAt: Date.now(),
            sourceDevice: sourceDevice || 'Local'
        }
        
        this.queue.push(job)
        console.log(`[PrintQueueService] Job ${job.id} added to queue.`)
        console.log(`[PrintQueueService] Queue length: ${this.queue.length}`)
        console.log(`[PrintQueueService] Job details:`, job)
        
        // Broadcast via WebContents
        this.broadcastState()

        // Kick off processing if idle
        if (!this.isProcessing) {
            this.processQueue()
        }

        return job
    }

    public getQueue(): PrintJob[] {
        return [...this.queue]
    }

    public getHistory(): PrintJob[] {
        return [...this.history]
    }

    private broadcastState() {
        try {
            const windows = require('electron').BrowserWindow.getAllWindows()
            for (const win of windows) {
                win.webContents.send('printer:queue-updated', this.queue)
                win.webContents.send('printer:history-updated', this.history)
            }
        } catch (e) {
            // Ignore if invoked outside proper context
        }
    }

    private async processQueue() {
        if (this.queue.length === 0) {
            console.log('[PrintQueueService] Queue is empty, stopping processing')
            this.isProcessing = false
            return
        }

        this.isProcessing = true
        const job = this.queue[0] // take the first
        job.status = 'PRINTING'
        this.broadcastState()

        console.log(`[PrintQueueService] Processing job ${job.id}...`)
        console.log(`[PrintQueueService] Job details:`, job)

        try {
            const result = await printerHandler.print(job.filePath, job.printerName, job.copies)
            
            console.log(`[PrintQueueService] Print result for job ${job.id}:`, result)
            
            job.completedAt = Date.now()
            if (result.success) {
                job.status = 'COMPLETED'
            } else {
                job.status = 'FAILED'
                job.errorMessage = result.error
            }
        } catch (err: any) {
            console.log(`[PrintQueueService] Exception during print job ${job.id}:`, err)
            job.status = 'FAILED'
            job.completedAt = Date.now()
            job.errorMessage = err.message
        }

        console.log(`[PrintQueueService] Job ${job.id} finished with status: ${job.status}`)

        // Move to history
        this.queue.shift() // remove from queue
        this.history.unshift(job) // add to front of history
        
        // Enforce limit
        if (this.history.length > 500) {
            this.history = this.history.slice(0, 500)
        }
        this.saveHistory()
        this.broadcastState()

        // Give Spooler a tiny 1s breath, then process next
        setTimeout(() => {
            this.processQueue()
        }, 1000)
    }
}

export const printQueueService = new PrintQueueService()
