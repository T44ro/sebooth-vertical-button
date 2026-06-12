# Prompt: Integrasi Webhook Photobooth ↔ Website Queue System

## Context

Aplikasi photobooth desktop ini perlu diintegrasikan dengan website **Sebooth** (https://www.sebooth.in) yang sudah memiliki sistem antrean digital. Website sudah menyediakan beberapa API endpoint yang siap digunakan.

### Arsitektur Saat Ini (Website Side — Sudah Siap)

Website sudah memiliki endpoint-endpoint berikut:

#### 1. **POST `/api/queue/webhook`**
Endpoint utama untuk menerima event dari aplikasi photobooth.

**Headers:**
```
Content-Type: application/json
x-webhook-secret: <QUEUE_WEBHOOK_SECRET>
```

**Request Body:**
```json
{
  "event": "session_started" | "session_completed",
  "event_id": "<queue_events.id>",
  "ticket_number": <nomor antrean yang sedang dipanggil>,
  "session_id": "<sessions.id>"  // opsional, hanya untuk session_completed
}
```

**Response (session_completed):**
```json
{
  "success": true,
  "ticketId": "uuid",
  "updatedStatus": "completed",
  "nextTicketNumber": 5,           // nomor antrean berikutnya (atau null jika habis)
  "autoCalledNext": true            // website otomatis memanggil user berikutnya
}
```

**Behavior:**
- `session_started` → Mengubah status tiket menjadi `in_session`
- `session_completed` → Mengubah status tiket menjadi `completed`, **otomatis memanggil antrean berikutnya** (auto-advance), mengirim push notification "GILIRAN KAMU! 🔴" ke HP user berikutnya, dan mengirim proximity push ke user yang posisinya mendekat

#### 2. **POST `/api/queue/generate-session-token`**
Menghasilkan token QR yang time-limited (10 menit expiry). User scan QR ini di HP mereka untuk menghubungkan sesi foto ke akun mereka.

**Headers:**
```
Content-Type: application/json
x-webhook-secret: <QUEUE_WEBHOOK_SECRET>
```

**Request Body:**
```json
{
  "event_id": "<queue_events.id>",
  "session_id": "<sessions.id>"
}
```

**Response:**
```json
{
  "success": true,
  "token": "base64url-encoded-token",
  "qrUrl": "https://www.sebooth.in/api/queue/link-session?token=<token>",
  "expiresAt": "2026-06-12T09:20:00.000Z"
}
```

#### 3. **GET `/api/queue/{eventId}/status`**
Mengambil status antrean real-time (siapa yang sedang dipanggil, siapa yang menunggu, dll).

**Response:**
```json
{
  "event": { "id": "...", "name": "...", "booth_name": "..." },
  "currentTicket": { "id": "...", "queue_number": 3, "display_name": "John", "status": "called" },
  "waitingTickets": [...],
  "totalWaiting": 12,
  "avgDurationSec": 480
}
```

---

## Yang Harus Di-develop di Aplikasi Photobooth

### Flow Lengkap yang Diinginkan:

```
1. Aplikasi photobooth IDLE (menunggu giliran)
   └─ Polling GET /api/queue/{eventId}/status setiap 5 detik
   └─ Menampilkan "Menunggu antrean berikutnya..." di layar

2. Website memanggil user berikutnya (status tiket = "called")
   └─ Aplikasi mendeteksi ada tiket dengan status "called"
   └─ Layar menampilkan: "NOMOR ANTREAN #003 — SILAKAN MENUJU BOOTH"
   └─ Menunggu user datang ke booth (timeout 5 menit)

3. User tiba di booth → Operator/user menekan tombol "Mulai Sesi"
   └─ Aplikasi POST /api/queue/webhook { event: "session_started", ... }
   └─ Aplikasi POST /api/queue/generate-session-token → dapat QR token
   └─ Layar menampilkan QR Code besar di layar booth
   └─ Teks: "SCAN QR INI DENGAN HP KAMU UNTUK MENGHUBUNGKAN FOTO 📸"
   └─ User scan QR dengan HP → foto otomatis masuk ke akun mereka

4. Sesi foto berjalan
   └─ QR Code bisa ditutup setelah di-scan atau timeout 60 detik
   └─ Proses foto normal berjalan

5. Sesi foto selesai
   └─ Aplikasi POST /api/queue/webhook { event: "session_completed", session_id: "..." }
   └─ Website otomatis memanggil user berikutnya + kirim push notification
   └─ Aplikasi kembali ke langkah 1 (IDLE)
```

### Konfigurasi yang Dibutuhkan di Aplikasi:
- `SEBOOTH_API_URL` = `https://www.sebooth.in`
- `QUEUE_WEBHOOK_SECRET` = `sebooth-queue-webhook-2026` (harus sama dengan yang di website)
- `QUEUE_EVENT_ID` = UUID dari event antrean yang aktif (bisa di-set manual atau dipilih dari daftar event)

---

## Instruksi untuk AI Agent

### CRITICAL RULES:
1. **Buatkan implementation plan** dengan fase-fase update bertahap sebelum mulai coding. Minta approval dari saya sebelum mulai mengerjakan setiap fase.
2. **Update `agents.md`** secara otomatis setiap kali satu fase selesai dikerjakan. Pastikan agents.md selalu menjadi single source of truth untuk status proyek.
3. Setiap fase harus bisa di-test secara independen.

### Fase yang Disarankan:

**Fase 1 — Polling & Deteksi Giliran**
- Implementasi polling ke `/api/queue/{eventId}/status` setiap 5 detik
- Deteksi ketika ada tiket dengan status `called`
- Tampilkan informasi antrean di layar (nomor, nama user)
- Tampilkan layar IDLE ketika tidak ada antrean

**Fase 2 — Webhook Session Started & QR Code Display**
- Ketika sesi dimulai, POST `session_started` ke webhook
- Request session token dari `/api/queue/generate-session-token`
- Generate dan tampilkan QR Code besar di layar booth dari `qrUrl` yang diterima
- QR auto-dismiss setelah 60 detik atau setelah di-scan

**Fase 3 — Webhook Session Completed & Auto-cycle**
- Ketika sesi foto selesai, POST `session_completed` ke webhook (sertakan `session_id`)
- Parse response untuk mendapat `nextTicketNumber` dan `autoCalledNext`
- Otomatis cycle kembali ke layar IDLE → deteksi giliran berikutnya
- Handle edge case: tidak ada antrean lagi (`nextTicketNumber: null`)

**Fase 4 — Error Handling & Resilience**
- Retry logic untuk semua API calls (max 3 retries, exponential backoff)
- Offline mode: jika koneksi terputus, tampilkan warning tapi tetap bisa foto
- Logging untuk semua webhook calls (request + response)
- Timeout handling untuk tiket yang expired (5 menit tidak datang)

### Format agents.md Update:
Setiap fase selesai, tambahkan entry di bagian Changelog `agents.md` dengan format:
```
- **Juni 2026 (Fase X - Nama Fase)** ✅: Deskripsi singkat perubahan. Key features: (1) ...; (2) ...; (3) ...
```
