# Windows responsiveness and two-hour meeting audit

Date: 2026-09-09. Reviewed commit: `133406a`.

This is an investigation and proposed design, not an implemented optimization or Windows certification. No application code changed. The review machine runs macOS, Node 26.7.0, Electron 30.5.1, and @google/genai 2.19.0. Windows hardware and the user's usual provider are unconfirmed. Gemini BYOK is the primary path discussed; cloud and local differences are identified below.

## Recommendation

Keep the existing Electron/Lit interface and Gemini Live path initially. Fix resource ownership, reconnect handling, growing history work, and audio delivery before comparing providers. These affect reliability and latency independently of model speed. A React rewrite or larger JavaScript heap would not resolve them.

Separate three concerns: the full meeting archive on disk, a bounded working context for the model, and a bounded set of visible answers. Keeping full history available must not require keeping every rendered answer or resending every historical turn.

## Evidence and priorities

### P0: Verify Windows startup and recovery

The three recent fixes correct the renderer helper import, make Windows opaque with an opaque document background, and use an explicit `show()` restore path. Their intent is consistent with the reported symptoms. The existing tests check helper behavior and import source text; they do not start Electron or verify that pixels and controls appear.

Relevant code: `src/utils/window.js:98`, `src/utils/renderer.js:25`, `src/utils/overlayVisibility.test.js:100`.

Remaining gaps:

- No `did-fail-load`, renderer-process failure, or unresponsive-window recovery instrumentation was found in the window setup. A dark native window does not prove that the UI booted.
- The fixed 1100 × 800 window is not clamped to the display work area. Small screens or Windows scaling can place controls outside the usable area.
- With `skipTaskbar` enabled, a startup or keyboard-hook failure needs an accessible recovery route, such as a tray Show action.
- The display capture handler has no rejection/empty-source handling. Capture failure must produce an actionable status and leave text/screenshot controls usable.

First validate the packaged Windows executable: rendered root, clickable controls, Alt and fallback shortcut, hide/restore, monitor removal, 125–200% scaling, and capture-denied behavior. Add a startup-ready handshake and bounded local diagnostic logs. Preserve the opaque default. Evaluate GPU workarounds only against a reproduced driver failure.

### P0: Microphone cleanup is incomplete

`setupLinuxMicProcessing` is also used on Windows. It stores only the processor globally. Its microphone stream and AudioContext remain local, so `stopCapture` cannot stop those tracks or close that context.

Relevant code: `src/utils/renderer.js:373`, `src/utils/renderer.js:649`.

An isolated execution of the actual setup/stop function bodies with fake Web Audio objects performed ten start/stop cycles. Result: zero microphone contexts explicitly closed and zero microphone tracks explicitly stopped. This proves missing cleanup calls, not a measured Windows heap leak size.

Create one capture-session owner for streams, contexts, sources, processors, listeners, and pending sends. Make stop idempotent; stop every track, clear callbacks, disconnect nodes, await context closure, and clear references. Clean up partial initialization failures as well. Prevent concurrent starts. Also honor `mic_only`: the current Windows branch starts loopback regardless of the selected mode.

### P0: Old Live connections can start new reconnects

`GoAway` starts a replacement connection. The old session is not explicitly retired, and its callbacks have no connection identity check. After replacement completes, its later `onclose` can launch another reconnect. Delayed reconnect work can also outlive a user Stop unless cancellation is checked after awaited operations.

Relevant code: `src/utils/gemini.js:960`, `src/utils/gemini.js:1045`, `src/utils/gemini.js:1720`.

A mocked-provider execution of the actual module reproduced: one original connection; two after GoAway handoff; three after the original connection's late close. The original session received zero explicit close calls.

Use a connection generation ID and explicit connecting/active/reconnecting/stopping states. Ignore callbacks from retired generations, cancel retries on stop/provider changes, close retired sessions deliberately, and prevent replayed output from being saved twice. Preserve the existing resumption handle and context compression.

This matters during normal operation: Google documents periodic connection expiry around ten minutes. Compression and resumption solve different lifetime limits. A two-hour session must survive multiple handoffs. [Google session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).

### P1: Windows audio is delivered in bursts

`BUFFER_SIZE = 4096` at 24 kHz means an audio callback covers approximately 170.7 ms. Splitting that callback into 40 ms packets does not recover the waiting time. A mocked first callback emitted four IPC packets together. Callback scheduling under UI load may add further delay.

Relevant code: `src/utils/renderer.js:10`, `src/utils/renderer.js:441`.

