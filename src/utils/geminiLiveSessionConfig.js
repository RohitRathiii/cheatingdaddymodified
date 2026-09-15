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
            parts: [{ text: systemPrompt }],
        },
    };
}

module.exports = { buildGeminiLiveSessionConfig, isLiveServerInterrupt };
