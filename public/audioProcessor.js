class AudioChunkProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.isPlaying = false;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const input = inputs[0];

        if (input && input.length > 0) {
            for (let channel = 0; channel < output.length; ++channel) {
                const outputChannel = output[channel];
                const inputChannel = input[channel];
                for (let i = 0; i < outputChannel.length; ++i) {
                    outputChannel[i] = inputChannel[i];
                }
            }
            this.isPlaying = true;
        } else if (this.isPlaying) {
            for (let channel = 0; channel < output.length; ++channel) {
                output[channel].fill(0);
            }
        }

        return true;
    }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);