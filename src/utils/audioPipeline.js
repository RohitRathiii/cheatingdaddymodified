/** @typedef {{generation:number, source:'single'|'mixed'|'system'|'microphone', sequence:number, capturedAt:number, sampleRate:16000|24000, pcm:Buffer|ArrayBuffer}} AudioFrame */

class BoundedAudioQueue {
    /** @param {{sampleRate:number,maxDurationMs:number,onGap?:(gap:{sequence:number,capturedAt:number,reason:string})=>void}} options */
    constructor({ sampleRate, maxDurationMs, onGap = () => {} }) {
        this.sampleRate = sampleRate;
        this.maxSamples = Math.floor((sampleRate * maxDurationMs) / 1000);
        this.onGap = onGap;
        this.frames = [];
        this.samples = 0;
    }

    /** @param {AudioFrame} frame */
    push(frame) {
        const samples = Math.floor(frame.pcm.byteLength / 2);
        this.frames.push(frame);
        this.samples += samples;
        while (this.samples > this.maxSamples && this.frames.length) {
            const dropped = this.frames.shift();
            this.samples -= Math.floor(dropped.pcm.byteLength / 2);
            this.onGap({ sequence: dropped.sequence, capturedAt: dropped.capturedAt, reason: 'audio-backpressure' });
        }
    }

    shift() {
        const frame = this.frames.shift();
        if (frame) this.samples -= Math.floor(frame.pcm.byteLength / 2);
        return frame;
    }

    clear() {
        this.frames = [];
        this.samples = 0;
    }

    get length() {
        return this.frames.length;
    }

    get durationMs() {
        return (this.samples / this.sampleRate) * 1000;
    }
}

class PcmChunker {
    constructor({ sampleRate, durationMs }) {
        this.frameSamples = Math.floor((sampleRate * durationMs) / 1000);
        this.remainder = new Int16Array(0);
    }

    write(samples) {
        const combined = new Int16Array(this.remainder.length + samples.length);
        combined.set(this.remainder);
        combined.set(samples, this.remainder.length);
        const chunks = [];
        let offset = 0;
        while (combined.length - offset >= this.frameSamples) {
            chunks.push(combined.slice(offset, offset + this.frameSamples));
            offset += this.frameSamples;
        }
        this.remainder = combined.slice(offset);
        return chunks;
    }

    clear() {
        this.remainder = new Int16Array(0);
    }

    get bufferedSamples() {
        return this.remainder.length;
    }
}

function mixPcm16(first, second) {
    const length = Math.max(first?.length || 0, second?.length || 0);
    const mixed = new Int16Array(length);
    for (let index = 0; index < length; index++) {
        const sample = (first?.[index] || 0) + (second?.[index] || 0);
        mixed[index] = Math.max(-32768, Math.min(32767, sample));
    }
    return mixed;
}

/** @param {AudioFrame} frame */
function validateAudioFrame(frame) {
    if (!frame || !Number.isSafeInteger(frame.generation) || frame.generation < 0) throw new Error('Invalid audio generation');
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0) throw new Error('Invalid audio sequence');
    if (!Number.isFinite(frame.capturedAt) || frame.capturedAt <= 0) throw new Error('Invalid audio timestamp');
    if (frame.sampleRate !== 16000 && frame.sampleRate !== 24000) throw new Error('Unsupported audio sample rate');
    if (!['single', 'mixed', 'system', 'microphone'].includes(frame.source)) throw new Error('Invalid audio source');
    const pcm = Buffer.isBuffer(frame.pcm) ? frame.pcm : Buffer.from(frame.pcm || new ArrayBuffer(0));
    if (!pcm.length || pcm.length > 64 * 1024 || pcm.length % 2 !== 0) throw new Error('Invalid audio frame size');
    return { ...frame, pcm };
}

module.exports = { BoundedAudioQueue, PcmChunker, mixPcm16, validateAudioFrame };
