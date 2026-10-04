# Design

## Context

Labs owns native media/worker adapters. AiChat already exposes history, cancellation and guarded system-prompt extras. Manual speech uses a lazy shared worker runtime; browser contexts must stay outside Vue proxies.

## Goals / Non-Goals

English General chat, explicit startup, brief replies and foreground alternating turns. No voice commands, spoken interruption, background operation or mobile certification.

## Decisions

- ConversationSession owns epochs, cancellation and state: stopped/loading/listening/transcribing/thinking/preparing-audio/speaking/paused. Share the manual SpeechSession runtime through an internal adapter; disable manual controls without their disabled watcher canceling conversation-owned work.
- Start unlocks a persistent PCM player and requests microphone permission before loading. Sequentially ensure Gemma E2B, Whisper, Kokoro and Silero; reuse live engines/caches. Keep typed draft independent, preserve General history across selection, and add guarded 1–3 sentence instructions with 192 output tokens. Restore normal instructions on End.
- Silero v5.1 source/model commit 84768cefdf5a3852400e9d8237f7315d14b64a08; use onnxruntime-web 1.26.0-dev.20260416-b7804b056c with the existing local WASM. A separate serial worker handles 512-sample frames, 64 context samples and recurrent [2,1,128] state. Cache in vwl-speech-vad-v1.
- A worklet downmixes and performs continuous anti-aliased 16 kHz resampling. Endpoint thresholds 0.5/0.35, minimum 250 ms speech, 300 ms pre-roll, 1200 ms silence. Buffer at most 60 seconds. Discard misfires and empty transcription; cap/over-limit/validation failures pause for editable review.
- Release tracks before transcription/thinking/playback. Reopen capture after playback plus 400 ms. Never collect assistant audio. Stop an individual PCM source separately from disposing its unlocked context.
- Pause cancels active work and closes capture/playback but retains idle engines; Resume starts a fresh listening turn without resending. End restores manual behavior. Hidden/freeze/pagehide pause; navigation/reset/model/mode switching invalidate operations and release media. Navigation disposes engines through existing host lifecycle.
- Model/audio errors pause, preserve available text and never silently fall back to server speech or another chat model. Clear storage includes VAD. Code/WASM remain local and production CSP stays unchanged.

## Risks / Trade-offs

CPU synthesis can delay speech; show preparation distinctly. Browser permission/autoplay failures need explicit Resume. VAD is probabilistic; test noise and endpoint boundaries. Model init can stall the existing main-thread GPU runtime, so cancellation must reject stale completion. Full process memory is not available through JS heap measurements.
