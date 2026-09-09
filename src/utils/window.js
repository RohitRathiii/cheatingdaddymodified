const { BrowserWindow, globalShortcut, ipcMain, screen, Menu } = require('electron');
const path = require('node:path');
const storage = require('../storage');
const { startOptionTapMonitor, stopOptionTapMonitor } = require('./optionTapMonitor');
const {
    canRegisterGlobalShortcut,
    getDefaultToggleVisibility,
    mergeKeybinds,
    getOverlayRestoreMethod,
    shouldUseTransparentOverlay,
    getOverlayBackgroundColor,
    shouldShowWindowOnCreate,
} = require('./overlayVisibility');

let mouseEventsIgnored = false;
let stealthHidden = false;
let lastVisibilityToggleAt = 0;

function isOverlayShown(mainWindow) {
    return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !stealthHidden);
}

function setClickThrough(mainWindow, enabled) {
    mouseEventsIgnored = enabled;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (enabled) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
        mainWindow.setIgnoreMouseEvents(false);
    }
    mainWindow.webContents.send('click-through-toggled', enabled);
}

function hideOverlayWindow(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed() || stealthHidden) return;
    stealthHidden = true;
    setClickThrough(mainWindow, true);
    mainWindow.webContents.send('stealth-hidden-changed', true);
    mainWindow.hide();
}

function restoreOverlayWindow(mainWindow) {
    if (getOverlayRestoreMethod(process.platform) === 'show') {
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        if (typeof mainWindow.moveTop === 'function') {
            mainWindow.moveTop();
        }
        return;
    }
    mainWindow.showInactive();
}

function showOverlayWindow(mainWindow) {
    stealthHidden = false;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setClickThrough(mainWindow, false);
    if (!mainWindow.isVisible()) {
        restoreOverlayWindow(mainWindow);
    }
    mainWindow.webContents.send('stealth-hidden-changed', false);
}

function setWindowFrame(mainWindow, width, height, x, y) {
    const wasResizable = mainWindow.isResizable();
    if (!wasResizable) {
        mainWindow.setResizable(true);
    }
    mainWindow.setSize(width, height);
    mainWindow.setPosition(x, y);
    if (!wasResizable) {
        mainWindow.setResizable(false);
    }
}

function getTopCenteredBounds(width, height) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea || { x: 0, y: 0, ...primaryDisplay.workAreaSize };
    return {
        x: workArea.x + Math.floor((workArea.width - width) / 2),
        y: workArea.y,
        width,
        height,
    };
}

function toggleOverlayVisibility(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const now = Date.now();
    if (now - lastVisibilityToggleAt < 250) return;
    lastVisibilityToggleAt = now;
    if (isOverlayShown(mainWindow)) {
        hideOverlayWindow(mainWindow);
    } else {
        showOverlayWindow(mainWindow);
    }
}

function createWindow(sendToRenderer, geminiSessionRef) {
    const isWin = process.platform === 'win32';
    const windowWidth = 1100;
    const windowHeight = 800;
    const startBounds = getTopCenteredBounds(windowWidth, windowHeight);

    if (isWin) {
        try {
            Menu.setApplicationMenu(null);
        } catch (error) {
            console.warn('Could not remove application menu:', error.message);
        }
    }

    const mainWindow = new BrowserWindow({
        width: startBounds.width,
        height: startBounds.height,
        x: startBounds.x,
        y: startBounds.y,
        show: shouldShowWindowOnCreate(process.platform),
        frame: false,
        transparent: shouldUseTransparentOverlay(process.platform),
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: isWin,
        roundedCorners: !isWin,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // TODO: change to true
            backgroundThrottling: false,
            enableBlinkFeatures: 'GetDisplayMedia',
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: getOverlayBackgroundColor(process.platform),
    });

    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            });
        },
        { useSystemPicker: true }
    );

    mainWindow.setResizable(false);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (process.platform === 'darwin') {
        try {
            mainWindow.setHiddenInMissionControl(true);
        } catch (error) {
            console.warn('Could not hide from Mission Control:', error.message);
        }
        mainWindow.setContentProtection(true);
    }

    if (isWin) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.setContentProtection(true);
        try {
            mainWindow.setSkipTaskbar(true);
        } catch (error) {
            console.warn('Could not hide from taskbar:', error.message);
        }
        if (!mainWindow.isVisible()) {
            mainWindow.show();
        }
        if (typeof mainWindow.moveTop === 'function') {
            mainWindow.moveTop();
        }
    }

    let hookStartedForWindow = false;
    const startHideShortcut = () => {
        if (hookStartedForWindow || mainWindow.isDestroyed()) return;
        hookStartedForWindow = true;
        const optionMonitorReady = startOptionTapMonitor(() => {
            toggleOverlayVisibility(mainWindow);
        });
        if (!optionMonitorReady) {
            console.warn(
                isWin
                    ? 'Alt tap hide is unavailable; Ctrl+\\ still toggles visibility.'
                    : 'Option tap hide requires Accessibility on macOS; Cmd+\\ still toggles visibility.'
            );
        }
    };

    if (isWin) {
        mainWindow.webContents.once('did-finish-load', startHideShortcut);
    } else {
        mainWindow.once('ready-to-show', () => {
            if (!mainWindow.isDestroyed()) {
                mainWindow.show();
            }
            startHideShortcut();
        });
        setTimeout(() => {
            if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                mainWindow.show();
            }
            startHideShortcut();
        }, 2000);
    }

    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    mainWindow.webContents.once('dom-ready', () => {
        startHideShortcut();
        setTimeout(() => {
            const defaultKeybinds = getDefaultKeybinds();
            const savedKeybinds = storage.getKeybinds();
            const keybinds = mergeKeybinds(defaultKeybinds, savedKeybinds, process.platform);
            if (process.platform === 'win32' && savedKeybinds && savedKeybinds.toggleVisibility === 'Ctrl+\\') {
                storage.setKeybinds(keybinds);
            }
            updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }, 150);
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef);

    return mainWindow;
}

