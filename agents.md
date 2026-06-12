# Sebooth - AI Agent Guidelines

Welcome AI Agent! This file (`agents.md`) provides critical context, architecture details, and development conventions for the **Sebooth** project. Please read and follow these guidelines when modifying or creating code in this repository.

## 1. Project Overview
**Sebooth** is divided into two distinct but interconnected systems: the **Desktop Photobooth Application** and the **External Website / Web Portal**.

### A. Desktop Photobooth Application (Electron + React)
The high-end main engine running on the local machine at events.
Key features include:
- **DSLR/Mirrorless Camera Integration**: via `digiCamControl` (PTP communication) managed directly in the main process.
- **Silent Printing**: Directly to connected printers without UI dialogs via `pdf-to-printer` and an integrated print queue.
- **Media Processing**: Generates static photo layouts (PNG/PDF), Boomerangs, GIFs, and applies live LUT filters via `sharp` and `fluent-ffmpeg`.
- **Cloud & Local Storage Hybrid**: Uses **Supabase** (Database/Logs) and **Google Cloud Storage / Google Drive** (Heavy Media Files) for syncing medias to the cloud.
- **Sharing Mechanism (QR Code)**: The app generates a QR Code that automatically directs the user to the *External Website*. (Note: Kami TIDAK menggunakan Webhook atau bot LINE untuk mekanisme ini).
- **Comprehensive Admin Panel**: A secure local dashboard for staff and owners to manage settings, adjust pricing, manage an Instagram Feed, and extract offline/online session logs directly to Excel (`.xlsx`). It also supports a super-admin hierarchy.

### B. External Website / Web Portal (Company Profile & Photo Claim)
The public-facing website on the internet, which users access either organically or via scanning the QR Code at the booth.
Key features include:
- **Company Profile**: The main landing pages showcasing Sebooth's portfolio, event packages, pricing, and services.
- **Photo Claim Mechanism**: When visitors scan their unique QR code from the Desktop Photobooth Application, they are redirected to a dynamic page on this website to view, download, and securely claim their photos and boomerangs from the cloud storage.
- **Inline Visual Editor**: A "Wix-like" live visual editor that allows Website Admins to click and edit textual content or layouts directly on the live website, which is instantly saved to the database.

---

## 2. Technology Stack

**1. Desktop Application (`sebooth`)**:
- **Core Framework**: Electron, React 18, Vite.
- **Language**: TypeScript (Strict typing preferred).
- **State & Routing**: Zustand & React Router DOM (v6).
- **Media Processing**: `fluent-ffmpeg`, `sharp`, `gifenc`, `pdf-lib`.
- **Hardware Integrations**: `pdf-to-printer` (Printing), `usb` (Device detection).
- **Backend APIs**: Express & Cors (For Local Area Network API / Admin Monitoring), Supabase (`@supabase/supabase-js`), Google APIs (`@google-cloud/storage`, `googleapis`).

**2. Website / Web Portal (`sebooth-gallery` / Web Repo)**:
- **Core Framework**: Web project for static QR code landing handling / Next.js / React frameworks.
- **Email Delivery**: Resend & Nodemailer (If emails are sent directly from the website).
- **Cloud/CDN Infrastructure Architecture**: 
  - **Supabase**: Relational metadata storage (Session UUIDs, timestamps).
  - **Google Cloud Storage (GCS)**: Scalable storage for heavy files (photos, videos, GIFs).
  - **Cloudflare**: DNS handling, CDN for GCS egress optimization, and optional WAF integration for Vercel/Website node.

---

## 3. Project Architecture

### Desktop Application System (`src/`)
The desktop codebase strictly adheres to secure Electron paradigms:
- **`src/main/`**: Electron Main Process. Handles heavy CPU tasks, hardware interactions (cameras, printers), and database connections. Included services like `ImageProcessor.ts`.
- **`src/main/ipc/`**: Inter-Process Communication endpoints (`camera.ipc.ts`, `printer.ipc.ts`, `cloud.ipc.ts`, etc.).
- **`src/preload/`**: Context Bridge to safely expose IPC handlers to the React frontend.
- **`src/renderer/`**: React Frontend. Handles the graphical interface, camera live view streams, user transitions, and the Internal Admin Dashboard.
- **`src/shared/`**: Contains shared DTOs and types for cross-boundary safety.

