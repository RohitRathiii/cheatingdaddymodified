const WebSocket = require('ws');

const LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** @typedef {{onopen?:Function,onmessage?:Function,onerror?:Function,onclose?:Function}} LiveCallbacks */

class GeminiLiveTransport {
    /** @param {WebSocket} socket @param {LiveCallbacks} callbacks */
    constructor(socket, callbacks = {}) {
        this.socket = socket;
        this.callbacks = callbacks;
    }

    get bufferedBytes() {
        return this.socket?.bufferedAmount || 0;
    }

    sendEnvelope(value) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Gemini Live socket is not open');
        this.socket.send(JSON.stringify(value));
    }

    sendSetup(setup) {
        this.sendEnvelope({ setup });
    }

    sendRealtimeInput(input) {
        this.sendEnvelope({ realtimeInput: input });
    }

    sendToolResponse(response) {
        this.sendEnvelope({ toolResponse: response });
    }

    close() {
        this.socket?.close();
    }
}

/** @param {{apiKey:string,model:string,config:Object,callbacks?:LiveCallbacks,timeoutMs?:number,WebSocketImpl?:typeof WebSocket}} options */
function connectGeminiLive({ apiKey, model, config, callbacks = {}, timeoutMs = 15000, WebSocketImpl = WebSocket }) {
    return new Promise((resolve, reject) => {
        const url = `${LIVE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
        const socket = new WebSocketImpl(url);
        const transport = new GeminiLiveTransport(socket, callbacks);
        let settled = false;
        let ready = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            socket.close();
            reject(new Error('Gemini Live setup timed out'));
        }, timeoutMs);

        socket.on('open', () => {
            try {
                transport.sendSetup({ model: model.startsWith('models/') ? model : `models/${model}`, ...config });
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
        socket.on('message', data => {
            try {
                const message = JSON.parse(data.toString());
                if (message.setupComplete && !settled) {
                    settled = true;
                    ready = true;
                    clearTimeout(timeout);
                    callbacks.onopen?.();
                    resolve(transport);
                }
                callbacks.onmessage?.(message);
            } catch (error) {
                callbacks.onerror?.(error);
            }
        });
        socket.on('error', error => {
            callbacks.onerror?.(error);
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(error);
            }
        });
        socket.on('close', (code, reason) => {
            clearTimeout(timeout);
            if (ready) callbacks.onclose?.({ code, reason: reason?.toString() || '' });
            if (!settled) {
                settled = true;
                reject(new Error(`Gemini Live closed during setup (${code})`));
            }
        });
    });
}

module.exports = { GeminiLiveTransport, connectGeminiLive, LIVE_ENDPOINT };
