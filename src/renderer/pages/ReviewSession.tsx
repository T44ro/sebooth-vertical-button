import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useSessionStore, useFrameStore, useAppConfig } from '../stores'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './ReviewSession.module.css'

type FilterType = 'none' | 'grayscale' | 'sepia' | 'warm' | 'cool' | 'vintage'

const FILTERS: { id: FilterType; name: string; style: React.CSSProperties; filterStr: string }[] = [
    { id: 'none', name: 'Original', style: {}, filterStr: 'none' },
    { id: 'grayscale', name: 'B&W', style: { filter: 'grayscale(100%)' }, filterStr: 'grayscale(100%)' },
    { id: 'sepia', name: 'Sepia', style: { filter: 'sepia(80%)' }, filterStr: 'sepia(80%)' },
    { id: 'warm', name: 'Warm', style: { filter: 'saturate(1.3) hue-rotate(-10deg)' }, filterStr: 'saturate(1.3) hue-rotate(-10deg)' },
    { id: 'cool', name: 'Cool', style: { filter: 'saturate(1.1) hue-rotate(10deg)' }, filterStr: 'saturate(1.1) hue-rotate(10deg)' },
    { id: 'vintage', name: 'Vintage', style: { filter: 'contrast(1.1) brightness(0.9) sepia(30%)' }, filterStr: 'contrast(1.1) brightness(0.9) sepia(30%)' }
]

// Helper function to calculate circular offset relative to active index
const getCircularOffset = (index: number, activeIndex: number, length: number): number => {
    let diff = index - activeIndex
    while (diff > length / 2) diff -= length
    while (diff <= -length / 2) diff += length
    return diff
}

