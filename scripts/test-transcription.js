// End-to-end transcription test.
//
// Connects to a running app instance (npm start) as the broadcaster and
// streams a 44.1 kHz mono 16-bit WAV in real-time-paced chunks, exactly like
// broadcaster.html does (4096 samples every ~93 ms). Prints every
// transcribed-text event received and exits 0 if any arrive.
//
// Usage: node scripts/test-transcription.js <file.wav> [durationSeconds]
//
// The app requires a broadcaster token; start it with a known one:
//   BROADCASTER_TOKEN=devtest npm start
//   BROADCASTER_TOKEN=devtest APP_URL=http://localhost:<port> node scripts/test-transcription.js <file.wav>
const fs = require('fs');
const { io } = require('socket.io-client');

const wavPath = process.argv[2];
const runSeconds = Number(process.argv[3] || 25);
if (!wavPath) {
    console.error('Usage: node scripts/test-transcription.js <file.wav> [durationSeconds]');
    process.exit(1);
}

const SAMPLE_RATE = 44100;
const CHUNK_SAMPLES = 4096;  // matches audio-processor.js accumulation

const pcm = fs.readFileSync(wavPath).subarray(44);  // skip WAV header
const transcripts = [];
let offset = 0;

const socket = io(process.env.APP_URL || 'http://localhost:3000', { transports: ['websocket'] });

socket.on('connect', () => {
    console.log('Connected, registering as broadcaster...');
    socket.emit('broadcaster', process.env.BROADCASTER_TOKEN || null);
    socket.emit('start-transcription');
});

socket.on('python-status', (msg) => console.log('status:', msg));

socket.on('transcribed-text', ({ text }) => {
    transcripts.push(text);
    console.log('TRANSCRIBED:', text);
});

const timer = setInterval(() => {
    if (!socket.connected) return;
    let chunk = pcm.subarray(offset, offset + CHUNK_SAMPLES * 2);
    offset += CHUNK_SAMPLES * 2;
    if (offset >= pcm.length) offset = 0;  // loop the file
    socket.emit('audio-chunk', chunk);
}, Math.round(CHUNK_SAMPLES / SAMPLE_RATE * 1000));

setTimeout(() => {
    clearInterval(timer);
    socket.emit('stop-transcription');
    socket.close();
    console.log(`\n=== ${transcripts.length} transcription(s) received ===`);
    process.exit(transcripts.length > 0 ? 0 : 1);
}, runSeconds * 1000);
