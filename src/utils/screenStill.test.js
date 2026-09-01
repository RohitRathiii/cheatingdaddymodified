const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    jpegQualityPercent,
    selectScreenSource,
    thumbnailSizeForDisplay,
    describeScreenCaptureError,
    createScreenStillCapture,
} = require('./screenStill');

test('jpegQualityPercent maps named qualities', () => {
    assert.equal(jpegQualityPercent('high'), 85);
    assert.equal(jpegQualityPercent('medium'), 60);
    assert.equal(jpegQualityPercent('low'), 40);
    assert.equal(jpegQualityPercent('unknown'), 60);
});

test('selectScreenSource prefers the primary display id', () => {
    const sources = [
        { id: 'screen:2', display_id: '2', name: 'Display 2' },
        { id: 'screen:1', display_id: '1', name: 'Built-in' },
    ];
    assert.equal(selectScreenSource(sources, '1').id, 'screen:1');
});

test('selectScreenSource falls back to the first source', () => {
    const sources = [{ id: 'screen:9', display_id: '9', name: 'Only' }];
    assert.equal(selectScreenSource(sources, '1').id, 'screen:9');
    assert.equal(selectScreenSource([], '1'), null);
});

test('thumbnailSizeForDisplay caps width and keeps aspect', () => {
    const size = thumbnailSizeForDisplay({ size: { width: 2560, height: 1440 }, scaleFactor: 1 }, 1280);
    assert.equal(size.width, 1280);
    assert.equal(size.height, 720);
});

test('describeScreenCaptureError mentions Screen Recording when denied', () => {
    const message = describeScreenCaptureError({ reason: 'permission', status: 'denied' });
    assert.match(message, /Screen Recording/i);
    assert.match(message, /System Settings/i);
});

test('createScreenStillCapture returns a JPEG still from the primary display', async () => {
    const jpeg = Buffer.alloc(1500, 1);
    const capture = createScreenStillCapture({
        platform: 'darwin',
        getMediaAccessStatus: () => 'granted',
        getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 2 }),
        getSources: async () => [
            {
                display_id: '1',
                thumbnail: {
                    isEmpty: () => false,
                    toJPEG: () => jpeg,
                    getSize: () => ({ width: 1280, height: 720 }),
                },
            },
        ],
    });

    const result = await capture({ quality: 'medium' });
    assert.equal(result.success, true);
    assert.equal(result.data, jpeg.toString('base64'));
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
});

test('createScreenStillCapture fails clearly when Screen Recording is denied', async () => {
    let called = false;
    const capture = createScreenStillCapture({
        platform: 'darwin',
        getMediaAccessStatus: () => 'denied',
        getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 }),
        getSources: async () => {
            called = true;
            return [];
        },
    });

    const result = await capture({});
    assert.equal(result.success, false);
    assert.match(result.error, /Screen Recording/i);
    assert.equal(called, false);
});

test('createScreenStillCapture treats an empty thumbnail as a permission problem on macOS', async () => {
    const capture = createScreenStillCapture({
        platform: 'darwin',
        getMediaAccessStatus: () => 'granted',
        getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 }),
        getSources: async () => [
            {
                display_id: '1',
                thumbnail: {
                    isEmpty: () => true,
                    toJPEG: () => Buffer.alloc(0),
                    getSize: () => ({ width: 0, height: 0 }),
                },
            },
        ],
    });

    const result = await capture({});
    assert.equal(result.success, false);
    assert.match(result.error, /Screen Recording/i);
});
