import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFrameStore, useAppConfig, useSessionStore } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './FrameSelection.module.css'

function FrameSelection(): JSX.Element {
    const navigate = useNavigate()
    const { frames, setActiveFrame } = useFrameStore()
    const { config } = useAppConfig()
    const { endSession } = useSessionStore()
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const [focusedIndex, setFocusedIndex] = useState(0)

    // Clear any existing session when entering frame selection
    useEffect(() => {
        endSession()
    }, [endSession])

    // Filter active frames if configured, otherwise show all
    const displayFrames = config.activeFrameIds.length > 0
        ? frames.filter(f => config.activeFrameIds.includes(f.id))
        : frames

    // Keep focusedIndex in bounds when frames list changes
    useEffect(() => {
        if (displayFrames.length > 0 && focusedIndex >= displayFrames.length) {
            setFocusedIndex(0)
        }
    }, [displayFrames.length, focusedIndex])

    const handleSelectFrame = (frameId: string): void => {
        setActiveFrame(frameId)
        if (config.paymentEnabled) {
            navigate('/payment')
        } else {
            navigate('/capture')
        }
    }

    const handleNext = () => {
        if (displayFrames.length === 0) return
        setFocusedIndex(prev => (prev + 1) % displayFrames.length)
    }

    const handlePrev = () => {
        if (displayFrames.length === 0) return
        setFocusedIndex(prev => (prev - 1 + displayFrames.length) % displayFrames.length)
    }

    const handleBack = (): void => {
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBack = (): void => {
        endSession()
        navigate('/')
    }

    const handleTimeout = (): void => {
        navigate('/')
    }

    // Keyboard & Physical Arcade Button Navigation (1: Prev, 3: Next, 2: Select)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (displayFrames.length === 0) return

            if (e.key === '1' || e.key === 'ArrowLeft') {
                e.preventDefault()
                handlePrev()
            } else if (e.key === '3' || e.key === 'ArrowRight') {
                e.preventDefault()
                handleNext()
            } else if (e.key === '2' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                const selected = displayFrames[focusedIndex]
                if (selected) {
                    handleSelectFrame(selected.id)
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [displayFrames, focusedIndex])

    const isPortrait = config.appOrientation === 'portrait'
    const cardSpacing = isPortrait ? 270 : 340

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* Session Timer Overlay */}
            <SessionTimer
                duration={config.frameSelectionTimeout}
                onTimeout={handleTimeout}
                enabled={config.sessionTimerEnabled}
                label="Frame Selection"
            />

            <header className={styles.header}>
                <button onClick={handleBack} className={styles.backButton}>
                    ← Back
                </button>
                <h1>PILIH FRAME FOTO</h1>
                <div style={{ width: '80px' }} />
            </header>

            <main className={styles.content}>
                {displayFrames.length === 0 ? (
                    <div className={styles.emptyState}>
                        <span className={styles.emptyIcon}>🖼️</span>
                        <h2>Belum Ada Frame</h2>
                        <p>Silakan tambahkan frame di Admin Dashboard terlebih dahulu.</p>
                        <button onClick={() => navigate('/admin')} className={styles.adminButton}>
                            Ke Dashboard Admin
                        </button>
                    </div>
                ) : (
                    <div className={styles.carouselWrapper}>
                        {/* Side Arrow Navigation Buttons */}
                        {displayFrames.length > 1 && (
                            <>
                                <button className={styles.navArrowLeft} onClick={handlePrev} title="Frame Sebelumnya (Tombol 1)">
                                    ◀
                                </button>
                                <button className={styles.navArrowRight} onClick={handleNext} title="Frame Selanjutnya (Tombol 3)">
                                    ▶
                                </button>
                            </>
                        )}

                        {/* Horizontal Carousel Track */}
                        <div className={styles.carouselTrack}>
                            {displayFrames.map((frame, index) => {
                                const offset = index - focusedIndex
                                const isFocused = index === focusedIndex

                                // Calculate scale, opacity, x position based on distance from center
                                const scale = isFocused ? 1.22 : Math.max(0.7, 0.9 - Math.abs(offset) * 0.15)
                                const opacity = isFocused ? 1 : Math.max(0, 0.65 - (Math.abs(offset) - 1) * 0.3)
                                const zIndex = isFocused ? 20 : 10 - Math.abs(offset)
                                const translateX = offset * cardSpacing

                                // Don't render items that are too far away offscreen
                                if (Math.abs(offset) > 3) return null

                                return (
                                    <motion.div
                                        key={frame.id}
                                        className={`${styles.carouselCard} ${isFocused ? styles.focusedCard : ''}`}
                                        onClick={() => {
                                            if (isFocused) {
                                                handleSelectFrame(frame.id)
                                            } else {
                                                setFocusedIndex(index)
                                            }
                                        }}
                                        animate={{
                                            x: translateX,
                                            scale,
                                            opacity,
                                            zIndex
                                        }}
                                        transition={{
                                            type: 'spring',
                                            stiffness: 300,
                                            damping: 26
                                        }}
                                    >
                                        <div
                                            className={styles.framePreview}
                                            style={{ aspectRatio: `${frame.canvasWidth} / ${frame.canvasHeight}` }}
                                        >
                                            {/* Colored slot indicators */}
                                            {frame.slots.map((slot) => {
                                                const slotColors = ['#ef4444', '#3b82f6', '#22c55e', '#f97316', '#eab308', '#a855f7', '#ec4899', '#14b8a6']
                                                const nonDuplicateSlots = frame.slots.filter(s => !s.duplicateOfSlotId)
                                                let displayNumber: number
                                                let colorIndex: number

                                                if (slot.duplicateOfSlotId) {
                                                    const sourceSlot = frame.slots.find(s => s.id === slot.duplicateOfSlotId)
                                                    displayNumber = sourceSlot ? nonDuplicateSlots.findIndex(s => s.id === sourceSlot.id) + 1 : 0
                                                } else {
                                                    displayNumber = nonDuplicateSlots.findIndex(s => s.id === slot.id) + 1
                                                }
                                                colorIndex = Math.max(0, displayNumber - 1)
                                                const color = slotColors[colorIndex % slotColors.length]

                                                return (
                                                    <div
                                                        key={slot.id}
                                                        className={styles.slotIndicator}
                                                        style={{
                                                            left: `${(slot.x / frame.canvasWidth) * 100}%`,
                                                            top: `${(slot.y / frame.canvasHeight) * 100}%`,
                                                            width: `${(slot.width / frame.canvasWidth) * 100}%`,
                                                            height: `${(slot.height / frame.canvasHeight) * 100}%`,
                                                            transform: `rotate(${slot.rotation}deg)`,
                                                            backgroundColor: color,
                                                            opacity: 0.7
                                                        }}
                                                    >
                                                        <span className={styles.slotNumber}>{displayNumber}</span>
                                                    </div>
                                                )
                                            })}
                                            {/* Frame overlay on top */}
                                            <img
                                                src={`file://${frame.overlayPath}`}
                                                alt={frame.name}
                                                className={styles.frameOverlayImage}
                                            />
                                        </div>
                                        <div className={styles.frameInfo}>
                                            <h3>{frame.name}</h3>
                                            <span>{frame.slots.filter(s => !s.duplicateOfSlotId).length} photo{frame.slots.filter(s => !s.duplicateOfSlotId).length !== 1 ? 's' : ''}</span>
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </main>

            {/* Bottom Action Bar */}
            {displayFrames.length > 0 && (
                <div className={styles.bottomActionBar}>
                    <button
                        className={styles.selectButton}
                        onClick={() => handleSelectFrame(displayFrames[focusedIndex]?.id)}
                    >
                        <span>PILIH FRAME INI</span>
                        <span>➔</span>
                    </button>
                    <span className={styles.instructionsHint}>
                        💡 Tekan tombol panah ◀ / ▶ atau angka 1/3 untuk geser frame, tombol 2 untuk pilih.
                    </span>
                </div>
            )}

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBack}
            />
        </motion.div>
    )
}

export default FrameSelection
