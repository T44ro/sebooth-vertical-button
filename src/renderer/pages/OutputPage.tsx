import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFrameStore, useSessionStore, useAppConfig } from '../stores'
import { PhotoSlot, QRSlot } from '@shared/types'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './OutputPage.module.css'
import { supabase } from '../lib/supabase'
import Lottie from 'lottie-react'
import PA22Animation from '../assets/PA22.json'
import QRCode from 'qrcode'

type OutputMediaType = 'strip' | 'gif' | 'live'

interface OutputItemDef {
    id: OutputMediaType
    title: string
}

const OUTPUT_ITEMS: OutputItemDef[] = [
    { id: 'strip', title: 'Photostrip' },
    { id: 'gif', title: 'GIF' },
    { id: 'live', title: 'Live Photo' }
]

// Helper function to calculate circular offset relative to active index
const getCircularOffset = (index: number, activeIndex: number, length: number): number => {
    let diff = index - activeIndex
    while (diff > length / 2) diff -= length
    while (diff <= -length / 2) diff += length
    return diff
}

function OutputPage(): JSX.Element {
    const navigate = useNavigate()
    const { frames, activeFrame } = useFrameStore()
    const { photos, currentSession, setCompositePath, selectedFilter, isMirrored, endSession } = useSessionStore()
    const { config } = useAppConfig()

    const sessionFrame = currentSession?.frameId
        ? frames.find(f => f.id === currentSession.frameId)
        : activeFrame

    const [activeIndex, setActiveIndex] = useState<number>(0)
    const [gifDataUrl, setGifDataUrl] = useState<string | null>(null)
    const [liveVideoPath, setLiveVideoPath] = useState<string | null>(null)
    const [compositeDataUrl, setCompositeDataUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isProcessing, setIsProcessing] = useState(true)
    const [isUploading, setIsUploading] = useState(false)
    const [uploadStatus, setUploadStatus] = useState<string>('')
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const { setCloudSessionId } = useSessionStore()

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const uploadLockRef = useRef<string | null>(null)
    const carouselRef = useRef<HTMLDivElement>(null)

    // Generate composite when photos, frame, or filter changes
    useEffect(() => {
        if (photos.length > 0 && sessionFrame) {
            generateMedia()
        }
    }, [photos, sessionFrame, selectedFilter])

    const generateMedia = async () => {
        setIsProcessing(true)
        try {
            await generateCompositeFromPhotos()
            await generateGif()
            extractLiveVideo()
        } finally {
            setIsProcessing(false)
        }
    }

    const resolveSourceSlotId = (slot: PhotoSlot): string => {
        if (!slot.duplicateOfSlotId || !sessionFrame) return slot.id
        const sourceSlot = sessionFrame.slots.find(s => s.id === slot.duplicateOfSlotId)
        return sourceSlot ? resolveSourceSlotId(sourceSlot) : slot.duplicateOfSlotId
    }

    const getPhotoForSlot = (slot: PhotoSlot) => {
        const sourceSlotId = resolveSourceSlotId(slot)
        return photos.find(p => p.slotId === sourceSlotId)
    }

    // Trigger upload when processing is done and composite is ready
    useEffect(() => {
        if (!isProcessing && compositeDataUrl && config.sharingMode === 'cloud') {
            handleCloudUpload()
        }
    }, [isProcessing, compositeDataUrl, config.sharingMode])

    const handleCloudUpload = async () => {
        const sessionId = currentSession?.id
        if (!sessionId || isUploading || uploadLockRef.current === sessionId) return
        
        setIsUploading(true)
        uploadLockRef.current = sessionId
        setUploadStatus('Memulai upload ke Cloud...')

        try {
            const sessionId = currentSession?.id || crypto.randomUUID()
            
            const mediaToUpload: { type: string; url?: string; path: string; base64Data?: string; filePath?: string; mimeType: string; label: string }[] = []

            // 1. Prepare Strip
            if (compositeDataUrl) {
                mediaToUpload.push({ type: 'photo', path: `${sessionId}/strip.jpg`, base64Data: compositeDataUrl, mimeType: 'image/jpeg', label: 'Photo Strip' })
            }

            // 2. Prepare GIF
            if (gifDataUrl) {
                mediaToUpload.push({ type: 'gif', path: `${sessionId}/animation.gif`, base64Data: gifDataUrl, mimeType: 'image/gif', label: 'GIF Animation' })
            }

            // 0. Trigger Local Save (This generates the composite video via FFmpeg)
            let composedVideoPath: string | null = null
            if (sessionFrame) {
                try {
                    setUploadStatus('Memproses komposisi video Live...')
                    const photosForSave = sessionFrame.slots.map((slot, i) => {
                        const photo = getPhotoForSlot(slot)
                        return {
                            path: photo?.imagePath || '',
                            filename: `photo_${i + 1}.jpg`
                        }
                    })

                    const videosForSave = sessionFrame.slots.map((slot, i) => {
                        const photo = getPhotoForSlot(slot)
                        return {
                            path: photo?.videoPath || '',
                            filename: `video_${i + 1}.mp4`
                        }
                    })

                    const qrUrl = await getQRUrl()
                    let qrCodeDataUrlForSave: string | undefined = undefined
                    if (qrUrl && getQRSlots(sessionFrame).length > 0) {
                        qrCodeDataUrlForSave = await QRCode.toDataURL(qrUrl, { margin: 1 })
                    }

                    const saveResult = await window.api.system.saveSessionLocally({
                        sessionId,
                        stripDataUrl: compositeDataUrl || undefined,
                        gifDataUrl: gifDataUrl || undefined,
                        qrCodeDataUrl: qrCodeDataUrlForSave,
                        photos: photosForSave,
                        videos: videosForSave,
                        overlay: { path: sessionFrame.overlayPath, filename: 'overlay.png' },
                        mirrorOutput: isMirrored,
                        cameraRotation: config.cameraRotation || 0,
                        frameConfig: {
                            width: sessionFrame.canvasWidth,
                            height: sessionFrame.canvasHeight,
                            slots: sessionFrame.slots.map(s => ({
                                width: s.width,
                                height: s.height,
                                x: s.x,
                                y: s.y,
                                rotation: s.rotation
                            })),
                            qrSlots: getQRSlots(sessionFrame).map(s => ({
                                width: s.width,
                                height: s.height,
                                x: s.x,
                                y: s.y
                            }))
                        }
                    })

                    if (saveResult.success && saveResult.data) {
                        const videoFile = (saveResult.data as any[]).find(f => f.filename.startsWith('live_video_'))
                        if (videoFile) {
                            composedVideoPath = videoFile.path
                            console.log('🎬 Composite video produced:', composedVideoPath)
                        }
                    }
                } catch (saveErr) {
                    console.error('Local save/composite failed:', saveErr)
                }
            }

            // 3. Prepare Video
            const videoToPrepare = composedVideoPath || liveVideoPath
            if (videoToPrepare) {
                setUploadStatus('Menyiapkan media video...')
                const diskPath = videoToPrepare.replace('file:///', '').replace('file://', '')
                mediaToUpload.push({ type: 'live', path: `${sessionId}/live.mp4`, filePath: diskPath, mimeType: 'video/mp4', label: 'Live Video' })
                console.log(`✅ ${composedVideoPath ? 'Composed' : 'Raw'} video prepared via path IPC handler`)
            }

            // 4. Prepare Individual Photos
            for (let i = 0; i < photos.length; i++) {
                try {
                    const photo = photos[i]
                    setUploadStatus(`Menyiapkan Foto ${i + 1}/${photos.length}...`)
                    
                    if (photo.imagePath.startsWith('data:')) {
                        mediaToUpload.push({ 
                            type: 'photo', path: `${sessionId}/photo_${i + 1}.jpg`, base64Data: photo.imagePath, mimeType: 'image/jpeg', label: `Photo ${i + 1}`
                        })
                    } else {
                        const diskPath = photo.imagePath.replace('file:///', '').replace('file://', '')
                        mediaToUpload.push({ 
                            type: 'photo', path: `${sessionId}/photo_${i + 1}.jpg`, filePath: diskPath, mimeType: 'image/jpeg', label: `Photo ${i + 1}`
                        })
                    }
                } catch (pErr) {
                    console.error(`Failed to handle individual photo ${i}:`, pErr)
                }
            }
            console.log(`📸 Ready to upload ${mediaToUpload.length} items`)

            setUploadStatus('Menyimpan sesi ke database...')
            const { error: dbErr } = await supabase
                .from('sessions')
                .upsert({
                    id: sessionId,
                    event_name: config.eventName || 'Sebooth Event',
                    is_claimed: false,
                    created_at: new Date().toISOString()
                }, { onConflict: 'id' })
            
            if (dbErr) throw dbErr

            setCloudSessionId(sessionId)

            let successCount = 0
            const GCS_BUCKET_NAME = 'sebooth-media-konser'
            
            for (let i = 0; i < mediaToUpload.length; i++) {
                const item = mediaToUpload[i]
                const progress = `(${i + 1}/${mediaToUpload.length})`
                setUploadStatus(`Mengunggah ${item.label || item.type} ${progress}...`)
                
                try {
                    const uploadResult = await (window as any).api.cloud.uploadFile({
                        bucketName: GCS_BUCKET_NAME,
                        destinationPath: item.path,
                        filePath: item.filePath,
                        base64Data: item.base64Data,
                        mimeType: item.mimeType
                    });

                    if (!uploadResult.success || !uploadResult.url) {
                        console.error(`GCS Storage Error for ${item.type}:`, uploadResult.error)
                        continue
                    }

                    const publicUrl = uploadResult.url;
                    
                    const { error: insErr } = await supabase.from('media').insert({
                        session_id: sessionId,
                        type: item.type,
                        url: publicUrl,
                        metadata: item.path.includes('strip.jpg') ? { is_strip: true } : {}
                    })

                    if (insErr) {
                        console.error(`DB Insert Error for ${item.type}:`, insErr)
                    } else {
                        successCount++
                    }
                } catch (loopErr) {
                    console.error(`Unexpected loop error for ${item.type}:`, loopErr)
                }
            }

            setCloudSessionId(sessionId)
            setUploadStatus(`Upload Selesai! (${successCount}/${mediaToUpload.length} sukses)`)
            console.log(`✅ Upload Sequence Complete. Success: ${successCount}/${mediaToUpload.length}`)
        } catch (err: any) {
            console.warn('⚠️ Cloud upload deferred to offline retry queue:', err)
            // Ensure cloudSessionId is set so session navigation and local printing proceed 100% smoothly
            const fallbackId = currentSession?.id || crypto.randomUUID()
            setCloudSessionId(fallbackId)
            setUploadStatus('Media disimpan di antrean offline (akan otomatis di-upload saat online).')
            uploadLockRef.current = null
        } finally {
            setIsUploading(false)
        }
    }

    const extractLiveVideo = () => {
        const videoPhoto = photos.find(p => p.videoPath && !p.videoPath.startsWith('blob:'))
        if (videoPhoto && videoPhoto.videoPath) {
            setLiveVideoPath(`file://${videoPhoto.videoPath.replace(/\\/g, '/')}`)
        }
    }

    const generateGif = async () => {
        if (photos.length === 0 || !sessionFrame) return
        const gifCanvas = document.createElement('canvas')
        const firstSlot = sessionFrame.slots?.[0]
        const slotAspect = firstSlot ? (firstSlot.width / firstSlot.height) : 1.5
        gifCanvas.width = 1080
        gifCanvas.height = Math.round(1080 / slotAspect)
        const gctx = gifCanvas.getContext('2d', { willReadFrequently: true, alpha: false })
        if (!gctx) return

        gctx.imageSmoothingEnabled = true
        gctx.imageSmoothingQuality = 'high'
        const framesBase64: string[] = []

        const loadImage = (src: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
                const img = new Image()
                if (!src.startsWith('file:///') && !src.startsWith('data:')) {
                    img.crossOrigin = 'anonymous'
                }
                img.onload = () => resolve(img)
                img.onerror = reject
                img.src = src
            })
        }

        try {
            for (const photo of photos) {
                const img = await loadImage(photo.imagePath)
                const imgAspect = img.width / img.height
                const canvasAspect = gifCanvas.width / gifCanvas.height
                let dw = gifCanvas.width, dh = gifCanvas.height, dx = 0, dy = 0
                if (imgAspect > canvasAspect) {
                     dh = gifCanvas.height; dw = gifCanvas.height * imgAspect; dx = (gifCanvas.width - dw) / 2
                } else {
                     dw = gifCanvas.width; dh = gifCanvas.width / imgAspect; dy = (gifCanvas.height - dh) / 2
                }
                gctx.fillStyle = '#ffffff'
                gctx.fillRect(0, 0, gifCanvas.width, gifCanvas.height)
                gctx.save()
                if (isMirrored) {
                    gctx.translate(gifCanvas.width, 0)
                    gctx.scale(-1, 1)
                }
                gctx.drawImage(img, dx, dy, dw, dh)
                gctx.restore()
                framesBase64.push(gifCanvas.toDataURL('image/jpeg', 0.95))
            }
            if ((window as any).api.system.generateHqGif) {
                const hqGifResult = await (window as any).api.system.generateHqGif(framesBase64, 500)
                if (hqGifResult.success && hqGifResult.data) {
                    setGifDataUrl(hqGifResult.data)
                }
            }
        } catch (e) {
            console.error('GIF Gen Error', e)
        }
    }

    const getQRUrl = async (): Promise<string> => {
        if (!currentSession) return ''
        if (config.sharingMode === 'cloud') {
            let portalBase = config.cloudPortalUrl
            if (!portalBase) {
                const ipRes = await (window as any).api.system.getLocalIp()
                const localIp = (ipRes && ipRes.success && ipRes.data) ? ipRes.data : 'localhost'
                portalBase = `http://${localIp}:3000`
            }
            portalBase = portalBase.replace(/\/$/, '')
            return `${portalBase}/access/${currentSession.id}`
        } else {
            const ipRes = await (window as any).api.system.getLocalIp()
            const localIp = (ipRes && ipRes.success && ipRes.data) ? ipRes.data : '127.0.0.1'
            return `http://${localIp}:5050/gallery/${currentSession.id}`
        }
    }

    const getQRSlots = (frame: any): QRSlot[] => {
        if (frame.qrSlots && frame.qrSlots.length > 0) {
            return frame.qrSlots
        }
        if (frame.qrSlot && frame.qrSlot.enabled) {
            return [{
                id: 'legacy-qr',
                x: frame.qrSlot.x,
                y: frame.qrSlot.y,
                width: frame.qrSlot.width,
                height: frame.qrSlot.height,
                enabled: true
            }]
        }
        return []
    }

    const generateCompositeFromPhotos = async (): Promise<void> => {
        if (!sessionFrame || photos.length === 0 || !canvasRef.current) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        canvas.width = sessionFrame.canvasWidth
        canvas.height = sessionFrame.canvasHeight

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        const loadImage = (src: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
                const img = new Image()
                if (!src.startsWith('file:///') && !src.startsWith('data:')) {
                    img.crossOrigin = 'anonymous'
                }
                img.onload = () => resolve(img)
                img.onerror = reject
                img.src = src
            })
        }

        try {
            let filterStr = 'none';
            if (selectedFilter === 'grayscale') filterStr = 'grayscale(100%)'
            else if (selectedFilter === 'sepia') filterStr = 'sepia(80%)'
            else if (selectedFilter === 'warm') filterStr = 'saturate(1.3) hue-rotate(-10deg)'
            else if (selectedFilter === 'cool') filterStr = 'saturate(1.1) hue-rotate(10deg)'
            else if (selectedFilter === 'vintage') filterStr = 'contrast(1.1) brightness(0.9) sepia(30%)'
            
            ctx.filter = filterStr;

            for (const slot of sessionFrame.slots) {
                const photo = getPhotoForSlot(slot)
                if (!photo) continue

                try {
                    const img = await loadImage(photo.imagePath)

                    ctx.save()
                    ctx.translate(slot.x + slot.width / 2, slot.y + slot.height / 2)
                    ctx.rotate((slot.rotation * Math.PI) / 180)

                    ctx.beginPath()
                    ctx.rect(-slot.width / 2, -slot.height / 2, slot.width, slot.height)
                    ctx.clip()

                    const imgAspect = img.width / img.height
                    const slotAspect = slot.width / slot.height
                    let drawWidth, drawHeight

                    if (imgAspect > slotAspect) {
                        drawHeight = slot.height
                        drawWidth = slot.height * imgAspect
                    } else {
                        drawWidth = slot.width
                        drawHeight = slot.width / imgAspect
                    }

                    const scale = photo.scale || 1
                    const panX = photo.panX || 0
                    const panY = photo.panY || 0

                    if (isMirrored) {
                        ctx.scale(-1, 1)
                        ctx.translate(-panX, panY)
                    } else {
                        ctx.translate(panX, panY)
                    }
                    ctx.scale(scale, scale)

                    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
                    ctx.restore()
                } catch (err) {
                    console.error('Failed to load photo:', err)
                }
            }

            try {
                ctx.filter = 'none'

                const frameImg = await loadImage(`file://${sessionFrame.overlayPath}`)
                const frameAspect = frameImg.width / frameImg.height
                const canvasAspect = canvas.width / canvas.height

                let fw = canvas.width
                let fh = canvas.height
                let fx = 0
                let fy = 0

                if (Math.abs(frameAspect - canvasAspect) > 0.01) {
                    if (frameAspect > canvasAspect) {
                        fw = canvas.width
                        fh = canvas.width / frameAspect
                        fy = (canvas.height - fh) / 2
                    } else {
                        fh = canvas.height
                        fw = canvas.height * frameAspect
                        fx = (canvas.width - fw) / 2
                    }
                }

                ctx.drawImage(frameImg, fx, fy, fw, fh)

            } catch (err) {
                console.error('Failed to load frame overlay:', err)
            }

            const activeQrSlots = getQRSlots(sessionFrame)
            if (activeQrSlots.length > 0) {
                try {
                    const qrUrl = await getQRUrl()
                    if (qrUrl) {
                        const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1 })
                        const qrImg = await loadImage(qrDataUrl)
                        for (const qrSlot of activeQrSlots) {
                            if (!qrSlot.enabled) continue
                            ctx.drawImage(
                                qrImg,
                                qrSlot.x,
                                qrSlot.y,
                                qrSlot.width,
                                qrSlot.height
                            )
                        }
                    }
                } catch (qrErr) {
                    console.error('Failed to draw QR code on composite:', qrErr)
                }
            }

            const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
            setCompositeDataUrl(dataUrl)
            setCompositePath(dataUrl)

        } catch (error) {
            console.error('Failed to generate composite:', error)
            setError('Failed to generate composite image')
        }
    }

    // Circular Carousel Navigation Handlers
    // 1: Back (Prev)
    // 2: Next
    // 3: Lanjutkan (/sharing)
    const handlePrevMedia = useCallback(() => {
        setActiveIndex(prev => (prev - 1 + OUTPUT_ITEMS.length) % OUTPUT_ITEMS.length)
    }, [])

    const handleNextMedia = useCallback(() => {
        setActiveIndex(prev => (prev + 1) % OUTPUT_ITEMS.length)
    }, [])

    const handleProceed = useCallback(() => {
        navigate('/sharing')
    }, [navigate])

    // Keyboard navigation according to specifications:
    // Key 1: Back (Previous output in circular loop)
    // Key 2: Next (Next output in circular loop)
    // Key 3: Lanjutkan (Next step to /sharing)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (isProcessing || isUploading) return

            if (e.key === '1') {
                e.preventDefault()
                handlePrevMedia()
            } else if (e.key === '2') {
                e.preventDefault()
                handleNextMedia()
            } else if (e.key === '3') {
                e.preventDefault()
                handleProceed()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isProcessing, isUploading, handlePrevMedia, handleNextMedia, handleProceed])

    if (!sessionFrame) return null

    // Calculate dimensions for circular 3D carousel cards (Enlarged selected item size)
    const isPortrait = config.appOrientation === 'portrait'
    const targetCardHeight = isPortrait ? 520 : 600
    const cardScaleFactor = targetCardHeight / sessionFrame.canvasHeight
    const scaledWidth = sessionFrame.canvasWidth * cardScaleFactor
    const scaledHeight = sessionFrame.canvasHeight * cardScaleFactor
    const spacingX = isPortrait ? scaledWidth * 0.88 : scaledWidth * 1.10

    // Helper to render media inside a card
    const renderMediaContent = (mediaId: OutputMediaType) => {
        if (mediaId === 'strip') {
            return compositeDataUrl ? (
                <img src={compositeDataUrl} alt="Photostrip" className={styles.mediaContentImage} />
            ) : (
                <div className={styles.loadingMedia}>
                    <div className={styles.mediaSpinner} />
                    <span>Memproses Photostrip...</span>
                </div>
            )
        }

        if (mediaId === 'gif') {
            return gifDataUrl ? (
                <img src={gifDataUrl} alt="GIF" className={styles.mediaContentImage} />
            ) : (
                <div className={styles.loadingMedia}>
                    <div className={styles.mediaSpinner} />
                    <span>Memproses GIF...</span>
                </div>
            )
        }

        if (mediaId === 'live') {
            const scaleY = (targetCardHeight * 0.88) / sessionFrame.canvasHeight
            const scaleX = (scaledWidth * 0.88) / sessionFrame.canvasWidth
            const scale = Math.min(scaleX, scaleY, 1)

            let filterStyle: React.CSSProperties = {}
            if (selectedFilter === 'grayscale') filterStyle = { filter: 'grayscale(100%)' }
            else if (selectedFilter === 'sepia') filterStyle = { filter: 'sepia(80%)' }
            else if (selectedFilter === 'warm') filterStyle = { filter: 'saturate(1.3) hue-rotate(-10deg)' }
            else if (selectedFilter === 'cool') filterStyle = { filter: 'saturate(1.1) hue-rotate(10deg)' }
            else if (selectedFilter === 'vintage') filterStyle = { filter: 'contrast(1.1) brightness(0.9) sepia(30%)' }

            return (
                <div style={{
                    position: 'relative',
                    width: sessionFrame.canvasWidth * scale,
                    height: sessionFrame.canvasHeight * scale,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backgroundColor: 'white'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: sessionFrame.canvasWidth,
                        height: sessionFrame.canvasHeight,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left'
                    }}>
                        {sessionFrame.slots.map(slot => {
                            const photo = getPhotoForSlot(slot)
                            if (!photo) return null
                            
                            const isVideo = !!photo.videoPath
                            let src = photo.imagePath
                            if (isVideo) {
                                if (photo.videoPath!.startsWith('blob:') || photo.videoPath!.startsWith('file://')) {
                                    src = photo.videoPath!
                                } else {
                                    src = `file:///${photo.videoPath!.replace(/\\/g, '/')}`
                                }
                            }
                            
                            const cameraRotation = config.cameraRotation || 0
                            const isRotated90or270 = cameraRotation === 90 || cameraRotation === 270

                            const camRotTransform = isVideo && isRotated90or270
                                ? `rotate(${cameraRotation}deg) scaleX(-1)`
                                : isVideo && cameraRotation === 180
                                ? `rotate(180deg) scaleX(-1)`
                                : isVideo && isMirrored
                                ? `scaleX(-1)`
                                : ''

                            const mediaStyle: React.CSSProperties = {
                                position: 'absolute',
                                top: isVideo && isRotated90or270 ? '50%' : 0,
                                left: isVideo && isRotated90or270 ? '50%' : 0,
                                width: isVideo && isRotated90or270 ? `${slot.height}px` : '100%',
                                height: isVideo && isRotated90or270 ? `${slot.width}px` : '100%',
                                objectFit: 'cover',
                                transform: isVideo && isRotated90or270
                                    ? `translate(-50%, -50%) ${camRotTransform} translate(${photo.panX || 0}px, ${photo.panY || 0}px) scale(${photo.scale || 1})`
                                    : `translate(${photo.panX || 0}px, ${photo.panY || 0}px) scale(${photo.scale || 1}) ${camRotTransform}`,
                                transformOrigin: 'center center',
                                ...filterStyle
                            }

                            return (
                                <div key={slot.id} style={{
                                    position: 'absolute',
                                    left: slot.x,
                                    top: slot.y,
                                    width: slot.width,
                                    height: slot.height,
                                    transform: `rotate(${slot.rotation}deg)`,
                                    overflow: 'hidden'
                                }}>
                                    {isVideo ? (
                                        <video src={src} autoPlay loop muted playsInline style={mediaStyle} />
                                    ) : (
                                        <img src={src} style={mediaStyle} />
                                    )}
                                </div>
                            )
                        })}
                        <img 
                            src={`file:///${sessionFrame.overlayPath.replace(/\\/g, '/')}`} 
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                pointerEvents: 'none'
                            }} 
                            alt="Frame Overlay" 
                        />
                    </div>
                </div>
            )
        }

        return null
    }

    return (
        <div className={styles.container}>
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

            {error && <div className={styles.errorMessage}>{error}</div>}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Loading / Uploading Overlay */}
            <AnimatePresence>
                {(isProcessing || isUploading) && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={styles.loadingOverlay}
                    >
                        <Lottie 
                            animationData={PA22Animation} 
                            loop={true} 
                            style={{ width: 360, height: 360, marginBottom: 'var(--spacing-xl)' }}
                        />
                        <p>{isUploading ? 'Uploading to Cloud...' : 'Processing Magic...'}</p>
                        {uploadStatus && <p className={styles.statusSubtext}>{uploadStatus}</p>}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Header Title */}
            <div className={styles.header}>
                <h2>🎞️ Sesi Foto Selesai</h2>
                <p>Lihat & Review Hasil Media Anda</p>
            </div>

            {/* 3D Infinite Circular Sliding Carousel */}
            <div className={styles.carouselWorkspace} ref={carouselRef}>
                <div className={styles.carouselCenterTrack}>
                    {OUTPUT_ITEMS.map((item, idx) => {
                        const offset = getCircularOffset(idx, activeIndex, OUTPUT_ITEMS.length)
                        const isCenter = offset === 0
                        const absOffset = Math.abs(offset)

                        let xPos = offset * spacingX
                        let scale = 1.20
                        let opacity = 1
                        let zIndex = 20
                        let rotateY = 0

                        if (!isCenter) {
                            scale = 0.50
                            opacity = 0.40
                            zIndex = 10 - absOffset
                            rotateY = offset > 0 ? -12 : 12
                        }

                        return (
                            <motion.div
                                key={item.id}
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
                                        setActiveIndex(idx)
                                    }
                                }}
                            >
                                {/* Header Title at Top of Output File Item */}
                                <div className={styles.cardItemHeader}>
                                    <span className={styles.cardItemTitle}>{item.title}</span>
                                </div>

                                {/* Media Content Body */}
                                <div className={styles.cardMediaBody}>
                                    {renderMediaContent(item.id)}
                                </div>
                            </motion.div>
                        )
                    })}
                </div>
            </div>

            {/* Bottom Floating Control Bar with Buttons 1: Back, 2: Next, 3: Lanjutkan */}
            <div className={styles.bottomActionBar}>
                {/* Button 1: Back (Prev Media) */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnBack}`}
                    onClick={handlePrevMedia}
                    title="Tekan 1 untuk Kembali ke media sebelumnya"
                >
                    <span className={styles.btnNumber}>1</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Kembali</span>
                        <span className={styles.btnSublabel}>◀ Back</span>
                    </div>
                </button>

                {/* Button 2: Next Media */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnNextMedia}`}
                    onClick={handleNextMedia}
                    title="Tekan 2 untuk melihat media selanjutnya"
                >
                    <span className={styles.btnNumber}>2</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Selanjutnya</span>
                        <span className={styles.btnSublabel}>Next ▶</span>
                    </div>
                </button>

                {/* Button 3: Lanjutkan */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnProceed}`}
                    onClick={handleProceed}
                    title="Tekan 3 untuk lanjut ke halaman Sharing"
                >
                    <span className={styles.btnNumber}>3</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Lanjutkan</span>
                        <span className={styles.btnSublabel}>Ke Sharing ➔</span>
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
        </div>
    )
}

export default OutputPage

