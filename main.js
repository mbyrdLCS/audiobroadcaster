const { app, BrowserWindow, dialog, shell, net, session, Menu } = require('electron');
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const nodeNet = require('node:net');
const { spawn, execFile } = require('child_process');
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
const OVERLAP_SECONDS = 0.5;        // overlap between consecutive inference windows

let whisperProcess = null;
let whisperPort = 0;
let whisperReady = false;
let whisperStarting = false;
let whisperRestarts = 0;

let pcmChunks = [];
let pcmSamples = 0;
let inferenceInFlight = false;
let overlapTail = Buffer.alloc(0);  // tail PCM from previous window
let lastTranscript = '';            // last emitted transcript (for dedup + prompt)

function resetPcmBuffer() {
    pcmChunks = [];
    pcmSamples = 0;
    overlapTail = Buffer.alloc(0);
    lastTranscript = '';
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

    sendStatus('⏳ Loading transcription model, please wait...');
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
        sendStatus('✓ Transcription ready');
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
        // Deliberately NOT sending a "prompt" context field: feeding Whisper its
        // own previous transcript triggers repetition-loop hallucinations when
        // the speech itself is repetitive (common in sermons — verified in test).
        const parts = [
            Buffer.from(
                `--${boundary}\r\n` +
                'Content-Disposition: form-data; name="file"; filename="chunk.wav"\r\n' +
                'Content-Type: audio/wav\r\n\r\n'
            ),
            wav,
            Buffer.from(
                `\r\n--${boundary}\r\n` +
                'Content-Disposition: form-data; name="response_format"\r\n\r\n' +
                'json\r\n'
            )
        ];
        parts.push(Buffer.from(`--${boundary}--\r\n`));
        const body = Buffer.concat(parts);
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

// Compare last N words of prevText with first N words of newText (N=3,2,1).
// On the first match, strip those words from the front of newText and return it.
function dedupeBoundary(prevText, newText) {
    if (!prevText || !newText) return newText;
    const strip = (w) => w.toLowerCase().replace(/^[.,!?;:'"]+|[.,!?;:'"]+$/g, '');
    const prevWords = prevText.trim().split(/\s+/);
    const newWords = newText.trim().split(/\s+/);
    for (let n = 3; n >= 1; n--) {
        if (prevWords.length < n || newWords.length < n) continue;
        const prevTail = prevWords.slice(-n).map(strip);
        const newHead = newWords.slice(0, n).map(strip);
        if (prevTail.every((w, i) => w === newHead[i])) {
            return newWords.slice(n).join(' ');
        }
    }
    return newText;
}

// Replace each profane word's core with first-char + asterisks, preserving surrounding punctuation.
function maskProfanity(text) {
    return text.split(/\s+/).map((word) => {
        const leadingMatch = word.match(/^[.,!?;:'"]+/);
        const trailingMatch = word.match(/[.,!?;:'"]+$/);
        const leading = leadingMatch ? leadingMatch[0] : '';
        const trailing = trailingMatch ? trailingMatch[0] : '';
        const coreEnd = trailing.length > 0 ? word.length - trailing.length : word.length;
        const core = word.slice(leading.length, coreEnd);
        if (core && PROFANITY.has(core.toLowerCase())) {
            return leading + core[0] + '*'.repeat(core.length - 1) + trailing;
        }
        return word;
    }).join(' ');
}

function removeRepetitiveWords(text) {
    const words = text.split(/\s+/).filter(Boolean);
    return words.filter((w, i) => i === 0 || w !== words[i - 1]).join(' ');
}

function handleTranscript(raw) {
    const cleaned = removeRepetitiveWords(raw.replace(/\s+/g, ' ').trim());
    if (!cleaned) return;
    const deduped = dedupeBoundary(lastTranscript, cleaned);
    // Always update lastTranscript (unmasked) so dedup + prompt context stay accurate.
    lastTranscript = cleaned;
    if (!deduped) return;  // entire window was a duplicate of the previous boundary
    const masked = maskProfanity(deduped);
    console.log(`Transcribed: ${masked}`);
    if (broadcasterSocket) {
        try { broadcasterSocket.emit('transcribed-text', { text: masked }); } catch (e) { console.error('Broadcaster emit error:', e.message); }
    }
    if (translationEnabled) {
        listeners.forEach((l) => {
            try { l.emit('transcribed-text', { text: masked }); } catch (e) {}
        });
    }
    if (translationUserEnabled && llamaReady) {
        queueTranslation(masked);
    }
}

function maybeTranscribe() {
    if (inferenceInFlight || pcmSamples < SAMPLE_RATE * CHUNK_SECONDS) return;
    const freshPcm = Buffer.concat(pcmChunks);
    // Keep the tail of freshPcm for the next window (Int16 = 2 bytes/sample).
    const tailBytes = Math.round(OVERLAP_SECONDS * SAMPLE_RATE) * 2;
    const newTail = freshPcm.slice(Math.max(0, freshPcm.length - tailBytes));
    // Prepend the previous window's tail so boundary words appear in both windows.
    const fullPcm = overlapTail.length > 0
        ? Buffer.concat([overlapTail, freshPcm])
        : freshPcm;
    // Reset only the fresh-audio buffer; preserve lastTranscript and set overlapTail
    // for the next window.  Hard-reset cases (stop-transcription, disconnect, overflow)
    // call resetPcmBuffer() directly, which also clears overlapTail and lastTranscript.
    pcmChunks = [];
    pcmSamples = 0;
    overlapTail = newTail;
    inferenceInFlight = true;
    transcribeWav(pcmToWav(fullPcm, SAMPLE_RATE))
        .then((text) => { if (text) handleTranscript(text); })
        .catch((err) => console.error('Transcription error:', err.message))
        .finally(() => {
            inferenceInFlight = false;
            maybeTranscribe();  // buffer may have refilled during inference
        });
}

// ============================================================================
// Offline Translation — llama-server + Gemma 3 4B (Apple Silicon only)
//
// A bundled llama-server binary runs a Gemma 3 4B model downloaded on demand
// into userData/models/. English captions from handleTranscript() are queued
// and translated serially via the OpenAI-compatible /v1/chat/completions API.
// ============================================================================

const TRANSLATION_MODEL_URL = process.env.TRANSLATION_MODEL_URL ||
    'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf';
const TRANSLATION_MODEL_SHA256 = process.env.TRANSLATION_MODEL_SHA256 ||
    '882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863';
const TRANSLATION_MODEL_SIZE = Number(process.env.TRANSLATION_MODEL_SIZE) || 2489757856;
const LLAMA_MAX_RESTARTS = 3;

let translationAppleArm64 = false;
let translationModelPresent = false;
let translationUserEnabled = false;
let translationDownloading = false;
let translationProgress = 0;
let llamaReady = false;
let llamaProcess = null;
let llamaPort = 0;
let llamaStarting = false;
let llamaStopping = false;
let llamaRestarts = 0;

const translationQueue = [];
let translationInFlight = false;

// --- Apple Silicon detection (async, cached at startup) ---
async function detectAppleSilicon() {
    if (process.platform !== 'darwin') return false;
    return new Promise((resolve) => {
        execFile('sysctl', ['-n', 'hw.optional.arm64'], (err, stdout) => {
            resolve(!err && stdout.trim() === '1');
        });
    });
}

// --- Model path ---
function translationModelPath() {
    if (process.env.TRANSLATION_MODEL_PATH) return process.env.TRANSLATION_MODEL_PATH;
    return path.join(app.getPath('userData'), 'models', 'gemma-3-4b-it-Q4_K_M.gguf');
}

function checkModelPresent() {
    translationModelPresent = fs.existsSync(translationModelPath());
}

// --- Persistence ---
function translationSettingsPath() {
    return path.join(app.getPath('userData'), 'translation-settings.json');
}

function loadTranslationSettings() {
    try {
        const data = JSON.parse(fs.readFileSync(translationSettingsPath(), 'utf8'));
        return { enabled: !!data.enabled };
    } catch {
        return { enabled: false };
    }
}

function saveTranslationSettings(settings) {
    try {
        fs.writeFileSync(translationSettingsPath(), JSON.stringify(settings));
    } catch (err) {
        console.error('Failed to save translation settings:', err.message);
    }
}

// --- State object ---
function offlineTranslationState() {
    return {
        supported: translationAppleArm64,
        modelPresent: translationModelPresent,
        enabled: translationUserEnabled,
        downloading: translationDownloading,
        progress: translationProgress,
        ready: llamaReady
    };
}

// --- State emission ---
function emitTranslationState() {
    if (broadcasterSocket) {
        try { broadcasterSocket.emit('offline-translation-state', offlineTranslationState()); } catch (e) {}
    }
}

function emitOfflineLanguages() {
    const langs = (translationUserEnabled && llamaReady) ? ['es'] : [];
    if (broadcasterSocket) {
        try { broadcasterSocket.emit('offline-languages', langs); } catch (e) {}
    }
    listeners.forEach((l) => {
        try { l.emit('offline-languages', langs); } catch (e) {}
    });
}

// --- Model download ---
// Supports HTTP redirect following (up to 5 hops) and byte-range resume.
function startModelDownload() {
    if (translationDownloading) return;
    // TEST OVERRIDE: TRANSLATION_MODEL_PATH means model is already in place
    if (process.env.TRANSLATION_MODEL_PATH) return;

    translationDownloading = true;
    translationProgress = 0;
    emitTranslationState();

    const modelPath = translationModelPath();
    const partPath = modelPath + '.part';
    const modelDir = path.dirname(modelPath);

    try { fs.mkdirSync(modelDir, { recursive: true }); } catch {}

    let existingSize = 0;
    try {
        if (fs.existsSync(partPath)) existingSize = fs.statSync(partPath).size;
    } catch {}

    if (existingSize > 0) {
        // Hash the existing bytes first so the running hash is correct on resume
        const preHash = crypto.createHash('sha256');
        const readStream = fs.createReadStream(partPath);
        readStream.on('data', (chunk) => preHash.update(chunk));
        readStream.on('end', () => performDownload(existingSize, existingSize, preHash));
        readStream.on('error', (err) => {
            console.error('Error reading .part file for resume hash:', err.message);
            performDownload(0, 0, crypto.createHash('sha256'));
        });
    } else {
        performDownload(0, 0, crypto.createHash('sha256'));
    }
}

function performDownload(startByte, initialBytesReceived, hash) {
    const modelPath = translationModelPath();
    const partPath = modelPath + '.part';
    let bytesReceived = initialBytesReceived;

    function onDownloadComplete() {
        if (bytesReceived !== TRANSLATION_MODEL_SIZE) {
            console.error(`Download size mismatch: got ${bytesReceived}, expected ${TRANSLATION_MODEL_SIZE}`);
            try { fs.unlinkSync(partPath); } catch {}
            translationDownloading = false;
            translationProgress = 0;
            emitTranslationState();
            sendStatus('❌ Translation model download failed verification. Please try again.');
            return;
        }

        const digest = hash.digest('hex');
        if (digest !== TRANSLATION_MODEL_SHA256) {
            console.error(`Download hash mismatch: got ${digest}`);
            try { fs.unlinkSync(partPath); } catch {}
            translationDownloading = false;
            translationProgress = 0;
            emitTranslationState();
            sendStatus('❌ Translation model download failed verification. Please try again.');
            return;
        }

        try {
            fs.renameSync(partPath, modelPath);
        } catch (err) {
            console.error('Failed to rename model file:', err.message);
            translationDownloading = false;
            emitTranslationState();
            sendStatus('❌ Translation model download failed verification. Please try again.');
            return;
        }

        translationDownloading = false;
        translationProgress = 100;
        translationModelPresent = true;
        // The user clicked "Enable Offline Translation" to get here — downloading
        // IS enabling. Requiring another click after a 10-minute download confused
        // real users (2026-07-06).
        translationUserEnabled = true;
        saveTranslationSettings({ enabled: true });
        emitTranslationState();
        sendStatus('✓ Translation model downloaded');
        console.log('Translation model download complete');

        startLlamaServer();
    }

    function onDownloadError(message, keepPart) {
        console.error('Translation model download error:', message);
        if (!keepPart) {
            try { fs.unlinkSync(partPath); } catch {}
        }
        translationDownloading = false;
        emitTranslationState();
        sendStatus(`❌ Translation model download failed: ${message}. Please try again.`);
    }

    function fetchUrl(url, redirectsLeft) {
        if (redirectsLeft <= 0) {
            onDownloadError('Too many redirects', false);
            return;
        }

        let parsedUrl;
        try { parsedUrl = new URL(url); } catch {
            onDownloadError(`Invalid URL: ${url}`, false);
            return;
        }

        const lib = parsedUrl.protocol === 'https:' ? https : http;
        const port = parsedUrl.port
            ? Number(parsedUrl.port)
            : (parsedUrl.protocol === 'https:' ? 443 : 80);

        const reqHeaders = {};
        if (startByte > 0) reqHeaders['Range'] = `bytes=${startByte}-`;

        const req = lib.get({
            hostname: parsedUrl.hostname,
            port,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: reqHeaders
        }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                res.resume();
                fetchUrl(res.headers.location, redirectsLeft - 1);
                return;
            }

            // If server ignores Range and returns 200, restart from zero
            let writeFlags = 'a';
            if (res.statusCode === 200 && startByte > 0) {
                startByte = 0;
                bytesReceived = 0;
                hash = crypto.createHash('sha256');
                try { fs.unlinkSync(partPath); } catch {}
                writeFlags = 'w';
            } else if (res.statusCode !== 206 && res.statusCode !== 200) {
                res.resume();
                onDownloadError(`HTTP ${res.statusCode}`, false);
                return;
            }

            const ws = fs.createWriteStream(partPath, { flags: writeFlags });
            // Hash/progress via 'data' listener; pipe() handles disk backpressure
            // (a manual ws.write() loop would buffer unboundedly on slow disks).
            res.on('data', (chunk) => {
                hash.update(chunk);
                bytesReceived += chunk.length;
                const pct = Math.floor(bytesReceived / TRANSLATION_MODEL_SIZE * 100);
                if (pct !== translationProgress) {
                    translationProgress = pct;
                    emitTranslationState();
                }
            });
            res.pipe(ws);
            ws.on('finish', onDownloadComplete);
            ws.on('error', (err) => onDownloadError(err.message, true));
            res.on('error', (err) => {
                ws.destroy();
                onDownloadError(err.message, true);
            });
        });

        req.on('error', (err) => onDownloadError(err.message, true));
    }

    fetchUrl(TRANSLATION_MODEL_URL, 5);
}

// --- llama-server lifecycle ---
function llamaDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'llama')
        : path.join(__dirname, 'resources', 'llama');
}

// llama-server responds HTTP 503 on /health while the model loads;
// only 200 means ready. Connection refused is also still-loading.
function waitForLlamaReady() {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const poll = () => {
            if (!llamaProcess) return reject(new Error('llama-server exited during startup'));
            const req = http.get({ host: '127.0.0.1', port: llamaPort, path: '/health' }, (res) => {
                res.resume();
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    // 503 = model still loading; keep polling
                    if (++attempts > 120) reject(new Error('llama-server did not become ready'));
                    else setTimeout(poll, 1000);
                }
            });
            req.on('error', () => {
                // Connection refused = still starting
                if (++attempts > 120) reject(new Error('llama-server did not become ready'));
                else setTimeout(poll, 1000);
            });
        };
        setTimeout(poll, 1000);
    });
}

