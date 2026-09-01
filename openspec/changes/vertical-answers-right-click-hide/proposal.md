## Why

During a live interview the assistant currently shows one answer at a time behind prev/next paging. Jumping back to an earlier answer is slow, and a newly streamed answer can steal focus from the one being spoken. The overlay also needs a faster, one-handed hide/show than the existing keyboard shortcut so it can disappear the moment someone looks at the screen.

## What Changes

- Replace the single-answer pager with a **vertical transcript**: every answer in the session is listed top-to-bottom in one scrollable column.
- New answers **append** to the list but **do not move the viewport**. If the user is reading an older answer, they stay there.
- Add a **Jump to latest** control that appears when the latest answer is not in view and scrolls to it on demand.
- Make consecutive answers **visually distinct** (separated cards / dividers) so it is obvious where one answer ends and the next begins.
- Add a **secondary-click stealth toggle** (right-click; on Mac, two-finger click or Control-click) that hides the overlay and, when used again in the overlay’s last screen bounds, shows it again.
- Remap the existing previous/next-response shortcuts so they jump between stacked answers instead of swapping a single pane.
- **Not breaking** for session start, capture, or AI providers. The old “1 of N” pager UI goes away.

## Capabilities

### New Capabilities

- `assistant-answer-transcript`: Live session answers render as a vertically stacked, scrollable transcript with pinned viewport, jump-to-latest, and clear per-answer separation.
- `overlay-secondary-click-toggle`: Secondary-click (including macOS two-finger / Control-click) hides and restores the overlay without intercepting right-clicks in other apps.

### Modified Capabilities

- None. There are no existing `openspec/specs/` capabilities.

## Impact

- **UI**: `src/components/views/AssistantView.js` (layout, scroll pinning, jump button, card chrome). Pager strip is removed.
- **State**: `src/components/app/CheatingDaddyApp.js` (`responses` stay; `currentResponseIndex` becomes “focused answer” for shortcuts, not the only visible item).
- **Window**: `src/utils/window.js` and related IPC for hide/show and secondary-click handling. Existing `Cmd+\` / `Ctrl+\` toggle remains.
- **Docs/help**: `HelpView.js` and `CustomizeView.js` keybind copy if previous/next-response behavior is described.
- **Dependencies**: Prefer Electron + renderer events. A bounded global pointer listener is in scope only if hide-then-restore cannot be done without it; full-desktop right-click interception is out of scope.
- **Permissions**: If a macOS event tap is required for restore-while-hidden, Accessibility permission must be requested and fail gracefully.
