const ALT_KEYCODES = new Set([56, 3640]);

function isAltKeyEvent(event) {
    return Boolean(event && ALT_KEYCODES.has(event.keycode));
}

function isAltUsedAsChord(event) {
    return Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey));
}

function shouldToggleOnAltRelease({ optionHeld, usedAsModifier, now = Date.now(), ignoreUntil = 0 }) {
    return Boolean(optionHeld && !usedAsModifier && now >= ignoreUntil);
}

function isModifierOnlyKeybind(keybind) {
    return /^(Alt|Option|Ctrl|Control|Shift|Cmd|Command|Meta|Super)$/i.test(String(keybind || '').trim());
}

function canRegisterGlobalShortcut(keybind) {
    return Boolean(keybind) && !isModifierOnlyKeybind(keybind);
}

function getDefaultToggleVisibility(platform) {
    return platform === 'darwin' ? 'Cmd+\\' : 'Alt';
}

function mergeKeybinds(defaults, saved, platform) {
    const next = { ...defaults, ...(saved || {}) };
    if (platform === 'win32' && saved && saved.toggleVisibility === 'Ctrl+\\') {
        next.toggleVisibility = defaults.toggleVisibility;
    }
    return next;
}

function getOverlayRestoreMethod(platform) {
    return platform === 'win32' ? 'show' : 'showInactive';
}

function shouldUseTransparentOverlay(platform) {
    return platform !== 'win32';
}

function getOverlayBackgroundColor(platform) {
    return platform === 'win32' ? '#0a0a0a' : '#00000000';
}

function shouldShowWindowOnCreate(platform) {
    return platform === 'win32';
}

function resolveBackgroundAlpha(platform, requestedAlpha) {
    if (platform === 'win32') return 1;
    return requestedAlpha ?? 0.8;
}

module.exports = {
    ALT_KEYCODES,
    isAltKeyEvent,
    isAltUsedAsChord,
    shouldToggleOnAltRelease,
    isModifierOnlyKeybind,
    canRegisterGlobalShortcut,
    getDefaultToggleVisibility,
    mergeKeybinds,
    getOverlayRestoreMethod,
    shouldUseTransparentOverlay,
    getOverlayBackgroundColor,
    shouldShowWindowOnCreate,
    resolveBackgroundAlpha,
};