async function startLlamaServer() {
    if (llamaProcess || llamaStarting) return;
    llamaStarting = true;
    llamaStopping = false;

    const bin = path.join(llamaDir(), 'llama-server');
    const modelPath = translationModelPath();

    if (!fs.existsSync(bin)) {
        console.error(`llama-server binary missing at ${bin}`);
        sendStatus('❌ Offline translation binary is missing.');
        llamaStarting = false;
        return;
    }

    if (!fs.existsSync(modelPath)) {
        console.error(`Translation model missing at ${modelPath}`);
        sendStatus('❌ Translation model is missing. Please download it first.');
        llamaStarting = false;
        return;
    }

    sendStatus('⏳ Loading offline translation model, please wait...');
    try {
        llamaPort = await findFreePort();
        const args = [
            '-m', modelPath,
            '--host', '127.0.0.1',
            '--port', String(llamaPort),
            '-ngl', '99',
            '--ctx-size', '4096'
        ];

        console.log(`Starting llama-server on port ${llamaPort}...`);
        llamaProcess = spawn(bin, args);
        llamaProcess.stdout.on('data', (d) => console.log('llama-server:', d.toString().trim()));
        llamaProcess.stderr.on('data', (d) => console.log('llama-server:', d.toString().trim()));
        llamaProcess.on('error', (err) => {
            console.error(`llama-server spawn error: ${err.message}`);
            sendStatus(`❌ Could not start offline translation: ${err.message}`);
        });
        llamaProcess.on('close', (code) => {
            console.log(`llama-server exited with code ${code}`);
            llamaProcess = null;
            llamaReady = false;
            emitTranslationState();
            emitOfflineLanguages();
            if (appIsQuitting || llamaStopping || code === 0) {
                llamaStopping = false;
                return;
            }
            llamaRestarts++;
            if (llamaRestarts > LLAMA_MAX_RESTARTS) {
                sendStatus('❌ Offline translation keeps crashing. Please restart the app or contact support.');
                return;
            }
            sendStatus(`❌ Offline translation crashed (code ${code}). Restarting...`);
            setTimeout(() => startLlamaServer(), 2000 * llamaRestarts);
        });

        await waitForLlamaReady();
        llamaReady = true;
        llamaRestarts = 0;
        console.log('llama-server ready');
        emitTranslationState();
        emitOfflineLanguages();
        sendStatus('✓ Offline Spanish translation ready');
    } catch (err) {
        console.error(`llama-server startup failed: ${err.message}`);
        sendStatus(`❌ Offline translation failed to start: ${err.message}`);
        if (llamaProcess) llamaProcess.kill();
    } finally {
        llamaStarting = false;
    }
}

