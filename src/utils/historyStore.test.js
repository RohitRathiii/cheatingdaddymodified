const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { HistoryStore, buildRelevantContext } = require('./historyStore');

test('appends records, ignores duplicate ids, and pages without loading legacy history into the renderer', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-history-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = new HistoryStore({ root });

    await store.startSession({ sessionId: 'meeting-1', profile: 'interview' });
    await store.append('meeting-1', { id: 'turn-1', type: 'turn', timestamp: 1, transcription: 'Question', ai_response: 'Answer' });
    await store.append('meeting-1', { id: 'turn-1', type: 'turn', timestamp: 1, transcription: 'Question', ai_response: 'Answer' });
    await store.append('meeting-1', { id: 'turn-2', type: 'turn', timestamp: 2, transcription: 'Next', ai_response: 'Later' });
    await store.flush('meeting-1');

    const page = await store.readPage('meeting-1', { limit: 1, cursor: 0 });
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].id, 'turn-1');
    assert.equal(page.nextCursor, 1);
    assert.equal((await store.listSessions())[0].messageCount, 2);
});

test('recovers complete JSONL records after a truncated final write', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-history-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'meeting-2.jsonl'), '{"id":"ok","type":"turn"}\n{"id":"broken"');

    const store = new HistoryStore({ root });
    const page = await store.readPage('meeting-2');
    assert.deepEqual(page.records.map(record => record.id), ['ok']);
});

test('relevant context respects summary, recent, earlier, and total limits', () => {
    const records = Array.from({ length: 80 }, (_, index) => ({
        id: `turn-${index}`,
        transcription: index === 2 ? 'The launch codename is falcon' : `Question ${index}`,
        ai_response: `Answer ${index} ${'x'.repeat(500)}`,
    }));
    const context = buildRelevantContext({ query: 'What is the launch codename?', summary: 'Meeting summary', records });

    assert.ok(context.length <= 32000);
    assert.match(context, /Meeting summary/);
    assert.match(context, /falcon/);
    assert.match(context, /Question 79/);
});
