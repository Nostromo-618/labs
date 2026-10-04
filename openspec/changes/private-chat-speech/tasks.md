# Tasks

## 1. Speech adapters

- [x] 1.1 Add pinned assets, local worker inference, Kokoro provenance and cache ownership; verify real model inference and production build.
- [x] 1.2 Add bounded recording, playback, cancellation and SpeechSession; verify focused lifecycle and audio tests and document host behavior.

## 2. Chat controls

- [x] 2.1 Add dictation, local/neural voice settings and completed-answer playback; verify composer, Docs, error and lifecycle browser tests.
- [x] 2.2 Extend Clear storage and document privacy/download behavior; verify owned-cache and offline tests.

## 3. Integration verification

- [ ] 3.1 Run speech and existing chat lifecycle tests on Chromium, Firefox and WebKit, lint, format checks, production build and OpenSpec validation.
  - Chromium/WebKit: 44 checks pass after the playback follow-up. Lint, formatting, builds and OpenSpec pass. Firefox automation remains blocked by the host's Nightly plugin-container launch failure; native Firefox speech checks pass. See doc/vwl-chat-speech-validation.md.
- [x] 3.2 Validate actual Chrome, Safari and Firefox, warm offline inference, production CSP and timing/memory alongside the default model; record measured results and limitations.
- [x] 3.3 Investigate Chrome neural silence, distinguish synthesis from playback, add an explicit voice test and bounded audio-context recovery, and verify non-silent real output plus interruption/error handling.