const ReviewSession: React.FC = () => {
    const navigate = useNavigate()
    const { 
        currentSession, 
        photos, 
        selectedFilter,
        setSessionFilter,
        endSession,
        isMirrored,
        setIsMirrored
    } = useSessionStore()
    const { frames } = useFrameStore()
    const { config } = useAppConfig()
    
    const [showOverlayText, setShowOverlayText] = useState(true)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const carouselRef = useRef<HTMLDivElement>(null)

    // Redirect to capture if session is missing
    useEffect(() => {
        if (!currentSession || photos.length === 0) {
            navigate('/capture')
        }
    }, [currentSession, photos, navigate])

    // Sync mirror setting from global config on load if defined
    useEffect(() => {
        if (config && config.mirrorOutput !== undefined) {
            setIsMirrored(config.mirrorOutput)
        }
    }, [config, setIsMirrored])

    // Current active filter index
    const activeIndex = FILTERS.findIndex(f => f.id === (selectedFilter || 'none'))
    const safeActiveIndex = activeIndex === -1 ? 0 : activeIndex
    const currentFilterDef = FILTERS[safeActiveIndex] || FILTERS[0]

    // Handle 2-second fade-out timer for overlay text when filter changes
    useEffect(() => {
        setShowOverlayText(true)
        if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current)
        }
        fadeTimeoutRef.current = setTimeout(() => {
            setShowOverlayText(false)
        }, 2000)

        return () => {
            if (fadeTimeoutRef.current) {
                clearTimeout(fadeTimeoutRef.current)
            }
        }
    }, [selectedFilter])

    const handleNextFilter = useCallback(() => {
        const nextIndex = (safeActiveIndex + 1) % FILTERS.length
        setSessionFilter(FILTERS[nextIndex].id)
    }, [safeActiveIndex, setSessionFilter])

    const handleToggleMirror = useCallback(() => {
        setIsMirrored(!isMirrored)
    }, [isMirrored, setIsMirrored])

    const handleNextStep = useCallback(() => {
        navigate('/output')
    }, [navigate])

    // Keyboard navigation according to exact specifications:
    // Key 1: Next filter
    // Key 2: Toggle Mirror output
    // Key 3: Next step (/output)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (e.key === '1') {
                e.preventDefault()
                handleNextFilter()
            } else if (e.key === '2') {
                e.preventDefault()
                handleToggleMirror()
            } else if (e.key === '3') {
                e.preventDefault()
                handleNextStep()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleNextFilter, handleToggleMirror, handleNextStep])

    if (!currentSession) return null

    const sessionFrame = frames.find(f => f.id === currentSession.frameId)
    if (!sessionFrame) return null

    // Calculate card dimensions for rendering (Enlarged frame size)
    const isPortrait = config.appOrientation === 'portrait'
    const targetCardHeight = isPortrait ? 520 : 600
    const cardScaleFactor = targetCardHeight / sessionFrame.canvasHeight
    const scaledWidth = sessionFrame.canvasWidth * cardScaleFactor
    const scaledHeight = sessionFrame.canvasHeight * cardScaleFactor

    // Spacing between cards in carousel
    const spacingX = isPortrait ? scaledWidth * 0.82 : scaledWidth * 1.05

    return (
        <motion.div 
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* Top Navigation Back Button */}
            <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setIsConfirmModalOpen(true)}
                title="Back to Home"
                className={styles.backButton}
            >
                ← Kembali
            </motion.button>

            {/* Header Title */}
            <div className={styles.header}>
                <h2>🎨 Pilih Filter Foto</h2>
                <p>Gunakan Filter Terbaik untuk Sesi Foto Anda</p>
            </div>

            {/* Main 3D Infinite Circular Sliding Carousel Area */}
            <div className={styles.carouselWorkspace} ref={carouselRef}>
                <div className={styles.carouselCenterTrack}>
                    {FILTERS.map((filter, idx) => {
                        const offset = getCircularOffset(idx, safeActiveIndex, FILTERS.length)
                        const isCenter = offset === 0
                        const absOffset = Math.abs(offset)

                        // Compute 3D slide transforms
                        let xPos = offset * spacingX
                        let scale = 1.20
                        let opacity = 1
                        let zIndex = 20
                        let rotateY = 0

                        if (!isCenter) {
                            scale = absOffset === 1 ? 0.70 : 0.45
                            opacity = absOffset === 1 ? 0.50 : 0.12
                            zIndex = 10 - absOffset
                            rotateY = offset > 0 ? -12 : 12
                        }

                        return (
                            <motion.div
                                key={filter.id}
                                className={`${styles.slideCardWrapper} ${isCenter ? styles.centerCard : ''}`}
                                style={{
                                    width: scaledWidth,
                                    height: scaledHeight,
                                    zIndex
                                }}
                                animate={{
                                    x: xPos,
                                    scale,
                                    opacity,
                                    rotateY
                                }}
                                transition={{
                                    type: 'spring',
                                    stiffness: 280,
                                    damping: 26,
                                    mass: 0.8
                                }}
                                onClick={() => {
                                    if (!isCenter) {
                                        setSessionFilter(filter.id)
                                    }
                                }}
                            >
                                {/* Inner Canvas Container representing the completed photo strip */}
                                <div
                                    className={styles.innerCanvas}
                                    style={{
                                        width: sessionFrame.canvasWidth,
                                        height: sessionFrame.canvasHeight,
                                        transform: `scale(${cardScaleFactor})`,
                                        transformOrigin: 'top left'
                                    }}
                                >
                                    {sessionFrame.slots.map(slot => {
                                        const sourceSlotId = slot.duplicateOfSlotId || slot.id
                                        const photo = photos.find(p => p.slotId === sourceSlotId)
                                        if (!photo) return null

                                        return (
                                            <div
                                                key={slot.id}
                                                className={styles.slotWrapper}
                                                style={{
                                                    left: slot.x,
                                                    top: slot.y,
                                                    width: slot.width,
                                                    height: slot.height,
                                                    transform: `rotate(${slot.rotation}deg)`,
                                                    transformOrigin: 'center center',
                                                    overflow: 'hidden'
                                                }}
                                            >
                                                <img
                                                    src={photo.imagePath}
                                                    className={styles.photoImage}
                                                    draggable={false}
                                                    style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        objectFit: 'cover',
                                                        transform: `scale(${photo.scale || 1}) scaleX(${isMirrored ? -1 : 1})`,
                                                        transformOrigin: 'center center',
                                                        ...filter.style
                                                    }}
                                                    alt={`Slot ${slot.id}`}
                                                />
                                            </div>
                                        )
                                    })}

                                    {/* Frame Overlay Image */}
                                    <img
                                        src={`file:///${sessionFrame.overlayPath.replace(/\\/g, '/')}`}
                                        className={styles.frameOverlay}
                                        alt="Frame Overlay"
                                    />
                                </div>

                                {/* Plain White Text Overlay in Center of Active Frame that Fades In and Out after 2 Seconds */}
                                {isCenter && (
                                    <AnimatePresence>
                                        {showOverlayText && (
                                            <motion.div
                                                key={filter.id}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                transition={{ duration: 0.45, ease: 'easeInOut' }}
                                                className={styles.filterOverlayBadge}
                                            >
                                                {filter.name}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                )}
                            </motion.div>
                        )
                    })}
                </div>
            </div>

            {/* Bottom Floating Control Bar with Dedicated 1, 2, 3 Actions */}
            <div className={styles.bottomActionBar}>
                {/* Button 1: Next Filter */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnFilter}`}
                    onClick={handleNextFilter}
                    title="Tekan 1 untuk melihat filter selanjutnya"
                >
                    <span className={styles.btnNumber}>1</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Filter Selanjutnya</span>
                        <span className={styles.btnSublabel}>{currentFilterDef.name} ➔</span>
                    </div>
                </button>

                {/* Button 2: Toggle Mirror Output */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnMirror} ${isMirrored ? styles.mirrorActive : ''}`}
                    onClick={handleToggleMirror}
                    title="Tekan 2 untuk memilih mode Mirror Output"
                >
                    <span className={styles.btnNumber}>2</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Mirror Output</span>
                        <span className={styles.btnSublabel}>{isMirrored ? '🪞 Aktif (ON)' : '📷 Normal (OFF)'}</span>
                    </div>
                </button>

                {/* Button 3: Next Step to Output Page */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnNext}`}
                    onClick={handleNextStep}
                    title="Tekan 3 untuk lanjut ke halaman berikutnya"
                >
                    <span className={styles.btnNumber}>3</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Lanjutkan</span>
                        <span className={styles.btnSublabel}>Ke Output ➔</span>
                    </div>
                </button>
            </div>

            {/* Confirm Back Home Modal */}
            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={() => {
                    endSession()
                    navigate('/')
                }}
            />
        </motion.div>
    )
}

export default ReviewSession

