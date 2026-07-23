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

export interface CameraSettings {
    iso?: string
    aperture?: string
    shutterSpeed?: string
    whiteBalance?: string
}

export interface CameraPropertyValues {
    current: string
    available: string[]
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

// Single Button Indicator Item Configuration
export interface ButtonIndicatorItem {
    id: string
    enabled?: boolean
    text?: string
    x?: number // position X in % (0 - 100)
    y?: number // position Y in % (0 - 100)
    width?: number // width in px
    height?: number // height in px
    rotation?: number // angle in degrees (0 - 360)
    bgColor?: string
    textColor?: string
    borderColor?: string
    shape?: 'pill' | 'rectangle' | 'badge' | 'arrow-right' | 'arrow-left' | 'arrow-down' | 'arrow-up'
    pulse?: boolean
    fontSize?: number
}

// Page Button Indicator Configuration (Supports Multiple Indicators per Page)
export interface PageButtonIndicatorConfig {
    enabled?: boolean
    indicators?: ButtonIndicatorItem[] // Array of multiple indicators per page
    // Legacy single-indicator fallbacks
    text?: string
    x?: number
    y?: number
    width?: number
    height?: number
    rotation?: number
    bgColor?: string
    textColor?: string
    borderColor?: string
    shape?: 'pill' | 'rectangle' | 'badge' | 'arrow-right' | 'arrow-left' | 'arrow-down' | 'arrow-up'
    pulse?: boolean
    fontSize?: number
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
    cameraMode: 'mock' | 'dslr' | 'ptp' | 'edsdk' // Mock (webcam), DSLR (CLI), PTP (digiCamControl), or EDSDK (Canon native)
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
    cameraRotation?: 0 | 90 | 180 | 270 // Camera physical tilt/rotation angle (0, 90, 180, 270 deg)
    mirrorOutput: boolean // Toggle to mirror output by default

    // Custom Background Settings
    customBgLandscape?: string // File path to custom landscape background
    customBgPortrait?: string  // File path to custom portrait background
    customBgLandscapeType?: 'image' | 'video'
    customBgPortraitType?: 'image' | 'video'

    // Remote Printing (Double Device)
    printServerEnabled: boolean   // true = this device acts as a print server (accepts remote jobs)
    printClientEnabled: boolean   // true = this device sends print jobs to a remote print server
    printServerUrl: string        // URL of print server (e.g. "http://192.168.1.100:5050")
    deviceName: string            // Device identity name (e.g. "Booth A", "Booth B")

    // Camera Preview Adjustments
    cameraZoom?: number // DSLR Live View zoom level (1.0 to 2.0)
    cameraScaleX?: number // Custom horizontal scale
    cameraScaleY?: number // Custom vertical scale
    cameraOffsetX?: number // Custom X offset in px
    cameraOffsetY?: number // Custom Y offset in px


    // Physical Button Indicator Settings (Global & Per-Page Overrides)
    buttonIndicatorEnabled?: boolean
    buttonIndicatorText?: string
    buttonIndicatorX?: number // position X in % (0 - 100)
    buttonIndicatorY?: number // position Y in % (0 - 100)
    buttonIndicatorWidth?: number // width in px
    buttonIndicatorHeight?: number // height in px
    buttonIndicatorRotation?: number // angle in degrees (0 - 360)
    buttonIndicatorBgColor?: string
    buttonIndicatorTextColor?: string
    buttonIndicatorBorderColor?: string
    buttonIndicatorShape?: 'pill' | 'rectangle' | 'badge' | 'arrow-right' | 'arrow-left' | 'arrow-down' | 'arrow-up'
    buttonIndicatorPulse?: boolean
    buttonIndicatorFontSize?: number

    // Per-Page Button Indicators (independent configuration per page route)
    pageButtonIndicators?: Record<string, PageButtonIndicatorConfig>
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

declare global {
    interface Window {
        api: any
    }
}
