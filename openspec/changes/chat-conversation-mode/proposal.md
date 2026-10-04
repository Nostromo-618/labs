# Proposal

## Why

Manual dictation and read-aloud work well together but require clicks for every turn. Provide an explicit foreground conversation loop using the existing private browser engines.

## What Changes

- One General-chat Conversation Mode action loads Gemma E2B, Whisper, Kokoro Heart and Silero VAD with progress.
- Submit after 1.2 seconds of silence, produce a brief guarded answer, speak it and listen again.
- Preserve chat history and typed drafts; provide Pause/Resume, End and editable exceptional voice turns.
- Stop capture before processing/playback and invalidate stale work on lifecycle changes.

## Capabilities

### New Capabilities

- `vwl-chat-conversation`: Explicit private foreground automatic voice turns.

### Modified Capabilities

None. Manual speech remains manual; the public AiChat text API and vd3 design-system APIs are unchanged.

## Impact

Labs host controllers, capture/playback adapters, worker inference, UI, owned caches and tests. Directly pin the already installed ONNX Runtime Web version; add pinned Silero model/source notices. No persisted conversation migration or deployment.
