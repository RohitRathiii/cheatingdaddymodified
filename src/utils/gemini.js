const { GoogleGenAI, ThinkingLevel } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const {
    getApiKey,
    getGroqApiKey,
    incrementCharUsage,
    getModelForToday,
    getPreferences,
    startSessionArchive,
    appendSessionRecord,
    flushSessionArchive,
    getArchivedSession,
} = require('../storage');
const { connectCloud, sendCloudAudio, sendCloudText, sendCloudImage, closeCloud, isCloudActive, setOnTurnComplete } = require('./cloud');
const { captureScreenStill } = require('./screenStill');
const {
    chooseAnalyzeScreenPath,
    sendForcedLiveScreenTurn,
    buildScreenAnalysisRequest,
    buildLiveScreenContextContent,
} = require('./analyzeScreenSend');
const { BoundedAudioQueue, validateAudioFrame } = require('./audioPipeline');
const { ConnectionGeneration } = require('./connectionGeneration');
const { createTurnId, emitAnswer } = require('./answerEvents');
const { buildRelevantContext } = require('./historyStore');
const { BoundedTurnQueue } = require('./boundedTurnQueue');
const { connectGeminiLive } = require('./geminiLiveTransport');
const { buildGeminiLiveSessionConfig, isLiveServerInterrupt } = require('./geminiLiveSessionConfig');
const { LiveAudioGapFiller } = require('./liveAudioGapFiller');
const { LiveTurnWatchdog } = require('./liveTurnWatchdog');
const { formatLiveAnswerText, needsCodeAnswer } = require('./answerFormatting');

// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok', 'cloud', or 'local'
let currentProviderMode = 'byok';

// Groq conversation history for context
let groqConversationHistory = [];

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;
let currentSystemPrompt = null;
let conversationSequence = 0;
let screenSequence = 0;
let transcriptSequence = 0;
let currentSummary = '';
let completedTurnsSinceSummary = 0;
let lastSummaryAt = 0;
let summaryInFlight = false;

const GEMINI_LIVE_MODEL = 'gemini-3.8-live';

function createAnswerStream(prefix, { turnId = createTurnId(prefix), sequenceBase = 0 } = {}) {
    let sequence = sequenceBase;
    let started = false;
    return {
        update(text) {
            emitAnswer(sendToRenderer, turnId, started ? 'update' : 'start', text, sequence++);
            started = true;
        },
        complete(text, status = 'complete') {
            emitAnswer(sendToRenderer, turnId, status, text, sequence++);
        },
    };
}

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = `Speaker ${result.speakerId}`;
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// 3.1 delivers one full utterance (or a cumulative snapshot), not 2.5-style
// character deltas. Replace when the new text is the same turn growing;
// append only when it is a genuinely new fragment.
function mergeLiveInputTranscription(previous, incoming) {
    const next = String(incoming || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!next) {
        return previous || '';
    }
    const prev = String(previous || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!prev) {
        return next;
    }
    if (next === prev) {
        return prev;
    }
    if (next.startsWith(prev)) {
        return next;
    }
    if (prev.startsWith(next)) {
        return prev;
    }
    return `${prev} ${next}`;
}

function ingestLiveInputTranscription(message) {
    const input = message.serverContent?.inputTranscription;
    if (!input) {
        return false;
    }

    let incoming = '';
    if (input.results?.length) {
        incoming = formatSpeakerResults(input.results);
    } else if (input.text) {
        incoming = input.text;
    }
    if (!incoming.trim()) {
        return false;
    }

    currentTranscription = mergeLiveInputTranscription(currentTranscription, incoming);
    return true;
}

function ingestLiveOutputTranscription(message) {
    const incoming = message.serverContent?.outputTranscription?.text;
    if (!incoming || !String(incoming).trim()) {
        return false;
    }

    liveOutputText = mergeLiveInputTranscription(liveOutputText, incoming);
    liveTurnActive = true;
    liveTurnWatchdog.outputReceived();
    if (!liveTurnId) liveTurnId = createTurnId('live');
    emitAnswer(sendToRenderer, liveTurnId, liveOutputStarted ? 'update' : 'start', formatLiveAnswerText(liveOutputText), liveOutputSequence++);
    liveOutputStarted = true;
    sendToRenderer('update-status', 'Responding...');
    return true;
}

function finalizeLiveConversationTurn() {
    liveTurnWatchdog.turnEnded();
    const input = currentTranscription.trim();
    const output = formatLiveAnswerText(liveOutputText);
    if (input && !output) liveUnansweredTurns++;
    liveInputTurnSeq++;
    if (input && currentSessionId) {
        appendSessionRecord(currentSessionId, {
            id: `${currentSessionId}:transcript:${++transcriptSequence}`,
            type: 'transcript',
            timestamp: Date.now(),
            transcription: input,
        }).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
    }
    if (output) {
        if (!liveTurnId) liveTurnId = createTurnId('live');
        emitAnswer(sendToRenderer, liveTurnId, 'complete', output, liveOutputSequence++);
        if (liveTurnId === codeOwnedTurnId) pendingTypedQuestion = null;
        else saveConversationTurn(input || '(audio)', output);
    }
    currentTranscription = '';
    liveOutputText = '';
    liveOutputStarted = false;
    liveTurnId = null;
    liveOutputSequence = 0;
    messageBuffer = '';
    awaitingLateTranscript = false;
    liveTurnActive = false;
    dispatchNextTypedTurn();
}

function resetLiveConversationBuffers() {
    liveTurnWatchdog.turnEnded();
    stalledTurnPending = false;
    liveInputTurnSeq++;
    currentTranscription = '';
    liveOutputText = '';
    liveOutputStarted = false;
    liveTurnId = null;
    liveOutputSequence = 0;
    messageBuffer = '';
    awaitingLateTranscript = false;
    clearTranscriptionSilenceTimer();
    clearLateTranscriptionTimer();
}

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

