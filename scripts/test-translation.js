// End-to-end offline-translation test.
//
// Connects a broadcaster (streams a WAV like scripts/test-transcription.js)
// AND a listener. Enables offline translation via the broadcaster socket and
// verifies the listener receives Spanish 'translated-text' events.
//
// Start the app with a known token and a pre-downloaded model:
//   BROADCASTER_TOKEN=devtest TRANSLATION_MODEL_PATH=/path/to/gemma.gguf npm start
// Then:
//   BROADCASTER_TOKEN=devtest APP_URL=http://localhost:<port> \
//     node scripts/test-translation.js /tmp/speech44k.wav 45
const fs = require('fs');
const { io } = require('socket.io-client');

const wavPath = process.argv[2];
const runSeconds = Number(process.argv[3] || 45);
const url = process.env.APP_URL || 'http://localhost:3000';
if (!wavPath) {
    console.error('Usage: node scripts/test-translation.js <file.wav> [durationSeconds]');
    process.exit(1);
}

const SAMPLE_RATE = 44100;
const CHUNK_SAMPLES = 4096;
const pcm = fs.readFileSync(wavPath).subarray(44);

const english = [];
const spanish = [];
let offset = 0;

const broadcaster = io(url, { transports: ['websocket'] });
const listener = io(url, { transports: ['websocket'] });

broadcaster.on('connect', () => {
    console.log('[broadcaster] connected');
    broadcaster.emit('broadcaster', process.env.BROADCASTER_TOKEN || null);
    broadcaster.emit('start-transcription');
});
broadcaster.on('python-status', (msg) => console.log('[status]', msg));
broadcaster.on('offline-translation-state', (s) => {
    console.log('[state]', JSON.stringify(s));
    if (s.supported && s.modelPresent && !s.enabled) {
        console.log('[broadcaster] enabling offline translation...');
        broadcaster.emit('offline-translation-enable');
    }
});

listener.on('connect', () => {
    console.log('[listener] connected');
    listener.emit('listener');
});
listener.on('offline-languages', (langs) => console.log('[listener] offline languages:', langs));
listener.on('transcribed-text', ({ text }) => {
    english.push(text);
    console.log('[EN]', text);
});
listener.on('translated-text', ({ lang, text }) => {
    spanish.push(text);
    console.log(`[${lang.toUpperCase()}]`, text);
});

const timer = setInterval(() => {
    if (!broadcaster.connected) return;
    let chunk = pcm.subarray(offset, offset + CHUNK_SAMPLES * 2);
    offset += CHUNK_SAMPLES * 2;
    if (offset >= pcm.length) offset = 0;
    broadcaster.emit('audio-chunk', chunk);
}, Math.round(CHUNK_SAMPLES / SAMPLE_RATE * 1000));

setTimeout(() => {
    clearInterval(timer);
    broadcaster.emit('stop-transcription');
    broadcaster.close();
    listener.close();
    console.log(`\n=== English captions: ${english.length}, Spanish translations: ${spanish.length} ===`);
    process.exit(english.length > 0 && spanish.length > 0 ? 0 : 1);
}, runSeconds * 1000);
