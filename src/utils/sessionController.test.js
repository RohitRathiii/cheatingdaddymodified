const test = require('node:test');
const assert = require('node:assert/strict');

const { SessionController } = require('./sessionController');

test('prevents duplicate starts and waits for provider and capture', async () => {
    const events = [];
    const controller = new SessionController({
        startProvider: async generation => events.push(`provider:${generation}`),
        startCapture: async generation => events.push(`capture:${generation}`),
        stopProvider: async () => events.push('stop-provider'),
        stopCapture: async () => events.push('stop-capture'),
    });

    const first = controller.start();
    const duplicate = await controller.start();
    const result = await first;

    assert.equal(duplicate.success, false);
    assert.equal(result.state, 'active');
    assert.deepEqual(events, ['provider:1', 'capture:1']);
});

test('cleans partial startup and makes stop idempotent', async () => {
    let providerStops = 0;
    let captureStops = 0;
    const controller = new SessionController({
        startProvider: async () => {},
        startCapture: async () => {
            throw new Error('microphone denied');
        },
        stopProvider: async () => providerStops++,
        stopCapture: async () => captureStops++,
    });

    const result = await controller.start();
    await Promise.all([controller.stop(), controller.stop()]);

    assert.equal(result.success, false);
    assert.equal(controller.state, 'idle');
    assert.equal(providerStops, 1);
    assert.equal(captureStops, 1);
});

test('invalidates old generations when stopping during startup', async () => {
    let release;
    const providerReady = new Promise(resolve => (release = resolve));
    const controller = new SessionController({
        startProvider: () => providerReady,
        startCapture: async () => {
            throw new Error('capture must not start');
        },
        stopProvider: async () => {},
        stopCapture: async () => {},
    });

    const start = controller.start();
    const stop = controller.stop();
    release();

    const [startResult, stopResult] = await Promise.all([start, stop]);
    assert.equal(startResult.success, false);
    assert.equal(stopResult.state, 'idle');
    assert.equal(controller.state, 'idle');
});

test('twenty start and stop cycles leave every tracked resource released', async () => {
    const resources = { providers: 0, tracks: 0, contexts: 0, timers: 0, requests: 0 };
    const controller = new SessionController({
        startProvider: async () => resources.providers++,
        startCapture: async () => {
            resources.tracks += 2;
            resources.contexts++;
            resources.timers++;
            resources.requests++;
        },
        stopProvider: async () => (resources.providers = 0),
        stopCapture: async () => {
            resources.tracks = 0;
            resources.contexts = 0;
            resources.timers = 0;
            resources.requests = 0;
        },
    });
    for (let index = 0; index < 20; index++) {
        assert.equal((await controller.start()).success, true);
        assert.equal((await controller.stop()).success, true);
    }
    assert.deepEqual(resources, { providers: 0, tracks: 0, contexts: 0, timers: 0, requests: 0 });
});

test('stops a provider that finishes after Stop was requested during initialization', async () => {
    let finishProvider;
    let providers = 0;
    const controller = new SessionController({
        startProvider: () => new Promise(resolve => (finishProvider = () => { providers++; resolve(); })),
        startCapture: async () => {},
        stopProvider: async () => { providers = 0; },
        stopCapture: async () => {},
    });
    const starting = controller.start();
    await controller.stop();
    finishProvider();
    await starting;
    assert.equal(providers, 0);
});