// Gemini audio send serialization
let geminiSendLock = false;
const geminiAudioQueue = new BoundedAudioQueue({
    sampleRate: 16000,
    maxDurationMs: 2000,
    onGap: gap => console.warn('Dropped stale Gemini audio frame:', gap.sequence),
});
let geminiAudioSequence = 0;
let congestionStartedAt = 0;
let congestionRetryTimer = null;
let liveResampleRemainder = Buffer.alloc(0);
const liveGapFiller = new LiveAudioGapFiller({
    onFill: pcm => {
        if (currentProviderMode === 'byok' && global.geminiSessionRef?.current) enqueueLivePcm(pcm, 16000, global.geminiSessionRef, true);
    },
});
let sessionResumptionHandle = null;
let reconnectInFlight = false;
const liveConnections = new ConnectionGeneration();
let pendingLiveImage = null;
let liveImageSendInFlight = false;
let lastScreenshotJpeg = null;
let pendingTypedQuestion = null;
const typedTurnQueue = new BoundedTurnQueue(3);
let liveTurnActive = false;
let liveTurnId = null;
let liveOutputSequence = 0;
// Set when the watchdog finished a turn itself; the stalled turn's late interrupted/turnComplete is then ignored.
let stalledTurnPending = false;
let liveUnansweredTurns = 0;
let liveStalledTurns = 0;
let liveNoOutputTurns = 0;
const liveTurnWatchdog = new LiveTurnWatchdog({
    onStall: () => {
        console.warn('Gemini Live answer stalled without turnComplete; finishing the turn');
        liveStalledTurns++;
        stalledTurnPending = true;
        finalizeLiveConversationTurn();
        sendToRenderer('update-status', 'Listening...');
    },
    onNoOutput: () => {
        if (liveOutputText.trim()) return;
        console.warn('Gemini Live sent no answer for a typed turn');
        liveNoOutputTurns++;
        liveTurnActive = false;
        pendingTypedQuestion = null;
        sendToRenderer('update-status', 'No answer from Gemini, ask again');
        dispatchNextTypedTurn();
    },
});
global.getMeetingDiagnostics = () => {
    const gaps = liveGapFiller.stats();
    return {
        providerMode: currentProviderMode,
        audioQueueFrames: geminiAudioQueue.length,
        audioQueueMs: Math.round(geminiAudioQueue.durationMs),
        typedQueue: typedTurnQueue.length,
        reconnecting: reconnectInFlight,
        summaryRunning: summaryInFlight,
        audioGapsFilled: gaps.gapsFilled,
        longestAudioGapMs: gaps.longestGapMs,
        liveUnansweredTurns,
        liveStalledTurns,
        liveNoOutputTurns,
    };
};

// 3.1 batches inputTranscription after the utterance, so this timer starts
// once the full text arrives — not mid-sentence like 2.5 incremental chunks.
function clientSilenceTimeoutMs() {
    return getPreferences().vadPreset === 'patient' ? 900 : 600;
}
const LATE_TRANSCRIPT_MS = 800;
let transcriptionSilenceTimer = null;
let lateTranscriptionTimer = null;
let awaitingLateTranscript = false;
let liveOutputText = '';
let liveOutputStarted = false;

// Groq Whisper VAD state
const WHISPER_SILENCE_THRESHOLD = 0.008; // RMS energy below this = silence
const WHISPER_SPEECH_START_FRAMES = 3; // consecutive speech frames to start recording
const WHISPER_SILENCE_END_FRAMES = 10; // consecutive silence frames (~1s) to end utterance
const WHISPER_PRE_BUFFER_FRAMES = 5; // frames before speech start to include
let whisperIsSpeaking = false;
let whisperSpeechFrames = 0;
let whisperSilenceFrames = 0;
let whisperAudioBuffer = []; // Buffers during active speech
let whisperPreBuffer = []; // Rolling pre-speech buffer (last N frames)
let whisperAudioBytes = 0;
let whisperJobs = [];
let whisperJobActive = false;
let whisperJobGeneration = 0;
let previousWhisperTranscript = '';
const MAX_WHISPER_SEGMENT_BYTES = 16000 * 2 * 20;
const WHISPER_OVERLAP_BYTES = 16000;

// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
let reconnectStartedAt = 0;
const MAX_RECONNECT_MS = 60000;

function isFatalConnectionClose(event) {
    return event?.code === 1008 || /auth|api.?key|permission|invalid argument|configuration/i.test(event?.reason || '');
}

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn => `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`);

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = Date.now().toString();
    cancelCodeAnswers();
    conversationSequence = 0;
    screenSequence = 0;
    transcriptSequence = 0;
    resetLiveConversationBuffers();
    conversationHistory = [];
    screenAnalysisHistory = [];
    groqConversationHistory = [];
    lastScreenshotJpeg = null;
    pendingTypedQuestion = null;
    typedTurnQueue.clear();
    liveTurnActive = false;
    currentSummary = '';
    completedTurnsSinceSummary = 0;
    lastSummaryAt = 0;
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    startSessionArchive({
        sessionId: currentSessionId,
        profile,
        customPrompt: customPrompt || '',
    }).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
    console.log('New conversation session started:', currentSessionId, 'profile:', profile);
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const userSide = (pendingTypedQuestion || transcription || '').trim();
    pendingTypedQuestion = null;
    recordConversationTurn(userSide, aiResponse);
}

// Stores a turn without consuming pendingTypedQuestion (used by the separate code card too).
function recordConversationTurn(userSide, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        id: `${currentSessionId}:turn:${++conversationSequence}`,
        type: 'turn',
        timestamp: Date.now(),
        transcription: userSide,
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    if (conversationHistory.length > 200) conversationHistory = conversationHistory.slice(-200);
    console.log('Saved conversation turn:', conversationTurn);

    appendSessionRecord(currentSessionId, conversationTurn).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
    completedTurnsSinceSummary++;
    scheduleMeetingSummary();
}

function scheduleMeetingSummary() {
    if (summaryInFlight || completedTurnsSinceSummary < 12 || (lastSummaryAt && Date.now() - lastSummaryAt < 5 * 60 * 1000)) return;
    const sessionId = currentSessionId;
    const turns = conversationHistory.slice(-12);
    const apiKey = getApiKey();
    if (!sessionId || !apiKey) return;
    summaryInFlight = true;
    Promise.resolve()
        .then(async () => {
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `Update the structured meeting summary. Keep decisions, constraints, names, unresolved questions, and supporting turn IDs. Return concise plain text.\n\nPrevious summary:\n${currentSummary}\n\nNew turns:\n${JSON.stringify(turns)}`;
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite',
                contents: prompt,
                config: { maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
            });
            const summary = String(response.text || '').trim();
            if (!summary || sessionId !== currentSessionId) return;
            currentSummary = summary;
            completedTurnsSinceSummary = 0;
            lastSummaryAt = Date.now();
            await appendSessionRecord(sessionId, {
                id: `${sessionId}:summary:${lastSummaryAt}`,
                type: 'summary',
                timestamp: lastSummaryAt,
                summary,
                supportingTurnIds: turns.map(turn => turn.id),
            });
        })
        .catch(error => console.warn('Background meeting summary failed:', error.message))
        .finally(() => {
            summaryInFlight = false;
        });
}

function saveScreenAnalysis(prompt, response, model) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        id: `${currentSessionId}:screen:${++screenSequence}`,
        type: 'screen',
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model,
    };

    screenAnalysisHistory.push(analysisEntry);
    if (screenAnalysisHistory.length > 100) screenAnalysisHistory = screenAnalysisHistory.slice(-100);
    console.log('Saved screen analysis:', analysisEntry);

    appendSessionRecord(currentSessionId, analysisEntry).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

