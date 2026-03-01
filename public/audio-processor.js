/**
 * AudioWorkletProcessor: captures raw PCM from the microphone and sends
 * Int16-encoded chunks to the main thread via MessagePort.
 *
 * Replaces the deprecated ScriptProcessorNode to avoid a SIGSEGV crash
 * in Chromium 120 (Electron 28) where calling socket.emit() from inside
 * a ScriptProcessorNode.onaudioprocess callback corrupts native memory.
 */
class AudioProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
            const float32 = input[0];
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 32768 : s * 32767;
            }
            // Transfer the buffer (zero-copy) to the main thread
            this.port.postMessage(int16.buffer, [int16.buffer]);
        }
        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
