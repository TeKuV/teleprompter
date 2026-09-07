const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
// lang is what the reader says, uiLang is what the operator reads: two settings,
// because a French bulletin is routinely run from an English interface.
const DEFAULT_SETTINGS = { name: 'Africa24TV Prompter', lang: '', uiLang: 'en' };

// A station name has to outlive a restart, and the show state deliberately does not, so
// the settings are the one thing kept on disk.
function loadSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Could not save settings:', error.message);
    }
}

// The addresses a phone on the same wifi can reach this machine on.
function lanAddresses() {
    return Object.values(os.networkInterfaces())
        .flat()
        .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
        .map((iface) => iface.address)
        // Hyper-V, WSL and Docker park themselves on 172.16/12; the address a phone can
        // actually reach is almost never one of theirs, so they go last.
        // ponytail: an ordering guess, read the routing table if a setup ever fools it.
        .sort((a, b) => Number(a.startsWith('172.')) - Number(b.startsWith('172.')));
}

const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath === '/api/lan') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // In a container os.networkInterfaces() sees the container's own bridge network,
        // never the host's wifi, so the addresses it can offer reach nothing. Say so
        // rather than hand out an address that fails on the phone.
        res.end(JSON.stringify({
            addresses: lanAddresses(),
            port: PORT,
            container: fs.existsSync('/.dockerenv')
        }));
        return;
    }

    const requestPath = urlPath === '/' ? 'controller.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    const extname = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm'
    };
    
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Create WebSocket server using the same HTTP server
const wss = new WebSocket.Server({ server });

// Throttles the position the displays reconcile against; the value has to stay fresh,
// so it is relayed as it arrives rather than resent from the stored state.
let lastPositionSync = 0;

// Store connected clients
const clients = {
    controllers: new Set(),
    displays: new Set()
};

