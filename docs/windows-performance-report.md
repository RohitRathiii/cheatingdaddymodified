# Windows performance and long-meeting readiness

## Delivered changes

| Finding | Change | Verification |
|---|---|---|
| Windows overlay could be blank or off-screen | Opaque Windows window, renderer-ready handshake, usable-area bounds clamping, display-change recovery, renderer crash handling, and tray Show/Stop/Quit actions | Unit coverage plus macOS Electron renderer smoke; Windows smoke is ready for a Windows host |
| Start/Stop work was split across flags | One asynchronous session controller owns provider and capture startup, cancellation, repeated Stop, and partial-failure cleanup | 20-cycle lifecycle test and Stop-during-start regression test |
| Audio arrived in roughly 171 ms ScriptProcessor bursts | AudioWorklet produces 40 ms PCM frames on one browser audio clock; microphone and loopback use separate sources and aligned mixing | Audio chunk, duration, clipping, source, and IPC-boundary tests |
| Reconnects could be duplicated by retired sockets | Session and connection generations reject old callbacks; Live uses bounded 1/2/4/8-second retries for up to 60 seconds | Old-generation and retry-delay tests |
| Audio could build up during outages | Worklet/IPC/transport limits hold two seconds; old audio is dropped and persistent socket congestion reconnects | 150-minute synthetic run held the maximum queue at 2,000 ms |
| Streaming output could update the wrong card | Every response carries a stable turn ID and sequence; completion/interruption are separate events | Interleaved and duplicate-event tests |
| Long speech segments were unbounded | Local and Groq transcription split at 20 seconds with 500 ms overlap, one active job, and at most two waiting jobs | Overlap de-duplication test |
| Every turn resent and rewrote full history | Main-owned append-only JSONL storage writes stable records, tolerates a truncated final line, and keeps legacy JSON readable | Append, duplicate, page, recovery, delete, and legacy tests |
| Context grew with the full meeting | Background summaries run after 12 turns and at most every five minutes; request context is capped at 32,000 characters; Live can call `search_meeting` | Context-bound and history tests |
| Live/history UI retained all rendered content | Live cache holds 100 answer bodies and mounts 30 cards; history loads 50 records per page; Markdown is cached and updates coalesce at 40 ms | 5,000-answer range test |
| Search preference came from two stores | One preference store now defaults search off; changes reconnect the Live session in a controlled way | Source review and renderer smoke |
| Live screen fallback used unsupported activity/client-content messages | Realtime image and text messages are used; HTTP remains the normal screen path | Screen-send regression tests |
| Runtime and native package were old | Electron 44.3.0 and Forge 7.11.2 are pinned; Windows x64 Sharp, ONNX, and keyboard-hook binaries are present in the package | Lockfile check and packaged-binary inspection |

## Performance evidence

The baseline audit measured approximately 170.7 ms between ScriptProcessor releases and 65.5 MB of cumulative full-history IPC for a 240-turn synthetic meeting. The new capture path emits 40 ms packets and no longer sends full session history through the renderer.

The repeatable `npm run benchmark:long-session` harness simulates 150 minutes (225,000 audio packets), 5,000 answers, and a large meeting context. The latest local result was:

| Metric | Result |
|---|---:|
| Maximum unsent audio | 2,000 ms |
| Retained packets at end | 49 |
| Context size | 10,389 characters |
| Mounted answer cards | 30 |
| Harness heap growth after GC | 1.52 MB |
| Harness runtime | 116.2 ms |

This harness verifies application bounds rather than Gemini/network response time. Median and p95 end-of-question latency, aggregate private working set, sleep/resume, device removal, display scaling, and final steady-state growth require the packaged application to run on Windows.

## Release artifacts and remaining Windows gate

The Windows x64 application package is generated at `out/Cheating Daddy-win32-x64`, and the portable ZIP is generated under `out/make/zip/win32/x64`. Electron Forge could not produce the Squirrel setup executable on this Mac because all available Homebrew Wine casks were disabled by Gatekeeper on 2026-09-01. The same make command can produce Setup.exe on a Windows machine without Wine.

Windows visibility and two-hour readiness remain unverified until the packaged app passes the planned 150-minute Windows 11 test. Record real median/p95 first-text and completion timing plus private working set from the content-free diagnostics in the app log directory.
