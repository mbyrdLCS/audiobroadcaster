const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const axios = require('axios');

const expressApp = express();
const server = http.createServer(expressApp);
const io = new Server(server, { 
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket'],
    pingTimeout: 60000,
    pingInterval: 25000
});

expressApp.use(express.static(path.join(__dirname, 'public')));

let broadcasterSocket = null;
const listeners = new Map();
let translationEnabled = true;
let currentTargetLang = 'es';

// Using MyMemory Translation API - free translation service (no API key needed)
// Free tier: 1000 words/day anonymous, 10,000 words/day with email
// Alternative: You can self-host LibreTranslate if you prefer
const MYMEMORY_API = 'https://api.mymemory.translated.net/get';

let pythonProcess;

function startPythonProcess() {
    console.log('Starting Python process for transcription...');
    // Try to use virtual environment python, fallback to system python3 or python
    const pythonCmd = process.platform === 'win32'
        ? path.join(__dirname, 'venv', 'Scripts', 'python.exe')
        : path.join(__dirname, 'venv', 'bin', 'python');

    pythonProcess = spawn(
        pythonCmd,
        [path.join(__dirname, 'transcribe.py')],
        { cwd: __dirname }
    );

    pythonProcess.stdout.on('data', (data) => {
        const transcribedText = data.toString().trim();
        if (transcribedText && broadcasterSocket) {
            console.log(`Transcribed: ${transcribedText}`);
            broadcasterSocket.emit('transcribed-text', { text: transcribedText });
            // Broadcast translated text (server-side) to listeners
            if (translationEnabled) {
                handleTranslation(transcribedText, currentTargetLang)
                    .then(translation => {
                        console.log(`Translated: "${transcribedText}" -> "${translation}"`);
                        const payload = { text: translation, lang: currentTargetLang };
                        listeners.forEach(listener => listener.emit('translated-text', payload));
                        if (broadcasterSocket) broadcasterSocket.emit('translated-text', payload);
                    })
                    .catch(error => {
                        console.error(`Translation error: ${error.message}`);
                        const payload = { text: `Translation failed: ${transcribedText}`, lang: currentTargetLang };
                        listeners.forEach(listener => listener.emit('translated-text', payload));
                        if (broadcasterSocket) broadcasterSocket.emit('translated-text', payload);
                    });
            } else {
                const payload = { text: transcribedText, lang: currentTargetLang };
                listeners.forEach(listener => listener.emit('translated-text', payload));
                if (broadcasterSocket) broadcasterSocket.emit('translated-text', payload);
            }
        } else {
            console.log(`Received stdout from Python, but no broadcasterSocket or empty text: ${transcribedText}`);
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);
        if (code !== 0 && !app.isQuitting()) {
            console.log('Restarting Python process...');
            startPythonProcess();
        }
    });

    pythonProcess.on('error', (err) => {
        console.error(`Python process error: ${err.message}`);
    });
}

