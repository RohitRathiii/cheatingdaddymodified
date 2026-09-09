const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampBoundsToWorkArea } = require('./windowBounds');

test('clamps a restored window to the usable display after scaling or monitor removal', () => {
    assert.deepEqual(
        clampBoundsToWorkArea({ x: 2500, y: -400, width: 1400, height: 1000 }, { x: 0, y: 0, width: 1200, height: 800 }),
        { x: 0, y: 0, width: 1200, height: 800 }
    );
});

test('preserves valid negative display coordinates', () => {
    assert.deepEqual(
        clampBoundsToWorkArea({ x: -1800, y: 50, width: 900, height: 700 }, { x: -1920, y: 0, width: 1920, height: 1040 }),
        { x: -1800, y: 50, width: 900, height: 700 }
    );
});
