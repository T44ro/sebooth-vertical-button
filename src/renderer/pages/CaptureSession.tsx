import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFrameStore, useSessionStore, useAppConfig, useCameraStore } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import styles from './CaptureSession.module.css'

type CaptureState = 'idle' | 'countdown' | 'capturing' | 'preview' | 'reviewPopup'

// Audio Context for beeps
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
const playBeep = (freq = 800, duration = 150, vol = 0.5) => {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume()
        const oscillator = audioCtx.createOscillator()
        const gainNode = audioCtx.createGain()
        
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime)
        
        gainNode.gain.setValueAtTime(vol, audioCtx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration / 1000)
        
        oscillator.connect(gainNode)
        gainNode.connect(audioCtx.destination)
        
        oscillator.start()
        oscillator.stop(audioCtx.currentTime + duration / 1000)
    } catch (e) {
        console.warn('Audio play failed:', e)
    }
}

function CaptureSession(): JSX.Element {
    const navigate = useNavigate()
    const { frames, activeFrame } = useFrameStore()
    const { config } = useAppConfig()
    const { photos, addPhoto, startSession, currentSession } = useSessionStore()
    const { isConnected } = useCameraStore()

    const [captureState, setCaptureState] = useState<CaptureState>('idle')
    const [countdown, setCountdown] = useState(config.countdownDuration)
    const [currentSlotIndex, setCurrentSlotIndex] = useState(0)
    const [lastCapturedImage, setLastCapturedImage] = useState<string | null>(null)
    const [isLoadingCamera, setIsLoadingCamera] = useState(true)
    const [cameraError, setCameraError] = useState<string | null>(null)
    const [isGalleryExpanded, setIsGalleryExpanded] = useState(false)
    const [reviewPhotoIndex, setReviewPhotoIndex] = useState(0)

    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const viewfinderRef = useRef<HTMLDivElement>(null)

    // Live Photo video recording refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const videoChunksRef = useRef<Blob[]>([])
    const recordingStartTimeRef = useRef<number>(0)

    // Get active frame from store or first available
    const currentFrame = activeFrame || frames[0]

    // Get only non-duplicate slots (these are the ones user needs to capture)
    const captureSlots = currentFrame?.slots.filter(s => !s.duplicateOfSlotId) || []

    // Derive aspect ratio from first capturable slot
    const slotAspectRatio = captureSlots[0]
        ? `${captureSlots[0].width} / ${captureSlots[0].height}`
        : '4 / 3'

    const slotAspectNumeric = captureSlots[0]
        ? captureSlots[0].width / captureSlots[0].height
        : 4 / 3

    const [safeArea, setSafeArea] = useState({ left: 0, top: 0, width: 0, height: 0 })

    const updateSafeArea = () => {
        const vf = viewfinderRef.current
        if (!vf) return
        const W = vf.clientWidth
        const H = vf.clientHeight
        const ratio = slotAspectNumeric || 4 / 3

        const safeW = Math.min(W, Math.round(H * ratio))
        const safeH = Math.round(safeW / ratio)
        const left = Math.round((W - safeW) / 2)
        const top = Math.round((H - safeH) / 2)

        setSafeArea({ left, top, width: safeW, height: safeH })
    }

    useEffect(() => {
        updateSafeArea()
        window.addEventListener('resize', updateSafeArea)
        return () => window.removeEventListener('resize', updateSafeArea)
    }, [slotAspectNumeric, captureSlots])

    // Start session on mount
    useEffect(() => {
        if (!currentSession && currentFrame) {
            startSession(currentFrame.id)
        }
    }, [currentSession, currentFrame, startSession])

    // Initialize webcam
    useEffect(() => {
        const initWebcam = async (): Promise<void> => {
            setIsLoadingCamera(true)
            setCameraError(null)

            try {
                // Check if mediaDevices is available
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('Camera API not supported in this browser')
                }

                const videoConstraints: MediaTrackConstraints = {
                    width: { ideal: 1920, min: 640 },
                    height: { ideal: 1080, min: 480 },
                }

                if (config.selectedCameraId) {
                    videoConstraints.deviceId = { exact: config.selectedCameraId }
                } else {
                    videoConstraints.facingMode = 'user'
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: videoConstraints
                })
                streamRef.current = stream
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                }
                setIsLoadingCamera(false)
            } catch (error) {
                console.error('Failed to access webcam:', error)
                const err = error as Error
                let message = 'Failed to access camera'

                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    message = 'Camera permission denied. Please allow camera access.'
                } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    message = 'No camera found on this device.'
                } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                    message = 'Camera is being used by another application.'
                } else if (err.message) {
                    message = err.message
                }

                setCameraError(message)
                setIsLoadingCamera(false)
            }
        }

        initWebcam()

        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
            }
            if (countdownRef.current) {
                clearInterval(countdownRef.current)
            }
        }
    }, [])

    // Find next empty slot (skips duplicate slots)
    const getNextEmptySlot = useCallback(() => {
        if (!currentFrame) return null
        for (let i = 0; i < currentFrame.slots.length; i++) {
            const slot = currentFrame.slots[i]
            // Skip slots that are duplicates (they use another slot's photo)
            if (slot.duplicateOfSlotId) continue
            if (!photos.some(p => p.slotId === slot.id)) {
                return { slot, index: i }
            }
        }
        return null
    }, [currentFrame, photos])

    // Capture photo from video element - returns data URL
    const captureFromWebcam = useCallback((): string | null => {
        if (!videoRef.current || !canvasRef.current) return null

        const video = videoRef.current
        const canvas = canvasRef.current

        if (!video.videoWidth || !video.videoHeight) {
            console.warn('Webcam not ready for capture yet')
            return null
        }

        // Set canvas size to match video
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) return null

        // Mirror the image (flip horizontally) for selfie mode
        ctx.save()
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        ctx.restore()

        // Return as data URL
        return canvas.toDataURL('image/jpeg', 0.92)
    }, [])

    // Handle countdown or immediate capture
    const startCountdown = useCallback((slotIndex: number) => {
        setCurrentSlotIndex(slotIndex)

        // If timer is disabled, capture immediately
        if (!config.timerEnabled) {
            triggerCapture(slotIndex)
            return
        }

        setCaptureState('countdown')
        setCountdown(config.countdownDuration)

        // Start video recording for Live Photo
        if (streamRef.current && !mediaRecorderRef.current) {
            try {
                // Find supported mimeType for this browser
                const mimeTypes = [
                    'video/webm;codecs=vp9',
                    'video/webm;codecs=vp8',
                    'video/webm',
                    'video/mp4'
                ]
                let selectedMimeType = ''
                for (const type of mimeTypes) {
                    if (MediaRecorder.isTypeSupported(type)) {
                        selectedMimeType = type
                        break
                    }
                }

                const options: MediaRecorderOptions = {}
                if (selectedMimeType) {
                    options.mimeType = selectedMimeType
                }

                const mediaRecorder = new MediaRecorder(streamRef.current, options)
                videoChunksRef.current = []
                recordingStartTimeRef.current = Date.now()

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        videoChunksRef.current.push(event.data)
                        // Keep only last 6 seconds of chunks (5s + buffer)
                        const maxChunks = 12 // 500ms intervals * 12 = 6 seconds
                        if (videoChunksRef.current.length > maxChunks) {
                            videoChunksRef.current = videoChunksRef.current.slice(-maxChunks)
                        }
                    }
                }

                mediaRecorder.start(500) // Collect data every 500ms
                mediaRecorderRef.current = mediaRecorder
            } catch (err) {
                console.error('Failed to start MediaRecorder:', err)
            }
        }

        // Initial beep
        playBeep(800, 150)

        countdownRef.current = window.setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    if (countdownRef.current) {
                        clearInterval(countdownRef.current)
                    }
                    // Capture beep (higher pitch, longer duration)
                    playBeep(1200, 300)
                    triggerCapture(slotIndex)
                    return 0
                }
                // Standard countdown beep
                playBeep(800, 150)
                return prev - 1
            })
        }, 1000)
    }, [config.countdownDuration, config.timerEnabled])

    // Trigger capture - uses webcam directly
    const triggerCapture = (slotIndex: number): void => {
        if (!currentFrame) return

        setCaptureState('capturing')
        const slot = currentFrame.slots[slotIndex]

        // Helper to complete capture after optional video save
        const completeCapture = (videoUrl?: string) => {
            // Small delay for flash effect
            setTimeout(async () => {
                let dataUrl: string | null = null;

                // Attempt native DSLR capture first (skip for webcam/mock mode)
                try {
                    if (config.cameraMode !== 'mock') {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const windowApi = (window as any).api;
                        if (windowApi && windowApi.camera && windowApi.camera.capture) {
                            const captureRes = await windowApi.camera.capture(slot?.id);
                            if (captureRes.success && captureRes.data && captureRes.data.imagePath) {
                                // Convert physical path to local file URL
                                dataUrl = `file:///${captureRes.data.imagePath.replace(/\\/g, '/')}`;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Native camera capture failed, falling back to webcam:', e);
                }

                // Fallback to webcam screenshot if native capture failed or is unavailable
                if (!dataUrl) {
                    dataUrl = captureFromWebcam()
                }

                if (dataUrl) {
                    setLastCapturedImage(dataUrl)

                    // Save photo to session store with video for Live Photo
                    if (slot) {
                        addPhoto(slot.id, dataUrl, videoUrl)
                    }

                    // Show preview
                    setCaptureState('preview')

                    setTimeout(() => {
                        setCaptureState('idle')

                        // Auto-advance to next slot
                        const next = getNextEmptySlot()
                        if (next) {
                            setCurrentSlotIndex(next.index)
                        }
                    }, config.previewDuration * 1000)
                } else {
                    console.error('Failed to capture from webcam')
                    setCaptureState('idle')
                }
            }, 100)
        }

        // Stop video recording and get video data URL
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            const recorder = mediaRecorderRef.current

            // Set up onstop to create blob after all data is collected
            recorder.onstop = async () => {
                if (videoChunksRef.current.length > 0) {
                    const mimeType = recorder.mimeType.split(';')[0] || 'video/webm'
                    const ext = mimeType === 'video/mp4' ? 'mp4' : 'webm'
                    const videoBlob = new Blob(videoChunksRef.current, { type: mimeType })

                    try {
                        // Convert blob to base64 data URL so we can save it to temp disk
                        const reader = new FileReader();
                        reader.readAsDataURL(videoBlob);
                        reader.onloadend = async () => {
                            const base64data = reader.result as string;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const windowApi = (window as any).api;
                            const tempPathRes = await windowApi.system.saveDataUrl(base64data, `temp_video_${Date.now()}.${ext}`);

                            if (tempPathRes.success && tempPathRes.data) {
                                completeCapture(`file:///${tempPathRes.data.replace(/\\/g, '/')}`);
                            } else {
                                console.error('Failed to save temp video:', tempPathRes.error);
                                // Fallback to blob if temp save fails (though backend can't read it later)
                                completeCapture(URL.createObjectURL(videoBlob));
                            }
                        }
                    } catch (e) {
                        console.error('Error saving video blob:', e);
                        completeCapture(URL.createObjectURL(videoBlob));
                    }
                } else {
                    completeCapture()
                }
                videoChunksRef.current = []
            }

            recorder.stop()
            mediaRecorderRef.current = null
        } else {
            completeCapture()
        }
    }
    // Handle ready button
    const handleReady = (): void => {
        const next = getNextEmptySlot()
        if (next) {
            startCountdown(next.index)
        } else if (currentFrame && currentFrame.slots.length > 0) {
            // Retake first slot if all filled
            startCountdown(0)
        }
    }

    // Handle slot click
    const handleSlotClick = (slotIndex: number): void => {
        if (captureState === 'idle') {
            startCountdown(slotIndex)
        }
    }

    // Check if all non-duplicate slots are filled
    const allSlotsFilled = captureSlots.every(slot =>
        photos.some(p => p.slotId === slot.id)
    )

    // Auto-navigate to review popup when all slots are filled
    useEffect(() => {
        if (allSlotsFilled && captureState === 'idle') {
            setCaptureState('reviewPopup')
            setReviewPhotoIndex(0)
        }
    }, [allSlotsFilled, captureState])

    // Navigate to processing
    const handleDone = (): void => {
        navigate('/review')
    }

    // Handle retake from review popup
    const handleRetakeFromPopup = () => {
        const filledSlots = captureSlots.filter(slot =>
            photos.some(p => p.slotId === slot.id)
        )
        const currentSlot = filledSlots[reviewPhotoIndex]
        if (currentSlot) {
            const sourceSlotId = currentSlot.duplicateOfSlotId || currentSlot.id
            // Remove the photo
            const { removePhoto } = useSessionStore.getState()
            removePhoto(sourceSlotId)
            // Go back to capture mode
            setCaptureState('idle')
            // Find the slot index to retake
            const slotIndex = captureSlots.findIndex(slot => slot.id === currentSlot.id)
            if (slotIndex !== -1) {
                setCurrentSlotIndex(slotIndex)
            }
        }
    }

    // Handle continue to review
    const handleContinueToReview = () => {
        navigate('/review')
    }

    // Navigate to next photo in review popup
    const handleNextPhoto = () => {
        const filledSlots = captureSlots.filter(slot =>
            photos.some(p => p.slotId === slot.id)
        )
        if (reviewPhotoIndex < filledSlots.length - 1) {
            setReviewPhotoIndex(reviewPhotoIndex + 1)
        }
    }

    // Navigate to previous photo in review popup
    const handlePrevPhoto = () => {
        if (reviewPhotoIndex > 0) {
            setReviewPhotoIndex(reviewPhotoIndex - 1)
        }
    }

    if (!currentFrame) {
        return (
            <div className={styles.container}>
                <div className={styles.noFrame}>
                    <h2>No Frame Selected</h2>
                    <p>Please select a frame first.</p>
                    <button onClick={() => navigate('/frames')}>Select Frame</button>
                </div>
            </div>
        )
    }

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* Hidden canvas for webcam capture */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Session Timer Overlay */}
            <SessionTimer
                duration={config.captureTimeout}
                onTimeout={() => navigate('/review')}
                enabled={config.sessionTimerEnabled}
                label="Capture Session"
            />

            {/* Main Capture Area */}
            <div className={styles.captureArea}>
                {/* Controls Bar - No back button to prevent timer circumvention */}
                <div className={styles.controlsBar}>
                    <h2 className={styles.frameName}>{currentFrame.name}</h2>
                    <div className={styles.controlsRight}>
                        <span className={styles.photoCount}>
                            {photos.length < captureSlots.length
                                ? `Photo ${photos.length + 1} of ${captureSlots.length}`
                                : `${photos.length} of ${captureSlots.length} ✓`}
                        </span>
                    </div>
                </div>

                {/* Live Viewfinder */}
                <div
                    className={styles.viewfinder}
                    style={{ aspectRatio: slotAspectRatio }}
                    ref={viewfinderRef}
                >
                    {/* Camera Feed */}
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className={styles.video}
                    />

                    {/* Loading Overlay */}
                    {isLoadingCamera && (
                        <div className={styles.loadingOverlay}>
                            <div className={styles.spinner}></div>
                            <p>Initializing camera...</p>
                        </div>
                    )}

                    {/* Camera Error Overlay */}
                    {cameraError && (
                        <div className={styles.errorOverlay}>
                            <span className={styles.errorIcon}>📷</span>
                            <h3>Camera Error</h3>
                            <p>{cameraError}</p>
                            <button
                                onClick={() => window.location.reload()}
                                className={styles.retryButton}
                            >
                                🔄 Retry
                            </button>
                        </div>
                    )}

                    {/* Countdown Overlay */}
                    <AnimatePresence>
                        {captureState === 'countdown' && (
                            <motion.div
                                className={styles.countdownOverlay}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            >
                                <motion.span
                                    key={countdown}
                                    className={styles.countdownNumber}
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 1.5, opacity: 0 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    {countdown}
                                </motion.span>
                                <span className={styles.slotIndicator}>
                                    Photo {captureSlots.findIndex(s => s.id === currentFrame.slots[currentSlotIndex]?.id) + 1} of {captureSlots.length}
                                </span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Capturing Flash */}
                    <AnimatePresence>
                        {captureState === 'capturing' && (
                            <motion.div
                                className={styles.flashOverlay}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.1 }}
                            />
                        )}
                    </AnimatePresence>

                    {/* Preview */}
                    <AnimatePresence>
                        {captureState === 'preview' && lastCapturedImage && (
                            <motion.div
                                className={styles.previewOverlay}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0 }}
                            >
                                <img
                                    src={lastCapturedImage}
                                    alt="Captured"
                                    className={styles.previewImage}
                                />
                                <div className={styles.previewBadge}>
                                    <span className={styles.checkmark}>✓</span>
                                    Photo {captureSlots.findIndex(s => s.id === currentFrame.slots[currentSlotIndex]?.id) + 1} saved!
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Ready Button */}
                {captureState === 'idle' && (
                    <div className={styles.readyButtonContainer}>
                        <motion.button
                            className={styles.readyButton}
                            onClick={handleReady}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            📸 {allSlotsFilled ? 'Retake Photo' : 'Take Photo'}
                        </motion.button>
                    </div>
                )}

                    {/* Safe area overlay: left/right black bars and transparent center */}
                    <div className={styles.safeAreaOverlay} aria-hidden>
                        <div className={styles.leftBar} style={{ width: safeArea.left }} />
                        <div className={styles.rightBar} style={{ left: safeArea.left + safeArea.width, width: safeArea.left }} />
                        <div className={styles.centerBox} style={{ left: safeArea.left, top: safeArea.top, width: safeArea.width, height: safeArea.height }} />
                    </div>
            </div>

            {/* Floating Photo Gallery Overlay */}
            <div className={`${styles.floatingGallery} ${isGalleryExpanded ? styles.expanded : ''}`}>
                <div 
                    className={styles.galleryToggle}
                    onClick={() => setIsGalleryExpanded(!isGalleryExpanded)}
                >
                    {/* Always show the last photo (or a placeholder) as the toggle icon */}
                    {photos.length > 0 ? (
                        <div className={styles.toggleThumbnail}>
                            <img src={photos[photos.length - 1].imagePath} alt="Last Capture" />
                            <span className={styles.photoCountBadge}>{photos.length}/{captureSlots.length}</span>
                        </div>
                    ) : (
                        <div className={styles.toggleThumbnailEmpty}>
                            📸 <span>{photos.length}/{captureSlots.length}</span>
                        </div>
                    )}
                </div>

                <AnimatePresence>
                    {isGalleryExpanded && (
                        <motion.div 
                            className={styles.galleryPanel}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 20, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                        >
                            <div className={styles.sidebarHeader}>
                                <h3>Your Photos</h3>
                                <button 
                                    className={styles.closeGalleryBtn} 
                                    onClick={() => setIsGalleryExpanded(false)}
                                >
                                    ✕
                                </button>
                            </div>
                            
                            <div className={styles.slotGridWrapper}>
                                <div className={styles.slotGrid}>
                                    {captureSlots.map((slot, sequentialIndex) => {
                                        const photo = photos.find(p => p.slotId === slot.id)
                                        const originalIndex = currentFrame.slots.findIndex(s => s.id === slot.id)
                                        const isCurrentSlot = currentSlotIndex === originalIndex && captureState !== 'idle'
            
                                        return (
                                            <motion.div
                                                key={slot.id}
                                                className={`${styles.slotThumbnail} ${photo ? styles.filled : ''} ${isCurrentSlot ? styles.active : ''}`}
                                                onClick={() => {
                                                    handleSlotClick(originalIndex)
                                                    setIsGalleryExpanded(false) // Optionally auto-close when retaking
                                                }}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                            >
                                                {photo ? (
                                                    <img src={photo.imagePath} alt={`Photo ${sequentialIndex + 1}`} />
                                                ) : (
                                                    <span className={styles.slotNumber}>{sequentialIndex + 1}</span>
                                                )}
                                                {photo && <span className={styles.retakeHint}>Tap to retake</span>}
                                            </motion.div>
                                        )
                                    })}
                                </div>
                            </div>
            
                            <motion.button
                                className={`${styles.doneButton} ${allSlotsFilled ? styles.ready : ''}`}
                                onClick={handleDone}
                                disabled={photos.length === 0 || captureState === 'reviewPopup'}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                {allSlotsFilled ? '✨ Continue to Edit' : `${photos.length}/${captureSlots.length} Photos`}
                            </motion.button>

                            <div className={styles.connectionStatus}>
                                <span className={`${styles.statusDot} ${isConnected ? styles.connected : ''}`} />
                                {isConnected ? 'Camera Connected' : 'Using Webcam'}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Review Popup */}
                <AnimatePresence>
                    {captureState === 'reviewPopup' && (
                        <motion.div
                            className={styles.reviewPopupOverlay}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className={styles.reviewPopup}
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.8, opacity: 0 }}
                            >
                                <div className={styles.reviewPopupHeader}>
                                    <h3>Review Your Photos</h3>
                                    <p className={styles.swipeHint}>Swipe or use buttons to navigate</p>
                                </div>

                                <div className={styles.reviewPopupPhoto}>
                                    {(() => {
                                        const filledSlots = captureSlots.filter(slot =>
                                            photos.some(p => p.slotId === slot.id)
                                        )
                                        const currentSlot = filledSlots[reviewPhotoIndex]
                                        const photo = currentSlot ? photos.find(p => p.slotId === (currentSlot.duplicateOfSlotId || currentSlot.id)) : null

                                        return photo ? (
                                            <div className={styles.photoWrapper}>
                                                <motion.div
                                                    className={styles.photoContainer}
                                                    drag="x"
                                                    dragConstraints={{ left: 0, right: 0 }}
                                                    dragElastic={0.2}
                                                    onDragEnd={(event, info) => {
                                                        const threshold = 100;
                                                        if (info.offset.x > threshold) {
                                                            handlePrevPhoto();
                                                        } else if (info.offset.x < -threshold) {
                                                            handleNextPhoto();
                                                        }
                                                    }}
                                                    initial={{ opacity: 0, scale: 0.8 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.8 }}
                                                    transition={{ duration: 0.3 }}
                                                >
                                                    <img src={photo.imagePath} alt={`Photo ${reviewPhotoIndex + 1}`} />
                                                </motion.div>
                                                
                                                {/* Navigation buttons below the image */}
                                                <div className={styles.navigationButtons}>
                                                    <button 
                                                        className={styles.navBtn} 
                                                        onClick={handlePrevPhoto}
                                                        disabled={reviewPhotoIndex === 0}
                                                    >
                                                        ‹
                                                    </button>
                                                    <span className={styles.photoCounter}>
                                                        {(() => {
                                                            const filledSlots = captureSlots.filter(slot =>
                                                                photos.some(p => p.slotId === slot.id)
                                                            )
                                                            return `${reviewPhotoIndex + 1}/${filledSlots.length}`
                                                        })()}
                                                    </span>
                                                    <button 
                                                        className={styles.navBtn} 
                                                        onClick={handleNextPhoto}
                                                        disabled={(() => {
                                                            const filledSlots = captureSlots.filter(slot =>
                                                                photos.some(p => p.slotId === slot.id)
                                                            )
                                                            return reviewPhotoIndex >= filledSlots.length - 1
                                                        })()}
                                                    >
                                                        ›
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null
                                    })()}
                                </div>

                                <div className={styles.reviewPopupControls}>
                                    <button
                                        className={styles.retakeBtn}
                                        onClick={handleRetakeFromPopup}
                                    >
                                        📸 Retake This Photo
                                    </button>
                                    <button
                                        className={styles.continueBtn}
                                        onClick={handleContinueToReview}
                                    >
                                        Continue to Edit ✨
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    )
}

export default CaptureSession