### Website / Gallery System
- **`sebooth-gallery/`**: A standalone Node project/directory designated for the photo claim landing pages and web assets. 

---

## 4. Development Rules & Conventions

### IPC Communication (Desktop Only)
- **DO NOT** expose raw `ipcRenderer` or Node.js built-ins directly to the React frontend.
- **ALWAYS** define IPC channels and payload types in `src/shared/`.
- **Cloud Integrations**: Operations requiring secret keys (GCP Service Accounts, Supabase keys) *must* happen strictly via the Main Process (`src/main/ipc`). The frontend only triggers the events.

### Performance & Threading
- **Heavy Processing in Main**: Any CPU-intensive task (applying LUT filters, PDFs, FFmpeg) MUST happen in the `main` process to prevent freezing the UI or blocking the capture flow.
- **Asynchronous Operations**: Use `async/await` for file system operations over synchronous forms (e.g. `fs.readFileSync`).

### Error Handling & Hardware
- **Hardware Stability**: DSLR logic and printer spooling are erratic. Implement detailed `try-catch` structures. Do not crash the app for a disconnected camera.
- **Logging**: Consistently log hardware events silently without interrupting the user.

### Aesthetic Principles
- **Modern & Dynamic**: Implement premium aesthetics using vibrant layouts, dark modes, and subtle micro-animations (utilizing `framer-motion`). Avoid generic design patterns.

---

## 5. Desktop Application Feature Flows (`src/renderer/pages/`)
The Desktop UI is modeled through the following key loops:
- **`Landing.tsx`**: The idle attract loop interface. Auto-redirects to QueueDisplay when Queue Mode is active.
- **`QueueDisplay.tsx`**: Queue system display page. Shows IDLE state (waiting for next ticket) or CALLED state (ticket number + "Mulai Sesi" button). Handles session_started webhook and QR code token display.
- **`PaymentGateway.tsx`**: Payment verification loop.
- **`FrameSelection.tsx`**: UI to choose custom layouts, photo counts, and print numbers.
- **`CaptureSession.tsx`**: The core component managing live DSLR viewfeeds and camera countdowns.
- **`ReviewSession.tsx`**: Post-processing UI allowing live LUT filter previews, pan/zoom crops, and retake decisions.
- **`OutputPage.tsx`**: Loading tracker that invokes the Main Process to bundle the final boomerangs, GIFs, and print PDFs.
- **`SharingPage.tsx`**: Explicitly displays the generated QR Code. Sends session_completed webhook when Queue Mode active.
- **`PrintingPage.tsx`**: Background page quietly forwarding the generated PDF strip to the printer queue. Auto-cycles to QueueDisplay when Queue Mode active.
- **`GalleryPage.tsx`**: Local viewer containing recent public prints.
- **`AdminDashboard.tsx`**: Secure local dashboard for configuration, analytics (`.xlsx` export), offline service health (`/monitor`), and Queue Integration settings.

---

## 6. AI Agent Continuous Updates & Changelog (CRITICAL RULE)
Starting from April 2026, the AI Agent MUST update this file continuously. Whenever a new prompt execution results in a structural change, new feature logic, architectural decision, or any system modification, the AI Agent **must append a log to this file** to ensure this documentation remains a living source of truth.

## 7. Cross-Workspace & Directory Access Rights
**CRITICAL RULE FOR AI AGENT:**
The AI Agent is explicitly authorized and encouraged to access, analyze, and modify files across multiple directories on this machine. If a task requires modifying both the Desktop App (`04_Sebooth`) and the Next.js Website (`06 Sebooth Proposal Company Profile\sebooth-website`), the AI Agent must proactively traverse between these paths without implicitly awaiting permission, ensuring an efficient, full-stack workflow.

---

