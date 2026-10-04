# Proposal

## Why

Chat currently requires typing and reading. Add private English dictation and manual read-aloud using browser resources, with optional neural voice quality.

## What Changes

- Record up to 60 seconds, transcribe locally with Whisper Tiny English, and append an editable draft without sending it.
- Read completed, validated assistant answers using local system voices or an explicitly downloaded Kokoro voice.
- Bundle speech runtimes locally, pin assets, isolate caches, and cancel resources on chat lifecycle changes.

## Capabilities

### New Capabilities

- `vwl-chat-speech`: Private dictation, manual playback, model loading and lifecycle cleanup.

### Modified Capabilities

None; the existing text chat contract remains compatible.

## Impact

Labs Vue UI and host adapters only; no public AiChat or vd3 API changes. Add pinned phonemizer 1.2.1 and reuse Transformers.js 4.2.0. No migration.

## Non-goals

Hands-free conversation, voice cloning, mobile certification, cloud inference, and changes to the chat model's WebGPU requirements.
