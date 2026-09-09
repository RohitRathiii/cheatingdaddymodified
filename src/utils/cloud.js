const WebSocket = require('ws');
const { BrowserWindow } = require('electron');
const { createTurnId, emitAnswer } = require('./answerEvents');
const { ConnectionGeneration } = require('./connectionGeneration');

let cloudWs = null;
let isCloudConnected = false;
let currentCloudResponse = '';
let currentTranscription = '';
let isFirstChunk = true;
let audioChunkCount = 0;
let onTurnComplete = null;
let currentTurnId = null;
let answerSequence = 0;
const cloudConnections = new ConnectionGeneration();

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

function setOnTurnComplete(callback) {
    onTurnComplete = callback;
}

function connectCloud(token, profile, userContext) {
    const generation = cloudConnections.begin();
    // Close existing connection
    if (cloudWs) {
        try {
            cloudWs.close();
        } catch (e) {}
        cloudWs = null;
        isCloudConnected = false;
    }

    audioChunkCount = 0;

    return new Promise((resolve, reject) => {
        const url = `wss://api.cheatingdaddy.com/ws?token=${encodeURIComponent(token)}`;
        console.log('[Cloud] Connecting to', url);

        cloudWs = new WebSocket(url);

        const timeout = setTimeout(() => {
            if (!isCloudConnected) {
                cloudWs.close();
                reject(new Error('Cloud connection timeout'));
            }
        }, 10000);

        cloudWs.on('open', () => {
            if (!cloudConnections.isCurrent(generation)) return;
            console.log('[Cloud] WebSocket open');
            isCloudConnected = true;
            clearTimeout(timeout);

            // Send config immediately after open
            const config = JSON.stringify({
                type: 'set_config',
                profile: profile || 'interview',
                user_context: userContext || '',
            });
            cloudWs.send(config);
            console.log('[Cloud] Config sent:', profile);

            sendToRenderer('update-status', 'Cloud connected');
            resolve(true);
        });

        cloudWs.on('message', data => {
            if (!cloudConnections.isCurrent(generation)) return;
            try {
                const msg = JSON.parse(data.toString());
                handleMessage(msg);
            } catch (e) {
                console.error('[Cloud] Parse error:', e);
            }
        });

        cloudWs.on('close', (code, reason) => {
            if (!cloudConnections.isCurrent(generation)) return;
            console.log('[Cloud] WebSocket closed:', code, reason.toString());
            console.log('[Cloud] Audio chunks sent before close:', audioChunkCount);
            isCloudConnected = false;
            clearTimeout(timeout);
        });

        cloudWs.on('error', err => {
            if (!cloudConnections.isCurrent(generation)) return;
            console.error('[Cloud] WebSocket error:', err.message);
            isCloudConnected = false;
            clearTimeout(timeout);
            reject(err);
        });
    });
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'connected':
            console.log('[Cloud] Server confirmed connected');
            break;

        case 'transcription':
            console.log('[Cloud] Transcription:', msg.text);
            currentTranscription = msg.text || '';
            sendToRenderer('update-status', 'Generating response...');
            break;

        case 'response_start':
            currentCloudResponse = '';
            isFirstChunk = true;
            currentTurnId = createTurnId('cloud');
            answerSequence = 0;
            break;

        case 'response_chunk':
            currentCloudResponse += msg.text;
            if (!currentTurnId) currentTurnId = createTurnId('cloud');
            emitAnswer(sendToRenderer, currentTurnId, isFirstChunk ? 'start' : 'update', currentCloudResponse, answerSequence++);
            isFirstChunk = false;
            break;

        case 'response_end':
            if (currentTurnId && currentCloudResponse.trim()) {
                emitAnswer(sendToRenderer, currentTurnId, 'complete', currentCloudResponse, answerSequence++);
            }
            if (onTurnComplete && currentCloudResponse.trim()) {
                onTurnComplete(currentTranscription, currentCloudResponse);
            }
            currentTranscription = '';
            currentTurnId = null;
            sendToRenderer('update-status', 'Listening...');
            break;

        case 'session_end':
            console.log('[Cloud] Session ended by server');
            isCloudConnected = false;
            break;

        case 'error':
            console.error('[Cloud] Server error:', msg.message);
            sendToRenderer('update-status', 'Cloud error: ' + msg.message);
            break;

        default:
            console.log('[Cloud] Event:', msg.type);
    }
}

function sendCloudAudio(pcmBuffer) {
    if (!cloudWs || !isCloudConnected || cloudWs.readyState !== WebSocket.OPEN) {
        return false;
    }
    if (cloudWs.bufferedAmount > 96000) {
        console.warn('[Cloud] Dropping stale audio because the connection is congested');
        return false;
    }

    cloudWs.send(pcmBuffer, { binary: true }, err => {
        if (err) {
            console.error('[Cloud] Audio send error:', err.message);
        }
    });

    audioChunkCount++;
    return true;
}

function sendCloudText(text) {
    if (cloudWs && isCloudConnected && cloudWs.readyState === WebSocket.OPEN) {
        cloudWs.send(
            JSON.stringify({
                type: 'test_text',
                text: text,
            })
        );
        return true;
    }
    return false;
}

function sendCloudImage(base64Data) {
    if (!cloudWs || !isCloudConnected || cloudWs.readyState !== WebSocket.OPEN) {
        return false;
    }
    cloudWs.send(
        JSON.stringify({
            type: 'image',
            image: base64Data,
        })
    );
    return true;
}

function closeCloud() {
    cloudConnections.stop();
    console.log('[Cloud] Closing. Audio chunks sent:', audioChunkCount);
    if (cloudWs) {
        try {
            if (cloudWs.readyState === WebSocket.OPEN) {
                cloudWs.send(JSON.stringify({ type: 'end_connection' }));
            }
            cloudWs.close();
        } catch (e) {
            console.error('[Cloud] Close error:', e);
        }
        cloudWs = null;
    }
    isCloudConnected = false;
    currentCloudResponse = '';
    currentTranscription = '';
    isFirstChunk = true;
    audioChunkCount = 0;
    onTurnComplete = null;
}

function isCloudActive() {
    return isCloudConnected && cloudWs && cloudWs.readyState === WebSocket.OPEN;
}

module.exports = {
    connectCloud,
    sendCloudAudio,
    sendCloudText,
    sendCloudImage,
    closeCloud,
    isCloudActive,
    setOnTurnComplete,
};
