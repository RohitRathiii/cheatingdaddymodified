// renderer.js
const { ipcRenderer } = require('electron');

let mediaStream = null;
let micMediaStream = null;
let screenshotInterval = null;
let audioContext = null;
let audioProcessor = null;
let micAudioProcessor = null;
let audioBuffer = [];
let audioSources = [];
let audioSink = null;
let captureGeneration = 0;
let pendingAudioSends = 0;
let screenshotDelayTimer = null;
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.04; // seconds — Live API prefers 20–40ms chunks
const BUFFER_SIZE = 4096; // Increased buffer size for smoother audio
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_MIN_INTERVAL_MS = 1000;

let hiddenVideo = null;
let offscreenCanvas = null;
let offscreenContext = null;
let currentImageQuality = 'medium'; // Store current image quality for manual screenshots

const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
// This file is loaded by index.html via <script src>, so relative CommonJS
// imports resolve from src/index.html rather than from src/utils/renderer.js.
const { resolveBackgroundAlpha } = require('./utils/overlayVisibility');

if (isWindows && document.documentElement) {
    document.documentElement.classList.add('windows-opaque');
}

// ============ STORAGE API ============
// Wrapper for IPC-based storage access
const storage = {
    // Config
    async getConfig() {
        const result = await ipcRenderer.invoke('storage:get-config');
        return result.success ? result.data : {};
    },
    async setConfig(config) {
        return ipcRenderer.invoke('storage:set-config', config);
    },
    async updateConfig(key, value) {
        return ipcRenderer.invoke('storage:update-config', key, value);
    },

    // Credentials
    async getCredentials() {
        const result = await ipcRenderer.invoke('storage:get-credentials');
        return result.success ? result.data : {};
    },
    async setCredentials(credentials) {
        return ipcRenderer.invoke('storage:set-credentials', credentials);
    },
    async getApiKey() {
        const result = await ipcRenderer.invoke('storage:get-api-key');
        return result.success ? result.data : '';
    },
    async setApiKey(apiKey) {
        return ipcRenderer.invoke('storage:set-api-key', apiKey);
    },
    async getGroqApiKey() {
        const result = await ipcRenderer.invoke('storage:get-groq-api-key');
        return result.success ? result.data : '';
    },
    async setGroqApiKey(groqApiKey) {
        return ipcRenderer.invoke('storage:set-groq-api-key', groqApiKey);
    },

    // Preferences
    async getPreferences() {
        const result = await ipcRenderer.invoke('storage:get-preferences');
        return result.success ? result.data : {};
    },
    async setPreferences(preferences) {
        return ipcRenderer.invoke('storage:set-preferences', preferences);
    },
    async updatePreference(key, value) {
        return ipcRenderer.invoke('storage:update-preference', key, value);
    },

    // Keybinds
    async getKeybinds() {
        const result = await ipcRenderer.invoke('storage:get-keybinds');
        return result.success ? result.data : null;
    },
    async setKeybinds(keybinds) {
        return ipcRenderer.invoke('storage:set-keybinds', keybinds);
    },

    // Sessions (History)
    async getAllSessions() {
        const result = await ipcRenderer.invoke('storage:get-all-sessions');
        return result.success ? result.data : [];
    },
    async getSession(sessionId) {
        const result = await ipcRenderer.invoke('storage:get-session', sessionId);
        return result.success ? result.data : null;
    },
    async getSessionPage(sessionId, page = 0, pageSize = 50) {
        const result = await ipcRenderer.invoke('storage:get-session-page', sessionId, page, pageSize);
        return result.success ? result.data : { records: [], hasMore: false };
    },
    async deleteSession(sessionId) {
        return ipcRenderer.invoke('storage:delete-session', sessionId);
    },
    async deleteAllSessions() {
        return ipcRenderer.invoke('storage:delete-all-sessions');
    },

    // Clear all
    async clearAll() {
        return ipcRenderer.invoke('storage:clear-all');
    },

    // Limits
    async getTodayLimits() {
        const result = await ipcRenderer.invoke('storage:get-today-limits');
        return result.success ? result.data : { flash: { count: 0 }, flashLite: { count: 0 } };
    },
};

// Cache for preferences to avoid async calls in hot paths
let preferencesCache = null;

async function loadPreferencesCache() {
    preferencesCache = await storage.getPreferences();
    return preferencesCache;
}

