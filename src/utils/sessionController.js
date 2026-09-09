/**
 * @typedef {'idle'|'starting'|'active'|'reconnecting'|'stopping'} SessionState
 * @typedef {{startProvider: Function, startCapture: Function, stopProvider: Function, stopCapture: Function, onStateChange?: Function}} SessionOperations
 */

/** Owns one meeting lifecycle and invalidates asynchronous work from older meetings. */
class SessionController {
    /** @param {SessionOperations} operations */
    constructor({ startProvider, startCapture, stopProvider, stopCapture, onStateChange = () => {} }) {
        this.operations = { startProvider, startCapture, stopProvider, stopCapture };
        this.onStateChange = onStateChange;
        this.state = 'idle';
        this.generation = 0;
        this.startPromise = null;
        this.cleanupPromise = null;
    }

    /** @param {SessionState} state */
    setState(state) {
        this.state = state;
        this.onStateChange(state, this.generation);
    }

    isCurrent(generation) {
        return generation === this.generation && this.state !== 'stopping' && this.state !== 'idle';
    }

    async start(options = {}) {
        if (this.state !== 'idle') {
            return { success: false, state: this.state, error: 'A meeting is already starting or active' };
        }

        const generation = ++this.generation;
        this.setState('starting');
        this.cleanupPromise = null;
        this.startPromise = (async () => {
            try {
                const provider = await this.operations.startProvider(generation, options);
                if (!this.isCurrent(generation)) {
                    await this.operations.stopProvider();
                    throw new Error('Meeting start was cancelled');
                }
                const capture = await this.operations.startCapture(generation, options);
                if (!this.isCurrent(generation)) {
                    await Promise.allSettled([this.operations.stopCapture(), this.operations.stopProvider()]);
                    throw new Error('Meeting start was cancelled');
                }
                this.setState('active');
                return { success: true, state: this.state, generation, provider, capture };
            } catch (error) {
                await this.cleanup(generation);
                return { success: false, state: this.state, generation, error: error.message };
            } finally {
                this.startPromise = null;
            }
        })();
        return this.startPromise;
    }

    async cleanup(generation) {
        if (this.cleanupPromise) return this.cleanupPromise;
        this.cleanupPromise = (async () => {
            this.setState('stopping');
            this.generation = Math.max(this.generation, generation) + 1;
            await Promise.allSettled([this.operations.stopCapture(), this.operations.stopProvider()]);
            this.setState('idle');
            return { success: true, state: this.state };
        })();
        return this.cleanupPromise;
    }

    async stop() {
        if (this.state === 'idle') return { success: true, state: 'idle' };
        return this.cleanup(this.generation);
    }
}

module.exports = { SessionController };
