import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useCameraStore, useFrameStore, useAppConfig } from '../stores'
import styles from './Landing.module.css'

// Placeholder illustration — swap with user's image once provided
const ILLUSTRATION_SRC = './assets/landing-illustration.mp4'

const ADMIN_PASSWORD = 'admin123'

function Landing(): JSX.Element {
    const navigate = useNavigate()
    const { cameras, selectedCamera, setCameras, selectCamera, setConnected, isConnected } = useCameraStore()
    const { frames, setActiveFrame } = useFrameStore()
    const { config } = useAppConfig()

    const [showAdminModal, setShowAdminModal] = useState(false)
    const [adminPassword, setAdminPassword] = useState('')
    const [passwordError, setPasswordError] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [holdProgress, setHoldProgress] = useState(0)
    const [holdTimer, setHoldTimer] = useState<any | null>(null)
    const [showCameraMenu, setShowCameraMenu] = useState(false)
    const [illustrationError, setIllustrationError] = useState(false)

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

    const handleCameraSelect = async (cameraId: string): Promise<void> => {
        const camera = cameras.find(c => c.id === cameraId)
        if (camera) {
            selectCamera(camera)
            const result = await window.api.camera.connect(cameraId)
            setConnected(result.success && result.data === true)
            setShowCameraMenu(false)
        }
    }

    const handleStart = async (): Promise<void> => {
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
    }

    const handleAdminSubmit = (e: React.FormEvent): void => {
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

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* ── TOP NAV ── */}
            <header className={styles.navbar}>
                {/* Logo */}
                <div className={styles.navLogo}>
                    <img src="./assets/icons/icon-camera.png" alt="Sebooth" className={styles.navLogoIcon} />
                    <span className={styles.navLogoText}>Sebooth</span>
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

                    {/* Hidden admin long-press trigger */}
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

            <div className={styles.version}>v1.0.0</div>
        </motion.div>
    )
}

export default Landing