// Initialize preferences cache
loadPreferencesCache();

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Improved scaling to prevent clipping
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function initializeGemini(profile = 'interview', language = 'en-US') {
    const apiKey = await storage.getApiKey();
    if (apiKey) {
        const prefs = await storage.getPreferences();
        const success = await ipcRenderer.invoke('initialize-gemini', apiKey, prefs.customPrompt || '', profile, language);
        if (success) {
            cheatingDaddy.setStatus('Live');
            return true;
        } else {
            cheatingDaddy.setStatus('error');
            return false;
        }
    }
    return false;
}

async function initializeLocal(profile = 'interview') {
    const prefs = await storage.getPreferences();
    const ollamaHost = prefs.ollamaHost || 'http://127.0.0.1:11434';
    const ollamaModel = prefs.ollamaModel || 'llama3.1';
    const whisperModel = prefs.whisperModel || 'Xenova/whisper-small';
    const customPrompt = prefs.customPrompt || '';

    const success = await ipcRenderer.invoke('initialize-local', ollamaHost, ollamaModel, whisperModel, profile, customPrompt);
    if (success) {
        cheatingDaddy.setStatus('Local AI Live');
        return true;
    } else {
        cheatingDaddy.setStatus('error');
        return false;
    }
}

async function initializeCloud(profile = 'interview') {
    const creds = await storage.getCredentials();
    const token = creds.cloudToken;
    if (!token || !token.trim()) {
        cheatingDaddy.setStatus('error');
        return false;
    }

    const prefs = await storage.getPreferences();
    const success = await ipcRenderer.invoke('initialize-cloud', token, profile, prefs.customPrompt || '');
    if (success) {
        cheatingDaddy.setStatus('Live');
        return true;
    } else {
        cheatingDaddy.setStatus('error');
        return false;
    }
}

// Listen for status updates
ipcRenderer.on('update-status', (event, status) => {
    console.log('Status update:', status);
    cheatingDaddy.setStatus(status);
});

async function legacyStartCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium') {
    // Store the image quality for manual screenshots
    currentImageQuality = imageQuality;

    // Refresh preferences cache
    await loadPreferencesCache();
    const audioMode = preferencesCache.audioMode || 'speaker_only';

    try {
        if (isMacOS) {
            // Audio is optional. Screenshots use main-process desktopCapturer, not getDisplayMedia.
            console.log('Starting macOS capture with SystemAudioDump...');

            try {
                const audioResult = await ipcRenderer.invoke('start-macos-audio');
                if (!audioResult?.success) {
                    console.warn('macOS audio capture failed, continuing without system audio:', audioResult?.error);
                }
            } catch (audioError) {
                console.warn('macOS audio capture failed, continuing without system audio:', audioError);
            }

            console.log('macOS capture started — Analyze Screen uses desktopCapturer');

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                    console.log('macOS microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on macOS:', micError);
                }
            }
        } else if (isLinux) {
            // Linux - use display media for screen capture and try to get system audio
            try {
                // First try to get system audio via getDisplayMedia (works on newer browsers)
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: false, // Don't cancel system audio
                        noiseSuppression: false,
                        autoGainControl: false,
                    },
                });

                console.log('Linux system audio capture via getDisplayMedia succeeded');

                // Setup audio processing for Linux system audio
                setupLinuxSystemAudioProcessing();
            } catch (systemAudioError) {
                console.warn('System audio via getDisplayMedia failed, trying screen-only capture:', systemAudioError);

                // Fallback to screen-only capture
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
            }

            // Additionally get microphone input for Linux based on audio mode
            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });

                    console.log('Linux microphone capture started');

                    // Setup audio processing for microphone on Linux
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Linux:', micError);
                    // Continue without microphone if permission denied
                }
            }

            console.log('Linux capture started - system audio:', mediaStream.getAudioTracks().length > 0, 'microphone mode:', audioMode);
        } else {
            // Windows - use display media with loopback for system audio
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            console.log('Windows capture started with loopback audio');

            // Setup audio processing for Windows loopback audio only
            setupWindowsLoopbackProcessing();

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                    console.log('Windows microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Windows:', micError);
                }
            }
        }

        if (mediaStream) {
            console.log('MediaStream obtained:', {
                hasVideo: mediaStream.getVideoTracks().length > 0,
                hasAudio: mediaStream.getAudioTracks().length > 0,
                videoTrack: mediaStream.getVideoTracks()[0]?.getSettings(),
            });
        }

        // Manual mode only - screenshots captured on demand via shortcut
        console.log('Manual mode enabled - screenshots will be captured on demand only');
    } catch (err) {
        console.error('Error starting capture:', err);
        cheatingDaddy.setStatus('error');
    }
}

