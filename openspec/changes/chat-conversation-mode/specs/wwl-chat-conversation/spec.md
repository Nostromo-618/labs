# Spec Delta

## ADDED Requirements

### Requirement: Explicit one-click activation
The Labs host SHALL offer Conversation Mode only in General chat, disclose approximately 2.15 GB model downloads plus runtime assets, check existing GPU requirements, and load missing Gemma E2B/Whisper/Kokoro/Silero resources through one action. It SHALL preserve General history and the independent typed draft.

#### Scenario: Activation and reuse
- **GIVEN** an existing General chat and optionally loaded models
- **WHEN** Conversation Mode is activated
- **THEN** history/draft remain intact, loaded engines are reused and missing resources load with cancelable progress

### Requirement: Automatic alternating private turns
The host SHALL detect valid speech locally, end a turn after approximately 1200 ms silence, transcribe and automatically submit that turn, then speak the final guarded answer using Kokoro before reopening capture after 400 ms. Replies SHALL default to 1–3 sentences and 192 output tokens.

#### Scenario: Repeated turns
- **GIVEN** ready conversation engines and microphone permission
- **WHEN** the user speaks and stops
- **THEN** exactly one message is submitted, microphone tracks end before processing/playback, and listening resumes after the answer

#### Scenario: Voice preparation feedback
- **GIVEN** a completed answer whose neural audio is being prepared
- **WHEN** Kokoro inference is pending
- **THEN** a visible spinner and preparation message appear beside the answer, and change to playback feedback when audio starts

#### Scenario: Noise and limits
- **GIVEN** silence, a short VAD misfire, empty transcription or a 60-second/2000-character limit
- **WHEN** the detector or transcription finishes
- **THEN** empty/misfire turns do not submit, and limited turns pause for editing without truncation or mixing with the typed draft

### Requirement: Cancelable foreground lifecycle
The host SHALL expose Pause/Resume and End, cancel stale work at every phase, release capture/playback on hiding/reset/navigation, and retain text on failure. Resume SHALL never resend the previous turn; End SHALL restore manual instructions and controls. Executable assets SHALL remain local and captured audio/transcripts SHALL not be uploaded.

#### Scenario: Cancel and late completion
- **GIVEN** loading, capture, transcription, generation or playback is pending
- **WHEN** the mode is paused, ended or the page leaves the foreground
- **THEN** microphone/audio resources are released and late completion cannot submit, speak or reopen capture

#### Scenario: Warm offline and storage clearing
- **GIVEN** all model/runtime resources are cached
- **WHEN** model networking is disabled or Clear storage is requested
- **THEN** offline inference requires no upload and clearing removes only the owned speech caches including VAD
