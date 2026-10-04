## Purpose

Give browser-local chat sufficient message space while preserving accessible model and private speech controls.

## ADDED Requirements

### Requirement: Conversation-first layout

The Labs chat SHALL fill available viewport space with independently scrolling messages and settings, a visible composer, and a collapsible 320px panel at workspace widths of at least 960px.

#### Scenario: Wide workspace

- **GIVEN** a wide workspace with messages
- **WHEN** Settings is expanded or collapsed
- **THEN** message height remains stable and collapse gives messages more width

### Requirement: Accessible narrow settings

Below 960px the system SHALL show full-width chat with a dismissible right settings drawer supporting focus containment and return.

#### Scenario: Keyboard dismissal

- **GIVEN** narrow chat with Settings closed
- **WHEN** the user opens Settings and presses Escape
- **THEN** the drawer closes and focus returns to Settings

### Requirement: Stable speech ownership

Changing panel visibility or workspace dimensions SHALL preserve chat history, draft, read-aloud preferences and the single existing speech session without starting or canceling inference.

#### Scenario: Active voice operation

- **GIVEN** a recording, download or playback is pending
- **WHEN** Settings is toggled and the workspace resized
- **THEN** the operation continues and its main-chat status remains visible

### Requirement: Controls placement

The main chat SHALL retain conversation controls/status, dictation near the composer, per-answer playback controls and separate paused voice review; the panel SHALL hold Model, Voice and Storage settings using the existing vd3 design surface.

#### Scenario: Review after failure

- **GIVEN** Conversation Mode pauses for transcript review
- **WHEN** Settings is closed
- **THEN** the review editor and error remain visible and the typed draft remains separate
