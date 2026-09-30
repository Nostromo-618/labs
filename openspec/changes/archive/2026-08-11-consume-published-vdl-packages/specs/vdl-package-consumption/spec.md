## Purpose

Defines how Vanduo Labs consumes published VWL engine packages from npm as a demo playground, without owning or publishing a local engine source of truth.

## ADDED Requirements

### Requirement: Published engine packages are the only engine SoT
Labs MUST depend on `@vanduo-oss/vwl-ai-chat` and `@vanduo-oss/vwl-hybrid-search` from the npm registry and MUST NOT keep local forks of those engines as the source of truth. Labs MUST NOT publish `@vanduo-oss/vwl-engines`.

#### Scenario: Registry dependencies declared
- **WHEN** a contributor inspects `package.json`
- **THEN** `@vanduo-oss/vwl-ai-chat` and `@vanduo-oss/vwl-hybrid-search` are listed as dependencies with published semver ranges

#### Scenario: No engines packaging surface
- **WHEN** a contributor inspects the labs package metadata
- **THEN** the package is private (`@vanduo-oss/labs` or equivalent), has no engine `exports`/`files`/`publishConfig` packaging surface, and docs state engines are not published from labs

### Requirement: Site and CI remain buildable after rewire
After switching to published packages, labs MUST still install, lint/format, unit-test, and build the Vite site successfully.

#### Scenario: Quality gates pass
- **WHEN** a contributor runs format check, lint, unit tests, and build
- **THEN** each gate completes successfully without requiring sibling clones of the engine repos