function setupLinuxMicProcessing(micStream) {
    console.warn('Legacy microphone processor is disabled; AudioWorklet owns capture.', Boolean(micStream));
}

function setupLinuxSystemAudioProcessing() {
    console.warn('Legacy system processor is disabled; AudioWorklet owns capture.');
}

function setupWindowsLoopbackProcessing() {
    console.warn('Legacy loopback processor is disabled; AudioWorklet owns capture.');
}

const MANUAL_SCREENSHOT_PROMPT = `Help me on this page, give me the answer no bs, complete answer.
So if its a code question, give me the approach in few bullet points, then the entire code. Also if theres anything else i need to know, tell me.
If its a question about the website, give me the answer no bs, complete answer.
If its a mcq question, give me the answer no bs, complete answer.`;

let screenshotSendInFlight = false;
let pendingScreenshotJob = null;
let lastScreenshotSentAt = 0;

function jpegQualityValue(quality) {
    switch (quality) {
        case 'high':
            return 0.85;
        case 'low':
            return 0.4;
        case 'medium':
        default:
            return 0.6;
    }
}

async function ensureScreenshotVideo() {
    if (!mediaStream) {
        console.error('No media stream available');
        return false;
    }

    if (!hiddenVideo) {
        hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = mediaStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        await hiddenVideo.play();
        await new Promise(resolve => {
            if (hiddenVideo.readyState >= 2) return resolve();
            hiddenVideo.onloadedmetadata = () => resolve();
        });
        offscreenCanvas = document.createElement('canvas');
        offscreenContext = offscreenCanvas.getContext('2d');
    }

    if (hiddenVideo.readyState < 2) {
        console.warn('Video not ready yet, skipping screenshot');
        return false;
    }
    return true;
}

function arrayBufferToJpegBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function encodeScreenshotJpeg(quality) {
    const srcW = hiddenVideo.videoWidth;
    const srcH = hiddenVideo.videoHeight;
    let destW = srcW;
    let destH = srcH;
    if (srcW > SCREENSHOT_MAX_WIDTH) {
        destW = SCREENSHOT_MAX_WIDTH;
        destH = Math.round(srcH * (SCREENSHOT_MAX_WIDTH / srcW));
    }
    offscreenCanvas.width = destW;
    offscreenCanvas.height = destH;
    offscreenContext.drawImage(hiddenVideo, 0, 0, destW, destH);

    return new Promise((resolve, reject) => {
        offscreenCanvas.toBlob(
            async blob => {
                if (!blob) {
                    reject(new Error('Failed to create blob from canvas'));
                    return;
                }
                try {
                    const base64data = arrayBufferToJpegBase64(await blob.arrayBuffer());
                    if (!base64data || base64data.length < 100) {
                        reject(new Error('Invalid JPEG data generated'));
                        return;
                    }
                    resolve({ data: base64data, width: destW, height: destH });
                } catch (error) {
                    reject(error);
                }
            },
            'image/jpeg',
            jpegQualityValue(quality)
        );
    });
}

