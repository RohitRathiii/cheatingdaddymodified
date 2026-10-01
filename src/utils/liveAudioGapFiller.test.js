const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LiveAudioGapFiller, createNoiseFrame } = require('./liveAudioGapFiller');

function setup(options = {}) {
    let clock = 1000;
    const fills = [];
    const filler = new LiveAudioGapFiller({ now: () => clock, onFill: pcm => fills.push(pcm), ...options });
    return { filler, fills, advance: ms => (clock += ms) };
}

test('noise frames stay within the amplitude and are never all zeros', () => {
    const frame = createNoiseFrame(640, 8);
    assert.equal(frame.length, 1280);
    const samples = Array.from({ length: 640 }, (_, index) => frame.readInt16LE(index * 2));
    assert.ok(samples.every(sample => Math.abs(sample) <= 8));
    assert.ok(samples.some(sample => sample !== 0));
});

test('does nothing before the first real frame or while frames keep arriving', () => {
    const { filler, fills, advance } = setup();
    advance(1000);
    assert.equal(filler.tick(), 0);
    for (let index = 0; index < 20; index++) {
        filler.noteRealFrame();
        advance(40);
        filler.tick();
    }
    assert.equal(fills.length, 0);
});

test('fills a gap with 40ms frames once real audio stops', () => {
    const { filler, fills, advance } = setup();
    filler.noteRealFrame();
    advance(300);
    assert.equal(filler.tick(), 7);
    assert.equal(fills[0].length, 1280);
    advance(40);
    assert.equal(filler.tick(), 1);
    assert.deepEqual(filler.stats(), { gapsFilled: 1, longestGapMs: 340 });
});

test('caps catch-up after a throttled timer and counts each gap once', () => {
    const { filler, advance } = setup();
    filler.noteRealFrame();
    advance(5000);
    assert.equal(filler.tick(), 10);
    filler.noteRealFrame();
    advance(300);
    filler.tick();
    assert.equal(filler.stats().gapsFilled, 2);
});

test('stop clears the gap state', () => {
    const { filler, advance } = setup();
    filler.noteRealFrame();
    filler.stop();
    advance(1000);
    assert.equal(filler.tick(), 0);
});
