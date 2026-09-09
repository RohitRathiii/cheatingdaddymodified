const test = require('node:test');
const assert = require('node:assert/strict');

const { BoundedAudioQueue, mixPcm16, PcmChunker, validateAudioFrame } = require('./audioPipeline');

test('audio queue never retains more than its duration budget', () => {
    const gaps = [];
    const queue = new BoundedAudioQueue({ sampleRate: 16000, maxDurationMs: 2000, onGap: gap => gaps.push(gap) });
    for (let sequence = 0; sequence < 75; sequence++) {
        queue.push({ sequence, capturedAt: sequence * 40, pcm: Buffer.alloc(1280) });
    }

    assert.equal(queue.durationMs, 2000);
    assert.equal(queue.length, 50);
    assert.equal(gaps.length, 25);
    assert.equal(queue.shift().sequence, 25);
});

test('chunker emits exact 40ms PCM frames without array spreading', () => {
    const chunker = new PcmChunker({ sampleRate: 24000, durationMs: 40 });
    const first = chunker.write(new Int16Array(4096));
    const second = chunker.write(new Int16Array(704));

    assert.equal(first.length, 4);
    assert.equal(second.length, 1);
    assert.ok([...first, ...second].every(chunk => chunk.length === 960));
    assert.equal(chunker.bufferedSamples, 0);
});

test('mixing aligned microphone and loopback samples saturates safely', () => {
    const mixed = mixPcm16(new Int16Array([20000, -20000, 1000]), new Int16Array([20000, -20000]));
    assert.deepEqual([...mixed], [32767, -32768, 1000]);
});

test('audio frame IPC validation rejects oversized and malformed payloads', () => {
    const valid = validateAudioFrame({
        generation: 3,
        source: 'mixed',
        sequence: 4,
        capturedAt: Date.now(),
        sampleRate: 16000,
        pcm: new ArrayBuffer(1280),
    });
    assert.equal(valid.sampleRate, 16000);
    assert.equal(valid.pcm.length, 1280);
    assert.throws(() => validateAudioFrame({ ...valid, pcm: Buffer.alloc(200000) }), /size/);
    assert.throws(() => validateAudioFrame({ ...valid, sampleRate: 44100 }), /sample rate/);
});