async function flushPendingScreenshot() {
    if (screenshotSendInFlight || !pendingScreenshotJob) return;

    const elapsed = Date.now() - lastScreenshotSentAt;
    if (lastScreenshotSentAt && elapsed < SCREENSHOT_MIN_INTERVAL_MS) {
        if (screenshotDelayTimer) clearTimeout(screenshotDelayTimer);
        screenshotDelayTimer = setTimeout(() => {
            screenshotDelayTimer = null;
            flushPendingScreenshot();
        }, SCREENSHOT_MIN_INTERVAL_MS - elapsed);
        return;
    }

    screenshotSendInFlight = true;
    const { prompt, quality, resolve } = pendingScreenshotJob;
    pendingScreenshotJob = null;

    try {
        const captured = await ipcRenderer.invoke('capture-screen-still', { quality });
        if (!captured?.success) {
            const error = captured?.error || 'Failed to capture the screen.';
            console.error(error);
            if (typeof cheatingDaddy !== 'undefined' && cheatingDaddy.addNewResponse) {
                cheatingDaddy.addNewResponse(`Analyze Screen failed: ${error}`);
            }
            resolve?.({ success: false, error });
            return;
        }
        lastScreenshotSentAt = Date.now();
        console.log(`Sending screenshot: ${captured.width}x${captured.height}, ~${Math.round(captured.data.length / 1024)}KB`);
        const result = await ipcRenderer.invoke('send-image-content', {
            data: captured.data,
            prompt,
            mimeType: captured.mimeType || 'image/jpeg',
        });
        if (!result.success) {
            console.error('Failed to send screenshot:', result.error);
            if (typeof cheatingDaddy !== 'undefined' && cheatingDaddy.addNewResponse) {
                cheatingDaddy.addNewResponse(`Error: ${result.error}`);
            }
        }
        resolve?.(result);
    } catch (error) {
        console.error('Screenshot capture failed:', error);
        if (typeof cheatingDaddy !== 'undefined' && cheatingDaddy.addNewResponse) {
            cheatingDaddy.addNewResponse(`Analyze Screen failed: ${error.message}`);
        }
        resolve?.({ success: false, error: error.message });
    } finally {
        screenshotSendInFlight = false;
        if (pendingScreenshotJob) {
            flushPendingScreenshot();
        }
    }
}

function queueScreenshot({ prompt = MANUAL_SCREENSHOT_PROMPT, quality = currentImageQuality } = {}) {
    return new Promise(resolve => {
        if (pendingScreenshotJob?.resolve) {
            pendingScreenshotJob.resolve({ success: false, error: 'Replaced by a newer screenshot' });
        }
        pendingScreenshotJob = { prompt, quality, resolve };
        flushPendingScreenshot();
    });
}

async function captureScreenshot(imageQuality = 'medium', isManual = false) {
    console.log(`Capturing ${isManual ? 'manual' : 'automated'} screenshot...`);
    return queueScreenshot({
        prompt: MANUAL_SCREENSHOT_PROMPT,
        quality: imageQuality,
    });
}

async function captureManualScreenshot(imageQuality = null, extraContext = '') {
    console.log('Manual screenshot triggered');
    const prompt = extraContext ? `${MANUAL_SCREENSHOT_PROMPT}\n\nSpoken request: ${extraContext}` : MANUAL_SCREENSHOT_PROMPT;
    return queueScreenshot({
        prompt,
        quality: imageQuality || currentImageQuality,
    });
}

// Expose functions to global scope for external access
window.captureManualScreenshot = captureManualScreenshot;

function legacyStopCapture() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }

    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }

    // Clean up microphone audio processor (Linux only)
    if (micAudioProcessor) {
        micAudioProcessor.disconnect();
        micAudioProcessor = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Stop macOS audio capture if running
    if (isMacOS) {
        ipcRenderer.invoke('stop-macos-audio').catch(err => {
            console.error('Error stopping macOS audio:', err);
        });
    }

    // Clean up hidden elements
    if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
        hiddenVideo = null;
    }
    offscreenCanvas = null;
    offscreenContext = null;
}

async function getMicrophoneStream(sampleRate) {
    return navigator.mediaDevices.getUserMedia({
        audio: {
            sampleRate,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        },
        video: false,
    });
}

async function getLoopbackStream(sampleRate) {
    return navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: {
            sampleRate,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        },
    });
}

function stopStream(stream) {
    stream?.getTracks().forEach(track => track.stop());
}

async function setupSharedAudioWorklet({ streams, sampleRate, generation }) {
    audioContext = new AudioContext({ sampleRate });
    await audioContext.audioWorklet.addModule(new URL('./audio-worklet.js', window.location.href).href);
    if (generation !== captureGeneration) throw new Error('Audio capture start was cancelled');

    const merger = audioContext.createChannelMerger(streams.length);
    audioSources = streams.map((stream, index) => {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(merger, 0, index);
        return source;
    });
    audioProcessor = new AudioWorkletNode(audioContext, 'meeting-pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { frameSamples: Math.floor(sampleRate * AUDIO_CHUNK_DURATION) },
    });
    audioSink = audioContext.createGain();
    audioSink.gain.value = 0;
    merger.connect(audioProcessor);
    audioProcessor.connect(audioSink);
    audioSink.connect(audioContext.destination);
    audioProcessor.port.onmessage = event => {
        if (generation !== captureGeneration || pendingAudioSends >= 50) return;
        const frame = event.data;
        pendingAudioSends++;
        ipcRenderer
            .invoke('send-audio-frame', {
                generation,
                source: streams.length > 1 ? 'mixed' : 'single',
                sequence: frame.sequence,
                capturedAt: frame.capturedAt,
                sampleRate,
                pcm: frame.pcm,
            })
            .catch(error => console.error('Failed to send audio frame:', error))
            .finally(() => pendingAudioSends--);
    };
    await audioContext.resume();
}

