# vwl-site-dock Specification

## Purpose
Replace the Labs top navbar with a fixed Oola `VdDock` site chrome that matches the docs dock pattern, using Labs-owned storage and padding attributes.

## Requirements
### Requirement: Labs shell uses a fixed site dock
The unlocked Labs SPA MUST render a fixed `VdDock` (`LabsSiteDock`) with `position="fixed"`, `cycle="edges"`, persist under storage key `vwl-site-dock`, and dock radius `1.5`.

#### Scenario: Dock is present after disclaimer accept
- **WHEN** a user accepts the disclaimer and the app unlocks
- **THEN** a `nav.vd-site-dock.vd-dock-fixed` is visible
- **AND** no `.vd-navbar` Labs shell navbar is present

### Requirement: Dock items and hash navigation
The dock MUST list Home, Widgets, Demos, and About. Activating an item MUST set `location.hash` to `#home`, `#widgets`, `#demos`, or `#about` respectively.

#### Scenario: Widgets item navigates
- **WHEN** a user activates the Widgets dock item
- **THEN** the hash becomes `#widgets`

### Requirement: Brand wordmark on wide horizontal edges only
The dock brand MUST show the atom mark plus “vanduo web labs” wordmark on horizontal edges when the viewport is wider than the VdDock narrow query (520px). On vertical edges (left/right) and on narrow horizontal docks, the wordmark MUST be hidden (logo only).

#### Scenario: Vertical dock hides wordmark
- **WHEN** the site dock placement is `left` or `right`
- **THEN** `.labs-dock-brand-title` is not visible

#### Scenario: Narrow horizontal dock hides wordmark
- **WHEN** the viewport matches the narrow dock query (max-width 520px) and placement is `top` or `bottom`
- **THEN** `.labs-dock-brand-title` is not visible

### Requirement: data-labs-dock page padding
While the dock is mounted, Labs MUST set `html[data-labs-dock]` to the active edge so page padding clears the fixed dock.

#### Scenario: Attribute tracks placement
- **WHEN** the dock placement is `top`
- **THEN** `document.documentElement` has `data-labs-dock="top"`
