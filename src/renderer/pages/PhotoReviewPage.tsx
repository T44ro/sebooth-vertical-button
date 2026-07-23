import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSessionStore, useFrameStore, useAppConfig } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './PhotoReviewPage.module.css'

function PhotoReviewPage(): JSX.Element | null {
    const navigate = useNavigate()
    const { currentSession, photos, removePhoto, endSession } = useSessionStore()
    const { frames } = useFrameStore()
    const { config } = useAppConfig()

    const [activeIndex, setActiveIndex] = useState(0)
    const [scale, setScale] = useState(1)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Redirect if no session or photos
    useEffect(() => {
        if (!currentSession || photos.length === 0) {
            navigate('/capture')
        }
    }, [currentSession, photos, navigate])

    const sessionFrame = frames.find(f => f.id === currentSession?.frameId) || frames[0]

    // Non-duplicate slots only (the actual photos user captured)
    const captureSlots = sessionFrame?.slots.filter(s => !s.duplicateOfSlotId) || []

    // Calculate scale factor for top frame preview
    useEffect(() => {
        const updateScale = () => {
            if (!containerRef.current || !sessionFrame) return
            const containerW = containerRef.current.clientWidth
            const containerH = containerRef.current.clientHeight
            if (!containerW || !containerH) return

            const scaleX = (containerW - 24) / sessionFrame.canvasWidth
            const scaleY = (containerH - 24) / sessionFrame.canvasHeight
            const computedScale = Math.min(scaleX, scaleY, 1)
            setScale(computedScale)
        }

        updateScale()
        window.addEventListener('resize', updateScale)
        return () => window.removeEventListener('resize', updateScale)
    }, [sessionFrame])

    // Button 1: Next Foto Slide
    const handleNextSlide = useCallback(() => {
        if (captureSlots.length === 0) return
        setActiveIndex(prev => (prev + 1) % captureSlots.length)
    }, [captureSlots.length])

    // Button 2: Retake Active Photo
    const handleRetakePhoto = useCallback(() => {
        if (captureSlots.length === 0 || !captureSlots[activeIndex]) return
        const activeSlot = captureSlots[activeIndex]
        const sourceSlotId = activeSlot.duplicateOfSlotId || activeSlot.id
        removePhoto(sourceSlotId)
        navigate('/capture')
    }, [captureSlots, activeIndex, removePhoto, navigate])

    // Button 3: Continue to next page (/review for post processing)
    const handleContinue = useCallback(() => {
        navigate('/review')
    }, [navigate])

    // Physical Hardware Keyboard Shortcuts (Key 1 = Next, Key 2 = Retake, Key 3 = Continue)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (e.key === '1') {
                e.preventDefault()
                handleNextSlide()
            } else if (e.key === '2') {
                e.preventDefault()
                handleRetakePhoto()
            } else if (e.key === '3') {
                e.preventDefault()
                handleContinue()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleNextSlide, handleRetakePhoto, handleContinue])

    // Timeout handler
    const handleTimeout = useCallback(() => {
        navigate('/review')
    }, [navigate])

    const handleBackHome = () => {
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBackHome = () => {
        endSession()
        navigate('/')
    }

    if (!currentSession || !sessionFrame) return null

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <SessionTimer
                duration={config.postProcessingTimeout || 120}
                onTimeout={handleTimeout}
                enabled={config.sessionTimerEnabled}
                label="Review Photos"
            />

            <div className={styles.content}>
                <header className={styles.header}>
                    <button onClick={handleBackHome} className={styles.backBtn}>
                        ← Beranda
                    </button>
                    <h1>Review Your Photos</h1>
                </header>

                {/* Single Unified Container Card */}
                <div className={styles.unifiedCardContainer}>
                    {/* Top Portion: Photo Strip Frame Preview */}
                    <div className={styles.topSection}>
                        <div className={styles.framePreviewContainer} ref={containerRef}>
                            <div
                                className={styles.frameCanvas}
                                style={{
                                    width: `${sessionFrame.canvasWidth}px`,
                                    height: `${sessionFrame.canvasHeight}px`,
                                    transform: `scale(${scale})`,
                                    transformOrigin: 'center center'
                                }}
                            >
                                {/* Render photo slots */}
                                {sessionFrame.slots.map((slot) => {
                                    const sourceSlotId = slot.duplicateOfSlotId || slot.id
                                    const photo = photos.find(p => p.slotId === sourceSlotId)
                                    const activeSlot = captureSlots[activeIndex]
                                    const isSelectedSlot = activeSlot && (activeSlot.id === slot.id || activeSlot.id === slot.duplicateOfSlotId)

                                    return (
                                        <div
                                            key={slot.id}
                                            className={`${styles.slotArea} ${isSelectedSlot ? styles.activeSlotHighlight : ''}`}
                                            style={{
                                                position: 'absolute',
                                                left: `${slot.x}px`,
                                                top: `${slot.y}px`,
                                                width: `${slot.width}px`,
                                                height: `${slot.height}px`,
                                                transform: `rotate(${slot.rotation || 0}deg)`
                                            }}
                                        >
                                            {photo ? (
                                                <img
                                                    src={photo.imagePath}
                                                    alt={`Slot ${slot.id}`}
                                                    className={styles.slotImage}
                                                />
                                            ) : (
                                                <div className={styles.emptySlotPlaceholder}>Kosong</div>
                                            )}
                                        </div>
                                    )
                                })}

                                {/* Frame Overlay */}
                                {sessionFrame.overlayPath && (
                                    <img
                                        src={sessionFrame.overlayPath}
                                        alt="Frame Overlay"
                                        className={styles.frameOverlayImage}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Subtle Section Divider Line */}
                    <div className={styles.sectionDivider} />

                    {/* Bottom Portion: Maximized Centered 3D Sliding Carousel for Individual Photos */}
                    <div className={styles.bottomSection}>
                        <div className={styles.carouselContainer}>
                            <div className={styles.carouselCenterTrack}>
                                {captureSlots.map((slot, index) => {
                                    const sourceSlotId = slot.duplicateOfSlotId || slot.id
                                    const photo = photos.find(p => p.slotId === sourceSlotId)
                                    const offset = index - activeIndex
                                    const isCenter = index === activeIndex

                                    const cardSpacing = 370
                                    const translateX = offset * cardSpacing
                                    const cardScale = isCenter ? 1.35 : Math.max(0.65, 1 - Math.abs(offset) * 0.3)
                                    const cardOpacity = isCenter ? 1 : Math.max(0.35, 1 - Math.abs(offset) * 0.4)
                                    const zIndex = 100 - Math.abs(offset)

                                    if (Math.abs(offset) > 3) return null

                                    return (
                                        <motion.div
                                            key={slot.id}
                                            className={`${styles.carouselCard} ${isCenter ? styles.centerCard : styles.sideCard}`}
                                            onClick={() => setActiveIndex(index)}
                                            animate={{
                                                x: translateX,
                                                scale: cardScale,
                                                opacity: cardOpacity,
                                                zIndex
                                            }}
                                            transition={{
                                                type: 'spring',
                                                stiffness: 300,
                                                damping: 26
                                            }}
                                        >
                                            <div className={styles.cardImageWrapper}>
                                                {photo ? (
                                                    <img
                                                        src={photo.imagePath}
                                                        alt={`Foto ${index + 1}`}
                                                        className={styles.cardImage}
                                                    />
                                                ) : (
                                                    <div className={styles.cardPlaceholder}>Tidak Ada Foto</div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBackHome}
            />
        </motion.div>
    )
}

export default PhotoReviewPage
