# Tasks

## 1. Chat
- [x] 1.1 Add typed cancellable bounded harness and schema/protocol guardrails; pass unit and coverage gates and document compatibility.
- [x] 1.2 Pin and bundle runtimes, add the worker runtime, curated UI, Stop and scoped cache cleanup; verify UI and runtime assets.

## 2. Search and docs context
- [x] 2.1 Implement canonical atomic dual-preset indexing and strict runtime identity checks; verify failed rebuild preservation and mismatch tests.
- [x] 2.2 Regenerate current docs assets and benchmark through the real package; verify route coverage, citations, and retrieval quality for both presets.
- [x] 2.3 Add opt-in semantic UI and independent cited Docs chat; pass UI/grounding tests and update documentation.

## 3. Hex Earth
- [x] 3.1 Export the sibling demo and add responsive accessible panels and cleanup; pass standalone unit/coverage/e2e gates.
- [x] 3.2 Add lazy full-page Labs route, retained dock and shared theme; pass navigation, layout, and production build tests.

## 4. Integrated QA and handoff
- [x] 4.1 Run all repository QA gates and audits without lowering thresholds; record results.
- [x] 4.2 Run real three-model inference, both embeddings, cross-browser desktop/phone suites and production CSP tests; record hardware limits separately.
- [x] 4.3 Deliver local previews, screenshots and per-repository review report; verify no commits or remote writes occurred.


## Verification limits

Implementation and available local QA are complete; evidence is in `qa/local-refresh/REVIEW.md`. Firefox launch was attempted for desktop and phone projects and failed before page creation due to this Mac's browser sandbox/framebuffer error. Physical mobile inference and real mobile keyboards remain unverified. WebKit Gemma recovered on retry with a quota warning; Tiny has a recorded cited-answer failure. These are explicit review limits, not passing checks. No commit or remote write was performed.
