let turnSequence = 0;

/** @typedef {{turnId:string,event:'start'|'update'|'complete'|'interrupted',text:string,sequence:number}} AnswerEvent */

function createTurnId(kind = 'answer') {
    turnSequence++;
    return `${kind}-${Date.now().toString(36)}-${turnSequence.toString(36)}`;
}

function applyAnswerEvent(state, answerEvent) {
    const responses = [...(state.responses || [])];
    const turnIds = [...(state.turnIds || [])];
    const sequences = { ...(state.sequences || {}) };
    const sequence = answerEvent.sequence ?? (sequences[answerEvent.turnId] ?? -1) + 1;
    if (sequences[answerEvent.turnId] != null && sequence <= sequences[answerEvent.turnId]) return state;

    let index = turnIds.indexOf(answerEvent.turnId);
    if (index < 0) {
        index = turnIds.length;
        turnIds.push(answerEvent.turnId);
        responses.push('');
    }
    responses[index] = answerEvent.text || responses[index];
    sequences[answerEvent.turnId] = sequence;
    return { ...state, responses, turnIds, sequences };
}

function emitAnswer(send, turnId, event, text, sequence) {
    send('answer-event', { turnId, event, text: text || '', sequence });
}

module.exports = { createTurnId, applyAnswerEvent, emitAnswer };
