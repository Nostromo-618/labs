# Design

## Context
See proposal.md. Engines remain in their sibling repositories; Labs owns presentation and shared source retrieval. Existing Hex Earth edits are the starting point.

## Goals / Non-Goals
Implement the reviewed local-only plan. No hosted inference, publishing, commits, or vd3 API changes.

## Decisions
- Pin LiteRT 0.17.1 and WebLLM 0.2.85. Host-owned adapters enforce cancellation and bounded execution; WebLLM runs in a dedicated worker. LiteRT retains its supported main-thread initialization.
- Typed additive generation options preserve old callbacks. Track completed turns separately from per-turn retrieved context. Rebuild native conversations from bounded recent turns, reserve response tokens, and emit context notices.
- Validate schemas at execution boundaries with a documented bounded schema subset. Native results use tool_response messages; XML remains explicit compatibility.
- Read canonical search JSON and rendered HTML from the local docs build. Publish immutable generation directories selected by an atomic manifest so index/vector generations cannot mix.
- MiniLM and EmbeddingGemma share the same corpus. Runtime checks identity and preprocessing before downloading. Docs mode retrieves first, then generates with bounded source IDs; citation links are resolved only through that retrieval set.
- Hex Earth exports one reusable Vue component and keeps a standalone wrapper. Labs lazy-loads its private sibling package. Panels share accessible movement and viewport/dock constraints.

## Risks / Trade-offs
- Hardware-dependent model behavior: keep a real-inference report distinct from unit/browser-layout results and do not claim physical-device verification without devices.
- Large cold downloads: explicit opt-in, cached weights, progress/error recovery, and no implicit quality upgrades.
- Local source changes: preserve initial Hex Earth diff and separate QA findings from new changes.

## Migration Plan
Regenerate both presets, update Labs to resolve the manifest, preserve legacy public constructor/callback entry points, and run source plus production-preview tests. Keep changes uncommitted for user review.