function stopLlamaServer() {
    if (llamaProcess) {
        llamaStopping = true;
        llamaProcess.kill();
        llamaProcess = null;
    }
    llamaReady = false;
    emitTranslationState();
    emitOfflineLanguages();
}

// --- Translation pipeline ---
const TRANSLATION_SYSTEM_PROMPT =
`You are translating live English captions from a church service into natural Latin American Spanish, in real time. Rules:
- Output ONLY the Spanish translation. No explanations.
- Scripture quotations should follow Reina-Valera phrasing (e.g. 'begotten son' = 'Hijo unigénito', 'Let us pray' = 'Oremos').
- Captions may be sentence fragments cut mid-thought; translate exactly what is given, never complete or extend the thought.
- Prefer simple, natural wording a Spanish-speaking congregation would hear from a live interpreter.

Example: 'Please turn with me to the book of John' -> 'Por favor, abran sus Biblias conmigo en el libro de Juan'
Example: 'and he said unto them, follow me and I will make you' -> 'y les dijo: síganme y los haré'`;

function queueTranslation(text) {
    if (translationQueue.length >= 3) {
        console.warn('Translation queue full, dropping oldest item');
        translationQueue.shift();
    }
    translationQueue.push(text);
    if (!translationInFlight) processTranslationQueue();
}

