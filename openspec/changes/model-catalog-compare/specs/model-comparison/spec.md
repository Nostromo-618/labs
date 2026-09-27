## ADDED Requirements
### Requirement: Independent paired conversations
Labs SHALL send one prompt to two independent conversations and SHALL retain each model's own completed turns.
#### Scenario: A side fails
Given two loaded models, when one generation fails, then the other answer MUST remain available and retry MUST use the failed turn's original history and sources.
### Requirement: Shared documentation evidence
Given Docs comparison mode, when a shared prompt is sent, then retrieval SHALL occur once and both sides SHALL receive identical bounded evidence.
### Requirement: Explicit resource ownership
Given active comparison engines, when the user navigates away or enters evaluation, then engines SHALL stop and dispose before the next view loads inference resources.
### Requirement: Honest evaluation
Given an evaluation run, when a capability or measurement is unavailable, then the report SHALL distinguish skips/unknown values from passes and measured values.
