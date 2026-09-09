function chooseAnalyzeScreenPath({ providerMode, hasApiKey, hasLiveSession, hasGroq } = {}) {
    if (providerMode === 'cloud') {
        return 'cloud';
    }
    if (providerMode === 'local') {
        return 'local';
    }
    if (hasApiKey) {
        return 'http';
    }
    if (hasLiveSession) {
        return 'live';
    }
    if (hasGroq) {
        return 'groq';
    }
    return 'none';
}

function buildLiveAnalyzeClientContent(data, prompt) {
    const text = String(prompt || '').trim() || 'Analyze this screenshot now. Give the complete answer from what you see.';
    return {
        turns: [
            {
                role: 'user',
                parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text }],
            },
        ],
        turnComplete: true,
    };
}

function sendForcedLiveScreenTurn(session, data, prompt) {
    if (!session) {
        return { success: false, error: 'No active Gemini Live session' };
    }

    try {
        if (typeof session.sendRealtimeInput === 'function') {
            session.sendRealtimeInput({ media: { data, mimeType: 'image/jpeg' } });
            const text = String(prompt || '').trim();
            if (text) {
                session.sendRealtimeInput({ text });
            }
            return { success: true, mode: 'realtime' };
        }

        return { success: false, error: 'Live session cannot send a screen turn' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    chooseAnalyzeScreenPath,
    buildLiveAnalyzeClientContent,
    sendForcedLiveScreenTurn,
};
