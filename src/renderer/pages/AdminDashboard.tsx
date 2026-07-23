import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFrameStore, useAppConfig, useFilterStore, useSessionStore } from '../stores'
import { AppConfig, FrameConfig, PhotoSlot, PrinterDevice } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { apiHelper } from '../lib/apiHelper'
import { getSessionHistory, SessionHistoryItem, getSupabase } from '../lib/supabase'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import { PhysicalButtonIndicator } from '../components/PhysicalButtonIndicator'
import styles from './AdminDashboard.module.css'

type DragMode = 'move' | 'resize-se' | 'resize-sw' | 'resize-ne' | 'resize-nw' | 'rotate' | null

function AdminDashboard(): JSX.Element {
    const navigate = useNavigate()
    const { frames, addFrame, updateFrame, deleteFrame, addSlot, updateSlot, deleteSlot, addQRSlot, updateQRSlot, deleteQRSlot, setActiveFrame, undo, redo } = useFrameStore()
    const { config, updateConfig, setIsLayoutEditMode } = useAppConfig()
    const { filters, addFilter, removeFilter } = useFilterStore()
    const { endSession } = useSessionStore()

    const [activeTab, setActiveTab] = useState<'frames' | 'timers' | 'filters' | 'payment' | 'history' | 'sharing' | 'printers' | 'queue' | 'webhook' | 'button-indicator'>('frames')
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

    // Camera Control State (for digiCamControl HTTP mode)
    const [cameraConnected, setCameraConnected] = useState(false)
    const [cameraConnecting, setCameraConnecting] = useState(false)
    const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null)
    const [liveViewActive, setLiveViewActive] = useState(false)
    const [liveViewKey, setLiveViewKey] = useState(0)
    const [isoValues, setIsoValues] = useState<{ current: string; available: string[] }>({ current: '', available: [] })
    const [apertureValues, setApertureValues] = useState<{ current: string; available: string[] }>({ current: '', available: [] })
    const [shutterValues, setShutterValues] = useState<{ current: string; available: string[] }>({ current: '', available: [] })
    const [wbValues, setWbValues] = useState<{ current: string; available: string[] }>({ current: '', available: [] })
    const [cameraSettingsLoading, setCameraSettingsLoading] = useState(false)
    const [captureTestResult, setCaptureTestResult] = useState<string | null>(null)
    const liveViewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const canvasRef = useRef<HTMLDivElement>(null)
    const indicatorCanvasRef = useRef<HTMLDivElement>(null)

    // Button Indicator Editor State & Guidelines
    const [indicatorPreviewPage, setIndicatorPreviewPage] = useState<'landing' | 'frames' | 'payment' | 'capture' | 'review' | 'sharing' | 'printing'>('landing')
    const [showGridLines, setShowGridLines] = useState(true)
    const [showCenterLines, setShowCenterLines] = useState(true)
    const [showMarginGuides, setShowMarginGuides] = useState(true)
    const [enableMagneticSnap, setEnableMagneticSnap] = useState(true)
    const [indicatorDragMode, setIndicatorDragMode] = useState<DragMode>(null)
    const [indicatorDragStart, setIndicatorDragStart] = useState({
        mouseX: 0,
        mouseY: 0,
        posX: 80,
        posY: 50,
        width: 260,
        height: 70,
        rotation: 0
    })

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

    // Button Indicator Drag/Resize/Rotate Start
    const handleIndicatorMouseDown = useCallback((mode: DragMode, e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        setIndicatorDragStart({
            mouseX: e.clientX,
            mouseY: e.clientY,
            posX: config.buttonIndicatorX ?? 80,
            posY: config.buttonIndicatorY ?? 50,
            width: config.buttonIndicatorWidth ?? 260,
            height: config.buttonIndicatorHeight ?? 70,
            rotation: config.buttonIndicatorRotation ?? 0
        })
        setIndicatorDragMode(mode)
    }, [config.buttonIndicatorX, config.buttonIndicatorY, config.buttonIndicatorWidth, config.buttonIndicatorHeight, config.buttonIndicatorRotation])

    // Global mouse move listener for indicator editor
    useEffect(() => {
        if (!indicatorDragMode || !indicatorCanvasRef.current) return

        const handleMouseMove = (e: MouseEvent) => {
            const rect = indicatorCanvasRef.current?.getBoundingClientRect()
            if (!rect) return

            const deltaMouseX = e.clientX - indicatorDragStart.mouseX
            const deltaMouseY = e.clientY - indicatorDragStart.mouseY

            if (indicatorDragMode === 'move') {
                const deltaPercentX = (deltaMouseX / rect.width) * 100
                const deltaPercentY = (deltaMouseY / rect.height) * 100

                let newX = Math.min(Math.max(indicatorDragStart.posX + deltaPercentX, 5), 95)
                let newY = Math.min(Math.max(indicatorDragStart.posY + deltaPercentY, 5), 95)

                if (enableMagneticSnap) {
                    if (Math.abs(newX - 50) < 3) newX = 50
                    if (Math.abs(newY - 50) < 3) newY = 50

                    const snappedX10 = Math.round(newX / 10) * 10
                    if (Math.abs(newX - snappedX10) < 1.5) newX = snappedX10

                    const snappedY10 = Math.round(newY / 10) * 10
                    if (Math.abs(newY - snappedY10) < 1.5) newY = snappedY10
                }

                updateConfig({
                    buttonIndicatorX: Math.round(newX * 10) / 10,
                    buttonIndicatorY: Math.round(newY * 10) / 10
                })
            } else if (indicatorDragMode.startsWith('resize')) {
                const isSE = indicatorDragMode === 'resize-se'
                const isSW = indicatorDragMode === 'resize-sw'
                const isNE = indicatorDragMode === 'resize-ne'
                const isNW = indicatorDragMode === 'resize-nw'

                let newW = indicatorDragStart.width
                let newH = indicatorDragStart.height

                if (isSE || isNE) newW += deltaMouseX * 1.5
                if (isSW || isNW) newW -= deltaMouseX * 1.5

                if (isSE || isSW) newH += deltaMouseY * 1.5
                if (isNE || isNW) newH -= deltaMouseY * 1.5

                newW = Math.max(120, Math.min(500, Math.round(newW)))
                newH = Math.max(40, Math.min(300, Math.round(newH)))

                updateConfig({
                    buttonIndicatorWidth: newW,
                    buttonIndicatorHeight: newH
                })
            } else if (indicatorDragMode === 'rotate') {
                const centerX = rect.left + (rect.width * (indicatorDragStart.posX / 100))
                const centerY = rect.top + (rect.height * (indicatorDragStart.posY / 100))

                const radians = Math.atan2(e.clientY - centerY, e.clientX - centerX)
                let degrees = Math.round(radians * (180 / Math.PI))
                if (degrees < 0) degrees += 360

                if (enableMagneticSnap) {
                    const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 360]
                    for (const snapAngle of snapAngles) {
                        if (Math.abs(degrees - snapAngle) < 4) {
                            degrees = snapAngle % 360
                            break
                        }
                    }
                }

                updateConfig({ buttonIndicatorRotation: degrees })
            }
        }

        const handleMouseUp = () => {
            setIndicatorDragMode(null)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [indicatorDragMode, indicatorDragStart, enableMagneticSnap, updateConfig])

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
                <button
                    className={`${styles.tab} ${activeTab === 'button-indicator' ? styles.active : ''}`}
                    onClick={() => setActiveTab('button-indicator')}
                >
                    🔘 Penunjuk Tombol
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
                                        <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'white' }}>📸 DSLR Camera (digiCamControl)</div>
                                        <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>
                                            Full Control: Shutter, ISO, Aperture, Shutter Speed, Live View. 
                                            Menggunakan digiCamControl HTTP API.
                                        </div>
                                    </div>
                                </label>

                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer',
                                    padding: '15px',
                                    border: config.cameraMode === 'edsdk' ? '2px solid #f59e0b' : '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    background: config.cameraMode === 'edsdk' ? 'rgba(245,158,11,0.1)' : 'transparent'
                                }}>
                                    <input
                                        type="radio"
                                        name="cameraMode"
                                        value="edsdk"
                                        checked={config.cameraMode === 'edsdk'}
                                        onChange={async () => {
                                            updateConfig({ cameraMode: 'edsdk' })
                                            await window.api.camera.useCanonEdsdk()
                                        }}
                                        style={{ width: '20px', height: '20px' }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'white' }}>📷 Canon EDSDK (dslrBooth Engine)</div>
                                        <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>
                                            <strong style={{ color: '#f59e0b' }}>⚡ RECOMMENDED untuk Canon</strong> — Menggunakan Canon EDSDK native SDK (engine yang sama dengan dslrBooth).
                                            Trigger tercepat (~200ms), event-driven capture, foto langsung ke RAM. 
                                            Support: Canon EOS 1300D, 60D, 70D, 80D, 5D, 6D, R series.
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

                            {config.cameraMode === 'edsdk' && (
                                <div style={{ marginTop: '15px', padding: '20px', background: 'rgba(245,158,11,0.05)', borderRadius: '12px', border: '1px solid rgba(245,158,11,0.3)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                        <div>
                                            <h4 style={{ margin: 0, color: '#fbbf24' }}>📷 Canon EDSDK Control Panel</h4>
                                            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                                                Engine yang sama dengan dslrBooth — trigger langsung via Canon SDK
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                disabled={cameraConnecting}
                                                onClick={async () => {
                                                    setCameraConnecting(true)
                                                    setCaptureTestResult(null)
                                                    try {
                                                        const connectResult = await window.api.camera.connect('canon_edsdk_0')
                                                        if (connectResult.success) {
                                                            setCameraConnected(true)
                                                        } else {
                                                            setCaptureTestResult(`❌ ${connectResult.error || 'Gagal koneksi'}`)
                                                        }
                                                    } catch (e: any) {
                                                        setCaptureTestResult(`❌ ${e.message}`)
                                                    }
                                                    setCameraConnecting(false)
                                                }}
                                                style={{
                                                    padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
                                                    background: cameraConnected ? '#22c55e' : '#f59e0b',
                                                    color: 'white', border: 'none', fontSize: '13px', fontWeight: 'bold'
                                                }}
                                            >
                                                {cameraConnecting ? '⏳ Connecting...' : cameraConnected ? '✅ Connected' : '🔌 Connect Camera'}
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    setCaptureTestResult('⏳ Triggering shutter...')
                                                    try {
                                                        const result = await window.api.camera.capture('test_edsdk')
                                                        if (result.success && result.data?.success) {
                                                            setCaptureTestResult(`✅ Capture berhasil! File: ${result.data.imagePath}`)
                                                        } else {
                                                            setCaptureTestResult(`❌ ${result.data?.error || result.error || 'Capture gagal'}`)
                                                        }
                                                    } catch (e: any) {
                                                        setCaptureTestResult(`❌ ${e.message}`)
                                                    }
                                                }}
                                                style={{
                                                    padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
                                                    background: '#dc2626', color: 'white', border: 'none', fontSize: '13px', fontWeight: 'bold'
                                                }}
                                            >
                                                📸 Test Capture
                                            </button>
                                        </div>
                                    </div>

                                    {captureTestResult && (
                                        <div style={{
                                            padding: '10px 15px', borderRadius: '8px', fontSize: '13px',
                                            background: captureTestResult.includes('✅') ? 'rgba(34,197,94,0.1)' : captureTestResult.includes('⏳') ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                                            color: captureTestResult.includes('✅') ? '#86efac' : captureTestResult.includes('⏳') ? '#fbbf24' : '#fca5a5',
                                            border: `1px solid ${captureTestResult.includes('✅') ? 'rgba(34,197,94,0.3)' : captureTestResult.includes('⏳') ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`
                                        }}>
                                            {captureTestResult}
                                        </div>
                                    )}

                                    <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(245,158,11,0.08)', borderRadius: '8px', fontSize: '12px', color: '#d4d4d8' }}>
                                        <strong style={{ color: '#fbbf24' }}>ℹ️ Tips:</strong>
                                        <ul style={{ margin: '6px 0 0', paddingLeft: '18px', lineHeight: '1.6' }}>
                                            <li>Pastikan kamera Canon dalam mode <strong>PTP</strong> (bukan MTP/Auto)</li>
                                            <li>Tutup semua aplikasi kamera lainnya (EOS Utility, dslrBooth, digiCamControl)</li>
                                            <li>Jika gagal, coba cabut dan pasang kembali kabel USB</li>
                                            <li>Canon 1300D, 60D, 70D, 80D, 5D, 6D, R series didukung</li>
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {config.cameraMode === 'ptp' && (
                                <div style={{ marginTop: '15px', padding: '20px', background: 'rgba(239,68,68,0.05)', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.3)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                        <div>
                                            <h4 style={{ margin: 0, color: '#fca5a5' }}>🎛️ Camera Control Panel (digiCamControl)</h4>
                                            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                                                Full control: Shutter, ISO, Aperture, Shutter Speed, Live View
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                disabled={cameraConnecting}
                                                onClick={async () => {
                                                    setCameraConnecting(true)
                                                    setCaptureTestResult(null)
                                                    try {
                                                        // Connect to camera
                                                        const connectResult = await window.api.camera.connect('digicam_http_0')
                                                        if (connectResult.success) {
                                                            setCameraConnected(true)
                                                            // Load camera settings
                                                            setCameraSettingsLoading(true)
                                                            try {
                                                                const [iso, aperture, shutter, wb] = await Promise.all([
                                                                    window.api.camera.getAvailableValues('iso'),
                                                                    window.api.camera.getAvailableValues('aperture'),
                                                                    window.api.camera.getAvailableValues('shutterspeed'),
                                                                    window.api.camera.getAvailableValues('whitebalance')
                                                                ])
                                                                if (iso.success && iso.data) setIsoValues(iso.data)
                                                                if (aperture.success && aperture.data) setApertureValues(aperture.data)
                                                                if (shutter.success && shutter.data) setShutterValues(shutter.data)
                                                                if (wb.success && wb.data) setWbValues(wb.data)
                                                            } catch (e) { console.error('Failed to load camera settings:', e) }
                                                            setCameraSettingsLoading(false)

                                                            // Start live view
                                                            try {
                                                                await window.api.camera.startLiveView()
                                                                const urlResult = await window.api.camera.getLiveViewUrl()
                                                                if (urlResult.success && urlResult.data) {
                                                                    setLiveViewUrl(urlResult.data)
                                                                    setLiveViewActive(true)
                                                                    // Refresh live view image periodically
                                                                    if (liveViewTimerRef.current) clearInterval(liveViewTimerRef.current)
                                                                    liveViewTimerRef.current = setInterval(() => {
                                                                        setLiveViewKey(k => k + 1)
                                                                    }, 200)
                                                                }
                                                            } catch (e) { console.error('Failed to start live view:', e) }
                                                        } else {
                                                            setCaptureTestResult('❌ Gagal connect: ' + (connectResult.error || 'Unknown'))
                                                        }
                                                    } catch (e: any) {
                                                        setCaptureTestResult('❌ Error: ' + e.message)
                                                    }
                                                    setCameraConnecting(false)
                                                }}
                                                style={{
                                                    padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
                                                    background: cameraConnected ? '#10b981' : '#ef4444', color: 'white',
                                                    opacity: cameraConnecting ? 0.6 : 1
                                                }}
                                            >
                                                {cameraConnecting ? '⏳ Connecting...' : cameraConnected ? '✅ Connected' : '🔌 Connect Camera'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Live View Preview */}
                                    {liveViewActive && liveViewUrl && (
                                        <div style={{ marginBottom: '15px', borderRadius: '10px', overflow: 'hidden', border: '2px solid rgba(239,68,68,0.3)', background: '#000', textAlign: 'center' }}>
                                            <img
                                                key={liveViewKey}
                                                src={`${liveViewUrl}?t=${liveViewKey}`}
                                                alt="Live View"
                                                style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }}
                                                onError={(e) => {
                                                    // Hide broken image icon
                                                    (e.target as HTMLImageElement).style.display = 'none'
                                                }}
                                                onLoad={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'block'
                                                }}
                                            />
                                            <p style={{ margin: '4px 0', fontSize: '11px', color: '#666' }}>📹 Live View from Camera Sensor</p>
                                        </div>
                                    )}

                                    {/* Camera Settings Dropdowns */}
                                    {cameraConnected && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                                            {/* ISO */}
                                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: '#fca5a5', marginBottom: '4px', fontWeight: 'bold' }}>ISO</label>
                                                <select
                                                    value={isoValues.current}
                                                    onChange={async (e) => {
                                                        const val = e.target.value
                                                        setIsoValues(prev => ({ ...prev, current: val }))
                                                        await window.api.camera.setProperty('iso', val)
                                                    }}
                                                    disabled={cameraSettingsLoading}
                                                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', color: 'white', fontSize: '13px' }}
                                                >
                                                    {isoValues.available.length > 0 ? (
                                                        isoValues.available.map(v => <option key={v} value={v}>{v}</option>)
                                                    ) : (
                                                        <option>{isoValues.current || 'Loading...'}</option>
                                                    )}
                                                </select>
                                            </div>

                                            {/* Aperture */}
                                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: '#fca5a5', marginBottom: '4px', fontWeight: 'bold' }}>Aperture</label>
                                                <select
                                                    value={apertureValues.current}
                                                    onChange={async (e) => {
                                                        const val = e.target.value
                                                        setApertureValues(prev => ({ ...prev, current: val }))
                                                        await window.api.camera.setProperty('aperture', val)
                                                    }}
                                                    disabled={cameraSettingsLoading}
                                                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', color: 'white', fontSize: '13px' }}
                                                >
                                                    {apertureValues.available.length > 0 ? (
                                                        apertureValues.available.map(v => <option key={v} value={v}>{v}</option>)
                                                    ) : (
                                                        <option>{apertureValues.current || 'Loading...'}</option>
                                                    )}
                                                </select>
                                            </div>

                                            {/* Shutter Speed */}
                                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: '#fca5a5', marginBottom: '4px', fontWeight: 'bold' }}>Shutter Speed</label>
                                                <select
                                                    value={shutterValues.current}
                                                    onChange={async (e) => {
                                                        const val = e.target.value
                                                        setShutterValues(prev => ({ ...prev, current: val }))
                                                        await window.api.camera.setProperty('shutterspeed', val)
                                                    }}
                                                    disabled={cameraSettingsLoading}
                                                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', color: 'white', fontSize: '13px' }}
                                                >
                                                    {shutterValues.available.length > 0 ? (
                                                        shutterValues.available.map(v => <option key={v} value={v}>{v}</option>)
                                                    ) : (
                                                        <option>{shutterValues.current || 'Loading...'}</option>
                                                    )}
                                                </select>
                                            </div>

                                            {/* White Balance */}
                                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: '#fca5a5', marginBottom: '4px', fontWeight: 'bold' }}>White Balance</label>
                                                <select
                                                    value={wbValues.current}
                                                    onChange={async (e) => {
                                                        const val = e.target.value
                                                        setWbValues(prev => ({ ...prev, current: val }))
                                                        await window.api.camera.setProperty('whitebalance', val)
                                                    }}
                                                    disabled={cameraSettingsLoading}
                                                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', color: 'white', fontSize: '13px' }}
                                                >
                                                    {wbValues.available.length > 0 ? (
                                                        wbValues.available.map(v => <option key={v} value={v}>{v}</option>)
                                                    ) : (
                                                        <option>{wbValues.current || 'Loading...'}</option>
                                                    )}
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                        <button
                                            disabled={!cameraConnected}
                                            onClick={async () => {
                                                setCaptureTestResult('⏳ Capturing...')
                                                try {
                                                    const result = await window.api.camera.capture('admin_test')
                                                    if (result.success && result.data?.success) {
                                                        setCaptureTestResult('✅ Capture berhasil! 📸')
                                                    } else {
                                                        setCaptureTestResult('❌ Gagal: ' + (result.data?.error || result.error || 'Unknown'))
                                                    }
                                                } catch (e: any) {
                                                    setCaptureTestResult('❌ Error: ' + e.message)
                                                }
                                            }}
                                            style={{ padding: '10px 20px', background: cameraConnected ? '#ef4444' : '#444', color: 'white', border: 'none', borderRadius: '8px', cursor: cameraConnected ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '14px' }}
                                        >
                                            📸 TEST CAPTURE
                                        </button>

                                        <button
                                            disabled={!cameraConnected}
                                            onClick={async () => {
                                                setCameraSettingsLoading(true)
                                                try {
                                                    const [iso, aperture, shutter, wb] = await Promise.all([
                                                        window.api.camera.getAvailableValues('iso'),
                                                        window.api.camera.getAvailableValues('aperture'),
                                                        window.api.camera.getAvailableValues('shutterspeed'),
                                                        window.api.camera.getAvailableValues('whitebalance')
                                                    ])
                                                    if (iso.success && iso.data) setIsoValues(iso.data)
                                                    if (aperture.success && aperture.data) setApertureValues(aperture.data)
                                                    if (shutter.success && shutter.data) setShutterValues(shutter.data)
                                                    if (wb.success && wb.data) setWbValues(wb.data)
                                                } catch (e) { console.error('Refresh settings error:', e) }
                                                setCameraSettingsLoading(false)
                                            }}
                                            style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: cameraConnected ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '14px' }}
                                        >
                                            🔄 Refresh Settings
                                        </button>

                                        {liveViewActive ? (
                                            <button
                                                onClick={async () => {
                                                    if (liveViewTimerRef.current) { clearInterval(liveViewTimerRef.current); liveViewTimerRef.current = null }
                                                    await window.api.camera.stopLiveView()
                                                    setLiveViewActive(false)
                                                    setLiveViewUrl(null)
                                                }}
                                                style={{ padding: '10px 20px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
                                            >
                                                🔴 Stop Live View
                                            </button>
                                        ) : cameraConnected ? (
                                            <button
                                                onClick={async () => {
                                                    await window.api.camera.startLiveView()
                                                    const urlResult = await window.api.camera.getLiveViewUrl()
                                                    if (urlResult.success && urlResult.data) {
                                                        setLiveViewUrl(urlResult.data)
                                                        setLiveViewActive(true)
                                                        if (liveViewTimerRef.current) clearInterval(liveViewTimerRef.current)
                                                        liveViewTimerRef.current = setInterval(() => setLiveViewKey(k => k + 1), 200)
                                                    }
                                                }}
                                                style={{ padding: '10px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
                                            >
                                                📹 Start Live View
                                            </button>
                                        ) : null}
                                    </div>

                                    {/* Result Message */}
                                    {captureTestResult && (
                                        <div style={{ marginTop: '10px', padding: '10px', borderRadius: '8px', background: captureTestResult.startsWith('✅') ? 'rgba(16,185,129,0.1)' : captureTestResult.startsWith('⏳') ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)', color: captureTestResult.startsWith('✅') ? '#10b981' : captureTestResult.startsWith('⏳') ? '#60a5fa' : '#ef4444', fontSize: '13px' }}>
                                            {captureTestResult}
                                        </div>
                                    )}

                                    {/* Setup instructions */}
                                    {!cameraConnected && (
                                        <div style={{ marginTop: '15px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '12px', color: '#9ca3af', lineHeight: '1.8' }}>
                                            <b style={{ color: '#fca5a5' }}>📋 Setup Awal (1x saja):</b><br/>
                                            1. Hubungkan kamera Canon via USB<br/>
                                            2. Buka <b>CameraControl.exe</b> (digiCamControl) → pastikan kamera terdeteksi<br/>
                                            3. Buka <b>Settings → Webserver</b> → centang <b>"Use web server"</b><br/>
                                            4. Restart CameraControl.exe<br/>
                                            5. Klik tombol <b>"Connect Camera"</b> di atas
                                        </div>
                                    )}
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

                                {/* DSLR Live View Zoom slider */}
                                <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                        <label style={{ fontSize: '14px', fontWeight: 'bold', color: 'white' }}>🔎 Zoom DSLR Live View</label>
                                        <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)', fontWeight: 'bold' }}>{Math.round((config.cameraZoom || 1.0) * 100)}%</span>
                                    </div>
                                    <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '0 0 10px 0' }}>
                                        Perbesar gambar preview untuk memotong (crop) frame hitam atau pinggiran hitam di sekitar live view capture card.
                                    </p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                        <input
                                            type="range"
                                            min="1.0"
                                            max="2.0"
                                            step="0.01"
                                            value={config.cameraZoom || 1.0}
                                            onChange={(e) => updateConfig({ cameraZoom: parseFloat(e.target.value) })}
                                            style={{
                                                flex: 1,
                                                cursor: 'pointer',
                                                accentColor: '#3b82f6'
                                            }}
                                        />
                                        <button
                                            onClick={() => updateConfig({ cameraZoom: 1.0 })}
                                            style={{
                                                padding: '8px 15px',
                                                fontSize: '12px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-bg-secondary)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                fontWeight: 'bold'
                                            }}
                                        >
                                            Reset
                                        </button>
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

                {/* Button Indicator Editor Tab */}
                {activeTab === 'button-indicator' && (
                    <div className={styles.timersTab}>
                        <div className={styles.timerCard} style={{ gridColumn: '1 / -1' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h3>🔘 Kustomisasi Penunjuk Tombol Fisik</h3>
                                    <p style={{ opacity: 0.7, margin: '4px 0 0 0' }}>
                                        Sesuaikan posisi, bentuk, warna, dan petunjuk visual ke tombol fisik di samping monitor.
                                    </p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsLayoutEditMode(true)
                                            navigate('/')
                                        }}
                                        style={{
                                            padding: '10px 18px',
                                            borderRadius: '10px',
                                            border: 'none',
                                            background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                                            color: '#ffffff',
                                            fontWeight: 'bold',
                                            fontSize: '13px',
                                            cursor: 'pointer',
                                            boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        🚀 Buka Live Layout Editor (Halaman Asli)
                                    </button>
                                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
                                        {config.buttonIndicatorEnabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}
                                    </span>
                                    <label className={styles.toggleSwitch}>
                                        <input
                                            type="checkbox"
                                            checked={config.buttonIndicatorEnabled ?? false}
                                            onChange={(e) => updateConfig({ buttonIndicatorEnabled: e.target.checked })}
                                        />
                                        <span className={styles.toggleSlider}></span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Interactive Editor Container */}
                        <div className={styles.timerCard} style={{ gridColumn: '1 / 3' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h4 style={{ margin: 0 }}>🎨 Canvas Editor (Drag, Resize & Rotate)</h4>
                                <span style={{ fontSize: '12px', opacity: 0.6 }}>
                                    Orientasi Layar: <strong>{config.appOrientation?.toUpperCase() || 'PORTRAIT'}</strong>
                                </span>
                            </div>

                            {/* Page Preview Selector Bar */}
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px', padding: '10px 14px', backgroundColor: 'var(--color-bg-secondary, #1f2937)', borderRadius: '12px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 'bold', alignSelf: 'center', marginRight: '6px' }}>👁️ Pratinjau Halaman:</span>
                                {[
                                    { id: 'landing', label: '🏠 Beranda' },
                                    { id: 'frames', label: '🖼️ Pilih Frame' },
                                    { id: 'payment', label: '💳 Pembayaran' },
                                    { id: 'capture', label: '📸 Sesi Foto' },
                                    { id: 'review', label: '🎨 Review Foto' },
                                    { id: 'sharing', label: '📲 Sharing QR' },
                                    { id: 'printing', label: '🖨️ Cetak' }
                                ].map((page) => (
                                    <button
                                        key={page.id}
                                        type="button"
                                        onClick={() => setIndicatorPreviewPage(page.id as any)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '8px',
                                            border: indicatorPreviewPage === page.id ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.15)',
                                            backgroundColor: indicatorPreviewPage === page.id ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                                            color: '#ffffff',
                                            fontSize: '12px',
                                            fontWeight: indicatorPreviewPage === page.id ? 'bold' : 'normal',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        {page.label}
                                    </button>
                                ))}
                            </div>

                            {/* Canvas Area */}
                            <div
                                ref={indicatorCanvasRef}
                                style={{
                                    position: 'relative',
                                    width: '100%',
                                    height: config.appOrientation === 'landscape' ? '380px' : '520px',
                                    maxWidth: '650px',
                                    margin: '0 auto',
                                    backgroundColor: '#0f172a',
                                    borderRadius: '16px',
                                    border: '3px solid #334155',
                                    overflow: 'hidden',
                                    boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8)',
                                    userSelect: 'none'
                                }}
                            >
                                {/* Background Screen Mockup Graphic based on indicatorPreviewPage */}
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    pointerEvents: 'none',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    padding: '16px',
                                    boxSizing: 'border-box'
                                }}>
                                    {indicatorPreviewPage === 'landing' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'radial-gradient(circle, rgba(30,58,138,0.4) 0%, rgba(15,23,42,0.9) 100%)', borderRadius: '12px' }}>
                                            <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '2px', color: '#f8fafc', marginBottom: '8px' }}>📸 SEBOOTH</div>
                                            <div style={{ fontSize: '13px', opacity: 0.7, marginBottom: '24px' }}>Capture Extraordinary Moments</div>
                                            <div style={{ padding: '14px 32px', borderRadius: '999px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white', fontWeight: 'bold', fontSize: '15px', boxShadow: '0 8px 20px rgba(239,68,68,0.4)' }}>
                                                🚀 MULAI SESI FOTO
                                            </div>
                                            <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '16px' }}>Tekan tombol untuk memulai</div>
                                        </div>
                                    )}

                                    {indicatorPreviewPage === 'frames' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1e293b', borderRadius: '12px', padding: '16px' }}>
                                            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '12px' }}>🖼️ Pilih Desain Frame</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', flex: 1 }}>
                                                {[1, 2, 3].map(i => (
                                                    <div key={i} style={{ border: i === 1 ? '2px solid #3b82f6' : '1px solid #475569', borderRadius: '8px', padding: '8px', background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                                        <div style={{ width: '80%', height: '60px', background: '#334155', borderRadius: '4px', marginBottom: '6px' }} />
                                                        <div style={{ fontSize: '10px', color: '#cbd5e1' }}>Frame {i}</div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div style={{ marginTop: '12px', padding: '10px', background: '#3b82f6', color: 'white', textAlign: 'center', borderRadius: '8px', fontWeight: 'bold', fontSize: '12px' }}>
                                                LANJUTKAN ➔
                                            </div>
                                        </div>
                                    )}

                                    {indicatorPreviewPage === 'payment' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1e293b', borderRadius: '12px', padding: '16px' }}>
                                            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '4px' }}>💳 Pembayaran QRIS</div>
                                            <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 'bold', marginBottom: '12px' }}>Rp 25.000 (1 Sesi)</div>
                                            <div style={{ width: '130px', height: '130px', background: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'black', fontWeight: 'bold', fontSize: '12px' }}>
                                                [ QRIS CODE ]
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '12px' }}>Scan dengan GoPay / ShopeePay / BCA</div>
                                        </div>
                                    )}

                                    {indicatorPreviewPage === 'capture' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#090d16', borderRadius: '12px', padding: '12px', position: 'relative' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>
                                                <span>📸 CAMERA LIVE VIEW</span>
                                                <span style={{ color: '#10b981' }}>🔴 REC 00:03</span>
                                            </div>
                                            <div style={{ flex: 1, border: '2px dashed #334155', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                <div style={{ fontSize: '64px', fontWeight: '900', color: '#ef4444', textShadow: '0 0 20px rgba(239,68,68,0.8)' }}>3</div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'center' }}>
                                                {[1, 2, 3, 4].map(s => (
                                                    <div key={s} style={{ width: '20px', height: '20px', borderRadius: '50%', background: s === 1 ? '#ef4444' : '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'white', fontWeight: 'bold' }}>
                                                        {s}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {indicatorPreviewPage === 'review' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1e293b', borderRadius: '12px', padding: '12px' }}>
                                            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '8px' }}>🎨 Review & Pilih Filter</div>
                                            <div style={{ flex: 1, background: '#0f172a', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#64748b' }}>
                                                [ FOTO RESULT STRIP ]
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', overflowX: 'hidden' }}>
                                                {['Original', 'B&W', 'Warm', 'Cool'].map(f => (
                                                    <div key={f} style={{ padding: '4px 10px', borderRadius: '6px', background: f === 'Original' ? '#3b82f6' : '#334155', fontSize: '10px', color: 'white' }}>
                                                        {f}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {indicatorPreviewPage === 'sharing' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1e293b', borderRadius: '12px', padding: '16px' }}>
                                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '4px' }}>📲 Download Foto Digital</div>
                                            <div style={{ width: '110px', height: '110px', background: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'black', fontWeight: 'bold', fontSize: '11px', margin: '8px 0' }}>
                                                [ SCAN QR CODE ]
                                            </div>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
                                                <div style={{ padding: '6px 14px', background: '#334155', borderRadius: '6px', fontSize: '12px', color: 'white' }}>- 2 Lembar +</div>
                                                <div style={{ padding: '6px 16px', background: '#10b981', borderRadius: '6px', fontSize: '12px', color: 'white', fontWeight: 'bold' }}>🖨️ CETAK</div>
                                            </div>
                                        </div>
                                    )}

                                    {indicatorPreviewPage === 'printing' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                                            <div style={{ fontSize: '36px', marginBottom: '8px' }}>🖨️</div>
                                            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '6px' }}>Foto Sedang Dicetak...</div>
                                            <div style={{ width: '70%', height: '8px', background: '#334155', borderRadius: '999px', overflow: 'hidden', margin: '8px 0' }}>
                                                <div style={{ width: '65%', height: '100%', background: '#10b981' }} />
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Silakan ambil foto di bagian bawah printer</div>
                                        </div>
                                    )}
                                </div>

                                {/* Layout Guidelines: 3x3 Grid Lines */}
                                {showGridLines && (
                                    <>
                                        <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, borderTop: '1px dashed rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
                                        <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, borderTop: '1px dashed rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
                                        <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, borderLeft: '1px dashed rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
                                        <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, borderLeft: '1px dashed rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
                                    </>
                                )}

                                {/* Layout Guidelines: Center Lines (50%) */}
                                {showCenterLines && (
                                    <>
                                        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1.5px dashed #ef4444', opacity: 0.6, pointerEvents: 'none' }} />
                                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: '1.5px dashed #ef4444', opacity: 0.6, pointerEvents: 'none' }} />
                                    </>
                                )}

                                {/* Layout Guidelines: Safety Margin Border Guides (5% & 10%) */}
                                {showMarginGuides && (
                                    <>
                                        <div style={{ position: 'absolute', inset: '5%', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '8px', pointerEvents: 'none' }} />
                                        <div style={{ position: 'absolute', inset: '10%', border: '1px dashed rgba(16, 185, 129, 0.3)', borderRadius: '8px', pointerEvents: 'none' }} />
                                    </>
                                )}

                                {/* Draggable & Resizable Indicator Wrapper */}
                                <div
                                    onMouseDown={(e) => handleIndicatorMouseDown('move', e)}
                                    style={{
                                        position: 'absolute',
                                        left: `${config.buttonIndicatorX ?? 80}%`,
                                        top: `${config.buttonIndicatorY ?? 50}%`,
                                        width: `${config.buttonIndicatorWidth ?? 260}px`,
                                        height: `${config.buttonIndicatorHeight ?? 70}px`,
                                        transform: `translate(-50%, -50%) rotate(${config.buttonIndicatorRotation ?? 0}deg)`,
                                        transformOrigin: 'center center',
                                        cursor: indicatorDragMode === 'move' ? 'grabbing' : 'grab',
                                        zIndex: 10
                                    }}
                                >
                                    {/* Selection Bounding Border & Rotate Handle */}
                                    <div style={{
                                        position: 'absolute',
                                        inset: '-6px',
                                        border: '2px dashed #3b82f6',
                                        borderRadius: '12px',
                                        pointerEvents: 'none'
                                    }}>
                                        {/* Rotate Knob Handle */}
                                        <div
                                            onMouseDown={(e) => handleIndicatorMouseDown('rotate', e)}
                                            style={{
                                                position: 'absolute',
                                                top: '-28px',
                                                left: '50%',
                                                transform: 'translateX(-50%)',
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '50%',
                                                backgroundColor: '#3b82f6',
                                                color: '#ffffff',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '14px',
                                                cursor: 'grab',
                                                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                                                pointerEvents: 'auto'
                                            }}
                                            title="Tarik untuk memutar indikator (Rotate)"
                                        >
                                            ↻
                                        </div>

                                        {/* Resize Handles (SE, SW, NE, NW) */}
                                        <div
                                            onMouseDown={(e) => handleIndicatorMouseDown('resize-nw', e)}
                                            style={{ position: 'absolute', top: '-6px', left: '-6px', width: '12px', height: '12px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nwse-resize', pointerEvents: 'auto' }}
                                        />
                                        <div
                                            onMouseDown={(e) => handleIndicatorMouseDown('resize-ne', e)}
                                            style={{ position: 'absolute', top: '-6px', right: '-6px', width: '12px', height: '12px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nesw-resize', pointerEvents: 'auto' }}
                                        />
                                        <div
                                            onMouseDown={(e) => handleIndicatorMouseDown('resize-sw', e)}
                                            style={{ position: 'absolute', bottom: '-6px', left: '-6px', width: '12px', height: '12px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nesw-resize', pointerEvents: 'auto' }}
                                        />
                                        <div
                                            onMouseDown={(e) => handleIndicatorMouseDown('resize-se', e)}
                                            style={{ position: 'absolute', bottom: '-6px', right: '-6px', width: '12px', height: '12px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nwse-resize', pointerEvents: 'auto' }}
                                        />
                                    </div>

                                    {/* Actual Indicator Render Component */}
                                    <PhysicalButtonIndicator isEditing={true} overridePageKey={indicatorPreviewPage} />
                                </div>
                            </div>

                            {/* Guideline Controls Toolbar */}
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '16px',
                                marginTop: '16px',
                                padding: '12px 16px',
                                backgroundColor: 'var(--color-bg-secondary, #1f2937)',
                                borderRadius: '12px',
                                fontSize: '13px'
                            }}>
                                <span style={{ fontWeight: 'bold', alignSelf: 'center' }}>📐 Layout Guidelines:</span>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={showGridLines} onChange={(e) => setShowGridLines(e.target.checked)} />
                                    Grid 3x3
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={showCenterLines} onChange={(e) => setShowCenterLines(e.target.checked)} />
                                    <span style={{ color: '#ef4444' }}>Sumbu Tengah (Center)</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={showMarginGuides} onChange={(e) => setShowMarginGuides(e.target.checked)} />
                                    <span style={{ color: '#3b82f6' }}>Margin Tepi (Safety)</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={enableMagneticSnap} onChange={(e) => setEnableMagneticSnap(e.target.checked)} />
                                    <span style={{ color: '#10b981', fontWeight: 'bold' }}>🧲 Magnetic Snap</span>
                                </label>
                            </div>
                        </div>

                        {/* Settings Toolbar Sidebar */}
                        <div className={styles.timerCard} style={{ gridColumn: '3 / -1' }}>
                            <h4>⚙️ Pengaturan Teks & Gaya</h4>

                            {/* Text Input */}
                            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                                <label style={{ fontSize: '13px', fontWeight: 'bold' }}>Teks Penunjuk:</label>
                                <input
                                    type="text"
                                    value={config.buttonIndicatorText || ''}
                                    onChange={(e) => updateConfig({ buttonIndicatorText: e.target.value })}
                                    placeholder="TEKAN TOMBOL DI SINI ➔"
                                    style={{
                                        width: '100%',
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border, #374151)',
                                        background: 'var(--color-bg-secondary, #1f2937)',
                                        color: '#ffffff',
                                        marginTop: '6px'
                                    }}
                                />
                            </div>

                            {/* Shape Selector */}
                            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                                <label style={{ fontSize: '13px', fontWeight: 'bold' }}>Bentuk / Model:</label>
                                <select
                                    value={config.buttonIndicatorShape || 'pill'}
                                    onChange={(e) => updateConfig({ buttonIndicatorShape: e.target.value as any })}
                                    style={{
                                        width: '100%',
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border, #374151)',
                                        background: 'var(--color-bg-secondary, #1f2937)',
                                        color: '#ffffff',
                                        marginTop: '6px'
                                    }}
                                >
                                    <option value="pill">💊 Pill / Capsule (Kapsul Bulat)</option>
                                    <option value="rectangle">⬛ Sleek Rectangle (Kotak Modern)</option>
                                    <option value="badge">🏷️ Callout Badge (Tag Melayang)</option>
                                    <option value="arrow-right">➔ Panah Kanan</option>
                                    <option value="arrow-left">⬅ Panah Kiri</option>
                                    <option value="arrow-down">⬇ Panah Bawah</option>
                                    <option value="arrow-up">⬆ Panah Atas</option>
                                </select>
                            </div>

                            {/* Color Quick Presets */}
                            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                                <label style={{ fontSize: '13px', fontWeight: 'bold' }}>Preset Warna Cepat:</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                                    {[
                                        { name: 'Merah', bg: '#ef4444', text: '#ffffff', border: '#ffffff' },
                                        { name: 'Hijau', bg: '#10b981', text: '#ffffff', border: '#ffffff' },
                                        { name: 'Biru', bg: '#3b82f6', text: '#ffffff', border: '#ffffff' },
                                        { name: 'Kuning', bg: '#eab308', text: '#000000', border: '#000000' },
                                        { name: 'Oranye', bg: '#f97316', text: '#ffffff', border: '#ffffff' },
                                        { name: 'Ungu', bg: '#8b5cf6', text: '#ffffff', border: '#ffffff' },
                                        { name: 'Gelap', bg: '#1e293b', text: '#ffffff', border: '#3b82f6' }
                                    ].map((preset) => (
                                        <button
                                            key={preset.name}
                                            type="button"
                                            onClick={() => updateConfig({
                                                buttonIndicatorBgColor: preset.bg,
                                                buttonIndicatorTextColor: preset.text,
                                                buttonIndicatorBorderColor: preset.border
                                            })}
                                            style={{
                                                padding: '6px 12px',
                                                borderRadius: '6px',
                                                backgroundColor: preset.bg,
                                                color: preset.text,
                                                border: `2px solid ${preset.border}`,
                                                fontSize: '12px',
                                                fontWeight: 'bold',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {preset.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Custom Color Pickers */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                <div>
                                    <label style={{ fontSize: '12px' }}>Warna Background:</label>
                                    <input
                                        type="color"
                                        value={config.buttonIndicatorBgColor || '#ef4444'}
                                        onChange={(e) => updateConfig({ buttonIndicatorBgColor: e.target.value })}
                                        style={{ width: '100%', height: '36px', borderRadius: '6px', cursor: 'pointer', border: 'none', marginTop: '4px' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '12px' }}>Warna Teks:</label>
                                    <input
                                        type="color"
                                        value={config.buttonIndicatorTextColor || '#ffffff'}
                                        onChange={(e) => updateConfig({ buttonIndicatorTextColor: e.target.value })}
                                        style={{ width: '100%', height: '36px', borderRadius: '6px', cursor: 'pointer', border: 'none', marginTop: '4px' }}
                                    />
                                </div>
                            </div>

                            {/* Rotation & Size Sliders */}
                            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                    <label style={{ fontWeight: 'bold' }}>Rotasi Sudut (Rotate):</label>
                                    <span>{config.buttonIndicatorRotation ?? 0}°</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="360"
                                    value={config.buttonIndicatorRotation ?? 0}
                                    onChange={(e) => updateConfig({ buttonIndicatorRotation: Number(e.target.value) })}
                                    style={{ width: '100%', marginTop: '6px' }}
                                />
                            </div>

                            {/* Font Size Slider */}
                            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                    <label style={{ fontWeight: 'bold' }}>Ukuran Font:</label>
                                    <span>{config.buttonIndicatorFontSize ?? 16}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="12"
                                    max="32"
                                    value={config.buttonIndicatorFontSize ?? 16}
                                    onChange={(e) => updateConfig({ buttonIndicatorFontSize: Number(e.target.value) })}
                                    style={{ width: '100%', marginTop: '6px' }}
                                />
                            </div>

                            {/* Pulse Animation Toggle */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                <div>
                                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>✨ Animasi Denyut (Pulse Glow)</span>
                                    <p style={{ fontSize: '12px', opacity: 0.6, margin: '2px 0 0 0' }}>Bikin penunjuk terus berdenyut untuk menarik perhatian</p>
                                </div>
                                <label className={styles.toggleSwitch}>
                                    <input
                                        type="checkbox"
                                        checked={config.buttonIndicatorPulse ?? true}
                                        onChange={(e) => updateConfig({ buttonIndicatorPulse: e.target.checked })}
                                    />
                                    <span className={styles.toggleSlider}></span>
                                </label>
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