function processTranslationQueue() {
    if (translationInFlight || translationQueue.length === 0) return;
    const text = translationQueue.shift();
    translationInFlight = true;

    const body = JSON.stringify({
        messages: [
            { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
            { role: 'user', content: text }
        ],
        temperature: 0,
        max_tokens: 256
    });

    const req = http.request({
        host: '127.0.0.1',
        port: llamaPort,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        }
    }, (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                const translated = (result.choices?.[0]?.message?.content || '').trim();
                if (translated) {
                    if (broadcasterSocket) {
                        try { broadcasterSocket.emit('translated-text', { lang: 'es', text: translated }); } catch (e) {}
                    }
                    listeners.forEach((l) => {
                        try { l.emit('translated-text', { lang: 'es', text: translated }); } catch (e) {}
                    });
                }
            } catch (err) {
                console.error('Translation response parse error:', err.message);
            }
            translationInFlight = false;
            processTranslationQueue();
        });
    });

    req.setTimeout(25000, () => req.destroy(new Error('translation timed out')));
    req.on('error', (err) => {
        console.error('Translation request error:', err.message);
        translationInFlight = false;
        processTranslationQueue();
    });
    req.end(body);
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
        socket.emit('offline-translation-state', offlineTranslationState());
        if (translationAppleArm64 && translationUserEnabled && translationModelPresent) {
            startLlamaServer();  // idempotent: no-op if llamaProcess || llamaStarting
        }
    });

    socket.on('listener', () => {
        listeners.set(socket.id, socket);
        console.log(`Listener registered: ${socket.id}`);
        // Send current translation state to new listener
        socket.emit('translation-state', translationEnabled);
        const offlineLangs = (translationUserEnabled && llamaReady) ? ['es'] : [];
        socket.emit('offline-languages', offlineLangs);
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

    socket.on('offline-translation-download', () => {
        if (socket !== broadcasterSocket) return;
        startModelDownload();
    });

    socket.on('offline-translation-enable', () => {
        if (socket !== broadcasterSocket) return;
        if (!translationModelPresent) return;
        translationUserEnabled = true;
        saveTranslationSettings({ enabled: true });
        emitTranslationState();
        startLlamaServer();
    });

    socket.on('offline-translation-disable', () => {
        if (socket !== broadcasterSocket) return;
        translationUserEnabled = false;
        saveTranslationSettings({ enabled: false });
        stopLlamaServer();
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
                {
                    label: 'Remove Downloaded Translation Model…',
                    click: async () => {
                        const modelPath = translationModelPath();
                        if (!fs.existsSync(modelPath)) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: 'No Model Found',
                                message: 'No translation model is currently downloaded.',
                                buttons: ['OK']
                            });
                            return;
                        }
                        const { response } = await dialog.showMessageBox(mainWindow, {
                            type: 'question',
                            title: 'Remove Translation Model',
                            message: 'Remove the downloaded translation model?',
                            detail: 'This will free approximately 2.5 GB of disk space. Spanish offline captions will require re-downloading the model.',
                            buttons: ['Remove', 'Cancel'],
                            defaultId: 1,
                            cancelId: 1
                        });
                        if (response === 0) {
                            translationUserEnabled = false;
                            saveTranslationSettings({ enabled: false });
                            stopLlamaServer();
                            try { fs.unlinkSync(modelPath); } catch {}
                            try { fs.unlinkSync(modelPath + '.part'); } catch {}
                            translationModelPresent = false;
                            emitTranslationState();
                        }
                    }
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
                {
                    label: 'Third-Party Licenses',
                    click: () => shell.openPath(
                        app.isPackaged
                            ? path.join(process.resourcesPath, 'THIRD_PARTY_LICENSES.txt')
                            : path.join(__dirname, 'THIRD_PARTY_LICENSES.txt')
                    )
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

    translationAppleArm64 = await detectAppleSilicon();
    const translationSettings = loadTranslationSettings();
    translationUserEnabled = translationSettings.enabled;
    checkModelPresent();

    buildMenu();
    const { ip, port } = await startServer();
    createBroadcasterWindow(ip, port);
});

app.on('will-quit', () => {
    appIsQuitting = true;
    if (whisperProcess) whisperProcess.kill();
    if (llamaProcess) llamaProcess.kill();
    server.close();
});
