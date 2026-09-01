## Purpose

Lets the user hide the overlay with a secondary-click (right-click, macOS two-finger click, or Control-click) and restore it with the same gesture in the overlay’s last screen area, without stealing right-clicks from other applications.

## ADDED Requirements

### Requirement: Hide on secondary-click
While the overlay is visible, a secondary-click that lands on the overlay MUST hide the overlay immediately. The overlay MUST NOT show a native context menu for that click. On macOS, secondary-click MUST include two-finger click and Control-click.

#### Scenario: Two-finger click on the visible overlay
- **WHEN** the overlay is visible
- **AND** the user performs a secondary-click on the overlay
- **THEN** the overlay is hidden
- **AND** no application context menu is shown for that click

#### Scenario: Left-click does not hide
- **WHEN** the overlay is visible
- **AND** the user primary-clicks a normal control
- **THEN** the overlay stays visible
- **AND** the control performs its usual action

### Requirement: Restore on secondary-click in last bounds
While the overlay is hidden by this gesture or by the existing visibility shortcut, a secondary-click whose screen position falls inside the overlay’s last visible bounds MUST show the overlay again without stealing focus from the frontmost app. A secondary-click outside those bounds MUST be ignored by this feature so other apps keep their normal right-click behavior.

#### Scenario: Restore with a second secondary-click in the same area
- **WHEN** the overlay is hidden
- **AND** the user secondary-clicks within the last overlay bounds
- **THEN** the overlay becomes visible again
- **AND** the previously frontmost app remains focused

#### Scenario: Right-click elsewhere is untouched
- **WHEN** the overlay is hidden
- **AND** the user secondary-clicks outside the last overlay bounds
- **THEN** the overlay stays hidden
- **AND** the target application receives the click as a normal right-click

### Requirement: Existing keyboard toggle still works
The existing global visibility shortcut MUST continue to hide and show the overlay. Keyboard hide and gesture hide MUST share the same hidden/visible state.

#### Scenario: Hide with click, show with shortcut
- **WHEN** the overlay was hidden by secondary-click
- **AND** the user triggers the visibility shortcut
- **THEN** the overlay becomes visible

#### Scenario: Hide with shortcut, show with click
- **WHEN** the overlay was hidden by the visibility shortcut
- **AND** the user secondary-clicks within the last overlay bounds
- **THEN** the overlay becomes visible

### Requirement: Permission failure does not trap the user
If restore-while-hidden requires an OS permission the user has not granted, the system MUST still hide on a secondary-click that hits the visible overlay, MUST still restore via the existing visibility shortcut, and MUST NOT leave the overlay unrestorable.

#### Scenario: Restore permission unavailable
- **WHEN** the overlay is hidden
- **AND** the system cannot observe secondary-clicks outside a visible window
- **THEN** the visibility shortcut still shows the overlay
- **AND** the user is not required to quit the app to get the overlay back
