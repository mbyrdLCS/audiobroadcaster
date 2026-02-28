const { app, BrowserWindow, dialog, shell, net, session } = require('electron');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
let appIsQuitting = false;

// Prevent EPIPE and other socket errors from showing a crash dialog
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception (handled):', err.message);
});

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

let pythonProcess;

function startPythonProcess() {
    console.log('Starting Python process for transcription...');

    let pythonCmd, scriptPath;
    if (app.isPackaged) {
        // Packaged app: transcribe.py is in extraResources, use system python3
        scriptPath = path.join(process.resourcesPath, 'transcribe.py');
        pythonCmd = 'python3';
    } else {
        // Development: use venv
        pythonCmd = process.platform === 'win32'
            ? path.join(__dirname, 'venv', 'Scripts', 'python.exe')
            : path.join(__dirname, 'venv', 'bin', 'python');
        scriptPath = path.join(__dirname, 'transcribe.py');
    }

    pythonProcess = spawn(
        pythonCmd,
        [scriptPath],
        { cwd: path.dirname(scriptPath) }
    );

    pythonProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach((line) => {
            line = line.trim();
            if (!line) return;
            // Filter out Intel MKL and other system warnings
            if (line.startsWith('Intel') || line.startsWith('OMP:') || line.startsWith('WARNING:')) return;
            // Handle status messages (model download/ready)
            if (line.startsWith('STATUS:')) {
                const status = line.slice(7);
                console.log(`Python status: ${status}`);
                if (broadcasterSocket) {
                    try { broadcasterSocket.emit('python-status', status); } catch (e) {}
                }
                return;
            }
            // Regular transcription
            if (broadcasterSocket) {
                console.log(`Transcribed: ${line}`);
                try { broadcasterSocket.emit('transcribed-text', { text: line }); } catch (e) { console.error('Broadcaster emit error:', e.message); }
                if (translationEnabled) {
                    listeners.forEach((l) => {
                        try { l.emit('transcribed-text', { text: line }); } catch (e) {}
                    });
                }
            }
        });
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);
        if (code !== 0 && !appIsQuitting) {
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

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        if (socket === broadcasterSocket) {
            broadcasterSocket = null;
            if (pythonProcess && pythonProcess.stdin.writable) {
                pythonProcess.stdin.write('STOP\n');
            }
        }
        listeners.delete(socket.id);
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
            nodeIntegration: false
        }
    });
    win.loadURL(`http://localhost:${port}/broadcaster.html`);
    win.webContents.on('did-finish-load', () => win.webContents.send('server-info', { ip, port }));
}

async function checkForUpdates() {
    try {
        const response = await net.fetch(
            'https://api.github.com/repos/mbyrdLCS/audiobroadcaster/releases/latest',
            { headers: { 'User-Agent': 'AudioBroadcaster' } }
        );
        const data = await response.json();
        const latestVersion = data.tag_name.replace(/^v/, '');
        const currentVersion = app.getVersion();
        if (latestVersion !== currentVersion) {
            const result = await dialog.showMessageBox({
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
        }
    } catch (err) {
        console.log('Update check failed:', err.message);
    }
}

app.whenReady().then(async () => {
    // Allow microphone and speech recognition permissions for the broadcaster window
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
    });
    session.defaultSession.setPermissionCheckHandler(() => true);

    const { ip, port } = await startServer();
    createBroadcasterWindow(ip, port);
    checkForUpdates();
});

app.on('will-quit', () => {
    appIsQuitting = true;
    if (pythonProcess) pythonProcess.kill();
    server.close();
});