import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
    FrameConfig,
    PhotoSlot,
    QRSlot,
    CapturedPhoto,
    SessionData,
    AppConfig,
    LUTFilter,
    CameraDevice,
    QueueStatusResponse,
    QueueTicket
} from '@shared/types'
import { v4 as uuidv4 } from 'uuid'

// ================================
// App Config Store
// ================================
interface AppConfigState {
    config: AppConfig
    updateConfig: (updates: Partial<AppConfig>) => void
    resetConfig: () => void
    isLayoutEditMode: boolean
    setIsLayoutEditMode: (active: boolean) => void
    showGridLines: boolean
    setShowGridLines: (show: boolean) => void
    showCenterLines: boolean
    setShowCenterLines: (show: boolean) => void
    showMarginGuides: boolean
    setShowMarginGuides: (show: boolean) => void
    enableMagneticSnap: boolean
    setEnableMagneticSnap: (snap: boolean) => void
    selectedIndicatorId: string | null
    setSelectedIndicatorId: (id: string | null) => void
}

const defaultConfig: AppConfig = {
    countdownDuration: 5,
    previewDuration: 2,
    sessionTimeout: 120,
    activeFrameIds: [],
    timerEnabled: true,

    // Printer
    printerEnabled: false,
    printerName: '',

    // Per-session timeouts
    frameSelectionTimeout: 60,
    captureTimeout: 120,
    postProcessingTimeout: 90,
    sessionTimerEnabled: true,
    // Payment Gateway
    paymentEnabled: false,
    paymentGateway: 'midtrans',
    sessionPrice: 25000, // IDR 25,000 base price
    additionalPrintPrice: 5000, // IDR 5,000 per 2 additional prints
    midtransClientKey: '',
    midtransServerKey: '',
    dokuClientId: '',
    dokuSecretKey: '',
    dokuSandbox: true,
    paymentInstructions: 'Scan QR code dengan aplikasi e-wallet atau mobile banking Anda. Pembayaran akan terkonfirmasi otomatis.',
    paymentTimeout: 300, // 5 minutes
    sharingMode: 'cloud', // Can be 'cloud' or 'local'
    cloudPortalUrl: '',
    cameraMode: 'mock', // Can be 'mock' or 'dslr'
    selectedCameraId: undefined,
    // Queue Integration
    queueEnabled: false,
    queueEventId: '',
    queueWebhookSecret: 'sebooth-queue-webhook-2026',
    queueApiUrl: 'https://www.sebooth.in',
    appOrientation: 'portrait',
    cameraRotation: 0,
    mirrorOutput: false,
    customBgLandscape: '',
    customBgPortrait: '',
    customBgLandscapeType: undefined,
    customBgPortraitType: undefined,
    // Remote Printing (Double Device)
    printServerEnabled: false,
    printClientEnabled: false,
    printServerUrl: '',
    deviceName: 'Booth A',
    // Camera Preview Adjustments
    cameraZoom: 1.0,
    cameraScaleX: 1.0,
    cameraScaleY: 1.0,
    cameraOffsetX: 0,
    cameraOffsetY: 0,
    // Physical Button Indicator Settings
    buttonIndicatorEnabled: false,
    buttonIndicatorText: 'TEKAN TOMBOL DI SINI ➔',
    buttonIndicatorX: 80,
    buttonIndicatorY: 50,
    buttonIndicatorWidth: 260,
    buttonIndicatorHeight: 70,
    buttonIndicatorRotation: 0,
    buttonIndicatorBgColor: '#ef4444',
    buttonIndicatorTextColor: '#ffffff',
    buttonIndicatorBorderColor: '#ffffff',
    buttonIndicatorShape: 'pill',
    buttonIndicatorPulse: true,
    buttonIndicatorFontSize: 16,
    // Per-Page Button Indicators (independent configuration per page route)
    pageButtonIndicators: {
        landing: {
            enabled: true,
            text: 'TEKAN TOMBOL UNTUK MULAI ➔',
            x: 80, y: 50, width: 280, height: 70, rotation: 0,
            bgColor: '#ef4444', textColor: '#ffffff', borderColor: '#ffffff',
            shape: 'pill', pulse: true, fontSize: 16
        },
        frames: {
            enabled: true,
            text: 'TEKAN TOMBOL PILIH FRAME ➔',
            x: 80, y: 50, width: 280, height: 70, rotation: 0,
            bgColor: '#3b82f6', textColor: '#ffffff', borderColor: '#ffffff',
            shape: 'pill', pulse: true, fontSize: 16
        },
        payment: {
            enabled: true,
            text: 'TEKAN SETELAH BAYAR ➔',
            x: 80, y: 50, width: 260, height: 70, rotation: 0,
            bgColor: '#10b981', textColor: '#ffffff', borderColor: '#ffffff',
            shape: 'pill', pulse: true, fontSize: 16
        },
        capture: {
            enabled: true,
            text: 'SIAP-SIAP GAYA! 📸',
            x: 80, y: 20, width: 240, height: 60, rotation: 0,
            bgColor: '#f97316', textColor: '#ffffff', borderColor: '#ffffff',
            shape: 'badge', pulse: true, fontSize: 16
        },
        review: {
            enabled: true,
            text: 'TEKAN UNTUK CETAK FOTO ➔',
            x: 80, y: 50, width: 280, height: 70, rotation: 0,
            bgColor: '#8b5cf6', textColor: '#ffffff', borderColor: '#ffffff',
            shape: 'pill', pulse: true, fontSize: 16
        },
        sharing: {
            enabled: true,
            text: 'TEKAN TOMBOL UNTUK CETAK ➔',
            x: 80, y: 50, width: 280, height: 70, rotation: 0,
            bgColor: '#10b981', textColor: '#ffffff', borderColor: '#ffffff',
            shape: 'pill', pulse: true, fontSize: 16
        },
        printing: {
            enabled: false,
            text: 'FOTO SEDANG DICETAK...',
            x: 50, y: 80, width: 260, height: 60, rotation: 0,
            bgColor: '#1e293b', textColor: '#ffffff', borderColor: '#3b82f6',
            shape: 'rectangle', pulse: false, fontSize: 15
        }
    }
}