async function startCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium') {
    await stopCapture();
    const generation = ++captureGeneration;
    currentImageQuality = imageQuality;
    const preferences = await loadPreferencesCache();
    const audioMode = preferences.audioMode || 'speaker_only';
    const providerMode = preferences.providerMode || 'cloud';
    const sampleRate = providerMode === 'cloud' ? 24000 : 16000;
    const inputs = [];
    const warnings = [];

    try {
        if (isMacOS && audioMode !== 'mic_only') {
            const result = await ipcRenderer.invoke('start-macos-audio');
            if (result?.success) inputs.push('system');
            else warnings.push(`System audio: ${result?.error || 'unavailable'}`);
        }

        if (!isMacOS && audioMode !== 'mic_only') {
            try {
                mediaStream = await getLoopbackStream(sampleRate);
                if (mediaStream.getAudioTracks().length) inputs.push('system');
                else warnings.push('System audio: selected source has no audio');
            } catch (error) {
                warnings.push(`System audio: ${error.message}`);
            }
        }

        if (audioMode !== 'speaker_only') {
            try {
                micMediaStream = await getMicrophoneStream(sampleRate);
                inputs.push('microphone');
            } catch (error) {
                warnings.push(`Microphone: ${error.message}`);
            }
        }

        const browserStreams = [];
        if (mediaStream?.getAudioTracks().length) browserStreams.push(mediaStream);
        if (micMediaStream?.getAudioTracks().length) browserStreams.push(micMediaStream);
        if (browserStreams.length) await setupSharedAudioWorklet({ streams: browserStreams, sampleRate, generation });
        if (generation !== captureGeneration) throw new Error('Audio capture start was cancelled');

        if (!inputs.length) {
            cheatingDaddy.setStatus('Audio unavailable — text and Analyze Screen still work');
            return { success: true, audioAvailable: false, inputs, warnings };
        }
        if (warnings.length) cheatingDaddy.setStatus(`Listening with ${inputs.join(' + ')} (${warnings.join('; ')})`);
        return { success: true, audioAvailable: true, inputs, warnings };
    } catch (error) {
        await stopCapture();
        return { success: false, audioAvailable: false, inputs: [], error: error.message };
    }
}

async function stopCapture() {
    captureGeneration++;
    pendingAudioSends = 0;
    if (screenshotInterval) clearInterval(screenshotInterval);
    screenshotInterval = null;
    if (screenshotDelayTimer) clearTimeout(screenshotDelayTimer);
    screenshotDelayTimer = null;
    if (pendingScreenshotJob?.resolve) pendingScreenshotJob.resolve({ success: false, error: 'Meeting stopped' });
    pendingScreenshotJob = null;

    if (audioProcessor) {
        audioProcessor.port.onmessage = null;
        audioProcessor.disconnect();
    }
    micAudioProcessor?.disconnect();
    for (const source of audioSources) source.disconnect();
    audioSink?.disconnect();
    audioProcessor = null;
    micAudioProcessor = null;
    audioSources = [];
    audioSink = null;
    stopStream(mediaStream);
    stopStream(micMediaStream);
    mediaStream = null;
    micMediaStream = null;
    if (audioContext) await audioContext.close().catch(() => {});
    audioContext = null;

    if (isMacOS) await ipcRenderer.invoke('stop-macos-audio').catch(() => {});
    if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
    }
    hiddenVideo = null;
    offscreenCanvas = null;
    offscreenContext = null;
    return { success: true };
}

