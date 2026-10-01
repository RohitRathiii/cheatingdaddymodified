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
        if (typeof session.sendClientContent === 'function') {
            session.sendClientContent(buildLiveAnalyzeClientContent(data, prompt));
            return { success: true, mode: 'client-content' };
        }

        if (typeof session.sendRealtimeInput === 'function') {
            session.sendRealtimeInput({ video: { data, mimeType: 'image/jpeg' } });
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

const SCREEN_ANALYSIS_MODEL = 'gemini-3.8-flash';
const SCREEN_ANALYSIS_DEFAULT_REQUEST = 'Answer the question or task shown on this screenshot.';
const SCREEN_ANALYSIS_INSTRUCTION = `You answer what is on the user's screen during a live interview or exam. The user reads your reply in an overlay.
Answer the question or task shown on the screenshot directly. No preamble, no acknowledgement, never reply that you understand the instructions.

For a coding task reply in markdown in exactly this shape:

**Approach**
- two to four short bullets

One fenced code block with a language tag containing the complete, runnable solution, properly indented. Match the language already shown on screen; otherwise use the one asked for; otherwise Python.

**Complexity**: time and space on one line, in plain text such as O(n log n) with no LaTeX or $ signs.

For a multiple-choice question give the correct option and a one-line reason. For anything else give the complete answer, concisely.`;

/** @param {{data:string, request?:string, context?:string, contextChars?:number}} options */
function buildScreenAnalysisRequest({ data, request = '', context = '', contextChars = 3000 }) {
    const recent = String(context || '').trim();
    const ask = String(request || '').trim() || SCREEN_ANALYSIS_DEFAULT_REQUEST;
    const text = [recent ? `Recent conversation:\n${recent.slice(-contextChars)}` : '', `Request: ${ask}`].filter(Boolean).join('\n\n');
    return {
        model: SCREEN_ANALYSIS_MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text }] }],
        config: {
            systemInstruction: SCREEN_ANALYSIS_INSTRUCTION,
            thinkingConfig: { thinkingLevel: 'LOW' },
            maxOutputTokens: 4096,
        },
    };
}

// Gives the Live session the screen for voice follow-ups without asking it to answer (turnComplete: false).
function buildLiveScreenContextContent(data, analysisText) {
    return {
        turns: [
            {
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data } },
                    { text: `[Screen analysis shown to the user]\n${String(analysisText || '').trim()}` },
                ],
            },
        ],
        turnComplete: false,
    };
}

module.exports = {
    chooseAnalyzeScreenPath,
    buildLiveAnalyzeClientContent,
    sendForcedLiveScreenTurn,
    SCREEN_ANALYSIS_MODEL,
    SCREEN_ANALYSIS_INSTRUCTION,
    buildScreenAnalysisRequest,
    buildLiveScreenContextContent,
};