startPythonProcess();

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('broadcaster', () => {
        broadcasterSocket = socket;
        console.log(`Broadcaster registered: ${socket.id}`);
        listeners.forEach((_, listenerId) => socket.emit('new-listener', listenerId));
    });

    socket.on('listener', () => {
        listeners.set(socket.id, socket);
        console.log(`Listener registered: ${socket.id}`);
        // Send current translation state to new listener
        socket.emit('translation-state', translationEnabled);
        if (broadcasterSocket) broadcasterSocket.emit('new-listener', socket.id);
    });

    socket.on('offer', (offer, listenerId) => {
        const listenerSocket = listeners.get(listenerId);
        if (listenerSocket) listenerSocket.emit('offer', offer);
    });

    socket.on('answer', (answer) => {
        if (broadcasterSocket) broadcasterSocket.emit('answer', answer, socket.id);
    });

    socket.on('ice-candidate', (candidate, listenerId) => {
        // If from broadcaster, forward to the specific listener
        if (socket === broadcasterSocket) {
            const listenerSocket = listenerId ? listeners.get(listenerId) : null;
            if (listenerSocket) listenerSocket.emit('ice-candidate', candidate);
        } else {
            // From a listener, forward to broadcaster with the sender's id
            if (broadcasterSocket) broadcasterSocket.emit('ice-candidate', candidate, socket.id);
        }
    });

    socket.on('start-transcription', () => {
        console.log('Received start-transcription event');
        if (pythonProcess && pythonProcess.stdin.writable) {
            pythonProcess.stdin.write('START\n');
            console.log('Sent START command to Python');
        } else {
            console.log('Python process not available, restarting...');
            startPythonProcess();
            setTimeout(() => {
                if (pythonProcess && pythonProcess.stdin.writable) {
                    pythonProcess.stdin.write('START\n');
                    console.log('Sent START command to Python after restart');
                } else {
                    console.log('Failed to restart Python process');
                }
            }, 1000);
        }
    });

    socket.on('stop-transcription', () => {
        console.log('Received stop-transcription event');
        if (pythonProcess && pythonProcess.stdin.writable) {
            pythonProcess.stdin.write('STOP\n');
            console.log('Sent STOP command to Python');
        }
    });

    socket.on('toggle-translation', (state) => {
        translationEnabled = state;
        console.log(`Translation ${state ? 'enabled' : 'disabled'}`);
        // Notify all listeners of translation state change
        listeners.forEach(listener => listener.emit('translation-state', state));
    });

    socket.on('set-target-language', (lang) => {
        if (typeof lang === 'string' && lang.length <= 8) {
            currentTargetLang = lang;
            console.log(`Target language set to: ${currentTargetLang}`);
        }
    });

    socket.on('transcribed-text', (data) => {
        // Only update the current language from the broadcaster; avoid double-translation
        const targetLang = (data && typeof data.targetLang === 'string' && data.targetLang) ? data.targetLang : currentTargetLang;
        currentTargetLang = targetLang;
        console.log(`Updated target language from broadcaster payload: ${currentTargetLang}`);
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        if (socket === broadcasterSocket) {
            broadcasterSocket = null;
            if (pythonProcess) pythonProcess.stdin.write('STOP\n');
        }
        listeners.delete(socket.id);
    });
});

async function handleTranslation(text, targetLang) {
    try {
        console.log(`Attempting to translate: "${text}" to ${targetLang}`);

        // MyMemory API uses GET with langpair parameter (source|target)
        const url = `${MYMEMORY_API}?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`;

        const response = await axios.get(url, {
            timeout: 5000
        });

        console.log(`MyMemory API response:`, JSON.stringify(response.data));

        // MyMemory returns: { responseData: { translatedText: "..." }, responseStatus: 200 }
        const translation = response.data?.responseData?.translatedText;

        if (!translation) {
            console.error(`No translatedText in response. Full response: ${JSON.stringify(response.data)}`);
            return text;
        }

        console.log(`Translation successful: "${translation}"`);
        return translation;
    } catch (error) {
        console.error(`Translation error: ${error.message}`);
        if (error.response) {
            console.error(`Response status: ${error.response.status}`);
            console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        // Return original text if translation fails
        return text;
    }
}

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
        // Use dynamic port to avoid EADDRINUSE; if PORT is set, honor it
        const preferredPort = process.env.PORT ? Number(process.env.PORT) : 0;
        const onError = (err) => {
            server.removeListener('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            const addr = server.address();
            const port = typeof addr === 'string' ? (process.env.PORT ? Number(process.env.PORT) : 0) : addr.port;
            const ip = getLocalIP();
            console.log(`Server running at http://${ip}:${port}`);
            resolve({ ip, port });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(preferredPort, '0.0.0.0');
    });
}

function createBroadcasterWindow(ip, port) {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false
        }
    });
    win.loadURL(`http://localhost:${port}/broadcaster.html`);
    win.webContents.on('did-finish-load', () => win.webContents.send('server-info', { ip, port }));
}

app.whenReady().then(async () => {
    const { ip, port } = await startServer();
    createBroadcasterWindow(ip, port);
});

app.on('quit', () => {
    if (pythonProcess) pythonProcess.kill();
    server.close();
});