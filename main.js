const { app, BrowserWindow, dialog, shell, net, session, Menu } = require('electron');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const nodeNet = require('node:net');
const { spawn } = require('child_process');
let appIsQuitting = false;

// Prevent EPIPE and other socket errors from showing a crash dialog
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception (handled):', err.stack || err.message);
});

// Token generated once per process lifetime; sent to the broadcaster window via
// IPC and required when the page emits 'broadcaster' to register itself.
// BROADCASTER_TOKEN env override exists so scripts/test-transcription.js can
// authenticate in development.
const broadcasterToken = process.env.BROADCASTER_TOKEN || crypto.randomBytes(16).toString('hex');

const expressApp = express();
const server = http.createServer(expressApp);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6  // 1 MB — audio chunks are ~8 KB each
});

expressApp.use((req, res, next) => {
    if (req.path.endsWith('.html')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    next();
});
expressApp.use(express.static(path.join(__dirname, 'public')));

let broadcasterSocket = null;
const listeners = new Map();
let translationEnabled = true;
let transcriptionActive = false;

function sendStatus(msg) {
    if (broadcasterSocket) {
        try { broadcasterSocket.emit('python-status', msg); } catch (e) {}
    }
}

// ============================================================================
// Transcription via whisper.cpp (whisper-server)
//
// A bundled whisper-server binary (built by scripts/build-whisper.sh) runs as
// a child process with the model resident in memory. Audio chunks from the
// broadcaster accumulate here in Node until ~5 seconds are buffered, then get
// wrapped in a WAV header and POSTed to the server's /inference endpoint.
// The server resamples 44100 Hz -> 16 kHz internally (miniaudio).
// ============================================================================

const SAMPLE_RATE = 44100;          // must match broadcaster.html AudioContext
const CHUNK_SECONDS = 5;            // audio buffered per inference
const MAX_BUFFER_SECONDS = 30;      // drop buffer beyond this (inference stuck)
const WHISPER_MAX_RESTARTS = 3;

let whisperProcess = null;
let whisperPort = 0;
let whisperReady = false;
let whisperStarting = false;
let whisperRestarts = 0;

let pcmChunks = [];
let pcmSamples = 0;
let inferenceInFlight = false;

function resetPcmBuffer() {
    pcmChunks = [];
    pcmSamples = 0;
}

function whisperDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'whisper')
        : path.join(__dirname, 'resources', 'whisper');
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const srv = nodeNet.createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

// whisper-server loads the model before it starts listening, so the port
// accepting connections doubles as the "model ready" signal.
function waitForWhisperReady() {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const poll = () => {
            if (!whisperProcess) return reject(new Error('whisper-server exited during startup'));
            const req = http.get({ host: '127.0.0.1', port: whisperPort, path: '/' }, (res) => {
                res.resume();
                resolve();
            });
            req.on('error', () => {
                if (++attempts > 60) reject(new Error('whisper-server did not become ready'));
                else setTimeout(poll, 500);
            });
        };
        setTimeout(poll, 300);
    });
}

