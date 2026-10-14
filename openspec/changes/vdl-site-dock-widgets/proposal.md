# Change: Labs Oola dock + wwl-cbun widgets

## Why
Move Labs shell to the docs-style VdDock and host wwl-cbun widget demos under `#widgets/*` with local `@wwl/wwl-cbun`.

## Dependency note (`link:` is the SoT)
`package.json` keeps `"@wwl/wwl-cbun": "link:../wwl-cbun"` — Labs `wwl-*` packages are sibling repos, not on npm. Local install stays on `link:` + `vite.config.js` aliases into `../wwl-cbun/dist`.

## Specs
- `wwl-site-dock` — fixed dock, `wwl-site-dock` storage, `data-labs-dock`, Widgets nav
- `wwl-widgets` — hash routes + landing previews
- Updates: `wwl-theme-customizer` (swatches fan, primary-only; sky / RADIUS 0.5 defaults), `wwl-tools-nav` (Widgets item, vd3-charts)
