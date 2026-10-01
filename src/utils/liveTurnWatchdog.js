// Gemini 3.8 Live sometimes streams an answer but withholds turnComplete until interrupted,
// and can stay silent after a typed turn. Either would block the typed-question queue forever.

class LiveTurnWatchdog {
    /** @param {{outputStallMs?:number,firstOutputTimeoutMs?:number,onStall?:Function,onNoOutput?:Function,setTimer?:typeof setTimeout,clearTimer?:typeof clearTimeout}} options */
    constructor({
        outputStallMs = 3000,
        firstOutputTimeoutMs = 15000,
        onStall = () => {},
        onNoOutput = () => {},
        setTimer = setTimeout,
        clearTimer = clearTimeout,
    } = {}) {
        this.outputStallMs = outputStallMs;
        this.firstOutputTimeoutMs = firstOutputTimeoutMs;
        this.onStall = onStall;
        this.onNoOutput = onNoOutput;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.firstOutputTimer = null;
        this.stallTimer = null;
    }

    turnStarted() {
        this.clearFirstOutputTimer();
        this.firstOutputTimer = this.setTimer(() => {
            this.firstOutputTimer = null;
            this.onNoOutput();
        }, this.firstOutputTimeoutMs);
    }

    outputReceived() {
        this.clearFirstOutputTimer();
        this.clearStallTimer();
        this.stallTimer = this.setTimer(() => {
            this.stallTimer = null;
            this.onStall();
        }, this.outputStallMs);
    }

    turnEnded() {
        this.clearFirstOutputTimer();
        this.clearStallTimer();
    }

    stop() {
        this.turnEnded();
    }

    clearFirstOutputTimer() {
        if (this.firstOutputTimer) this.clearTimer(this.firstOutputTimer);
        this.firstOutputTimer = null;
    }

    clearStallTimer() {
        if (this.stallTimer) this.clearTimer(this.stallTimer);
        this.stallTimer = null;
    }

    get armed() {
        return Boolean(this.firstOutputTimer || this.stallTimer);
    }
}

module.exports = { LiveTurnWatchdog };
