/**
 * AudioWorkletProcessor: captures raw PCM from the microphone and sends
 * Int16-encoded chunks to the main thread via MessagePort.
 *
 * Replaces the deprecated ScriptProcessorNode to avoid a SIGSEGV crash
 * in Chromium 120 (Electron 28) where calling socket.emit() from inside
 * a ScriptProcessorNode.onaudioprocess callback corrupts native memory.
 *
 * Accumulates 32 render quanta (32 × 128 = 4096 samples ≈ 85ms at 48 kHz)
 * before posting, reducing socket.emit calls from ~375/sec to ~12/sec.
 * Fewer, larger chunks arrive more evenly at listeners and eliminate
 * the TCP-batching jitter that caused choppy playback.
 */
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._chunks = [];
        this._chunkSamples = 0;
        this._flushAt = 4096; // 32 × 128 render quanta
    }

    process(inputs) {
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
            this._chunks.push(new Float32Array(input[0]));
            this._chunkSamples += input[0].length;

            if (this._chunkSamples >= this._flushAt) {
                const combined = new Float32Array(this._chunkSamples);
                let offset = 0;
                for (const c of this._chunks) { combined.set(c, offset); offset += c.length; }
                this._chunks = [];
                this._chunkSamples = 0;

                const int16 = new Int16Array(combined.length);
                for (let i = 0; i < combined.length; i++) {
                    const s = Math.max(-1, Math.min(1, combined[i]));
                    int16[i] = s < 0 ? s * 32768 : s * 32767;
                }
                // Transfer the buffer (zero-copy) to the main thread
                this.port.postMessage(int16.buffer, [int16.buffer]);
            }
        }
        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