function buildSessionContextText() {
    return buildRelevantContext({
        query: pendingTypedQuestion || currentTranscription,
        summary: currentSummary,
        records: [...conversationHistory, ...screenAnalysisHistory].sort((a, b) => a.timestamp - b.timestamp),
    });
}

function composeUserTurn(text) {
    const context = buildSessionContextText();
    if (!context) {
        return text;
    }
    return `${context}\n\nCurrent user question (answer using the full conversation and any screen context above):\n${text}`;
}

// Spoken Live answers lose newlines and indentation, so code questions also get a text-model card.
const CODE_ANSWER_MODEL = 'gemini-3.8-flash';
const CODE_ANSWER_DEBOUNCE_MS = 400;
const CODE_ANSWER_CONTEXT_CHARS = 6000;
const CODE_ANSWER_INSTRUCTION = `You write the code part of answers for a live technical interview overlay. The user reads your reply on screen.
Reply in markdown only, with no preamble, in exactly this shape:

**Approach**
- two to four short bullets

One fenced code block with a language tag containing the complete, runnable solution, properly indented, with brief comments only where they help.

**Complexity**: time and space on one line, in plain text such as O(n log n) with no LaTeX or $ signs.

Use the language the question asks for; otherwise the language used earlier in the conversation; otherwise Python.`;
let codeAnswerClient = null;
let codeAnswerClientKey = '';
let codeAnswerGeneration = 0;
let codeAnswerTimer = null;
let liveInputTurnSeq = 0;
let codeAnswerFiredSeq = -1;
// The code answer takes over the Live card for its turn: its updates use sequences far above the
// Live transcript's, so the renderer shows the spoken summary first and then replaces it with the code.
const CODE_SEQUENCE_BASE = 1000000;
let codeOwnedTurnId = null;

function claimLiveCardForCode() {
    if (!liveTurnId) liveTurnId = createTurnId('live');
    codeOwnedTurnId = liveTurnId;
    return liveTurnId;
}

// Shared by the code card and screen analysis so the HTTPS connection stays warm.
function getTextModelClient(apiKey) {
    if (!codeAnswerClient || codeAnswerClientKey !== apiKey) {
        codeAnswerClient = new GoogleGenAI({ apiKey });
        codeAnswerClientKey = apiKey;
    }
    return codeAnswerClient;
}

function cancelCodeAnswers() {
    codeAnswerGeneration++;
    if (codeAnswerTimer) clearTimeout(codeAnswerTimer);
    codeAnswerTimer = null;
}

// 3.x sends the question transcript in snapshots; wait for it to settle, then fire once per turn.
function scheduleCodeAnswerForVoiceTurn() {
    const turnSeq = liveInputTurnSeq;
    const question = currentTranscription.trim();
    if (currentProviderMode !== 'byok' || codeAnswerFiredSeq === turnSeq || !needsCodeAnswer(question)) return;
    if (codeAnswerTimer) clearTimeout(codeAnswerTimer);
    codeAnswerTimer = setTimeout(() => {
        codeAnswerTimer = null;
        if (codeAnswerFiredSeq === turnSeq) return;
        codeAnswerFiredSeq = turnSeq;
        sendCodeAnswer(question, liveInputTurnSeq === turnSeq ? claimLiveCardForCode() : undefined);
    }, CODE_ANSWER_DEBOUNCE_MS);
}

async function sendCodeAnswer(question, turnId) {
    const apiKey = getApiKey();
    if (!apiKey || !question.trim()) return;
    const generation = codeAnswerGeneration;
    const answer = createAnswerStream('code', turnId ? { turnId, sequenceBase: CODE_SEQUENCE_BASE } : {});
    const records = [...conversationHistory, ...screenAnalysisHistory].sort((a, b) => a.timestamp - b.timestamp);
    const context = buildRelevantContext({ query: question, summary: currentSummary, records }).slice(-CODE_ANSWER_CONTEXT_CHARS);
    const userContext = currentCustomPrompt ? `User-provided context:\n${currentCustomPrompt}\n\n` : '';
    const parts = [];
    if (lastScreenshotJpeg && needsVisualContext(question)) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: lastScreenshotJpeg } });
    }
    parts.push({ text: `${userContext}${context ? `Conversation so far:\n${context}\n\n` : ''}Question:\n${question}` });

    try {
        const stream = await getTextModelClient(apiKey).models.generateContentStream({
            model: CODE_ANSWER_MODEL,
            contents: [{ role: 'user', parts }],
            config: {
                systemInstruction: CODE_ANSWER_INSTRUCTION,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                maxOutputTokens: 4096,
            },
        });
        let text = '';
        for await (const chunk of stream) {
            if (generation !== codeAnswerGeneration) return;
            if (chunk.text) {
                text += chunk.text;
                answer.update(text);
            }
        }
        if (generation !== codeAnswerGeneration || !text.trim()) return;
        answer.complete(text.trim());
        recordConversationTurn(question, text);
    } catch (error) {
        console.error('Code answer failed:', error.message);
        if (generation !== codeAnswerGeneration) return;
        // Keep the spoken answer in its card; only report the failure.
        sendToRenderer('update-status', `Code answer failed: ${error.message}`);
    }
}

async function dispatchLiveTypedTurn(userText) {
    const session = global.geminiSessionRef?.current;
    if (!session) return false;
    pendingTypedQuestion = userText;
    liveTurnActive = true;
    try {
        await attachLastScreenshotToLive(session);
        await session.sendRealtimeInput({ text: composeUserTurn(userText) });
        liveTurnWatchdog.turnStarted();
        if (needsCodeAnswer(userText)) sendCodeAnswer(userText, claimLiveCardForCode());
        return true;
    } catch (error) {
        liveTurnActive = false;
        pendingTypedQuestion = null;
        sendToRenderer('update-status', `Could not send message: ${error.message}`);
        dispatchNextTypedTurn();
        return false;
    }
}

function dispatchNextTypedTurn() {
    if (liveTurnActive) return;
    const next = typedTurnQueue.shift();
    if (next) dispatchLiveTypedTurn(next);
}

function rememberScreenshot(base64Data) {
    if (base64Data && typeof base64Data === 'string' && base64Data.length > 100) {
        lastScreenshotJpeg = base64Data;
    }
}

async function attachLastScreenshotToLive(session) {
    if (!session || !lastScreenshotJpeg) return;
    try {
        session.sendRealtimeInput({
            video: {
                data: lastScreenshotJpeg,
                mimeType: 'image/jpeg',
            },
        });
    } catch (error) {
        console.warn('Failed to attach last screenshot to Live session:', error.message);
    }
}

