const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LiveTurnWatchdog } = require('./liveTurnWatchdog');

function fakeTimers() {
    let clock = 0;
    let nextId = 1;
    const timers = new Map();
    return {
        setTimer: (fn, ms) => {
            const id = nextId++;
            timers.set(id, { fn, at: clock + ms });
            return id;
        },
        clearTimer: id => timers.delete(id),
        advance(ms) {
            clock += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= clock && timers.delete(id)) timer.fn();
            }
        },
    };
}

function setup() {
    const timers = fakeTimers();
    const calls = { stall: 0, noOutput: 0 };
    const watchdog = new LiveTurnWatchdog({
        ...timers,
        onStall: () => calls.stall++,
        onNoOutput: () => calls.noOutput++,
    });
    return { watchdog, calls, advance: timers.advance };
}

test('fires a stall 3s after the last output and re-arms on more output', () => {
    const { watchdog, calls, advance } = setup();
    watchdog.outputReceived();
    advance(2500);
    watchdog.outputReceived();
    advance(2500);
    assert.equal(calls.stall, 0);
    advance(500);
    assert.equal(calls.stall, 1);
    assert.equal(watchdog.armed, false);
});

test('fires no-output 15s after a typed turn without any answer', () => {
    const { watchdog, calls, advance } = setup();
    watchdog.turnStarted();
    advance(14999);
    assert.equal(calls.noOutput, 0);
    advance(1);
    assert.equal(calls.noOutput, 1);
});

test('first output cancels the no-output timer', () => {
    const { watchdog, calls, advance } = setup();
    watchdog.turnStarted();
    advance(1000);
    watchdog.outputReceived();
    advance(20000);
    assert.equal(calls.noOutput, 0);
    assert.equal(calls.stall, 1);
});

test('turnEnded cancels both timers', () => {
    const { watchdog, calls, advance } = setup();
    watchdog.turnStarted();
    watchdog.outputReceived();
    watchdog.turnEnded();
    advance(60000);
    assert.deepEqual(calls, { stall: 0, noOutput: 0 });
});
