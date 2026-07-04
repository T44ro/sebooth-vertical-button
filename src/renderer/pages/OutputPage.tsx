import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFrameStore, useSessionStore, useFilterStore, useAppConfig } from '../stores'
import { PhotoSlot, QRSlot } from '@shared/types'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './OutputPage.module.css'
import { supabase } from '../lib/supabase'
import Lottie from 'lottie-react'
import PA22Animation from '../assets/PA22.json'
import QRCode from 'qrcode'

function OutputPage(): JSX.Element {
    const navigate = useNavigate()
    const { frames, activeFrame } = useFrameStore()
    const { photos, currentSession, setCompositePath, selectedFilter, isMirrored } = useSessionStore()
    const { config } = useAppConfig()

    const sessionFrame = currentSession?.frameId
        ? frames.find(f => f.id === currentSession.frameId)
        : activeFrame

    const [activeMedia, setActiveMedia] = useState<'strip' | 'gif' | 'live' | null>(null)
    const [viewedMedia, setViewedMedia] = useState<{ strip: boolean; gif: boolean; live: boolean }>({
        strip: false,
        gif: false,
        live: false
    })
    const [gifDataUrl, setGifDataUrl] = useState<string | null>(null)
    const [liveVideoPath, setLiveVideoPath] = useState<string | null>(null)
    const [compositeDataUrl, setCompositeDataUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [readyMessage, setReadyMessage] = useState<string | null>(null)
    const [isProcessing, setIsProcessing] = useState(true)
    const [isUploading, setIsUploading] = useState(false)
    const [uploadStatus, setUploadStatus] = useState<string>('')
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const autoOpenRef = useRef(false)
    const { setCloudSessionId } = useSessionStore()

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const uploadLockRef = useRef<string | null>(null)

    // Track viewed media
    useEffect(() => {
        if (activeMedia) {
            setViewedMedia(prev => ({ ...prev, [activeMedia]: true }))
        }
    }, [activeMedia])

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
            // Cloud Upload will be triggered via useEffect when all media ready
        } finally {
            setIsProcessing(false)
        }
    }

    // New: Trigger upload when processing is done and composite is ready
    const resolveSourceSlotId = (slot: PhotoSlot): string => {
        if (!slot.duplicateOfSlotId) return slot.id
        const sourceSlot = sessionFrame.slots.find(s => s.id === slot.duplicateOfSlotId)
        return sourceSlot ? resolveSourceSlotId(sourceSlot) : slot.duplicateOfSlotId
    }

    const getPhotoForSlot = (slot: PhotoSlot) => {
        const sourceSlotId = resolveSourceSlotId(slot)
        return photos.find(p => p.slotId === sourceSlotId)
    }

    useEffect(() => {
        if (!isProcessing && compositeDataUrl && config.sharingMode === 'cloud') {
            handleCloudUpload()
        }
    }, [isProcessing, compositeDataUrl, config.sharingMode])

    useEffect(() => {
        if (!isProcessing && photos.length > 0 && compositeDataUrl && !activeMedia && !autoOpenRef.current) {
            autoOpenRef.current = true
            setActiveMedia('strip')
            setReadyMessage('Photo Strip siap! Ketuk kembali jika ingin memilih GIF atau Live Photo.')
            setTimeout(() => setReadyMessage(null), 5000)
        }
    }, [isProcessing, photos.length, compositeDataUrl, activeMedia])

    useEffect(() => {
        if (!isProcessing && photos.length === 0) {
            setReadyMessage('Belum ada foto diambil. Kembali ke sesi capture untuk mengambil foto terlebih dahulu.')
        }
    }, [isProcessing, photos.length])

    // We remove the strict requirement for gif and video to avoid blocking upload if those fail
    // They will be uploaded if they eventually arrive while handleCloudUpload is running or in a retry

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

            // Set the ID immediately after DB record is created so QR code can point to the right place
            setCloudSessionId(sessionId)

            // 6. Upload all media and create database entries sequentially
            let successCount = 0
            const GCS_BUCKET_NAME = 'sebooth-media-konser'; // HARAP GANTI JIKA NAMA BUCKET ANDA BERBEDA!
            
            for (let i = 0; i < mediaToUpload.length; i++) {
                const item = mediaToUpload[i]
                const progress = `(${i + 1}/${mediaToUpload.length})`
                setUploadStatus(`Mengunggah ${item.label || item.type} ${progress}...`)
                
                try {
                    // Upload ke Google Cloud Storage via Electron Main Process
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
            console.error('❌ Cloud upload failed:', err)
            setError(`Cloud Upload Gagal: ${err.message || 'Unknown error'}`)
            setUploadStatus('Upload Gagal.')
            uploadLockRef.current = null // Reset lock on error
        } finally {
            setIsUploading(false)
        }
    }

    const extractLiveVideo = () => {
        // Find the first available pre-captured video in the session
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

    // Generate composite from photos using canvas
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

            // Draw QR code if enabled
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


    const renderShowcase = () => {
        if (!activeMedia) return null
        if (!sessionFrame && activeMedia === 'live') return null

        let content = null
        let title = ''

        if (activeMedia === 'strip') {
            title = 'Photo Strip'
            content = compositeDataUrl ? <img src={compositeDataUrl} alt="Strip" className={styles.showcaseMedia} /> : <p>Loading...</p>
        } else if (activeMedia === 'gif') {
            title = 'GIF Animation'
            content = gifDataUrl ? <img src={gifDataUrl} alt="GIF" className={styles.showcaseMedia} /> : (
                // Fallback grid if GIF fails or is generating
                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center'}}>
                    {photos.map((p, i) => (
                        <img key={i} src={p.imagePath} alt={`Frame ${i}`} style={{height: '250px', borderRadius: '8px'}} />
                    ))}
                </div>
            )
        } else if (activeMedia === 'live' && sessionFrame) {
            title = 'Live Photo'
            
            const scaleY = (window.innerHeight * 0.8) / sessionFrame.canvasHeight
            const scaleX = (window.innerWidth * 0.8) / sessionFrame.canvasWidth
            const scale = Math.min(scaleX, scaleY, 1)

            let filterStyle = {}
            if (selectedFilter === 'grayscale') filterStyle = { filter: 'grayscale(100%)' }
            else if (selectedFilter === 'sepia') filterStyle = { filter: 'sepia(80%)' }
            else if (selectedFilter === 'warm') filterStyle = { filter: 'saturate(1.3) hue-rotate(-10deg)' }
            else if (selectedFilter === 'cool') filterStyle = { filter: 'saturate(1.1) hue-rotate(10deg)' }
            else if (selectedFilter === 'vintage') filterStyle = { filter: 'contrast(1.1) brightness(0.9) sepia(30%)' }

            content = (
                <div style={{
                    position: 'relative',
                    width: sessionFrame.canvasWidth * scale,
                    height: sessionFrame.canvasHeight * scale,
                    boxShadow: '0 0 50px rgba(0,0,0,0.8)',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backgroundColor: 'white',
                    flexShrink: 0
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
                            
                            // Use video if available, fallback to image if not
                            const isVideo = !!photo.videoPath
                            let src = photo.imagePath
                            if (isVideo) {
                                if (photo.videoPath!.startsWith('blob:') || photo.videoPath!.startsWith('file://')) {
                                    src = photo.videoPath!
                                } else {
                                    src = `file:///${photo.videoPath!.replace(/\\/g, '/')}`
                                }
                            }
                            
                            const mediaStyle: React.CSSProperties = {
                                position: 'absolute',
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                transform: `translate(${photo.panX || 0}px, ${photo.panY || 0}px) scale(${photo.scale || 1})`,
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

        return (
            <motion.div 
                className={styles.showcaseContainer}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
            >
                <div className={styles.showcaseHeader}>
                    <h2 className={styles.showcaseTitle}>{title}</h2>
                    <button className={styles.closeButton} onClick={() => setActiveMedia(null)}>✕</button>
                </div>
                <div className={styles.mediaWrapper}>
                    {content}
                </div>
            </motion.div>
        )
    }

    const allViewed = viewedMedia.strip && viewedMedia.gif && viewedMedia.live

    return (
        <div className={styles.container}>
            <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setIsConfirmModalOpen(true)}
                title="Back to Home"
                style={{
                    position: 'fixed',
                    top: '20px',
                    left: '20px',
                    padding: '5px 10px',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    zIndex: 100
                }}
            >
                ← Kembali
            </motion.button>
            {error && <div className={styles.errorMessage}>{error}</div>}

            <canvas ref={canvasRef} style={{ display: 'none' }} />

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

            {readyMessage && !isProcessing && !isUploading && (
                <div className={styles.readyMessage}>{readyMessage}</div>
            )}

            {/* 3 Interactive Buttons */}
            <AnimatePresence mode="wait">
                {!isProcessing && !activeMedia && (
                    <motion.div
                        key="buttons-grid"
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.1 }}
                        className={styles.buttonsContainer}
                    >
                        <div className={`${styles.mediaButton} ${viewedMedia.strip ? styles.viewed : ''}`} onClick={() => setActiveMedia('strip')}>
                            {viewedMedia.strip && <div className={styles.viewedCheck}>✓</div>}
                            <div className={styles.buttonIcon}>
                                <img src="./assets/icons/icon-photo-strip.png" alt="Photo Strip" />
                            </div>
                            <div className={styles.buttonText}>Photo Strip</div>
                        </div>
                        <div className={`${styles.mediaButton} ${viewedMedia.gif ? styles.viewed : ''}`} onClick={() => setActiveMedia('gif')}>
                            {viewedMedia.gif && <div className={styles.viewedCheck}>✓</div>}
                            <div className={styles.buttonIcon}>
                                <img src="./assets/icons/icon-gif.png" alt="GIF" />
                            </div>
                            <div className={styles.buttonText}>GIF</div>
                        </div>
                        <div className={`${styles.mediaButton} ${viewedMedia.live ? styles.viewed : ''}`} onClick={() => setActiveMedia('live')}>
                            {viewedMedia.live && <div className={styles.viewedCheck}>✓</div>}
                            <div className={styles.buttonIcon}>
                                <img src="./assets/icons/icon-live-photo.png" alt="Live Photo" />
                            </div>
                            <div className={styles.buttonText}>Live Photo</div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Showcase Overlay */}
            <AnimatePresence>
                {renderShowcase()}
            </AnimatePresence>

            {/* Next Button only visible when all media reviewed */}
            <AnimatePresence>
                {!isProcessing && allViewed && !activeMedia && (
                    <motion.button
                        initial={{ opacity: 0, scale: 0.8, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className={styles.nextButton}
                        onClick={() => navigate('/sharing')}
                        disabled={config.sharingMode === 'cloud' && !currentSession?.cloudSessionId}
                    >
                        Lanjutkan <span>→</span>
                    </motion.button>
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
        </div>
    )
}

export default OutputPage