async function getEnabledTools() {
    const tools = [
        {
            functionDeclarations: [
                {
                    name: 'search_meeting',
                    behavior: 'BLOCKING',
                    description: 'Search earlier meeting transcripts and screen analyses for facts relevant to a question.',
                    parameters: {
                        type: 'OBJECT',
                        properties: { query: { type: 'STRING', description: 'The fact or topic to find.' } },
                        required: ['query'],
                    },
                },
            ],
        },
    ];
    const googleSearchEnabled = getPreferences().googleSearchEnabled === true;
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled) {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function answerMeetingSearchTools(message, session, connectionGeneration) {
    const calls = message.toolCall?.functionCalls || [];
    for (const call of calls) {
        if (call.name !== 'search_meeting' || !liveConnections.isCurrent(connectionGeneration)) continue;
        let records = [...conversationHistory, ...screenAnalysisHistory];
        try {
            const archived = currentSessionId ? await getArchivedSession(currentSessionId) : null;
            if (archived) records = [...(archived.conversationHistory || []), ...(archived.screenAnalysisHistory || [])];
        } catch (error) {
            console.warn('Meeting search used in-memory history:', error.message);
        }
        const output = buildRelevantContext({ query: call.args?.query || '', summary: currentSummary, records });
        if (!liveConnections.isCurrent(connectionGeneration)) return;
        session.sendToolResponse({
            functionResponses: [{ id: call.id, name: call.name, response: { output: output || 'No matching meeting context found.' } }],
        });
    }
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

// helper to check if groq has been configured
function hasGroqKey() {
    const key = getGroqApiKey();
    return key && key.trim() != '';
}

function canUseGroqFallback() {
    return currentProviderMode === 'byok' && hasGroqKey() && !sessionParams;
}

const VISUAL_TRIGGER_KEYWORDS = [
    'look at',
    'looking at',
    'this code',
    'this problem',
    'this question',
    'solve this',
    'debug this',
    'this error',
    'this output',
    'this function',
    'this class',
    'this method',
    'this algorithm',
    'this diagram',
    'this slide',
    'this screen',
    'what do you see',
    'what is this',
    'what does this',
    'explain this',
    'analyze this',
    'help me with this',
    'read this',
    "what's on",
    'on the screen',
    'on screen',
    'your screen',
    'the screen',
    'can you see',
    'do you see',
    'visible on',
    'shown here',
    'in the image',
    'on my screen',
    'from the screen',
];

function needsVisualContext(transcription) {
    const lower = transcription.toLowerCase();
    return VISUAL_TRIGGER_KEYWORDS.some(kw => lower.includes(kw));
}

function trimConversationHistoryForGemma(history, maxChars = 42000) {
    if (!history || history.length === 0) return [];
    let totalChars = 0;
    const trimmed = [];

    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        const turnChars = (turn.content || '').length;

        if (totalChars + turnChars > maxChars) break;
        totalChars += turnChars;
        trimmed.unshift(turn);
    }
    return trimmed;
}

function stripThinkingTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function sendToGroq(transcription) {
    const answer = createAnswerStream('groq');
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        console.log('No Groq API key configured, skipping Groq response');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Groq');
        return;
    }

    const modelToUse = getModelForToday();
    if (!modelToUse) {
        console.log('All Groq daily limits exhausted');
        sendToRenderer('update-status', 'Groq limits reached for today');
        return;
    }

    console.log(`Sending to Groq (${modelToUse}):`, transcription.substring(0, 100) + '...');

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    if (groqConversationHistory.length > 20) {
        groqConversationHistory = groqConversationHistory.slice(-20);
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: [{ role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' }, ...groqConversationHistory],
                stream: true,
                temperature: 0.7,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', response.status, errorText);
            sendToRenderer('update-status', `Groq error: ${response.status}`);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);
                        const token = json.choices?.[0]?.delta?.content || '';
                        if (token) {
                            fullText += token;
                            const displayText = stripThinkingTags(fullText);
                            if (displayText) {
                                answer.update(displayText);
                                isFirst = false;
                            }
                        }
                    } catch (parseError) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        const cleanedResponse = stripThinkingTags(fullText);
        const modelKey = modelToUse.split('/').pop();

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = groqConversationHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = cleanedResponse.length;

        incrementCharUsage('groq', modelKey, inputChars + outputChars);

        if (cleanedResponse) {
            answer.complete(cleanedResponse);
            groqConversationHistory.push({
                role: 'assistant',
                content: cleanedResponse,
            });

            saveConversationTurn(transcription, cleanedResponse);
        }

        console.log(`Groq response completed (${modelToUse})`);
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('Error calling Groq API:', error);
        sendToRenderer('update-status', 'Groq error: ' + error.message);
    }
}

async function sendToGemma(transcription) {
    const answer = createAnswerStream('gemma');
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log('No Gemini API key configured');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Gemma');
        return;
    }

    console.log('Sending to Gemma:', transcription.substring(0, 100) + '...');

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    const trimmedHistory = trimConversationHistoryForGemma(groqConversationHistory, 42000);

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const messages = trimmedHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));

        const systemPrompt = currentSystemPrompt || 'You are a helpful assistant.';
        const messagesWithSystem = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
            ...messages,
        ];

        const response = await ai.models.generateContentStream({
            model: 'gemma-3-27b-it',
            contents: messagesWithSystem,
        });

        let fullText = '';
        let isFirst = true;

        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                answer.update(fullText);
                isFirst = false;
            }
        }

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = trimmedHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = fullText.length;

        incrementCharUsage('gemini', 'gemma-3-27b-it', inputChars + outputChars);

        if (fullText.trim()) {
            answer.complete(fullText.trim());
            groqConversationHistory.push({
                role: 'assistant',
                content: fullText.trim(),
            });

            if (groqConversationHistory.length > 40) {
                groqConversationHistory = groqConversationHistory.slice(-40);
            }

            saveConversationTurn(transcription, fullText);
        }

        console.log('Gemma response completed');
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('Error calling Gemma API:', error);
        sendToRenderer('update-status', 'Gemma error: ' + error.message);
    }
}

function dispatchTranscription() {
    if (currentTranscription.trim() === '') return;
    const text = currentTranscription;
    currentTranscription = '';
    console.log('[silence-dispatch] Firing Groq/Gemma after silence timeout');
    if (hasGroqKey()) {
        sendToGroq(text);
    } else {
        sendToGemma(text);
    }
}

function resetTranscriptionSilenceTimer() {
    clearTranscriptionSilenceTimer();
    transcriptionSilenceTimer = setTimeout(dispatchTranscription, clientSilenceTimeoutMs());
}

function clearTranscriptionSilenceTimer() {
    if (transcriptionSilenceTimer) {
        clearTimeout(transcriptionSilenceTimer);
        transcriptionSilenceTimer = null;
    }
}

function clearLateTranscriptionTimer() {
    if (lateTranscriptionTimer) {
        clearTimeout(lateTranscriptionTimer);
        lateTranscriptionTimer = null;
    }
}

