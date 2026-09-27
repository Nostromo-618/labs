# Spec Delta

## ADDED Requirements
### Requirement: Bounded cancellable sessions
Chat SHALL support Stop, one active operation, bounded model context, independent general/docs sessions, and backward-compatible callbacks.
#### Scenario: Cancellation
- **WHEN** generation is stopped or the user leaves the demo
- **THEN** late output does not alter the transcript and a subsequent turn can proceed safely
#### Scenario: Context pressure
- **WHEN** recent complete turns exceed the model context budget
- **THEN** older context is omitted with a visible notice while the transcript remains intact
### Requirement: Cited documentation mode
Docs mode SHALL use bounded local retrieval, untrusted source boundaries, and source-validated citations.
#### Scenario: Missing evidence
- **WHEN** no relevant documentation is retrieved
- **THEN** the UI explains that it lacks sufficient evidence instead of inventing sources
### Requirement: Curated local models
The primary menu SHALL expose Fast, Quality, and Tiny choices with download and capability information; other entries SHALL be under Advanced.
#### Scenario: No automatic downloads
- **WHEN** the user opens chat
- **THEN** no inference weights download before explicit loading