Move capture processing to AudioWorklet with a typed-array ring buffer. Deliver paced 20–40 ms audio frames, avoiding JavaScript number-array spreading/splicing and base64 conversion in the renderer. Use binary IPC where supported; encode at the provider boundary if required. AudioWorklet moves audio processing away from the UI thread. [MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet).

The two input channels currently feed the same resampler, VAD, and provider stream. In `both` mode, alternating mic/system packets concatenate simultaneous audio as successive time, rather than producing one time-aligned signal. Preserve independent capture state, then mix aligned samples for a single-input provider; apply echo handling to avoid double speech. Test one source failing while the other continues.

### P1: History work grows throughout the meeting

Each answer sends `fullHistory` from main to renderer; the renderer sends it back to main; storage synchronously reads/parses and rewrites the session JSON. History listing also reads every session file to build metadata.

Relevant code: `src/utils/gemini.js:223`, `src/utils/renderer.js:715`, `src/storage.js:83`, `src/storage.js:387`.

A synthetic 240-turn meeting, with 200 question characters and 2,000 answer characters per turn, produced:

| Measurement | Result |
| --- | ---: |
| Final JSON history | 543,361 bytes |
| Cumulative full-history JSON payload, one IPC direction | 65,475,120 bytes |
| Cumulative payload / final history | 120.5× |

These are calculated JSON payload sizes from the actual save function, not measured IPC encoding sizes, heap usage, network traffic, or disk throughput. The reverse IPC trip and synchronous file operations add further work. Total repeated copying grows quadratically with turn count.

Persist new turns directly from main through a serialized asynchronous writer. A per-session append-only JSONL journal is a small initial change; handle partial final records and migrate/read existing JSON archives. Maintain a lightweight session index, periodic snapshots, and a durable flush on normal stop. Bound the write queue and expose persistence failures. SQLite is a later option if search/transactions justify the additional packaging work.

Typed questions and screenshot requests also prepend the entire conversation through `composeUserTurn`. Live already maintains context, so avoid replaying its own history on every question. For stateless requests, use a bounded recent window plus a compact summary and relevant older excerpts. Store the original user prompt separately from the expanded request context. Keep the full archive retrievable to avoid silently losing earlier meeting facts.

### P1: Every answer stays rendered

The app retains an unbounded `responses` array, one DOM card per answer, and the raw answer again in `data-content`. Streaming reparses the entire latest Markdown body and wraps prose words in spans. Updates also copy the responses array and scan answer cards.

Relevant code: `src/components/app/CheatingDaddyApp.js:582`, `src/components/views/AssistantView.js:370`, `src/components/views/AssistantView.js:745`, `src/components/views/AssistantView.js:794`.

Virtualize the transcript: render only visible answers plus a small margin, loading older answers from storage while scrolling. Use stable turn IDs instead of indices as identity. Render the first text immediately, then coalesce subsequent updates around 30–50 ms; flush final content immediately. Cache completed Markdown and remove per-word spans unless required by an active effect. Avoid whole-array work per text fragment.

The shared `new-response`/`update-response` protocol always updates the last card. Concurrent voice and screenshot responses can overwrite the wrong answer. Give every streamed event a turn ID and define whether a new request cancels, queues behind, or runs alongside an existing one.

### P1: Queues and speech segments need explicit limits

- Gemini's application queue has no byte/time limit, but its send call does not await network delivery. The more important slow-network risk may be buffering inside the transport. Measure both instead of assuming the JavaScript queue alone is the leak.
- Cloud `sendCloudAudio` does not inspect WebSocket `bufferedAmount` or bound pending writes.
- Local `speechBuffers` and Groq fallback `whisperAudioBuffer` have no maximum utterance duration. Continuous speech/noise above the threshold can keep accumulating audio.
- Local speech completion starts asynchronous transcription without a single-job/concurrency policy. Slow inference can overlap work and compete for memory.

Relevant code: `src/utils/gemini.js:756`, `src/utils/gemini.js:853`, `src/utils/gemini.js:1264`, `src/utils/cloud.js:151`, `src/utils/localai.js:76`.

As a starting design, cap live audio buffering at 1–2 seconds and speech segments at 15–30 seconds with a small overlap. Never replay minutes of stale audio after reconnect. An overflow should explicitly mark a gap and recover according to provider capabilities. Give local transcription one active worker and a bounded queue; run inference outside the Electron main/UI processes. Cancel stale work when stopping or switching sessions.

For scale only: two hours of retained mono 16 kHz PCM16 is 230.4 MB before buffers, Float32 conversion, and model memory. This is a worst-case arithmetic illustration, not an observed allocation or a claim that normal Live sessions retain two hours of audio.

