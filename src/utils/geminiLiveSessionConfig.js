// 3.8 Live keeps proactive audio on, so it may skip speech it thinks is not addressed to it.
// The audio here is the other meeting participants, so state explicitly that it is for the model.
const LIVE_ALWAYS_RESPOND_INSTRUCTION =
    "The speech you hear is the other participant(s) in the user's meeting (interviewer, prospect, colleague), captured from the user's computer. Treat all of it as directed at you. Respond to every turn that contains a question, request, or point the user may need to answer. Never stay silent because the speech seems to be between other people.";

// Spoken answers cannot carry indented code, so code is written by a text model in a separate card.
const LIVE_CODE_HANDOFF_INSTRUCTION =
    'When a question asks for code, do not read code aloud. Give the approach in two or three short sentences; the full code is shown to the user separately.';

function isLiveServerInterrupt(message) {
    return Boolean(message?.serverContent?.interrupted);
}

function languageCodes(language) {
    return language ? [language] : ['en-US'];
}

function silenceDurationMs(vadPreset) {
    return vadPreset === 'patient' ? 1200 : 800;
}

function buildGeminiLiveSessionConfig({
    language = 'en-US',
    vadPreset = 'fast',
    tools = [],
    systemPrompt = '',
    sessionResumptionHandle = null,
} = {}) {
    return {
        generationConfig: {
            responseModalities: ['AUDIO'],
            mediaResolution: 'MEDIA_RESOLUTION_HIGH',
        },
        sessionResumption: sessionResumptionHandle ? { handle: sessionResumptionHandle } : {},
        outputAudioTranscription: {
            languageCodes: languageCodes(language),
        },
        tools,
        inputAudioTranscription: {
            languageCodes: languageCodes(language),
        },
        realtimeInputConfig: {
            automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
                endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                prefixPaddingMs: 20,
                silenceDurationMs: silenceDurationMs(vadPreset),
            },
            activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
            turnCoverage: 'TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO',
        },
        contextWindowCompression: {
            triggerTokens: '25000',
            slidingWindow: { targetTokens: '8000' },
        },
        systemInstruction: {
            parts: [{ text: [systemPrompt, LIVE_ALWAYS_RESPOND_INSTRUCTION, LIVE_CODE_HANDOFF_INSTRUCTION].filter(Boolean).join('\n\n') }],
        },
    };
}

module.exports = { buildGeminiLiveSessionConfig, isLiveServerInterrupt, LIVE_ALWAYS_RESPOND_INSTRUCTION, LIVE_CODE_HANDOFF_INSTRUCTION };
