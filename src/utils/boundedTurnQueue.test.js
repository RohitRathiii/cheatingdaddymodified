const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BoundedTurnQueue } = require('./boundedTurnQueue');

test('keeps at most three pending typed requests and preserves rejected input', () => {
    const queue = new BoundedTurnQueue(3);
    assert.equal(queue.push('one').accepted, true);
    queue.push('two');
    queue.push('three');
    assert.deepEqual(queue.push('four'), { accepted: false, item: 'four' });
    assert.equal(queue.shift(), 'one');
});
