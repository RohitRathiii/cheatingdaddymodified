## Context

See `proposal.md` for motivation. Requirements are in `specs/assistant-answer-transcript/spec.md` and `specs/overlay-secondary-click-toggle/spec.md`.

Today the live assistant is a Lit view (`AssistantView`) that writes **one** markdown answer into a single `.response-container`. `CheatingDaddyApp` already keeps the full `responses[]` array and a `currentResponseIndex`; the UI pages with “N of M” plus `Cmd+[` / `Cmd+]`. New items are appended (`addNewResponse`); streaming edits the last item (`updateCurrentResponse`). The overlay is an always-on-top frameless Electron window. Hide/show already exists as `Cmd+\` / `Ctrl+\` via `mainWindow.hide()` / `showInactive()`. Click-through (`Cmd+M`) is a separate mode.

Constraints: stay on Lit in this view (do not introduce React/shadcn here). No test suite yet — verification is manual. Electron 30 cannot receive clicks after `hide()` or `setIgnoreMouseEvents(true)`, and it cannot ignore only left-clicks.

## Goals / Non-Goals

**Goals:**

- Render the existing `responses[]` as a stacked, scroll-pinned transcript with a Jump to latest control.
- Treat previous/next-response shortcuts as “scroll to adjacent card,” not “replace the pane.”
- Hide on secondary-click that hits the visible overlay (Mac two-finger click and Control-click included).
- Restore on secondary-click only inside the last overlay rectangle, with `Cmd+\` always able to restore.

**Non-Goals:**

- Global right-click anywhere on the desktop (would steal IDE/browser context menus during interviews).
- A full-size invisible hit window that blocks left-clicks in the last bounds (dead zone over the editor).
- Changing capture, providers, history (past sessions), or click-through (`Cmd+M`).
- Rebuilding this screen in React/shadcn.
- Persisting scroll position across sessions.

## Decisions

### 1. Stack every answer as a card; drop the pager strip

Keep `responses[]` as the source of truth. `AssistantView` maps each entry to a card (border, radius, padding, muted “Answer N” label, vertical gap). Streaming still updates only the last card’s HTML. Remove the “N of M” prev/next strip.

`currentResponseIndex` stays as the **focused** card for shortcuts, not as “the only visible answer.” `addNewResponse` no longer advances the index when the user is not already on the latest card.

**Alternative considered:** Keep paging and add a side list. Rejected — the user needs the previous answer on-screen in one vertical scroll.

### 2. Pin scroll by restoring `scrollTop`; never auto-follow new answers

Before a Lit update that changes `responses`, save the transcript `scrollTop`. After render, write it back. Do **not** call `scrollToBottom()` on append or stream. Jump to latest is the only automatic scroll, and only on explicit click.

Detect “latest in view” with an `IntersectionObserver` on the last card (threshold ~0.9) to show/hide the jump control. Place the control as a compact overlay on the transcript (bottom-right of the scroll area) so it does not steal vertical space from the answer being read.

Keyboard: existing `navigate-previous-response` / `navigate-next-response` IPC handlers call `scrollIntoView` on the adjacent card and update `currentResponseIndex`. Existing scroll-up/down shortcuts keep pixel-scrolling the same container.

**Alternative considered:** Chat-style “stick to bottom if already at bottom.” Rejected — a new answer arriving while the user is reading the current latest would still yank them. The spec requires the viewport to stay put.

### 3. Visible hide is renderer-owned; restore-while-hidden is a bounds-filtered hook

**While visible:** listen for `contextmenu` and `auxclick` (`button === 2`) on the overlay document, `preventDefault()`, IPC into the existing `toggle-window-visibility` path (`hide()` / `showInactive()`). That covers Mac two-finger click and Control-click without a native module.

**While hidden:** `hide()` leaves no window to click. A same-size transparent ghost window would eat left-clicks over the IDE. A desktop-wide right-click toggle would fire on every editor context menu.

So: on hide, record `getBounds()`. Start a **listen-only** global secondary-button monitor. If the event point is inside those bounds, `showInactive()` (do not steal focus). If not, ignore. Stop the monitor on show. Keyboard toggle uses the same hide/show functions so state stays shared.

On macOS the monitor needs Accessibility. Prompt with `systemPreferences.isTrustedAccessibilityClient(true)`. If denied, hide-from-visible-overlay still works; restore is `Cmd+\` only (see spec: permission failure must not trap the user).

Prefer `uiohook-napi` (or equivalent) started **only while hidden**, so a visible overlay never intercepts other apps. Handle right-button and Control+left (hidden Control-click). Do not consume out-of-bounds events.

**Alternatives considered:**

| Approach | Why not |
| --- | --- |
| Right-click anywhere always toggles | Breaks interview context menus |
| Opacity-0 window, mouse events on | Invisible dead zone over the editor |
| Thin top-edge “sensor” strip | Misses most of last bounds; fails the spec |
| Overlay hide + `Cmd+\` only | Does not “right-click again to respawn” |

### 4. Stay in Lit; keep the 850×400 assistant window

The transcript scrolls inside the current live window. A taller window can be a later tweak if cards feel cramped; it is not required to meet the spec.

Text selection stays enabled. Secondary-click will hide instead of offering “Copy”; users copy with `Cmd+C`. Document this in help if the hide gesture is mentioned.

## Risks / Trade-offs

- **[Native hook build / notarization]** → Keep the hook behind a small adapter; app must start without it. If the module fails to load, degrade to shortcut restore.
- **[Accessibility prompt on Mac]** → Prompt only when the user first hides via secondary-click, not at launch. Never block hide if they decline.
- **[Context menu flicker under restore]** → Listen-only hook may let the app below see the same right-click. Acceptable; overlay appears inactive-focused on top. Revisit swallowing the event only if this is noisy.
- **[Click-through mode]** → Secondary-click will not hit the overlay (`setIgnoreMouseEvents`). Out of scope; `Cmd+\` still works.
- **[Streaming HTML into many cards]** → Continue the current “set innerHTML on the active card” pattern; do not re-parse every card on each token if that janks. Only the last card updates during a stream.
- **[No automated tests]** → Manual interview-style pass: three answers, scroll up, wait for a fourth, Jump to latest, two-finger hide/show, right-click in the editor while hidden.

## Migration Plan

- Ship as a normal app update. No data migration. Session state is in-memory.
- Help / Customize copy: previous/next become “jump to previous/next answer in the list”; add a line for secondary-click hide/restore and the `Cmd+\` fallback.
- Rollback: revert the change branch; behavior returns to single-answer paging and keyboard-only hide.

## Open Questions

- Exact card chrome (label wording, border vs divider) can be tuned during apply as long as consecutive answers stay visually distinct.
- Whether to swallow the in-bounds restore click (no underlying context menu) can be decided after the first manual pass; it does not change the spec.
