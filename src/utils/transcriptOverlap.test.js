const { test } = require('node:test');
const assert = require('node:assert/strict');
const { removeTranscriptOverlap } = require('./transcriptOverlap');

test('removes repeated words from overlapping speech segments', () => {
    assert.equal(removeTranscriptOverlap('we decided to ship Friday', 'to ship Friday after testing'), 'after testing');
    assert.equal(removeTranscriptOverlap('alpha beta', 'gamma delta'), 'gamma delta');
});
