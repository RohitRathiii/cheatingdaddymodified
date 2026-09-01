const { systemPreferences } = require('electron');

const ALT_KEYCODES = new Set([56, 3640]);

let hookApi = null;
let hookLoadAttempted = false;
let hookStarted = false;
let promptedAccessibility = false;
let optionHeld = false;
let usedAsModifier = false;
let onOptionTap = null;

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

function isAltKey(event) {
    return Boolean(event && ALT_KEYCODES.has(event.keycode));
}

function handleKeyDown(event) {
    if (isAltKey(event)) {
        if (!optionHeld) {
            optionHeld = true;
            usedAsModifier = false;
        }
        return;
    }
    if (optionHeld) {
        usedAsModifier = true;
    }
}

function handleKeyUp(event) {
    if (!isAltKey(event)) return;
    const shouldToggle = optionHeld && !usedAsModifier;
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
        console.warn('Failed to start Option tap monitor:', error.message);
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
