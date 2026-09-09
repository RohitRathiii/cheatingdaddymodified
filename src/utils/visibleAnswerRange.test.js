const { test } = require('node:test');
const assert = require('node:assert/strict');
const { visibleAnswerRange } = require('./visibleAnswerRange');

test('mounts at most 30 answers and keeps the focused answer visible', () => {
    assert.deepEqual(visibleAnswerRange(5000, 4999, 30), { start: 4970, end: 5000 });
    const older = visibleAnswerRange(5000, 12, 30);
    assert.ok(older.end - older.start <= 30);
    assert.ok(older.start <= 12 && older.end > 12);
});
