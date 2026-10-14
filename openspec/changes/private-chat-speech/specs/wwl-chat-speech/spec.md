# Spec Delta

## Purpose

Provide private manual English dictation and assistant read-aloud in Labs AI Chat using browser resources and optional on-device speech models.

## ADDED Requirements

### Requirement: Private editable dictation

The host SHALL record at most 60 seconds of mono audio, transcribe in a browser worker, append the transcript to the existing draft, and require manual sending. It MUST retain over-limit drafts and disable sending until edited.

#### Scenario: Draft preservation

- **GIVEN** an existing composer draft
- **WHEN** recording stops and transcription succeeds
- **THEN** the transcript is appended and no chat generation starts

#### Scenario: Microphone permission denied

- **GIVEN** the browser denies microphone access
- **WHEN** dictation is requested
- **THEN** the error is shown and the typed draft remains usable

### Requirement: Explicit private read-aloud

The host SHALL speak only completed user-visible assistant answers using local English system voices or optional Kokoro af_heart. It MUST omit fenced code, citation markers and raw URLs.

#### Scenario: Local voices only

- **GIVEN** both local and remote voices are installed
- **WHEN** system voice playback starts
- **THEN** only a localService true English voice is selected

#### Scenario: Optional neural voice

- **GIVEN** neural voice has not been loaded
- **WHEN** the user explicitly loads it after seeing download size
- **THEN** pinned assets load with progress and subsequent playback runs locally

#### Scenario: Neural playback preparation and interruption

- **GIVEN** neural inference is still preparing audio or its audio context cannot run
- **WHEN** the user requests read-aloud or the preset voice test
- **THEN** preparation is identified separately from started playback, blocked or interrupted audio yields a bounded actionable error, and Stop releases pending audio work

### Requirement: Speech lifecycle and privacy

The host MUST stop media tracks, playback and stale output on reset, model/mode changes, suspension and navigation. Executable assets MUST be bundled locally, caches independently owned, and recordings MUST remain in memory without upload. Text chat MUST remain available after speech failure.

#### Scenario: Late transcription

- **GIVEN** transcription is pending
- **WHEN** the conversation is reset
- **THEN** its late result cannot modify the draft

#### Scenario: Cache clearing

- **GIVEN** speech models have been cached
- **WHEN** Clear storage completes
- **THEN** speech caches are removed without deleting unrelated caches

#### Scenario: Warm offline inference

- **GIVEN** the page and required model assets have been loaded and cached
- **WHEN** networking is disabled
- **THEN** speech inference requires no remote processing
