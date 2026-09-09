const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('./overlayVisibility');

test('recognizes left and right Alt keycodes from uiohook', () => {
    assert.equal(isAltKeyEvent({ keycode: 56 }), true);
    assert.equal(isAltKeyEvent({ keycode: 3640 }), true);
    assert.equal(isAltKeyEvent({ keycode: 0x001d }), false);
    assert.equal(isAltKeyEvent(null), false);
});

test('treats AltGr as a chord so it does not hide the overlay', () => {
    assert.equal(isAltUsedAsChord({ keycode: 3640, ctrlKey: true }), true);
    assert.equal(isAltUsedAsChord({ keycode: 56, ctrlKey: false, shiftKey: false, metaKey: false }), false);
});

test('ignores Alt release until the startup grace period ends', () => {
    assert.equal(
        shouldToggleOnAltRelease({
            optionHeld: true,
            usedAsModifier: false,
            now: 100,
            ignoreUntil: 400,
        }),
        false
    );
    assert.equal(
        shouldToggleOnAltRelease({
            optionHeld: true,
            usedAsModifier: false,
            now: 401,
            ignoreUntil: 400,
        }),
        true
    );
    assert.equal(
        shouldToggleOnAltRelease({
            optionHeld: true,
            usedAsModifier: true,
            now: 401,
            ignoreUntil: 400,
        }),
        false
    );
});

test('does not register modifier-only shortcuts with Electron globalShortcut', () => {
    assert.equal(isModifierOnlyKeybind('Alt'), true);
    assert.equal(canRegisterGlobalShortcut('Alt'), false);
    assert.equal(canRegisterGlobalShortcut('Ctrl+\\'), true);
});

test('uses Alt as the Windows hide/show shortcut and migrates the old Ctrl+\\ default', () => {
    assert.equal(getDefaultToggleVisibility('win32'), 'Alt');
    assert.equal(getDefaultToggleVisibility('darwin'), 'Cmd+\\');

    const defaults = { toggleVisibility: 'Alt', nextStep: 'Ctrl+Enter' };
    const merged = mergeKeybinds(defaults, { toggleVisibility: 'Ctrl+\\', nextStep: 'Ctrl+Enter' }, 'win32');
    assert.equal(merged.toggleVisibility, 'Alt');
    assert.equal(merged.nextStep, 'Ctrl+Enter');
});

test('restores a hidden Windows overlay with show instead of showInactive', () => {
    assert.equal(getOverlayRestoreMethod('win32'), 'show');
    assert.equal(getOverlayRestoreMethod('darwin'), 'showInactive');
});

test('uses an opaque, immediately visible window on Windows', () => {
    assert.equal(shouldUseTransparentOverlay('win32'), false);
    assert.equal(shouldUseTransparentOverlay('darwin'), true);
    assert.equal(getOverlayBackgroundColor('win32'), '#0a0a0a');
    assert.equal(getOverlayBackgroundColor('darwin'), '#00000000');
    assert.equal(shouldShowWindowOnCreate('win32'), true);
    assert.equal(shouldShowWindowOnCreate('darwin'), false);
    assert.equal(resolveBackgroundAlpha('win32', 0.8), 1);
    assert.equal(resolveBackgroundAlpha('darwin', 0.8), 0.8);
});