function waitForLateLiveTurn() {
    awaitingLateTranscript = true;
    clearLateTranscriptionTimer();
    lateTranscriptionTimer = setTimeout(() => {
        lateTranscriptionTimer = null;
        finalizeLiveConversationTurn();
    }, LATE_TRANSCRIPT_MS);
}

// True when this event belongs to a turn the watchdog already finished and nothing new has streamed since.
function consumeStalledTurnEvent() {
    if (!stalledTurnPending) return false;
    stalledTurnPending = false;
    return !liveOutputText.trim();
}

function handleLiveTurnComplete() {
    if (consumeStalledTurnEvent()) return;
    clearTranscriptionSilenceTimer();
    if (liveOutputText.trim()) {
        finalizeLiveConversationTurn();
    } else {
        waitForLateLiveTurn();
    }
    sendToRenderer('update-status', 'Listening...');
}

function handleLiveInterrupted() {
    if (consumeStalledTurnEvent()) return;
    clearTranscriptionSilenceTimer();
    clearLateTranscriptionTimer();
    awaitingLateTranscript = false;
    const input = currentTranscription.trim();
    const output = formatLiveAnswerText(liveOutputText);
    if (output) {
        if (!liveTurnId) liveTurnId = createTurnId('live');
        emitAnswer(sendToRenderer, liveTurnId, 'interrupted', output, liveOutputSequence++);
        if (liveTurnId === codeOwnedTurnId) pendingTypedQuestion = null;
        else saveConversationTurn(input || '(interrupted audio)', output);
    }
    resetLiveConversationBuffers();
    liveTurnActive = false;
    dispatchNextTypedTurn();
    sendToRenderer('update-status', 'Listening...');
}

function resampleLive24kTo16k(inputBuffer) {
    const combined = Buffer.concat([liveResampleRemainder, inputBuffer]);
    const inputSamples = Math.floor(combined.length / 2);
    const outputSamples = Math.floor((inputSamples * 2) / 3);
    if (outputSamples <= 0) {
        liveResampleRemainder = combined;
        return Buffer.alloc(0);
    }
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
        const srcPos = (i * 3) / 2;
        const srcIndex = Math.floor(srcPos);
        const frac = srcPos - srcIndex;
        const s0 = combined.readInt16LE(srcIndex * 2);
        const s1 = srcIndex + 1 < inputSamples ? combined.readInt16LE((srcIndex + 1) * 2) : s0;
        const interpolated = Math.round(s0 + frac * (s1 - s0));
        outputBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }
    const consumedInputSamples = Math.ceil((outputSamples * 3) / 2);
    const remainderStart = consumedInputSamples * 2;
    liveResampleRemainder = remainderStart < combined.length ? combined.slice(remainderStart) : Buffer.alloc(0);
    return outputBuffer;
}

function enqueueLivePcm(monoPcm, sampleRate, sessionRef, isSynthetic = false) {
    if (!isSynthetic) liveGapFiller.noteRealFrame();
    const session = sessionRef?.current;
    if (!session || !monoPcm?.length) return;
    const pcm16k = sampleRate === 16000 ? monoPcm : resampleLive24kTo16k(monoPcm);
    if (!pcm16k.length) return;
    geminiAudioQueue.push({ sequence: geminiAudioSequence++, capturedAt: Date.now(), pcm: pcm16k });
    drainGeminiQueue(sessionRef);
}

function sendImageToGeminiLive(session, data, prompt) {
    if (!session) {
        return { success: false, error: 'No active Gemini Live session' };
    }
    pendingLiveImage = { data, prompt: prompt || '' };
    const result = flushPendingLiveImage(session);
    if (result && result.success === false) {
        return result;
    }
    return { success: true, model: GEMINI_LIVE_MODEL };
}

function flushPendingLiveImage(session) {
    if (liveImageSendInFlight || !pendingLiveImage || !session) return;
    liveImageSendInFlight = true;
    const { data, prompt } = pendingLiveImage;
    pendingLiveImage = null;
    try {
        return sendForcedLiveScreenTurn(session, data, prompt);
    } catch (error) {
        console.error('Failed to send screenshot to Gemini Live:', error);
        return { success: false, error: error.message };
    } finally {
        liveImageSendInFlight = false;
        if (pendingLiveImage) {
            flushPendingLiveImage(session);
        }
    }
}

