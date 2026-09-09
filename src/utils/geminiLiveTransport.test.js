const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GeminiLiveTransport } = require('./geminiLiveTransport');

class FakeSocket {
    static OPEN = 1;
    constructor() {
        this.readyState = 1;
        this.bufferedAmount = 0;
        this.handlers = {};
        this.sent = [];
    }
    on(name, handler) {
        this.handlers[name] = handler;
    }
    send(value) {
        this.sent.push(JSON.parse(value));
    }
    close() {}
}

test('uses public Live setup/realtime envelopes and exposes socket buffering', () => {
    const socket = new FakeSocket();
    const transport = new GeminiLiveTransport(socket, {});
    transport.sendSetup({ model: 'models/test', generationConfig: { responseModalities: ['AUDIO'] } });
    transport.sendRealtimeInput({ audio: { data: 'abc', mimeType: 'audio/pcm;rate=16000' } });
    assert.deepEqual(socket.sent[0], { setup: { model: 'models/test', generationConfig: { responseModalities: ['AUDIO'] } } });
    assert.deepEqual(socket.sent[1], { realtimeInput: { audio: { data: 'abc', mimeType: 'audio/pcm;rate=16000' } } });
    socket.bufferedAmount = 1234;
    assert.equal(transport.bufferedBytes, 1234);
});
