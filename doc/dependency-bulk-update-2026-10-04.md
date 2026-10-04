# Compatible dependency bulk update and interaction fixes — 2026-10-04

Follow-up to [the initial Labs dependency report](./dependency-refresh-2026-10-04.md). Updated **34 direct dependency versions** across four linked packages and refreshed their transitive dependencies. Labs already uses vd3 1.7.5 and current compatible registry dependencies from the preceding refresh.

## Editor and microphone

Code editor drag selection was working, but its highlight was transparent: vd3's computed primary-channel expressions were incompatible with interpolation into `rgba()`. CBUN now derives the selection color with `color-mix()` from the primary theme color. Native drag/copy selection remains available in light, dark and read-only modes.

Manual dictation and Conversation Mode share actionable microphone errors. Device-not-found, permission denial and an unavailable/busy input have separate explanations. Error names and causes are preserved. Capture failure pauses the conversation before model loading; retry resumes a fresh listening turn. Text chat and drafts remain available.

The actual Codex in-app browser returned `NotFoundError` on this machine. The UI now explains that no input is exposed and recommends desktop Chrome. This does not grant browser/OS permissions or make unavailable hardware accessible. [The browser API documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) distinguishes missing input from denied permission. No remote recognition fallback was added.

## Versions

| Project           | Package                   | Before  | After   |
| ----------------- | ------------------------- | ------- | ------- |
| vwl-ai-chat       | @playwright/test          | ^1.62.1 | 1.63.0  |
| vwl-ai-chat       | @types/node               | 26.1.0  | 26.6.4  |
| vwl-ai-chat       | @typescript-eslint/parser | 8.62.0  | 8.71.0  |
| vwl-ai-chat       | eslint                    | ^10.8.0 | 10.12.0 |
| vwl-ai-chat       | prettier                  | ^3.9.6  | 3.9.9   |
| vwl-ai-chat       | typescript-eslint         | 8.62.0  | 8.71.0  |
| vwl-hybrid-search | @huggingface/transformers | ^4.0.0  | 4.3.0   |
| vwl-hybrid-search | @types/node               | 26.1.0  | 26.6.4  |
| vwl-hybrid-search | @typescript-eslint/parser | 8.62.0  | 8.71.0  |
| vwl-hybrid-search | eslint                    | ^10.8.0 | 10.12.0 |
| vwl-hybrid-search | fuse.js                   | ^7.3.0  | ^7.5.0  |
| vwl-hybrid-search | prettier                  | ^3.9.6  | 3.9.9   |
| vwl-hybrid-search | typescript-eslint         | 8.62.0  | 8.71.0  |
| vwl-cbun          | @typescript-eslint/parser | 8.69.0  | 8.71.0  |
| vwl-cbun          | @vue/test-utils           | 2.5.0   | 2.5.1   |
| vwl-cbun          | eslint                    | 10.10.0 | 10.12.0 |
| vwl-cbun          | prettier                  | 3.9.6   | 3.9.9   |
| vwl-cbun          | stylelint                 | 17.15.0 | 17.16.0 |
| vwl-cbun          | typescript-eslint         | 8.69.0  | 8.71.0  |
| vwl-cbun          | vue                       | 3.5.42  | 3.5.43  |
| vwl-hex-earth     | @vanduo-oss/vd3           | 1.7.4   | 1.7.5   |
| vwl-hex-earth     | vue                       | 3.5.42  | 3.5.43  |
| vwl-hex-earth     | @types/node               | 26.6.0  | 26.6.4  |
| vwl-hex-earth     | @vitest/coverage-v8       | 5.0.1   | 5.0.3   |
| vwl-hex-earth     | @vue/test-utils           | 2.5.0   | 2.5.1   |
| vwl-hex-earth     | eslint                    | 10.10.0 | 10.12.0 |
| vwl-hex-earth     | eslint-plugin-vue         | 10.11.0 | 10.11.1 |
| vwl-hex-earth     | jsdom                     | 30.0.1  | 30.1.1  |
| vwl-hex-earth     | knip                      | 6.35.1  | 6.39.0  |
| vwl-hex-earth     | prettier                  | 3.9.6   | 3.9.9   |
| vwl-hex-earth     | typescript-eslint         | 8.70.0  | 8.71.0  |
| vwl-hex-earth     | vite                      | 8.3.0   | 8.3.2   |
| vwl-hex-earth     | vitest                    | 5.0.1   | 5.0.3   |
| vwl-hex-earth     | vue-tsc                   | 3.3.11  | 3.3.12  |