import { apiHelper } from '../lib/apiHelper'

export const useAppConfig = create<AppConfigState>((set) => {
    // Initial fetch
    apiHelper.getConfig().then((data) => {
        if (data) set({ config: data })
    })

    // Listen for real-time updates from Laptop Main Process
    apiHelper.onConfigUpdate((newConfig) => {
        set({ config: newConfig })
    })

    return {
        config: defaultConfig,
        isLayoutEditMode: false,
        setIsLayoutEditMode: (active) => set({ isLayoutEditMode: active }),
        showGridLines: true,
        setShowGridLines: (show) => set({ showGridLines: show }),
        showCenterLines: true,
        setShowCenterLines: (show) => set({ showCenterLines: show }),
        showMarginGuides: true,
        setShowMarginGuides: (show) => set({ showMarginGuides: show }),
        enableMagneticSnap: true,
        setEnableMagneticSnap: (snap) => set({ enableMagneticSnap: snap }),
        selectedIndicatorId: null,
        setSelectedIndicatorId: (id) => set({ selectedIndicatorId: id }),
        updateConfig: async (updates) => {
            // Optimistic update
            set((state) => ({ config: { ...state.config, ...updates } }))
            await apiHelper.updateConfig(updates)
        },
        resetConfig: () => {
            set({ config: defaultConfig })
            apiHelper.updateConfig(defaultConfig)
        }
    }
})

// ================================
// Frame Config Store with Undo/Redo
// ================================
interface FrameState {
    frames: FrameConfig[]
    activeFrame: FrameConfig | null
    // Undo/Redo history
    history: FrameConfig[][]
    future: FrameConfig[][]
    addFrame: (frame: Omit<FrameConfig, 'id'>) => string
    updateFrame: (id: string, updates: Partial<FrameConfig>) => void
    deleteFrame: (id: string) => void
    setActiveFrame: (id: string | null) => void
    addSlot: (frameId: string, slot?: Partial<PhotoSlot>) => void
    updateSlot: (frameId: string, slotId: string, updates: Partial<PhotoSlot>) => void
    deleteSlot: (frameId: string, slotId: string) => void
    addQRSlot: (frameId: string, slot?: Partial<QRSlot>) => void
    updateQRSlot: (frameId: string, slotId: string, updates: Partial<QRSlot>) => void
    deleteQRSlot: (frameId: string, slotId: string) => void
    // Undo/Redo actions
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
}

