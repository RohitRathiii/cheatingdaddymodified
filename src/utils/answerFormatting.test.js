const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatLiveAnswerText, needsCodeAnswer } = require('./answerFormatting');

test('splits Question / Answer / Why labels into separate paragraphs', () => {
    const text = '**Question**: Is there a src folder? **Answer**: Yes. **Why**: It is visible on the left.';
    assert.equal(formatLiveAnswerText(text), '**Question**: Is there a src folder?\n\n**Answer**: Yes.\n\n**Why**: It is visible on the left.');
});

test('handles colon-inside-bold labels and LLD section words', () => {
    assert.equal(formatLiveAnswerText('**Answer:** Yes. **Why:** Because.'), '**Answer:** Yes.\n\n**Why:** Because.');
    assert.equal(formatLiveAnswerText('**STATE** null · OOD **SPEAK** Ready when you are.'), '**STATE** null · OOD\n\n**SPEAK** Ready when you are.');
    assert.equal(formatLiveAnswerText('STATE: parking lot SPEAK: Let us start.'), 'STATE: parking lot\n\nSPEAK: Let us start.');
});

test('leaves inline emphasis, code fences and already formatted text alone', () => {
    assert.equal(formatLiveAnswerText('Use the **API** for **fast** reads.'), 'Use the **API** for **fast** reads.');
    const fenced = '**Answer**: see\n\n```js\nconst a = { "**Why**:": 1 };\n```';
    assert.equal(formatLiveAnswerText(fenced), fenced);
    const formatted = '**Question**: A?\n\n**Answer**: B.';
    assert.equal(formatLiveAnswerText(formatted), formatted);
});

test('detects questions that need a code answer', () => {
    assert.equal(needsCodeAnswer('Can you please give me the code for merge sort in Java?'), true);
    assert.equal(needsCodeAnswer('How would you implement an LRU cache?'), true);
    assert.equal(needsCodeAnswer('Write a function that reverses a linked list'), true);
    assert.equal(needsCodeAnswer('Solve two sum using Python'), true);
    assert.equal(needsCodeAnswer('Tell me about yourself'), false);
    assert.equal(needsCodeAnswer('How do we quantize a model to run on 8GB RAM?'), false);
    assert.equal(needsCodeAnswer(''), false);
});
