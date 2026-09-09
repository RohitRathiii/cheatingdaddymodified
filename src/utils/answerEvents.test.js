const test = require('node:test');
const assert = require('node:assert/strict');

const { applyAnswerEvent, createTurnId } = require('./answerEvents');

test('updates the answer identified by turn id even when another answer starts', () => {
    let state = { responses: [], turnIds: [] };
    state = applyAnswerEvent(state, { turnId: 'voice', event: 'start', text: 'V' });
    state = applyAnswerEvent(state, { turnId: 'screen', event: 'start', text: 'S' });
    state = applyAnswerEvent(state, { turnId: 'voice', event: 'update', text: 'Voice answer' });
    assert.deepEqual(state.responses, ['Voice answer', 'S']);
});

test('ignores duplicate or out-of-order streaming sequences', () => {
    let state = applyAnswerEvent({ responses: [], turnIds: [] }, { turnId: 'one', event: 'start', sequence: 2, text: 'new' });
    state = applyAnswerEvent(state, { turnId: 'one', event: 'update', sequence: 1, text: 'old' });
    assert.deepEqual(state.responses, ['new']);
});

test('creates unique turn ids without transcript content', () => {
    assert.notEqual(createTurnId('live'), createTurnId('live'));
    assert.match(createTurnId('screen'), /^screen-/);
});
