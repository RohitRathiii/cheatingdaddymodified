const { systemPreferences } = require('electron');
const { isAltKeyEvent, isAltUsedAsChord, shouldToggleOnAltRelease } = require('./overlayVisibility');

const STARTUP_IGNORE_MS = 400;

let hookApi = null;
let hookLoadAttempted = false;
let hookStarted = false;
let promptedAccessibility = false;
let optionHeld = false;
let usedAsModifier = false;
let onOptionTap = null;
let ignoreUntil = 0;

function loadHook() {
    if (hookLoadAttempted) return hookApi;
    hookLoadAttempted = true;
    try {
        hookApi = require('uiohook-napi');
    } catch (error) {
        hookApi = null;
        console.warn('uiohook-napi unavailable; Option tap hide is disabled:', error.message);
    }
    return hookApi;
}

function handleKeyDown(event) {
    if (isAltKeyEvent(event)) {
        if (!optionHeld) {
            optionHeld = true;
            usedAsModifier = isAltUsedAsChord(event);
        }
        return;
    }
    if (optionHeld) {
        usedAsModifier = true;
    }
}

function handleKeyUp(event) {
    if (!isAltKeyEvent(event)) return;
    const shouldToggle = shouldToggleOnAltRelease({
        optionHeld,
        usedAsModifier,
        now: Date.now(),
        ignoreUntil,
    });
    optionHeld = false;
    usedAsModifier = false;
    if (shouldToggle && typeof onOptionTap === 'function') {
        onOptionTap();
    }
}

function handleMouseDown() {
    if (optionHeld) {
        usedAsModifier = true;
    }
}

function ensureAccessibility() {
    if (process.platform !== 'darwin') return true;
    try {
        const prompt = !promptedAccessibility;
        promptedAccessibility = true;
        return systemPreferences.isTrustedAccessibilityClient(prompt);
    } catch (error) {
        console.warn('Could not check Accessibility permission:', error.message);
        return false;
    }
}

function startOptionTapMonitor(callback) {
    onOptionTap = callback;
    optionHeld = false;
    usedAsModifier = false;
    ignoreUntil = Date.now() + STARTUP_IGNORE_MS;

    const api = loadHook();
    if (!api || !api.uIOhook) return false;
    if (!ensureAccessibility()) return false;
    if (hookStarted) return true;

    try {
        api.uIOhook.on('keydown', handleKeyDown);
        api.uIOhook.on('keyup', handleKeyUp);
        api.uIOhook.on('mousedown', handleMouseDown);
        api.uIOhook.start();
        hookStarted = true;
        return true;
    } catch (error) {
        console.warn('Failed to start Alt tap monitor:', error.message);
        hookStarted = false;
        return false;
    }
}

function stopOptionTapMonitor() {
    onOptionTap = null;
    optionHeld = false;
    usedAsModifier = false;
    if (!hookApi || !hookApi.uIOhook || !hookStarted) return;

    try {
        hookApi.uIOhook.off('keydown', handleKeyDown);
        hookApi.uIOhook.off('keyup', handleKeyUp);
        hookApi.uIOhook.off('mousedown', handleMouseDown);
        hookApi.uIOhook.stop();
    } catch (error) {
        console.warn('Failed to stop Option tap monitor:', error.message);
    }
    hookStarted = false;
}

module.exports = {
    startOptionTapMonitor,
    stopOptionTapMonitor,
};
