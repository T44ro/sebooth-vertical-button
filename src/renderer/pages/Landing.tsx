import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useCameraStore, useFrameStore, useAppConfig } from '../stores'
import styles from './Landing.module.css'

// Placeholder illustration — swap with user's image once provided
const ILLUSTRATION_SRC = './assets/landing-illustration.mp4'

const ADMIN_PASSWORD = 'admin123'

const formatFilePath = (p?: string): string => {
    if (!p) return ''
    if (p.startsWith('http') || p.startsWith('./') || p.startsWith('data:')) return p
    const normalized = p.replace(/\\/g, '/')
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

function Landing(): JSX.Element {
    const navigate = useNavigate()
    const { cameras, selectedCamera, setCameras, selectCamera, setConnected, isConnected } = useCameraStore()
    const { frames, setActiveFrame } = useFrameStore()
    const { config } = useAppConfig()

    const isPortrait = config.appOrientation === 'portrait'
    const customBg = isPortrait ? config.customBgPortrait : config.customBgLandscape
    const customBgType = isPortrait ? config.customBgPortraitType : config.customBgLandscapeType
    const hasCustomBg = !!customBg

    const [showAdminModal, setShowAdminModal] = useState(false)
    const [adminPassword, setAdminPassword] = useState('')
    const [passwordError, setPasswordError] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [holdProgress, setHoldProgress] = useState(0)
    const [holdTimer, setHoldTimer] = useState<any | null>(null)
    const [showCameraMenu, setShowCameraMenu] = useState(false)
    const [illustrationError, setIllustrationError] = useState(false)

    // Live Camera Background States
    const videoRef = useRef<HTMLVideoElement>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const [liveCameraEnabled, setLiveCameraEnabled] = useState(false)
    const [isCameraLoading, setIsCameraLoading] = useState(false)

    // Check if video exists (simple check via extension or just try loading)
    useEffect(() => {
        // Auto-redirect to Queue Display when Queue Mode is active
        if (config.queueEnabled && config.queueEventId) {
            navigate('/queue')
            return
        }
    }, [config.queueEnabled, config.queueEventId, navigate])

    useEffect(() => {
        const fetchCameras = async (): Promise<void> => {
            try {
                const result = await window.api.camera.list()
                if (result.success && result.data) {
                    setCameras(result.data)
                    if (result.data.length > 0 && !selectedCamera) {
                        selectCamera(result.data[0])
                    }
                }
            } catch (error) {
                console.error('Failed to fetch cameras:', error)
            }
        }
        fetchCameras()
    }, [setCameras, selectCamera, selectedCamera])

    // Initialize live camera background when enabled
    useEffect(() => {
        if (!liveCameraEnabled) {
            // Cleanup if feature is disabled
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
                streamRef.current = null
            }
            if (videoRef.current) {
                videoRef.current.srcObject = null
            }
            return
        }

        const initCamera = async (): Promise<void> => {
            setIsCameraLoading(true)

            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('Camera API not available. Please check browser permissions.')
                }

                console.log('[Landing] Requesting camera access...')

                const videoConstraints: MediaTrackConstraints = {
                    width: { ideal: 1920, min: 640 },
                    height: { ideal: 1080, min: 480 },
                }

                if (config.selectedCameraId) {
                    videoConstraints.deviceId = { exact: config.selectedCameraId }
                } else {
                    videoConstraints.facingMode = 'user'
                }

                let stream: MediaStream
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: videoConstraints,
                        audio: false
                    })
                } catch (primaryErr) {
                    if (config.selectedCameraId) {
                        console.warn('[Landing] Failed with exact deviceId, trying fallback without deviceId:', primaryErr)
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: { width: { ideal: 1920, min: 640 }, height: { ideal: 1080, min: 480 } },
                            audio: false
                        })
                    } else {
                        throw primaryErr
                    }
                }

                console.log('[Landing] Camera stream acquired:', {
                    videoTracks: stream.getVideoTracks().length,
                    audioTracks: stream.getAudioTracks().length
                })

                streamRef.current = stream

                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                    console.log('[Landing] Stream assigned to video element')

                    // Force play the video
                    videoRef.current.play().catch(e => {
                        console.error('[Landing] Video play error:', e)
                    })
                }

                setIsCameraLoading(false)
            } catch (error) {
                console.error('[Landing] Camera initialization error:', error)
                const errorMsg = error instanceof Error ? error.message : String(error)
                console.error('[Landing] Error details:', errorMsg)
                setLiveCameraEnabled(false)
                setIsCameraLoading(false)
            }
        }

        initCamera()

        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
                streamRef.current = null
            }
        }
    }, [liveCameraEnabled, config.selectedCameraId])

    const [pinSequence, setPinSequence] = useState('')
    const key1HoldTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const key1PressTimeRef = useRef<number | null>(null)

    const clearKey1Timer = useCallback(() => {
        if (key1HoldTimerRef.current) {
            clearInterval(key1HoldTimerRef.current)
            key1HoldTimerRef.current = null
        }
        setHoldProgress(0)
    }, [])

    const handleCameraSelect = async (cameraId: string): Promise<void> => {
        const camera = cameras.find(c => c.id === cameraId)
        if (camera) {
            selectCamera(camera)
            const result = await window.api.camera.connect(cameraId)
            setConnected(result.success && result.data === true)
            setShowCameraMenu(false)
        }
    }

    const handleStart = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        try {
            if (!isConnected && selectedCamera) {
                const result = await window.api.camera.connect(selectedCamera.id)
                setConnected(result.success && result.data === true)
            }
            if (config.activeFrameId) {
                setActiveFrame(config.activeFrameId)
            } else if (frames.length > 0) {
                setActiveFrame(frames[0].id)
            }
            navigate('/frames')
        } catch (error) {
            console.error('Failed to start session:', error)
        } finally {
            setIsLoading(false)
        }
    }, [isConnected, selectedCamera, setConnected, config.activeFrameId, setActiveFrame, frames, navigate])

    // Keydown & Keyup listener for 5-second Key 1 Hold and Sequential PIN 123
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            // If Admin Modal is open, handle sequential PIN entry (1 -> 2 -> 3)
            if (showAdminModal) {
                if (e.key === '1' || e.key === '2' || e.key === '3') {
                    e.preventDefault()
                    const nextSeq = pinSequence + e.key
                    setPinSequence(nextSeq)
                    
                    if (nextSeq === '123' || nextSeq === '1234') {
                        setShowAdminModal(false)
                        setPinSequence('')
                        setAdminPassword('')
                        navigate('/admin')
                    } else if (nextSeq.length >= 3) {
                        setPasswordError(true)
                        setTimeout(() => {
                            setPasswordError(false)
                            setPinSequence('')
                        }, 1000)
                    }
                }
                return
            }

            // Normal Landing Page Key Navigation
            if (e.key === '1') {
                if (e.repeat) return
                // Start 5-second hold timer for Key 1
                key1PressTimeRef.current = Date.now()
                clearKey1Timer()
                
                key1HoldTimerRef.current = setInterval(() => {
                    if (!key1PressTimeRef.current) return
                    const elapsed = Date.now() - key1PressTimeRef.current
                    const progress = Math.min(100, (elapsed / 5000) * 100)
                    setHoldProgress(progress)

                    if (elapsed >= 5000) {
                        clearKey1Timer()
                        key1PressTimeRef.current = null
                        setShowAdminModal(true)
                        setPinSequence('')
                        setPasswordError(false)
                    }
                }, 50)

            } else if (e.key === '2' || e.key === '3') {
                e.preventDefault()
                handleStart()
            }
        }

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (showAdminModal) return

            if (e.key === '1') {
                if (key1PressTimeRef.current) {
                    const elapsed = Date.now() - key1PressTimeRef.current
                    clearKey1Timer()
                    key1PressTimeRef.current = null

                    // If released under 2 seconds, treat as normal start button press
                    if (elapsed < 2000) {
                        handleStart()
                    }
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
            clearKey1Timer()
        }
    }, [showAdminModal, pinSequence, handleStart, clearKey1Timer, navigate])

    const handleAdminSubmit = (e: React.FormEvent): void => {
        e.preventDefault()
        if (adminPassword === '123' || adminPassword === ADMIN_PASSWORD || pinSequence === '123') {
            setShowAdminModal(false)
            setAdminPassword('')
            setPinSequence('')
            navigate('/admin')
        } else {
            setPasswordError(true)
            setTimeout(() => setPasswordError(false), 2000)
        }
    }

    return (
        <motion.div
            className={`${styles.container} ${liveCameraEnabled ? styles.hasLiveCam : ''} ${!liveCameraEnabled && hasCustomBg ? styles.hasCustomBg : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* ── LIVE CAMERA BACKGROUND ── */}
            {liveCameraEnabled && (() => {
                const rotation = config.cameraRotation || 0
                const isRotated90or270 = rotation === 90 || rotation === 270

                const videoStyle: React.CSSProperties = isRotated90or270
                    ? {
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        width: '100vh',
                        height: '100vw',
                        transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleX(-1)`,
                        objectFit: 'cover'
                    }
                    : rotation === 180
                    ? {
                        transform: 'rotate(180deg) scaleX(-1)',
                        objectFit: 'cover'
                    }
                    : {
                        transform: 'scaleX(-1)',
                        objectFit: 'cover'
                    }

                return (
                    <video
                        ref={videoRef}
                        className={styles.liveCameraBackground}
                        autoPlay
                        muted
                        playsInline
                        style={videoStyle}
                    />
                )
            })()}

            {/* ── CUSTOM BACKGROUND (IMAGE OR VIDEO) ── */}
            {!liveCameraEnabled && hasCustomBg && (
                customBgType === 'video' ? (
                    <video
                        src={formatFilePath(customBg)}
                        className={styles.customBackground}
                        autoPlay
                        loop
                        muted
                        playsInline
                    />
                ) : (
                    <img
                        src={formatFilePath(customBg)}
                        alt="Custom Background"
                        className={styles.customBackground}
                    />
                )
            )}

            {/* ── TOP NAV ── */}
            <header className={styles.navbar}>
                {/* Left side: Logo + Live Camera Toggle */}
                <div className={styles.navLeft}>
                    {/* Logo */}
                    <div className={styles.navLogo}>
                        <img src="./assets/icons/icon-camera.png" alt="Sebooth" className={styles.navLogoIcon} />
                        <span className={styles.navLogoText}>Sebooth</span>
                    </div>

                    {/* Live Camera Toggle Button */}
                    <button
                        className={`${styles.liveCameraToggle} ${liveCameraEnabled ? styles.active : ''}`}
                        onClick={() => setLiveCameraEnabled(v => !v)}
                        title={liveCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                    >
                        <span className={styles.toggleIcon}>{liveCameraEnabled ? '📹' : '📷'}</span>
                    </button>
                </div>

                {/* Right side: camera selector + admin trigger */}
                <div className={styles.navRight}>
                    {/* Camera Picker */}
                    <div className={styles.cameraPicker}>
                        <button
                            className={styles.cameraPickerBtn}
                            onClick={() => setShowCameraMenu(v => !v)}
                        >
                            <span className={`${styles.statusDot} ${isConnected ? styles.connected : ''}`} />
                            <span>{selectedCamera?.name ?? 'Select Camera'}</span>
                            <span className={styles.chevron}>{showCameraMenu ? '▲' : '▼'}</span>
                        </button>

                        <AnimatePresence>
                            {showCameraMenu && (
                                <motion.div
                                    className={styles.cameraDropdown}
                                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    {cameras.length === 0 && (
                                        <div className={styles.dropdownEmpty}>No cameras found</div>
                                    )}
                                    {cameras.map(cam => (
                                        <button
                                            key={cam.id}
                                            className={`${styles.dropdownItem} ${selectedCamera?.id === cam.id ? styles.activeItem : ''}`}
                                            onClick={() => handleCameraSelect(cam.id)}
                                        >
                                            {cam.name}
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Admin trigger gear icon */}
                    <div
                        className={styles.adminTrigger}
                        onClick={() => {
                            setShowAdminModal(true)
                            setPinSequence('')
                            setPasswordError(false)
                        }}
                        title="Admin"
                    >
                        <div className={styles.adminProgress} style={{ width: `${holdProgress}%` }} />
                        <span className={styles.adminGear}>⚙</span>
                    </div>
                </div>
            </header>

            {/* ── HERO TEXT ── */}
            <section className={styles.hero}>
                <motion.h1
                    className={styles.headline}
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.15, type: 'spring', stiffness: 100 }}
                >
                    Abadikan Momen,<br />
                    <span className={styles.headlineAccent}>Ciptakan Kenangan.</span>
                </motion.h1>
            </section>

            {/* Absolute Centered Start Button */}
            <motion.button
                className={styles.ctaPrimary}
                onClick={handleStart}
                disabled={isLoading}
                initial={{ opacity: 0, scale: 0.8, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                transition={{ delay: 0.45, type: 'spring', stiffness: 100 }}
            >
                {isLoading
                    ? <span className={styles.loader} />
                    : <> Mulai Sesi Foto &nbsp;→</>
                }
            </motion.button>

            {/* ── ILLUSTRATION (VIDEO) ── */}
            <motion.div
                className={styles.illustrationWrap}
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5, type: 'spring', stiffness: 70, damping: 18 }}
            >
                {!illustrationError ? (
                    <video
                        src={ILLUSTRATION_SRC}
                        className={styles.illustration}
                        autoPlay
                        loop
                        muted
                        playsInline
                        onError={() => setIllustrationError(true)}
                    />
                ) : (
                    /* Placeholder shown until user provides video */
                    <div className={styles.illustrationPlaceholder}>
                        <span style={{ fontSize: 120, lineHeight: 1 }}>🎬</span>
                        <p>Letakkan video ilustrasi Anda di<br />
                            <code>src/renderer/assets/landing-illustration.mp4</code>
                        </p>
                    </div>
                )}
            </motion.div>

            {/* ── 5-Second Key 1 Hold Progress Bar ── */}
            {holdProgress > 0 && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    zIndex: 9999
                }}>
                    <div style={{
                        width: `${holdProgress}%`,
                        height: '100%',
                        backgroundColor: '#ef4444',
                        transition: 'width 0.05s linear'
                    }} />
                </div>
            )}

            {/* ── ADMIN MODAL ── */}
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
                            <h3>🔒 Admin Access</h3>
                            <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '16px', textAlign: 'center' }}>
                                Tekan tombol <b>1 ➔ 2 ➔ 3</b> secara berurutan
                            </p>

                            {/* Sequential PIN Dots Indicator */}
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '20px' }}>
                                {[0, 1, 2].map((i) => (
                                    <div
                                        key={i}
                                        style={{
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '50%',
                                            border: '2px solid #3b82f6',
                                            backgroundColor: pinSequence.length > i ? '#3b82f6' : 'transparent',
                                            transition: 'all 0.2s ease'
                                        }}
                                    />
                                ))}
                            </div>

                            <form onSubmit={handleAdminSubmit}>
                                <input
                                    type="password"
                                    placeholder="Atau ketik PIN 123"
                                    value={adminPassword || pinSequence}
                                    onChange={e => setAdminPassword(e.target.value)}
                                    className={`${styles.passwordInput} ${passwordError ? styles.error : ''}`}
                                    autoFocus
                                />
                                <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                                    <button
                                        type="button"
                                        onClick={() => setShowAdminModal(false)}
                                        style={{
                                            flex: 1,
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid #cbd5e1',
                                            background: '#f8fafc',
                                            fontWeight: 700,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Batal
                                    </button>
                                    <button type="submit" className={styles.submitButton} style={{ flex: 1 }}>Enter</button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className={styles.version}>v1.0.0</div>
        </motion.div>
    )
}

export default Landing
