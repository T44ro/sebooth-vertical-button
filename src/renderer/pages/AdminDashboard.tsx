import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFrameStore, useAppConfig, useFilterStore, useSessionStore } from '../stores'
import { AppConfig, FrameConfig, PhotoSlot, PrinterDevice } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { apiHelper } from '../lib/apiHelper'
import { getSessionHistory, SessionHistoryItem, getSupabase } from '../lib/supabase'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './AdminDashboard.module.css'

type DragMode = 'move' | 'resize-se' | 'resize-sw' | 'resize-ne' | 'resize-nw' | 'rotate' | null

function AdminDashboard(): JSX.Element {
    const navigate = useNavigate()
    const { frames, addFrame, updateFrame, deleteFrame, addSlot, updateSlot, deleteSlot, addQRSlot, updateQRSlot, deleteQRSlot, setActiveFrame, undo, redo } = useFrameStore()
    const { config, updateConfig } = useAppConfig()
    const { filters, addFilter, removeFilter } = useFilterStore()
    const { endSession } = useSessionStore()

    const [activeTab, setActiveTab] = useState<'frames' | 'timers' | 'filters' | 'payment' | 'history' | 'sharing' | 'printers' | 'queue' | 'webhook'>('frames')
    const [cloudQueue, setCloudQueue] = useState<any[]>([])
    const [isLoadingQueue, setIsLoadingQueue] = useState(false)
    const [eventsList, setEventsList] = useState<{ id: string; name: string; booth_name: string }[]>([])
    const [isLoadingEvents, setIsLoadingEvents] = useState(false)
    const [printQueue, setPrintQueue] = useState<any[]>([])
    const [printHistory, setPrintHistory] = useState<any[]>([])
    const [isLoadingPrintData, setIsLoadingPrintData] = useState(false)
    const [selectedFrameId, setSelectedFrameId] = useState<string | null>(frames[0]?.id || null)
    const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null)
    const [dragMode, setDragMode] = useState<DragMode>(null)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, slotX: 0, slotY: 0, slotW: 0, slotH: 0 })
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
    const [canvasZoom, setCanvasZoom] = useState(1)
    const [historyData, setHistoryData] = useState<SessionHistoryItem[]>([])
    const [historyTotal, setHistoryTotal] = useState(0)
    const [historyPage, setHistoryPage] = useState(0)
    const [isLoadingHistory, setIsLoadingHistory] = useState(false)
    const [localIp, setLocalIp] = useState<string>('0.0.0.0')
    const [availablePrinters, setAvailablePrinters] = useState<PrinterDevice[]>([])
    const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
    const [isLoadingDevices, setIsLoadingDevices] = useState(false)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)

    const canvasRef = useRef<HTMLDivElement>(null)

    // Fetch handlers
    const fetchIp = async () => {
        const result = await (window as any).api.system.getLocalIp()
        if (result.success && result.data) setLocalIp(result.data)
    }

    const fetchCloudQueue = async () => {
        setIsLoadingQueue(true)
        try {
            const q = await apiHelper.getQueue()
            setCloudQueue(q || [])
        } catch(e) {}
        setIsLoadingQueue(false)
    }

    const fetchPrintData = async () => {
        setIsLoadingPrintData(true)
        try {
            const q = await apiHelper.getPrintQueue()
            const h = await apiHelper.getPrintHistory()
            setPrintQueue(q || [])
            setPrintHistory(h || [])
        } catch(e) {}
        setIsLoadingPrintData(false)
    }

    // Load initial data on mount
    useEffect(() => {
        fetchIp()
    }, [])

    // Polling handler mapping to activeTab
    useEffect(() => {
        if (activeTab === 'queue') {
            fetchCloudQueue()
        }
        if (activeTab === 'printers') {
            fetchPrintData()
        }
        
        const intervalId = setInterval(() => {
            if (activeTab === 'queue') fetchCloudQueue()
            if (activeTab === 'printers') fetchPrintData()
        }, 5000)
        
        return () => clearInterval(intervalId)
    }, [activeTab])

    // Fetch queue events from Supabase when queue tab is selected
    useEffect(() => {
        if (activeTab === 'queue') {
            const fetchEvents = async () => {
                setIsLoadingEvents(true)
                try {
                    const supabaseClient = getSupabase()
                    const { data, error } = await supabaseClient
                        .from('queue_events')
                        .select('id, name, booth_name')
                        .order('created_at', { ascending: false })
                    if (!error && data) {
                        setEventsList(data)
                    }
                } catch (e) {
                    console.error('Failed to fetch events from Supabase:', e)
                } finally {
                    setIsLoadingEvents(false)
                }
            }
            fetchEvents()
        }
    }, [activeTab])

    // Fetch available printers
    useEffect(() => {
        const fetchPrinters = async () => {
            const result = await window.api.printer.list()
            if (result.success && result.data) {
                setAvailablePrinters(result.data)
            }
        }
        fetchPrinters()
    }, [])

    // Fetch video devices (webcams/capture cards)
    useEffect(() => {
        const fetchDevices = async () => {
            setIsLoadingDevices(true)
            try {
                // Request permissions first to get proper device labels
                let stream = null;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: true })
                } catch (e) {
                    console.warn('Initial getUserMedia failed, device labels might be generic:', e)
                }
                
                const devices = await navigator.mediaDevices.enumerateDevices()
                const videoInputs = devices.filter(device => device.kind === 'videoinput')
                setVideoDevices(videoInputs)
                
                // Stop the temporary stream
                if (stream) {
                    stream.getTracks().forEach(track => track.stop())
                }
            } catch (err) {
                console.error('Error fetching video devices:', err)
                setVideoDevices([])
            } finally {
                setIsLoadingDevices(false)
            }
        }
        if (activeTab === 'printers') {
            fetchDevices()
            
            // Auto-refresh devices when hardware configuration changes (connecting/disconnecting camera)
            navigator.mediaDevices.addEventListener('devicechange', fetchDevices)
            return () => {
                navigator.mediaDevices.removeEventListener('devicechange', fetchDevices)
            }
        }
        return undefined
    }, [activeTab])

    const selectedFrame = frames.find(f => f.id === selectedFrameId)

    const getQRSlots = useCallback((frame: any): any[] => {
        if (!frame) return []
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
    }, [])

    // Handle mouse move on canvas for dragging and resizing
    const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
        if (!draggedSlotId || !selectedFrame || !canvasRef.current || !dragMode) return

        const rect = canvasRef.current.getBoundingClientRect()
        const scaleX = selectedFrame.canvasWidth / rect.width
        const scaleY = selectedFrame.canvasHeight / rect.height

        const deltaX = (e.clientX - dragStart.x) * scaleX
        const deltaY = (e.clientY - dragStart.y) * scaleY

        const activeQrSlots = getQRSlots(selectedFrame)
        const qrSlot = activeQrSlots.find(s => s.id === draggedSlotId)

        if (qrSlot) {
            const updateQRSlotData = (updates: any) => {
                if (qrSlot.id === 'legacy-qr') {
                    updateFrame(selectedFrame.id, {
                        qrSlot: {
                            ...selectedFrame.qrSlot!,
                            ...updates
                        }
                    })
                } else {
                    updateQRSlot(selectedFrame.id, qrSlot.id, updates)
                }
            }

            if (dragMode === 'move') {
                updateQRSlotData({
                    x: Math.max(0, Math.min(dragStart.slotX + deltaX, selectedFrame.canvasWidth - 50)),
                    y: Math.max(0, Math.min(dragStart.slotY + deltaY, selectedFrame.canvasHeight - 50))
                })
            } else if (dragMode === 'resize-se') {
                updateQRSlotData({
                    width: Math.max(50, dragStart.slotW + deltaX),
                    height: Math.max(50, dragStart.slotH + deltaY)
                })
            } else if (dragMode === 'resize-sw') {
                const newWidth = Math.max(50, dragStart.slotW - deltaX)
                updateQRSlotData({
                    x: dragStart.slotX + dragStart.slotW - newWidth,
                    width: newWidth,
                    height: Math.max(50, dragStart.slotH + deltaY)
                })
            } else if (dragMode === 'resize-ne') {
                const newHeight = Math.max(50, dragStart.slotH - deltaY)
                updateQRSlotData({
                    y: dragStart.slotY + dragStart.slotH - newHeight,
                    width: Math.max(50, dragStart.slotW + deltaX),
                    height: newHeight
                })
            } else if (dragMode === 'resize-nw') {
                const newWidth = Math.max(50, dragStart.slotW - deltaX)
                const newHeight = Math.max(50, dragStart.slotH - deltaY)
                updateQRSlotData({
                    x: dragStart.slotX + dragStart.slotW - newWidth,
                    y: dragStart.slotY + dragStart.slotH - newHeight,
                    width: newWidth,
                    height: newHeight
                })
            }
            return
        }

        if (dragMode === 'move') {
            updateSlot(selectedFrame.id, draggedSlotId, {
                x: Math.max(0, Math.min(dragStart.slotX + deltaX, selectedFrame.canvasWidth - 50)),
                y: Math.max(0, Math.min(dragStart.slotY + deltaY, selectedFrame.canvasHeight - 50))
            })
        } else if (dragMode === 'resize-se') {
            updateSlot(selectedFrame.id, draggedSlotId, {
                width: Math.max(100, dragStart.slotW + deltaX),
                height: Math.max(75, dragStart.slotH + deltaY)
            })
        } else if (dragMode === 'resize-sw') {
            const newWidth = Math.max(100, dragStart.slotW - deltaX)
            updateSlot(selectedFrame.id, draggedSlotId, {
                x: dragStart.slotX + dragStart.slotW - newWidth,
                width: newWidth,
                height: Math.max(75, dragStart.slotH + deltaY)
            })
        } else if (dragMode === 'resize-ne') {
            const newHeight = Math.max(75, dragStart.slotH - deltaY)
            updateSlot(selectedFrame.id, draggedSlotId, {
                y: dragStart.slotY + dragStart.slotH - newHeight,
                width: Math.max(100, dragStart.slotW + deltaX),
                height: newHeight
            })
        } else if (dragMode === 'resize-nw') {
            const newWidth = Math.max(100, dragStart.slotW - deltaX)
            const newHeight = Math.max(75, dragStart.slotH - deltaY)
            updateSlot(selectedFrame.id, draggedSlotId, {
                x: dragStart.slotX + dragStart.slotW - newWidth,
                y: dragStart.slotY + dragStart.slotH - newHeight,
                width: newWidth,
                height: newHeight
            })
        } else if (dragMode === 'rotate') {
            // Calculate rotation based on angle from slot center to mouse
            const slot = selectedFrame.slots.find(s => s.id === draggedSlotId)
            if (slot) {
                const slotCenterX = (slot.x + slot.width / 2) / selectedFrame.canvasWidth * rect.width
                const slotCenterY = (slot.y + slot.height / 2) / selectedFrame.canvasHeight * rect.height
                const mouseX = e.clientX - rect.left
                const mouseY = e.clientY - rect.top
                const angle = Math.atan2(mouseY - slotCenterY, mouseX - slotCenterX) * (180 / Math.PI) + 90
                updateSlot(selectedFrame.id, draggedSlotId, {
                    rotation: Math.round(angle)
                })
            }
        }
    }, [draggedSlotId, selectedFrame, dragMode, dragStart, updateSlot, updateFrame])

    // Handle canvas wheel for zoom
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey && canvasRef.current?.contains(e.target as Node)) {
                e.preventDefault()
                const delta = e.deltaY > 0 ? -0.1 : 0.1
                setCanvasZoom(prev => Math.max(0.25, Math.min(2, prev + delta)))
            }
        }
        window.addEventListener('wheel', handleWheel, { passive: false })
        return () => window.removeEventListener('wheel', handleWheel)
    }, [])

    // Handle keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault()
                undo()
            } else if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
                e.preventDefault()
                redo()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [undo, redo])

    // Load session history when tab is active
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory()
        }
    }, [activeTab, historyPage])


    const loadHistory = async () => {
        setIsLoadingHistory(true)
        const result = await getSessionHistory({ limit: 20, offset: historyPage * 20 })
        if ('data' in result) {
            setHistoryData(result.data)
            setHistoryTotal(result.total)
        }
        setIsLoadingHistory(false)
    }

    const exportToCSV = async () => {
        // Fetch ALL records for export
        const allResult = await getSessionHistory({ limit: 10000, offset: 0 })
        if (!('data' in allResult) || allResult.data.length === 0) return

        const headers = ['No', 'Session ID', 'Email', 'Print Count', 'Gallery URL', 'Date/Time']
        const rows = allResult.data.map((item, index) => [
            index + 1,
            item.session_id || item.id,
            item.email || '-',
            item.print_count,
            item.gallery_url || '-',
            new Date(item.created_at).toLocaleString('id-ID')
        ])

        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `session_history_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    // Helper to get display number for a slot
    // Non-duplicate slots are numbered sequentially (1, 2, 3...)
    // Duplicate slots show the same number as their source slot
    const getSlotDisplayNumber = useCallback((slot: PhotoSlot, _slotIndex: number): string => {
        if (!selectedFrame) return '?'

        // Find all non-duplicate slots
        const nonDuplicateSlots = selectedFrame.slots.filter(s => !s.duplicateOfSlotId)

        if (slot.duplicateOfSlotId) {
            // This is a duplicate - find and return the source slot's sequential number
            const sourceSlot = selectedFrame.slots.find(s => s.id === slot.duplicateOfSlotId)
            if (sourceSlot) {
                const sourceSequentialIndex = nonDuplicateSlots.findIndex(s => s.id === sourceSlot.id)
                return `${sourceSequentialIndex + 1}`
            }
            return '?'
        } else {
            // This is a non-duplicate - find its position among non-duplicates
            const sequentialIndex = nonDuplicateSlots.findIndex(s => s.id === slot.id)
            return `${sequentialIndex + 1}`
        }
    }, [selectedFrame])

    // Zoom controls
    const handleZoomIn = () => setCanvasZoom(prev => Math.min(2, prev + 0.25))
    const handleZoomOut = () => setCanvasZoom(prev => Math.max(0.25, prev - 0.25))
    const handleZoomReset = () => setCanvasZoom(1)

    // Handle mouse up - stop dragging/resizing
    const handleCanvasMouseUp = useCallback(() => {
        setDraggedSlotId(null)
        setDragMode(null)
    }, [])

    // Handle rotation mouse down
    const handleRotateMouseDown = useCallback((slotId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const slot = selectedFrame?.slots.find(s => s.id === slotId)
        if (!slot) return

        setDragStart({ x: e.clientX, y: e.clientY, slotX: slot.x, slotY: slot.y, slotW: slot.width, slotH: slot.height })
        setDraggedSlotId(slotId)
        setDragMode('rotate')
        setSelectedSlotId(slotId)
    }, [selectedFrame])

    // Handle slot mouse down - start moving
    const handleSlotMouseDown = useCallback((slotId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const slot = selectedFrame?.slots.find(s => s.id === slotId)
        if (!slot) return

        setDragStart({ x: e.clientX, y: e.clientY, slotX: slot.x, slotY: slot.y, slotW: slot.width, slotH: slot.height })
        setDraggedSlotId(slotId)
        setDragMode('move')
        setSelectedSlotId(slotId)
    }, [selectedFrame])

    // Handle resize handle mouse down
    const handleResizeMouseDown = useCallback((slotId: string, corner: 'se' | 'sw' | 'ne' | 'nw', e: React.MouseEvent) => {
        e.stopPropagation()
        const slot = selectedFrame?.slots.find(s => s.id === slotId)
        if (!slot) return

        setDragStart({ x: e.clientX, y: e.clientY, slotX: slot.x, slotY: slot.y, slotW: slot.width, slotH: slot.height })
        setDraggedSlotId(slotId)
        setDragMode(`resize-${corner}`)
        setSelectedSlotId(slotId)
    }, [selectedFrame])

    // Handle QR slot mouse down - start moving
    const handleQRSlotMouseDown = useCallback((slotId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const qr = getQRSlots(selectedFrame).find(s => s.id === slotId)
        if (!qr) return

        setDragStart({ x: e.clientX, y: e.clientY, slotX: qr.x, slotY: qr.y, slotW: qr.width, slotH: qr.height })
        setDraggedSlotId(slotId)
        setDragMode('move')
        setSelectedSlotId(slotId)
    }, [selectedFrame, getQRSlots])

    // Handle QR resize handle mouse down
    const handleQRResizeMouseDown = useCallback((slotId: string, corner: 'se' | 'sw' | 'ne' | 'nw', e: React.MouseEvent) => {
        e.stopPropagation()
        const qr = getQRSlots(selectedFrame).find(s => s.id === slotId)
        if (!qr) return

        setDragStart({ x: e.clientX, y: e.clientY, slotX: qr.x, slotY: qr.y, slotW: qr.width, slotH: qr.height })
        setDraggedSlotId(slotId)
        setDragMode(`resize-${corner}`)
        setSelectedSlotId(slotId)
    }, [selectedFrame, getQRSlots])

    // Handle frame upload
    const handleFrameUpload = async (): Promise<void> => {
        const result = await window.api.system.openFileDialog({
            title: 'Select Frame Overlay',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
        })

        if (result.success && result.data && result.data.length > 0) {
            const filePath = result.data[0]
            const frameId = addFrame({
                name: `Frame ${frames.length + 1}`,
                overlayPath: filePath,
                slots: [],
                canvasWidth: 1200,
                canvasHeight: 1800
            })
            setSelectedFrameId(frameId)
        }
    }

    // Handle filter upload
    const handleFilterUpload = async (): Promise<void> => {
        const result = await window.api.system.openFileDialog({
            title: 'Select LUT Filter',
            filters: [{ name: 'CUBE Files', extensions: ['cube', 'CUBE'] }]
        })

        if (result.success && result.data && result.data.length > 0) {
            addFilter({
                name: `Filter ${filters.length + 1}`,
                cubePath: result.data[0]
            })
        }
    }

    // Handle custom background upload
    const handleBgUpload = async (mode: 'landscape' | 'portrait'): Promise<void> => {
        if (!(window as any).api) {
            alert('Background customization is only available when configuring directly on the photobooth machine.')
            return
        }

        const result = await (window as any).api.system.openFileDialog({
            title: `Select Custom ${mode === 'landscape' ? 'Landscape' : 'Portrait'} Background`,
            filters: [{ name: 'Images & Videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov'] }]
        })

        if (result.success && result.data && result.data.length > 0) {
            const sourcePath = result.data[0]
            const extension = sourcePath.split('.').pop()?.toLowerCase() || ''
            const isVideo = ['mp4', 'webm', 'mov'].includes(extension)
            const type: 'image' | 'video' = isVideo ? 'video' : 'image'

            try {
                const userDataPathRes = await (window as any).api.system.getUserDataPath()
                if (userDataPathRes.success && userDataPathRes.data) {
                    const destFolder = `${userDataPathRes.data}/backgrounds`
                    const fileName = `custom_bg_${mode}_${Date.now()}.${extension}`
                    const destPath = `${destFolder}/${fileName}`
                    
                    const copyRes = await (window as any).api.system.copyFile(sourcePath, destPath)
                    if (copyRes.success) {
                        if (mode === 'landscape') {
                            updateConfig({
                                customBgLandscape: destPath,
                                customBgLandscapeType: type
                            })
                        } else {
                            updateConfig({
                                customBgPortrait: destPath,
                                customBgPortraitType: type
                            })
                        }
                    } else {
                        console.error('Failed to copy custom background:', copyRes.error)
                        alert(`Failed to copy background file: ${copyRes.error}`)
                    }
                }
            } catch (e) {
                console.error('Error during custom background upload:', e)
                // Fallback: use sourcePath directly if file copy fails
                if (mode === 'landscape') {
                    updateConfig({
                        customBgLandscape: sourcePath,
                        customBgLandscapeType: type
                    })
                } else {
                    updateConfig({
                        customBgPortrait: sourcePath,
                        customBgPortraitType: type
                    })
                }
            }
        }
    }

    // Handle custom background clear
    const handleBgClear = (mode: 'landscape' | 'portrait'): void => {
        if (mode === 'landscape') {
            updateConfig({
                customBgLandscape: '',
                customBgLandscapeType: undefined
            })
        } else {
            updateConfig({
                customBgPortrait: '',
                customBgPortraitType: undefined
            })
        }
    }

    // Add new slot
    const handleAddSlot = (): void => {
        if (selectedFrame) {
            addSlot(selectedFrame.id, {
                x: 50 + (selectedFrame.slots.length * 30),
                y: 50 + (selectedFrame.slots.length * 30),
                width: 350,
                height: 250
            })
        }
    }

    // Delete selected slot
    const handleDeleteSelectedSlot = (): void => {
        if (selectedFrame && selectedSlotId) {
            deleteSlot(selectedFrame.id, selectedSlotId)
            setSelectedSlotId(null)
        }
    }

    // Clear all slots
    const handleClearAllSlots = (): void => {
        if (selectedFrame && window.confirm('Are you sure you want to delete all slots?')) {
            selectedFrame.slots.forEach(slot => {
                deleteSlot(selectedFrame.id, slot.id)
            })
            setSelectedSlotId(null)
        }
    }

    // Toggle frame as active (allows multiple active frames)
    const handleSetActive = (): void => {
        if (selectedFrame) {
            const isActive = config.activeFrameIds.includes(selectedFrame.id)
            if (isActive) {
                // Remove from active frames
                updateConfig({
                    activeFrameIds: config.activeFrameIds.filter(id => id !== selectedFrame.id)
                })
            } else {
                // Add to active frames
                updateConfig({
                    activeFrameIds: [...config.activeFrameIds, selectedFrame.id]
                })
            }
            setActiveFrame(selectedFrame.id)
        }
    }

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* Header */}
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => setIsConfirmModalOpen(true)}>
                    ← Back
                </button>
                <h1>Admin Dashboard</h1>
                <div className={styles.headerActions}>
                    <span style={{ fontSize: '14px', color: '#10b981', marginRight: '15px', fontWeight: 'bold' }}>
                        ✅ Settings Auto-Save Enabled
                    </span>
                </div>
            </header>

            {/* Tabs */}
            <nav className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'frames' ? styles.active : ''}`}
                    onClick={() => setActiveTab('frames')}
                >
                    🖼️ Frames
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'timers' ? styles.active : ''}`}
                    onClick={() => setActiveTab('timers')}
                >
                    ⏱️ Timers
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'filters' ? styles.active : ''}`}
                    onClick={() => setActiveTab('filters')}
                >
                    🎨 Filters
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'payment' ? styles.active : ''}`}
                    onClick={() => setActiveTab('payment')}
                >
                    💳 Payment
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'history' ? styles.active : ''}`}
                    onClick={() => setActiveTab('history')}
                >
                    📋 History
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'sharing' ? styles.active : ''}`}
                    onClick={() => setActiveTab('sharing')}
                >
                    📡 Sharing
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'printers' ? styles.active : ''}`}
                    onClick={() => setActiveTab('printers')}
                >
                    🖨️ Printers
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'queue' ? styles.active : ''}`}
                    onClick={() => setActiveTab('queue')}
                >
                    ☁️ Cloud Queue
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'webhook' ? styles.active : ''}`}
                    onClick={() => setActiveTab('webhook')}
                >
                    🔗 Queue Integration
                </button>
            </nav>

            {/* Content */}
            <main className={styles.content}>
                {activeTab === 'frames' && (
                    <div className={styles.framesTab}>
                        {/* Frame List */}
                        <aside className={styles.frameList}>
                            <div className={styles.listHeader}>
                                <h3>Frames</h3>
                                <button className={styles.addButton} onClick={handleFrameUpload}>
                                    + Add
                                </button>
                            </div>

                            <div className={styles.frameItems}>
                                {frames.map(frame => (
                                    <div
                                        key={frame.id}
                                        className={`${styles.frameItem} ${frame.id === selectedFrameId ? styles.selected : ''}`}
                                        onClick={() => setSelectedFrameId(frame.id)}
                                    >
                                        <div className={styles.framePreview}>
                                            <img src={`file://${frame.overlayPath}`} alt={frame.name} />
                                        </div>
                                        <div className={styles.frameInfo}>
                                            <span className={styles.frameName}>{frame.name}</span>
                                            <span className={styles.frameSlots}>{frame.slots.length} slots</span>
                                        </div>
                                        {config.activeFrameIds.includes(frame.id) && (
                                            <span className={styles.activeBadge}>Active</span>
                                        )}
                                        <button
                                            className={styles.deleteButton}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                deleteFrame(frame.id)
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}

                                {frames.length === 0 && (
                                    <div className={styles.emptyState}>
                                        <p>No frames yet</p>
                                        <p>Upload a PNG overlay to get started</p>
                                    </div>
                                )}
                            </div>
                        </aside>

                        {/* Canvas Editor */}
                        <div className={styles.canvasEditor}>
                            {selectedFrame ? (
                                <>
                                    <div className={styles.editorHeader}>
                                        <input
                                            className={styles.frameNameInput}
                                            value={selectedFrame.name}
                                            onChange={(e) => updateFrame(selectedFrame.id, { name: e.target.value })}
                                        />
                                        <div className={styles.canvasSize}>
                                            <label>Canvas:</label>
                                            <input
                                                type="number"
                                                value={selectedFrame.canvasWidth}
                                                onChange={(e) => updateFrame(selectedFrame.id, { canvasWidth: parseInt(e.target.value) })}
                                            />
                                            <span>×</span>
                                            <input
                                                type="number"
                                                value={selectedFrame.canvasHeight}
                                                onChange={(e) => updateFrame(selectedFrame.id, { canvasHeight: parseInt(e.target.value) })}
                                            />
                                        </div>
                                        <button className={styles.addSlotButton} onClick={handleAddSlot}>
                                            + Add Photo Slot
                                        </button>
                                        <button
                                            className={styles.primaryButton}
                                            onClick={handleSetActive}
                                            style={{ marginLeft: '10px' }}
                                        >
                                            Set as Active Frame
                                        </button>
                                        {selectedFrame.slots.length > 0 && (
                                            <button className={styles.clearSlotsButton} onClick={handleClearAllSlots}>
                                                🗑️ Clear All
                                            </button>
                                        )}
                                    </div>

                                    {/* Zoom Controls */}
                                    <div className={styles.zoomControls}>
                                        <button onClick={handleZoomOut} title="Zoom Out">−</button>
                                        <span className={styles.zoomLevel}>{Math.round(canvasZoom * 100)}%</span>
                                        <button onClick={handleZoomIn} title="Zoom In">+</button>
                                        <button onClick={handleZoomReset} title="Reset Zoom">↺</button>
                                    </div>

                                    <div className={styles.canvasWrapper}>
                                        <div
                                            ref={canvasRef}
                                            className={styles.canvas}
                                            style={{
                                                aspectRatio: `${selectedFrame.canvasWidth} / ${selectedFrame.canvasHeight}`,
                                                cursor: draggedSlotId ? 'grabbing' : 'default',
                                                transform: `scale(${canvasZoom})`,
                                                transformOrigin: 'center center'
                                            }}
                                            onMouseMove={handleCanvasMouseMove}
                                            onMouseUp={handleCanvasMouseUp}
                                            onMouseLeave={handleCanvasMouseUp}
                                        >
                                            {/* Frame overlay preview */}
                                            <img
                                                src={`file://${selectedFrame.overlayPath}`}
                                                alt="Frame"
                                                className={styles.frameOverlay}
                                            />

                                            {/* Photo slots */}
                                            {selectedFrame.slots.map((slot, index) => (
                                                <div
                                                    key={slot.id}
                                                    className={`${styles.slot} ${draggedSlotId === slot.id ? styles.dragging : ''} ${selectedSlotId === slot.id ? styles.selected : ''}`}
                                                    style={{
                                                        left: `${(slot.x / selectedFrame.canvasWidth) * 100}%`,
                                                        top: `${(slot.y / selectedFrame.canvasHeight) * 100}%`,
                                                        width: `${(slot.width / selectedFrame.canvasWidth) * 100}%`,
                                                        height: `${(slot.height / selectedFrame.canvasHeight) * 100}%`,
                                                        transform: `rotate(${slot.rotation}deg)`,
                                                        cursor: dragMode === 'move' && draggedSlotId === slot.id ? 'grabbing' : 'grab'
                                                    }}
                                                    onMouseDown={(e) => handleSlotMouseDown(slot.id, e)}
                                                >
                                                    <span className={styles.slotNumber}>{getSlotDisplayNumber(slot, index)}</span>

                                                    {/* Rotation handle at top center */}
                                                    <div
                                                        className={styles.rotateHandle}
                                                        onMouseDown={(e) => handleRotateMouseDown(slot.id, e)}
                                                        title="Drag to rotate"
                                                    />

                                                    {/* Delete button */}
                                                    <button
                                                        className={styles.deleteSlotButton}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            deleteSlot(selectedFrame.id, slot.id)
                                                        }}
                                                        title="Delete this slot"
                                                    >
                                                        ×
                                                    </button>

                                                    {/* Resize handles at corners */}
                                                    <div
                                                        className={`${styles.resizeHandle} ${styles.handleNW}`}
                                                        onMouseDown={(e) => handleResizeMouseDown(slot.id, 'nw', e)}
                                                    />
                                                    <div
                                                        className={`${styles.resizeHandle} ${styles.handleNE}`}
                                                        onMouseDown={(e) => handleResizeMouseDown(slot.id, 'ne', e)}
                                                    />
                                                    <div
                                                        className={`${styles.resizeHandle} ${styles.handleSW}`}
                                                        onMouseDown={(e) => handleResizeMouseDown(slot.id, 'sw', e)}
                                                    />
                                                    <div
                                                        className={`${styles.resizeHandle} ${styles.handleSE}`}
                                                        onMouseDown={(e) => handleResizeMouseDown(slot.id, 'se', e)}
                                                    />
                                                </div>
                                            ))}

                                            {getQRSlots(selectedFrame).map((slot, index) => {
                                                if (!slot.enabled) return null
                                                const slotLabel = slot.id === 'legacy-qr' ? 'QR Code' : `QR ${index + 1}`
                                                return (
                                                    <div
                                                        key={slot.id}
                                                        className={`${styles.slot} ${styles.qrSlot} ${draggedSlotId === slot.id ? styles.dragging : ''} ${selectedSlotId === slot.id ? styles.selected : ''}`}
                                                        style={{
                                                            left: `${(slot.x / selectedFrame.canvasWidth) * 100}%`,
                                                            top: `${(slot.y / selectedFrame.canvasHeight) * 100}%`,
                                                            width: `${(slot.width / selectedFrame.canvasWidth) * 100}%`,
                                                            height: `${(slot.height / selectedFrame.canvasHeight) * 100}%`,
                                                            cursor: dragMode === 'move' && draggedSlotId === slot.id ? 'grabbing' : 'grab'
                                                        }}
                                                        onMouseDown={(e) => handleQRSlotMouseDown(slot.id, e)}
                                                    >
                                                        <span className={styles.slotNumber} style={{ fontSize: '14px', color: '#3b82f6' }}>{slotLabel}</span>
                                                        
                                                        {slot.id !== 'legacy-qr' && (
                                                            <button
                                                                className={styles.deleteSlotButton}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    deleteQRSlot(selectedFrame.id, slot.id)
                                                                    if (selectedSlotId === slot.id) setSelectedSlotId(null)
                                                                }}
                                                                title="Delete this QR slot"
                                                            >
                                                                ×
                                                            </button>
                                                        )}

                                                        {/* Resize handles at corners */}
                                                        <div
                                                            className={`${styles.resizeHandle} ${styles.handleNW}`}
                                                            onMouseDown={(e) => handleQRResizeMouseDown(slot.id, 'nw', e)}
                                                        />
                                                        <div
                                                            className={`${styles.resizeHandle} ${styles.handleNE}`}
                                                            onMouseDown={(e) => handleQRResizeMouseDown(slot.id, 'ne', e)}
                                                        />
                                                        <div
                                                            className={`${styles.resizeHandle} ${styles.handleSW}`}
                                                            onMouseDown={(e) => handleQRResizeMouseDown(slot.id, 'sw', e)}
                                                        />
                                                        <div
                                                            className={`${styles.resizeHandle} ${styles.handleSE}`}
                                                            onMouseDown={(e) => handleQRResizeMouseDown(slot.id, 'se', e)}
                                                        />
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className={styles.noFrameSelected}>
                                    <p>Select a frame to edit or upload a new one</p>
                                </div>
                            )}
                        </div>

                        {/* Slot Sidebar (Right Column) */}
                        {selectedFrame && (
                            <aside className={styles.slotSidebar}>
                                <div className={styles.sidebarHeader}>
                                    <h3>📁 Photo Slots</h3>
                                    <span className={styles.slotCount}>{selectedFrame.slots.length} slots</span>
                                </div>
                                <div className={styles.slotListSidebar}>
                                    {/* QR Code Box settings */}
                                    <div className={styles.qrSlotSection}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                            <h4 style={{ margin: 0, fontSize: '14px', color: 'white' }}>🔗 QR Code Slots</h4>
                                            <button 
                                                className={styles.addButton}
                                                style={{ padding: '2px 8px', fontSize: '12px' }}
                                                onClick={() => addQRSlot(selectedFrame.id)}
                                            >
                                                + Add QR Slot
                                            </button>
                                        </div>

                                        {getQRSlots(selectedFrame).map((slot, index) => {
                                            const slotLabel = slot.id === 'legacy-qr' ? 'QR Code (Legacy)' : `QR Slot ${index + 1}`
                                            return (
                                                <div
                                                    key={slot.id}
                                                    className={`${styles.slotItemSidebar} ${selectedSlotId === slot.id ? styles.expanded : ''}`}
                                                    onClick={() => setSelectedSlotId(selectedSlotId === slot.id ? null : slot.id)}
                                                    style={{ marginTop: '5px' }}
                                                >
                                                    <div className={styles.slotItemHeader}>
                                                        <span className={styles.slotIcon}>🔗</span>
                                                        <span className={styles.slotLabel} style={{ color: '#3b82f6' }}>{slotLabel}</span>
                                                        <span className={styles.slotDimensions}>
                                                            {Math.round(slot.width)}×{Math.round(slot.height)}
                                                        </span>
                                                    </div>
                                                    {selectedSlotId === slot.id && (
                                                        <div className={styles.slotDetails} onClick={(e) => e.stopPropagation()}>
                                                            {slot.id === 'legacy-qr' && (
                                                                <label className={styles.qrToggleLabel} style={{ marginBottom: '10px', marginTop: '5px' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={slot.enabled}
                                                                        onChange={(e) => {
                                                                            updateFrame(selectedFrame.id, {
                                                                                qrSlot: {
                                                                                    ...selectedFrame.qrSlot!,
                                                                                    enabled: e.target.checked
                                                                                }
                                                                            })
                                                                        }}
                                                                    />
                                                                    <span>Enable QR Code</span>
                                                                </label>
                                                            )}
                                                            <div className={styles.slotPropsGrid}>
                                                                <label>
                                                                    X
                                                                    <input
                                                                        type="number"
                                                                        value={Math.round(slot.x)}
                                                                        onChange={(e) => {
                                                                            const val = parseInt(e.target.value) || 0
                                                                            if (slot.id === 'legacy-qr') {
                                                                                updateFrame(selectedFrame.id, { qrSlot: { ...selectedFrame.qrSlot!, x: val } })
                                                                            } else {
                                                                                updateQRSlot(selectedFrame.id, slot.id, { x: val })
                                                                            }
                                                                        }}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Y
                                                                    <input
                                                                        type="number"
                                                                        value={Math.round(slot.y)}
                                                                        onChange={(e) => {
                                                                            const val = parseInt(e.target.value) || 0
                                                                            if (slot.id === 'legacy-qr') {
                                                                                updateFrame(selectedFrame.id, { qrSlot: { ...selectedFrame.qrSlot!, y: val } })
                                                                            } else {
                                                                                updateQRSlot(selectedFrame.id, slot.id, { y: val })
                                                                            }
                                                                        }}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Width
                                                                    <input
                                                                        type="number"
                                                                        value={Math.round(slot.width)}
                                                                        onChange={(e) => {
                                                                            const val = parseInt(e.target.value) || 50
                                                                            if (slot.id === 'legacy-qr') {
                                                                                updateFrame(selectedFrame.id, { qrSlot: { ...selectedFrame.qrSlot!, width: val } })
                                                                            } else {
                                                                                updateQRSlot(selectedFrame.id, slot.id, { width: val })
                                                                            }
                                                                        }}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Height
                                                                    <input
                                                                        type="number"
                                                                        value={Math.round(slot.height)}
                                                                        onChange={(e) => {
                                                                            const val = parseInt(e.target.value) || 50
                                                                            if (slot.id === 'legacy-qr') {
                                                                                updateFrame(selectedFrame.id, { qrSlot: { ...selectedFrame.qrSlot!, height: val } })
                                                                            } else {
                                                                                updateQRSlot(selectedFrame.id, slot.id, { height: val })
                                                                            }
                                                                        }}
                                                                    />
                                                                </label>
                                                            </div>
                                                            {slot.id !== 'legacy-qr' && (
                                                                <button
                                                                    className={styles.deleteSlotBtn}
                                                                    onClick={() => {
                                                                        deleteQRSlot(selectedFrame.id, slot.id)
                                                                        setSelectedSlotId(null)
                                                                    }}
                                                                >
                                                                    Delete QR Slot
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                        {getQRSlots(selectedFrame).length === 0 && (
                                            <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '10px 0 0 0', textAlign: 'center' }}>
                                                No QR Code boxes on this frame layout.
                                            </p>
                                        )}
                                    </div>

                                    {selectedFrame.slots.map((slot, index) => (
                                        <div
                                            key={slot.id}
                                            className={`${styles.slotItemSidebar} ${selectedSlotId === slot.id ? styles.expanded : ''}`}
                                            onClick={() => setSelectedSlotId(selectedSlotId === slot.id ? null : slot.id)}
                                        >
                                            <div className={styles.slotItemHeader}>
                                                <span className={styles.slotIcon}>{selectedSlotId === slot.id ? '📂' : '📁'}</span>
                                                <span className={styles.slotLabel}>Slot {getSlotDisplayNumber(slot, index)}</span>
                                                <span className={styles.slotDimensions}>{Math.round(slot.width)}×{Math.round(slot.height)}</span>
                                            </div>
                                            {selectedSlotId === slot.id && (
                                                <div className={styles.slotDetails}>
                                                    <div className={styles.slotPropsGrid}>
                                                        <label>
                                                            X
                                                            <input
                                                                type="number"
                                                                value={Math.round(slot.x)}
                                                                onChange={(e) => updateSlot(selectedFrame.id, slot.id, { x: parseInt(e.target.value) || 0 })}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        </label>
                                                        <label>
                                                            Y
                                                            <input
                                                                type="number"
                                                                value={Math.round(slot.y)}
                                                                onChange={(e) => updateSlot(selectedFrame.id, slot.id, { y: parseInt(e.target.value) || 0 })}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        </label>
                                                        <label>
                                                            Width
                                                            <input
                                                                type="number"
                                                                value={Math.round(slot.width)}
                                                                onChange={(e) => updateSlot(selectedFrame.id, slot.id, { width: parseInt(e.target.value) || 100 })}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        </label>
                                                        <label>
                                                            Height
                                                            <input
                                                                type="number"
                                                                value={Math.round(slot.height)}
                                                                onChange={(e) => updateSlot(selectedFrame.id, slot.id, { height: parseInt(e.target.value) || 75 })}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        </label>
                                                        <label className={styles.rotationLabel}>
                                                            Rotation
                                                            <input
                                                                type="number"
                                                                value={Math.round(slot.rotation)}
                                                                onChange={(e) => updateSlot(selectedFrame.id, slot.id, { rotation: parseInt(e.target.value) || 0 })}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                            <span>°</span>
                                                        </label>
                                                        <label className={styles.duplicateLabel}>
                                                            Duplicate Of
                                                            <select
                                                                value={slot.duplicateOfSlotId || ''}
                                                                onChange={(e) => updateSlot(selectedFrame.id, slot.id, {
                                                                    duplicateOfSlotId: e.target.value || undefined
                                                                })}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <option value="">None (Take New Photo)</option>
                                                                {selectedFrame.slots
                                                                    .filter(s => s.id !== slot.id && !s.duplicateOfSlotId)
                                                                    .map((s, i) => (
                                                                        <option key={s.id} value={s.id}>
                                                                            Slot {selectedFrame.slots.indexOf(s) + 1}
                                                                        </option>
                                                                    ))
                                                                }
                                                            </select>
                                                        </label>
                                                    </div>
                                                    <button
                                                        className={styles.deleteSlotBtn}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            deleteSlot(selectedFrame.id, slot.id)
                                                            setSelectedSlotId(null)
                                                        }}
                                                    >
                                                        🗑️ Delete Slot
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {selectedFrame.slots.length === 0 && (
                                        <div className={styles.emptySlots}>
                                            <p>No slots yet</p>
                                            <p>Click "+ Add Photo Slot" to add</p>
                                        </div>
                                    )}
                                </div>
                            </aside>
                        )}
                    </div>
                )
                }

                {
                    activeTab === 'timers' && (
                        <div className={styles.timersTab}>
                            <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                                <h3>📐 App Layout Orientation</h3>
                                <p>Set the display layout mode for the photobooth app screen</p>
                                <div style={{ display: 'flex', gap: '24px', marginTop: '16px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 700, color: 'white' }}>
                                        <input
                                            type="radio"
                                            name="appOrientation"
                                            value="landscape"
                                            checked={config.appOrientation === 'landscape' || !config.appOrientation}
                                            onChange={() => updateConfig({ appOrientation: 'landscape' })}
                                            style={{ width: '20px', height: '20px', accentColor: 'var(--clay-blue)' }}
                                        />
                                        <span>🖥️ Landscape (Horizontal)</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 700, color: 'white' }}>
                                        <input
                                            type="radio"
                                            name="appOrientation"
                                            value="portrait"
                                            checked={config.appOrientation === 'portrait'}
                                            onChange={() => updateConfig({ appOrientation: 'portrait' })}
                                            style={{ width: '20px', height: '20px', accentColor: 'var(--clay-blue)' }}
                                        />
                                        <span>📱 Portrait (Vertical)</span>
                                    </label>
                                </div>
                            </div>

                            <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                                <h3>📷 Orientasi & Rotasi Kamera (Camera Tilt)</h3>
                                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
                                    Aktifkan jika kamera fisik dipasang miring 90° (Portrait Tilt) agar tampilan live preview dan hasil foto tidak terpotong (*side crop*) pada Mode Vertikal.
                                </p>
                                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
                                    <button
                                        type="button"
                                        onClick={() => updateConfig({ cameraRotation: (config.cameraRotation === 90 ? 0 : 90) })}
                                        style={{
                                            padding: '10px 20px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: (config.cameraRotation === 90 || config.cameraRotation === 270) ? '#10b981' : '#4b5563',
                                            color: 'white',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                                        }}
                                    >
                                        {(config.cameraRotation === 90 || config.cameraRotation === 270) ? '🔄 Kamera Dimiringkan (ON - 90°)' : '📷 Kamera Normal (OFF - 0°)'}
                                    </button>

                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '8px 16px', borderRadius: '8px' }}>
                                        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>Sudut Rotasi:</span>
                                        {[
                                            { label: '0° (Normal)', val: 0 },
                                            { label: '90° (Miring CW)', val: 90 },
                                            { label: '180° (Terbalik)', val: 180 },
                                            { label: '270° (Miring CCW)', val: 270 }
                                        ].map(opt => (
                                            <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'white', fontWeight: 500 }}>
                                                <input
                                                    type="radio"
                                                    name="cameraRotation"
                                                    value={opt.val}
                                                    checked={(config.cameraRotation || 0) === opt.val}
                                                    onChange={() => updateConfig({ cameraRotation: opt.val as 0 | 90 | 180 | 270 })}
                                                    style={{ accentColor: 'var(--clay-blue)', width: '16px', height: '16px' }}
                                                />
                                                {opt.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                                <h3>🏠 Custom Home Background</h3>
                                <p>Upload custom images or videos for the Home screen background. A landscape background will be used in Horizontal layout, and a portrait background will be used in Vertical layout. Toggling the Live Cam background on the Home screen will override these settings.</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
                                    
                                    {/* Landscape Custom Background */}
                                    <div className={styles.bgSettingRow}>
                                        <div className={styles.bgSettingInfo}>
                                            <h4 className={styles.bgSettingTitle}>🖥️ Landscape Background (Horizontal Mode)</h4>
                                            <span className={styles.bgSettingPath}>
                                                {config.customBgLandscape 
                                                    ? `Selected: ${config.customBgLandscape.split('/').pop() || config.customBgLandscape.split('\\').pop()} (${config.customBgLandscapeType})`
                                                    : 'Default background (Cream color)'
                                                }
                                            </span>
                                        </div>
                                        <div className={styles.bgSettingActions}>
                                            <button 
                                                className={`${styles.bgSettingBtn} ${styles.bgSettingBtnPrimary}`}
                                                onClick={() => handleBgUpload('landscape')}
                                            >
                                                Upload File
                                            </button>
                                            {config.customBgLandscape && (
                                                <button 
                                                    className={`${styles.bgSettingBtn} ${styles.bgSettingBtnDanger}`}
                                                    onClick={() => handleBgClear('landscape')}
                                                >
                                                    Clear
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Portrait Custom Background */}
                                    <div className={styles.bgSettingRow}>
                                        <div className={styles.bgSettingInfo}>
                                            <h4 className={styles.bgSettingTitle}>📱 Portrait Background (Vertical Mode)</h4>
                                            <span className={styles.bgSettingPath}>
                                                {config.customBgPortrait 
                                                    ? `Selected: ${config.customBgPortrait.split('/').pop() || config.customBgPortrait.split('\\').pop()} (${config.customBgPortraitType})`
                                                    : 'Default background (Cream color)'
                                                }
                                            </span>
                                        </div>
                                        <div className={styles.bgSettingActions}>
                                            <button 
                                                className={`${styles.bgSettingBtn} ${styles.bgSettingBtnPrimary}`}
                                                onClick={() => handleBgUpload('portrait')}
                                            >
                                                Upload File
                                            </button>
                                            {config.customBgPortrait && (
                                                <button 
                                                    className={`${styles.bgSettingBtn} ${styles.bgSettingBtnDanger}`}
                                                    onClick={() => handleBgClear('portrait')}
                                                >
                                                    Clear
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                </div>
                            </div>

                            <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                                <h3>🔮 Auto Mirror Output</h3>
                                <p>Set default mirror mode (flop horizontally) for all photo and video outputs</p>
                                <div className={styles.timerToggle}>
                                    <label className={styles.toggleSwitch}>
                                        <input
                                            type="checkbox"
                                            checked={config.mirrorOutput || false}
                                            onChange={(e) => updateConfig({ mirrorOutput: e.target.checked })}
                                        />
                                        <span className={styles.toggleSlider}></span>
                                    </label>
                                    <span className={styles.toggleLabel}>
                                        {config.mirrorOutput ? 'Mirror Output Enabled' : 'Mirror Output Disabled'}
                                    </span>
                                </div>
                            </div>

                            <div className={styles.timerCard}>
                                <h3>🎚️ Enable Countdown Timer</h3>
                                <p>Toggle the countdown timer during photo capture sessions</p>
                                <div className={styles.timerToggle}>
                                    <label className={styles.toggleSwitch}>
                                        <input
                                            type="checkbox"
                                            checked={config.timerEnabled}
                                            onChange={(e) => updateConfig({ timerEnabled: e.target.checked })}
                                        />
                                        <span className={styles.toggleSlider}></span>
                                    </label>
                                    <span className={styles.toggleLabel}>
                                        {config.timerEnabled ? 'Timer Enabled' : 'Timer Disabled (Instant Capture)'}
                                    </span>
                                </div>
                            </div>

                            <div className={styles.timerCard}>
                                <h3>⏱️ Countdown Duration</h3>
                                <p>Time before photo capture (seconds)</p>
                                <div className={styles.timerInput}>
                                    <input
                                        type="range"
                                        min="3"
                                        max="10"
                                        value={config.countdownDuration}
                                        onChange={(e) => updateConfig({ countdownDuration: parseInt(e.target.value) })}
                                        disabled={!config.timerEnabled}
                                    />
                                    <span className={styles.timerValue}>{config.countdownDuration}s</span>
                                </div>
                            </div>

                            <div className={styles.timerCard}>
                                <h3>👁️ Preview Duration</h3>
                                <p>Time to show captured photo (seconds)</p>
                                <div className={styles.timerInput}>
                                    <input
                                        type="range"
                                        min="1"
                                        max="5"
                                        value={config.previewDuration}
                                        onChange={(e) => updateConfig({ previewDuration: parseInt(e.target.value) })}
                                    />
                                    <span className={styles.timerValue}>{config.previewDuration}s</span>
                                </div>
                            </div>

                            <div className={styles.timerCard}>
                                <h3>⏰ Session Timeout</h3>
                                <p>Auto-reset session after inactivity (seconds)</p>
                                <div className={styles.timerInput}>
                                    <input
                                        type="range"
                                        min="30"
                                        max="300"
                                        step="30"
                                        value={config.sessionTimeout}
                                        onChange={(e) => updateConfig({ sessionTimeout: parseInt(e.target.value) })}
                                    />
                                    <span className={styles.timerValue}>{config.sessionTimeout}s</span>
                                </div>
                            </div>

                            {/* Per-Session Timer Section */}
                            <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                                <h3>🎯 Per-Page Session Timers</h3>
                                <p>Enable countdown timers displayed at the top of each page</p>
                                <div className={styles.timerToggle}>
                                    <label className={styles.toggleSwitch}>
                                        <input
                                            type="checkbox"
                                            checked={config.sessionTimerEnabled}
                                            onChange={(e) => updateConfig({ sessionTimerEnabled: e.target.checked })}
                                        />
                                        <span className={styles.toggleSlider}></span>
                                    </label>
                                    <span className={styles.toggleLabel}>
                                        {config.sessionTimerEnabled ? 'Session Timers Enabled' : 'Session Timers Disabled'}
                                    </span>
                                </div>
                            </div>

                            <div className={styles.timerCard}>
                                <h3>🖼️ Frame Selection Timeout</h3>
                                <p>Time limit for selecting a frame (seconds)</p>
                                <div className={styles.timerInput}>
                                    <input
                                        type="range"
                                        min="30"
                                        max="180"
                                        step="15"
                                        value={config.frameSelectionTimeout}
                                        onChange={(e) => updateConfig({ frameSelectionTimeout: parseInt(e.target.value) })}
                                        disabled={!config.sessionTimerEnabled}
                                    />
                                    <span className={styles.timerValue}>{config.frameSelectionTimeout}s</span>
                                </div>
                            </div>

                            <div className={styles.timerCard}>
                                <h3>📸 Capture Session Timeout</h3>
                                <p>Time limit for photo capture (seconds)</p>
                                <div className={styles.timerInput}>
                                    <input
                                        type="range"
                                        min="60"
                                        max="300"
                                        step="30"
                                        value={config.captureTimeout}
                                        onChange={(e) => updateConfig({ captureTimeout: parseInt(e.target.value) })}
                                        disabled={!config.sessionTimerEnabled}
                                    />
                                    <span className={styles.timerValue}>{config.captureTimeout}s</span>
                                </div>
                            </div>

                            <div className={styles.timerCard}>
                                <h3>✨ Post Processing Timeout</h3>
                                <p>Time limit for editing and sharing (seconds)</p>
                                <div className={styles.timerInput}>
                                    <input
                                        type="range"
                                        min="30"
                                        max="180"
                                        step="15"
                                        value={config.postProcessingTimeout}
                                        onChange={(e) => updateConfig({ postProcessingTimeout: parseInt(e.target.value) })}
                                        disabled={!config.sessionTimerEnabled}
                                    />
                                    <span className={styles.timerValue}>{config.postProcessingTimeout}s</span>
                                </div>
                            </div>
                        </div>
                    )
                }

                {
                    activeTab === 'filters' && (
                        <div className={styles.filtersTab}>
                            <div className={styles.filterHeader}>
                                <h3>LUT Filters</h3>
                                <button className={styles.addButton} onClick={handleFilterUpload}>
                                    + Upload .CUBE
                                </button>
                            </div>

                            <div className={styles.filterGrid}>
                                {filters.map(filter => (
                                    <div key={filter.id} className={styles.filterCard}>
                                        <div className={styles.filterPreview}>
                                            {filter.previewPath ? (
                                                <img src={`file://${filter.previewPath}`} alt={filter.name} />
                                            ) : (
                                                <div className={styles.filterPlaceholder}>🎨</div>
                                            )}
                                        </div>
                                        <span className={styles.filterName}>{filter.name}</span>
                                        <button
                                            className={styles.deleteButton}
                                            onClick={() => removeFilter(filter.id)}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}

                                {filters.length === 0 && (
                                    <div className={styles.emptyState}>
                                        <p>No filters uploaded</p>
                                        <p>Upload .CUBE files for color grading</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                }

                {/* Payment Tab */}
                {activeTab === 'payment' && (
                    <div className={styles.timersTab}>
                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>💳 Payment Gateway</h3>
                            <p>Enable QRIS payment before photo capture</p>
                            <div className={styles.timerToggle}>
                                <label className={styles.toggleSwitch}>
                                    <input
                                        type="checkbox"
                                        checked={config.paymentEnabled}
                                        onChange={(e) => updateConfig({ paymentEnabled: e.target.checked })}
                                    />
                                    <span className={styles.toggleSlider}></span>
                                </label>
                                <span className={styles.toggleLabel}>
                                    {config.paymentEnabled ? 'Payment Required' : 'Payment Disabled (Free)'}
                                </span>
                            </div>
                        </div>

                        <div className={styles.timerCard}>
                            <h3>💰 Session Price</h3>
                            <p>Base price for 1 session (includes 1 4R print)</p>
                            <div className={styles.timerInput}>
                                <input
                                    type="number"
                                    min="0"
                                    step="1000"
                                    value={config.sessionPrice}
                                    onChange={(e) => updateConfig({ sessionPrice: parseInt(e.target.value) || 0 })}
                                    disabled={!config.paymentEnabled}
                                    style={{ width: '120px', padding: '8px', fontSize: '16px', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                />
                                <span className={styles.timerValue}>Rp {config.sessionPrice.toLocaleString('id-ID')}</span>
                            </div>
                        </div>

                        <div className={styles.timerCard}>
                            <h3>🖨️ Additional Print Price</h3>
                            <p>Price per 2 additional prints</p>
                            <div className={styles.timerInput}>
                                <input
                                    type="number"
                                    min="0"
                                    step="1000"
                                    value={config.additionalPrintPrice}
                                    onChange={(e) => updateConfig({ additionalPrintPrice: parseInt(e.target.value) || 0 })}
                                    disabled={!config.paymentEnabled}
                                    style={{ width: '120px', padding: '8px', fontSize: '16px', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                />
                                <span className={styles.timerValue}>Rp {config.additionalPrintPrice.toLocaleString('id-ID')}</span>
                            </div>
                        </div>

                        <div className={styles.timerCard}>
                            <h3>⏱️ Payment Timeout</h3>
                            <p>Time limit for payment (seconds)</p>
                            <div className={styles.timerInput}>
                                <input
                                    type="range"
                                    min="60"
                                    max="600"
                                    step="30"
                                    value={config.paymentTimeout}
                                    onChange={(e) => updateConfig({ paymentTimeout: parseInt(e.target.value) })}
                                    disabled={!config.paymentEnabled}
                                />
                                <span className={styles.timerValue}>{config.paymentTimeout}s</span>
                            </div>
                        </div>

                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>💳 Payment Gateway Provider</h3>
                            <p>Pilih penyedia layanan payment gateway yang digunakan</p>
                            <select
                                value={config.paymentGateway || 'midtrans'}
                                onChange={(e) => updateConfig({ paymentGateway: e.target.value as 'midtrans' | 'doku' })}
                                disabled={!config.paymentEnabled}
                                style={{ width: '100%', padding: '10px', fontSize: '14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', color: 'white', marginTop: '12px' }}
                            >
                                <option value="midtrans">Midtrans (QRIS)</option>
                                <option value="doku">DOKU Checkout (QRIS)</option>
                            </select>
                        </div>

                        {(!config.paymentGateway || config.paymentGateway === 'midtrans') && (
                            <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                                <h3>🔑 Midtrans API Keys</h3>
                                <p>Enter your Midtrans Sandbox/Production keys</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: 'var(--color-text-secondary)' }}>Client Key</label>
                                        <input
                                            type="text"
                                            value={config.midtransClientKey}
                                            onChange={(e) => updateConfig({ midtransClientKey: e.target.value })}
                                            placeholder="SB-Mid-client-xxx"
                                            disabled={!config.paymentEnabled}
                                            style={{ width: '100%', padding: '10px', fontSize: '14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', color: 'white' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: 'var(--color-text-secondary)' }}>Server Key</label>
                                        <input
                                            type="password"
                                            value={config.midtransServerKey}
                                            onChange={(e) => updateConfig({ midtransServerKey: e.target.value })}
                                            placeholder="SB-Mid-server-xxx"
                                            disabled={!config.paymentEnabled}
                                            style={{ width: '100%', padding: '10px', fontSize: '14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', color: 'white' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {config.paymentGateway === 'doku' && (
                            <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                                <h3>🔑 DOKU API Credentials</h3>
                                <p>Enter your DOKU Sandbox/Production credentials</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: 'var(--color-text-secondary)' }}>Client ID</label>
                                        <input
                                            type="text"
                                            value={config.dokuClientId}
                                            onChange={(e) => updateConfig({ dokuClientId: e.target.value })}
                                            placeholder="MCH-xxx atau GPP-xxx"
                                            disabled={!config.paymentEnabled}
                                            style={{ width: '100%', padding: '10px', fontSize: '14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', color: 'white' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: 'var(--color-text-secondary)' }}>Secret Key (Shared Key)</label>
                                        <input
                                            type="password"
                                            value={config.dokuSecretKey}
                                            onChange={(e) => updateConfig({ dokuSecretKey: e.target.value })}
                                            placeholder="SK-xxx"
                                            disabled={!config.paymentEnabled}
                                            style={{ width: '100%', padding: '10px', fontSize: '14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', color: 'white' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                        <input
                                            type="checkbox"
                                            id="dokuSandbox"
                                            checked={config.dokuSandbox}
                                            onChange={(e) => updateConfig({ dokuSandbox: e.target.checked })}
                                            disabled={!config.paymentEnabled}
                                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                        />
                                        <label htmlFor="dokuSandbox" style={{ fontSize: '14px', color: 'white', cursor: 'pointer' }}>
                                            DOKU Sandbox Mode (Gunakan API testing Sandbox)
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>📝 Payment Instructions</h3>
                            <p>Text shown to users during payment</p>
                            <textarea
                                value={config.paymentInstructions}
                                onChange={(e) => updateConfig({ paymentInstructions: e.target.value })}
                                disabled={!config.paymentEnabled}
                                rows={4}
                                style={{
                                    width: '100%',
                                    marginTop: '12px',
                                    padding: '12px',
                                    fontSize: '14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-bg-tertiary)',
                                    resize: 'vertical'
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* History Tab */}
                {activeTab === 'history' && (
                    <div className={styles.historyTab}>
                        <div className={styles.historyHeader}>
                            <h3>📋 Session History Log</h3>
                            <span className={styles.historyCount}>Total: {historyTotal} sessions</span>
                            <button
                                className={styles.addButton}
                                onClick={loadHistory}
                                disabled={isLoadingHistory}
                            >
                                🔄 Refresh
                            </button>
                            <button
                                className={styles.addButton}
                                onClick={exportToCSV}
                                disabled={isLoadingHistory || historyTotal === 0}
                            >
                                📥 Export CSV
                            </button>
                        </div>

                        {isLoadingHistory ? (
                            <div className={styles.loadingState}>
                                <div className={styles.spinner}></div>
                                <p>Loading history...</p>
                            </div>
                        ) : historyData.length > 0 ? (
                            <>
                                <div className={styles.historyTable}>
                                    <div className={styles.tableHeader}>
                                        <span>Email</span>
                                        <span>Prints</span>
                                        <span>Gallery</span>
                                        <span>Date/Time</span>
                                    </div>
                                    {historyData.map(item => (
                                        <div key={item.id} className={styles.tableRow}>
                                            <span className={styles.emailCell}>
                                                {item.email || <em style={{ opacity: 0.5 }}>No email</em>}
                                            </span>
                                            <span className={styles.printCell}>
                                                🖨️ {item.print_count}
                                            </span>
                                            <span className={styles.galleryCell}>
                                                <a
                                                    href={item.gallery_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={styles.galleryLink}
                                                >
                                                    🔗 View
                                                </a>
                                            </span>
                                            <span className={styles.dateCell}>
                                                {new Date(item.created_at).toLocaleString('id-ID', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {/* Pagination */}
                                <div className={styles.pagination}>
                                    <button
                                        onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                                        disabled={historyPage === 0}
                                    >
                                        ← Previous
                                    </button>
                                    <span>Page {historyPage + 1} of {Math.ceil(historyTotal / 20)}</span>
                                    <button
                                        onClick={() => setHistoryPage(p => p + 1)}
                                        disabled={(historyPage + 1) * 20 >= historyTotal}
                                    >
                                        Next →
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className={styles.emptyState} style={{ padding: '60px 20px' }}>
                                <p>No session history yet</p>
                                <p>Sessions will appear here after photos are taken</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Sharing Configuration Tab */}
                {activeTab === 'sharing' && (
                    <div className={styles.timersTab}>
                        <div className={styles.timerCard}>
                            <h3>📡 Event File Sharing Mode</h3>
                            <p>Choose how guests will receive their digital copies</p>

                            <div className={styles.timerInput} style={{ marginTop: '20px', display: 'flex', gap: '20px', flexDirection: 'column' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', padding: '15px', border: config.sharingMode === 'cloud' ? '2px solid #000' : '2px solid #e5e7eb', borderRadius: '12px' }}>
                                    <input
                                        type="radio"
                                        name="sharingMode"
                                        value="cloud"
                                        checked={config.sharingMode === 'cloud' || !config.sharingMode}
                                        onChange={() => updateConfig({ sharingMode: 'cloud' })}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '16px' }}>☁️ Cloud Server (Supabase/Google Drive)</div>
                                        <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Guests need internet access to download files. QR code points to an online web gallery.</div>
                                        {(config.sharingMode === 'cloud' || !config.sharingMode) && (
                                            <div style={{ marginTop: '12px' }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Cloud Portal Base URL (e.g. https://sebooth.app)</label>
                                                <input
                                                    type="url"
                                                    value={config.cloudPortalUrl || ''}
                                                    onChange={(e) => updateConfig({ cloudPortalUrl: e.target.value })}
                                                    placeholder="https://your-domain.vercel.app"
                                                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '14px' }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', padding: '15px', border: config.sharingMode === 'local' ? '2px solid #000' : '2px solid #e5e7eb', borderRadius: '12px' }}>
                                    <input
                                        type="radio"
                                        name="sharingMode"
                                        value="local"
                                        checked={config.sharingMode === 'local'}
                                        onChange={() => updateConfig({ sharingMode: 'local' })}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>No internet required for guests. They connect to this laptop's Mobile Hotspot to download instantly.</div>
                                    </div>
                                </label>

                                {config.sharingMode === 'local' && (
                                    <div style={{ marginTop: '10px', padding: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                        <h4 style={{ margin: '0 0 15px 0', color: 'white', fontSize: '16px' }}>Hotspot Configuration (For Auto-Connect)</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className={styles.formGroup}>
                                                <label>Hotspot SSID (Network Name)</label>
                                                <input
                                                    type="text"
                                                    value={config.wifiSsid || ''}
                                                    onChange={e => updateConfig({ wifiSsid: e.target.value })}
                                                    placeholder="e.g. Sebooth_WiFi"
                                                    className={styles.input}
                                                />
                                            </div>
                                            <div className={styles.formGroup}>
                                                <label>Hotspot Password</label>
                                                <input
                                                    type="text"
                                                    value={config.wifiPassword || ''}
                                                    onChange={e => updateConfig({ wifiPassword: e.target.value })}
                                                    placeholder="Required for auto-connect QR"
                                                    className={styles.input}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {config.sharingMode === 'local' && localIp && (
                                    <div style={{ marginTop: '10px', padding: '20px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                                        <h4 style={{ margin: '0 0 10px 0', color: '#60a5fa', fontSize: '16px' }}>📱 Remote Admin Monitor</h4>
                                        <p style={{ margin: '0 0 15px 0', color: '#9ca3af', fontSize: '14px', lineHeight: '1.5' }}>
                                            To view sessions and remotely trigger prints from another device (like your phone or tablet), connect that device to this laptop's WiFi hotspot and open this URL in your browser:
                                        </p>
                                        <div style={{
                                            background: '#000',
                                            padding: '12px 16px',
                                            borderRadius: '8px',
                                            fontFamily: 'monospace',
                                            fontSize: '18px',
                                            color: '#10b981',
                                            textAlign: 'center',
                                            userSelect: 'all'
                                        }}>
                                            http://{localIp}:5050/monitor
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Printers Configuration Tab */}
                {activeTab === 'printers' && (
                    <div className={styles.timersTab}>
                        {/* Camera Mode Section */}
                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>📷 Camera Mode</h3>
                            <p>Choose between webcam screenshot or DSLR trigger (native Windows WIA)</p>
                            <div style={{ marginTop: '15px', display: 'flex', gap: '15px', flexDirection: 'column' }}>
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer',
                                    padding: '15px',
                                    border: config.cameraMode === 'mock' ? '2px solid #10b981' : '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    background: config.cameraMode === 'mock' ? 'rgba(16,185,129,0.1)' : 'transparent'
                                }}>
                                    <input
                                        type="radio"
                                        name="cameraMode"
                                        value="mock"
                                        checked={config.cameraMode === 'mock' || !config.cameraMode}
                                        onChange={async () => {
                                            updateConfig({ cameraMode: 'mock' })
                                            await window.api.camera.useMock()
                                        }}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'white' }}>🖥️ Mock Camera (Webcam)</div>
                                        <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>Uses built-in webcam or external USB webcam. Takes screenshot from video feed.</div>
                                    </div>
                                </label>

                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer',
                                    padding: '15px',
                                    border: config.cameraMode === 'ptp' ? '2px solid #ef4444' : '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    background: config.cameraMode === 'ptp' ? 'rgba(239,68,68,0.1)' : 'transparent'
                                }}>
                                    <input
                                        type="radio"
                                        name="cameraMode"
                                        value="ptp"
                                        checked={config.cameraMode === 'ptp'}
                                        onChange={async () => {
                                            updateConfig({ cameraMode: 'ptp' })
                                            await window.api.camera.useDirectPtp()
                                        }}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'white' }}>🚀 DSLR Direct (BETA)</div>
                                        <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>
                                            Standalone Mode: No external apps needed. 
                                            Sebooth controls the shutter directly via USB.
                                        </div>
                                    </div>
                                </label>

                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer',
                                    padding: '15px',
                                    border: config.cameraMode === 'dslr' ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    background: config.cameraMode === 'dslr' ? 'rgba(59,130,246,0.1)' : 'transparent'
                                }}>
                                    <input
                                        type="radio"
                                        name="cameraMode"
                                        value="dslr"
                                        checked={config.cameraMode === 'dslr'}
                                        onChange={async () => {
                                            updateConfig({ cameraMode: 'dslr' })
                                            await window.api.camera.useReal()
                                        }}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'white' }}>📸 DSLR Camera (CLI Mode)</div>
                                        <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>
                                            Legacy Mode: Uses external dslr-remote or DSLR Remote Pro.
                                        </div>
                                    </div>
                                </label>
                            </div>

                            {config.cameraMode === 'ptp' && (
                                <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(239,68,68,0.1)', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.3)' }}>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#fca5a5', lineHeight: '1.6' }}>
                                        🔥 <b>Mode Direct Shutter (Standalone)</b><br />
                                        • Tidak perlu install aplikasi luar lagi.<br />
                                        • Sebooth langsung mengirim sinyal jepret ke Canon 60D.<br />
                                        • <b>Penting:</b> Tetap gunakan Canon Webcam Utility untuk live preview.
                                    </p>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const result = await window.api.camera.capture('admin_test')
                                                if (result.success) alert('Shutter Berhasil Ter-trigger! 📸')
                                                else alert('Gagal: ' + result.error)
                                            } catch (e: any) {
                                                alert('Error: ' + e.message)
                                            }
                                        }}
                                        style={{ marginTop: '10px', background: '#ef4444', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        ⚡ TEST DIRECT SHUTTER
                                    </button>
                                </div>
                            )}

                            {config.cameraMode === 'dslr' && (
                                <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(59,130,246,0.1)', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.3)' }}>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#60a5fa', lineHeight: '1.6' }}>
                                        🚀 <b>Mode CLI (Best Performance)</b><br />
                                        • <b>Live Preview:</b> Gunakan <b>Canon EOS Webcam Utility</b> (Gratis).<br />
                                        • <b>Shutter / Jepret:</b> Menggunakan CLI ringan (dslr-remote).<br />
                                        • Laptop tetap enteng & tidak lemot selama acara.
                                    </p>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const result = await window.api.camera.capture('admin_test')
                                                if (result.success) alert('Shutter Berhasil Ter-trigger! 📸')
                                                else alert('Gagal: ' + result.error)
                                            } catch (e: any) {
                                                alert('Error: ' + e.message)
                                            }
                                        }}
                                        style={{ marginTop: '10px', background: '#3b82f6', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        📸 TEST CLI SHUTTER
                                    </button>
                                </div>
                            )}

                            <div style={{ marginTop: '20px', padding: '15px', background: 'var(--color-bg-tertiary)', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                                <h4>🖥️ Live Preview Source (Webcam / Capture Card)</h4>
                                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>
                                    Pilih perangkat sumber video untuk preview di layar (misalnya USB Capture Card atau Webcam).
                                </p>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <select 
                                        value={config.selectedCameraId || ''} 
                                        onChange={(e) => updateConfig({ selectedCameraId: e.target.value })}
                                        style={{
                                            flex: 1,
                                            maxWidth: '400px',
                                            padding: '12px',
                                            fontSize: '14px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-bg-primary)',
                                            color: 'white',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="" disabled={videoDevices.length > 0}>
                                            {isLoadingDevices ? 'Memuat daftar kamera...' : 
                                             videoDevices.length > 0 ? 'Select a camera...' : 'Tidak ada kamera ditemukan'}
                                        </option>
                                        {videoDevices.map((device, index) => (
                                            <option key={device.deviceId} value={device.deviceId}>
                                                {device.label || `Camera ${index + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={async () => {
                                            setIsLoadingDevices(true)
                                            try {
                                                let stream = null;
                                                try {
                                                    stream = await navigator.mediaDevices.getUserMedia({ video: true })
                                                } catch (e) {
                                                    console.warn('Manual refresh getUserMedia failed:', e)
                                                }
                                                const devices = await navigator.mediaDevices.enumerateDevices()
                                                const videoInputs = devices.filter(device => device.kind === 'videoinput')
                                                setVideoDevices(videoInputs)
                                                if (stream) {
                                                    stream.getTracks().forEach(track => track.stop())
                                                }
                                            } catch (err) {
                                                console.error('Manual refresh of video devices failed:', err)
                                            } finally {
                                                setIsLoadingDevices(false)
                                            }
                                        }}
                                        disabled={isLoadingDevices}
                                        style={{
                                            padding: '12px 18px',
                                            fontSize: '14px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-bg-secondary)',
                                            color: 'white',
                                            cursor: 'pointer',
                                            fontWeight: 'bold',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {isLoadingDevices ? '🔄...' : '🔄 REFRESH'}
                                    </button>
                                </div>

                                {/* Camera Tilt / Rotation Controls in Camera Tab */}
                                <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px dashed var(--color-border)' }}>
                                    <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>📐 Rotasi Kamera (Camera Tilt)</h4>
                                    <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
                                        Atur rotasi kamera jika posisi fisik kamera di-tilting 90 derajat untuk Mode Vertikal.
                                    </p>
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <button
                                            type="button"
                                            onClick={() => updateConfig({ cameraRotation: (config.cameraRotation === 90 ? 0 : 90) })}
                                            style={{
                                                padding: '8px 16px',
                                                borderRadius: '6px',
                                                border: 'none',
                                                background: (config.cameraRotation === 90 || config.cameraRotation === 270) ? '#10b981' : '#4b5563',
                                                color: 'white',
                                                fontWeight: 'bold',
                                                fontSize: '13px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {(config.cameraRotation === 90 || config.cameraRotation === 270) ? '🔄 Kamera Dimiringkan (ON)' : '📷 Kamera Normal (OFF)'}
                                        </button>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            {[
                                                { label: '0°', val: 0 },
                                                { label: '90° CW', val: 90 },
                                                { label: '180°', val: 180 },
                                                { label: '270° CCW', val: 270 }
                                            ].map(opt => (
                                                <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '13px', color: 'white' }}>
                                                    <input
                                                        type="radio"
                                                        name="cameraRotationCamTab"
                                                        value={opt.val}
                                                        checked={(config.cameraRotation || 0) === opt.val}
                                                        onChange={() => updateConfig({ cameraRotation: opt.val as 0 | 90 | 180 | 270 })}
                                                        style={{ accentColor: 'var(--clay-blue)' }}
                                                    />
                                                    {opt.label}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>


                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>🖨️ Auto-Printing System</h3>
                            <p>Enable automatic printing after post-processing is complete</p>
                            <div className={styles.timerToggle}>
                                <label className={styles.toggleSwitch}>
                                    <input
                                        type="checkbox"
                                        checked={config.printerEnabled}
                                        onChange={(e) => updateConfig({ printerEnabled: e.target.checked })}
                                    />
                                    <span className={styles.toggleSlider}></span>
                                </label>
                                <span className={styles.toggleLabel}>
                                    {config.printerEnabled ? 'Auto-Printing Enabled' : 'Auto-Printing Disabled'}
                                </span>
                            </div>
                        </div>

                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>⚙️ Printer Selection</h3>
                            <p>Select which printer to use for photos and photostrips</p>
                            
                            <div style={{ marginTop: '15px' }}>
                                <select 
                                    value={config.printerName || ''} 
                                    onChange={(e) => updateConfig({ printerName: e.target.value })}
                                    disabled={!config.printerEnabled || availablePrinters.length === 0}
                                    style={{
                                        width: '100%',
                                        maxWidth: '400px',
                                        padding: '12px',
                                        fontSize: '14px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-bg-tertiary)',
                                        color: 'white',
                                        cursor: (!config.printerEnabled || availablePrinters.length === 0) ? 'not-allowed' : 'pointer',
                                        opacity: (!config.printerEnabled || availablePrinters.length === 0) ? 0.5 : 1
                                    }}
                                >
                                    <option value="" disabled>Select a printer...</option>
                                    {availablePrinters.map(printer => (
                                        <option key={printer.name} value={printer.name}>
                                            {printer.name} {printer.isDefault ? '(Default)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {availablePrinters.length === 0 && (
                                <p style={{ color: 'var(--color-error)', marginTop: '10px', fontSize: '12px' }}>
                                    No printers detected on this system.
                                </p>
                            )}
                        </div>

                        {/* Double Device — Remote Printing */}
                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>🔗 Double Device — Remote Printing</h3>
                            <p>Connect 2 devices to share a single printer over LAN/Hotspot</p>

                            {/* Device Name */}
                            <div style={{ marginTop: '15px' }}>
                                <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '6px' }}>
                                    Nama Device (Identitas)
                                </label>
                                <input
                                    type="text"
                                    value={config.deviceName || 'Booth A'}
                                    onChange={(e) => updateConfig({ deviceName: e.target.value })}
                                    placeholder="e.g. Booth A, Booth B"
                                    style={{
                                        width: '100%',
                                        maxWidth: '300px',
                                        padding: '10px 14px',
                                        fontSize: '14px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-bg-tertiary)',
                                        color: 'white'
                                    }}
                                />
                            </div>

                            {/* Print Mode Radio Buttons */}
                            <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexDirection: 'column' }}>
                                {/* Local Mode */}
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer',
                                    padding: '15px',
                                    border: (!config.printServerEnabled && !config.printClientEnabled) ? '2px solid #10b981' : '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    background: (!config.printServerEnabled && !config.printClientEnabled) ? 'rgba(16,185,129,0.1)' : 'transparent'
                                }}>
                                    <input
                                        type="radio"
                                        name="printMode"
                                        checked={!config.printServerEnabled && !config.printClientEnabled}
                                        onChange={() => updateConfig({ printServerEnabled: false, printClientEnabled: false })}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 600 }}>🖨️ Printer Lokal (Default)</div>
                                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                                            Device ini mencetak langsung ke printer yang terhubung via USB
                                        </div>
                                    </div>
                                </label>

                                {/* Print Server Mode */}
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer',
                                    padding: '15px',
                                    border: config.printServerEnabled ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    background: config.printServerEnabled ? 'rgba(59,130,246,0.1)' : 'transparent'
                                }}>
                                    <input
                                        type="radio"
                                        name="printMode"
                                        checked={!!config.printServerEnabled}
                                        onChange={() => updateConfig({ printServerEnabled: true, printClientEnabled: false })}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 600 }}>📡 Print Server (Terima dari device lain)</div>
                                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                                            Device ini terhubung ke printer & menerima print job dari device lain via LAN
                                        </div>
                                    </div>
                                </label>

                                {/* Print Client Mode */}
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer',
                                    padding: '15px',
                                    border: config.printClientEnabled ? '2px solid #f59e0b' : '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    background: config.printClientEnabled ? 'rgba(245,158,11,0.1)' : 'transparent'
                                }}>
                                    <input
                                        type="radio"
                                        name="printMode"
                                        checked={!!config.printClientEnabled}
                                        onChange={() => updateConfig({ printClientEnabled: true, printServerEnabled: false })}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 600 }}>📤 Print Client (Kirim ke device lain)</div>
                                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                                            Device ini mengirim print job ke Print Server device lain via LAN
                                        </div>
                                    </div>
                                </label>
                            </div>

                            {/* Print Server Info — shown when this device is Print Server */}
                            {config.printServerEnabled && (
                                <div style={{
                                    marginTop: '20px',
                                    padding: '16px',
                                    background: 'rgba(59,130,246,0.1)',
                                    border: '1px solid rgba(59,130,246,0.3)',
                                    borderRadius: '12px'
                                }}>
                                    <div style={{ fontWeight: 600, marginBottom: '8px', color: '#60a5fa' }}>
                                        ✅ Print Server Aktif
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#9ca3af' }}>
                                        Device lain bisa mengirim print job ke alamat ini:
                                    </div>
                                    <div style={{
                                        marginTop: '8px',
                                        padding: '10px 14px',
                                        background: 'rgba(0,0,0,0.3)',
                                        borderRadius: '8px',
                                        fontFamily: 'monospace',
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        color: '#60a5fa',
                                        letterSpacing: '0.5px'
                                    }}>
                                        http://{localIp || '?.?.?.?'}:5050
                                    </div>
                                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                                        Pastikan kedua device terhubung di jaringan WiFi/LAN yang sama
                                    </div>
                                </div>
                            )}

                            {/* Print Client Config — shown when this device is Print Client */}
                            {config.printClientEnabled && (
                                <div style={{
                                    marginTop: '20px',
                                    padding: '16px',
                                    background: 'rgba(245,158,11,0.1)',
                                    border: '1px solid rgba(245,158,11,0.3)',
                                    borderRadius: '12px'
                                }}>
                                    <label style={{ display: 'block', fontSize: '13px', color: '#fbbf24', marginBottom: '8px', fontWeight: 600 }}>
                                        🌐 Print Server URL
                                    </label>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            value={config.printServerUrl || ''}
                                            onChange={(e) => updateConfig({ printServerUrl: e.target.value })}
                                            placeholder="http://192.168.1.100:5050"
                                            style={{
                                                flex: 1,
                                                maxWidth: '350px',
                                                padding: '10px 14px',
                                                fontSize: '14px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-bg-tertiary)',
                                                color: 'white',
                                                fontFamily: 'monospace'
                                            }}
                                        />
                                        <button
                                            className={styles.addButton}
                                            onClick={async () => {
                                                try {
                                                    const result = await window.api.printer.checkPrintServer(config.printServerUrl)
                                                    if (result.success && result.data?.online) {
                                                        alert(`✅ Print Server Online!\n\nPrinter: ${result.data.printerName}\nDevice: ${result.data.deviceName}\nAntrian: ${result.data.queueLength} job`)
                                                    } else {
                                                        alert(`❌ Gagal terhubung ke Print Server\n\n${result.data?.error || result.error || 'Connection refused'}`)
                                                    }
                                                } catch (err: any) {
                                                    alert(`❌ Error: ${err.message}`)
                                                }
                                            }}
                                            style={{ whiteSpace: 'nowrap' }}
                                        >
                                            🔍 Tes Koneksi
                                        </button>
                                    </div>
                                    <div style={{ marginTop: '10px', fontSize: '12px', color: '#6b7280' }}>
                                        Masukkan URL Print Server (IP device yang terhubung ke printer). Pastikan kedua device terhubung di jaringan yang sama.
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {/* Print Queue State */}
                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3>🖨️ Active Print Queue</h3>
                                <button className={styles.addButton} onClick={fetchPrintData} disabled={isLoadingPrintData}>
                                    🔄 Refresh
                                </button>
                            </div>
                            
                            <div className={styles.historyTable} style={{ marginTop: '15px' }}>
                                <div className={styles.tableHeader}>
                                    <span>Job ID</span>
                                    <span>Device</span>
                                    <span>Status</span>
                                    <span>Copies</span>
                                </div>
                                {printQueue.length > 0 ? printQueue.map(job => (
                                    <div key={job.id} className={styles.tableRow}>
                                        <span className={styles.emailCell}>{job.id}</span>
                                        <span className={styles.printCell} style={{ color: job.sourceDevice && job.sourceDevice !== 'Local' ? '#f59e0b' : '#9ca3af' }}>
                                            {job.sourceDevice || 'Local'}
                                        </span>
                                        <span className={styles.galleryCell} style={{ color: job.status === 'PRINTING' ? '#3b82f6' : '#f59e0b', fontWeight: 'bold' }}>
                                            {job.status === 'PRINTING' ? '🖨️ Printing...' : '⏳ Queued'}
                                        </span>
                                        <span className={styles.dateCell}>{job.copies} Pages</span>
                                    </div>
                                )) : (
                                    <div className={styles.tableRow} style={{ justifyContent: 'center' }}>
                                        <span style={{ gridColumn: '1 / -1', textAlign: 'center', opacity: 0.5 }}>No active print jobs</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Print History State */}
                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>📜 Print History (Recent)</h3>
                            
                            <div className={styles.historyTable} style={{ marginTop: '15px', maxHeight: '300px', overflowY: 'auto' }}>
                                <div className={styles.tableHeader}>
                                    <span>Session / Time</span>
                                    <span>Device</span>
                                    <span>Status</span>
                                    <span>Copies</span>
                                </div>
                                {printHistory.slice(0, 50).map(job => (
                                    <div key={job.id} className={styles.tableRow}>
                                        <span className={styles.emailCell}>
                                            {new Date(job.createdAt).toLocaleTimeString()}
                                        </span>
                                        <span className={styles.printCell} style={{ color: job.sourceDevice && job.sourceDevice !== 'Local' ? '#f59e0b' : '#9ca3af' }}>
                                            {job.sourceDevice || 'Local'}
                                        </span>
                                        <span className={styles.galleryCell} style={{ color: job.status === 'COMPLETED' ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>
                                            {job.status === 'COMPLETED' ? '✅ Done' : '❌ Failed'}
                                        </span>
                                        <span className={styles.dateCell}>{job.copies} Pages</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Queue Monitoring Tab */}
                {activeTab === 'queue' && (
                     <div className={styles.historyTab}>
                         <div className={styles.historyHeader}>
                             <h3>☁️ Offline Upload Queue Tracker</h3>
                             <span className={styles.historyCount}>Pending Items: {cloudQueue.length}</span>
                             <button
                                 className={styles.addButton}
                                 onClick={fetchCloudQueue}
                                 disabled={isLoadingQueue}
                             >
                                 🔄 Refresh
                             </button>
                         </div>
                         
                         {isLoadingQueue ? (
                             <div className={styles.loadingState}>
                                 <div className={styles.spinner}></div>
                                 <p>Loading Pending Offline Uploads...</p>
                             </div>
                         ) : cloudQueue.length > 0 ? (
                            <div className={styles.historyTable}>
                                <div className={styles.tableHeader}>
                                    <span>Type</span>
                                    <span>Destination (Session)</span>
                                    <span>Status</span>
                                    <span>Retries</span>
                                </div>
                                {cloudQueue.map((item) => (
                                    <div key={item.id} className={styles.tableRow}>
                                        <span className={styles.emailCell}>
                                            {item.mimeType?.includes('video') ? '🎥 Video' : item.mimeType?.includes('image/gif') ? '🎞️ GIF' : '📸 Photo'}
                                        </span>
                                        <span className={styles.printCell} style={{ fontSize: '13px' }}>
                                            {item.destinationPath || <em style={{ opacity: 0.5 }}>Unknown</em>}
                                        </span>
                                        <span className={styles.galleryCell} style={{ color: '#f59e0b', fontWeight: 'bold' }}>
                                            ⏳ Queued
                                        </span>
                                        <span className={styles.dateCell}>
                                            {item.retryCount || 0} attempts
                                        </span>
                                    </div>
                                ))}
                            </div>
                         ) : (
                             <div className={styles.emptyState} style={{ padding: '60px 20px' }}>
                                 <p>No Pending Uploads</p>
                                 <p>All photos and videos have been successfully synced to the cloud!</p>
                             </div>
                         )}
                     </div>
                 )}

                {/* Queue Integration (Webhook) Tab */}
                {activeTab === 'webhook' && (
                    <div className={styles.timersTab}>
                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>🔗 Website Queue Integration</h3>
                            <p>Hubungkan aplikasi photobooth dengan sistem antrean digital di website Sebooth</p>
                            <div className={styles.timerToggle}>
                                <label className={styles.toggleSwitch}>
                                    <input
                                        type="checkbox"
                                        checked={config.queueEnabled || false}
                                        onChange={(e) => updateConfig({ queueEnabled: e.target.checked })}
                                    />
                                    <span className={styles.toggleSlider}></span>
                                </label>
                                <span className={styles.toggleLabel}>
                                    {config.queueEnabled ? '✅ Queue Mode Aktif' : '⚪ Queue Mode Nonaktif'}
                                </span>
                            </div>
                        </div>

                        <div className={styles.timerCard}>
                            <h3>🌐 API URL</h3>
                            <p>Base URL website Sebooth</p>
                            <input
                                type="text"
                                value={config.queueApiUrl || 'https://www.sebooth.in'}
                                onChange={(e) => updateConfig({ queueApiUrl: e.target.value })}
                                placeholder="https://www.sebooth.in"
                                style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border, #374151)',
                                    background: 'var(--color-bg-secondary, #1f2937)',
                                    color: 'var(--color-text-primary, #f9fafb)',
                                    fontSize: '14px',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>

                        <div className={styles.timerCard}>
                            <h3>📋 Event ID</h3>
                            <p>Pilih Event Antrean atau masukkan UUID secara manual</p>
                            {eventsList.length > 0 && (
                                <select
                                    value={config.queueEventId || ''}
                                    onChange={(e) => updateConfig({ queueEventId: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border, #374151)',
                                        background: 'var(--color-bg-secondary, #1f2937)',
                                        color: 'var(--color-text-primary, #f9fafb)',
                                        fontSize: '14px',
                                        boxSizing: 'border-box',
                                        marginBottom: '10px'
                                    }}
                                >
                                    <option value="">-- Pilih Event dari Cloud --</option>
                                    {eventsList.map(evt => (
                                        <option key={evt.id} value={evt.id}>
                                            {evt.name} ({evt.booth_name})
                                        </option>
                                    ))}
                                </select>
                            )}
                            <input
                                type="text"
                                value={config.queueEventId || ''}
                                onChange={(e) => updateConfig({ queueEventId: e.target.value })}
                                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border, #374151)',
                                    background: 'var(--color-bg-secondary, #1f2937)',
                                    color: 'var(--color-text-primary, #f9fafb)',
                                    fontSize: '14px',
                                    fontFamily: 'monospace',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>

                        <div className={styles.timerCard}>
                            <h3>🔑 Webhook Secret</h3>
                            <p>Shared secret untuk autentikasi webhook (harus sama dengan website)</p>
                            <input
                                type="password"
                                value={config.queueWebhookSecret || 'sebooth-queue-webhook-2026'}
                                onChange={(e) => updateConfig({ queueWebhookSecret: e.target.value })}
                                placeholder="sebooth-queue-webhook-2026"
                                style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border, #374151)',
                                    background: 'var(--color-bg-secondary, #1f2937)',
                                    color: 'var(--color-text-primary, #f9fafb)',
                                    fontSize: '14px',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>

                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <h3>ℹ️ Cara Kerja</h3>
                            <div style={{ fontSize: '14px', lineHeight: '1.8', opacity: 0.8 }}>
                                <p>1. Aktifkan Queue Mode dan isi Event ID dari website</p>
                                <p>2. Landing page akan otomatis berubah menjadi Queue Display</p>
                                <p>3. Ketika ada tiket yang dipanggil, layar menampilkan nomor antrean</p>
                                <p>4. Operator menekan "Mulai Sesi" → QR Code ditampilkan → sesi foto dimulai</p>
                                <p>5. Setelah sesi selesai, webhook otomatis dikirim dan antrean dilanjutkan</p>
                            </div>
                        </div>
                    </div>
                )}

            </main >

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={() => {
                    endSession()
                    navigate('/')
                }}
            />
        </motion.div >
    )
}

export default AdminDashboard
