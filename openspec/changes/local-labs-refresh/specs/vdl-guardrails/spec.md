# Spec Delta

## ADDED Requirements
### Requirement: Validate before tool execution
The harness SHALL validate tool names and declared argument schemas, reject malformed protocol input, bound rounds/calls/time/results, and isolate tool results as untrusted data.
#### Scenario: Malformed call
- **WHEN** the model emits invalid JSON or arguments that do not match a tool schema
- **THEN** no host tool executes
### Requirement: Guard output before display
The harness SHALL check accumulated streamed output before emitting it, keep protocol markup out of user-facing streams, and use neutral refusal text.
#### Scenario: Benign wording
- **WHEN** a user asks about maximum width or a fictional example without requesting a policy override
- **THEN** ordinary domain wording alone does not cause a refusal