const MAX_HISTORY_SIZE = 50

export const useFrameStore = create<FrameState>()(
    persist(
        (set, get) => {
            // Helper to save current state to history before mutations
            const saveToHistory = () => {
                const { frames, history } = get()
                const newHistory = [...history, JSON.parse(JSON.stringify(frames))]
                // Limit history size
                if (newHistory.length > MAX_HISTORY_SIZE) {
                    newHistory.shift()
                }
                return { history: newHistory, future: [] }
            }

            return {
                frames: [],
                activeFrame: null,
                history: [],
                future: [],

                addFrame: (frame) => {
                    const id = uuidv4()
                    set((state) => ({
                        ...saveToHistory(),
                        frames: [...state.frames, { ...frame, id }]
                    }))
                    return id
                },

                updateFrame: (id, updates) => set((state) => ({
                    ...saveToHistory(),
                    frames: state.frames.map(f => f.id === id ? { ...f, ...updates } : f),
                    activeFrame: state.activeFrame?.id === id
                        ? { ...state.activeFrame, ...updates }
                        : state.activeFrame
                })),

                deleteFrame: (id) => set((state) => ({
                    ...saveToHistory(),
                    frames: state.frames.filter(f => f.id !== id),
                    activeFrame: state.activeFrame?.id === id ? null : state.activeFrame
                })),

                setActiveFrame: (id) => {
                    const frame = id ? get().frames.find(f => f.id === id) : null
                    set({ activeFrame: frame || null })
                },

                addSlot: (frameId, slot) => {
                    const newSlot: PhotoSlot = {
                        id: uuidv4(),
                        x: slot?.x ?? 100,
                        y: slot?.y ?? 100,
                        width: slot?.width ?? 400,
                        height: slot?.height ?? 300,
                        rotation: slot?.rotation ?? 0,
                        duplicateOfSlotId: slot?.duplicateOfSlotId
                    }

                    set((state) => ({
                        ...saveToHistory(),
                        frames: state.frames.map(f =>
                            f.id === frameId
                                ? { ...f, slots: [...f.slots, newSlot] }
                                : f
                        )
                    }))
                },

                updateSlot: (frameId, slotId, updates) => set((state) => ({
                    ...saveToHistory(),
                    frames: state.frames.map(f =>
                        f.id === frameId
                            ? {
                                ...f,
                                slots: f.slots.map(s => s.id === slotId ? { ...s, ...updates } : s)
                            }
                            : f
                    )
                })),

                deleteSlot: (frameId, slotId) => set((state) => ({
                    ...saveToHistory(),
                    frames: state.frames.map(f =>
                        f.id === frameId
                            ? { ...f, slots: f.slots.filter(s => s.id !== slotId) }
                            : f
                    )
                })),

                addQRSlot: (frameId, slot) => {
                    const newSlot = {
                        id: uuidv4(),
                        x: slot?.x ?? 50,
                        y: slot?.y ?? 50,
                        width: slot?.width ?? 200,
                        height: slot?.height ?? 200,
                        enabled: slot?.enabled ?? true
                    }

                    set((state) => ({
                        ...saveToHistory(),
                        frames: state.frames.map(f =>
                            f.id === frameId
                                ? { ...f, qrSlots: [...(f.qrSlots || []), newSlot] }
                                : f
                        ),
                        activeFrame: state.activeFrame?.id === frameId
                            ? { ...state.activeFrame, qrSlots: [...(state.activeFrame.qrSlots || []), newSlot] }
                            : state.activeFrame
                    }))
                },

                updateQRSlot: (frameId, slotId, updates) => set((state) => ({
                    ...saveToHistory(),
                    frames: state.frames.map(f =>
                        f.id === frameId
                            ? {
                                ...f,
                                qrSlots: (f.qrSlots || []).map(s => s.id === slotId ? { ...s, ...updates } : s)
                            }
                            : f
                    ),
                    activeFrame: state.activeFrame?.id === frameId
                        ? {
                            ...state.activeFrame,
                            qrSlots: (state.activeFrame.qrSlots || []).map(s => s.id === slotId ? { ...s, ...updates } : s)
                        }
                        : state.activeFrame
                })),

                deleteQRSlot: (frameId, slotId) => set((state) => ({
                    ...saveToHistory(),
                    frames: state.frames.map(f =>
                        f.id === frameId
                            ? { ...f, qrSlots: (f.qrSlots || []).filter(s => s.id !== slotId) }
                            : f
                    ),
                    activeFrame: state.activeFrame?.id === frameId
                        ? { ...state.activeFrame, qrSlots: (state.activeFrame.qrSlots || []).filter(s => s.id !== slotId) }
                        : state.activeFrame
                })),

                // Undo: restore previous state
                undo: () => set((state) => {
                    if (state.history.length === 0) return state
                    const previous = state.history[state.history.length - 1]
                    const newHistory = state.history.slice(0, -1)
                    return {
                        frames: previous,
                        history: newHistory,
                        future: [JSON.parse(JSON.stringify(state.frames)), ...state.future]
                    }
                }),

                // Redo: restore next state
                redo: () => set((state) => {
                    if (state.future.length === 0) return state
                    const next = state.future[0]
                    const newFuture = state.future.slice(1)
                    return {
                        frames: next,
                        history: [...state.history, JSON.parse(JSON.stringify(state.frames))],
                        future: newFuture
                    }
                }),

                canUndo: () => get().history.length > 0,
                canRedo: () => get().future.length > 0
            }
        },
        {
            name: 'sebooth-frames',
            // Don't persist history/future to avoid large storage
            partialize: (state) => ({ frames: state.frames, activeFrame: state.activeFrame })
        }
    )
)

