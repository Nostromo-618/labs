# Design

## Context

See proposal.md for motivation. Labs owns Vue and injected browser runtimes; AiChat remains a text engine. Static hosting and CSP require same-origin JavaScript/WASM and single-threaded CPU speech inference.

## Goals / Non-Goals

Provide explicit English dictation and read-aloud without uploading recordings or text. Preserve typed drafts and final Docs citation processing. No autonomous sending, background listening, or streaming LLM audio.

## Decisions

- Host-owned SpeechSession with injected runtime/recorder/playback factories for lifecycle tests; operation epochs reject stale output. Dedicated ASR and TTS workers run serially and terminate on cancellation.
- Web Audio AudioWorklet captures mono PCM; OfflineAudioContext resamples to 16 kHz. Stop microphone tracks before resampling/transcription. Bound frames and duration to 60 seconds.
- Whisper tiny.en q8 and Kokoro q8 reuse Transformers.js 4.2.0. Pin Hugging Face revisions 2575352d61be1bf7225cf8f8b268a4678025fc58 and 1939ad2a8e416c0acfeecc08a694d14ef25f2231 respectively. Separate owned caches support warm offline use and explicit clearing.
- Also pin each worker's remote path template: 4.2.0 metadata discovery otherwise probes main despite the revision option, breaking a fresh-worker offline reload. Disable Whisper graph optimization to avoid the installed ORT decoder QDQ/MatMulNBits rewrite failure observed during real inference.
- Kokoro wrapper is adapted from hexgrad/kokoro at dfb907a02bba8152ca444717ca5d78747ccb4bec, preserving Apache-2.0 notices. Pin phonemizer 1.2.1, fetch af_heart at the model revision, and bound phoneme token chunks to 510 rather than silently truncating or using upstream TextSplitterStream.
- System playback only selects localService === true English voices. Explicit neural loading is an alternative when no local voice is installed. Synthesize final displayed text, omitting code, citations and URLs.
- Reset, model/mode switching, storage clearing, suspension and unmount stop speech and recording. Sending also stops playback. Oversized transcripts remain editable with Send disabled.
- Neural playback prepares at most one chunk ahead while current audio plays. Speech Session owns the preload's cancellation; slow CPU synthesis can still introduce gaps. Pagehide and freeze also dispose speech resources.
- Neural read-aloud exposes preparation separately from started playback and offers an explicit preset test. Prime the Web Audio graph inside the click, resume again after inference if suspended, and bound resume/playback waits. Invalid/silent PCM and interrupted contexts produce an error rather than silently completing or remaining stuck. A muted browser tab/site cannot be detected through Web Audio; show the relevant Sound-setting hint.

## Risks / Trade-offs

- Native voices vary and may be unavailable → enumerate local voices and offer optional Kokoro.
- WASM CPU speed and memory vary → measure in real browsers with the default LLM loaded; preserve text on errors.
- Cancellation may not interrupt synchronous inference → terminate the worker and recreate lazily using cached assets.
- Cache storage may be denied → continue uncached and disclose that subsequent loads need a connection.

## Migration Plan

No data migration or public API change. Deliver through the existing Labs build. Rollback removes the controls and speech modules; speech caches are independently owned.