function getDefaultKeybinds() {
    const isMac = process.platform === 'darwin';
    return {
        moveUp: isMac ? 'Alt+Up' : 'Ctrl+Up',
        moveDown: isMac ? 'Alt+Down' : 'Ctrl+Down',
        moveLeft: isMac ? 'Alt+Left' : 'Ctrl+Left',
        moveRight: isMac ? 'Alt+Right' : 'Ctrl+Right',
        toggleVisibility: getDefaultToggleVisibility(process.platform),
        toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
        nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
        previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
        nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
        scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
        scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
        emergencyErase: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
    };
}

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef) {
    console.log('Updating global shortcuts with:', keybinds);

    // Unregister all existing shortcuts
    globalShortcut.unregisterAll();

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const moveIncrement = Math.floor(Math.min(width, height) * 0.1);

    // Register window movement shortcuts
    const movementActions = {
        moveUp: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY - moveIncrement);
        },
        moveDown: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY + moveIncrement);
        },
        moveLeft: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX - moveIncrement, currentY);
        },
        moveRight: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX + moveIncrement, currentY);
        },
    };

    // Register each movement shortcut
    Object.keys(movementActions).forEach(action => {
        const keybind = keybinds[action];
        if (keybind) {
            try {
                globalShortcut.register(keybind, movementActions[action]);
                console.log(`Registered ${action}: ${keybind}`);
            } catch (error) {
                console.error(`Failed to register ${action} (${keybind}):`, error);
            }
        }
    });

    // Register toggle visibility shortcut. Electron cannot register Alt by itself.
    if (canRegisterGlobalShortcut(keybinds.toggleVisibility)) {
        try {
            globalShortcut.register(keybinds.toggleVisibility, () => {
                toggleOverlayVisibility(mainWindow);
            });
            console.log(`Registered toggleVisibility: ${keybinds.toggleVisibility}`);
        } catch (error) {
            console.error(`Failed to register toggleVisibility (${keybinds.toggleVisibility}):`, error);
        }
    } else {
        console.log(`Skipping globalShortcut for toggleVisibility: ${keybinds.toggleVisibility} (handled by Alt tap)`);
    }

    if (process.platform === 'win32' && keybinds.toggleVisibility === 'Alt') {
        try {
            globalShortcut.register('Ctrl+\\', () => {
                toggleOverlayVisibility(mainWindow);
            });
            console.log('Registered fallback toggleVisibility: Ctrl+\\');
        } catch (error) {
            console.error('Failed to register fallback toggleVisibility (Ctrl+\\):', error);
        }
    }

    // Register toggle click-through shortcut
    if (keybinds.toggleClickThrough) {
        try {
            globalShortcut.register(keybinds.toggleClickThrough, () => {
                setClickThrough(mainWindow, !mouseEventsIgnored);
                console.log(mouseEventsIgnored ? 'Mouse events ignored' : 'Mouse events enabled');
            });
            console.log(`Registered toggleClickThrough: ${keybinds.toggleClickThrough}`);
        } catch (error) {
            console.error(`Failed to register toggleClickThrough (${keybinds.toggleClickThrough}):`, error);
        }
    }

    // Register next step shortcut (either starts session or takes screenshot based on view)
    if (keybinds.nextStep) {
        try {
            globalShortcut.register(keybinds.nextStep, async () => {
                console.log('Next step shortcut triggered');
                try {
                    // Determine the shortcut key format
                    const isMac = process.platform === 'darwin';
                    const shortcutKey = isMac ? 'cmd+enter' : 'ctrl+enter';

                    // Use the new handleShortcut function
                    mainWindow.webContents.executeJavaScript(`
                        cheatingDaddy.handleShortcut('${shortcutKey}');
                    `);
                } catch (error) {
                    console.error('Error handling next step shortcut:', error);
                }
            });
            console.log(`Registered nextStep: ${keybinds.nextStep}`);
        } catch (error) {
            console.error(`Failed to register nextStep (${keybinds.nextStep}):`, error);
        }
    }

    // Register previous response shortcut
    if (keybinds.previousResponse) {
        try {
            globalShortcut.register(keybinds.previousResponse, () => {
                console.log('Previous response shortcut triggered');
                sendToRenderer('navigate-previous-response');
            });
            console.log(`Registered previousResponse: ${keybinds.previousResponse}`);
        } catch (error) {
            console.error(`Failed to register previousResponse (${keybinds.previousResponse}):`, error);
        }
    }

    // Register next response shortcut
    if (keybinds.nextResponse) {
        try {
            globalShortcut.register(keybinds.nextResponse, () => {
                console.log('Next response shortcut triggered');
                sendToRenderer('navigate-next-response');
            });
            console.log(`Registered nextResponse: ${keybinds.nextResponse}`);
        } catch (error) {
            console.error(`Failed to register nextResponse (${keybinds.nextResponse}):`, error);
        }
    }

    // Register scroll up shortcut
    if (keybinds.scrollUp) {
        try {
            globalShortcut.register(keybinds.scrollUp, () => {
                console.log('Scroll up shortcut triggered');
                sendToRenderer('scroll-response-up');
            });
            console.log(`Registered scrollUp: ${keybinds.scrollUp}`);
        } catch (error) {
            console.error(`Failed to register scrollUp (${keybinds.scrollUp}):`, error);
        }
    }

    // Register scroll down shortcut
    if (keybinds.scrollDown) {
        try {
            globalShortcut.register(keybinds.scrollDown, () => {
                console.log('Scroll down shortcut triggered');
                sendToRenderer('scroll-response-down');
            });
            console.log(`Registered scrollDown: ${keybinds.scrollDown}`);
        } catch (error) {
            console.error(`Failed to register scrollDown (${keybinds.scrollDown}):`, error);
        }
    }

    // Register emergency erase shortcut
    if (keybinds.emergencyErase) {
        try {
            globalShortcut.register(keybinds.emergencyErase, () => {
                console.log('Emergency Erase triggered!');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    stopOptionTapMonitor();
                    mainWindow.hide();

                    if (geminiSessionRef.current) {
                        geminiSessionRef.current.close();
                        geminiSessionRef.current = null;
                    }

                    sendToRenderer('clear-sensitive-data');

                    setTimeout(() => {
                        const { app } = require('electron');
                        app.quit();
                    }, 300);
                }
            });
            console.log(`Registered emergencyErase: ${keybinds.emergencyErase}`);
        } catch (error) {
            console.error(`Failed to register emergencyErase (${keybinds.emergencyErase}):`, error);
        }
    }
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef) {
    ipcMain.on('view-changed', (event, view) => {
        if (!mainWindow.isDestroyed()) {
            if (view === 'assistant') {
                const live = getTopCenteredBounds(850, 400);
                setWindowFrame(mainWindow, live.width, live.height, live.x, live.y);
            } else {
                const full = getTopCenteredBounds(1100, 800);
                setWindowFrame(mainWindow, full.width, full.height, full.x, full.y);
                mainWindow.setIgnoreMouseEvents(false);
            }
        }
    });

    ipcMain.handle('window-minimize', () => {
        if (!mainWindow.isDestroyed()) {
            mainWindow.minimize();
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (!mainWindow.isDestroyed()) {
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    ipcMain.handle('toggle-window-visibility', async event => {
        try {
            if (mainWindow.isDestroyed()) {
                return { success: false, error: 'Window has been destroyed' };
            }

            toggleOverlayVisibility(mainWindow);
            return { success: true };
        } catch (error) {
            console.error('Error toggling window visibility:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-sizes', async event => {
        // With the sidebar layout, the window size is user-controlled.
        // This handler is kept for compatibility but is a no-op now.
        return { success: true };
    });
}

module.exports = {
    createWindow,
    getDefaultKeybinds,
    updateGlobalShortcuts,
    setupWindowIpcHandlers,
    toggleOverlayVisibility,
    hideOverlayWindow,
    showOverlayWindow,
};
