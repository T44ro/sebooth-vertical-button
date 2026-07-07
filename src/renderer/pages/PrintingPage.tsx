import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSessionStore, useAppConfig, useQueueStore } from '../stores'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './PrintingPage.module.css'
// Note: You must place 'printing_animation.mov' (or .mp4) in the src/renderer/assets folder 
// or update this path to the correct asset later.
// We'll use a placeholder variable for now.
import PrintingAnimation from '../assets/printing_animation.mp4'

function PrintingPage(): JSX.Element {
    const navigate = useNavigate()
    const location = useLocation()
    const { currentSession, endSession } = useSessionStore()
    const { config } = useAppConfig()
    const { activeTicketNumber, reset: resetQueue } = useQueueStore()
    
    const getHomeRoute = () => (config.queueEnabled && config.queueEventId) ? '/queue' : '/'
    
    const sendSessionCompletedAndGoHome = async () => {
        // Send session_completed webhook if in queue mode
        if (config.queueEnabled && config.queueEventId && activeTicketNumber) {
            try {
                await (window as any).api.queue.sendSessionCompleted({
                    event_id: config.queueEventId,
                    ticket_number: activeTicketNumber,
                    session_id: currentSession?.id
                })
                console.log('[PrintingPage] session_completed webhook sent')
            } catch (err) {
                console.error('[PrintingPage] session_completed webhook failed:', err)
            }
            resetQueue()
        }
        endSession()
        navigate(getHomeRoute())
    }
    
    const [error, setError] = useState<string | null>(null)
    const [printCompleted, setPrintCompleted] = useState(false)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const hasStartedPrinting = useRef(false)

    // Get print quantity from navigation state, default to 2
    const printQuantity = location.state?.printQuantity || 2
    
    console.log('[PrintingPage] Navigation state:', location.state)
    console.log('[PrintingPage] Print quantity:', printQuantity)

    useEffect(() => {
        console.log('[PrintingPage] Component mounted')
        console.log('[PrintingPage] currentSession:', currentSession)
        console.log('[PrintingPage] compositePath:', currentSession?.compositePath)
        
        if (!printCompleted && (!currentSession || !currentSession.compositePath)) {
            console.log('[PrintingPage] Missing session or composite path, navigating home')
            navigate('/')
            return
        }

        // Prevent double printing in React Strict Mode
        if (!hasStartedPrinting.current) {
            console.log('[PrintingPage] Starting print process...')
            hasStartedPrinting.current = true
            handlePrint()
        } else {
            console.log('[PrintingPage] Print already started, skipping')
        }
    }, [currentSession?.compositePath, navigate])

    const handlePrint = async () => {
        setError(null)

        console.log('[PrintingPage] Starting print process...')
        console.log('[PrintingPage] window.api available:', !!(window as any).api)
        console.log('[PrintingPage] window.api.printer available:', !!(window as any).api?.printer)
        console.log('[PrintingPage] window.api.printer.printWithOptions available:', typeof (window as any).api?.printer?.printWithOptions)
        
        console.log('[PrintingPage] Config:', config)
        console.log('[PrintingPage] Printer enabled:', config.printerEnabled)
        console.log('[PrintingPage] Printer name:', config.printerName)

        // Check if printing is enabled
        if (!config.printerEnabled) {
            console.log('[PrintingPage] Printing is disabled, skipping...')
            setError('Printing is disabled in settings')
            setTimeout(() => {
                sendSessionCompletedAndGoHome()
            }, 3000)
            return
        }

        // Check if printer is selected
        if (!config.printerName) {
            console.log('[PrintingPage] No printer selected, skipping...')
            setError('No printer selected in settings')
            setTimeout(() => {
                sendSessionCompletedAndGoHome()
            }, 3000)
            return
        }

        try {
            // Find strip in session folder
            let stripPath: string | null = null
            try {
                const findResult = await (window as any).api.system.findSessionStrip(currentSession!.id)
                if (findResult.success && findResult.data) {
                    stripPath = findResult.data
                }
            } catch { /* ignore, use fallback */ }

            // Fallback: use the base64 composite we have in state
            if (!stripPath && currentSession?.compositePath) {
                const saveResult = await (window as any).api.system.saveDataUrl(
                    currentSession.compositePath,
                    `strip_${currentSession.id}.jpg`
                )
                if (saveResult.success && saveResult.data) {
                    stripPath = saveResult.data
                }
            }

            const compositeDataUrl = currentSession?.compositePath
            if (compositeDataUrl) {
                // Use the selected print quantity
                const copies = Math.max(1, Math.round(printQuantity / 2))
                
                console.log(`[PrintingPage] Printing ${copies} copies to printer: ${config.printerName}`)
                console.log('[PrintingPage] Using compositePath length:', compositeDataUrl.length)
                
                // This promise resolves when the OS print spooler accepts the job
                console.log('[PrintingPage] Calling window.api.printer.printWithOptions...')
                const result = await (window as any).api.printer.printWithOptions({
                    printerName: config.printerName,
                    data: compositeDataUrl,
                    copies,
                    options: {}
                })
                
                console.log('[PrintingPage] Print result:', result)
                
                if (!result.success) {
                    setError(result.error || 'Print failed')
                    // If print fails, wait a bit so user can read the error, then go home
                    setTimeout(() => {
                        endSession()
                        navigate('/')
                    }, 5000)
                } else {
                    // Success! Mark as completed and go home
                    setPrintCompleted(true)
                    sendSessionCompletedAndGoHome()
                }
            } else {
                setError('Failed to find or save strip for printing')
                setTimeout(() => {
                    endSession()
                    navigate('/')
                }, 5000)
            }
        } catch (err) {
            setError('Print failed: ' + (err as Error).message)
            setTimeout(() => {
                sendSessionCompletedAndGoHome()
            }, 5000)
        }
    }

    const handleBackHome = () => {
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBackHome = () => {
        sendSessionCompletedAndGoHome()
    }

    return (
        <div className={styles.container}>
            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBackHome}
            />
            {/* 
                We use an HTML5 video tag. 
                autoPlay, loop, muted ensures it plays automatically in the background 
            */}
            <video 
                className={styles.videoBackground}
                autoPlay 
                loop 
                muted 
                playsInline
                // Fallback gracefully if asset is missing during dev
                onError={(e) => console.log('Video error:', e)}
            >
                <source src={PrintingAnimation} type="video/mp4" />
                {/* Add .mov support if needed */}
                {/* <source src={PrintingAnimationMov} type="video/quicktime" /> */}
            </video>

            <div className={styles.overlay}></div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <div className={styles.content}>
                <h1 className={styles.title}>Printing Your Memories</h1>
                <p className={styles.subtitle}>Please wait a moment while your photos are being printed...</p>
                <div className={styles.loadingSpinner}></div>
            </div>
        </div>
    )
}

export default PrintingPage