// Send text message to Gemini
async function sendTextMessage(text) {
    if (!text || text.trim().length === 0) {
        console.warn('Cannot send empty text message');
        return { success: false, error: 'Empty message' };
    }

    try {
        const result = await ipcRenderer.invoke('send-text-message', text);
        if (result.success) {
            console.log('Text message sent successfully');
        } else {
            console.error('Failed to send text message:', result.error);
        }
        return result;
    } catch (error) {
        console.error('Error sending text message:', error);
        return { success: false, error: error.message };
    }
}

// Listen for emergency erase command from main process
ipcRenderer.on('clear-sensitive-data', async () => {
    console.log('Clearing all data...');
    await storage.clearAll();
});

ipcRenderer.on('auto-capture-screenshot', async (event, { transcription }) => {
    console.log('[auto-screenshot] Triggered by voice:', transcription?.substring(0, 60));
    await captureManualScreenshot(null, transcription);
});

// Handle shortcuts based on current view
function handleShortcut(shortcutKey) {
    const currentView = cheatingDaddy.getCurrentView();

    if (shortcutKey === 'ctrl+enter' || shortcutKey === 'cmd+enter') {
        if (currentView === 'main') {
            cheatingDaddy.element().handleStart();
        } else {
            captureManualScreenshot();
        }
    }
}

// Create reference to the main app element
const cheatingDaddyApp = document.querySelector('cheating-daddy-app');

