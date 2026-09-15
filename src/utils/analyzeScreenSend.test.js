const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chooseAnalyzeScreenPath, buildLiveAnalyzeClientContent } = require('./analyzeScreenSend');

test('BYOK with an API key uses HTTP vision so the transcript gets text', () => {
    assert.equal(
        chooseAnalyzeScreenPath({
            providerMode: 'byok',
            hasApiKey: true,
            hasLiveSession: true,
            hasGroq: false,
        }),
        'http'
    );
});

test('Live is only used when there is a session but no HTTP key', () => {
    assert.equal(
        chooseAnalyzeScreenPath({
            providerMode: 'byok',
            hasApiKey: false,
            hasLiveSession: true,
            hasGroq: false,
        }),
        'live'
    );
});

test('buildLiveAnalyzeClientContent completes a user turn with the image', () => {
    const payload = buildLiveAnalyzeClientContent('abc123', 'What is on screen?');
    assert.equal(payload.turnComplete, true);
    assert.equal(payload.turns[0].role, 'user');
    assert.deepEqual(payload.turns[0].parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'abc123' } });
    assert.equal(payload.turns[0].parts[1].text, 'What is on screen?');
});

test('sendForcedLiveScreenTurn prefers client content to interrupt and force a visual answer', () => {
    const { sendForcedLiveScreenTurn, buildLiveAnalyzeClientContent } = require('./analyzeScreenSend');
    const calls = [];
    const session = {
        sendClientContent: payload => calls.push(payload),
        sendRealtimeInput: () => {
            throw new Error('should not use realtime when client content exists');
        },
    };
    const result = sendForcedLiveScreenTurn(session, 'img', 'Read this');
    assert.equal(result.success, true);
    assert.equal(result.mode, 'client-content');
    assert.deepEqual(calls, [buildLiveAnalyzeClientContent('img', 'Read this')]);
});

test('sendForcedLiveScreenTurn falls back to realtime video and text', () => {
    const { sendForcedLiveScreenTurn } = require('./analyzeScreenSend');
    const calls = [];
    const session = {
        sendRealtimeInput: payload => calls.push(payload),
    };
    const result = sendForcedLiveScreenTurn(session, 'img', 'Read this');
    assert.equal(result.success, true);
    assert.equal(result.mode, 'realtime');
    assert.deepEqual(calls, [{ video: { data: 'img', mimeType: 'image/jpeg' } }, { text: 'Read this' }]);
});
