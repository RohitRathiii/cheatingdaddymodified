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

test('sendForcedLiveScreenTurn uses sendClientContent with turnComplete', () => {
    const { sendForcedLiveScreenTurn } = require('./analyzeScreenSend');
    const calls = [];
    const session = {
        sendClientContent: payload => calls.push(payload),
    };
    const result = sendForcedLiveScreenTurn(session, 'img', 'Read this');
    assert.equal(result.success, true);
    assert.equal(result.mode, 'client-content');
    assert.equal(calls[0].turnComplete, true);
    assert.equal(calls[0].turns[0].parts[1].text, 'Read this');
});
