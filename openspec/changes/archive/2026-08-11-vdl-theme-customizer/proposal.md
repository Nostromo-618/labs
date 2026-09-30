## Why

Labs is text- and data-heavy; users benefit from vd3's theme customizer (palette, colors, radius, font). On GitHub Pages, Labs shares an origin with Vanduo docs, so default `vanduo-*` theme localStorage keys would collide — Labs must persist under `vwl-*` instead.

## What Changes

- Mount `VdThemeCustomizer` in the Labs site shell (navbar actions, alongside existing `VdThemeSwitcher`).
- Hide the Palette selector (Open Color / Fibonacci) and stay on Open Color via vd3's `showPalette` prop.
- Install a Labs-owned localStorage remap so vd3 theme reads/writes use `vwl-*` keys, leaving `vanduo-*` keys for docs untouched.
- Persist and restore theme preferences across reloads via the remapped keys.
- Add a focused unit test for the storage remap; light README note if helpful.

## Capabilities

### New Capabilities

- `vwl-theme-customizer`: Labs shell exposes vd3 theme customization with `vwl-`-prefixed preference storage that does not collide with main Vanduo docs keys.

### Modified Capabilities

- (none)

## Impact

- Labs Vue shell: `src/main.js`, `src/App.vue`, `src/styles/labs.css`, new `src/vwl-theme-storage.js` (or equivalent).
- Tests: focused Playwright unit/smoke for storage remap.
- Docs: brief README note optional.
- Does **not** fork or rename `@vanduo-oss/vd3` APIs (`Vd*`, `--vd-*`, `.vd-*`).