Registry outdated metadata supplied candidate versions; installs honored each project's existing 24-hour release age, trust, peer and lifecycle policies. Existing exact pins remain exact. No third-party release-age exception or global script enablement was added. Package-manager major changes remain excluded.

Separate major migrations remain deferred: TypeScript 7; Vite 8 and Vitest 5 for AI Chat/Hybrid Search; jsdom 30 and Vitest 5 for CBUN. Hex Earth already used Vite 8, Vitest 5 and jsdom 30, so its updates stay within those majors. Later newly published releases remain subject to the normal age policy.

## Audit snapshot

| Graph         | Before: low / moderate / high | After: low / moderate / high |
| ------------- | ----------------------------- | ---------------------------- |
| Labs          | 0 / 0 / 0                     | 0 / 0 / 0                    |
| AI Chat       | 0 / 1 / 2                     | 0 / 0 / 0                    |
| Hybrid Search | 0 / 1 / 2                     | 0 / 0 / 0                    |
| CBUN          | 3 / 7 / 5                     | 0 / 0 / 1                    |
| Hex Earth     | 0 / 0 / 0                     | 0 / 0 / 0                    |

The parser's brace-expansion, jsdom's undici and stylelint's fast-uri findings are resolved in the updated lockfiles. CBUN retains `stylelint → micromatch → braces@3.0.3`: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) currently has no patched release. This is a Node development-tool path; stylelint was retained. Audit results describe known advisories at this time, not a guarantee of security. Full counts and paths are in [the new snapshot](./dependency-bulk-audit.json).

## Validation and limits

- AI Chat: typecheck, lint, 146 unit tests and build passed.
- Hybrid Search: typecheck, lint, 52 unit tests and build passed.
- CBUN: 403 unit tests, declaration tests, stylelint, lint and build/export verification passed. ESLint retains five existing music-player warnings.
- Hex Earth: typecheck, lint, 63 unit tests and both builds passed against the built local CBUN sibling.
- Focused Labs speech, conversation and widget checks: all 102 covered cases passed across Chromium Desktop/WebKit Desktop, including corrected mock cleanup and a targeted successful rerun. Selection and microphone regression subset: 10 passed.
- Existing chat lifecycle, comparison, offline search and Hex Earth route/layout checks: 24 passed across Chromium Desktop/WebKit Desktop.
- Local Codex in-app browser verification: selection highlight is visible; missing-microphone explanation and paused state appear before model loading.
- Labs production build and shipped asset/CSP validation passed. Labs ESLint has zero errors and ten existing draw warnings. OpenSpec strict validation passed.

Hex Earth's existing pinned Git CBUN dependency arrives without its `dist` exports under its current script-blocking configuration. A local node_modules link to the built CBUN sibling was used for validation; the Git pin, install policy and manifest were preserved. A fresh isolated Hex Earth install still needs that existing packaging/build issue resolved. This limitation is separate from the compatible dependency updates and Labs' existing local-link workflow.

Actual-model inference was validated during the preceding Labs runtime refresh. This interaction follow-up did not repeat full actual-model inference or certify microphone capture in the Codex in-app browser.

Review [AI Chat](http://127.0.0.1:8792/demo/ai-chat-demo.html) and [Code editor](http://127.0.0.1:8792/#widgets/code-editor). Sibling changes are on `codex/labs-interaction-dependency-fixes`; Labs remains on its existing development branch. No commit, push or deployment was made.
