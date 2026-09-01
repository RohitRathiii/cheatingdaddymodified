const SCREENSHOT_MAX_WIDTH = 1280;
const MIN_JPEG_BYTES = 1000;

const SCREEN_RECORDING_DENIED =
    'Screen Recording permission is denied. Enable it in System Settings → Privacy & Security → Screen Recording, then restart the app.';

const SCREEN_RECORDING_EMPTY =
    'Screenshot was empty. Grant Screen Recording in System Settings → Privacy & Security → Screen Recording, then restart the app.';

function jpegQualityPercent(quality) {
    switch (quality) {
        case 'high':
            return 85;
        case 'low':
            return 40;
        case 'medium':
        default:
            return 60;
    }
}

function selectScreenSource(sources, primaryDisplayId) {
    if (!Array.isArray(sources) || sources.length === 0) {
        return null;
    }
    const primaryId = primaryDisplayId == null ? '' : String(primaryDisplayId);
    return sources.find(source => String(source.display_id) === primaryId) || sources[0];
}

function thumbnailSizeForDisplay(display, maxWidth = SCREENSHOT_MAX_WIDTH) {
    const scale = display?.scaleFactor || 1;
    const width = Math.max(1, Math.round((display?.size?.width || 1280) * scale));
    const height = Math.max(1, Math.round((display?.size?.height || 720) * scale));
    if (width <= maxWidth) {
        return { width, height };
    }
    return {
        width: maxWidth,
        height: Math.max(1, Math.round(height * (maxWidth / width))),
    };
}

function describeScreenCaptureError({ reason, status } = {}) {
    if (reason === 'permission' || status === 'denied' || status === 'restricted') {
        return SCREEN_RECORDING_DENIED;
    }
    if (reason === 'empty') {
        return SCREEN_RECORDING_EMPTY;
    }
    if (reason === 'no-sources') {
        return 'No displays found to capture.';
    }
    return 'Failed to capture the screen.';
}

function isDeniedStatus(status) {
    return status === 'denied' || status === 'restricted';
}

function createScreenStillCapture(deps) {
    const { platform, getMediaAccessStatus, getPrimaryDisplay, getSources } = deps;

    return async function captureScreenStill({ quality = 'medium' } = {}) {
        try {
            if (platform === 'darwin' && typeof getMediaAccessStatus === 'function') {
                const status = getMediaAccessStatus('screen');
                if (isDeniedStatus(status)) {
                    return { success: false, error: describeScreenCaptureError({ reason: 'permission', status }) };
                }
            }

            const primary = getPrimaryDisplay();
            const thumbnailSize = thumbnailSizeForDisplay(primary, SCREENSHOT_MAX_WIDTH);
            const sources = await getSources({ types: ['screen'], thumbnailSize });
            const source = selectScreenSource(sources, primary?.id);

            if (!source) {
                return { success: false, error: describeScreenCaptureError({ reason: 'no-sources' }) };
            }

            const thumbnail = source.thumbnail;
            if (!thumbnail || (typeof thumbnail.isEmpty === 'function' && thumbnail.isEmpty())) {
                return { success: false, error: describeScreenCaptureError({ reason: 'empty' }) };
            }

            const jpeg = thumbnail.toJPEG(jpegQualityPercent(quality));
            if (!jpeg || jpeg.length < MIN_JPEG_BYTES) {
                return { success: false, error: describeScreenCaptureError({ reason: 'empty' }) };
            }

            const size = typeof thumbnail.getSize === 'function' ? thumbnail.getSize() : thumbnailSize;
            return {
                success: true,
                data: jpeg.toString('base64'),
                width: size.width,
                height: size.height,
                mimeType: 'image/jpeg',
            };
        } catch (error) {
            const message = error?.message || String(error);
            if (platform === 'darwin' && /permission|denied|not authorized/i.test(message)) {
                return { success: false, error: describeScreenCaptureError({ reason: 'permission', status: 'denied' }) };
            }
            return { success: false, error: message };
        }
    };
}

function captureScreenStill(options) {
    const { desktopCapturer, screen, systemPreferences } = require('electron');
    const capture = createScreenStillCapture({
        platform: process.platform,
        getMediaAccessStatus: mediaType => systemPreferences.getMediaAccessStatus(mediaType),
        getPrimaryDisplay: () => screen.getPrimaryDisplay(),
        getSources: opts => desktopCapturer.getSources(opts),
    });
    return capture(options);
}

module.exports = {
    SCREENSHOT_MAX_WIDTH,
    jpegQualityPercent,
    selectScreenSource,
    thumbnailSizeForDisplay,
    describeScreenCaptureError,
    createScreenStillCapture,
    captureScreenStill,
};
