## 1. Transcript layout

- [ ] 1.1 Replace the single `#responseContainer` pane in `AssistantView` with a vertically scrolling list that renders every `responses[]` item as its own card (label, border/gap, markdown body)
- [ ] 1.2 Remove the “N of M” previous/next pager strip
- [ ] 1.3 Keep the listening/idle placeholder when the session has no answers yet
- [ ] 1.4 Update only the last card’s HTML during `updateCurrentResponse` streaming so earlier cards are not re-parsed

## 2. Scroll pinning and jump to latest

- [ ] 2.1 Save and restore the transcript `scrollTop` across response appends and stream updates so the viewport does not move
- [ ] 2.2 Stop auto-advancing `currentResponseIndex` to the newest answer when the user is not already on the latest card
- [ ] 2.3 Add a Jump to latest overlay control that appears when the last card is not in view (`IntersectionObserver`) and scrolls that card into view on click
- [ ] 2.4 Remap previous/next-response IPC handlers to scroll the adjacent card into view and update `currentResponseIndex` without leaving the stacked list

## 3. Secondary-click hide while visible

- [ ] 3.1 On the overlay document, handle `contextmenu` and `auxclick` (button 2), prevent the native menu, and call the existing visibility toggle IPC
- [ ] 3.2 Confirm Mac two-finger click and Control-click both hide, and that a normal left-click on controls does not

## 4. Secondary-click restore while hidden

- [ ] 4.1 Add a small main-process adapter that records window bounds on hide, starts a listen-only secondary-button monitor only while hidden, and calls `showInactive()` when the point is inside those bounds
- [ ] 4.2 On macOS, prompt for Accessibility only on the first secondary-click hide; if denied or the hook fails to load, keep hide working and restore via `Cmd+\` / `Ctrl+\`
- [ ] 4.3 Share one hide/show path so keyboard toggle and gesture toggle stay in sync; stop the monitor whenever the window is shown
- [ ] 4.4 Verify a right-click outside last bounds (e.g. in an editor) does not show the overlay

## 5. Copy and verify

- [ ] 5.1 Update Help and Customize keybind copy for previous/next-answer and mention secondary-click hide plus the keyboard fallback
- [ ] 5.2 Manually verify: stacked answers, pinned scroll when a new answer arrives, Jump to latest, keyboard jump between cards, two-finger hide/show in last bounds, editor right-click while hidden
