import express from 'express'
import cors from 'cors'
import { app } from 'electron'
import { join, basename } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { networkInterfaces } from 'os'
import { printerHandler } from './handlers/PrinterHandler'
import { configService } from './services/ConfigService'

let serverInstance: any = null

export function startLocalServer(port = 5050) {
    if (serverInstance) return

    const server = express()
    server.use(cors())
    server.use(express.json()) // To parse POST bodies

    const documentsPath = app.getPath('documents')
    const sessionsDir = join(documentsPath, 'Sebooth', 'Sessions')

    // Serve static files directly from the Sessions folder
    // E.g., http://<ip>:5050/Session_uuid/photo_1.jpg
    server.use(express.static(sessionsDir))
    
    // Serve the React Admin Dashboard (Vite Build) statically
    server.use(express.static(join(__dirname, '../renderer')))

    // Endpoint for serving Canon DSLR Live View frames from temp directory
    server.get('/api/camera/liveview', (req, res) => {
        const liveViewPath = join(app.getPath('userData'), 'temp', 'edsdk_liveview.jpg')
        if (existsSync(liveViewPath)) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
            res.sendFile(liveViewPath)
        } else {
            res.status(404).send('No live view frame available')
        }
    })

    // Helper: find session folder by sessionId (supports both Session_<id> and Session_<email>_<id>)
    function findSessionFolder(sessionId: string): string | null {
        // Try exact match first
        const exactPath = join(sessionsDir, `Session_${sessionId}`)
        if (existsSync(exactPath)) return exactPath

        // Scan for folder ending with the sessionId
        if (existsSync(sessionsDir)) {
            const folders = readdirSync(sessionsDir)
            const match = folders.find(f => f.startsWith('Session_') && f.endsWith(sessionId))
            if (match) return join(sessionsDir, match)
        }
        return null
    }

    // Dynamic Gallery Route
    server.get('/gallery/:sessionId', (req, res) => {
        const { sessionId } = req.params
        const sessionPath = findSessionFolder(sessionId)

        if (!sessionPath) {
            return res.status(404).send('Gallery not found or session does not exist.')
        }

        try {
            const folderName = basename(sessionPath)
            const files = readdirSync(sessionPath)

            const photoStrip = files.find(f => f.startsWith('strip_'))
            const gif = files.find(f => f.startsWith('gif_'))
            const video = files.find(f => f.startsWith('live_video_'))
            const photos = files.filter(f => f.startsWith('photo_'))

            // Generate beautifully styled mobile-first HTML Gallery
            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Photobooth Gallery</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background-color: #f3f4f6; 
            color: #1f2937;
            text-align: center;
        }
        .container { max-width: 500px; margin: 0 auto; }
        h1 { font-size: 24px; margin-bottom: 24px; font-weight: 700; }
        .card { 
            background: white; 
            border-radius: 16px; 
            padding: 16px; 
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); 
            margin-bottom: 24px;
        }
        img, video { 
            width: 100%; 
            border-radius: 8px; 
            background: #e5e7eb;
            display: block; 
            margin-bottom: 12px;
        }
        .btn { 
            display: block; 
            width: 100%; 
            padding: 12px; 
            background: #000; 
            color: white; 
            border: none; 
            border-radius: 8px; 
            font-size: 16px; 
            font-weight: 600;
            text-decoration: none;
            box-sizing: border-box;
            cursor: pointer;
        }
        .header-text { margin-bottom: 10px; font-weight: 600; text-align: left; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📸 Your Memories</h1>
        
        ${video ? `
        <div class="card">
            <div class="header-text">Live Photo Strip</div>
            <video src="/${folderName}/${video}" autoplay loop muted playsinline controls></video>
            <a href="/${folderName}/${video}" download="${video}" class="btn">Download Video</a>
        </div>
        ` : ''}

        ${photoStrip ? `
        <div class="card">
            <div class="header-text">Photo Strip</div>
            <img src="/${folderName}/${photoStrip}" alt="Photo Strip" />
            <a href="/${folderName}/${photoStrip}" download="${photoStrip}" class="btn">Download Strip</a>
        </div>
        ` : ''}

        ${gif ? `
        <div class="card">
            <div class="header-text">Animated GIF</div>
            <img src="/${folderName}/${gif}" alt="GIF" />
            <a href="/${folderName}/${gif}" download="${gif}" class="btn">Download GIF</a>
        </div>
        ` : ''}

        ${photos.length > 0 ? `
        <div class="card">
            <div class="header-text">Individual Shots</div>
            <div class="grid">
                ${photos.map(p => `
                <div>
                    <img src="/${folderName}/${p}" alt="Photo" />
                    <a href="/${folderName}/${p}" download="${p}" class="btn" style="font-size: 14px; padding: 8px;">Download</a>
                </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
            Thank you for using Sebooth!
        </p>
    </div>
</body>
</html>`

            res.send(html)

        } catch (err) {
            console.error('Error reading session directory:', err)
            res.status(500).send('Internal Server Error')
        }
    })

    // --- Admin Dashboard API & Routes ---

    // 1. API to list all local sessions
    server.get('/api/sessions', (req, res) => {
        try {
            if (!existsSync(sessionsDir)) {
                return res.json([])
            }

            const folders = readdirSync(sessionsDir)
            const sessions: any[] = []

            for (const folder of folders) {
                if (folder.startsWith('Session_')) {
                    // Extract session UUID (last segment after final underscore group)
                    // Format: Session_<id> or Session_<email>_<id>
                    const parts = folder.replace('Session_', '')
                    // The sessionId is a UUID, so find it by splitting and taking the UUID-shaped part
                    const sessionId = parts
                    const sessionPath = join(sessionsDir, folder)

                    const stat = statSync(sessionPath)
                    const files = readdirSync(sessionPath)

                    const photoStrip = files.find(f => f.startsWith('strip_'))
                    const gif = files.find(f => f.startsWith('gif_'))
                    const video = files.find(f => f.startsWith('live_video_'))
                    const photos = files.filter(f => f.startsWith('photo_'))

                    sessions.push({
                        id: sessionId,
                        folderName: folder,
                        date: stat.birthtime,
                        files: {
                            photoStrip,
                            gif,
                            video,
                            photos
                        }
                    })
                }
            }

            // Sort newest first
            sessions.sort((a, b) => b.date.getTime() - a.date.getTime())

            res.json(sessions)

        } catch (error) {
            console.error('Failed to list sessions API:', error)
            res.status(500).json({ error: 'Failed to fetch sessions' })
        }
    })

    // 1b. Config APIs (Phase 1 Remote Control)
    server.get('/api/config', (req, res) => {
        res.json(configService.getConfig())
    })

    server.post('/api/config', (req, res) => {
        try {
            const newConfig = configService.updateConfig(req.body)
            res.json({ success: true, config: newConfig })
        } catch (e) {
            res.status(500).json({ error: 'Failed to update config' })
        }
    })

    // 2. API to get print queue & history
    server.get('/api/print/queue', (req, res) => {
        try {
            const { printQueueService } = require('./services/PrintQueueService')
            res.json(printQueueService.getQueue())
        } catch (e) {
            res.status(500).json({ error: 'Failed' })
        }
    })

    server.get('/api/print/history', (req, res) => {
        try {
            const { printQueueService } = require('./services/PrintQueueService')
            res.json(printQueueService.getHistory())
        } catch (e) {
            res.status(500).json({ error: 'Failed' })
        }
    })

    // 3. API to trigger remote print
    server.post('/api/print/:sessionId', async (req, res) => {
        const { sessionId } = req.params
        const sessionPath = findSessionFolder(sessionId)

        if (!sessionPath) {
            return res.status(404).json({ error: 'Session not found' })
        }

        try {
            const files = readdirSync(sessionPath)
            const photoStrip = files.find(f => f.startsWith('strip_'))

            if (!photoStrip) {
                return res.status(404).json({ error: 'No photo strip found for this session to print.' })
            }

            const stripPath = join(sessionPath, photoStrip)
            
            // Send into queue service
            const { printQueueService } = require('./services/PrintQueueService')
            printQueueService.addJob(sessionId, stripPath, 'Print to PDF', 1)

            // Immediately return success
            res.json({ success: true, message: 'Print job queued in the background!' })

        } catch (error) {
            console.error('Print trigger error:', error)
            res.status(500).json({ error: 'Internal system error during print trigger' })
        }
    })

    // 3. Admin Monitor UI Web Interface
    server.get('/monitor', (req, res) => {
        const adminHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sebooth Admin Monitor</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background-color: #111827; 
            color: #f9fafb;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #374151; }
        h1 { font-size: 24px; font-weight: 700; margin: 0; }
        .refresh-btn { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
        .card { background: #1f2937; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.5); display: flex; flex-direction: column; }
        .card-img { width: 100%; height: 280px; object-fit: contain; background: #000; display: block; }
        .card-body { padding: 16px; flex-grow: 1; display: flex; flex-direction: column; }
        .session-id { font-size: 12px; color: #9ca3af; margin-bottom: 4px; font-family: monospace; word-break: break-all; }
        .session-time { font-size: 14px; font-weight: 600; margin-bottom: 16px; color: #e5e7eb; }
        .print-btn { background: #10b981; color: white; border: none; padding: 10px; border-radius: 6px; width: 100%; font-weight: bold; cursor: pointer; margin-top: auto; }
        .print-btn:hover { background: #059669; }
        .print-btn:disabled { background: #4b5563; cursor: not-allowed; }
        .no-data { text-align: center; padding: 40px; color: #9ca3af; grid-column: 1 / -1; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚙️ Live Admin Monitor</h1>
            <button class="refresh-btn" onclick="fetchSessions()">Refresh</button>
        </div>
        <div id="sessionsGrid" class="grid">
            <div class="no-data">Loading sessions...</div>
        </div>
    </div>

    <script>
        async function fetchSessions() {
            const grid = document.getElementById('sessionsGrid');
            try {
                grid.innerHTML = '<div class="no-data">Loading...</div>';
                const res = await fetch('/api/sessions');
                const sessions = await res.json();
                
                if (sessions.length === 0) {
                    grid.innerHTML = '<div class="no-data">No sessions found yet. Take some photos!</div>';
                    return;
                }

                grid.innerHTML = sessions.map(session => {
                    const date = new Date(session.date).toLocaleString('id-ID');
                    let imgHtml = '<div style="height:280px;display:flex;align-items:center;justify-content:center;background:#000;color:#6b7280;font-size:12px;">No Strip</div>';
                    
                    if (session.files.photoStrip) {
                        imgHtml = '<img src="/' + session.folderName + '/' + session.files.photoStrip + '" class="card-img" alt="Strip">';
                    }

                    return '<div class="card">' +
                            imgHtml +
                            '<div class="card-body">' +
                                '<div class="session-id">ID: ' + session.id.substring(0,8) + '...</div>' +
                                '<div class="session-time">⏰ ' + date + '</div>' +
                                '<button class="print-btn" onclick="printSession(\\'' + session.id + '\\', this)" ' + (!session.files.photoStrip ? 'disabled' : '') + '>' +
                                    '🖨️ Print Remote' +
                                '</button>' +
                            '</div>' +
                        '</div>';
                }).join('');
            } catch (err) {
                grid.innerHTML = '<div class="no-data" style="color:#ef4444;">Failed to load sessions. Ensure server is running.</div>';
            }
        }

        async function printSession(sessionId, btnNode) {
            const originalText = btnNode.innerHTML;
            btnNode.innerHTML = 'Printing...';
            btnNode.disabled = true;

            try {
                const res = await fetch('/api/print/' + sessionId, { method: 'POST' });
                const json = await res.json();
                
                if(json.success) {
                    btnNode.style.background = '#3b82f6';
                    btnNode.innerHTML = '✅ Sent to Printer';
                    setTimeout(() => {
                        btnNode.style.background = '#10b981';
                        btnNode.innerHTML = originalText;
                        btnNode.disabled = false;
                    }, 2000);
                } else {
                    alert('Print Error: ' + json.error);
                    btnNode.innerHTML = originalText;
                    btnNode.disabled = false;
                }
            } catch (e) {
                alert('Failed to connect to printer API.');
                btnNode.innerHTML = originalText;
                btnNode.disabled = false;
            }
        }

        // Auto-refresh every 10 seconds
        fetchSessions();
        setInterval(fetchSessions, 10000);
    </script>
</body>
</html>
        `;
        res.send(adminHtml)
    })

    serverInstance = server.listen(port, () => {
        console.log(`Local Sharing Server & Admin API running on port ${port}`)
    })
}

export function getLocalIpAddress(): string | null {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]!) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address
            }
        }
    }
    return null
}
