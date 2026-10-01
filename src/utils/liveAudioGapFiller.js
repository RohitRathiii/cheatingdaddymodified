// Gemini 3.8 Live only closes a user turn while trailing audio keeps arriving, and it ignores
// audioStreamEnd. If system audio stops delivering frames after speech, the turn never ends.
// This fills such gaps with a tiny noise floor (digital zeros are avoided on purpose).

/** @param {number} samples @param {number} [amplitude] @param {() => number} [random] */
function createNoiseFrame(samples, amplitude = 8, random = Math.random) {
    const pcm = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index++) {
        pcm.writeInt16LE(Math.round((random() * 2 - 1) * amplitude), index * 2);
    }
    return pcm;
}

class LiveAudioGapFiller {
    /** @param {{sampleRate?:number,frameMs?:number,gapMs?:number,maxCatchUpMs?:number,amplitude?:number,now?:() => number,onFill?:(pcm:Buffer) => void}} options */
    constructor({ sampleRate = 16000, frameMs = 40, gapMs = 300, maxCatchUpMs = 400, amplitude = 8, now = Date.now, onFill = () => {} } = {}) {
        this.frameMs = frameMs;
        this.frameSamples = Math.floor((sampleRate * frameMs) / 1000);
        this.gapMs = gapMs;
        this.maxCatchUpMs = maxCatchUpMs;
        this.amplitude = amplitude;
        this.now = now;
        this.onFill = onFill;
        this.timer = null;
        this.reset();
        this.gapsFilled = 0;
        this.longestGapMs = 0;
    }

    reset() {
        this.lastRealAt = 0;
        this.filledUntil = 0;
        this.inGap = false;
    }

    noteRealFrame() {
        this.lastRealAt = this.now();
        this.inGap = false;
    }

    tick() {
        if (!this.lastRealAt) return 0;
        const now = this.now();
        const gap = now - this.lastRealAt;
        if (gap < this.gapMs) return 0;

        let coveredUntil = Math.max(this.lastRealAt, this.filledUntil);
        if (now - coveredUntil > this.maxCatchUpMs) coveredUntil = now - this.maxCatchUpMs;
        const frames = Math.floor((now - coveredUntil) / this.frameMs);
        if (frames <= 0) return 0;

        if (!this.inGap) {
            this.inGap = true;
            this.gapsFilled++;
        }
        this.longestGapMs = Math.max(this.longestGapMs, gap);
        this.filledUntil = coveredUntil + frames * this.frameMs;
        for (let index = 0; index < frames; index++) {
            this.onFill(createNoiseFrame(this.frameSamples, this.amplitude));
        }
        return frames;
    }

    start() {
        this.stop();
        this.reset();
        this.timer = setInterval(() => this.tick(), this.frameMs);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.reset();
    }

    stats() {
        return { gapsFilled: this.gapsFilled, longestGapMs: Math.round(this.longestGapMs) };
    }
}

module.exports = { LiveAudioGapFiller, createNoiseFrame };