// ================================
// Session Store
// ================================
interface SessionState {
    currentSession: SessionData | null
    photos: CapturedPhoto[]
    startSession: (frameId: string, printQuantity?: number) => void
    endSession: () => void
    setPrintQuantity: (quantity: number) => void
    addPhoto: (slotId: string, imagePath: string, videoPath?: string) => void
    updatePhoto: (slotId: string, updates: Partial<CapturedPhoto>) => void
    removePhoto: (slotId: string) => void
    swapPhotos: (slotIdA: string, slotIdB: string) => void
    setCompositePath: (path: string) => void
    compositePath?: string
    setEmail: (email: string) => void
    setCloudSessionId: (id: string) => void
    selectedFilter: string
    setSessionFilter: (filterId: string) => void
    isMirrored: boolean
    setIsMirrored: (mirror: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
    currentSession: null,
    photos: [],

    startSession: (frameId, printQuantity) => set({
        currentSession: {
            id: uuidv4(),
            frameId,
            photos: [],
            createdAt: Date.now(),
            printQuantity: printQuantity || 2
        },
        photos: []
    }),

    setPrintQuantity: (quantity) => set((state) => ({
        currentSession: state.currentSession
            ? { ...state.currentSession, printQuantity: quantity }
            : null
    })),

    endSession: () => set({
        currentSession: null,
        photos: []
    }),

    addPhoto: (slotId, imagePath, videoPath) => set((state) => {
        const newPhoto: CapturedPhoto = {
            slotId,
            imagePath,
            timestamp: Date.now(),
            videoPath
        }
        return {
            photos: [...state.photos.filter(p => p.slotId !== slotId), newPhoto]
        }
    }),

    updatePhoto: (slotId, updates) => set((state) => ({
        photos: state.photos.map(p =>
            p.slotId === slotId ? { ...p, ...updates } : p
        )
    })),

    removePhoto: (slotId) => set((state) => ({
        photos: state.photos.filter(p => p.slotId !== slotId)
    })),

    swapPhotos: (slotIdA, slotIdB) => set((state) => {
        const photoA = state.photos.find(p => p.slotId === slotIdA)
        const photoB = state.photos.find(p => p.slotId === slotIdB)
        
        if (!photoA || !photoB) return { photos: state.photos }
        
        return {
            photos: state.photos.map(p => {
                if (p.slotId === slotIdA) return { ...p, slotId: slotIdB, panX: 0, panY: 0, scale: 1 }
                if (p.slotId === slotIdB) return { ...p, slotId: slotIdA, panX: 0, panY: 0, scale: 1 }
                return p
            })
        }
    }),

    setCompositePath: (path) => set((state) => ({
        currentSession: state.currentSession
            ? { ...state.currentSession, compositePath: path }
            : null
    })),

    setEmail: (email) => set((state) => ({
        currentSession: state.currentSession
            ? { ...state.currentSession, email }
            : null
    })),

    setCloudSessionId: (id) => set((state) => ({
        currentSession: state.currentSession
            ? { ...state.currentSession, cloudSessionId: id }
            : null
    })),

    selectedFilter: 'none',

    setSessionFilter: (filterId) => set({
        selectedFilter: filterId
    }),

    isMirrored: false,

    setIsMirrored: (mirror) => set({
        isMirrored: mirror
    })
}))

