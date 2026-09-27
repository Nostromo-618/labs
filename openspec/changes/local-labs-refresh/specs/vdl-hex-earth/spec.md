# Spec Delta

## Purpose
Provide a full-page Earth exploration demo within Labs while retaining the site dock and the sibling application's independent ownership.
## ADDED Requirements
### Requirement: Full-page Earth route
Labs SHALL lazy-load the sibling Earth demo at #demos/hex-earth and retain the Oola dock, theme, and existing map interactions.
#### Scenario: Launch and return
- **WHEN** the user opens Earth from Demos and then navigates away
- **THEN** the map fills the available viewport and releases active work on exit
### Requirement: Accessible responsive panels
Controls and Stats SHALL be movable, collapsible, dismissible, keyboard operable, persisted and bounded on desktop, with reset-layout support; phones SHALL use compact sheets.
#### Scenario: Resize or dock move
- **WHEN** the viewport or dock placement changes
- **THEN** panels remain reachable and map gestures remain usable
### Requirement: Explicit benchmarks
Benchmarks SHALL run on demand and stop when the demo unmounts.
#### Scenario: Phone startup
- **WHEN** Earth opens on a narrow screen
- **THEN** it starts at a lower tier and all resolution tiers remain selectable