// Current state to sync new connections
let currentState = {
    text: '',
    textStyles: null,
    speed: 150,
    speedMultiplier: 1,
    fontSize: 48,
    segmentLength: 10 * 60, // 10 minutes in seconds
    segmentMinutes: 10,
    segmentSeconds: 0,
    isPlaying: false,
    isPaused: false,
    currentPosition: 0,
    progressRatio: 0,
    startTime: null,
    pausedTime: 0,
    mirrorMode: false,
    hideTimer: false,
    onAir: false,
    scheduledStartTime: null,
    readingLine: { enabled: false, position: 50, color: '#ffffff', thickness: 2 },
    settings: loadSettings()
};

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            switch (data.type) {
                case 'register':
                    handleRegistration(ws, data);
                    break;
                    
                case 'setText':
                    currentState.text = data.content;
                    currentState.textStyles = data.styles || null;
                    broadcastToDisplays({
                        type: 'setText',
                        content: data.content,
                        styles: data.styles || null
                    });
                    break;
                    
                case 'setSpeed':
                    currentState.speed = data.value;
                    currentState.speedMultiplier = data.multiplier || data.value / 150;
                    broadcastToDisplays({
                        type: 'setSpeed',
                        value: data.value,
                        multiplier: currentState.speedMultiplier
                    });
                    break;
                    
                case 'setFontSize':
                    currentState.fontSize = data.value;
                    broadcastToDisplays({ type: 'setFontSize', value: data.value });
                    break;
                    
                case 'setSegmentLength':
                    currentState.segmentLength = data.totalSeconds || data.value || 10 * 60; // fallback to 10 minutes
                    currentState.segmentMinutes = data.minutes || Math.floor(currentState.segmentLength / 60);
                    currentState.segmentSeconds = data.seconds || (currentState.segmentLength % 60);
                    broadcastToDisplays({ 
                        type: 'setSegmentLength', 
                        totalSeconds: currentState.segmentLength,
                        minutes: currentState.segmentMinutes,
                        seconds: currentState.segmentSeconds
                    });
                    break;
                    
                case 'setMirrorMode':
                    currentState.mirrorMode = data.enabled;
                    broadcastToDisplays({ type: 'setMirrorMode', enabled: data.enabled });
                    break;
                    
                case 'setHideTimer':
                    currentState.hideTimer = data.enabled;
                    broadcastToDisplays({ type: 'setHideTimer', enabled: data.enabled });
                    break;
                    
                case 'setOnAir':
                    currentState.onAir = data.enabled;
                    broadcastToDisplays({ type: 'setOnAir', enabled: data.enabled });
                    break;

                case 'setReadingLine':
                    currentState.readingLine = {
                        enabled: !!data.enabled,
                        position: Number(data.position) || 50,
                        color: data.color || '#ffffff',
                        thickness: Number(data.thickness) || 2
                    };
                    broadcastToDisplays({ type: 'setReadingLine', ...currentState.readingLine });
                    break;
                    
                case 'setSettings':
                    currentState.settings = {
                        name: String(data.name ?? currentState.settings.name).slice(0, 60).trim()
                            || DEFAULT_SETTINGS.name,
                        lang: String(data.lang ?? currentState.settings.lang).slice(0, 15),
                        uiLang: String(data.uiLang ?? currentState.settings.uiLang).slice(0, 5)
                    };
                    saveSettings(currentState.settings);
                    // The name is on every controller and the interface language is on
                    // every screen, so both ends hear about it.
                    broadcastToControllers({ type: 'settings', ...currentState.settings });
                    broadcastToDisplays({ type: 'settings', ...currentState.settings });
                    break;

                case 'setScheduledStart':
                    currentState.scheduledStartTime = data.scheduledTime;
                    broadcastToDisplays({ type: 'setScheduledStart', scheduledTime: data.scheduledTime });
                    break;
                    
                case 'clearScheduledStart':
                    currentState.scheduledStartTime = null;
                    broadcastToDisplays({ type: 'clearScheduledStart' });
                    broadcastToControllers({ type: 'clearScheduledStart' });
                    break;
                    
                case 'start':
                    currentState.isPlaying = true;
                    currentState.isPaused = false;
                    currentState.onAir = true;
                    currentState.scheduledStartTime = null;
                    currentState.startTime = data.startTime || Date.now() - (data.pausedTime || currentState.pausedTime || 0);
                    currentState.pausedTime = data.pausedTime || 0;
                    if (data.segmentDuration) {
                        currentState.segmentLength = Math.max(1, Math.round(data.segmentDuration / 1000));
                    }
                    broadcastToDisplays({
                        type: 'start',
                        startTime: currentState.startTime,
                        pausedTime: currentState.pausedTime,
                        segmentDuration: data.segmentDuration || currentState.segmentLength * 1000
                    });
                    broadcastToControllers({
                        type: 'start',
                        startTime: currentState.startTime,
                        pausedTime: currentState.pausedTime,
                        segmentDuration: data.segmentDuration || currentState.segmentLength * 1000
                    });
                    broadcastToDisplays({ type: 'setOnAir', enabled: true });
                    broadcastToDisplays({ type: 'clearScheduledStart' });
                    break;
                    
                case 'pause':
                    currentState.isPlaying = false;
                    currentState.isPaused = true;
                    currentState.pausedTime = data.pausedTime || (Date.now() - currentState.startTime);
                    if (data.segmentDuration) {
                        currentState.segmentLength = Math.max(1, Math.round(data.segmentDuration / 1000));
                    }
                    broadcastToDisplays({
                        type: 'pause',
                        pausedTime: currentState.pausedTime,
                        segmentDuration: data.segmentDuration || currentState.segmentLength * 1000
                    });
                    broadcastToControllers({
                        type: 'pause',
                        pausedTime: currentState.pausedTime,
                        segmentDuration: data.segmentDuration || currentState.segmentLength * 1000
                    });
                    break;
                    
                case 'reset':
                    currentState.isPlaying = false;
                    currentState.isPaused = false;
                    currentState.currentPosition = 0;
                    currentState.progressRatio = 0;
                    currentState.startTime = null;
                    currentState.pausedTime = 0;
                    broadcastToDisplays({ type: 'reset' });
                    broadcastToControllers({ type: 'reset' });
                    break;
                    
                case 'setFullscreen':
                    broadcastToDisplays({ type: 'setFullscreen', enabled: data.enabled });
                    break;
                    
                case 'fullscreenState':
                    broadcastToControllers({ type: 'fullscreenState', enabled: data.enabled });
                    break;
                    
                case 'progress':
                    // A display that reports no word position is running a page loaded
                    // before the position fix: it crawls, and everything that trusts it -
                    // the controller's bar and countdown, every other display through
                    // positionSync - crawls with it. One stale window must not run the
                    // show, so its reports are dropped and the operator is told.
                    if (!Number.isFinite(data.words)) {
                        if (!ws.isStale) {
                            ws.isStale = true;
                            console.warn('Ignoring positions from a display running an outdated page - reload it');
                            broadcastConnectionCount();
                        }
                        break;
                    }
                    if (ws.isStale) {
                        ws.isStale = false;
                        broadcastConnectionCount();
                    }
                    if (Number.isFinite(data.ratio)) {
                        currentState.progressRatio = data.ratio;
                        if (Date.now() - lastPositionSync > 1000) {
                            lastPositionSync = Date.now();
                            // Displays reconcile in words, the controller's bar reads the
                            // ratio; both travel together so an old client still follows.
                            broadcastToDisplays({
                                type: 'positionSync',
                                ratio: data.ratio,
                                words: data.words
                            });
                        }
                    }
                    broadcastToControllers({
                        type: 'progress',
                        remainingMs: data.remainingMs,
                        ratio: data.ratio
                    });
                    break;

                case 'seek':
                    currentState.progressRatio = Number(data.ratio) || 0;
                    currentState.pausedTime = data.pausedTime || 0;
                    currentState.startTime = data.startTime || currentState.startTime;
                    if (data.playing) {
                        currentState.isPlaying = true;
                        currentState.isPaused = false;
                    } else if (currentState.pausedTime > 0) {
                        currentState.isPaused = true;
                    }
                    if (data.segmentDuration) {
                        currentState.segmentLength = Math.max(1, Math.round(data.segmentDuration / 1000));
                    }
                    broadcastToDisplays({
                        type: 'seek',
                        ratio: data.ratio,
                        playing: !!data.playing,
                        startTime: currentState.startTime,
                        pausedTime: currentState.pausedTime,
                        segmentDuration: data.segmentDuration || currentState.segmentLength * 1000
                    });
                    break;
                    
                case 'preroll':
                    broadcastToDisplays({ type: 'preroll', seconds: data.seconds });
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    ws.on('close', () => {
        clients.controllers.delete(ws);
        clients.displays.delete(ws);
        console.log('WebSocket connection closed');
        broadcastConnectionCount();
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleRegistration(ws, data) {
    if (data.role === 'controller') {
        clients.controllers.add(ws);
        console.log('Controller registered');
        
        // Send current state to new controller
        ws.send(JSON.stringify({
            type: 'stateSync',
            state: currentState
        }));
        
    } else if (data.role === 'display' || data.role === 'preview') {
        // A preview is a real display client, it just should not show up as a device.
        ws.isPreview = data.preview === true || data.role === 'preview';
        clients.displays.add(ws);
        console.log(ws.isPreview ? 'Preview registered' : 'Display registered');
        
        // Send current state to new display
        ws.send(JSON.stringify({
            type: 'stateSync',
            state: currentState
        }));
    }
    
    broadcastConnectionCount();
}

function broadcastToDisplays(message) {
    const messageStr = JSON.stringify(message);
    clients.displays.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

function broadcastToControllers(message) {
    const messageStr = JSON.stringify(message);
    clients.controllers.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

function broadcastConnectionCount() {
    const connectionInfo = {
        type: 'connectionCount',
        controllers: clients.controllers.size,
        displays: [...clients.displays].filter((client) => !client.isPreview).length,
        stale: [...clients.displays].filter((client) => client.isStale).length
    };
    
    [...clients.controllers, ...clients.displays].forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(connectionInfo));
        }
    });
}

// Start HTTP server
server.listen(PORT, () => {
    console.log(`HTTP Server running at http://localhost:${PORT}`);
    console.log(`WebSocket Server running on the same port ${PORT}`);
    console.log(`Controller: http://localhost:${PORT}/controller.html`);
    console.log(`Display: http://localhost:${PORT}/display.html`);
    lanAddresses().forEach((address) => {
        console.log(`On this network: http://${address}:${PORT}/controller.html`);
    });
});

// Graceful shutdown. docker stop sends SIGTERM to PID 1, and PID 1 gets none of the
// default signal handling an ordinary process does: without an explicit handler the
// container ignores the signal for the whole grace period and is killed (exit 137),
// still serving the show all the way through it.
function shutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    // An open WebSocket keeps server.close() waiting for ever, and a display holds one
    // for the length of the broadcast, so hang the clients up first.
    wss.clients.forEach((client) => client.terminate());
    wss.close(() => {
        server.close(() => {
            console.log('Servers closed');
            process.exit(0);
        });
    });
    // ponytail: 3s backstop for a socket that refuses to let go; raise it only if a
    // clean close ever turns out to need longer.
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { server, wss };