async function startWhisperServer() {
    if (whisperProcess || whisperStarting) return;
    whisperStarting = true;

    const dir = whisperDir();
    const bin = path.join(dir, 'whisper-server');
    const model = path.join(dir, 'ggml-base.en.bin');
    const vadModel = path.join(dir, 'ggml-silero-v5.1.2.bin');

    if (!fs.existsSync(bin) || !fs.existsSync(model)) {
        console.error(`whisper-server or model missing in ${dir}`);
        sendStatus('❌ Transcription files are missing. Please reinstall the app.');
        whisperStarting = false;
        return;
    }

    sendStatus('⏳ Loading translation model, please wait...');
    try {
        whisperPort = await findFreePort();
        const args = [
            '-m', model,
            '--host', '127.0.0.1',
            '--port', String(whisperPort),
            '-l', 'en',
            '-bs', '5',       // beam size, matches previous faster-whisper setting
            '-nth', '0.8'     // no-speech threshold, matches previous setting
        ];
        // VAD prevents Whisper hallucinating text during silence (see v1.2.7)
        if (fs.existsSync(vadModel)) {
            args.push('--vad', '-vm', vadModel, '-vsd', '300');
        }

        console.log(`Starting whisper-server on port ${whisperPort}...`);
        whisperProcess = spawn(bin, args, { cwd: dir });
        whisperProcess.stdout.on('data', (d) => console.log('whisper-server:', d.toString().trim()));
        whisperProcess.stderr.on('data', (d) => console.log('whisper-server:', d.toString().trim()));
        whisperProcess.on('error', (err) => {
            console.error(`whisper-server spawn error: ${err.message}`);
            sendStatus(`❌ Could not start transcription: ${err.message}`);
        });
        whisperProcess.on('close', (code) => {
            console.log(`whisper-server exited with code ${code}`);
            whisperProcess = null;
            whisperReady = false;
            if (appIsQuitting || code === 0) return;
            whisperRestarts++;
            if (whisperRestarts > WHISPER_MAX_RESTARTS) {
                sendStatus('❌ Transcription keeps crashing. Please restart the app or contact support.');
                return;
            }
            sendStatus(`❌ Transcription crashed (code ${code}). Restarting...`);
            setTimeout(() => startWhisperServer(), 2000 * whisperRestarts);
        });

        await waitForWhisperReady();
        whisperReady = true;
        whisperRestarts = 0;
        console.log('whisper-server ready');
        sendStatus('✓ Translation ready');
    } catch (err) {
        console.error(`whisper-server startup failed: ${err.message}`);
        sendStatus(`❌ Transcription failed to start: ${err.message}`);
        if (whisperProcess) whisperProcess.kill();
    } finally {
        whisperStarting = false;
    }
}

function pcmToWav(pcm, sampleRate) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);              // fmt chunk size
    header.writeUInt16LE(1, 20);               // PCM
    header.writeUInt16LE(1, 22);               // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);  // byte rate
    header.writeUInt16LE(2, 32);               // block align
    header.writeUInt16LE(16, 34);              // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

