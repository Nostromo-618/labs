# Tasks

## 1. Speech foundation

- [x] 1.1 Pin VAD/runtime/assets, implement serial inference, endpointing and streaming capture; verify real VAD and deterministic resampling/endpoint/cache tests and add provenance.
- [x] 1.2 Separate PCM stop from context disposal and implement the cancelable conversation controller; verify turn-loop, limits, failures and lifecycle tests and document adapter ownership.

## 2. Host integration

- [x] 2.1 Connect one-click startup, guarded brief generation, history/draft preservation and controls; verify actual Vue conversation/manual regression tests and document user behavior.

## 3. Integration validation

- [x] 3.1 Run real repeated Chrome turns, cached offline/CSP/network tests, microphone/echo cleanup and latency/memory observations; record results and limitations.
- [x] 3.2 Run focused tests, existing chat lifecycle checks, lint/format/build and OpenSpec validation; verify the review server serves the updated demo.