// ============ THEME SYSTEM ============
const theme = {
    themes: {
        dark: {
            background: '#101010',
            text: '#e0e0e0',
            textSecondary: '#a0a0a0',
            textMuted: '#6b6b6b',
            border: '#2a2a2a',
            accent: '#ffffff',
            btnPrimaryBg: '#ffffff',
            btnPrimaryText: '#000000',
            btnPrimaryHover: '#e0e0e0',
            tooltipBg: '#1a1a1a',
            tooltipText: '#ffffff',
            keyBg: 'rgba(255,255,255,0.1)',
        },
        light: {
            background: '#ffffff',
            text: '#1a1a1a',
            textSecondary: '#555555',
            textMuted: '#888888',
            border: '#e0e0e0',
            accent: '#000000',
            btnPrimaryBg: '#1a1a1a',
            btnPrimaryText: '#ffffff',
            btnPrimaryHover: '#333333',
            tooltipBg: '#1a1a1a',
            tooltipText: '#ffffff',
            keyBg: 'rgba(0,0,0,0.1)',
        },
        midnight: {
            background: '#0d1117',
            text: '#c9d1d9',
            textSecondary: '#8b949e',
            textMuted: '#6e7681',
            border: '#30363d',
            accent: '#58a6ff',
            btnPrimaryBg: '#58a6ff',
            btnPrimaryText: '#0d1117',
            btnPrimaryHover: '#79b8ff',
            tooltipBg: '#161b22',
            tooltipText: '#c9d1d9',
            keyBg: 'rgba(88,166,255,0.15)',
        },
        sepia: {
            background: '#f4ecd8',
            text: '#5c4b37',
            textSecondary: '#7a6a56',
            textMuted: '#998875',
            border: '#d4c8b0',
            accent: '#8b4513',
            btnPrimaryBg: '#5c4b37',
            btnPrimaryText: '#f4ecd8',
            btnPrimaryHover: '#7a6a56',
            tooltipBg: '#5c4b37',
            tooltipText: '#f4ecd8',
            keyBg: 'rgba(92,75,55,0.15)',
        },
        catppuccin: {
            background: '#1e1e2e',
            text: '#cdd6f4',
            textSecondary: '#a6adc8',
            textMuted: '#585b70',
            border: '#313244',
            accent: '#cba6f7',
            btnPrimaryBg: '#cba6f7',
            btnPrimaryText: '#1e1e2e',
            btnPrimaryHover: '#b4befe',
            tooltipBg: '#313244',
            tooltipText: '#cdd6f4',
            keyBg: 'rgba(203,166,247,0.12)',
        },
        gruvbox: {
            background: '#1d2021',
            text: '#ebdbb2',
            textSecondary: '#a89984',
            textMuted: '#665c54',
            border: '#3c3836',
            accent: '#fe8019',
            btnPrimaryBg: '#fe8019',
            btnPrimaryText: '#1d2021',
            btnPrimaryHover: '#fabd2f',
            tooltipBg: '#3c3836',
            tooltipText: '#ebdbb2',
            keyBg: 'rgba(254,128,25,0.12)',
        },
        rosepine: {
            background: '#191724',
            text: '#e0def4',
            textSecondary: '#908caa',
            textMuted: '#6e6a86',
            border: '#26233a',
            accent: '#ebbcba',
            btnPrimaryBg: '#ebbcba',
            btnPrimaryText: '#191724',
            btnPrimaryHover: '#f6c177',
            tooltipBg: '#26233a',
            tooltipText: '#e0def4',
            keyBg: 'rgba(235,188,186,0.12)',
        },
        solarized: {
            background: '#002b36',
            text: '#93a1a1',
            textSecondary: '#839496',
            textMuted: '#586e75',
            border: '#073642',
            accent: '#2aa198',
            btnPrimaryBg: '#2aa198',
            btnPrimaryText: '#002b36',
            btnPrimaryHover: '#268bd2',
            tooltipBg: '#073642',
            tooltipText: '#93a1a1',
            keyBg: 'rgba(42,161,152,0.12)',
        },
        tokyonight: {
            background: '#1a1b26',
            text: '#c0caf5',
            textSecondary: '#9aa5ce',
            textMuted: '#565f89',
            border: '#292e42',
            accent: '#7aa2f7',
            btnPrimaryBg: '#7aa2f7',
            btnPrimaryText: '#1a1b26',
            btnPrimaryHover: '#bb9af7',
            tooltipBg: '#292e42',
            tooltipText: '#c0caf5',
            keyBg: 'rgba(122,162,247,0.12)',
        },
    },

    current: 'dark',

    get(name) {
        return this.themes[name] || this.themes.dark;
    },

    getAll() {
        const names = {
            dark: 'Dark',
            light: 'Light',
            midnight: 'Midnight Blue',
            sepia: 'Sepia',
            catppuccin: 'Catppuccin Mocha',
            gruvbox: 'Gruvbox Dark',
            rosepine: 'Ros\u00e9 Pine',
            solarized: 'Solarized Dark',
            tokyonight: 'Tokyo Night',
        };
        return Object.keys(this.themes).map(key => ({
            value: key,
            name: names[key] || key,
            colors: this.themes[key],
        }));
    },

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? {
                  r: parseInt(result[1], 16),
                  g: parseInt(result[2], 16),
                  b: parseInt(result[3], 16),
              }
            : { r: 30, g: 30, b: 30 };
    },

    lightenColor(rgb, amount) {
        return {
            r: Math.min(255, rgb.r + amount),
            g: Math.min(255, rgb.g + amount),
            b: Math.min(255, rgb.b + amount),
        };
    },

    darkenColor(rgb, amount) {
        return {
            r: Math.max(0, rgb.r - amount),
            g: Math.max(0, rgb.g - amount),
            b: Math.max(0, rgb.b - amount),
        };
    },

    applyBackgrounds(backgroundColor, alpha = 0.8) {
        const root = document.documentElement;
        alpha = resolveBackgroundAlpha(process.platform, alpha);
        const baseRgb = this.hexToRgb(backgroundColor);

        // For light themes, darken; for dark themes, lighten
        const isLight = (baseRgb.r + baseRgb.g + baseRgb.b) / 3 > 128;
        const adjust = isLight ? this.darkenColor.bind(this) : this.lightenColor.bind(this);

        const secondary = adjust(baseRgb, 10);
        const tertiary = adjust(baseRgb, 22);
        const hover = adjust(baseRgb, 28);

        const bgBase = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${alpha})`;
        const bgSurface = `rgba(${secondary.r}, ${secondary.g}, ${secondary.b}, ${alpha})`;
        const bgElevated = `rgba(${tertiary.r}, ${tertiary.g}, ${tertiary.b}, ${alpha})`;
        const bgHover = `rgba(${hover.r}, ${hover.g}, ${hover.b}, ${alpha})`;

        // New design tokens (used by components)
        root.style.setProperty('--bg-app', bgBase);
        root.style.setProperty('--bg-surface', bgSurface);
        root.style.setProperty('--bg-elevated', bgElevated);
        root.style.setProperty('--bg-hover', bgHover);

        // Legacy aliases
        root.style.setProperty('--header-background', bgBase);
        root.style.setProperty('--main-content-background', bgBase);
        root.style.setProperty('--bg-primary', bgBase);
        root.style.setProperty('--bg-secondary', bgSurface);
        root.style.setProperty('--bg-tertiary', bgElevated);
        root.style.setProperty('--input-background', bgElevated);
        root.style.setProperty('--input-focus-background', bgElevated);
        root.style.setProperty('--hover-background', bgHover);
        root.style.setProperty('--scrollbar-background', bgBase);
    },

    apply(themeName, alpha = 0.8) {
        const colors = this.get(themeName);
        this.current = themeName;
        const root = document.documentElement;

        // New design tokens (used by components)
        root.style.setProperty('--text-primary', colors.text);
        root.style.setProperty('--text-secondary', colors.textSecondary);
        root.style.setProperty('--text-muted', colors.textMuted);
        root.style.setProperty('--border', colors.border);
        root.style.setProperty('--border-strong', colors.accent);
        root.style.setProperty('--accent', colors.btnPrimaryBg);
        root.style.setProperty('--accent-hover', colors.btnPrimaryHover);

        // Legacy aliases
        root.style.setProperty('--text-color', colors.text);
        root.style.setProperty('--border-color', colors.border);
        root.style.setProperty('--border-default', colors.accent);
        root.style.setProperty('--placeholder-color', colors.textMuted);
        root.style.setProperty('--scrollbar-thumb', colors.border);
        root.style.setProperty('--scrollbar-thumb-hover', colors.textMuted);
        root.style.setProperty('--key-background', colors.keyBg);
        // Primary button
        root.style.setProperty('--btn-primary-bg', colors.btnPrimaryBg);
        root.style.setProperty('--btn-primary-text', colors.btnPrimaryText);
        root.style.setProperty('--btn-primary-hover', colors.btnPrimaryHover);
        // Start button (same as primary)
        root.style.setProperty('--start-button-background', colors.btnPrimaryBg);
        root.style.setProperty('--start-button-color', colors.btnPrimaryText);
        root.style.setProperty('--start-button-hover-background', colors.btnPrimaryHover);
        // Tooltip
        root.style.setProperty('--tooltip-bg', colors.tooltipBg);
        root.style.setProperty('--tooltip-text', colors.tooltipText);
        // Error color (stays constant)
        root.style.setProperty('--error-color', '#f14c4c');
        root.style.setProperty('--success-color', '#4caf50');

        // Also apply background colors from theme
        this.applyBackgrounds(colors.background, alpha);
    },

    async load() {
        try {
            const prefs = await storage.getPreferences();
            const themeName = prefs.theme || 'dark';
            const alpha = resolveBackgroundAlpha(process.platform, prefs.backgroundTransparency ?? 0.8);
            this.apply(themeName, alpha);
            return themeName;
        } catch (err) {
            this.apply('dark');
            return 'dark';
        }
    },

    async save(themeName) {
        await storage.updatePreference('theme', themeName);
        this.apply(themeName);
    },
};

// Consolidated cheatingDaddy object - all functions in one place
const cheatingDaddy = {
    // App version
    getVersion: async () => ipcRenderer.invoke('get-app-version'),

    // Element access
    element: () => cheatingDaddyApp,
    e: () => cheatingDaddyApp,

    // App state functions - access properties directly from the app element
    getCurrentView: () => cheatingDaddyApp.currentView,
    getLayoutMode: () => cheatingDaddyApp.layoutMode,

    // Status and response functions
    setStatus: text => cheatingDaddyApp.setStatus(text),
    addNewResponse: response => cheatingDaddyApp.addNewResponse(response),
    updateCurrentResponse: response => cheatingDaddyApp.updateCurrentResponse(response),

    // Core functionality
    initializeGemini,
    initializeCloud,
    initializeLocal,
    startCapture,
    stopCapture,
    sendTextMessage,
    handleShortcut,

    // Storage API
    storage,

    // Theme API
    theme,

    // Refresh preferences cache (call after updating preferences)
    refreshPreferencesCache: loadPreferencesCache,

    // Platform detection
    isLinux: isLinux,
    isMacOS: isMacOS,
    isWindows: isWindows,
};

// Make it globally available
window.cheatingDaddy = cheatingDaddy;

customElements
    .whenDefined('cheating-daddy-app')
    .then(() => cheatingDaddyApp.updateComplete)
    .then(() => ipcRenderer.send('renderer-ready'))
    .catch(error => console.error('Renderer startup failed:', error));

// Load theme after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => theme.load());
} else {
    theme.load();
}
