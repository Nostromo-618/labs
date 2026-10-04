## ADDED Requirements
### Requirement: Visible native selection
The code editor SHALL visibly highlight native drag selection under light/dark vd3 themes and preserve selected text for editing and copying.
#### Scenario: Drag code selection
- **GIVEN** the Labs code editor using vd3 1.7.5
- **WHEN** the user drags across several code lines
- **THEN** the native selection contains the expected code and its highlight color is non-transparent
### Requirement: Actionable microphone failure
Speech SHALL explain unavailable, denied or busy microphones without losing drafts or downloading conversation models after an initial microphone failure.
#### Scenario: Browser exposes no microphone
- **GIVEN** getUserMedia rejects with NotFoundError
- **WHEN** Conversation Mode starts
- **THEN** it pauses, releases audio resources, explains device availability and suggests a standalone browser for embedded-browser use
