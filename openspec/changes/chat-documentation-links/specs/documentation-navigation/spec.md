## ADDED Requirements

### Requirement: Source-relative documentation navigation
Labs SHALL resolve documentation links against their source document after safe Markdown rendering. Linked local Markdown SHALL have readable HTML pages in development and production. Unsafe destinations SHALL remain inert.

#### Scenario: Workspace validation from the chat demo
- **WHEN** the reader follows workspace validation from inline chat documentation
- **THEN** a readable report opens rather than the SPA fallback
- **AND** the report's onward links resolve to shipped documents, evidence or the app

### Requirement: Current guidance and verifiable attribution
Current chat guidance SHALL describe checked previews, final-only persistence/speech, selectable conversation models and shared voices. Historical reports SHALL identify their scope. Linked notices, catalogs and provenance SHALL be available in built assets from authoritative source files.

#### Scenario: Production link verification
- **WHEN** the chat documentation's local link graph is checked against production assets
- **THEN** every destination and internal fragment exists
- **AND** external destinations are checked separately with any unavailable checks disclosed
