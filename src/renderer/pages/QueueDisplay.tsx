import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import QRCode from 'react-qr-code'
import { useAppConfig, useQueueStore, useFrameStore, useSessionStore } from '../stores'
import styles from './QueueDisplay.module.css'

const ADMIN_PASSWORD = 'admin123'
const TICKET_TIMEOUT_SEC = 300 // 5 minutes
const QR_DISPLAY_SEC = 60 // 60 seconds QR display

function QueueDisplay(): JSX.Element {
    const navigate = useNavigate()
    const { config } = useAppConfig()
    const { frames, setActiveFrame } = useFrameStore()
    const { startSession, currentSession } = useSessionStore()
    const {
        isConnected,
        queueStatus,
        currentTicket,
        connectionError,
        setPolling,
        setConnected,
        setQueueStatus,
        setConnectionError,
        setActiveTicket
    } = useQueueStore()

    // ── Local State ──
    const [showAdminModal, setShowAdminModal] = useState(false)
    const [adminPassword, setAdminPassword] = useState('')
    const [passwordError, setPasswordError] = useState(false)
    const [holdProgress, setHoldProgress] = useState(0)
    const [holdTimer, setHoldTimer] = useState<any | null>(null)

    // Called state
    const [ticketTimeRemaining, setTicketTimeRemaining] = useState(TICKET_TIMEOUT_SEC)
    const ticketTimerRef = useRef<NodeJS.Timeout | null>(null)

    // QR overlay state (Fase 2)
    const [showQR, setShowQR] = useState(false)
    const [qrUrl, setQrUrl] = useState<string | null>(null)
    const [qrCountdown, setQrCountdown] = useState(QR_DISPLAY_SEC)
    const qrTimerRef = useRef<NodeJS.Timeout | null>(null)
    const [isStartingSession, setIsStartingSession] = useState(false)

    // ── Start/Stop Polling on mount/unmount ──
    useEffect(() => {
        if (config.queueEnabled && config.queueEventId) {
            const windowApi = (window as any).api
            windowApi.queue.startPolling({
                eventId: config.queueEventId,
                secret: config.queueWebhookSecret,
                apiUrl: config.queueApiUrl
            })
            setPolling(true)

            // Listen for status updates from Main Process
            const unsubscribe = windowApi.queue.onStatusUpdate((data: {
                status: any
                connected: boolean
                error: string | null
            }) => {
                setConnected(data.connected)
                setQueueStatus(data.status)
                setConnectionError(data.error)
            })

            return () => {
                unsubscribe()
                windowApi.queue.stopPolling()
                setPolling(false)
            }
        }
    }, [config.queueEnabled, config.queueEventId, config.queueWebhookSecret, config.queueApiUrl])

    // ── Ticket Timeout Timer (when called) ──
    useEffect(() => {
        if (currentTicket?.status === 'called') {
            const updateTimer = () => {
                if (!currentTicket.expires_at) {
                    setTicketTimeRemaining(TICKET_TIMEOUT_SEC)
                    return false
                }
                const expires = new Date(currentTicket.expires_at).getTime()
                const now = Date.now()
                const remainingSecs = Math.max(0, Math.floor((expires - now) / 1000))
                setTicketTimeRemaining(remainingSecs)

                if (remainingSecs <= 0) {
                    return true // Timeout reached
                }
                return false
            }

            // Initial check
            if (updateTimer()) {
                console.log('[QueueDisplay] Ticket expired on load, skipping...')
                const windowApi = (window as any).api
                windowApi.queue.skipTicket({ eventId: config.queueEventId, ticketId: currentTicket.id })
                return
            }

            ticketTimerRef.current = setInterval(() => {
                setTicketTimeRemaining(prev => {
                    const newTime = prev - 1
                    if (newTime <= 0) {
                        if (ticketTimerRef.current) clearInterval(ticketTimerRef.current)
                        console.log('[QueueDisplay] Ticket timeout — auto-skipping')
                        const windowApi = (window as any).api
                        windowApi.queue.skipTicket({ eventId: config.queueEventId, ticketId: currentTicket.id })
                        return 0
                    }
                    return newTime
                })
            }, 1000)

            return () => {
                if (ticketTimerRef.current) clearInterval(ticketTimerRef.current)
            }
        }
    }, [currentTicket?.status, currentTicket?.id, currentTicket?.expires_at, config.queueEventId])

    // ── QR Countdown Timer ──
    useEffect(() => {
        if (showQR) {
            setQrCountdown(QR_DISPLAY_SEC)

            qrTimerRef.current = setInterval(() => {
                setQrCountdown(prev => {
                    if (prev <= 1) {
                        if (qrTimerRef.current) clearInterval(qrTimerRef.current)
                        // Auto-dismiss QR and proceed to frames
                        handleQRDismiss()
                        return 0
                    }
                    return prev - 1
                })
            }, 1000)

            return () => {
                if (qrTimerRef.current) clearInterval(qrTimerRef.current)
            }
        }
    }, [showQR])

    // ── Handlers ──

    const handleStartSession = async () => {
        if (!currentTicket || isStartingSession) return
        setIsStartingSession(true)

        try {
            const windowApi = (window as any).api

            // 1. Initialize a photo session in the Zustand store
            const frameId = config.activeFrameId || (config.activeFrameIds?.[0]) || (frames.length > 0 ? frames[0].id : '')
            if (frameId) {
                setActiveFrame(frameId)
            }
            startSession(frameId)

            // 2. Store active ticket info
            setActiveTicket(currentTicket.queue_number, currentTicket.id)

            // 3. Generate session token for QR (no longer sending webhook here)
            const sessionId = useSessionStore.getState().currentSession?.id
            if (sessionId) {
                const tokenResult = await windowApi.queue.generateToken({
                    eventId: config.queueEventId,
                    sessionId: sessionId
                })

                if (tokenResult.success && tokenResult.data?.qrUrl) {
                    setQrUrl(tokenResult.data.qrUrl)
                    setShowQR(true)
                } else {
                    // If token generation fails, proceed directly to frames
                    console.warn('[QueueDisplay] Token generation failed, proceeding without QR')
                    await handleQRDismiss() // Changed to call handleQRDismiss to ensure webhook fires
                }
            } else {
                await handleQRDismiss() // Changed to call handleQRDismiss
            }
        } catch (error) {
            console.error('[QueueDisplay] Failed to start session:', error)
            // Still proceed to frames even if webhook fails
            await handleQRDismiss() // Changed to call handleQRDismiss
        } finally {
            setIsStartingSession(false)
        }
    }

    const handleQRDismiss = async () => {
        setShowQR(false)
        setQrUrl(null)
        if (qrTimerRef.current) clearInterval(qrTimerRef.current)

        const windowApi = (window as any).api
        try {
            // Send session_started webhook NOW, after QR is dismissed
            if (currentTicket && config.queueEventId) {
                await windowApi.queue.sendSessionStarted({
                    event_id: config.queueEventId,
                    ticket_number: currentTicket.queue_number
                })
                console.log('[QueueDisplay] session_started webhook sent after QR dismiss')
            }
        } catch (e) {
            console.error('[QueueDisplay] Failed to send webhook on dismiss:', e)
        }

        navigate('/frames')
    }

    // ── Auto-dismiss QR when scanned successfully ──
    useEffect(() => {
        if (showQR && currentTicket?.status === 'in_session') {
            console.log('[QueueDisplay] Ticket status is in_session, auto-dismissing QR')
            handleQRDismiss()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showQR, currentTicket?.status])

    const handleFallbackStart = async () => {
        const windowApi = (window as any).api
        try {
            // Send session_started webhook if there's an active ticket
            if (currentTicket && config.queueEventId) {
                await windowApi.queue.sendSessionStarted({
                    event_id: config.queueEventId,
                    ticket_number: currentTicket.queue_number
                })
                console.log('[QueueDisplay] session_started webhook sent on fallback')
            }
        } catch (e) {
            console.error('[QueueDisplay] Failed to send webhook on fallback:', e)
        }

        // Start without queue — just go to normal flow
        const frameId = config.activeFrameId || (config.activeFrameIds?.[0]) || (frames.length > 0 ? frames[0].id : '')
        if (frameId) setActiveFrame(frameId)
        startSession(frameId)
        navigate('/frames')
    }

    // ── Determine display state ──
    const isCalled = currentTicket?.status === 'called'

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (showQR) {
                if (e.key === '1' || e.key === '2' || e.key === '3') {
                    e.preventDefault()
                    handleQRDismiss()
                }
            } else {
                if (e.key === '1' || e.key === '2' || e.key === '3') {
                    e.preventDefault()
                    if (isCalled) {
                        handleStartSession()
                    } else {
                        handleFallbackStart()
                    }
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [showQR, isCalled, handleQRDismiss, handleStartSession, handleFallbackStart])


    // ── Admin Hold Gesture ──
    const handleAdminHoldStart = useCallback(() => {
        const timer = setInterval(() => {
            setHoldProgress(prev => {
                if (prev >= 100) {
                    clearInterval(timer)
                    setShowAdminModal(true)
                    return 0
                }
                return prev + 5
            })
        }, 50)
        setHoldTimer(timer)
    }, [])

    const handleAdminHoldEnd = useCallback(() => {
        if (holdTimer) { clearInterval(holdTimer); setHoldTimer(null) }
        setHoldProgress(0)
    }, [holdTimer])

    const handleAdminSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (adminPassword === ADMIN_PASSWORD) {
            setShowAdminModal(false)
            setAdminPassword('')
            navigate('/admin')
        } else {
            setPasswordError(true)
            setTimeout(() => setPasswordError(false), 2000)
        }
    }

    // ── Format time ──
    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}:${s.toString().padStart(2, '0')}`
    }



    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* Connection Status Banner */}
            <div className={`${styles.connectionBanner} ${isConnected ? styles.connected : styles.disconnected}`}>
                {isConnected
                    ? `🟢 Terhubung ke ${queueStatus?.event?.name || 'Event'}`
                    : `⚠️ ${connectionError || 'Menghubungkan ke server...'}`
                }
            </div>

            {/* Event Header */}
            {queueStatus?.event && (
                <motion.div
                    className={styles.eventHeader}
                    initial={{ y: -20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                >
                    <h2 className={styles.eventName}>{queueStatus.event.name}</h2>
                    <p className={styles.boothName}>{queueStatus.event.booth_name}</p>
                </motion.div>
            )}

            <AnimatePresence mode="wait">
                {!isCalled ? (
                    /* ── IDLE STATE ── */
                    <motion.div
                        key="idle"
                        className={styles.idleContainer}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.4 }}
                    >
                        <div className={styles.idleIcon}>⏳</div>

                        <h1 className={styles.idleTitle}>
                            Menunggu Antrean<br />Berikutnya...
                        </h1>

                        <p className={styles.idleSubtitle}>
                            Sistem akan otomatis menampilkan nomor antrean ketika tiba giliran
                        </p>

                        {queueStatus && (
                            <div className={styles.statsBar}>
                                <div className={styles.statItem}>
                                    <span className={styles.statValue}>{queueStatus.totalWaiting}</span>
                                    <span className={styles.statLabel}>Menunggu</span>
                                </div>
                                <div className={styles.statItem}>
                                    <span className={styles.statValue}>
                                        {queueStatus.avgDurationSec > 0
                                            ? `${Math.round(queueStatus.avgDurationSec / 60)}m`
                                            : '—'
                                        }
                                    </span>
                                    <span className={styles.statLabel}>Rata-rata</span>
                                </div>
                            </div>
                        )}

                        {/* Fallback button when offline */}
                        {!isConnected && (
                            <motion.button
                                className={styles.fallbackButton}
                                onClick={handleFallbackStart}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.5 }}
                            >
                                Mulai Tanpa Antrean →
                            </motion.button>
                        )}
                    </motion.div>
                ) : (
                    /* ── CALLED STATE ── */
                    <motion.div
                        key="called"
                        className={styles.calledContainer}
                        initial={{ opacity: 0, scale: 1.1 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.5, type: 'spring' }}
                    >
                        <p className={styles.calledLabel}>Nomor Antrean</p>

                        <motion.h1
                            className={styles.ticketNumber}
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.2, type: 'spring', stiffness: 80 }}
                        >
                            #{String(currentTicket.queue_number).padStart(3, '0')}
                        </motion.h1>

                        {currentTicket.display_name && (
                            <p className={styles.ticketName}>{currentTicket.display_name}</p>
                        )}

                        <p className={styles.calledInstruction}>
                            SILAKAN MENUJU BOOTH 📸
                        </p>

                        <div className={styles.timeoutBar}>
                            <div
                                className={styles.timeoutProgress}
                                style={{ width: `${(ticketTimeRemaining / TICKET_TIMEOUT_SEC) * 100}%` }}
                            />
                        </div>
                        <p className={styles.timeoutText}>
                            Timeout dalam {formatTime(ticketTimeRemaining)}
                        </p>

                        <motion.button
                            className={styles.startButton}
                            onClick={handleStartSession}
                            disabled={isStartingSession}
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                        >
                            {isStartingSession ? '⏳ Memulai...' : '▶ MULAI SESI FOTO'}
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── QR Code Overlay (Fase 2) ── */}
            <AnimatePresence>
                {showQR && qrUrl && (
                    <motion.div
                        className={styles.qrOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.h2
                            className={styles.qrTitle}
                            initial={{ y: -20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.1 }}
                        >
                            SCAN QR INI DENGAN HP KAMU 📸
                        </motion.h2>

                        <motion.p
                            className={styles.qrSubtitle}
                            initial={{ y: -10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                        >
                            Hubungkan sesi foto ke akun kamu untuk langsung mengakses hasil foto
                        </motion.p>

                        <motion.div
                            className={styles.qrCodeWrapper}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.3, type: 'spring' }}
                        >
                            <QRCode value={qrUrl} size={320} level="H" />
                        </motion.div>

                        <p className={styles.qrCountdown}>{qrCountdown}</p>
                        <p className={styles.qrCountdownLabel}>detik tersisa</p>

                        <motion.button
                            className={styles.skipButton}
                            onClick={handleQRDismiss}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                        >
                            Lanjutkan Tanpa Scan →
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Admin Trigger ── */}
            <div
                className={styles.adminTrigger}
                onMouseDown={handleAdminHoldStart}
                onMouseUp={handleAdminHoldEnd}
                onMouseLeave={handleAdminHoldEnd}
                onTouchStart={handleAdminHoldStart}
                onTouchEnd={handleAdminHoldEnd}
                title="Admin"
            >
                <div className={styles.adminProgress} style={{ width: `${holdProgress}%` }} />
                <span className={styles.adminGear}>⚙</span>
            </div>

            {/* ── Admin Modal ── */}
            <AnimatePresence>
                {showAdminModal && (
                    <motion.div
                        className={styles.modalOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowAdminModal(false)}
                    >
                        <motion.div
                            className={styles.modal}
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            onClick={e => e.stopPropagation()}
                        >
                            <h3>Admin Access</h3>
                            <form onSubmit={handleAdminSubmit}>
                                <input
                                    type="password"
                                    placeholder="Enter password"
                                    value={adminPassword}
                                    onChange={e => setAdminPassword(e.target.value)}
                                    className={`${styles.passwordInput} ${passwordError ? styles.error : ''}`}
                                    autoFocus
                                />
                                <button type="submit" className={styles.submitButton}>Enter</button>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className={styles.version}>v1.0.0 • Queue Mode</div>
        </motion.div>
    )
}

export default QueueDisplay
