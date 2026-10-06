## ADDED Requirements

### Requirement: Curated browser-local catalog
The catalog MUST offer Gemma E2B/E4B, Tiny Qwen3 0.6B and LFM2.5 230M/350M/2.6B with two precision variants. Engine and tool capability MUST distinguish documented model support from integrated execution. Retired models MUST NOT download silently.

#### Scenario: Primary choices and variants
- **GIVEN** the model picker
- **WHEN** a user selects a primary model
- **THEN** only its available precisions appear and Gemma E2B remains the initial default

### Requirement: Complete checked replies
Chat MUST screen complete replies before display, persistence, callbacks or speech and MUST discard cancelled partial output.

#### Scenario: Harmful text crosses chunks
- **GIVEN** a reply whose prohibited text spans multiple generated chunks
- **WHEN** generation completes
- **THEN** only a safe replacement is exposed and rejected text is absent from history