### CHANGELOG
- **April 2026 (Architecture Finalization)**: Clarified Desktop vs. Website portal separation. Defined strict rule that the Sharing Mechanism uses QR Codes pointing to the Web Portal, not LINE Bot/Webhooks. Formalized the Enterprise Cloud Architecture: Deploy Next.js Web Portal on Vercel (custom domain via Hostinger), store session IDs strictly in Supabase, load heavy assets (Photos/GIFs/Videos) to Google Cloud Storage (GCS), and use Cloudflare as a proxy CDN for GCS to reduce egress billing.
- **April 2026 (Workflow Optimization)**: Added Cross-Workspace Access Rights. The AI Agent is now explicitly instructed to jump between the Desktop app (`04_Sebooth`) and Website (`sebooth-website`) directories to maintain efficiency. Restructuring into a single monorepo is NOT strictly necessary.
- **April 2026 (Phase 1: Enterprise Hardening)**: Executed Phase 1 for the Desktop App. Implemented `UploadQueueService` bridging `cloud.ipc.ts` to retry GCS uploads if offline. Created `JanitorService` to auto-sweep temp caches older than 3 days. Hardened `src/main/index.ts` with global safeguards preventing entire application crashes due to unexpected Electron hardware/USB events.
- **April 2026 (Dashboard Quality of Life UX)**: Fixed Admin Dashboard confusion where users thought settings required clicking "Set As Active" (which was actually only for template frames). Pushed the button strictly to the Frames tab and added an Auto-Save indicator globally. Added a new "Cloud Queue" tab so admins can monitor pending offline background uploads natively within the Desktop UI.
- **April 2026 (Phase 1.5: Remote Web-Admin Architecture)**: Redesigned the operator flow from a monolithic Electron constraint into a distributed architecture ("Mesin Kolong"). Extracted Zustand local-storage configurations into a central Node.js `ConfigService`. Transformed `src/main/server.ts` Express bridge to not only serve local Photo Galleries, but to natively serve the Vite-React app itself over `localhost:5050`. Introduced Isomorphic `apiHelper` so the same React Dashboard code can run on a browser (`fetch`) or inside Electron (`ipcRenderer`) without crashing. Repaired slow Remote Printing by converting synchronous spooling to a non-blocking background queue.
- **April 2026 (Print Queue Architecture)**: Centralized physical dye-sublimation print jobs into `src/main/services/PrintQueueService.ts`. Replaced raw PowerShell Fire-and-Forget promises with strict sequential queueing to prevent hardware spooler hangs. Print History is now durably persisted to `userData/sebooth_print_history.json`. Exposed endpoints `GET /api/print/queue` bridging real-time status arrays to the connected Admin iPads/Phones.
- **April 2026 (Admin UI Overhaul)**: Solved widespread dead font-color contrasts by enforcing CSS Scoped Variables for Dark Mode (`--color-bg-primary: #111827`) isolated directly to the `.container` in `AdminDashboard.module.css`. This prevents the global `global.css` "Cream Light Mode" Kiosk properties from bleeding into the Admin settings panel ever again.
- **April 2026 (ReviewSession Photo Loading Fix)**: Fixed issue where photos failed to load in ReviewSession due to incorrect slotId handling for duplicate slots. Updated all photo operations (zoom, pan, retake, filter preview) to use sourceSlotId (resolving duplicateOfSlotId) instead of physical slotId. Added debug logging to help diagnose frame and photo state issues.
- **April 2026 (Print Quantity Selection)**: Added PrintQuantityModal component to SharingPage allowing users to select print quantity in multiples of 2 before printing. Modal displays "Mau cetak berapa foto? Kita pakai kelipatan 2 yaa" with increment/decrement buttons. Updated PrintingPage to accept quantity from navigation state instead of hardcoded value. Print copies calculated as Math.max(1, Math.round(quantity / 2)).
- **April 2026 (PrintingPage CompositePath Fix)**: Fixed PrintingPage compositePath access issue where compositePath was undefined despite being stored in currentSession. Updated to use currentSession?.compositePath instead of separate compositePath property from store destructuring.
- **April 2026 (Print Base64 Data Handler)**: Updated printer IPC handler and preload to accept base64 image data directly from PrintingPage instead of file paths. Modified `printer:print-with-options` to save base64 data to temporary JPG file before queuing print job. This fixes blank print issue by ensuring composite image data is properly processed through the print pipeline.
- **April 2026 (PrintingPage Remount Fix)**: Fixed issue where PrintingPage component remounted after successful printing, causing navigation home due to null session. Added `printCompleted` state to prevent premature navigation when printing succeeds, ensuring stable post-print behavior.
- **April 2026 (SessionTimer Size Reduction)**: Reduced the SessionTimer size and centered it at the top of the screen. Decreased padding from 12px 24px to 8px 16px, reduced font sizes (label from 14px to 12px, value from 24px to 18px), and decreased gap from 12px to 8px for a more compact appearance.
- **Juni 2026 (Fase 1 - Polling & Deteksi Giliran)** ✅: Implemented full Queue System integration with website Sebooth (sebooth.in). Key features: (1) `QueueService.ts` in Main Process handles 5-second polling to `GET /api/queue/{eventId}/status`, with retry logic and exponential backoff; (2) `queue.ipc.ts` IPC handlers bridge Main↔Renderer securely via preload context bridge; (3) `QueueDisplay.tsx` page replaces Landing when Queue Mode active, showing IDLE state (waiting animation + stats) and CALLED state (ticket number + countdown); (4) `useQueueStore` Zustand store manages queue state; (5) Admin Dashboard "Queue Integration" tab with toggle, API URL, Event ID, and Webhook Secret inputs.
- **Juni 2026 (Fase 2 - Webhook Session Started & QR Code Display)** ✅: When operator presses "Mulai Sesi" on QueueDisplay, the app: (1) POSTs `session_started` webhook to `/api/queue/webhook`; (2) Requests session token from `/api/queue/generate-session-token`; (3) Displays full-screen QR Code overlay from `qrUrl` with 60-second auto-dismiss countdown; (4) QR allows users to scan and link their phone to the booth session. Includes "Lanjutkan Tanpa Scan" skip button.
- **Juni 2026 (Fase 3 - Webhook Session Completed & Auto-cycle)** ✅: On session end (SharingPage or PrintingPage), the app: (1) POSTs `session_completed` webhook with `session_id` to `/api/queue/webhook`; (2) Website auto-advances to next ticket and sends push notification; (3) App navigates back to `/queue` (not `/`) to restart the cycle. Both SharingPage and PrintingPage patched to support queue-aware navigation.
- **Juni 2026 (Fase 4 - Error Handling & Resilience)** ✅: Implemented: (1) Retry logic with exponential backoff (1s→2s→4s, max 3 retries) for all webhook/token API calls; (2) Connection status banner (green=connected, red=disconnected with warning pulse); (3) 5-minute ticket timeout on CALLED state with progress bar; (4) "Mulai Tanpa Antrean" fallback button when offline; (5) Consecutive failure tracking in QueueService.
- **Juni 2026 (Fase 5 - Queue Session Linking RLS Fix)** ?: Fixed a critical logic and Row Level Security (RLS) bug on the website's /api/queue/link-session endpoint. Previously, the website failed to link sessions when users scanned the QR code because: 1) The ticket status was already changed to 'in_session' by the webhook, so the query ignored it. 2) The generic Supabase client lacked authentication cookies, causing RLS to block reading the ticket entirely. Solved by allowing 'in_session' status and using createServerClient with the user's cookies to authenticate the Supabase request.
- **Juni 2026 (Fase 5 - Queue Session Linking FK Fix)** ?: Fixed a 500 Error when linking session via QR. The link-session API tried to update queue_tickets.session_id to the photobooth's sessionId, but the session row hasn't been synced to Supabase yet because the user is still taking photos. This caused a Foreign Key constraint violation. Fixed by removing the premature session_id update. The session is safely linked later by the session_completed webhook.
- **Juni 2026 (Fase 6 - Auto-Call Queue Fix)** ?: Fixed a bug where a new queue ticket remained in 'waiting' status indefinitely if the booth was idle. Modified joinQueue logic in the Next.js website to automatically assign the 'called' status (and broadcast via SSE) if no other ticket is currently called or in session. This eliminates the need for manual admin operator intervention when the booth queue is empty.
