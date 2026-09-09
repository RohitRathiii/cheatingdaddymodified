class ConnectionGeneration {
    constructor({ random = Math.random } = {}) {
        this.random = random;
        this.current = 0;
        this.stopped = true;
    }

    begin() {
        this.stopped = false;
        return ++this.current;
    }

    stop() {
        this.stopped = true;
        this.current++;
    }

    isCurrent(generation) {
        return !this.stopped && generation === this.current;
    }

    retryDelay(attempt) {
        const base = Math.min(8000, 1000 * 2 ** Math.max(0, attempt));
        const jitter = 0.9 + this.random() * 0.2;
        return Math.round(base * jitter);
    }
}

module.exports = { ConnectionGeneration };
