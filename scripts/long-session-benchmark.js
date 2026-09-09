const { BoundedAudioQueue } = require('../src/utils/audioPipeline');
const { buildRelevantContext } = require('../src/utils/historyStore');
const { visibleAnswerRange } = require('../src/utils/visibleAnswerRange');

if (global.gc) global.gc();
const before = process.memoryUsage().heapUsed;
const queue = new BoundedAudioQueue({ sampleRate: 16000, maxDurationMs: 2000 });
const packet = Buffer.alloc(1280);
let maxQueuedMs = 0;
const started = performance.now();
for (let sequence = 0; sequence < 225000; sequence++) {
    queue.push({ generation: 1, source: 'mixed', sequence, capturedAt: sequence * 40 + 1, sampleRate: 16000, pcm: packet });
    if (sequence % 750 >= 250) queue.shift();
    maxQueuedMs = Math.max(maxQueuedMs, queue.durationMs);
}

const records = Array.from({ length: 5000 }, (_, index) => ({
    id: `turn-${index}`,
    type: 'turn',
    timestamp: index,
    transcription: `Question ${index} about project decision ${index % 50}`,
    ai_response: `Complete answer ${index} with constraints and supporting details.`,
}));
const context = buildRelevantContext({ query: 'project decision 12', summary: 'Bounded meeting summary', records });
const mounted = visibleAnswerRange(5000, 4999, 30);
if (global.gc) global.gc();
const after = process.memoryUsage().heapUsed;

console.log(
    JSON.stringify({
        simulatedMeetingMinutes: 150,
        audioPackets: 225000,
        maxQueuedMs,
        retainedAudioPackets: queue.length,
        contextCharacters: context.length,
        mountedAnswerCards: mounted.end - mounted.start,
        heapGrowthMb: Number(((after - before) / 1024 / 1024).toFixed(2)),
        runtimeMs: Number((performance.now() - started).toFixed(1)),
    })
);
