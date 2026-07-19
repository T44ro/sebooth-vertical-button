import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFrameStore, useSessionStore, useAppConfig, useCameraStore } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
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
    const { config, updateConfig } = useAppConfig()
    const { photos, addPhoto, startSession, currentSession, endSession } = useSessionStore()
    const { isConnected } = useCameraStore()

    const [captureState, setCaptureState] = useState<CaptureState>('idle')
    const [countdown, setCountdown] = useState(config.countdownDuration)
    const [currentSlotIndex, setCurrentSlotIndex] = useState(0)
    const [lastCapturedImage, setLastCapturedImage] = useState<string | null>(null)
    const [isLoadingCamera, setIsLoadingCamera] = useState(true)
    const [cameraError, setCameraError] = useState<string | null>(null)
    const [isGalleryExpanded, setIsGalleryExpanded] = useState(false)
    const [reviewPhotoIndex, setReviewPhotoIndex] = useState(0)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const [isAdjustPanelOpen, setIsAdjustPanelOpen] = useState(false)

    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const viewfinderRef = useRef<HTMLDivElement>(null)

    // digiCamControl Live View refs
    const [digicamLiveViewUrl, setDigicamLiveViewUrl] = useState<string | null>(null)
    const [digicamLiveViewKey, setDigicamLiveViewKey] = useState(0)
    const digicamLiveViewTimer = useRef<ReturnType<typeof setInterval> | null>(null)

    // Live Photo video recording refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const videoChunksRef = useRef<Blob[]>([])
    const recordingStartTimeRef = useRef<number>(0)

    // Get active frame from store or first available
    const currentFrame = activeFrame || frames[0]

    // Get only non-duplicate slots (these are the ones user needs to capture)
    const captureSlots = useMemo(() => {
        return currentFrame?.slots.filter(s => !s.duplicateOfSlotId) || []
    }, [currentFrame?.slots])

    // Derive aspect ratio from first capturable slot
    const slotAspectRatio = captureSlots[0]
        ? `${captureSlots[0].width} / ${captureSlots[0].height}`
        : '4 / 3'

    const slotAspectNumeric = captureSlots[0]
        ? captureSlots[0].width / captureSlots[0].height
        : 4 / 3

    const [safeArea, setSafeArea] = useState({ left: 0, top: 0, width: 0, height: 0 })
    const [viewfinderSize, setViewfinderSize] = useState({ width: 0, height: 0 })

    const updateSafeArea = () => {
        const vf = viewfinderRef.current
        if (!vf) return
        const W = vf.clientWidth
        const H = vf.clientHeight
        setViewfinderSize({ width: W, height: H })
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
    const initWebcam = useCallback(async (): Promise<void> => {
        setIsLoadingCamera(true)
        setCameraError(null)

        // Stop any existing stream tracks first to release browser resource locks
        if (streamRef.current) {
            console.log('[CaptureSession] Stopping existing stream before re-initializing webcam...')
            try {
                streamRef.current.getTracks().forEach(track => track.stop())
            } catch (e) {
                console.warn('[CaptureSession] Failed to stop old stream tracks:', e)
            }
            streamRef.current = null
        }

        try {
            // Check if mediaDevices is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera API not supported in this browser')
            }

            let videoInputs: MediaDeviceInfo[] = []
            // Log all available video devices for debugging device ID changes
            try {
                const devices = await navigator.mediaDevices.enumerateDevices()
                videoInputs = devices.filter(d => d.kind === 'videoinput')
                console.log('[CaptureSession] Available video devices:')
                videoInputs.forEach((d, idx) => {
                    console.log(`  [Device ${idx}] Label: "${d.label}", ID: "${d.deviceId}"`)
                })
                console.log(`[CaptureSession] Configured selectedCameraId: "${config.selectedCameraId}"`)
            } catch (e) {
                console.warn('[CaptureSession] Failed to enumerate devices in initWebcam:', e)
            }

            let resolvedCameraId = config.selectedCameraId

            // Fallback matching if the configured ID is not connected/available
            if (config.selectedCameraId) {
                const idExists = videoInputs.some(d => d.deviceId === config.selectedCameraId)
                if (!idExists) {
                    console.warn(`[CaptureSession] Configured capture card ID (${config.selectedCameraId}) not found. Searching by label...`)
                    const match = videoInputs.find(d => {
                        const label = d.label.toLowerCase()
                        return label.includes('usb video') || label.includes('capture') || label.includes('hdmi') || label.includes('cam link')
                    })
                    if (match) {
                        console.log(`[CaptureSession] Automatically matched capture card by label: "${match.label}" -> ID: "${match.deviceId}"`)
                        resolvedCameraId = match.deviceId
                    }
                }
            }

            let videoConstraints: MediaTrackConstraints = {}

            if (resolvedCameraId) {
                videoConstraints.deviceId = { exact: resolvedCameraId }
                // Use ideal values only without strict mins to prevent OverconstrainedError on capture cards
                videoConstraints.width = { ideal: 1920 }
                videoConstraints.height = { ideal: 1080 }
            } else {
                videoConstraints.width = { ideal: 1920, min: 640 }
                videoConstraints.height = { ideal: 1080, min: 480 }
                videoConstraints.facingMode = 'user'
            }

            let stream: MediaStream
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: videoConstraints
                })
            } catch (innerError: any) {
                if (resolvedCameraId && (innerError.name === 'OverconstrainedError' || innerError.name === 'NotFoundError' || innerError.name === 'DevicesNotFoundError')) {
                    console.warn(`[CaptureSession] Resolved webcam ID (${resolvedCameraId}) not available/overconstrained. Error: ${innerError.name}. Falling back to default webcam...`)
                    videoConstraints = {
                        width: { ideal: 1920, min: 640 },
                        height: { ideal: 1080, min: 480 },
                        facingMode: 'user'
                    }
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: videoConstraints
                    })
                } else {
                    throw innerError
                }
            }

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
    }, [config.selectedCameraId])

    // Initialize webcam on mount
    useEffect(() => {
        initWebcam()
    }, [initWebcam])

    // Re-initialize webcam after it was stopped for DSLR capture
    useEffect(() => {
        // Do not initialize webcam if we are using native DSLR mode (edsdk/ptp) without a capture card
        const isNativeDslr = (config.cameraMode === 'ptp' || config.cameraMode === 'edsdk') && !config.selectedCameraId;
        if (isNativeDslr) {
            return;
        }

        if (captureState === 'idle' || captureState === 'countdown') {
            // Only re-init if stream was previously stopped (null) and we're not already loading
            if (!streamRef.current && !isLoadingCamera) {
                console.log('[CaptureSession] Re-initializing webcam after capture (state:', captureState, ')')
                initWebcam()
            }
        } else if ((captureState === 'capturing' || captureState === 'preview' || captureState === 'reviewPopup') && config.cameraMode !== 'mock' && !config.selectedCameraId) {
            if (streamRef.current) {
                console.log('[CaptureSession] Stopping webcam stream to release DSLR PTP lock (state:', captureState, ')')
                streamRef.current.getTracks().forEach(track => track.stop())
                streamRef.current = null
                if (videoRef.current) {
                    videoRef.current.srcObject = null
                }
            }
        }
    }, [captureState, config.cameraMode, config.selectedCameraId, initWebcam, isLoadingCamera])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
            }
            if (countdownRef.current) {
                clearInterval(countdownRef.current)
            }
            // Stop digiCamControl live view timer
            if (digicamLiveViewTimer.current) {
                clearInterval(digicamLiveViewTimer.current)
            }
            // Stop the camera live view to release mirror/resources
            // BUT: Only stop live view if we are actually navigating away from the capture page,
            // to prevent mirror drop and COM port resets during component re-renders/HMR.
            if (config.cameraMode === 'edsdk' || config.cameraMode === 'ptp') {
                const isStillOnCapture = window.location.pathname === '/capture' || window.location.hash.startsWith('#/capture');
                if (!isStillOnCapture) {
                    console.log('[CaptureSession] Navigating away from /capture. Stopping DSLR live view...');
                    window.api.camera.stopLiveView().catch(() => {})
                } else {
                    console.log('[CaptureSession] Component unmounted/re-rendered on same route. Keeping DSLR live view active.');
                }
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.cameraMode])

    // Unified camera and live preview stream initialization sequence
    useEffect(() => {
        let active = true;

        const initializeCamera = async () => {
            setIsLoadingCamera(true);
            setCameraError(null);

            const isDslr = config.cameraMode === 'edsdk' || config.cameraMode === 'ptp';
            const hasCaptureCard = !!config.selectedCameraId;

            try {
                // Step 1: Start DSLR Live View first to establish HDMI signal before opening capture card stream
                if (isDslr) {
                    console.log('[CaptureSession] Unified Init: Starting DSLR Live View...');
                    await window.api.camera.startLiveView();
                    
                    // Delay to let the HDMI transmitter/capture card hardware stabilize the video signal
                    if (hasCaptureCard) {
                        console.log('[CaptureSession] Unified Init: Waiting for HDMI signal stability (2000ms)...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                if (!active) return;

                // Step 2: Initialize Web Video Stream (Capture Card or Webcam)
                if (hasCaptureCard || !isDslr) {
                    console.log('[CaptureSession] Unified Init: Initializing webcam/capture card stream...');
                    await initWebcam();
                } else if (isDslr && !hasCaptureCard) {
                    // DSLR mode without capture card: start USB image polling
                    console.log('[CaptureSession] Unified Init: Starting USB live view polling...');
                    const urlResult = await window.api.camera.getLiveViewUrl();
                    if (urlResult.success && urlResult.data) {
                        setDigicamLiveViewUrl(urlResult.data);
                        // Poll for new frames
                        if (digicamLiveViewTimer.current) clearInterval(digicamLiveViewTimer.current);
                        digicamLiveViewTimer.current = setInterval(() => {
                            setDigicamLiveViewKey(k => k + 1);
                        }, 150);
                    }
                }
            } catch (error: any) {
                console.error('[CaptureSession] Unified Init Error:', error);
                setCameraError(error.message || 'Gagal memuat preview kamera');
            } finally {
                if (active) {
                    setIsLoadingCamera(false);
                }
            }
        };

        initializeCamera();

        return () => {
            active = false;
            if (digicamLiveViewTimer.current) {
                clearInterval(digicamLiveViewTimer.current);
                digicamLiveViewTimer.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.cameraMode, config.selectedCameraId, initWebcam])

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

        const rotation = config.cameraRotation || 0

        // If camera is rotated 90° or 270°, swap canvas width and height for portrait aspect
        if (rotation === 90 || rotation === 270) {
            canvas.width = video.videoHeight
            canvas.height = video.videoWidth
        } else {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
        }

        const ctx = canvas.getContext('2d')
        if (!ctx) return null

        ctx.save()
        if (rotation === 90) {
            ctx.translate(canvas.width / 2, canvas.height / 2)
            ctx.rotate((90 * Math.PI) / 180)
            ctx.scale(-1, 1)
            ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2, video.videoWidth, video.videoHeight)
        } else if (rotation === 270) {
            ctx.translate(canvas.width / 2, canvas.height / 2)
            ctx.rotate((270 * Math.PI) / 180)
            ctx.scale(-1, 1)
            ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2, video.videoWidth, video.videoHeight)
        } else if (rotation === 180) {
            ctx.translate(canvas.width / 2, canvas.height / 2)
            ctx.rotate((180 * Math.PI) / 180)
            ctx.scale(-1, 1)
            ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2, video.videoWidth, video.videoHeight)
        } else {
            // Standard 0deg mirror mode
            ctx.translate(canvas.width, 0)
            ctx.scale(-1, 1)
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        }
        ctx.restore()

        // Return as data URL
        return canvas.toDataURL('image/jpeg', 0.92)
    }, [config.cameraRotation])

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
        const useUsbLivePhoto = config.cameraMode === 'edsdk';
        const slot = currentFrame.slots[slotIndex];

        if (useUsbLivePhoto) {
            console.log('[CaptureSession] Starting clean USB Live Photo recording...');
            window.api.camera.startRecordingLivePhoto(slot.id).catch((err: any) => {
                console.error('[CaptureSession] Failed to start USB Live Photo recording:', err);
            });
        } else if (streamRef.current && !mediaRecorderRef.current) {
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

        countdownRef.current = (window.setInterval as any)(() => {
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

                console.log('[CaptureSession] Capture flow started. Config:', {
                    cameraMode: config.cameraMode,
                    selectedCameraId: config.selectedCameraId,
                    slotId: slot?.id
                });

                // Attempt native DSLR capture first (skip for webcam/mock mode)
                try {
                    if (config.cameraMode !== 'mock') {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const windowApi = (window as any).api;
                        console.log('[CaptureSession] Checking API availability:', {
                            hasWindowApi: !!windowApi,
                            hasCamera: !!windowApi?.camera,
                            hasCapture: !!windowApi?.camera?.capture
                        });
                        
                        if (windowApi && windowApi.camera && windowApi.camera.capture) {
                            // Synchronously stop the webcam stream to release PTP lock on DSLR USB.
                            // Do not stop the selected capture-card preview device, since it should remain active.
                            if (!config.selectedCameraId && streamRef.current) {
                                console.log('[CaptureSession] Stopping webcam stream tracks to release PTP USB lock');
                                streamRef.current.getTracks().forEach(track => track.stop());
                                streamRef.current = null;
                                if (videoRef.current) {
                                    videoRef.current.srcObject = null;
                                }
                            }
                            
                            // Always disable LiveView fallback for DSLR to avoid preview screenshots
                            const captureOptions = { allowLiveViewFallback: false };
                            console.log('[CaptureSession] Invoking camera.capture with options:', captureOptions);
                            
                            const captureStartTime = performance.now()
                            const captureRes = await windowApi.camera.capture(slot?.id, captureOptions);
                            const elapsedMs = (performance.now() - captureStartTime).toFixed(0)
                            
                            console.log(`[CaptureSession] ✅ Capture response received after ${elapsedMs}ms:`, {
                                success: captureRes.success,
                                hasData: !!captureRes.data,
                                imagePath: captureRes.data?.imagePath,
                                resultTimestamp: captureRes.data?.timestamp,
                                error: captureRes.error
                            });
                            
                            if (captureRes.success && captureRes.data && captureRes.data.imagePath) {
                                // Convert to base64 data URL by reading the file via IPC
                                // This avoids CORS/sandbox issues with file:// URLs in Electron
                                try {
                                    console.log('[CaptureSession] Reading captured image to base64:', captureRes.data.imagePath);
                                    const base64Res = await windowApi.system.readFileAsBase64(captureRes.data.imagePath);
                                    if (base64Res.success && base64Res.data) {
                                        // Convert base64 to data URL with proper MIME type
                                        dataUrl = `data:image/jpeg;base64,${base64Res.data}`;
                                        console.log('[CaptureSession] ✅ Successfully loaded DSLR photo as base64');
                                    } else {
                                        console.warn('[CaptureSession] Failed to read file as base64:', base64Res.error);
                                    }
                                } catch (e) {
                                    console.warn('[CaptureSession] Error reading file as base64:', e);
                                }
                            } else {
                                console.warn('[CaptureSession] Capture not successful or missing data. Attempting fallback to webcam.');
                            }
                        } else {
                            console.warn('[CaptureSession] API not available. Falling back to webcam.');
                        }
                    } else {
                        console.log('[CaptureSession] Camera mode is mock, skipping DSLR capture');
                    }
                } catch (e) {
                    console.error('[CaptureSession] ❌ Native camera capture threw exception (possible timeout/hang):', e);
                }

                if (!dataUrl) {
                    console.error('[CaptureSession] DSLR Capture failed and fallback is disabled.');
                    setCameraError('Gagal mengambil foto dari DSLR Canon. Pastikan kamera menyala, terhubung, dan tidak dalam mode sleep.');
                    setCaptureState('idle');
                    return;
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
        const useUsbLivePhoto = config.cameraMode === 'edsdk';

        if (useUsbLivePhoto) {
            console.log('[CaptureSession] Stopping clean USB Live Photo recording...');
            window.api.camera.stopRecordingLivePhoto(slot.id)
                .then((res: any) => {
                    if (res.success && res.data) {
                        const videoUrl = `file:///${res.data.replace(/\\/g, '/')}`;
                        console.log('[CaptureSession] Clean USB Live Photo recorded:', videoUrl);
                        completeCapture(videoUrl);
                    } else {
                        console.warn('[CaptureSession] Clean USB Live Photo recording failed or returned empty');
                        completeCapture();
                    }
                })
                .catch((err: any) => {
                    console.error('[CaptureSession] Error compiling USB Live Photo:', err);
                    completeCapture();
                });
        } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
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

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (captureState === 'idle') {
                if (e.key === '1' || e.key === '2' || e.key === '3') {
                    e.preventDefault()
                    handleReady()
                }
            } else if (captureState === 'reviewPopup') {
                const filledSlots = captureSlots.filter(slot =>
                    photos.some(p => p.slotId === slot.id)
                )

                if (e.key === '1') {
                    e.preventDefault()
                    handleRetakeFromPopup()
                } else if (e.key === '2') {
                    e.preventDefault()
                    handleContinueToReview()
                } else if (e.key === '3') {
                    e.preventDefault()
                    if (filledSlots.length > 0) {
                        setReviewPhotoIndex(prev => (prev < filledSlots.length - 1 ? prev + 1 : 0))
                    }
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [captureState, photos, captureSlots, reviewPhotoIndex])


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

    // Custom camera preview adjustments
    const zoomVal = config.cameraZoom || 1.0;
    const offsetX = config.cameraOffsetX || 0;
    const offsetY = config.cameraOffsetY || 0;
    const scaleYVal = config.cameraScaleY !== undefined ? config.cameraScaleY : 1.0;
    
    // For capture card video (with default 0.75 squeeze correction if not overridden)
    const scaleXCardVal = config.cameraScaleX !== undefined ? config.cameraScaleX : (config.selectedCameraId ? 0.75 : 1.0);
    // For standard webcam/image preview (default 1.0)
    const scaleXStandardVal = config.cameraScaleX !== undefined ? config.cameraScaleX : 1.0;

    const captureCardTransform = `translate(${offsetX}px, ${offsetY}px) scaleX(${-1 * scaleXCardVal * zoomVal}) scaleY(${scaleYVal * zoomVal})`;
    const standardTransform = `translate(${offsetX}px, ${offsetY}px) scaleX(${-1 * scaleXStandardVal * zoomVal}) scaleY(${scaleYVal * zoomVal})`;

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
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    zIndex: 100
                }}
            >
                ← Kembali
            </motion.button>

            {/* Gear Button for Live View adjustment */}
            <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setIsAdjustPanelOpen(!isAdjustPanelOpen)}
                title="Adjust Live View"
                style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    padding: '6px 12px',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 'bold',
                    color: '#333'
                }}
            >
                ⚙️ {isAdjustPanelOpen ? 'Tutup Atur' : 'Atur Live View'}
            </motion.button>

            {/* Main Capture Area */}
            <div className={styles.captureArea}>
                {/* Controls Bar - No back button to prevent timer circumvention */}
                <div className={styles.controlsBar}>
                    <div className={styles.controlsRight}>
                        <div className={styles.photoInfo}>
                            <span className={styles.photoCount}>
                                {photos.length < captureSlots.length
                                    ? `Photo ${photos.length + 1} of ${captureSlots.length}`
                                    : `${photos.length} of ${captureSlots.length} ✓`}
                            </span>
                            <span className={styles.frameNumber}>{currentFrame.name}</span>
                        </div>
                    </div>
                </div>

                {/* Live Viewfinder */}
                <div
                    className={styles.viewfinder}
                    style={{ aspectRatio: slotAspectRatio }}
                    ref={viewfinderRef}
                >
                    {/* Camera Feed — Webcam, digiCamControl/Canon EDSDK Live View, with rotation support */}
                    {(() => {
                        const rotation = config.cameraRotation || 0
                        const isRotated90or270 = rotation === 90 || rotation === 270

                        // Build video style based on rotation + zoom/scale/offset
                        const getVideoStyle = (baseTransform: string): React.CSSProperties => {
                            if (isRotated90or270) {
                                return {
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    width: viewfinderSize.height ? `${viewfinderSize.height}px` : '100vh',
                                    height: viewfinderSize.width ? `${viewfinderSize.width}px` : '100vw',
                                    transform: `translate(-50%, -50%) rotate(${rotation}deg) ${baseTransform}`,
                                    objectFit: 'cover'
                                }
                            }
                            if (rotation === 180) {
                                return {
                                    transform: `rotate(180deg) ${baseTransform}`,
                                    objectFit: 'cover'
                                }
                            }
                            return {
                                transform: baseTransform,
                                objectFit: 'cover' as const
                            }
                        }

                        if (config.selectedCameraId) {
                            return (
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className={styles.video}
                                    style={getVideoStyle(captureCardTransform)}
                                />
                            )
                        }

                        if ((config.cameraMode === 'ptp' || config.cameraMode === 'edsdk') && digicamLiveViewUrl) {
                            return (
                                <img
                                    key={digicamLiveViewKey}
                                    src={`${digicamLiveViewUrl}?t=${digicamLiveViewKey}`}
                                    alt="Live View"
                                    className={styles.video}
                                    style={getVideoStyle(standardTransform)}
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.opacity = '0.3'
                                    }}
                                    onLoad={(e) => {
                                        (e.target as HTMLImageElement).style.opacity = '1'
                                    }}
                                />
                            )
                        }

                        return (
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={styles.video}
                                style={getVideoStyle(standardTransform)}
                            />
                        )
                    })()}

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
            </div>

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

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={() => {
                    endSession()
                    navigate('/')
                }}
            />

            {/* Live View Adjustment Panel */}
            <AnimatePresence>
                {isAdjustPanelOpen && (
                    <motion.div
                        initial={{ opacity: 0, x: 300 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 300 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        style={{
                            position: 'fixed',
                            top: '80px',
                            right: '20px',
                            width: '320px',
                            backgroundColor: 'rgba(26, 26, 46, 0.95)',
                            backdropFilter: 'blur(10px)',
                            border: '2px solid var(--clay-yellow)',
                            borderRadius: '16px',
                            padding: '20px',
                            zIndex: 99,
                            color: '#FFFFFF',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
                        }}
                    >
                        <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            ⚙️ Pengaturan Live View
                        </h3>

                        {/* Zoom Slider */}
                        <div style={{ marginBottom: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                                <label>🔎 Zoom (Uniform)</label>
                                <span>{Math.round((config.cameraZoom || 1.0) * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="1.0"
                                max="3.0"
                                step="0.05"
                                value={config.cameraZoom || 1.0}
                                onChange={(e) => updateConfig({ cameraZoom: parseFloat(e.target.value) })}
                                style={{ width: '100%', cursor: 'pointer' }}
                            />
                        </div>

                        {/* Scale X Slider */}
                        <div style={{ marginBottom: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                                <label>↔️ Lebar Video (Scale X)</label>
                                <span>{Math.round((config.cameraScaleX !== undefined ? config.cameraScaleX : (config.selectedCameraId ? 0.75 : 1.0)) * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.01"
                                value={config.cameraScaleX !== undefined ? config.cameraScaleX : (config.selectedCameraId ? 0.75 : 1.0)}
                                onChange={(e) => updateConfig({ cameraScaleX: parseFloat(e.target.value) })}
                                style={{ width: '100%', cursor: 'pointer' }}
                            />
                        </div>

                        {/* Scale Y Slider */}
                        <div style={{ marginBottom: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                                <label>↕️ Tinggi Video (Scale Y)</label>
                                <span>{Math.round((config.cameraScaleY !== undefined ? config.cameraScaleY : 1.0) * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.01"
                                value={config.cameraScaleY !== undefined ? config.cameraScaleY : 1.0}
                                onChange={(e) => updateConfig({ cameraScaleY: parseFloat(e.target.value) })}
                                style={{ width: '100%', cursor: 'pointer' }}
                            />
                        </div>

                        {/* Offset X Slider */}
                        <div style={{ marginBottom: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                                <label>⬅️➡️ Geser Horizontal (X)</label>
                                <span>{config.cameraOffsetX || 0}px</span>
                            </div>
                            <input
                                type="range"
                                min="-400"
                                max="400"
                                step="1"
                                value={config.cameraOffsetX || 0}
                                onChange={(e) => updateConfig({ cameraOffsetX: parseInt(e.target.value) })}
                                style={{ width: '100%', cursor: 'pointer' }}
                            />
                        </div>

                        {/* Offset Y Slider */}
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                                <label>⬆️⬇️ Geser Vertikal (Y)</label>
                                <span>{config.cameraOffsetY || 0}px</span>
                            </div>
                            <input
                                type="range"
                                min="-400"
                                max="400"
                                step="1"
                                value={config.cameraOffsetY || 0}
                                onChange={(e) => updateConfig({ cameraOffsetY: parseInt(e.target.value) })}
                                style={{ width: '100%', cursor: 'pointer' }}
                            />
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => updateConfig({
                                    cameraZoom: 1.0,
                                    cameraScaleX: config.selectedCameraId ? 0.75 : 1.0,
                                    cameraScaleY: 1.0,
                                    cameraOffsetX: 0,
                                    cameraOffsetY: 0
                                })}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'transparent',
                                    color: '#FFF',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '12px'
                                }}
                            >
                                Reset
                            </button>
                            <button
                                onClick={() => setIsAdjustPanelOpen(false)}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: 'var(--clay-yellow)',
                                    color: '#1A1A2E',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '12px'
                                }}
                            >
                                Selesai
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}

export default CaptureSession
