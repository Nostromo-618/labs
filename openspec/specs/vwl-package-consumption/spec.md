# vwl-package-consumption Specification

## Purpose
Defines how Vanduo Web Labs consumes sibling `vwl-*` Labs repos via `link:` as a demo playground, without owning or publishing a local engine source of truth and without treating `vwl-*` as a public npm family.

## Requirements
### Requirement: Sibling Labs repos are the only engine SoT
Labs MUST depend on `@vanduo-oss/vwl-ai-chat`, `@vanduo-oss/vwl-hybrid-search`, and `@vanduo-oss/vwl-cbun` via `link:../vwl-*` (sibling checkouts) and MUST NOT keep local forks of those engines as the source of truth. Labs MUST NOT publish `@vanduo-oss/vwl-engines` or any `vwl-*` npm package.

#### Scenario: Link dependencies declared
- **WHEN** a contributor inspects `package.json`
- **THEN** `@vanduo-oss/vwl-ai-chat`, `@vanduo-oss/vwl-hybrid-search`, and `@vanduo-oss/vwl-cbun` are listed as dependencies with `link:../vwl-*` specifiers

#### Scenario: No engines packaging surface
- **WHEN** a contributor inspects the labs package metadata
- **THEN** the package is private (`@vanduo-oss/labs` or equivalent), has no engine `exports`/`files`/`publishConfig` packaging surface, and docs state engines are Labs sibling repos (not an npm family)

### Requirement: Site and CI remain buildable after rewire
After switching to sibling `link:` deps, labs MUST still install, lint/format, unit-test, and build the Vite site successfully when the sibling repos are checked out beside Labs.

#### Scenario: Quality gates pass with siblings
- **WHEN** a contributor has `vwl-ai-chat`, `vwl-hybrid-search`, and `vwl-cbun` cloned beside Labs and runs format check, lint, unit tests, and build
- **THEN** each gate completes successfully