function transcribeWav(wav) {
    return new Promise((resolve, reject) => {
        const boundary = '----AudioBroadcasterFormBoundary';
        const body = Buffer.concat([
            Buffer.from(
                `--${boundary}\r\n` +
                'Content-Disposition: form-data; name="file"; filename="chunk.wav"\r\n' +
                'Content-Type: audio/wav\r\n\r\n'
            ),
            wav,
            Buffer.from(
                `\r\n--${boundary}\r\n` +
                'Content-Disposition: form-data; name="response_format"\r\n\r\n' +
                'json\r\n' +
                `--${boundary}--\r\n`
            )
        ]);
        const req = http.request({
            host: '127.0.0.1',
            port: whisperPort,
            path: '/inference',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        }, (res) => {
            let data = '';
            res.on('data', (d) => { data += d; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`whisper-server HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                }
                try {
                    resolve((JSON.parse(data).text || '').trim());
                } catch (e) {
                    reject(new Error(`Bad whisper-server response: ${data.slice(0, 200)}`));
                }
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('inference timed out')));
        req.on('error', reject);
        req.end(body);
    });
}

// Profanity filter — blocks common curse words from ever appearing in output
const PROFANITY = new Set([
    'fuck', 'fucking', 'fucked', 'fucker', 'fucks',
    'shit', 'shitting', 'shitty', 'bullshit',
    'ass', 'asshole', 'asses',
    'bitch', 'bitches', 'bitching',
    'damn', 'damned', 'goddamn', 'goddamned',
    'hell', 'bastard', 'bastards',
    'crap', 'crappy',
    'piss', 'pissed', 'pissing',
    'dick', 'dicks', 'cock', 'cocks',
    'cunt', 'cunts', 'whore', 'whores',
    'nigger', 'niggers', 'faggot', 'faggots',
    'retard', 'retarded'
]);

function containsProfanity(text) {
    return text.toLowerCase().split(/\s+/).some(
        (w) => PROFANITY.has(w.replace(/^[.,!?;:'"]+|[.,!?;:'"]+$/g, ''))
    );
}

function removeRepetitiveWords(text) {
    const words = text.split(/\s+/).filter(Boolean);
    return words.filter((w, i) => i === 0 || w !== words[i - 1]).join(' ');
}

function handleTranscript(raw) {
    const cleaned = removeRepetitiveWords(raw.replace(/\s+/g, ' ').trim());
    if (!cleaned || containsProfanity(cleaned)) return;
    console.log(`Transcribed: ${cleaned}`);
    if (broadcasterSocket) {
        try { broadcasterSocket.emit('transcribed-text', { text: cleaned }); } catch (e) { console.error('Broadcaster emit error:', e.message); }
    }
    if (translationEnabled) {
        listeners.forEach((l) => {
            try { l.emit('transcribed-text', { text: cleaned }); } catch (e) {}
        });
    }
}

function maybeTranscribe() {
    if (inferenceInFlight || pcmSamples < SAMPLE_RATE * CHUNK_SECONDS) return;
    const pcm = Buffer.concat(pcmChunks);
    resetPcmBuffer();
    inferenceInFlight = true;
    transcribeWav(pcmToWav(pcm, SAMPLE_RATE))
        .then((text) => { if (text) handleTranscript(text); })
        .catch((err) => console.error('Transcription error:', err.message))
        .finally(() => {
            inferenceInFlight = false;
            maybeTranscribe();  // buffer may have refilled during inference
        });
}

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('broadcaster', (token) => {
        if (token !== broadcasterToken) {
            console.warn(`Unauthorized broadcaster attempt from ${socket.id} — token mismatch`);
            return;
        }
        broadcasterSocket = socket;
        console.log(`Broadcaster registered: ${socket.id}`);
        listeners.forEach((_, listenerId) => socket.emit('new-listener', listenerId));
        startWhisperServer();
    });

    socket.on('listener', () => {
        listeners.set(socket.id, socket);
        console.log(`Listener registered: ${socket.id}`);
        // Send current translation state to new listener
        socket.emit('translation-state', translationEnabled);
        if (broadcasterSocket) broadcasterSocket.emit('new-listener', socket.id);
    });

    socket.on('audio-chunk', (buffer) => {
        if (socket !== broadcasterSocket) return;
        listeners.forEach((l) => {
            try { l.emit('audio-chunk', buffer); } catch (e) {}
        });
        // Buffer audio for transcription (whisper-server never opens the mic,
        // which avoids the CoreAudio conflict that crashed the renderer)
        if (transcriptionActive && whisperReady) {
            const chunk = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
            pcmChunks.push(chunk);
            pcmSamples += chunk.length / 2;  // Int16 = 2 bytes per sample
            if (pcmSamples > SAMPLE_RATE * MAX_BUFFER_SECONDS) {
                console.warn('Transcription buffer overflow, dropping audio');
                resetPcmBuffer();
            } else {
                maybeTranscribe();
            }
        }
    });

    socket.on('start-transcription', () => {
        if (socket !== broadcasterSocket) return;
        console.log('Received start-transcription event');
        transcriptionActive = true;
        resetPcmBuffer();
        startWhisperServer();  // no-op if already running
    });

    socket.on('stop-transcription', () => {
        if (socket !== broadcasterSocket) return;
        console.log('Received stop-transcription event');
        transcriptionActive = false;
        resetPcmBuffer();
    });

    socket.on('toggle-translation', (state) => {
        if (socket !== broadcasterSocket) return;
        translationEnabled = state;
        console.log(`Translation ${state ? 'enabled' : 'disabled'}`);
        // Notify all listeners of translation state change
        listeners.forEach(listener => listener.emit('translation-state', state));
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        if (socket === broadcasterSocket) {
            broadcasterSocket = null;
            transcriptionActive = false;
            resetPcmBuffer();
        } else if (listeners.has(socket.id)) {
            listeners.delete(socket.id);
            if (broadcasterSocket) {
                try { broadcasterSocket.emit('listener-left', socket.id); } catch (e) {}
            }
        }
    });
});

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

async function startServer() {
    return new Promise((resolve, reject) => {
        // Use a fixed default port so the listener URL stays the same across restarts.
        // Falls back to a random port only if the preferred port is already in use.
        const preferredPort = process.env.PORT ? Number(process.env.PORT) : 3000;

        const tryListen = (port) => {
            const onError = (err) => {
                server.removeListener('listening', onListening);
                if (err.code === 'EADDRINUSE' && port !== 0) {
                    console.log(`Port ${port} in use, falling back to random port`);
                    tryListen(0);
                } else {
                    reject(err);
                }
            };
            const onListening = () => {
                server.removeListener('error', onError);
                const addr = server.address();
                const resolvedPort = typeof addr === 'string' ? port : addr.port;
                const ip = getLocalIP();
                console.log(`Server running at http://${ip}:${resolvedPort}`);
                resolve({ ip, port: resolvedPort });
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(port, '0.0.0.0');
        };
        tryListen(preferredPort);
    });
}

let mainWindow = null;

function createBroadcasterWindow(ip, port) {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadURL(`http://localhost:${port}/broadcaster.html`);
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('server-info', { ip, port, token: broadcasterToken });
        checkForUpdates();
    });
}

// Returns > 0 if a is strictly greater than b, 0 if equal, < 0 if less.
// Splits on '.' and compares numerically — no external dependencies.
function compareVersions(a, b) {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
        const av = aParts[i] || 0;
        const bv = bParts[i] || 0;
        if (av !== bv) return av - bv;
    }
    return 0;
}