// ================================
// Camera Store
// ================================
interface CameraState {
    cameras: CameraDevice[]
    selectedCamera: CameraDevice | null
    isConnected: boolean
    isCapturing: boolean
    setCameras: (cameras: CameraDevice[]) => void
    selectCamera: (camera: CameraDevice | null) => void
    setConnected: (connected: boolean) => void
    setCapturing: (capturing: boolean) => void
}

export const useCameraStore = create<CameraState>((set) => ({
    cameras: [],
    selectedCamera: null,
    isConnected: false,
    isCapturing: false,

    setCameras: (cameras) => set({ cameras }),
    selectCamera: (camera) => set({ selectedCamera: camera }),
    setConnected: (connected) => set({ isConnected: connected }),
    setCapturing: (capturing) => set({ isCapturing: capturing })
}))

// ================================
// Filter Store
// ================================
interface FilterState {
    filters: LUTFilter[]
    activeFilter: LUTFilter | null
    addFilter: (filter: Omit<LUTFilter, 'id'>) => string
    removeFilter: (id: string) => void
    setActiveFilter: (id: string | null) => void
}

export const useFilterStore = create<FilterState>()(
    persist(
        (set, get) => ({
            filters: [],
            activeFilter: null,

            addFilter: (filter) => {
                const id = uuidv4()
                set((state) => ({
                    filters: [...state.filters, { ...filter, id }]
                }))
                return id
            },

            removeFilter: (id) => set((state) => ({
                filters: state.filters.filter(f => f.id !== id),
                activeFilter: state.activeFilter?.id === id ? null : state.activeFilter
            })),

            setActiveFilter: (id) => {
                const filter = id ? get().filters.find(f => f.id === id) : null
                set({ activeFilter: filter || null })
            }
        }),
        { name: 'sebooth-filters' }
    )
)

// ================================
// Queue Store
// ================================
interface QueueState {
    isPolling: boolean
    isConnected: boolean
    queueStatus: QueueStatusResponse | null
    currentTicket: QueueTicket | null
    connectionError: string | null
    activeTicketNumber: number | null
    activeTicketId: string | null

    setPolling: (polling: boolean) => void
    setConnected: (connected: boolean) => void
    setQueueStatus: (status: QueueStatusResponse | null) => void
    setCurrentTicket: (ticket: QueueTicket | null) => void
    setConnectionError: (error: string | null) => void
    setActiveTicket: (ticketNumber: number | null, ticketId: string | null) => void
    reset: () => void
}

export const useQueueStore = create<QueueState>((set) => ({
    isPolling: false,
    isConnected: false,
    queueStatus: null,
    currentTicket: null,
    connectionError: null,
    activeTicketNumber: null,
    activeTicketId: null,

    setPolling: (polling) => set({ isPolling: polling }),
    setConnected: (connected) => set({ isConnected: connected }),
    setQueueStatus: (status) => set({
        queueStatus: status,
        currentTicket: status?.currentTicket || null
    }),
    setCurrentTicket: (ticket) => set({ currentTicket: ticket }),
    setConnectionError: (error) => set({ connectionError: error }),
    setActiveTicket: (ticketNumber, ticketId) => set({
        activeTicketNumber: ticketNumber,
        activeTicketId: ticketId
    }),
    reset: () => set({
        isPolling: false,
        isConnected: false,
        queueStatus: null,
        currentTicket: null,
        connectionError: null,
        activeTicketNumber: null,
        activeTicketId: null
    })
}))
