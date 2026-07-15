// =====================
// Shared Types for Sebooth Photobooth Application
// =====================

// Camera Types
export interface CameraDevice {
    id: string
    name: string
    port: string
    connected: boolean
}

export interface CaptureResult {
    success: boolean
    imagePath?: string
    error?: string
    timestamp: number
}

export interface CameraHandler {
    listCameras(): Promise<CameraDevice[]>
    connect(cameraId: string): Promise<boolean>
    disconnect(): Promise<void>
    capture(outputPath: string): Promise<CaptureResult>
    isConnected(): boolean
}

// Printer Types
export interface PrinterDevice {
    name: string
    isDefault: boolean
}

export interface PrintResult {
    success: boolean
    error?: string
}

// Frame & Photo Slot Types
export interface PhotoSlot {
    id: string
    x: number
    y: number
    width: number
    height: number
    rotation: number
    duplicateOfSlotId?: string  // If set, this slot uses the same photo as the referenced slot
}

export interface QRSlot {
    id: string
    x: number
    y: number
    width: number
    height: number
    enabled: boolean
}

export interface FrameConfig {
    id: string
    name: string
    overlayPath: string
    slots: PhotoSlot[]
    canvasWidth: number
    canvasHeight: number
    qrSlot?: QRSlot
    qrSlots?: QRSlot[]
}

// Session Types
export interface CapturedPhoto {
    slotId: string
    imagePath: string
    timestamp: number
    filter?: string
    videoPath?: string  // 5-second video before capture for Live Photo
    
    // Review Session Adjustments
    scale?: number
    panX?: number
    panY?: number
}

export interface SessionData {
    id: string
    frameId: string
    photos: CapturedPhoto[]
    email?: string
    createdAt: number
    compositePath?: string
    cloudSessionId?: string
}

export interface SetupConfig {
    supabaseUrl: string
    supabaseAnonKey: string
    driveFolderId?: string
    emailService?: string
}

// Config Types
export interface AppConfig {
    countdownDuration: number // seconds
    previewDuration: number // seconds
    sessionTimeout: number // seconds (legacy, kept for compatibility)
    activeFrameIds: string[]  // Multiple frames can be active
    timerEnabled: boolean // Enable/disable countdown timer

    // Printer
    printerEnabled: boolean // Enable/disable auto printing
    printerName: string // Selected printer name

    // Per-session timeouts
    frameSelectionTimeout: number // seconds - timeout for frame selection page
    captureTimeout: number // seconds - timeout for capture session
    postProcessingTimeout: number // seconds - timeout for post processing
    sessionTimerEnabled: boolean // Enable/disable per-session timers
    // Payment Gateway
    paymentEnabled: boolean // Enable/disable payment before capture
    paymentGateway: 'midtrans' | 'doku' // Selected payment gateway
    sessionPrice: number // Base price for 1 session (includes 1 4R print)
    additionalPrintPrice: number // Price per 2 additional prints
    midtransClientKey: string // Midtrans client key for QRIS
    midtransServerKey: string // Midtrans server key for API
    dokuClientId: string // Doku client ID for Checkout API
    dokuSecretKey: string // Doku secret key for signature calculation
    dokuSandbox: boolean // Enable Sandbox Mode for Doku
    paymentInstructions: string // Payment instructions displayed to user
    paymentTimeout: number // seconds - timeout for payment page

    // Camera
    cameraMode: 'mock' | 'dslr' | 'ptp' // Mock (webcam), DSLR (CLI), or PTP (Direct)
    selectedCameraId?: string // Device ID for USB capture card / specific webcam

    // Sharing
    sharingMode: 'cloud' | 'local' // Cloud (Drive/Supabase) or Local WiFi (DSLRBooth mode)
    cloudPortalUrl: string
    wifiSsid?: string
    wifiPassword?: string
    eventName?: string
    activeFrameId?: string // Legacy support

    // Queue Integration
    queueEnabled: boolean // Toggle Queue Mode
    queueEventId: string // UUID of the active queue event
    queueWebhookSecret: string // Shared secret for webhook auth
    queueApiUrl: string // Base URL of the website (e.g. https://www.sebooth.in)

    // Layout Settings
    appOrientation: 'landscape' | 'portrait' // Screen/App layout orientation
    mirrorOutput: boolean // Toggle to mirror output by default

    // Custom Background Settings
    customBgLandscape?: string // File path to custom landscape background
    customBgPortrait?: string  // File path to custom portrait background
    customBgLandscapeType?: 'image' | 'video'
    customBgPortraitType?: 'image' | 'video'
}

export interface LUTFilter {
    id: string
    name: string
    cubePath: string
    previewPath?: string
}

// Admin Types
export interface AdminCredentials {
    password: string
}

// IPC Channel Types
export type CameraIPCChannels =
    | 'camera:list'
    | 'camera:connect'
    | 'camera:disconnect'
    | 'camera:capture'
    | 'camera:status'

export type PrinterIPCChannels =
    | 'printer:list'
    | 'printer:print'
    | 'printer:status'

export type SystemIPCChannels =
    | 'system:open-file-dialog'
    | 'system:get-temp-path'
    | 'system:save-file'
    | 'system:generate-hq-gif'

export type ImageIPCChannels =
    | 'image:composite'
    | 'image:apply-filter'
    | 'image:generate-gif'

// Supabase Types
export interface SessionLog {
    id?: string
    email: string
    photo_url: string
    created_at?: string
    metadata?: Record<string, unknown>
}

export interface ConfigRecord {
    id?: string
    key: string
    value: Record<string, unknown>
    updated_at?: string
}

// =====================
// Queue System Types
// =====================

export interface QueueTicket {
    id: string
    queue_number: number
    display_name: string
    status: 'waiting' | 'called' | 'in_session' | 'completed' | 'skipped'
    expires_at?: string
}

export interface QueueEvent {
    id: string
    name: string
    booth_name: string
}

export interface QueueStatusResponse {
    event: QueueEvent
    currentTicket: QueueTicket | null
    waitingTickets: QueueTicket[]
    totalWaiting: number
    avgDurationSec: number
}

export interface QueueWebhookPayload {
    event: 'session_started' | 'session_completed'
    event_id: string
    ticket_number: number
    session_id?: string
}

export interface QueueWebhookResponse {
    success: boolean
    ticketId?: string
    updatedStatus?: string
    nextTicketNumber?: number | null
    autoCalledNext?: boolean
}

export interface QueueSessionTokenResponse {
    success: boolean
    token: string
    qrUrl: string
    expiresAt: string
}

// API Response Types
export interface APIResponse<T> {
    success: boolean
    data?: T
    error?: string
}