async function checkForUpdates({ silent = true } = {}) {
    try {
        const response = await net.fetch(
            'https://api.github.com/repos/mbyrdLCS/audiobroadcaster/releases/latest',
            { headers: { 'User-Agent': 'AudioBroadcaster' } }
        );
        const data = await response.json();
        const latestVersion = data.tag_name.replace(/^v/, '');
        const currentVersion = app.getVersion();
        if (compareVersions(latestVersion, currentVersion) > 0) {
            const result = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Available',
                message: `Audio Broadcaster ${data.tag_name} is available`,
                detail: `You are running version ${currentVersion}. Click Download to open the releases page.`,
                buttons: ['Download Update', 'Later'],
                defaultId: 0
            });
            if (result.response === 0) {
                shell.openExternal('https://github.com/mbyrdLCS/audiobroadcaster/releases/latest');
            }
        } else if (!silent) {
            await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'No Updates Available',
                message: 'Audio Broadcaster is up to date.',
                detail: `You are running version ${currentVersion}, which is the latest release.`,
                buttons: ['OK']
            });
        }
    } catch (err) {
        console.log('Update check failed:', err.message);
        if (!silent) {
            await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Update Check Failed',
                message: 'Could not check for updates.',
                detail: 'Please check your internet connection and try again, or visit the downloads page manually.',
                buttons: ['Open Downloads Page', 'Cancel'],
                defaultId: 0
            }).then(({ response }) => {
                if (response === 0) shell.openExternal('https://github.com/mbyrdLCS/audiobroadcaster/releases');
            });
        }
    }
}

function buildMenu() {
    const template = [
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                {
                    label: 'Check for Updates…',
                    click: () => checkForUpdates({ silent: false })
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => shell.openExternal('https://github.com/mbyrdLCS/audiobroadcaster#readme')
                },
                { type: 'separator' },
                {
                    label: 'All Downloads & Release Notes',
                    click: () => shell.openExternal('https://github.com/mbyrdLCS/audiobroadcaster/releases')
                },
                {
                    label: 'Check for Updates…',
                    click: () => checkForUpdates({ silent: false })
                }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
    // Allow microphone and speech recognition permissions for the broadcaster window
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
    });
    session.defaultSession.setPermissionCheckHandler(() => true);

    buildMenu();
    const { ip, port } = await startServer();
    createBroadcasterWindow(ip, port);
});

app.on('will-quit', () => {
    appIsQuitting = true;
    if (whisperProcess) whisperProcess.kill();
    server.close();
});