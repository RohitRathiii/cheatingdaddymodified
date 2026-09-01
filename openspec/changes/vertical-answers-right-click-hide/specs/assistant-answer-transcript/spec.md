## Purpose

Shows every live-session answer in one vertically stacked, scrollable transcript so an interviewer-facing user can reread an earlier answer without losing it when a new one arrives.

## ADDED Requirements

### Requirement: Vertical stacked transcript
The assistant live view SHALL render all answers from the current session as a single top-to-bottom list in one vertically scrollable region. The view MUST NOT replace the list with a single-answer pager.

#### Scenario: Multiple answers are all visible by scrolling
- **WHEN** the session has produced three or more answers
- **THEN** each answer appears in chronological order in the same column
- **AND** the user can reach any earlier answer by scrolling vertically without using a previous/next pager

#### Scenario: First answer while listening
- **WHEN** a session is active and no answers have been produced yet
- **THEN** the transcript area SHALL show the existing listening/idle placeholder
- **AND** the first completed or streaming answer SHALL appear as the first item in the list

### Requirement: Distinct answer blocks
The system SHALL visually separate consecutive answers so a user can tell where one answer ends and the next begins. Each answer block MUST include a visible boundary (card, divider, or equivalent) and MUST remain independently identifiable while scrolling.

#### Scenario: Two consecutive answers
- **WHEN** two different answers are present in the transcript
- **THEN** a clear visual boundary exists between them
- **AND** the content of the first answer is not visually merged with the second

### Requirement: Pinned viewport on new answers
When a new answer is appended, the system MUST keep the current scroll position so the user continues to see the answer they were reading. The system MUST NOT auto-scroll to the newest answer. In-place streaming updates to the newest answer MUST NOT move the viewport if the user is not already following that answer.

#### Scenario: New answer arrives while reading an older one
- **WHEN** the user is viewing an earlier answer
- **AND** a new answer is appended
- **THEN** the visible content stays on the earlier answer
- **AND** the new answer is added below, reachable by scroll or Jump to latest

#### Scenario: Latest answer streams while user is scrolled up
- **WHEN** the user is scrolled away from the latest answer
- **AND** the latest answer receives a streaming update
- **THEN** the viewport MUST NOT jump toward the latest answer

### Requirement: Jump to latest
The system SHALL show a Jump to latest control whenever the newest answer is not fully in view. Activating the control MUST scroll to the newest answer. The control MUST hide or become inactive once the newest answer is in view.

#### Scenario: Control appears after leaving the latest answer
- **WHEN** the user scrolls so the newest answer is no longer in view
- **THEN** a Jump to latest control is visible

#### Scenario: Control takes the user to the newest answer
- **WHEN** the user activates Jump to latest
- **THEN** the newest answer is scrolled into view
- **AND** the control is no longer offered as an active jump

#### Scenario: Already on the latest answer
- **WHEN** the newest answer is already in view
- **THEN** the Jump to latest control is hidden or inactive

### Requirement: Keyboard navigation between stacked answers
Existing previous-response and next-response shortcuts MUST scroll the adjacent answer block into view instead of swapping the transcript for a single answer. The shortcuts MUST do nothing when there is no previous or next answer.

#### Scenario: Previous shortcut while mid-transcript
- **WHEN** the focused or in-view answer is not the first
- **AND** the user triggers the previous-response shortcut
- **THEN** the previous answer block is scrolled into view
- **AND** all answers remain in the list

#### Scenario: Next shortcut on the last answer
- **WHEN** the user is already on the newest answer
- **AND** the user triggers the next-response shortcut
- **THEN** the transcript does not change position
