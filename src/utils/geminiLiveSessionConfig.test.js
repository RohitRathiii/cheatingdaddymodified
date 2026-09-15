const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGeminiLiveSessionConfig, isLiveServerInterrupt } = require('./geminiLiveSessionConfig');

function serialized(config) {
    return JSON.stringify(config);
}

test('builds a 3.8 Live setup without thinking or speech language codes', () => {
    const config = buildGeminiLiveSessionConfig({
        language: 'en-US',
        vadPreset: 'fast',
        tools: [{ functionDeclarations: [{ name: 'search_meeting', behavior: 'BLOCKING' }] }],
        systemPrompt: 'Be brief.',
        sessionResumptionHandle: null,
    });

    const json = serialized(config);
    assert.equal(json.includes('thinkingLevel'), false);
    assert.equal(json.includes('thinkingConfig'), false);
    assert.equal(json.includes('speechConfig'), false);
    assert.equal(json.includes('"languageCode"'), false);
    assert.deepEqual(config.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(config.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_HIGH');
    assert.deepEqual(config.outputAudioTranscription.languageCodes, ['en-US']);
    assert.deepEqual(config.inputAudioTranscription.languageCodes, ['en-US']);
    assert.equal(config.systemInstruction.parts[0].text, 'Be brief.');
});

test('uses video turn coverage, barge-in, and a 20ms VAD prefix', () => {
    const config = buildGeminiLiveSessionConfig({
        language: 'en-US',
        vadPreset: 'fast',
        tools: [],
        systemPrompt: 'x',
    });

    assert.equal(config.realtimeInputConfig.turnCoverage, 'TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO');
    assert.equal(config.realtimeInputConfig.activityHandling, 'START_OF_ACTIVITY_INTERRUPTS');
    assert.equal(config.realtimeInputConfig.automaticActivityDetection.prefixPaddingMs, 20);
    assert.equal(config.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity, 'START_SENSITIVITY_LOW');
    assert.equal(config.realtimeInputConfig.automaticActivityDetection.endOfSpeechSensitivity, 'END_SENSITIVITY_LOW');
    assert.equal(config.realtimeInputConfig.automaticActivityDetection.disabled, false);
    assert.equal(config.realtimeInputConfig.automaticActivityDetection.silenceDurationMs, 800);
    assert.equal(config.contextWindowCompression.triggerTokens, '25000');
    assert.equal(config.contextWindowCompression.slidingWindow.targetTokens, '8000');
});

test('patient VAD still maps to 1200ms silence', () => {
    const config = buildGeminiLiveSessionConfig({
        language: 'fr-FR',
        vadPreset: 'patient',
        tools: [],
        systemPrompt: 'x',
    });

    assert.equal(config.realtimeInputConfig.automaticActivityDetection.silenceDurationMs, 1200);
    assert.deepEqual(config.outputAudioTranscription.languageCodes, ['fr-FR']);
});

test('passes tools through and resumes with a handle', () => {
    const tools = [{ functionDeclarations: [{ name: 'search_meeting', behavior: 'BLOCKING' }] }];
    const config = buildGeminiLiveSessionConfig({
        language: 'en-US',
        vadPreset: 'fast',
        tools,
        systemPrompt: 'x',
        sessionResumptionHandle: 'handle-1',
    });

    assert.equal(config.tools, tools);
    assert.deepEqual(config.sessionResumption, { handle: 'handle-1' });
    assert.equal(config.tools[0].functionDeclarations[0].behavior, 'BLOCKING');
});

test('detects Live barge-in interrupts', () => {
    assert.equal(isLiveServerInterrupt({ serverContent: { interrupted: true } }), true);
    assert.equal(isLiveServerInterrupt({ serverContent: { turnComplete: true } }), false);
    assert.equal(isLiveServerInterrupt({}), false);
});
