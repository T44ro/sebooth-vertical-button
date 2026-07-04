import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
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

const ReviewSession: React.FC = () => {
    const navigate = useNavigate()
    const { 
        currentSession, 
        photos, 
        updatePhoto, 
        swapPhotos, 
        removePhoto,
        selectedFilter,
        setSessionFilter,
        endSession,
        isMirrored,
        setIsMirrored
    } = useSessionStore()
    const { frames } = useFrameStore()
    const { config } = useAppConfig()
    
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
    const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({})
    const [isPreviewMode, setIsPreviewMode] = useState(false)
    const [previewIndex, setPreviewIndex] = useState(0)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!currentSession || photos.length === 0) {
            navigate('/capture')
        }
    }, [currentSession, photos, navigate])

    useEffect(() => {
        if (config && config.mirrorOutput !== undefined) {
            setIsMirrored(config.mirrorOutput)
        }
    }, [config, setIsMirrored])

    if (!currentSession) return null

    const sessionFrame = frames.find(f => f.id === currentSession.frameId)
    if (!sessionFrame) return null

    const getScale = () => {
        if (!containerRef.current) return 1
        // Workspace now fills available space, account for padding
        const padding = 80 // padding from .workspace
        const availableWidth = containerRef.current.clientWidth - padding
        const availableHeight = containerRef.current.clientHeight - padding
        const scaleX = availableWidth / sessionFrame.canvasWidth
        const scaleY = availableHeight / sessionFrame.canvasHeight
        return Math.min(scaleX, scaleY)
    }

    // Compute full transform including translation so scaled canvas stays centered
    const getCanvasTransform = () => {
        const scale = getScale()
        if (!containerRef.current) return { transform: `scale(${scale})`, transformOrigin: 'center center' }
        const cw = containerRef.current.clientWidth
        const ch = containerRef.current.clientHeight

        const scaledW = sessionFrame.canvasWidth * scale
        const scaledH = sessionFrame.canvasHeight * scale

        const translateX = Math.round((cw - scaledW) / 2)
        const translateY = Math.round((ch - scaledH) / 2)

        // translate first, then scale. Use top-left origin so slot left/top coordinates map as-is
        return {
            transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
            transformOrigin: 'top left'
        }
    }

    const handleWheel = (e: React.WheelEvent, slotId: string) => {
        if (selectedSlotId !== slotId) return
        
        const selectedSlot = sessionFrame.slots.find(s => s.id === slotId)
        const sourceSlotId = selectedSlot?.duplicateOfSlotId || slotId
        const photo = photos.find(p => p.slotId === sourceSlotId)
        if (!photo) return
        
        const currentScale = photo.scale || 1
        const zoomSensitivity = 0.05
        
        let newScale = currentScale + (e.deltaY < 0 ? zoomSensitivity : -zoomSensitivity)
        newScale = Math.max(0.5, Math.min(newScale, 5))
        
        updatePhoto(sourceSlotId, { scale: newScale })
    }

    const handleZoomIn = () => {
        if (!selectedSlotId) return
        const selectedSlot = sessionFrame.slots.find(s => s.id === selectedSlotId)
        const sourceSlotId = selectedSlot?.duplicateOfSlotId || selectedSlotId
        const photo = photos.find(p => p.slotId === sourceSlotId)
        if (!photo) return
        const newScale = Math.min((photo.scale || 1) + 0.1, 5)
        updatePhoto(sourceSlotId, { scale: newScale })
    }

    const handleZoomOut = () => {
        if (!selectedSlotId) return
        const selectedSlot = sessionFrame.slots.find(s => s.id === selectedSlotId)
        const sourceSlotId = selectedSlot?.duplicateOfSlotId || selectedSlotId
        const photo = photos.find(p => p.slotId === sourceSlotId)
        if (!photo) return
        const newScale = Math.max((photo.scale || 1) - 0.1, 0.5)
        updatePhoto(sourceSlotId, { scale: newScale })
    }

    const handleRetake = () => {
        if (!selectedSlotId) return
        const selectedSlot = sessionFrame.slots.find(s => s.id === selectedSlotId)
        const sourceSlotId = selectedSlot?.duplicateOfSlotId || selectedSlotId
        removePhoto(sourceSlotId)
        navigate('/capture')
    }

    const handleSwipe = (direction: 'left' | 'right') => {
        const filledSlots = sessionFrame.slots.filter(slot => {
            const sourceSlotId = slot.duplicateOfSlotId || slot.id
            return photos.some(p => p.slotId === sourceSlotId)
        })
        
        if (direction === 'left' && previewIndex < filledSlots.length - 1) {
            setPreviewIndex(previewIndex + 1)
        } else if (direction === 'right' && previewIndex > 0) {
            setPreviewIndex(previewIndex - 1)
        }
    }

    const handlePreviewRetake = () => {
        const filledSlots = sessionFrame.slots.filter(slot => {
            const sourceSlotId = slot.duplicateOfSlotId || slot.id
            return photos.some(p => p.slotId === sourceSlotId)
        })
        const currentSlot = filledSlots[previewIndex]
        if (currentSlot) {
            const sourceSlotId = currentSlot.duplicateOfSlotId || currentSlot.id
            removePhoto(sourceSlotId)
            navigate('/capture')
        }
    }

    // Auto select first slot
    useEffect(() => {
        if (!selectedSlotId && sessionFrame.slots.length > 0) {
            const firstFilledSlot = sessionFrame.slots.find(slot => {
                const sourceSlotId = slot.duplicateOfSlotId || slot.id
                return photos.some(p => p.slotId === sourceSlotId)
            })
            setSelectedSlotId(firstFilledSlot?.id || sessionFrame.slots[0].id)
        }
    }, [selectedSlotId, sessionFrame, photos])

    // Reset preview index when entering preview mode
    useEffect(() => {
        if (isPreviewMode) {
            setPreviewIndex(0)
        }
    }, [isPreviewMode])

    // Retrieve current filter style
    const currentFilterDef = FILTERS.find(f => f.id === selectedFilter);
    const filterStyle = currentFilterDef ? currentFilterDef.style : {};

    const selectedPhoto = selectedSlotId 
        ? (() => {
            const selectedSlot = sessionFrame.slots.find(s => s.id === selectedSlotId)
            const sourceSlotId = selectedSlot?.duplicateOfSlotId || selectedSlotId
            return photos.find(p => p.slotId === sourceSlotId)
        })()
        : (() => {
            const firstFilledSlot = sessionFrame.slots.find(slot => {
                const sourceSlotId = slot.duplicateOfSlotId || slot.id
                return photos.some(p => p.slotId === sourceSlotId)
            })
            const sourceSlotId = firstFilledSlot?.duplicateOfSlotId || firstFilledSlot?.id
            return sourceSlotId ? photos.find(p => p.slotId === sourceSlotId) : photos[0]
        })()

    return (
        <motion.div 
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setIsConfirmModalOpen(true)}
                title="Back to Home"
                style={{
                    position: 'fixed',
                    top: '20px',
                    left: '20px',
                    padding: '6px 12px',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '10px',
                    zIndex: 100
                }}
            >
                ← Kembali
            </motion.button>
            {!isPreviewMode ? (
                <div className={styles.mainLayout}>
                    {/* Main Workspace - Takes most of the space */}
                    <div className={styles.workspace} ref={containerRef}>
                                        <div
                                            className={styles.canvasContainer}
                                            style={{
                                                width: sessionFrame.canvasWidth,
                                                height: sessionFrame.canvasHeight,
                                                transform: `scale(${getScale()})`,
                                                transformOrigin: 'center center'
                                            }}
                                        >
                            {sessionFrame.slots.map(slot => {
                                const sourceSlotId = slot.duplicateOfSlotId || slot.id
                                const photo = photos.find(p => p.slotId === sourceSlotId)
                                if (!photo) return null

                                const isSelected = selectedSlotId === slot.id
                                const motionKey = `${slot.id}-${photo.imagePath}`;

                                return (
                                    <div
                                        key={slot.id}
                                        className={`${styles.slotWrapper} ${isSelected ? styles.selected : ''}`}
                                        style={{
                                            left: slot.x,
                                            top: slot.y,
                                            width: slot.width,
                                            height: slot.height,
                                            transform: `rotate(${slot.rotation}deg)`,
                                            transformOrigin: 'center center',
                                            overflow: 'hidden'
                                        }}
                                        data-slot-id={slot.id} // crucial for target identification
                                        onPointerDown={() => setSelectedSlotId(slot.id)}
                                        onWheel={(e) => handleWheel(e, slot.id)}
                                    >
                                        <img
                                            key={motionKey}
                                            src={photo.imagePath}
                                            className={styles.photoImage}
                                            draggable={false}
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover',
                                                transform: `scale(${photo.scale || 1}) scaleX(${isMirrored ? -1 : 1})`,
                                                transformOrigin: 'center center',
                                                ...filterStyle
                                            }}
                                        />
                                    </div>
                                )
                            })}

                            <img
                                src={`file:///${sessionFrame.overlayPath.replace(/\\/g, '/')}`}
                                className={styles.frameOverlay}
                                alt="Frame Override"
                            />
                        </div>
                    </div>

                    {/* Right Sidebar with all controls */}
                    <div className={styles.rightSidebar}>
                        <div className={styles.controlsSection}>
                            <div className={styles.toolGroup}>
                                <button
                                    className={styles.toolButton}
                                    onClick={handleZoomOut}
                                    disabled={!selectedSlotId}
                                    title="Zoom Out"
                                >
                                    -
                                </button>
                                <button
                                    className={styles.toolButton}
                                    onClick={handleZoomIn}
                                    disabled={!selectedSlotId}
                                    title="Zoom In"
                                >
                                    +
                                </button>
                            </div>

                            <div className={styles.toolGroup}>
                                <button
                                    className={styles.retakeBtn}
                                    disabled={!selectedSlotId}
                                    onClick={handleRetake}
                                >
                                    📸 Retake Selected
                                </button>
                            </div>

                            <div className={styles.filterTabs}>
                                {FILTERS.map(filter => (
                                    <button
                                        key={filter.id}
                                        className={`${styles.filterBtn} ${selectedFilter === filter.id ? styles.active : ''}`}
                                        onClick={() => setSessionFilter(filter.id)}
                                    >
                                        <div className={styles.filterPreview} style={filter.style}>
                                            {selectedPhoto && <img src={selectedPhoto.imagePath} alt={filter.name} />}
                                        </div>
                                        <span>{filter.name}</span>
                                    </button>
                                ))}
                            </div>
                            <div className={styles.mirrorGroup}>
                                <span>Mirror Output</span>
                                <label className={styles.toggleSwitch}>
                                    <input
                                        type="checkbox"
                                        checked={isMirrored}
                                        onChange={(e) => setIsMirrored(e.target.checked)}
                                    />
                                    <span className={styles.toggleSlider}></span>
                                </label>
                            </div>

                            <button className={styles.nextBtn} onClick={() => navigate('/output')}>
                                Next Step ➔
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className={styles.previewContainer}>
                    <div className={styles.previewPhotoContainer}>
                        {(() => {
                            const filledSlots = sessionFrame.slots.filter(slot => {
                                const sourceSlotId = slot.duplicateOfSlotId || slot.id
                                return photos.some(p => p.slotId === sourceSlotId)
                            })
                            const currentSlot = filledSlots[previewIndex]
                            const sourceSlotId = currentSlot?.duplicateOfSlotId || currentSlot?.id
                            const photo = sourceSlotId ? photos.find(p => p.slotId === sourceSlotId) : null
                            
                            return photo ? (
                                <div className={styles.previewPhotoWrapper}>
                                    <motion.div 
                                        className={styles.previewPhoto}
                                        drag="x"
                                        dragConstraints={{ left: 0, right: 0 }}
                                        dragElastic={0.2}
                                        onDragEnd={(event, info) => {
                                            const threshold = 50;
                                            if (info.offset.x > threshold) {
                                                handleSwipe('right');
                                            } else if (info.offset.x < -threshold) {
                                                handleSwipe('left')
                                            }
                                        }}
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <img 
                                            src={photo.imagePath} 
                                            alt={`Photo ${previewIndex + 1}`}
                                            style={{
                                                ...filterStyle,
                                                transform: `scaleX(${isMirrored ? -1 : 1})`
                                            }}
                                        />
                                    </motion.div>
                                    
                                    {/* Navigation buttons below the image */}
                                    <div className={styles.navigationButtons}>
                                        <button 
                                            className={styles.navBtn} 
                                            onClick={() => handleSwipe('right')}
                                            disabled={previewIndex === 0}
                                        >
                                            ‹
                                        </button>
                                        <div className={styles.photoIndicator}>
                                            {previewIndex + 1} / {filledSlots.length}
                                        </div>
                                        <button 
                                            className={styles.navBtn} 
                                            onClick={() => handleSwipe('left')}
                                            disabled={previewIndex === filledSlots.length - 1}
                                        >
                                            ›
                                        </button>
                                    </div>
                                </div>
                            ) : null
                        })()}
                    </div>
                    
                    <div className={styles.previewControls}>
                        <button 
                            className={styles.retakeBtn}
                            onClick={handlePreviewRetake}
                        >
                            📸 Retake This Photo
                        </button>
                        <button 
                            className={styles.continueBtn}
                            onClick={() => setIsPreviewMode(false)}
                        >
                            Continue to Edit
                        </button>
                    </div>
                </div>
            )}

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
