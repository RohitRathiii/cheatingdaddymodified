const test = require('node:test');
const assert = require('node:assert/strict');

const { ConnectionGeneration } = require('./connectionGeneration');

test('callbacks from retired connections cannot change current state', () => {
    const generations = new ConnectionGeneration();
    const first = generations.begin();
    const second = generations.begin();

    assert.equal(generations.isCurrent(first), false);
    assert.equal(generations.isCurrent(second), true);
    generations.stop();
    assert.equal(generations.isCurrent(second), false);
});

test('retry delays use bounded exponential backoff', () => {
    const generations = new ConnectionGeneration({ random: () => 0.5 });
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(attempt => generations.retryDelay(attempt)), [1000, 2000, 4000, 8000, 8000, 8000]);
});