function createWavBuffer(pcmBuffer, sampleRate = 24000) {
    const numChannels = 1,
        bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(pcmBuffer.length + 36, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
}

async function transcribeWithGroqWhisper(pcmBuffer, sampleRate = 16000) {
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) return '';
    try {
        const wavBuffer = createWavBuffer(pcmBuffer, sampleRate);
        const formData = new FormData();
        formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('response_format', 'text');
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${groqApiKey}` },
            body: formData,
        });
        if (!response.ok) {
            console.error('Groq Whisper error:', response.status, await response.text());
            return '';
        }
        const text = (await response.text()).trim();
        console.log('[whisper] Transcribed:', text.substring(0, 80));
        return text;
    } catch (err) {
        console.error('Groq Whisper exception:', err);
        return '';
    }
}

function resetWhisperVadState() {
    whisperIsSpeaking = false;
    whisperSpeechFrames = 0;
    whisperSilenceFrames = 0;
    whisperAudioBuffer = [];
    whisperPreBuffer = [];
    whisperAudioBytes = 0;
    whisperJobs = [];
    whisperJobGeneration++;
    previousWhisperTranscript = '';
}

function queueWhisperJob(pcm) {
    if (whisperJobs.length >= 2) whisperJobs.shift();
    whisperJobs.push({ pcm, generation: whisperJobGeneration });
    drainWhisperJobs();
}

async function drainWhisperJobs() {
    if (whisperJobActive) return;
    whisperJobActive = true;
    while (whisperJobs.length) {
        const job = whisperJobs.shift();
        if (job.generation !== whisperJobGeneration) continue;
        const raw = await transcribeWithGroqWhisper(job.pcm, 16000);
        const { removeTranscriptOverlap } = require('./transcriptOverlap');
        const transcription = removeTranscriptOverlap(previousWhisperTranscript, raw);
        previousWhisperTranscript = raw || previousWhisperTranscript;
        if (!transcription.trim()) continue;
        if (needsVisualContext(transcription)) sendToRenderer('auto-capture-screenshot', { transcription });
        else sendToGroq(transcription);
    }
    whisperJobActive = false;
    sendToRenderer('update-status', 'Listening...');
}

async function processAudioForWhisper(monoChunk, sampleRate = 24000) {
    if (sampleRate !== 16000) monoChunk = resampleLive24kTo16k(monoChunk);
    // Calculate RMS energy of this chunk
    let sum = 0;
    for (let i = 0; i < monoChunk.length - 1; i += 2) {
        const s = monoChunk.readInt16LE(i) / 32768.0;
        sum += s * s;
    }
    const rms = Math.sqrt(sum / (monoChunk.length / 2));
    const isSpeech = rms > WHISPER_SILENCE_THRESHOLD;

    // Maintain pre-speech rolling buffer
    whisperPreBuffer.push(monoChunk);
    if (whisperPreBuffer.length > WHISPER_PRE_BUFFER_FRAMES) {
        whisperPreBuffer.shift();
    }

    if (isSpeech) {
        whisperSpeechFrames++;
        whisperSilenceFrames = 0;
        if (!whisperIsSpeaking && whisperSpeechFrames >= WHISPER_SPEECH_START_FRAMES) {
            whisperIsSpeaking = true;
            // Include pre-buffer frames so we don't cut off utterance start
            whisperAudioBuffer = [...whisperPreBuffer];
            whisperAudioBytes = whisperAudioBuffer.reduce((sum, frame) => sum + frame.length, 0);
            sendToRenderer('update-status', 'Transcribing...');
        }
    } else {
        whisperSilenceFrames++;
        whisperSpeechFrames = 0;
    }

    if (whisperIsSpeaking) {
        if (isSpeech) {
            whisperAudioBuffer.push(monoChunk);
            whisperAudioBytes += monoChunk.length;
            if (whisperAudioBytes >= MAX_WHISPER_SEGMENT_BYTES) {
                const combined = Buffer.concat(whisperAudioBuffer);
                queueWhisperJob(combined.subarray(0, MAX_WHISPER_SEGMENT_BYTES));
                const overlap = combined.subarray(Math.max(0, MAX_WHISPER_SEGMENT_BYTES - WHISPER_OVERLAP_BYTES));
                whisperAudioBuffer = [Buffer.from(overlap)];
                whisperAudioBytes = overlap.length;
            }
        }

        if (!isSpeech && whisperSilenceFrames >= WHISPER_SILENCE_END_FRAMES) {
            // End of utterance — send to Whisper
            whisperIsSpeaking = false;
            const utterancePcm = Buffer.concat(whisperAudioBuffer);
            whisperAudioBuffer = [];
            whisperAudioBytes = 0;
            whisperSpeechFrames = 0;
            whisperSilenceFrames = 0;

            queueWhisperJob(utterancePcm);
        }
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    isUserClosing = false;
    const connectionGeneration = liveConnections.begin();
    let liveSession = null;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey, customPrompt, profile, language };
        reconnectAttempts = 0;
        sessionResumptionHandle = null;
        liveResampleRemainder = Buffer.alloc(0);
        pendingLiveImage = null;
    }

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);
    currentSystemPrompt = systemPrompt; // Store for Groq

    // Initialize new conversation session only on first connect
    if (!isReconnect) {
        initializeNewSession(profile, customPrompt);
    }

    try {
        console.log(`Connecting Gemini Live: ${GEMINI_LIVE_MODEL}`);
        liveSession = await connectGeminiLive({
            apiKey,
            model: GEMINI_LIVE_MODEL,
            callbacks: {
                onopen: function () {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
                        sessionResumptionHandle = message.sessionResumptionUpdate.newHandle;
                    }
                    if (message.sessionResumptionUpdate && message.sessionResumptionUpdate.resumable === false && sessionResumptionHandle) {
                        console.warn('Gemini rejected session resumption; reconnecting once with bounded saved context');
                        sessionResumptionHandle = null;
                        liveSession?.close();
                        return;
                    }

                    answerMeetingSearchTools(message, liveSession, connectionGeneration).catch(error =>
                        console.warn('Meeting search tool failed:', error.message)
                    );

                    if (message.goAway && !isUserClosing) {
                        console.log('Live GoAway received, reconnecting with resumption handle');
                        reconnectAttempts = 0;
                        attemptReconnect({ immediate: true }).then(success => {
                            if (success) liveSession?.close();
                        });
                        return;
                    }

                    if (isLiveServerInterrupt(message)) {
                        handleLiveInterrupted();
                        return;
                    }

                    if (ingestLiveInputTranscription(message)) scheduleCodeAnswerForVoiceTurn();
                    ingestLiveOutputTranscription(message);

                    if (message.serverContent?.turnComplete) {
                        handleLiveTurnComplete();
                    }
                },
                onerror: function (e) {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    console.log('Session error:', e.message);
                    sendToRenderer('update-status', 'Error: ' + e.message);
                },
                onclose: function (e) {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    console.log('Session closed:', e.reason);

                    if (isFatalConnectionClose(e)) {
                        sessionParams = null;
                        sendToRenderer('update-status', `Gemini configuration error: ${e.reason || 'authentication failed'}`);
                        return;
                    }

                    // Don't reconnect if user intentionally closed
                    if (isUserClosing) {
                        isUserClosing = false;
                        sendToRenderer('update-status', 'Session closed');
                        return;
                    }

                    // Attempt reconnection
                    if (sessionParams) {
                        attemptReconnect();
                    } else {
                        sendToRenderer('update-status', 'Session closed');
                    }
                },
            },
            config: buildGeminiLiveSessionConfig({
                language,
                vadPreset: getPreferences().vadPreset,
                tools: enabledTools,
                systemPrompt,
                sessionResumptionHandle,
            }),
        });

        if (!liveConnections.isCurrent(connectionGeneration)) {
            liveSession.close();
            isInitializingSession = false;
            return null;
        }
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return liveSession;
    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return null;
    }
}

async function attemptReconnect(options = {}) {
    if (isUserClosing || !sessionParams) return false;
    if (reconnectInFlight) return false;
    reconnectInFlight = true;
    if (!reconnectStartedAt) reconnectStartedAt = Date.now();

    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}`);

    resetLiveConversationBuffers();
    resetWhisperVadState();
    liveResampleRemainder = Buffer.alloc(0);

    sendToRenderer('update-status', `Reconnecting... (attempt ${reconnectAttempts})`);

    if (!options.immediate) {
        await new Promise(resolve => setTimeout(resolve, liveConnections.retryDelay(reconnectAttempts - 1)));
        if (isUserClosing || !sessionParams) {
            reconnectInFlight = false;
            return false;
        }
    }

    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            if (!sessionResumptionHandle) {
                const contextMessage = buildContextMessage();
                if (contextMessage) {
                    try {
                        console.log('Restoring conversation context...');
                        session.sendRealtimeInput({ text: contextMessage });
                    } catch (contextError) {
                        console.error('Failed to restore context:', contextError);
                    }
                }
            }

            reconnectAttempts = 0;
            reconnectStartedAt = 0;
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
            reconnectInFlight = false;
            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    reconnectInFlight = false;

    // If we still have attempts left, try again
    if (Date.now() - reconnectStartedAt < MAX_RECONNECT_MS) {
        return attemptReconnect();
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendToRenderer('reconnect-failed', {
        message: 'Could not reconnect for 60 seconds. Check the network or restart the meeting.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-x', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);
    liveGapFiller.start();

    const CHUNK_DURATION = 0.04;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(monoChunk);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk);
            } else if (geminiSessionRef.current) {
                enqueueLivePcm(monoChunk, 24000, geminiSessionRef);
            } else if (canUseGroqFallback()) {
                processAudioForWhisper(monoChunk);
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        const rightSample = stereoBuffer.readInt16LE(i * 4 + 2);
        const mono = Math.round((leftSample + rightSample) / 2);
        monoBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, mono)), i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
    liveGapFiller.stop();
    geminiAudioQueue.clear();
    geminiAudioSequence = 0;
    geminiSendLock = false;
    congestionStartedAt = 0;
    if (congestionRetryTimer) clearTimeout(congestionRetryTimer);
    congestionRetryTimer = null;
    resetWhisperVadState();
}

