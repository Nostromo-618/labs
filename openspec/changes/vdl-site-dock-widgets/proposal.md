# Change: Labs Oola dock + vwl-cbun widgets

## Why
Move Labs shell to the docs-style VdDock and host vwl-cbun widget demos under `#widgets/*` with local `@vanduo-oss/vwl-cbun`.

## Dependency note (`link:` is the SoT)
`package.json` keeps `"@vanduo-oss/vwl-cbun": "link:../vwl-cbun"` — Labs `vwl-*` packages are sibling repos, not on npm. Local install stays on `link:` + `vite.config.js` aliases into `../vwl-cbun/dist`.

## Specs
- `vwl-site-dock` — fixed dock, `vwl-site-dock` storage, `data-labs-dock`, Widgets nav
- `vwl-widgets` — hash routes + landing previews
- Updates: `vwl-theme-customizer` (swatches fan, primary-only; sky / RADIUS 0.5 defaults), `vwl-tools-nav` (Widgets item, vd3-charts)