### P2: Tune response timing after correctness

The current Live configuration uses minimal thinking, a 700 ms client silence detector, and a 2,000 ms server silence fallback. Do not add the two delays together: the client end signal can end the turn earlier. Measure actual end-of-question to first visible text.

Start by comparing server silence settings in the 500–800 ms range while retaining enough pre-speech padding. Test natural pauses, quiet speakers, background sound, and simultaneous speech. Fast turn cutoff that misses the end of a question is a quality regression. Google documents these timing tradeoffs and hybrid client/server endpointing. [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities).

Keep web search optional for questions that need fresh information. Keep screenshots on demand, retaining the existing size cap and in-flight guard. Screen analysis already streams through HTTP when an API key exists; preserve that working path while benchmarking output length and time to useful text.

The Live screen fallback uses `sendClientContent` during a running 3.1 session. Current Google guidance restricts that method to initial history seeding; its alternate manual activity messages also require matching VAD configuration. Existing mock tests do not validate the remote protocol. Address this compatibility issue before relying on the fallback. [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities).

## Architecture choices

| Approach | Benefit | Cost / reason to choose |
| --- | --- | --- |
| Harden existing Live pipeline first — recommended | Least disruption; addresses measured app-side defects | Model/network latency still requires measurement |
| Streaming transcription plus streamed text generation | Worth testing when fast complete text is more important than voice output | Adds a service stage and synchronization; not inherently faster |
| Fully local transcription and generation | Offline operation and local data handling | Hardware-dependent latency and larger memory budget; benchmark separately |

No provider is declared fastest without the same Windows audio corpus, network conditions, prompt, and answer-quality checks. No universal sub-second answer or crash-free guarantee follows from this review.

## Implementation order

1. Add Windows startup diagnostics and a repeatable packaged-app smoke test. Record baseline timing and process memory.
2. Fix capture ownership, audio-mode selection, reconnect generation handling, and stop cancellation. Add behavioral regression tests for the reproduced failures.
3. Add per-turn streaming identity, bounded queues, and speech segmentation; move local inference out of main when local mode is enabled.
4. Replace repeated full-history writes with incremental asynchronous persistence. Add bounded model context and transcript virtualization.
5. Introduce AudioWorklet and aligned input handling. Tune silence detection and UI update cadence using measurements.
6. Upgrade Electron from the installed 30.5.1 to a supported version in a separate change. Rebuild native modules on Windows and rerun capture/overlay tests. Electron recommends staying current and avoiding blocking main-process work. [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance).
7. Compare model pipelines only after the Windows baseline is stable.

## Validation needed before calling it two-hour ready

Run a real 150-minute Windows soak test with recorded meeting audio, periodic questions, long code answers, and screenshots. The extra 30 minutes provides a margin. Synthetic fast-forward tests supplement this but cannot validate real sockets, audio devices, GPU painting, or driver memory.

Record every 10–15 seconds: main/renderer/GPU process memory, JS heap where available, CPU, live audio bytes queued, outstanding jobs, active tracks/contexts, socket count, rendered node/card counts, and persistence queue length. Avoid transcript/audio payloads in performance logs.

Measure median and 95th-percentile time from speech ending to first useful visible text and to completed answer. Compare the first and last 15 minutes using similar requests. Record capture delay, endpointing delay, first provider response, and UI paint separately.

Proposed acceptance gates, to calibrate against the user's PC:

- No crash, blank UI, stuck answer, unintended listening after Stop, or unrecoverable connection loss.
- Active audio resources return to baseline after 20 start/stop cycles.
- One intended active provider connection after handoff; old callbacks cannot reconnect or alter the new answer.
- Enforced queue and DOM limits; no sustained memory rise after warm-up on a fixed-size workload. Examine process memory, not only JavaScript heap. Model caches may stay allocated intentionally.
- Last-quarter latency does not materially degrade against matched first-quarter requests; initially investigate regressions above 20%.
- Test hidden and covered windows, lock/unlock, sleep/resume, microphone removal, Bluetooth changes, and 10/30/60-second network interruptions.
- Test the actual installer on Windows with integrated graphics and the user's RAM class, including multiple displays and display scaling.

The repository's 20 existing Node helper tests passed during this audit. `package.json` currently has neither `test` nor `typecheck` scripts; the tests were run directly with `node --test src/utils/*.test.js`. No Windows executable was launched, no real model session was called, and no two-hour soak test was performed.