async function drainGeminiQueue(geminiSessionRef) {
    if (geminiSendLock) return;
    geminiSendLock = true;
    while (geminiAudioQueue.length > 0) {
        const session = geminiSessionRef.current;
        if (!session) break;
        if ((session.bufferedBytes || 0) > 64000) {
            if (!congestionStartedAt) congestionStartedAt = Date.now();
            geminiSendLock = false;
            if (Date.now() - congestionStartedAt > 2000) {
                console.warn('Gemini Live congestion exceeded the audio budget; reconnecting');
                session.close();
                congestionStartedAt = 0;
                return;
            }
            if (!congestionRetryTimer) {
                congestionRetryTimer = setTimeout(() => {
                    congestionRetryTimer = null;
                    drainGeminiQueue(geminiSessionRef);
                }, 40);
            }
            return;
        }
        congestionStartedAt = 0;
        const frame = geminiAudioQueue.shift();
        await sendAudioToGemini(frame.pcm.toString('base64'), geminiSessionRef);
    }
    geminiSendLock = false;
    if (geminiSessionRef.current && pendingLiveImage) {
        flushPendingLiveImage(geminiSessionRef.current);
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;

    try {
        geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=16000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

async function sendImageToGroqLlama4(base64Data, prompt) {
    const answer = createAnswerStream('screen-groq');
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        return { success: false, error: 'No Groq API key configured' };
    }

    const model = 'meta-llama/llama-4-scout-17b-16e-instruct';

    try {
        console.log(`Sending image to ${model} (streaming)...`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/jpeg;base64,${base64Data}` },
                            },
                            { type: 'text', text: prompt },
                        ],
                    },
                ],
                stream: true,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`Groq vision API error ${response.status}:`, errText);
            return { success: false, error: `Groq vision error: ${response.status}` };
        }

        let fullText = '';
        let isFirst = true;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') break;
                try {
                    const chunk = JSON.parse(jsonStr);
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullText += delta;
                        answer.update(fullText);
                        isFirst = false;
                    }
                } catch (_) {}
            }
        }

        console.log(`Image response completed from ${model}`);

        if (fullText.trim()) {
            answer.complete(fullText.trim());
            groqConversationHistory.push({
                role: 'user',
                content: `[Screen context]: ${fullText.trim()}`,
            });
            if (groqConversationHistory.length > 20) {
                groqConversationHistory = groqConversationHistory.slice(-20);
            }
        }

        saveScreenAnalysis(prompt, fullText, model);
        return { success: true, text: fullText, model: model };
    } catch (error) {
        console.error('Error sending image to Groq Llama4:', error);
        return { success: false, error: error.message };
    }
}

async function sendImageToGeminiHttp(base64Data, request) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, error: 'No API key configured' };
    }

    const answer = createAnswerStream('screen-gemini');
    const records = [...conversationHistory, ...screenAnalysisHistory].sort((a, b) => a.timestamp - b.timestamp);
    const context = buildRelevantContext({ query: request, summary: currentSummary, records });
    const screenRequest = buildScreenAnalysisRequest({ data: base64Data, request, context });

    try {
        console.log(`Sending image to ${screenRequest.model} (streaming)...`);
        const response = await getTextModelClient(apiKey).models.generateContentStream(screenRequest);

        let fullText = '';
        for await (const chunk of response) {
            if (chunk.text) {
                fullText += chunk.text;
                answer.update(fullText);
            }
        }

        console.log(`Image response completed from ${screenRequest.model}`);

        if (!fullText.trim()) {
            return { success: false, error: 'Screen analysis returned no text' };
        }
        answer.complete(fullText.trim());

        // Inject screen analysis into Groq context for follow-up voice questions
        groqConversationHistory.push({
            role: 'user',
            content: `[Screen context]: ${fullText.trim()}`,
        });
        if (groqConversationHistory.length > 20) {
            groqConversationHistory = groqConversationHistory.slice(-20);
        }

        saveScreenAnalysis(request || 'Analyze Screen', fullText, screenRequest.model);

        return { success: true, text: fullText, model: screenRequest.model };
    } catch (error) {
        console.error('Error sending image to Gemini HTTP:', error);
        return { success: false, error: error.message };
    }
}

function routeAudioFrame(pcmBuffer, sampleRate, geminiSessionRef) {
    if (currentProviderMode === 'cloud') {
        return { success: sendCloudAudio(pcmBuffer), provider: 'cloud' };
    }
    if (currentProviderMode === 'local') {
        getLocalAi().processLocalAudio(pcmBuffer, sampleRate);
        return { success: true, provider: 'local' };
    }
    if (geminiSessionRef.current) {
        enqueueLivePcm(pcmBuffer, sampleRate, geminiSessionRef);
        return { success: true, provider: 'gemini' };
    }
    if (canUseGroqFallback()) {
        processAudioForWhisper(pcmBuffer, sampleRate);
        return { success: true, provider: 'groq' };
    }
    return { success: false, error: 'No active AI session' };
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-cloud', async (event, token, profile, userContext) => {
        try {
            currentProviderMode = 'cloud';
            initializeNewSession(profile);
            setOnTurnComplete((transcription, response) => {
                saveConversationTurn(transcription, response);
            });
            sendToRenderer('session-initializing', true);
            await connectCloud(token, profile, userContext);
            sendToRenderer('session-initializing', false);
            return true;
        } catch (err) {
            console.error('[Cloud] Init error:', err);
            currentProviderMode = 'byok';
            sendToRenderer('session-initializing', false);
            return false;
        }
    });

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        currentProviderMode = 'byok';

        // Gemini Live 3.8 conversational path (STT + overlay answer in one session)
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    ipcMain.handle('initialize-local', async (event, ollamaHost, ollamaModel, whisperModel, profile, customPrompt) => {
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(ollamaHost, ollamaModel, whisperModel, profile, customPrompt);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    ipcMain.handle('send-audio-frame', async (event, payload) => {
        try {
            const frame = validateAudioFrame(payload);
            const result = routeAudioFrame(frame.pcm, frame.sampleRate, geminiSessionRef);
            return { ...result, queuedMs: geminiAudioQueue.durationMs };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (geminiSessionRef.current) {
            enqueueLivePcm(Buffer.from(data, 'base64'), 24000, geminiSessionRef);
            return { success: true };
        }
        if (canUseGroqFallback()) {
            const pcmBuffer = Buffer.from(data, 'base64');
            processAudioForWhisper(pcmBuffer);
            return { success: true };
        }
        return { success: false, error: 'No active Gemini session' };
    });

    // Handle microphone audio on a separate channel
    ipcMain.handle('send-mic-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (geminiSessionRef.current) {
            enqueueLivePcm(Buffer.from(data, 'base64'), 24000, geminiSessionRef);
            return { success: true };
        }
        if (canUseGroqFallback()) {
            const pcmBuffer = Buffer.from(data, 'base64');
            processAudioForWhisper(pcmBuffer);
            return { success: true };
        }
        return { success: false, error: 'No active Gemini session' };
    });

    ipcMain.handle('capture-screen-still', async (event, payload = {}) => {
        const quality = payload && typeof payload.quality === 'string' ? payload.quality : 'medium';
        const allowed = quality === 'high' || quality === 'medium' || quality === 'low' ? quality : 'medium';
        return captureScreenStill({ quality: allowed });
    });

    ipcMain.handle('send-image-content', async (event, { data, prompt }) => {
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            rememberScreenshot(data);
            sendToRenderer('update-status', 'Analyzing screen...');
            // Paths whose answer is saved through saveConversationTurn label it "Analyze Screen";
            // the HTTP path saves its own screen record, so it must not leave this for the next voice turn.
            const liveScreenPrompt = () => {
                pendingTypedQuestion = 'Analyze Screen';
                return composeUserTurn(prompt || 'Analyze this screenshot now. Give the complete answer from what you see.');
            };

            const analyzePath = chooseAnalyzeScreenPath({
                providerMode: currentProviderMode,
                hasApiKey: Boolean(getApiKey()),
                hasLiveSession: Boolean(geminiSessionRef.current),
                hasGroq: canUseGroqFallback(),
            });

            if (analyzePath === 'cloud') {
                const sentImage = sendCloudImage(data);
                const sentText = sendCloudText(liveScreenPrompt());
                if (!sentImage || !sentText) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true, model: 'cloud' };
            }

            if (analyzePath === 'local') {
                return await getLocalAi().sendLocalImage(data, liveScreenPrompt());
            }

            if (analyzePath === 'http') {
                const result = await sendImageToGeminiHttp(data, prompt);
                const session = geminiSessionRef.current;
                if (result.success && result.text?.trim()) {
                    // Send once: Live gets the screen as context for voice follow-ups but is not asked to answer it.
                    if (session && typeof session.sendClientContent === 'function') {
                        try {
                            session.sendClientContent(buildLiveScreenContextContent(data, result.text));
                        } catch (error) {
                            console.warn('Could not share screen context with Live:', error.message);
                        }
                    }
                    return result;
                }
                if (session) {
                    const liveResult = sendImageToGeminiLive(session, data, liveScreenPrompt());
                    if (liveResult.success) {
                        return liveResult;
                    }
                    pendingTypedQuestion = null;
                }
                return result.success === false ? result : { success: false, error: 'Screen analysis returned no text' };
            }

            if (analyzePath === 'live') {
                return sendImageToGeminiLive(geminiSessionRef.current, data, liveScreenPrompt());
            }

            if (analyzePath === 'groq') {
                return await sendImageToGroqLlama4(
                    data,
                    composeUserTurn(prompt || 'Analyze this screenshot now. Give the complete answer from what you see.')
                );
            }

            return { success: false, error: 'No active Gemini session' };
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }

        const userText = text.trim();

        if (currentProviderMode === 'cloud') {
            try {
                pendingTypedQuestion = userText;
                const contextualText = composeUserTurn(userText);
                console.log('Sending text to cloud with full session context');
                if (lastScreenshotJpeg) {
                    sendCloudImage(lastScreenshotJpeg);
                }
                const sent = sendCloudText(contextualText);
                if (!sent) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud text:', error);
                return { success: false, error: error.message };
            }
        }

        if (currentProviderMode === 'local') {
            try {
                pendingTypedQuestion = userText;
                const contextualText = composeUserTurn(userText);
                console.log('Sending text to local Ollama with session context');
                if (lastScreenshotJpeg) {
                    return await getLocalAi().sendLocalImage(lastScreenshotJpeg, contextualText);
                }
                return await getLocalAi().sendLocalText(contextualText);
            } catch (error) {
                console.error('Error sending local text:', error);
                return { success: false, error: error.message };
            }
        }

        if (!geminiSessionRef.current && canUseGroqFallback()) {
            pendingTypedQuestion = userText;
            const contextualText = composeUserTurn(userText);
            sendToGroq(contextualText);
            return { success: true };
        }

        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        if (liveTurnActive) {
            const queued = typedTurnQueue.push(userText);
            return queued.accepted
                ? { success: true, queued: true, queueSize: typedTurnQueue.length }
                : { success: false, queueFull: true, error: 'Three typed questions are already waiting.' };
        }
        const sent = await dispatchLiveTypedTurn(userText);
        return sent ? { success: true } : { success: false, error: 'Could not send the message' };
    });

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async event => {
        try {
            stopMacOSAudioCapture();
            if (liveOutputText.trim()) {
                if (!liveTurnId) liveTurnId = createTurnId('live');
                emitAnswer(sendToRenderer, liveTurnId, 'interrupted', formatLiveAnswerText(liveOutputText), liveOutputSequence++);
                saveConversationTurn(currentTranscription.trim() || '(interrupted audio)', formatLiveAnswerText(liveOutputText));
            }
            if (currentSessionId) await flushSessionArchive(currentSessionId);
            typedTurnQueue.clear();
            liveTurnActive = false;
            liveTurnWatchdog.stop();
            cancelCodeAnswers();
            resetLiveConversationBuffers();

            if (currentProviderMode === 'cloud') {
                closeCloud();
                currentProviderMode = 'byok';
                return { success: true };
            }

            if (currentProviderMode === 'local') {
                getLocalAi().closeLocalSession();
                currentProviderMode = 'byok';
                return { success: true };
            }

            isUserClosing = true;
            liveConnections.stop();
            sessionParams = null;
            reconnectStartedAt = 0;
            reconnectInFlight = false;
            sessionResumptionHandle = null;
            pendingLiveImage = null;
            clearTranscriptionSilenceTimer();
            clearLateTranscriptionTimer();
            resetWhisperVadState();

            // Cleanup session
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }

            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            if (sessionParams && global.geminiSessionRef?.current) {
                sessionResumptionHandle = null;
                global.geminiSessionRef.current.close();
            }
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    formatSpeakerResults,
};
