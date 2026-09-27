# Spec Delta

## MODIFIED Requirements
### Requirement: Semantic preload on mount
The UI SHALL initialize fuzzy search on mount and SHALL load semantic models only after explicit user selection. MiniLM SHALL be the default semantic option and EmbeddingGemma SHALL be a separately enabled quality option.
#### Scenario: Mount starts semantic warmup
- **WHEN** the search UI mounts
- **THEN** fuzzy search works without downloading an embedding model
#### Scenario: Fuzzy remains available during preload
- **WHEN** the user enables a semantic option
- **THEN** the matching vector set is validated before model loading
## ADDED Requirements
### Requirement: Canonical coherent search assets
Search assets SHALL derive from the same local vd3-docs build and contain matching corpus hashes and embedding metadata. Failed indexing SHALL preserve the previous valid set.
#### Scenario: Incompatible vectors
- **WHEN** model, dimensions, preprocessing, or corpus identity differ
- **THEN** semantic loading fails clearly before inference and fuzzy results remain available
