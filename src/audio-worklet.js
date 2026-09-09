class MeetingPcmProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.frameSamples = Math.max(1, options.processorOptions?.frameSamples || Math.floor(sampleRate * 0.04));
        this.pending = new Float32Array(this.frameSamples);
        this.offset = 0;
        this.sequence = 0;
    }

    process(inputs) {
        const channels = inputs[0] || [];
        if (!channels.length) return true;
        for (let index = 0; index < channels[0].length; index++) {
            let value = 0;
            for (const channel of channels) value += channel[index] || 0;
            this.pending[this.offset++] = Math.max(-1, Math.min(1, value / channels.length));
            if (this.offset === this.frameSamples) {
                const pcm = new Int16Array(this.frameSamples);
                for (let sample = 0; sample < this.frameSamples; sample++) {
                    const normalized = this.pending[sample];
                    pcm[sample] = normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff;
                }
                this.port.postMessage({ sequence: this.sequence++, capturedAt: Date.now(), pcm: pcm.buffer }, [pcm.buffer]);
                this.offset = 0;
            }
        }
        return true;
    }
}

registerProcessor('meeting-pcm-processor', MeetingPcmProcessor);
