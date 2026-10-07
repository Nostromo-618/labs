# Documentation validation — October 7, 2026

Validated the chat guide and its full reachable documentation graph: **12 pages,
88 link occurrences, 39 distinct local destinations, 17 external URLs**. All local
files exist, and real production-preview HTTP responses match their built bytes;
no SPA fallback passes. All external URLs returned HTTP 200 after redirects;
Qwen and the three Liquid tool-use anchors were present. Live checks used the
system CA bundle because a configured endpoint-security CA file was missing.

The 16 focused checks passed in Chromium and WebKit, desktop and mobile. They
cover safe source-relative resolution, unsafe/encoded schemes remaining inert,
heading anchors, actual workspace-report navigation and onward links, attribution
assets and the 28-entry voice catalog. Actual production navigation also passed
at 1440px and 390px with no horizontal page overflow. No model downloads were
needed for this documentation change.

Labs formatting, lint, production build, strict OpenSpec validation and shipped
asset assertions passed (92 search routes and pinned runtime assets). The asset
exclusion check allows only the generated, script-free model-evaluation guide;
actual evaluation harnesses, tests, mirrors and logs remain excluded. Generated
HTML adds roughly 160 KiB of static documentation on disk, loaded only when opened.

`pnpm docs:check` now runs after the CI build. External availability is checked
separately to avoid making CI dependent on third-party uptime. Raw link responses
and desktop/mobile screenshots are local artifacts under `qa/doc-links/`. Historical
validation figures are preserved; obsolete local-server URLs and sibling-only
production links were corrected. Current docs describe previews, Compare timing,
shared voice preferences and paused conversation edits consistently.

Local development changes only; no commit, push or deployment.
